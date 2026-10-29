(()=>{
/* ====================================================================
   CARTES PvP ALÉATOIRES  (v12)
   • À chaque partie PvP, la map est tirée au sort (graine partagée par l'hôte -> tous les joueurs ont la même).
   • Animation de tirage : toutes les maps défilent, ça ralentit, puis ça s'arrête sur la map définitive.
   • Les .glb sont cherchés dans assets/ (puis assets/Maps/, ...). (v5) Si une map échoue, on essaie les AUTRES maps ;
     la ville zombie n'est utilisée qu'en tout dernier recours, avec la VRAIE raison affichée (404, page HTML, Draco, etc.).
   • Collisions : grille de hauteurs calculée à partir des triangles du .glb (sol, marches, murs, caisses).
   ==================================================================== */
const MAPS=[
  /* files = noms possibles du .glb dans assets/ (le premier trouvé gagne).
     zoom = échelle du décor par rapport au personnage : 1 = carte entière ramenée à 78 m ; 2 = décor 2x plus grand
            (le personnage paraît 2x plus petit). Seul le centre (±44 m) est jouable, un mur de 3 m suit le contour. */
  {id:'cove',    name:'Crique',            emoji:'🏝️',files:['covelarge.glb'],                 zoom:1.8, arena:{r:26}},   // (v12) arène circulaire (rayon r en m) au centre de la map, fermée par une palissade en bois
  {id:'warzone', name:'Warzone médiévale', emoji:'🏰',files:['warzone_medieval_theme.glb'],    zoom:1.8}
];
const BASES=['assets/','assets/Maps/'];
const SPAN=78;          // largeur cible d'une map (m) — la limite du moteur est ±44
const CELL=.5;          // résolution de la grille de collision (m)
const STEP=.85;
const BODY=1.7;         // hauteur du corps (m)
const safe=f=>{try{return f()}catch(e){console.warn('[maps]',e&&e.message||e)}};

/* ====== MONDE DE COLLISION (v7) — contenu de collision_2.js, intégré ici ====== */
/* ---------------- MONDE DE COLLISION (v6) : triangles exacts + index spatial ----------------
   Remplace l'ancienne grille de 50 cm (cause des murs invisibles, des sols traversés et des sorties de map) :
   • sol    : hauteur EXACTE du triangle sous les pieds (plus de quantification), 7 points d'appui -> pas de trou entre deux triangles
   • murs   : coupe de chaque triangle par la "tranche" du corps [pieds+STEP ; pieds+BODY] puis cercle (rayon du joueur) contre ce polygone
              -> le mur bloque exactement à sa surface (plus de mur invisible de 50 cm), marches <= STEP franchies automatiquement
   • rayons : vrai lancer de rayon sur les triangles (visée, grappin, caméra)                                                         */
const WALK=.62;          // normale.y minimale d'une surface praticable (~52°)
const CS=2;              // taille d'une case de l'index spatial (m)
function makeWorld(half){
  return{half,N:Math.ceil(half*2/CS),n:0,cap:1<<15,P:new Float32Array((1<<15)*9),cs:null,ct:null,nr:null,y0:null,y1:null,seen:null,stamp:0,base:0,zc:null,spawns:null};
}
function addTri(W,ax,ay,az,bx,by,bz,cx,cy,cz){
  const h=W.half+1;
  if((ax>h&&bx>h&&cx>h)||(ax<-h&&bx<-h&&cx<-h)||(az>h&&bz>h&&cz>h)||(az<-h&&bz<-h&&cz<-h))return;
  const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
  if(nx*nx+ny*ny+nz*nz<1e-10)return;
  if(W.n>=W.cap){W.cap*=2;const P=new Float32Array(W.cap*9);P.set(W.P);W.P=P}
  const o=W.n*9,P=W.P;P[o]=ax;P[o+1]=ay;P[o+2]=az;P[o+3]=bx;P[o+4]=by;P[o+5]=bz;P[o+6]=cx;P[o+7]=cy;P[o+8]=cz;W.n++;
}
const cix=(W,v)=>{const i=Math.floor((v+W.half)/CS);return(i<0||i>=W.N)?-1:i};
/* fige le monde : niveau du sol principal (ramené à y=0), (v7) ajout éventuel du mur de bordure, puis index spatial.
   extra(W,base) est appelé une fois les triangles recalés à y=0 : c'est là que le mur de 3 m est ajouté (addTri) pour que
   pushXZ / rayHit / groundFoot le voient exactement comme n'importe quel mur du modèle. */
function finishWorld(W,extra){
  const n=W.n,P=W.P,hist={},sum={};let tot=0;
  for(let i=0;i<n;i++){
    const o=i*9,ux=P[o+3]-P[o],uy=P[o+4]-P[o+1],uz=P[o+5]-P[o+2],vx=P[o+6]-P[o],vy=P[o+7]-P[o+1],vz=P[o+8]-P[o+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
    if(ny/l>.7){const a=l/2,my=(P[o+1]+P[o+4]+P[o+7])/3,b=Math.round(my*4);hist[b]=(hist[b]||0)+a;sum[b]=(sum[b]||0)+a*my;tot+=a}
  }
  let base=0;
  const bins=Object.keys(hist).map(Number).sort((a,b)=>a-b);
  for(const b of bins){if(hist[b]>=tot*.06){base=sum[b]/hist[b];break}}      // le plus bas niveau qui couvre >= 6 % des surfaces praticables
  if(base){for(let i=0;i<n;i++){const o=i*9;P[o+1]-=base;P[o+4]-=base;P[o+7]-=base}}
  W.base=base;
  if(extra)extra(W,base);
  return indexWorld(W);
}
/* normales, hauteurs min/max et index spatial (grille de cases de CS mètres) de tous les triangles de W */
function indexWorld(W){
  const n=W.n,P=W.P,nr=new Float32Array(n*3),y0=new Float32Array(n),y1=new Float32Array(n);
  for(let i=0;i<n;i++){
    const o=i*9,ux=P[o+3]-P[o],uy=P[o+4]-P[o+1],uz=P[o+5]-P[o+2],vx=P[o+6]-P[o],vy=P[o+7]-P[o+1],vz=P[o+8]-P[o+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
    nr[i*3]=nx/l;nr[i*3+1]=ny/l;nr[i*3+2]=nz/l;
    y0[i]=Math.min(P[o+1],P[o+4],P[o+7]);y1[i]=Math.max(P[o+1],P[o+4],P[o+7]);
  }
  W.nr=nr;W.y0=y0;W.y1=y1;W.seen=new Uint32Array(n);
  const N=W.N,cnt=new Int32Array(N*N+1),rng=t=>{
    const o=t*9,mnx=Math.min(P[o],P[o+3],P[o+6]),mxx=Math.max(P[o],P[o+3],P[o+6]),mnz=Math.min(P[o+2],P[o+5],P[o+8]),mxz=Math.max(P[o+2],P[o+5],P[o+8]);
    const cl=v=>Math.max(0,Math.min(N-1,Math.floor((v+W.half)/CS)));
    return[cl(mnx),cl(mxx),cl(mnz),cl(mxz)];
  };
  for(let t=0;t<n;t++){const r=rng(t);for(let j=r[2];j<=r[3];j++)for(let i=r[0];i<=r[1];i++)cnt[j*N+i+1]++}
  for(let k=0;k<N*N;k++)cnt[k+1]+=cnt[k];
  const ct=new Int32Array(cnt[N*N]),fill=cnt.slice(0,N*N);
  for(let t=0;t<n;t++){const r=rng(t);for(let j=r[2];j<=r[3];j++)for(let i=r[0];i<=r[1];i++)ct[fill[j*N+i]++]=t}
  W.cs=cnt;W.ct=ct;
  return W;
}
/* hauteur du triangle (offset o dans P) au point (x,z), NaN si (x,z) est hors du triangle */
function triH(P,o,x,z,eps){
  const ax=P[o],az=P[o+2],bx=P[o+3],bz=P[o+5],cx=P[o+6],cz=P[o+8];
  const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-9)return NaN;
  const l1=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,l2=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d,l3=1-l1-l2;
  if(l1<-eps||l2<-eps||l3<-eps)return NaN;
  return l1*P[o+1]+l2*P[o+4]+l3*P[o+7];
}
/* un dessous de dalle (face tournée vers le bas) existe-t-il entre lo et hi à la verticale de (x,z) ? -> hauteur du plus bas, sinon NaN */
function ceilBetween(W,x,z,lo,hi){
  const i=cix(W,x),j=cix(W,z);if(i<0||j<0)return NaN;
  const k=j*W.N+i;let best=NaN;
  for(let q=W.cs[k];q<W.cs[k+1];q++){
    const t=W.ct[q];if(W.nr[t*3+1]>-.3||W.y1[t]<lo||W.y0[t]>hi)continue;
    const h=triH(W.P,t*9,x,z,.002);if(h!==h||h<=lo||h>=hi)continue;
    if(best!==best||h<best)best=h;
  }
  return best;
}
/* plus haute surface praticable sous (x,z) dont la hauteur <= yMax ; yRef = hauteur des pieds (sert à ne pas monter à travers une dalle) */
function groundPt(W,x,z,yMax,yRef){
  const i=cix(W,x),j=cix(W,z);if(i<0||j<0)return-Infinity;
  const k=j*W.N+i,P=W.P;let best=-Infinity;
  for(let q=W.cs[k];q<W.cs[k+1];q++){
    const t=W.ct[q];if(W.nr[t*3+1]<WALK||W.y0[t]>yMax)continue;
    const h=triH(P,t*9,x,z,.002);if(h!==h||h>yMax||h<=best)continue;
    if(h>yRef+.05&&ceilBetween(W,x,z,yRef+.1,h-.03)===ceilBetween(W,x,z,yRef+.1,h-.03)){continue}   // on est SOUS cette dalle
    best=h;
  }
  return best;
}
const RING=[[1,0],[.5,.866],[-.5,.866],[-1,0],[-.5,-.866],[.5,-.866]];
/* sol sous les pieds : centre + 6 points sur un cercle de rayon r (on ne tombe plus entre deux triangles ni au bord d'une plateforme) */
function groundFoot(W,x,z,yMax,yRef,r){
  let b=groundPt(W,x,z,yMax,yRef);
  for(let q=0;q<6;q++){const h=groundPt(W,x+RING[q][0]*r,z+RING[q][1]*r,yMax,yRef);if(h>b)b=h}
  return b;
}
/* ---- murs : cercle contre la coupe des triangles par la tranche du corps ---- */
const _A=new Float64Array(18),_B=new Float64Array(18),_C=new Float64Array(18);
function clipY(a,n,b,lim,above){
  let m=0;
  for(let i=0;i<n;i++){
    const j=(i+1)%n,ai=i*3,aj=j*3,di=above?a[ai+1]-lim:lim-a[ai+1],dj=above?a[aj+1]-lim:lim-a[aj+1];
    if(di>=0){b[m*3]=a[ai];b[m*3+1]=a[ai+1];b[m*3+2]=a[ai+2];m++}
    if((di>=0)!==(dj>=0)){const t=di/(di-dj);b[m*3]=a[ai]+(a[aj]-a[ai])*t;b[m*3+1]=a[ai+1]+(a[aj+1]-a[ai+1])*t;b[m*3+2]=a[ai+2]+(a[aj+2]-a[ai+2])*t;m++}
  }
  return m;
}
const BODYH=1.7,STEPH=.85;
/* pousse (x,z) hors des murs. move=false : teste seulement. Renvoie le nombre de contacts. out={x,z} reçoit la position corrigée */
const _o={x:0,z:0};
function pushXZ(W,px,pz,rad,y,move,stepH,bodyH){
  const ys0=y+(stepH===undefined?STEPH:stepH),ys1=y+(bodyH===undefined?BODYH:bodyH);
  let contacts=0;
  for(let it=0;it<4;it++){
    const i0=Math.max(0,Math.floor((px-rad+W.half)/CS)),i1=Math.min(W.N-1,Math.floor((pz*0+px+rad+W.half)/CS)),
          j0=Math.max(0,Math.floor((pz-rad+W.half)/CS)),j1=Math.min(W.N-1,Math.floor((pz+rad+W.half)/CS));
    if(++W.stamp>4e9){W.seen.fill(0);W.stamp=1}
    let moved=false;
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const k=j*W.N+i;
      for(let q=W.cs[k];q<W.cs[k+1];q++){
        const t=W.ct[q];if(W.seen[t]===W.stamp)continue;W.seen[t]=W.stamp;
        if(W.y1[t]<ys0||W.y0[t]>ys1)continue;
        const ny=W.nr[t*3+1];
        if(ny>=WALK&&W.y0[t]<ys0)continue;                       // sol / pente praticable : géré par le calcul de hauteur, pas un mur
        const o=t*9,P=W.P;
        _A[0]=P[o];_A[1]=P[o+1];_A[2]=P[o+2];_A[3]=P[o+3];_A[4]=P[o+4];_A[5]=P[o+5];_A[6]=P[o+6];_A[7]=P[o+7];_A[8]=P[o+8];
        let n=3;
        if(W.y0[t]<ys0){n=clipY(_A,n,_B,ys0,true);if(n<1)continue;n=clipY(_B,n,_C,ys1,false)}
        else if(W.y1[t]>ys1){n=clipY(_A,n,_C,ys1,false)}
        else{for(let v=0;v<9;v++)_C[v]=_A[v]}
        if(W.y0[t]<ys0&&n>0&&W.y1[t]<=ys1){/* déjà coupé en bas, rien au-dessus */}
        if(n<1)continue;
        const R=(W.y0[t]<ys0||W.y1[t]>ys1)?_C:_C;
        /* point le plus proche du polygone (en XZ) */
        let bd=1e18,bx=0,bz=0;
        for(let v=0;v<n;v++){
          const w=(v+1)%n,ax=R[v*3],az=R[v*3+2],ex=R[w*3]-ax,ez=R[w*3+2]-az,l2=ex*ex+ez*ez;
          let s=l2>1e-12?((px-ax)*ex+(pz-az)*ez)/l2:0;s=s<0?0:s>1?1:s;
          const cx=ax+ex*s,cz=az+ez*s,d=(px-cx)*(px-cx)+(pz-cz)*(pz-cz);
          if(d<bd){bd=d;bx=cx;bz=cz}
        }
        let inside=false;
        if(n>=3){for(let v=0,w=n-1;v<n;w=v++){const zi=R[v*3+2],zj=R[w*3+2];if((zi>pz)!==(zj>pz)&&px<(R[w*3]-R[v*3])*(pz-zi)/(zj-zi)+R[v*3])inside=!inside}}
        const d=Math.sqrt(bd);
        if(!inside&&d>=rad-.002)continue;
        contacts++;if(!move)return contacts;
        let dx=px-bx,dz=pz-bz;
        if(inside){dx=-dx;dz=-dz}                                     // dans le polygone : on sort par le bord le plus proche
        let dl=Math.hypot(dx,dz);
        if(dl<1e-5){dx=W.nr[t*3];dz=W.nr[t*3+2];dl=Math.hypot(dx,dz);if(dl<1e-5){dx=1;dz=0;dl=1}}
        dx/=dl;dz/=dl;
        px=bx+dx*rad;pz=bz+dz*rad;moved=true;
      }
    }
    if(!moved)break;
  }
  _o.x=px;_o.z=pz;
  return contacts;
}
const blockedW=(W,x,z,y,rad,stepH,bodyH)=>pushXZ(W,x,z,rad,y,false,stepH,bodyH)>0;
/* ---- rayon : parcours des cases (DDA) + Möller–Trumbore, double face. Renvoie {t,nx,ny,nz} ou null ---- */
const _hit={t:0,nx:0,ny:0,nz:0};
function rayHit(W,ox,oy,oz,dx,dy,dz,maxT,minT){
  minT=minT||0;const H=W.half;
  let t0=minT,t1=maxT;
  for(const [o,d] of [[ox,dx],[oz,dz]]){                                  // on découpe le rayon sur la boîte de la map
    if(Math.abs(d)<1e-9){if(o<-H||o>H)return null;continue}
    let a=(-H-o)/d,b=(H-o)/d;if(a>b){const s=a;a=b;b=s}
    if(a>t0)t0=a;if(b<t1)t1=b;if(t0>t1)return null;
  }
  const N=W.N,sx=Math.sign(dx)||1,sz=Math.sign(dz)||1;
  let x=ox+dx*t0,z=oz+dz*t0;
  let i=Math.max(0,Math.min(N-1,Math.floor((x+H)/CS))),j=Math.max(0,Math.min(N-1,Math.floor((z+H)/CS)));
  const tdx=Math.abs(dx)>1e-9?CS/Math.abs(dx):1e18,tdz=Math.abs(dz)>1e-9?CS/Math.abs(dz):1e18;
  let nx=Math.abs(dx)>1e-9?t0+(((dx>0?i+1:i)*CS-H)-x)/dx:1e18,nz=Math.abs(dz)>1e-9?t0+(((dz>0?j+1:j)*CS-H)-z)/dz:1e18;
  if(++W.stamp>4e9){W.seen.fill(0);W.stamp=1}
  let best=maxT+1,bt=-1;const P=W.P;
  for(let guard=0;guard<4000;guard++){
    const k=j*N+i,cellEnd=Math.min(nx,nz);
    for(let q=W.cs[k];q<W.cs[k+1];q++){
      const t=W.ct[q];if(W.seen[t]===W.stamp)continue;W.seen[t]=W.stamp;
      const o=t*9,e1x=P[o+3]-P[o],e1y=P[o+4]-P[o+1],e1z=P[o+5]-P[o+2],e2x=P[o+6]-P[o],e2y=P[o+7]-P[o+1],e2z=P[o+8]-P[o+2];
      const px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;
      if(Math.abs(det)<1e-9)continue;
      const inv=1/det,sx0=ox-P[o],sy0=oy-P[o+1],sz0=oz-P[o+2],u=(sx0*px+sy0*py+sz0*pz)*inv;if(u<0||u>1)continue;
      const qx=sy0*e1z-sz0*e1y,qy=sz0*e1x-sx0*e1z,qz=sx0*e1y-sy0*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<0||u+v>1)continue;
      const tt=(e2x*qx+e2y*qy+e2z*qz)*inv;
      if(tt>=minT&&tt<=maxT&&tt<best){best=tt;bt=t}
    }
    if(bt>=0&&best<=cellEnd)break;
    if(cellEnd>t1)break;
    if(nx<nz){i+=sx;nx+=tdx;if(i<0||i>=N)break}else{j+=sz;nz+=tdz;if(j<0||j>=N)break}
  }
  if(bt<0)return null;
  let a=W.nr[bt*3],b=W.nr[bt*3+1],c=W.nr[bt*3+2];if(a*dx+b*dy+c*dz>0){a=-a;b=-b;c=-c}
  _hit.t=best;_hit.nx=a;_hit.ny=b;_hit.nz=c;return _hit;
}

/* ====================================================================
   v7 — LIMITES DE MAP : un mur de 3 m qui suit le contour extérieur du modèle 3D
   --------------------------------------------------------------------
   Avant : zone interdite = disque de rayon ZR autour du centre (sans rapport avec la forme de la map).
   Maintenant :
   1. EMPREINTE : toutes les cases de 0,5 m où le .glb a au moins un triangle (sol, mur, plafond), vue de dessus.
   2. CONTOUR   : fermeture des fissures (< 2 m), remplissage des trous intérieurs, suppression des îlots détachés,
                  puis extraction du contour extérieur (arêtes de cases chaînées en boucles, simplifiées à 0,3 m).
   3. MUR       : le contour est découpé en panneaux de 3 m ; chaque panneau devient 2 triangles de COLLISION ajoutés au
                  monde (W) -> pushXZ, rayHit (balles, visée, caméra) et groundFoot le traitent comme un vrai mur.
                  Hauteur : exactement WALL_H = 3 m au-dessus du sol praticable le long du panneau (le mur descend à
                  -1,5 m : aucun passage par en dessous).
   4. FILET     : masque « dans la zone » (inZone) valable à TOUTE hauteur -> même en sautant / grimpant, impossible de sortir.
   5. SPAWNS    : 8 points choisis uniquement dans la zone, à >= 3 m du mur, sur sol libre (jamais dans un mur / un objet).
   6. walkTo    : déplacement balayé par pas de 0,2 m (< rayon du joueur) avec pushXZ(move=true) à CHAQUE pas -> on glisse
                  le long des murs, on ne les traverse jamais (glissade, salto, kick, recul, prise de judo...).
   Dépend de : CELL, gi, gridBlocked (grille de pvp-maps), makeGrid/rasterTri (remplissent G.fl / G.wl / G.cl).
   ==================================================================== */
const WALL_H=3;            // hauteur EXACTE du mur de bordure (m) au-dessus du sol praticable
const WALL_LOW=-1.5;       // le mur descend sous le sol virtuel
const FOOT_CLOSE=2;        // fermeture morphologique (cases) : fissures de moins de 2 m comblées
const SIMPL=.3;            // tolérance de simplification du contour (m)
const PANEL=3;             // longueur maximale d'un panneau de mur (m)
const FLOOR_TOP=4;         // seuls les sols jusqu'à 4 m comptent pour fixer la base du mur (pas les toits inaccessibles)
const KEEP_FRAC=.05;       // un îlot détaché est ignoré s'il fait moins de 5 % de la plus grande partie
const SPAWN_EDGE=3;        // distance mini d'un point d'apparition au mur (m)

/* dilatation (mode=1) / érosion (mode=0) par carré de côté 2R+1, hors grille = vide */
function boxPass(A,N,R,mode){
  const B=new Uint8Array(N*N),C=new Uint8Array(N*N);
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    let v=mode?0:1;
    for(let d=-R;d<=R;d++){
      const ii=i+d,x=(ii<0||ii>=N)?0:A[j*N+ii];
      if(mode){if(x){v=1;break}}else if(!x){v=0;break}
    }
    B[j*N+i]=v;
  }
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    let v=mode?0:1;
    for(let d=-R;d<=R;d++){
      const jj=j+d,x=(jj<0||jj>=N)?0:B[jj*N+i];
      if(mode){if(x){v=1;break}}else if(!x){v=0;break}
    }
    C[j*N+i]=v;
  }
  return C;
}
/* masque « intérieur » du modèle : empreinte fermée, trous remplis, îlots négligeables supprimés */
function footprintMask(G){
  const N=G.N,n=N*N;let A=new Uint8Array(n);
  for(let k=0;k<n;k++)if(G.fl[k]||G.wl[k]||G.cl[k])A[k]=1;
  A=boxPass(boxPass(A,N,FOOT_CLOSE,1),N,FOOT_CLOSE,0);
  const ext=new Uint8Array(n),q=new Int32Array(n);let h=0,t=0;
  const push=k=>{if(!A[k]&&!ext[k]){ext[k]=1;q[t++]=k}};
  for(let i=0;i<N;i++){push(i);push((N-1)*N+i);push(i*N);push(i*N+N-1)}
  while(h<t){const k=q[h++],i=k%N,j=(k/N)|0;if(i>0)push(k-1);if(i<N-1)push(k+1);if(j>0)push(k-N);if(j<N-1)push(k+N)}
  const ins=new Uint8Array(n);for(let k=0;k<n;k++)ins[k]=ext[k]?0:1;       // tout ce qui n'est pas « dehors » = dedans (trous inclus)
  /* composantes connexes : on garde les grandes */
  const lab=new Int32Array(n),sizes=[0];let nl=0;
  for(let s=0;s<n;s++){
    if(!ins[s]||lab[s])continue;
    nl++;let c=0;h=0;t=0;q[t++]=s;lab[s]=nl;
    while(h<t){const k=q[h++];c++;const i=k%N,j=(k/N)|0;
      for(const nk of [i>0?k-1:-1,i<N-1?k+1:-1,j>0?k-N:-1,j<N-1?k+N:-1]){if(nk>=0&&ins[nk]&&!lab[nk]){lab[nk]=nl;q[t++]=nk}}}
    sizes.push(c);
  }
  const mx=Math.max(0,...sizes);
  for(let k=0;k<n;k++)if(ins[k]&&sizes[lab[k]]<mx*KEEP_FRAC)ins[k]=0;
  return ins;
}
/* arêtes entre cases intérieures et extérieures, chaînées en boucles fermées de sommets [x,z] (m) */
function contourLoops(ins,N,half){
  const V=N+1,out=new Map(),add=(a,b)=>{let l=out.get(a);if(!l){l=[];out.set(a,l)}l.push(b)};
  const at=(i,j)=>(i<0||j<0||i>=N||j>=N)?0:ins[j*N+i];
  for(let j=0;j<N;j++)for(let i=0;i<N;i++){
    if(!ins[j*N+i])continue;
    if(!at(i,j-1))add(j*V+i,j*V+i+1);
    if(!at(i+1,j))add(j*V+i+1,(j+1)*V+i+1);
    if(!at(i,j+1))add((j+1)*V+i+1,(j+1)*V+i);
    if(!at(i-1,j))add((j+1)*V+i,j*V+i);
  }
  const loops=[],pt=v=>[-half+(v%V)*CELL,-half+((v/V)|0)*CELL];
  for(const s of out.keys()){
    const lst=out.get(s);
    while(lst.length){
      const loop=[s];let c=lst.pop(),g=0;
      while(c!==s&&g++<1e6){loop.push(c);const l2=out.get(c);if(!l2||!l2.length)break;c=l2.pop()}
      if(loop.length>=4)loops.push(loop.map(pt));
    }
  }
  return loops;
}
function rdp(p,tol){                                    // Douglas-Peucker (liste ouverte), sans récursion
  const n=p.length;if(n<3)return p.slice();
  const keep=new Uint8Array(n);keep[0]=keep[n-1]=1;const st=[[0,n-1]];
  while(st.length){
    const [a,b]=st.pop();let md=-1,mi=-1;
    const ax=p[a][0],az=p[a][1],ex=p[b][0]-ax,ez=p[b][1]-az,l2=ex*ex+ez*ez;
    for(let i=a+1;i<b;i++){
      let s=l2>1e-12?((p[i][0]-ax)*ex+(p[i][1]-az)*ez)/l2:0;s=s<0?0:s>1?1:s;
      const d=Math.hypot(p[i][0]-(ax+ex*s),p[i][1]-(az+ez*s));
      if(d>md){md=d;mi=i}
    }
    if(md>tol){keep[mi]=1;st.push([a,mi],[mi,b])}
  }
  return p.filter((_,i)=>keep[i]);
}
function simplifyLoop(p,tol){                           // boucle fermée : coupée en deux au point le plus éloigné du premier
  if(p.length<5)return p;
  let fi=0,fd=-1;for(let i=1;i<p.length;i++){const d=(p[i][0]-p[0][0])**2+(p[i][1]-p[0][1])**2;if(d>fd){fd=d;fi=i}}
  const a=rdp(p.slice(0,fi+1),tol),b=rdp(p.slice(fi).concat([p[0]]),tol);
  return a.slice(0,-1).concat(b.slice(0,-1));
}
/* plus haut sol praticable (<= FLOOR_TOP) de la case sous (x,z), 0 s'il n'y en a pas (la grille est déjà recalée à y=0) */
function floorTopAt(G,x,z){
  const k=gi(G,x,z);if(k<0)return 0;const a=G.fl[k];if(!a)return 0;
  let b=0;for(let i=0;i<a.length;i++)if(a[i]<=FLOOR_TOP&&a[i]>b)b=a[i];
  return b;
}
/* construit la zone jouable : G.ins / G.insSafe (masque), G.border (panneaux [x0,z0,x1,z1,haut]) et, si W est fourni, les triangles du mur.
   À appeler quand la grille G est recalée à y=0 (donc dans le callback extra de finishWorld, après shiftGrid). */
function buildZone(G,W){
  if(G.arenaDef){const nb=buildArenaZone(G,W,G.arenaDef);if(nb)return nb}       // (v12) arène circulaire ; sinon (centre inutilisable) on retombe sur le contour du modèle
  const N=G.N,half=G.half,ins=footprintMask(G);
  G.ins=ins;G.insSafe=boxPass(ins,N,1,1);                  // filet : masque élargi d'une case (le vrai mur reste le triangle)
  let sx=0,sz=0,cn=0;
  for(let k=0;k<N*N;k++)if(ins[k]){sx+=-half+((k%N)+.5)*CELL;sz+=-half+(((k/N)|0)+.5)*CELL;cn++}
  G.zc=cn?[sx/cn,sz/cn]:[0,0];G.zcount=cn;
  const border=[],loops=contourLoops(ins,N,half).map(l=>simplifyLoop(l,SIMPL));
  for(const L of loops){
    if(L.length<3)continue;
    for(let i=0;i<L.length;i++){
      const a=L[i],b=L[(i+1)%L.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(len<1e-3)continue;
      const np=Math.max(1,Math.ceil(len/PANEL));
      for(let p=0;p<np;p++){
        const x0=a[0]+(b[0]-a[0])*p/np,z0=a[1]+(b[1]-a[1])*p/np,x1=a[0]+(b[0]-a[0])*(p+1)/np,z1=a[1]+(b[1]-a[1])*(p+1)/np;
        const dx=(x1-x0)/(len/np),dz=(z1-z0)/(len/np);       // direction unitaire ; la normale (-dz,dx) / (dz,-dx) regarde de chaque côté
        let fy=0;
        for(let s=0;s<=4;s++){
          const mx=x0+(x1-x0)*s/4,mz=z0+(z1-z0)*s/4;
          for(const off of [.3,.8,-.3,-.8]){const f=floorTopAt(G,mx-dz*off,mz+dx*off);if(f>fy)fy=f}
        }
        border.push([x0,z0,x1,z1,fy]);
        if(W){const yb=WALL_LOW,yt=fy+WALL_H;
          addTri(W,x0,yb,z0,x1,yb,z1,x1,yt,z1);addTri(W,x0,yb,z0,x1,yt,z1,x0,yt,z0)}
      }
    }
  }
  G.border=border;
  return border.length;
}
/* le point (x,z) est-il dans la zone jouable (à toute hauteur) ? */
function inZone(G,x,z,y){
  if(!G.insSafe)return true;
  const k=gi(G,x,z);return k>=0&&G.insSafe[k]===1;
}
/* déplacement balayé : part de (x0,z0) (position valide) vers (x1,z1) par pas de 0,2 m ; pushXZ(move=true) à chaque pas.
   Résultat dans _wt {x,z,hit}. y = hauteur des pieds, rad = rayon du joueur. */
const _wt={x:0,z:0,hit:false,zone:false};
function walkTo(G,x0,z0,x1,z1,y,rad){
  const W=G.W;let x=x0,z=z0,hit=false,zn=false;
  const dx=x1-x0,dz=z1-z0,L=Math.hypot(dx,dz),n=Math.max(1,Math.ceil(L/.2)),sx=dx/n,sz=dz/n;
  for(let i=0;i<n;i++){
    let nx=x+sx,nz=z+sz;
    if(W&&pushXZ(W,nx,nz,rad,y,true)>0){nx=_o.x;nz=_o.z;hit=true}
    if(!inZone(G,nx,nz,y)){                                              // filet : jamais hors de la zone, à aucune hauteur
      hit=true;zn=true;
      if(inZone(G,nx,z,y))nz=z;else if(inZone(G,x,nz,y))nx=x;else{nx=x;nz=z}
    }
    if(W&&pushXZ(W,nx,nz,rad*.98,y,false)>0){hit=true;continue}           // résolution impossible ce pas-ci : on reste sur place
    x=nx;z=nz;
  }
  _wt.x=x;_wt.z=z;_wt.hit=hit;_wt.zone=zn;
  return _wt;
}
/* 8 points d'apparition, déterministes (identiques chez tous les joueurs), tous DANS la zone, à >= SPAWN_EDGE du mur, sur sol libre.
   Préférence pour le centre de la zone (duels rapprochés), puis répartition maximale. Renvoie null si aucun point valide. */
function computeSpawns(G,Mw){
  if(!G.ins)return null;
  const N=G.N,n=N*N,half=G.half,dist=new Int32Array(n).fill(-1),q=new Int32Array(n);let h=0,t=0;
  for(let k=0;k<n;k++)if(!G.ins[k]){dist[k]=0;q[t++]=k}                  // distance (en cases) au dehors
  while(h<t){const k=q[h++],i=k%N,j=(k/N)|0;
    for(const nk of [i>0?k-1:-1,i<N-1?k+1:-1,j>0?k-N:-1,j<N-1?k+N:-1])if(nk>=0&&dist[nk]<0){dist[nk]=dist[k]+1;q[t++]=nk}}
  const zc=G.zc||[0,0],W=G.W;
  const free=(x,z,y)=>{
    if(gridBlocked(G,x,z,y))return false;
    if(W&&pushXZ(W,x,z,1.1,y,false)>0)return false;                      // 1,1 m de dégagement autour du point
    for(let a=0;a<8;a++){const an=a*Math.PI/4;if(gridBlocked(G,x+Math.cos(an)*1.2,z+Math.sin(an)*1.2,y))return false}
    return true;
  };
  if(G.arena){                                                           // (v12) arène : équipe A (pairs) d'un côté, équipe B (impairs) en face, à 60 % du rayon
    const A=G.arena,rs=A.r*.6,out=[];
    const okAt=(x,z)=>{
      if(!inZone(G,x,z)||Math.hypot(x-A.cx,z-A.cz)>A.r-3.5)return false;
      const k=gi(G,x,z);if(k<0||!G.fl[k])return false;
      const y=gridGround(G,x,z,0);return Math.abs(y)<=1.5&&free(x,z,y);
    };
    for(let i=0;i<8;i++){
      const ang=((i&1)?0:Math.PI)+((i>>1)-1.5)*.5,tx0=A.cx+Math.cos(ang)*rs,tz0=A.cz+Math.sin(ang)*rs;let found=null;
      for(let r=0;r<=9&&!found;r+=.75)for(let a=0;a<(r?16:1)&&!found;a++){
        const an=a/16*Math.PI*2,x=tx0+Math.cos(an)*r,z=tz0+Math.sin(an)*r;
        if(okAt(x,z)&&!out.some(o=>Math.hypot(o[0]-x,o[1]-z)<2))found=[x,z];
      }
      if(!found){out.length=0;break}
      out.push(found);
    }
    if(out.length===8)return out.map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)]);
    console.warn('[maps] points d\'apparition d\'arène non trouvés : méthode générique');
  }
  const gather=(edgeCells,lvl)=>{
    const all=[];
    for(let k=0;k<n;k++){
      if(!G.ins[k]||dist[k]<edgeCells)continue;
      const i=k%N,j=(k/N)|0;if((i+j)%2)continue;
      const x=-half+(i+.5)*CELL,z=-half+(j+.5)*CELL;
      if(Math.abs(x)>Mw-5||Math.abs(z)>Mw-5||!inZone(G,x,z))continue;
      if(!G.fl[k])continue;
      const y=gridGround(G,x,z,0);                                           // hauteur que le moteur donnera réellement au joueur
      if(Math.abs(y)>lvl+.1||!free(x,z,y))continue;
      all.push([x,z,Math.hypot(x-zc[0],z-zc[1])]);
    }
    return all;
  };
  let all=[];
  for(const [e,lvl] of [[SPAWN_EDGE/CELL,.7],[SPAWN_EDGE/CELL*.7,.7],[SPAWN_EDGE/CELL*.5,1.2],[2,1.5]]){all=gather(Math.ceil(e),lvl);if(all.length>=8)break}
  if(!all.length)return null;
  let rz=0;for(const c of all)rz=Math.max(rz,c[2]);
  let cand=all.filter(c=>c[2]<=rz*.6);if(cand.length<4)cand=all.filter(c=>c[2]<=rz*.9);if(cand.length<4)cand=all;
  const pick=[cand.reduce((b,c)=>c[2]<b[2]?c:b,cand[0])];
  while(pick.length<8&&pick.length<cand.length){
    let b=null,bd=-1;
    for(const c of cand){let m=1e9;for(const p of pick)m=Math.min(m,(c[0]-p[0])**2+(c[1]-p[1])**2);if(m>bd){bd=m;b=c}}
    pick.push(b);
  }
  while(pick.length<8)pick.push(pick[pick.length%Math.max(1,cand.length)]);
  return pick.map(p=>[+p[0].toFixed(1),+p[1].toFixed(1)]);
}
/* ====== fin v7 ====== */

/* ====================================================================
   v12 — ARÈNE CIRCULAIRE (Crique) : on ne joue que dans un disque au centre de la map
   --------------------------------------------------------------------
   1. CENTRE   : le disque est placé là où il y a le plus de sol praticable (autour du centre du modèle) -> jamais dans l'eau / la falaise.
   2. ZONE     : masque « dans la zone » = disque (valable à toute hauteur, comme avant).
   3. MUR      : anneau de panneaux de COLLISION de 3 m (triangles ajoutés à W : bloque joueurs, balles, caméra).
   4. PALISSADE: mur visible en bois (planches + traverses + poteaux) posé exactement sur l'anneau.
   5. SPAWNS   : 8 points dans le disque, équipe A (indices pairs) d'un côté, équipe B (impairs) en face.
   ==================================================================== */
function pickArenaCenter(G,R){
  const N=G.N,half=G.half,lim=Math.max(0,half-R-1.5),good=new Uint8Array(N*N);
  for(let k=0;k<N*N;k++){const a=G.fl[k];if(a)for(let i=0;i<a.length;i++)if(a[i]>-.6&&a[i]<1.2){good[k]=1;break}}
  const Rc=Math.ceil(R/CELL);let best=null;
  for(let ox=-lim;ox<=lim+1e-6;ox+=2)for(let oz=-lim;oz<=lim+1e-6;oz+=2){
    let c=0,tot=0;
    for(let dj=-Rc;dj<=Rc;dj+=2)for(let di=-Rc;di<=Rc;di+=2){
      const dx=di*CELL,dz=dj*CELL;if(dx*dx+dz*dz>R*R)continue;
      tot++;const k=gi(G,ox+dx,oz+dz);if(k>=0&&good[k])c++;
    }
    const sc=c-6*Math.hypot(ox,oz);                          // un peu de préférence pour le vrai centre
    if(!best||sc>best.sc)best={sc,cx:ox,cz:oz,frac:tot?c/tot:0};
  }
  return best;
}
function buildArenaZone(G,W,A){
  const R=A.r,c=pickArenaCenter(G,R);
  if(!c||c.frac<.3){console.warn('[maps] centre de la map inutilisable pour l\'arène (sol '+(c?Math.round(c.frac*100):0)+' %) : contour du modèle utilisé');return 0}
  const N=G.N,half=G.half,ins=new Uint8Array(N*N),cx=c.cx,cz=c.cz;let cn=0;
  for(let k=0;k<N*N;k++){const x=-half+((k%N)+.5)*CELL,z=-half+(((k/N)|0)+.5)*CELL;if(Math.hypot(x-cx,z-cz)<=R){ins[k]=1;cn++}}
  G.ins=ins;G.insSafe=boxPass(ins,N,1,1);G.zc=[cx,cz];G.zcount=cn;G.arena={cx,cz,r:R,frac:c.frac};
  const K=Math.max(32,Math.ceil(2*Math.PI*R/2.5));
  const groundAround=(x,z,ux,uz)=>{let f=0;for(const off of [.3,.8,1.4])f=Math.max(f,floorTopAt(G,x-ux*off,z-uz*off));return f};
  for(let i=0;i<K;i++){
    const a0=i/K*Math.PI*2,a1=(i+1)/K*Math.PI*2,x0=cx+Math.cos(a0)*R,z0=cz+Math.sin(a0)*R,x1=cx+Math.cos(a1)*R,z1=cz+Math.sin(a1)*R;
    let fy=0;for(let s=0;s<=4;s++){const a=a0+(a1-a0)*s/4;fy=Math.max(fy,groundAround(cx+Math.cos(a)*R,cz+Math.sin(a)*R,Math.cos(a),Math.sin(a)))}
    if(W){const yb=WALL_LOW,yt=fy+WALL_H;addTri(W,x0,yb,z0,x1,yb,z1,x1,yt,z1);addTri(W,x0,yb,z0,x1,yt,z1,x0,yt,z0)}
  }
  G.border=[];
  return K;
}
/* palissade en bois visible (un seul mesh) */
function woodTex(){
  const S=256,cv=document.createElement('canvas');cv.width=cv.height=S;const x=cv.getContext('2d');
  let sd=777;const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296};
  const cols=['#8b5a2b','#7d4f25','#946133','#86552a'];
  x.fillStyle=cols[0];x.fillRect(0,0,S,S);
  for(let i=0;i<4;i++){x.fillStyle=cols[i];x.fillRect(i*S/4,0,S/4,S)}
  for(let i=0;i<70;i++){x.strokeStyle='rgba(40,22,8,'+(.12+rnd()*.2)+')';x.lineWidth=1+rnd()*1.5;const px=rnd()*S;x.beginPath();x.moveTo(px,0);x.bezierCurveTo(px+rnd()*8-4,S*.3,px+rnd()*8-4,S*.7,px+rnd()*6-3,S);x.stroke()}
  x.fillStyle='rgba(25,12,4,.75)';for(let i=0;i<=4;i++)x.fillRect(i*S/4-1.5,0,3,S);
  const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  try{t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy())}catch(e){}
  return t;
}
function buildFence(G){
  const A=G.arena;if(!A)return null;
  const P=[],Nn=[],U=[];
  /* boîte orientée : centre, demi-dimensions (hx le long de (ex,ez), hy vertical, hz perpendiculaire) */
  const box=(cx,cy,cz,hx,hy,hz,ex,ez)=>{
    const ax=[[ex,0,ez],[0,1,0],[-ez,0,ex]],h=[hx,hy,hz];
    for(let a=0;a<3;a++)for(const sg of [-1,1]){
      const b=(a+1)%3,c=(a+2)%3,n=ax[a].map(v=>v*sg);
      const cr=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([p,q])=>[0,1,2].map(i=>[cx,cy,cz][i]+n[i]*h[a]+ax[b][i]*h[b]*p+ax[c][i]*h[c]*q));
      const uv=[[0,0],[h[b]*2,0],[h[b]*2,h[c]*2],[0,h[c]*2]];
      for(const q of [0,1,2,0,2,3]){P.push(...cr[q]);Nn.push(...n);U.push(uv[q][0],uv[q][1])}
    }
  };
  const gnd=(x,z)=>{const ux=(x-A.cx)/A.r,uz=(z-A.cz)/A.r;let f=0;for(const off of [.2,.7,1.3])f=Math.max(f,floorTopAt(G,x-ux*off,z-uz*off));return f};
  const R=A.r,n=Math.round(2*Math.PI*R/.34),hsh=i=>{const v=Math.sin(i*12.9898)*43758.5453;return v-Math.floor(v)};
  /* planches verticales jointives */
  for(let i=0;i<n;i++){
    const th=(i+.5)/n*Math.PI*2,c=Math.cos(th),s=Math.sin(th),x=A.cx+c*R,z=A.cz+s*R,f=gnd(x,z),top=f+2.55+hsh(i)*.3,bot=f-.5;
    box(x,(top+bot)/2,z,(Math.PI*R/n)*.97,(top-bot)/2,.09,-s,c);
  }
  /* traverses horizontales côté intérieur */
  const m=Math.max(40,Math.round(2*Math.PI*R/1.6));
  for(let i=0;i<m;i++){
    const a0=i/m*Math.PI*2,a1=(i+1)/m*Math.PI*2,am=(a0+a1)/2,rr=R-.17,mx=A.cx+Math.cos(am)*rr,mz=A.cz+Math.sin(am)*rr;
    const x0=A.cx+Math.cos(a0)*rr,z0=A.cz+Math.sin(a0)*rr,x1=A.cx+Math.cos(a1)*rr,z1=A.cz+Math.sin(a1)*rr,L=Math.hypot(x1-x0,z1-z0);
    const f=Math.max(gnd(x0,z0),gnd(x1,z1));
    for(const hh of [.55,1.75])box(mx,f+hh,mz,L/2+.03,.09,.05,(x1-x0)/L,(z1-z0)/L);
  }
  /* gros poteaux avec chapeau, un tous les ~3 m */
  const pc=Math.max(12,Math.round(2*Math.PI*R/3));
  for(let i=0;i<pc;i++){
    const th=i/pc*Math.PI*2,c=Math.cos(th),s=Math.sin(th),x=A.cx+c*(R-.05),z=A.cz+s*(R-.05),f=gnd(x,z);
    box(x,f+1.65,z,.15,2.15,.15,-s,c);box(x,f+3.9,z,.21,.07,.21,-s,c);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(Nn,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));
  const mat=new THREE.MeshLambertMaterial({map:woodTex(),color:0xe0c8a8,side:THREE.DoubleSide});
  const m2=new THREE.Mesh(g,mat);m2.frustumCulled=false;m2.raycast=()=>{};
  return m2;
}
/* ====== fin v12 ====== */

/* ====== fin collision v7 ====== */

/* ---------------- grille de collision (pur, testable) ---------------- */
function makeGrid(half){
  const N=Math.ceil(half*2/CELL);
  return{N,half,fl:new Array(N*N),wl:new Array(N*N),cl:new Array(N*N),base:0};
}
const gi=(G,x,z)=>{const i=Math.floor((x+G.half)/CELL),j=Math.floor((z+G.half)/CELL);return(i<0||j<0||i>=G.N||j>=G.N)?-1:j*G.N+i};
function addFloor(G,x,z,y){
  const k=gi(G,x,z);if(k<0)return;let a=G.fl[k];
  if(!a){G.fl[k]=[y];return}
  for(let i=0;i<a.length;i++){if(Math.abs(a[i]-y)<.15){if(y>a[i])a[i]=y;return}}
  a.push(y);a.sort((p,q)=>p-q);if(a.length>8)a.splice(1,1);
}
/* plafonds / dessous de plateformes (faces tournées vers le bas) : empêchent de traverser une dalle par en dessous */
function addCeil(G,x,z,y){
  const k=gi(G,x,z);if(k<0)return;let a=G.cl[k];
  if(!a){G.cl[k]=[y];return}
  for(let i=0;i<a.length;i++){if(Math.abs(a[i]-y)<.15){if(y<a[i])a[i]=y;return}}
  a.push(y);a.sort((p,q)=>p-q);if(a.length>8)a.pop();
}
function addWall(G,x,z,y){
  const k=gi(G,x,z);if(k<0)return;let a=G.wl[k];
  if(!a){G.wl[k]=[y,y];return}
  for(let i=0;i<a.length;i+=2){if(y>=a[i]-.25&&y<=a[i+1]+.25){if(y<a[i])a[i]=y;if(y>a[i+1])a[i+1]=y;return}}
  if(a.length<12)a.push(y,y);
}
/* échantillonne un triangle (coordonnées monde) et remplit la grille ; renvoie le nombre d'échantillons "sol" */
function rasterTri(G,ax,ay,az,bx,by,bz,cx,cy,cz,hist){
  const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
  const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,nl=Math.hypot(nx,ny,nz);
  if(nl<1e-9)return;
  const nyn=ny/nl;
  const ceil=nyn<-.5;                                      // face tournée vers le bas (plafond / dessous de dalle)
  const wall=!ceil&&nyn<.5;                                       // pente raide = mur
  const e=Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz),Math.hypot(cx-bx,cy-by,cz-bz));
  const n=Math.max(1,Math.ceil(e/(CELL*.6)));
  for(let i=0;i<=n;i++)for(let j=0;j<=n-i;j++){
    const s=n?i/n:0,t=n?j/n:0;
    const x=ax+ux*s+vx*t,y=ay+uy*s+vy*t,z=az+uz*s+vz*t;
    if(ceil)addCeil(G,x,z,y);
    else if(wall)addWall(G,x,z,y);
    else{addFloor(G,x,z,y);if(hist){const b=Math.round(y*4);hist[b]=(hist[b]||0)+1;const sm=hist.sum||(hist.sum={});sm[b]=(sm[b]||0)+y}}
  }
}
function shiftGrid(G,dy){
  for(const a of G.fl)if(a)for(let i=0;i<a.length;i++)a[i]+=dy;
  for(const a of G.wl)if(a)for(let i=0;i<a.length;i++)a[i]+=dy;
  for(const a of G.cl)if(a)for(let i=0;i<a.length;i++)a[i]+=dy;
}
/* hauteur du sol sous (x,z) pour un joueur à la hauteur y */
/* une dalle (dessous c, dessus f) située au-dessus du joueur ne doit pas être traversée par en dessous */
function underSlab(c,y,f){for(let i=0;i<c.length;i++)if(c[i]>y+.4&&c[i]<=f+.05&&f-c[i]<1.2)return true;return false}
function gridGround(G,x,z,y,lim){
  if(G.W){const L0=lim===undefined?y+STEP:lim,b=groundFoot(G.W,x,z,L0,y,.2);return b===-Infinity?G.base:b}   // v6 : triangles exacts
  const k=gi(G,x,z);if(k<0)return G.base;
  const a=G.fl[k];if(!a)return G.base;
  const L=lim===undefined?y+STEP:lim,c=G.cl&&G.cl[k];
  let g=null;for(let i=0;i<a.length;i++){
    if(a[i]>L)break;
    if(c&&a[i]>y+.4&&underSlab(c,y,a[i]))continue;         // dessous d'une plateforme : on ne "monte" pas à travers
    g=a[i];
  }
  return g===null?a[0]:g;                                  // sous une plateforme / aucun sol atteignable -> sol le plus bas
}
/* le corps d'un joueur à (x,z,y) est-il bloqué ? */
function gridBlocked(G,x,z,y){
  const k=gi(G,x,z);if(k<0)return true;
  if(G.W)return pushXZ(G.W,x,z,.05,y,false)>0;                // v6 : murs, conteneurs, plafonds, dessus de caisses
  const w=G.wl[k];
  if(w)for(let i=0;i<w.length;i+=2)if(w[i+1]>y+STEP&&w[i]<y+BODY)return true;
  const a=G.fl[k];
  if(a)for(let i=0;i<a.length;i++)if(a[i]>y+STEP&&a[i]<y+BODY)return true;
  const c=G.cl&&G.cl[k];                                    // plafond trop bas pour passer
  if(c)for(let i=0;i<c.length;i++)if(c[i]>y+.5&&c[i]<y+BODY-.25)return true;
  return false;
}
/* point (x,y,z) à l'intérieur de la matière ? (rayons de visée / lignes de vue) */
function gridSolid(G,x,y,z){
  const k=gi(G,x,z);if(k<0)return false;
  const w=G.wl[k];
  if(w)for(let i=0;i<w.length;i+=2)if(y>=w[i]-.15&&y<=w[i+1]+.15)return true;
  const a=G.fl[k];
  if(a)for(let i=0;i<a.length;i++)if(a[i]>y&&a[i]-y<.6)return true;
  return false;
}
window.__PVPGRID={makeGrid,rasterTri,shiftGrid,gridGround,gridBlocked,gridSolid,addFloor,addWall};


/* ---------------- zone jouable (v7) : voir collision_2.js (buildZone / inZone / computeSpawns / walkTo) ---------------- */
/* mur visible : panneaux de 3 m (rayures rouges + « ZONE INTERDITE ») qui suivent exactement le contour du modèle 3D */
function barrierTex(){
  const S=512,c=document.createElement('canvas');c.width=c.height=S;const x=c.getContext('2d');
  x.clearRect(0,0,S,S);
  /* rayures diagonales */
  x.save();x.beginPath();x.rect(0,0,S,S);x.clip();
  x.fillStyle='rgba(220,20,20,.40)';x.fillRect(0,0,S,S);
  x.fillStyle='rgba(120,0,0,.55)';
  const W=64;for(let k=-S;k<S*2;k+=W*2){x.beginPath();x.moveTo(k,S);x.lineTo(k+W,S);x.lineTo(k+W+S,0);x.lineTo(k+S,0);x.closePath();x.fill()}
  x.restore();
  /* panneau d'interdiction */
  const cx=S/2,cy=170,r=92;
  x.fillStyle='rgba(255,255,255,.95)';x.beginPath();x.arc(cx,cy,r,0,Math.PI*2);x.fill();
  x.strokeStyle='#e11d1d';x.lineWidth=24;x.beginPath();x.arc(cx,cy,r-12,0,Math.PI*2);x.stroke();
  x.lineCap='round';x.beginPath();x.moveTo(cx-r*.62,cy-r*.62);x.lineTo(cx+r*.62,cy+r*.62);x.stroke();
  /* texte */
  x.textAlign='center';x.textBaseline='middle';x.font='900 66px Inter,Arial,sans-serif';
  x.lineWidth=10;x.strokeStyle='rgba(60,0,0,.9)';x.strokeText('ZONE',cx,330);x.strokeText('INTERDITE',cx,405);
  x.fillStyle='#fff';x.fillText('ZONE',cx,330);x.fillText('INTERDITE',cx,405);
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  try{t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy())}catch(e){}
  return t;
}
function buildBarrier(G){
  if(G.arena)return buildFence(G);                          // (v12) arène : palissade en bois
  if(!G.border||!G.border.length)return null;
  const t=barrierTex(),pos=[],uv=[],idx=[];let u=0;
  for(const b of G.border){
    const x0=b[0],z0=b[1],x1=b[2],z1=b[3],yb=b[4],yt=b[4]+WALL_H,len=Math.hypot(x1-x0,z1-z0),i=pos.length/3,du=len/WALL_H;
    pos.push(x0,yb,z0,x1,yb,z1,x1,yt,z1,x0,yt,z0);uv.push(u,0,u+du,0,u+du,1,u,1);idx.push(i,i+1,i+2,i,i+2,i+3);u+=du;
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);
  const mat=new THREE.MeshBasicMaterial({map:t,transparent:true,side:THREE.DoubleSide,depthWrite:false,fog:false});
  const m=new THREE.Mesh(geo,mat);m.frustumCulled=false;m.raycast=()=>{};m.renderOrder=5;
  return m;
}

/* ---------------- état ---------------- */
let CUR='ville',busy=false,launchEnd=0,G=null,group=null,proxy=null,gnd=null,cityGround=null,bar=null;
/* ---------------- sol texturé (remplace le sol noir de la ville quand une map PvP est active) ---------------- */
const GROUNDS={
  cove:    {tile:32,cols:['#8a7d5a','#80744f','#93865f','#867a54'],spk:'#6b6045',spkN:.05,m:4},   // (v10) sable assombri : le sol était blanc éblouissant
  warzone: {tile:32,cols:['#4a4940','#52514a','#45443c'],line:'#33322c',m:4},
  def:   {tile:32,cols:['#6b7280','#737a88','#646b78'],line:'#4b5563',m:4}
};
function makeGroundTex(id){
  const g=GROUNDS[id]||GROUNDS.def,S=256,c=document.createElement('canvas');c.width=c.height=S;
  const x=c.getContext('2d');let sd=12345+id.length*77;const rnd=()=>{sd=(sd*1664525+1013904223)>>>0;return sd/4294967296};
  const T=g.tile;
  for(let j=0;j<S/T;j++)for(let i=0;i<S/T;i++){x.fillStyle=g.cols[(rnd()*g.cols.length)|0];x.fillRect(i*T,j*T,T,T)}
  if(g.spk){const n=Math.floor(S*S/(T*T)*g.spkN*40);x.fillStyle=g.spk;for(let q=0;q<n;q++){const s=Math.max(2,T/8|0);x.fillRect((rnd()*S/s|0)*s,(rnd()*S/s|0)*s,s,s)}}
  if(g.line){x.strokeStyle=g.line;x.lineWidth=2;
    for(let k=0;k<=S;k+=T){x.beginPath();x.moveTo(k,0);x.lineTo(k,S);x.stroke();x.beginPath();x.moveTo(0,k);x.lineTo(S,k);x.stroke()}}
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;
  t.magFilter=THREE.LinearFilter;
  try{t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy())}catch(e){}
  return t;
}
function addGround(id){
  removeGround();
  const g=GROUNDS[id]||GROUNDS.def,size=SPAN*3,tex=makeGroundTex(id);tex.repeat.set(size/(g.m*4),size/(g.m*4));
  const m=new THREE.Mesh(new THREE.PlaneGeometry(size,size).rotateX(-Math.PI/2),
    new THREE.MeshLambertMaterial({map:tex,color:0x9a9a9a,polygonOffset:true,polygonOffsetFactor:2,polygonOffsetUnits:2}));
  m.position.y=-.06;m.receiveShadow=true;m.raycast=()=>{};scene.add(m);gnd=m;
  /* le sol d'origine (asphalte sombre) est caché pendant la map */
  if(!cityGround)scene.traverse(o=>{if(!cityGround&&o.isMesh&&o.geometry&&o.geometry.type==='PlaneGeometry'&&o.geometry.parameters&&o.geometry.parameters.width===M*2+80)cityGround=o});
  if(cityGround)cityGround.visible=false;
}
function removeGround(){
  if(gnd){scene.remove(gnd);safe(()=>{gnd.geometry.dispose();gnd.material.map&&gnd.material.map.dispose();gnd.material.dispose()});gnd=null}
}

let saved=null;                       // état de la ville d'origine (collisions, meshes) pendant qu'une autre map est active
const orig={groundAt:groundAt,pushBoxes:pushBoxes,spotFree:spotFree};
const lastOK=new WeakMap();let warnT=0,fallFrom=-1e9,stuckN=0;

function hideCity(on){
  if(on){
    if(!saved)saved={boxes:boxes,solid:solidMeshes,vis:solidMeshes.map(m=>[m,m.visible]),city:ASSET&&ASSET.city?ASSET.city.visible:true,
      brk:(typeof breakables!=='undefined'?breakables:[]).map(o=>[o,o.g?o.g.visible:true])};
    if(ASSET&&ASSET.city)ASSET.city.visible=false;
    saved.vis.forEach(p=>{p[0].visible=false});saved.brk.forEach(p=>{if(p[0].g)p[0].g.visible=false});
    boxes=[];solidMeshes=[];
  }else if(saved){
    boxes=saved.boxes;solidMeshes=saved.solid;
    if(ASSET&&ASSET.city)ASSET.city.visible=saved.city;
    saved.vis.forEach(p=>{p[0].visible=p[1]});saved.brk.forEach(p=>{if(p[0].g)p[0].g.visible=p[1]});
    saved=null;
  }
}
function disposeMap(){
  if(group){
    scene.remove(group);
    group.traverse(o=>{if(o.isMesh){safe(()=>o.geometry.dispose());[].concat(o.material).forEach(m=>{if(!m)return;
      ['map','normalMap','emissiveMap','roughnessMap','metalnessMap','aoMap','alphaMap'].forEach(k=>{if(m[k])safe(()=>m[k].dispose())});safe(()=>m.dispose())})}});
    group=null;
  }
  G=null;proxy=null;removeGround();
  if(bar){scene.remove(bar);safe(()=>{bar.geometry.dispose();bar.material.map&&bar.material.map.dispose();bar.material.dispose()});bar=null}
}
/* (v12) BUG VÉHICULES : la BMW / l'hélico de la ville gardaient leur boîte de collision (et leur modèle) à leur place de la ville, donc DANS la map PvP.
   On les gare très loin, invisibles, sans boîte de collision, et on empêche d'y monter. startGame() (index.html) les remet en place via reset() au retour en ville. */
function parkVeh(on){
  safe(()=>{
    const V=window.VEH;if(!V||!V.car)return;
    if(on&&V.cur)safe(()=>window.vehToggle&&window.vehToggle());
    for(const v of [V.car,V.heli]){
      if(!v)continue;
      v.root.visible=!on;
      if(on){v.x=v.z=1e5;v.v=0;v.vx=v.vz=v.vy=0;v.root.position.set(v.x,v.y||0,v.z)}
      if(v.box){const i=boxes.indexOf(v.box);if(on){v.box.x=v.box.z=1e5;if(i>=0)boxes.splice(i,1)}}
    }
  });
}
const purgeVehBoxes=()=>{for(let i=boxes.length-1;i>=0;i--)if(boxes[i]&&boxes[i].veh)boxes.splice(i,1)};
function restoreCity(){
  if(CUR==='ville'&&!G)return;
  parkVeh(false);
  disposeMap();hideCity(false);if(cityGround)cityGround.visible=true;
  groundAt=orig.groundAt;pushBoxes=orig.pushBoxes;spotFree=orig.spotFree;window.__MAPSPAWN=null;
  CUR='ville';safe(()=>setLight(1));
}

/* ---------------- chargement d'un .glb ---------------- */
const DRACO_PATH='https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/';
const loadScript=src=>new Promise((res,rej)=>{
  const s=document.createElement('script');s.src=src;s.onload=res;s.onerror=()=>rej(new Error('script '+src));document.head.appendChild(s);
});
let decP=null;
/* décodeurs Draco / Meshopt (beaucoup de .glb lourds sont compressés ; sans eux le chargement échoue en silence) */
function ensureDecoders(){
  if(decP)return decP;
  decP=(async()=>{
    if(!THREE.DRACOLoader)await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/DRACOLoader.js').catch(e=>console.warn('[maps]',e.message));
    if(typeof MeshoptDecoder==='undefined')await loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/meshopt_decoder.js').catch(e=>console.warn('[maps]',e.message));
  })();
  return decP;
}
function makeLoader(){
  const L=new THREE.GLTFLoader();
  safe(()=>{if(THREE.DRACOLoader){const d=new THREE.DRACOLoader();d.setDecoderPath(DRACO_PATH);L.setDRACOLoader(d)}});
  safe(()=>{if(typeof MeshoptDecoder!=='undefined'&&L.setMeshoptDecoder)L.setMeshoptDecoder(MeshoptDecoder)});
  return L;
}
/* télécharge une URL en ArrayBuffer avec progression ; lève une erreur EXPLICITE (404, HTML de repli, ...) */
async function getBuf(url,onProg){
  let r=await fetch(url);
  if(!r.ok)r=await fetch(url,{cache:'reload'});   // un 404 gardé en cache par le navigateur ne doit pas bloquer : on réessaie en ignorant le cache
  if(!r.ok)throw new Error('HTTP '+r.status+' (fichier absent à cet endroit)');
  const ct=(r.headers.get('content-type')||'').toLowerCase();
  const total=+r.headers.get('content-length')||0;
  let buf;
  if(r.body&&r.body.getReader&&total){
    const rd=r.body.getReader(),parts=[];let got=0;
    for(;;){const {done,value}=await rd.read();if(done)break;parts.push(value);got+=value.length;onProg&&onProg(got/total)}
    buf=new Uint8Array(got);let o=0;for(const p of parts){buf.set(p,o);o+=p.length}buf=buf.buffer;
  }else buf=await r.arrayBuffer();
  const h=new Uint8Array(buf,0,Math.min(4,buf.byteLength));
  const magic=String.fromCharCode(...h);
  if(magic!=='glTF'){
    if(/html/.test(ct)||magic==='<!DO'||magic==='<htm')throw new Error('le serveur a renvoyé une page HTML (fichier absent / redirection)');
    if(buf.byteLength<200)throw new Error('fichier vide ou corrompu ('+buf.byteLength+' octets)');
    throw new Error('ce n\'est pas un .glb binaire (en-tête « '+magic+' »)');
  }
  return buf;
}
const parseGLB=buf=>new Promise((res,rej)=>makeLoader().parse(buf,'',res,e=>rej(new Error('lecture du .glb impossible : '+(e&&e.message||e)))));
/* essaie chaque dossier ; renvoie le gltf ou lève une erreur qui liste TOUTES les raisons */
async function fetchGLB(files,onProg){
  if(!THREE.GLTFLoader)throw new Error('GLTFLoader indisponible');
  await ensureDecoders();
  const why=[];
  for(const file of [].concat(files)){
    for(const b of BASES){
      const url=b+file;
      try{
        const buf=await getBuf(encodeURI(url),onProg);
        return await parseGLB(buf);                // fichier trouvé : si la lecture échoue, on le dit (inutile d'essayer les autres noms)
      }catch(e){
        const m=e&&e.message||String(e);
        why.push(url+' → '+m);
        if(/lecture du \.glb/.test(m)){const err=new Error(why.join('\n'));err.why=why;throw err}
      }
    }
  }
  const err=new Error(why.join('\n'));err.why=why;throw err;
}
const tick=()=>new Promise(r=>setTimeout(r,0));
async function buildMap(def,onProg,onStage){
  onStage&&onStage('Téléchargement…');
  const gltf=await fetchGLB(def.files,onProg);
  onStage&&onStage('Préparation de la map…');
  const sc=gltf.scene;
  sc.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=true;o.frustumCulled=true}});
  safe(()=>toLambert(sc,{cast:false}));
  sc.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(sc),size=box.getSize(new THREE.Vector3()),ctr=box.getCenter(new THREE.Vector3());
  /* (v10) SOL TROP BLANC / ÉBLOUISSANT : ce n'est pas la lumière mais la couleur du sol. Les grandes surfaces plates et basses (ou nommées sol/sable/herbe…)
     voient leur couleur multipliée par FLOOR_DARK (0 = noir, 1 = inchangé). Matériau Lambert = aucun reflet spéculaire. */
  safe(()=>{
    const W=Math.max(size.x,size.z,1e-3),lowY=box.min.y+size.y*.35,v=new THREE.Vector3(),bb=new THREE.Box3();
    sc.traverse(n=>{
      if(!n.isMesh||!n.material||!n.material.color)return;
      bb.setFromObject(n);bb.getSize(v);const w=Math.max(v.x,v.z);
      const nm=(n.name||'')+' '+(n.material.name||'');
      if((w>W*.12&&v.y<w*.12&&bb.max.y<lowY)||/floor|ground|sol\b|sand|sable|terrain|dirt|grass|herbe|road|path/i.test(nm))n.material.color.multiplyScalar(FLOOR_DARK);
    });
  });
  const k=SPAN*(def.zoom||1)/Math.max(size.x,size.z,1e-3);   // zoom : taille du décor par rapport au personnage
  const grp=new THREE.Group();grp.add(sc);
  grp.scale.setScalar(k);grp.position.set(-ctr.x*k,-box.min.y*k,-ctr.z*k);
  grp.updateMatrixWorld(true);
  /* grille */
  const Gr=makeGrid(SPAN/2+4),hist={};let W=null;if(def.arena)Gr.arenaDef=def.arena;try{W=makeWorld(SPAN/2+4)}catch(e){W=null}
  const va=new THREE.Vector3(),vb=new THREE.Vector3(),vc=new THREE.Vector3();
  const meshes=[];sc.traverse(o=>{
    if(!o.isMesh||!o.geometry||!o.geometry.attributes.position)return;
    if(/sky|cloud|ciel|nuage|glass|verre|water|eau\b/i.test(o.name||''))return;
    const mt=[].concat(o.material)[0];if(mt&&mt.transparent&&mt.opacity<.25)return;         // quasi invisible seulement (v6 : les conteneurs néon semi-transparents gardent leur collision)
    meshes.push(o);
  });
  let t0=performance.now();
  for(const m of meshes){
    const pos=m.geometry.attributes.position,idx=m.geometry.index,mw=m.matrixWorld,cnt=idx?idx.count:pos.count;
    for(let f=0;f<cnt;f+=3){
      const i0=idx?idx.getX(f):f,i1=idx?idx.getX(f+1):f+1,i2=idx?idx.getX(f+2):f+2;
      va.fromBufferAttribute(pos,i0).applyMatrix4(mw);vb.fromBufferAttribute(pos,i1).applyMatrix4(mw);vc.fromBufferAttribute(pos,i2).applyMatrix4(mw);
      rasterTri(Gr,va.x,va.y,va.z,vb.x,vb.y,vb.z,vc.x,vc.y,vc.z,hist);
      if(W)addTri(W,va.x,va.y,va.z,vb.x,vb.y,vb.z,vc.x,vc.y,vc.z);
      if(performance.now()-t0>14){await tick();t0=performance.now()}
    }
  }
  /* niveau du sol principal = la plus basse tranche de hauteur qui représente au moins 6 % de la surface praticable */
  let tot=0;for(const b in hist)if(b!=='sum')tot+=hist[b];
  const bins=Object.keys(hist).filter(b=>b!=='sum').map(Number).sort((a,b)=>a-b);let base=0;
  for(const b of bins){if(hist[b]>=tot*.06){base=hist.sum&&hist.sum[b]?hist.sum[b]/hist[b]:b/4;break}}   // moyenne réelle des hauteurs du sol (et non la case arrondie à 25 cm : c'est ce qui enfonçait les joueurs)
  let shifted=false;
  await tick();
  if(W){try{finishWorld(W,(w,b)=>{shiftGrid(Gr,-b);shifted=true;buildZone(Gr,w)});base=W.base}catch(e){console.warn('[maps] collision exacte indisponible, grille utilisée',e);W=null}}
  if(!shifted){shiftGrid(Gr,-base);buildZone(Gr,null)}
  grp.position.y-=base;Gr.base=0;Gr.vis=null;
  const bar=buildBarrier(Gr);
  if(W)Gr.W=W;                                                   // à partir d'ici : collisions exactes (triangles + mur de bordure)
  await tick();
  Gr.spawns=computeSpawns(Gr,M);
  return{grp,Gr,k,bar};
}

/* ---------- rebord attrapable (grimpe / traction) ---------- */
window.__PVPQ={ledge(px,py,pz,fx,fz){
  const R0=.9,R1=2.6,DS=[.45,.7,.95];
  if(G){
    if(!gridBlocked(G,px+fx*.4,pz+fz*.4,py))return null;                                  // pas de mur devant
    for(const d of DS){
      const x=px+fx*d,z=pz+fz*d,k=gi(G,x,z);if(k<0)continue;const a=G.fl[k];if(!a)continue;
      for(const f of a){
        if(f<py+R0||f>py+R1||gridBlocked(G,x,z,f))continue;
        const x2=px+fx*(d+.45),z2=pz+fz*(d+.45),k2=gi(G,x2,z2),a2=k2>=0&&G.fl[k2];
        if(!a2||!a2.some(f2=>Math.abs(f2-f)<.25)||gridBlocked(G,x2,z2,f)||!inZone(G,x2,z2))continue;
        return{top:f,hx:px+fx*Math.max(0,d-.7),hz:pz+fz*Math.max(0,d-.7),lx:x2,lz:z2};
      }
    }
    return null;
  }
  for(const b of boxes){
    if(b.top<py+R0||b.top>py+R1)continue;
    for(const d of DS){
      const x=px+fx*d,z=pz+fz*d,x2=px+fx*(d+.45),z2=pz+fz*(d+.45);
      if(Math.abs(x-b.x)>b.hx||Math.abs(z-b.z)>b.hz)continue;
      if(Math.abs(x2-b.x)>b.hx||Math.abs(z2-b.z)>b.hz)continue;
      return{top:b.top,hx:px+fx*Math.max(0,d-.7),hz:pz+fz*Math.max(0,d-.7),lx:x2,lz:z2};
    }
  }
  return null;
}};
/* lumière : -25 % dans les maps PvP (ciel + lune). applyNight() (index.html) relit window.__LIGHTK à chaque appel. */
const PVP_LIGHT=.75;
const FLOOR_DARK=.55;      // (v10) assombrissement du sol des maps PvP (baisse cette valeur pour un sol encore plus sombre)
function setLight(k){
  const u=scene.userData,r=k/(window.__LIGHTK||1);window.__LIGHTK=k;
  if(u.hemi)u.hemi.intensity*=r;
  if(u.moon)u.moon.intensity*=r;
}
function activate(def,built){
  disposeMap();hideCity(true);safe(()=>setLight(PVP_LIGHT));
  group=built.grp;G=built.Gr;scene.add(group);addGround(def.id);if(built.bar){bar=built.bar;scene.add(bar)}
  /* hit-tests / lignes de vue : objet "solide" virtuel qui lit la grille (pas de raycast sur 600 000 triangles) */
  proxy=new THREE.Object3D();proxy.userData.pvpGrid=true;
  proxy.raycast=function(rc,out){
    if(G.W){const o=rc.ray.origin,d=rc.ray.direction,h=rayHit(G.W,o.x,o.y,o.z,d.x,d.y,d.z,Math.min(rc.far||100,150),Math.max(.05,rc.near||0));
      if(h)out.push({distance:h.t,point:new THREE.Vector3(o.x+d.x*h.t,o.y+d.y*h.t,o.z+d.z*h.t),object:proxy,face:null});return}
    const o=rc.ray.origin,d=rc.ray.direction,far=Math.min(rc.far||100,150);
    for(let t=Math.max(.05,rc.near||0);t<far;t+=.25){
      const x=o.x+d.x*t,y=o.y+d.y*t,z=o.z+d.z*t;
      if(gridSolid(G,x,y,z)){out.push({distance:t,point:new THREE.Vector3(x,y,z),object:proxy,face:null});return}
    }
  };
  scene.add(proxy);solidMeshes.push(proxy);
  groundAt=function(x,z,y){
    const pp=player.pos,isP=Math.abs(x-pp.x)<1e-6&&Math.abs(z-pp.z)<1e-6&&Math.abs(y-pp.y)<1e-6;
    purgeVehBoxes();
    const lim=(isP?Math.max(y,fallFrom):y)+STEP;               // chute rapide / FPS bas : on ne traverse plus un sol en un seul pas
    let g=gridGround(G,x,z,y,lim);
    for(const b of boxes)if(Math.abs(x-b.x)<b.hx+.15&&Math.abs(z-b.z)<b.hz+.15&&b.top<=y+.35&&b.top>g)g=b.top;
    if(Math.abs(g)<.2)g=0;                                     // sol principal : toujours exactement à 0 (pas d'enfoncement)
    if(isP&&!window.__CLIMBING&&player.vy>0&&!grounded){       // tête contre un plafond en sautant
      const k=gi(G,x,z),c=k>=0&&G.cl[k];
      if(c)for(let i=0;i<c.length;i++){if(c[i]>y+1.0&&c[i]<y+1.8){pp.y=c[i]-1.8;player.vy=Math.min(player.vy,0);break}}
    }
    return g;
  };
  pushBoxes=function(p,rad,y,climb){
    purgeVehBoxes();
    orig.pushBoxes(p,rad,y,climb);                                                        // anciens obstacles (tonneaux…) + limites du monde
    if(!G)return;
    const isP=(p===player.pos);if(isP)fallFrom=y;
    if(isP&&window.__CLIMBING)return;                                                     // grimpe en cours : pilotée par le mouvement
    const prev=lastOK.get(p);let x0=p.x,z0=p.z;
    if(prev&&Math.hypot(p.x-prev.x,p.z-prev.z)<8){x0=prev.x;z0=prev.z}                    // >= 8 m = téléportation (réapparition) : pas de balayage
    const r=walkTo(G,x0,z0,p.x,p.z,y,rad);                                                // balayage par pas de 0,2 m + pushXZ à chaque pas : on glisse, on ne traverse jamais
    p.x=r.x;p.z=r.z;
    if(isP&&r.zone&&performance.now()-warnT>1500){warnT=performance.now();safe(()=>toast('⛔ Zone interdite','#f87171'))}
    if(isP&&G.W){                                                                         // coincé dans une fente plus étroite que le joueur : on le dégage
      if(pushXZ(G.W,p.x,p.z,rad*.98,y,false)>0){if(++stuckN>25){stuckN=0;unstick(p,rad,y)}}else stuckN=0;
    }
    if(!prev)lastOK.set(p,{x:p.x,z:p.z});else{prev.x=p.x;prev.z=p.z}
  };
  spotFree=function(x,z,r){
    if(!G||Math.abs(x)>M-3||Math.abs(z)>M-3)return false;
    const g=gridGround(G,x,z,0);if(Math.abs(g)>.7||!inZone(G,x,z,0))return false;                             // seulement sur le sol principal
    for(let a=0;a<8;a++){const an=a*Math.PI/4;for(const rr of [r*.5,r]){if(gridBlocked(G,x+Math.cos(an)*rr,z+Math.sin(an)*rr,0))return false}}
    return !gridBlocked(G,x,z,0);
  };
  window.__MAPSPAWN=G.spawns||null;
  CUR=def.id;
}

/* ---------------- tirage au sort animé ---------------- */
function roulette(target,seedStart,loadP){
  return new Promise(resolve=>{
    const N=MAPS.length,el=document.createElement('div');
    el.style.cssText='position:fixed;inset:0;z-index:200;background:radial-gradient(ellipse at 50% 40%,rgba(30,10,10,.92),rgba(3,4,9,.97));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;color:#fff;font-family:Inter,system-ui,sans-serif;padding:16px;opacity:0;transition:opacity .25s';
    el.innerHTML='<div style="font:900 clamp(18px,3.4vw,34px)/1 Inter,system-ui,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#fbbf24">Tirage de la map</div>'+
      '<div id="mp-row" style="display:flex;flex-wrap:wrap;justify-content:center;gap:12px;max-width:94vw">'+
      MAPS.map((m,i)=>'<div class="mp-c" data-i="'+i+'" style="width:clamp(92px,15vw,150px);padding:14px 8px;border-radius:16px;text-align:center;background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.14);transition:transform .08s,background .08s,border-color .08s,box-shadow .08s;opacity:.55">'+
        '<div style="font-size:clamp(30px,5vw,52px)">'+m.emoji+'</div><div style="margin-top:6px;font-weight:800;font-size:clamp(11px,1.5vw,15px);text-transform:uppercase">'+m.name+'</div></div>').join('')+'</div>'+
      '<div id="mp-res" style="min-height:2.4em;font:900 clamp(16px,2.6vw,28px) Inter,system-ui,sans-serif;text-align:center"></div>'+
      '<div id="mp-load" style="font:600 13px Inter,system-ui,sans-serif;color:#94a3b8;min-height:1.2em"></div>';
    document.body.appendChild(el);requestAnimationFrame(()=>el.style.opacity=1);
    const cards=[...el.querySelectorAll('.mp-c')],res=el.querySelector('#mp-res'),ld=el.querySelector('#mp-load');
    const paint=(i,final)=>cards.forEach((c,k)=>{
      const on=k===i;c.style.opacity=on?1:.4;c.style.transform=on?(final?'scale(1.18)':'scale(1.08)'):'scale(1)';
      c.style.background=on?(final?'rgba(251,191,36,.25)':'rgba(255,255,255,.18)'):'rgba(255,255,255,.06)';
      c.style.borderColor=on?(final?'#fbbf24':'#fff'):'rgba(255,255,255,.14)';
      c.style.boxShadow=on&&final?'0 0 40px rgba(251,191,36,.6)':'none';
    });
    const steps=N*3+((target-seedStart+N)%N);let n=0,idx=seedStart;
    const run=()=>{
      paint(idx,false);res.textContent='';
      if(n>=steps){
        paint(idx,true);res.innerHTML='🗺 MAP : <span style="color:#fbbf24">'+MAPS[idx].name+'</span>';
        try{SFX.level&&SFX.level()}catch(_){}
        loadP.then(()=>{setTimeout(()=>{el.style.opacity=0;setTimeout(()=>{el.remove();resolve()},260)},900)});
        return;
      }
      try{SFX.wall&&n%2===0&&SFX.wall()}catch(_){}
      const u=n/steps,wait=55+330*u*u*u;n++;idx=(idx+1)%N;
      setTimeout(run,wait);
    };
    el._ld=t=>{ld.textContent=t||''};
    window.__mpOverlay=el;run();
  });
}

/* ---------------- (v11) PRÉCHARGEMENT : la map tirée est construite pendant le matchmaking ----------------
   L'hôte annonce la graine avant le départ ; tout le monde construit la même map en arrière-plan.
   startGame() réutilise ensuite la map déjà prête (sinon il la construit comme avant). */
const PRE={};
/* (v12) BUG CORRIGÉ : seed*2654435761 dépasse 2^53 en JS -> les bits de poids faible étaient perdus -> toujours MAPS[0] (la Crique).
   Math.imul reste exact sur 32 bits, et on lit les bits de poids FORT (les mieux mélangés). */
const mapIdx=seed=>(Math.imul(seed>>>0,2654435761)>>>15)%MAPS.length;
const mapForSeed=seed=>MAPS[mapIdx(seed)];
async function takePre(d){const e=PRE[d.id];if(!e)return null;delete PRE[d.id];try{return e.b||await e.p}catch(_){return null}}
function prefetch(seed){
  const d=mapForSeed(seed);if(!d)return Promise.resolve(null);
  if(PRE[d.id])return PRE[d.id].p;
  for(const k in PRE)delete PRE[k];                         // une seule map gardée en attente
  const e=PRE[d.id]={b:null};
  e.p=buildMap(d).then(b=>{e.b=b;safe(()=>{b.grp.visible=false;scene.add(b.grp);renderer.compile(scene,camera);scene.remove(b.grp);b.grp.visible=true});return b})
    .catch(err=>{if(PRE[d.id]===e)delete PRE[d.id];console.warn('[maps] préchargement impossible :',d.name,err&&err.message||err);return null});
  return e.p;
}

/* ---------------- branchement sur le démarrage de partie ---------------- */
const _sg=startGame;
startGame=function(){
  const args=arguments,self=this;
  if(mode!=='pvp'){restoreCity();return _sg.apply(self,args)}
  if(busy)return;
  if(Date.now()-launchEnd<30000&&state==='PLAYING')return;        // (v8) lancement déjà fait : on ignore un 2e « départ » tardif
  busy=true;
  safe(()=>goFull());safe(()=>{renderer.domElement.requestPointerLock()});                // dans le geste de l'utilisateur quand c'est possible
  const seed=(typeof startSeed==='number'?startSeed:0)>>>0;
  const target=mapIdx(seed);let def=MAPS[target];
  const from=(seed>>>7)%MAPS.length;
  let built=null;const errs=[];
  const loadP=(async()=>{
    const ov=()=>window.__mpOverlay;
    /* map tirée au sort d'abord, puis les suivantes si elle ne se charge pas : jamais la ville tant qu'une map marche */
    for(let k=0;k<MAPS.length&&!built;k++){
      const d=MAPS[(target+k)%MAPS.length];
      try{
        built=await takePre(d)||await buildMap(d,p=>{ov()&&ov()._ld&&ov()._ld('Chargement de '+d.name+' : '+Math.round(p*100)+' %')},s=>{ov()&&ov()._ld&&ov()._ld(d.name+' — '+s)});
        def=d;
      }catch(e){
        const m=e&&e.message||String(e);errs.push('« '+d.name+' » ('+d.files.join(' | ')+')\n'+m);console.warn('[maps]',d.name,m);
        disposeMap();
        ov()&&ov()._ld&&ov()._ld('⚠ '+d.name+' impossible, essai d\'une autre map…');
      }
    }
    /* (v7) PRÉCHAUFFAGE derrière l'écran de tirage : animations/personnages (asynchrone), shaders compilés, puis courte pause avant de rendre la main */
    ov()&&ov()._ld&&ov()._ld('Préparation des personnages…');
    await safe(()=>window.__AREN_WARM&&window.__AREN_WARM());
    if(built){
      ov()&&ov()._ld&&ov()._ld('Compilation des shaders…');
      await tick();
      safe(()=>{built.grp.visible=false;scene.add(built.grp);renderer.compile(scene,camera);scene.remove(built.grp);built.grp.visible=true});
    }
    await new Promise(r=>setTimeout(r,250));
  })();
  roulette(target,from,loadP).then(()=>{
    try{
      if(built){activate(def,built)}
      else{restoreCity();showErr('Aucune map PvP n\'a pu être chargée — ville utilisée en dernier recours',errs)}
    }catch(e){console.error(e);restoreCity()}
    busy=false;launchEnd=Date.now();
    const r=_sg.apply(self,args);
    if(CUR!=='ville')parkVeh(true);                                    // _sg() a remis les véhicules à leur place de la ville (reset) : on les gare
    safe(()=>{
      if(CUR!=='ville'){
        safe(clearBarrels);
        fixSpawn();
        banner('🗺 '+def.name+' — premier à '+KILLS+' frags',3200);
        if(errs.length)showErr('Map tirée indisponible — '+def.name+' utilisée à la place',errs);
      }
    });
    return r;
  });
};
/* test du serveur : le dossier assets est-il en ligne ? et assets/Maps ? (HEAD, sans rien télécharger) */
async function probe(){
  const tests=['assets/arx-160_weapon.glb','assets/Zombie_Walk.fbx','assets/covelarge.glb','assets/warzone_medieval_theme.glb','assets/covelarge.glb'],ok={};
  const out=['🔎 TEST DU SERVEUR ('+location.origin+')'];
  for(const u of tests){
    try{const r=await fetch(u,{method:'HEAD',cache:'no-store'});ok[u]=r.ok;out.push(u+' → '+r.status+(r.ok?' ✅':' ❌'))}
    catch(e){ok[u]=false;out.push(u+' → erreur réseau ❌')}
  }
  const A=ok[tests[0]]||ok[tests[1]],Mp=ok[tests[2]]||ok[tests[3]]||ok[tests[4]];
  out.push(Mp?'→ Les maps sont en ligne : le problème est le nom exact d\'un fichier ou son format.'
    :A?'→ Le dossier assets est en ligne mais PAS les maps : covelarge.glb et warzone_medieval_theme.glb ne sont pas dans assets/ sur Netlify. Mets les 2 .glb directement dans le dossier assets (à côté des .fbx) et redéploie.'
    :'→ Même assets/ introuvable à cette adresse : le site déployé n\'est pas la bonne version du dossier (ou le dossier assets n\'a pas été envoyé).');
  return out.join('\n');
}
/* panneau d'erreur lisible (toucher pour fermer) : donne la vraie cause au lieu d'un simple « introuvable » */
function showErr(title,lines){
  safe(()=>{
    const old=document.getElementById('mp-err');if(old)old.remove();
    const d=document.createElement('div');d.id='mp-err';
    d.style.cssText='position:fixed;left:8px;right:8px;bottom:8px;z-index:400;max-height:45vh;overflow:auto;background:rgba(20,6,6,.95);border:1px solid #f87171;border-radius:12px;padding:10px 12px;color:#fecaca;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all';
    d.textContent='⚠ '+title+'\n\n'+lines.join('\n\n')+'\n\n(toucher pour fermer)';
    d.onclick=()=>d.remove();document.body.appendChild(d);setTimeout(()=>d.remove(),60000);
    probe().then(t=>{if(d.isConnected)d.textContent=d.textContent.replace('\n\n(toucher pour fermer)','')+'\n\n'+t+'\n\n(toucher pour fermer)'});
  });
}
/* si le point d'apparition choisi est coincé, on cherche le point libre le plus proche */
function fixSpawn(){
  if(!G)return;
  const p=player.pos;
  const ok=(x,z)=>{const g=gridGround(G,x,z,0);return !gridBlocked(G,x,z,g)&&inZone(G,x,z,g)&&Math.abs(x)<M-4&&Math.abs(z)<M-4&&(!G.W||pushXZ(G.W,x,z,.45,g,false)===0)};
  if(!ok(p.x,p.z)){
    outer:for(let r=1;r<40;r+=1){for(let a=0;a<16;a++){const an=a/16*Math.PI*2,x=p.x+Math.cos(an)*r,z=p.z+Math.sin(an)*r;if(ok(x,z)){p.x=x;p.z=z;break outer}}}
  }
  p.y=gridGround(G,p.x,p.z,0)+.5;player.vy=0;       // 50 cm au-dessus du sol : on retombe doucement, jamais sous la map
}
/* point libre le plus proche (dans la zone, hors des murs) — sert à dégager un joueur coincé ou à poser une victime de judo */
function unstick(p,rad,y){
  if(!G)return;
  const ok=(x,z,g)=>inZone(G,x,z,g)&&!gridBlocked(G,x,z,g)&&(!G.W||pushXZ(G.W,x,z,rad,g,false)===0);
  for(let r=.5;r<=10;r+=.5)for(let a=0;a<16;a++){
    const an=a/16*Math.PI*2,x=p.x+Math.cos(an)*r,z=p.z+Math.sin(an)*r,g=gridGround(G,x,z,y+.85);
    if(ok(x,z,g)){p.x=x;p.z=z;if(p===player.pos){p.y=Math.max(p.y,g);player.vy=0}const o=lastOK.get(p);if(o){o.x=x;o.z=z}return}
  }
}
Object.assign(window.__PVPQ,{
  /* pose une position (victime de judo…) : balayage depuis (x0,z0) jusqu'à (x1,z1) sans traverser mur ni sortir de la zone */
  place(x0,z0,x1,z1,y,rad){if(!G)return{x:x1,z:z1};const r=walkTo(G,x0,z0,x1,z1,y,rad||.4);return{x:r.x,z:r.z}},
  inZone:(x,z)=>G?inZone(G,x,z):true,
  /* garde-fou vertical : jamais sous le sol (appelé après chaque déplacement d'animation) */
  guard(){
    if(!G||window.__CLIMBING)return;const p=player.pos;
    if(!isFinite(p.x+p.y+p.z)){fixSpawn();return}
    const g=groundAt(p.x,p.z,p.y);if(p.y<g-.3){p.y=g;if(player.vy<0)player.vy=0}
  },
  active:()=>!!G
});
/* PLAN DE RÉINITIALISATION (kill plane) + ANTI-BLOCAGE, 4 contrôles par seconde :
   • tombé sous la map (quelques mètres sous le sol), position invalide ou hors zone -> retour immédiat au point d'apparition ;
   • coincé dans un mur / un objet (2 contrôles de suite) -> dégagé vers le point libre le plus proche. */
const KILL_Y=-8;
let stuckT=0;
setInterval(()=>{
  if(!G||state!=='PLAYING'||mode!=='pvp')return;
  const p=player.pos;
  let lost=!isFinite(p.x+p.y+p.z)||p.y<KILL_Y||!inZone(G,p.x,p.z);
  if(!lost){
    const g=gridGround(G,p.x,p.z,p.y);
    if(isFinite(g)&&g>-1e5&&p.y<g-3&&p.y<-1.5)lost=true;                  // traversé le sol
  }
  if(lost){
    stuckT=0;
    const ids=Object.keys(net.ro||{}).sort(),sp=PV[Math.max(0,ids.indexOf(net.id))%8];
    player.pos.set(sp[0],0,sp[1]);player.vy=0;fixSpawn();
    safe(()=>toast('↩ Retour au point d\'apparition','#fbbf24'));
    return;
  }
  if(window.__CLIMBING){stuckT=0;return}
  const g2=gridGround(G,p.x,p.z,p.y);
  if(gridBlocked(G,p.x,p.z,g2)){if(++stuckT>=2){stuckT=0;unstick(p,.45,p.y)}}else stuckT=0;
},250);
window.__PVPMAPS={MAPS,current:()=>CUR,restore:restoreCity,prefetch};
})();
