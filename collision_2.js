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
