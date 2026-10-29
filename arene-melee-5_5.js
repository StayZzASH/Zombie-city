(()=>{
/* ====================================================================
   ARÈNE PvP MÊLÉE  —  combat au corps à corps multijoueur instantané
   --------------------------------------------------------------------
   • Mode "pvp" du jeu = Arène mêlée (pas de zombies, pas de coffres, mêlée seule).
     Mettre ARENA_MELEE=false pour retrouver l'ancien PvP à distance.
   • Réseau : l'ATTAQUANT détecte l'impact au moment du clic (zéro latence
     ressentie : étincelles, sons et marqueur de touche sont immédiats) puis
     envoie 'mh' à la victime. La VICTIME valide (portée, esquive, parade,
     invulnérabilité) puis applique dégâts + recul. 'sw' (coup) et 'bk'
     (garde) sont diffusés à tous pour animer les adversaires sans attendre.
   • v3 : CARTES PvP .glb (section "CARTES PvP") + ANIMATIONS DE COMBAT FBX
     (MELEE_ANIMS / pickAnim / avFull). Tout est réglable dans ces deux blocs.
   ==================================================================== */
const ARENA_MELEE=true;
const R=.45;                 // rayon de la capsule d'un joueur (collisions + hitbox)
const SEP=.95;               // distance mini entre deux joueurs (collision)
const TOL=2.4;               // tolérance de validation côté victime (latence + interpolation)
const PARRY_MS=420;          // fenêtre de parade parfaite après avoir levé la garde
const BLOCK_DMG=0;           // part des dégâts qui passe quand on bloque de face (0 = aucun dégât)
const STUN_S=.8;             // étourdissement de l'attaquant paré
const SWING_DUR=.2;          // durée pendant laquelle le coup balaie la zone
/* stats de mêlée : dmg, range (m), cos = ouverture du cône (cos du demi-angle), kb = recul */
const MS={
  punch:{dmg:6, range:1.9,cos:.75,kb:3.2},
  batte:{dmg:14,range:2.6,cos:.55,kb:5.5},
  katana:{dmg:22,range:2.8,cos:.35,kb:4.2}
};
const arena=()=>ARENA_MELEE&&mode==='pvp'&&net.on;
const heldFists=()=>!(gun&&gun.visible)||!slots[cur];
const meleeHeld=()=>heldFists()||!!(W&&W.melee);

/* ---------- géométrie de l'impact (pure, testable) ---------- */
function hitTest(a,t,st,yawA){
  if(Math.abs(t.y-a.y)>1.6)return null;
  const dx=t.x-a.x,dz=t.z-a.z,dist=Math.hypot(dx,dz)||.001;
  if(dist>st.range+R)return null;
  const fx=-Math.sin(yawA),fz=-Math.cos(yawA),dot=(dx*fx+dz*fz)/dist;
  if(dist>R+.5&&dot<st.cos)return null;           // hors du cône (sauf contact rapproché)
  return{dist,nx:dx/dist,nz:dz/dist};
}
const _ray=new THREE.Raycaster(),_o=new THREE.Vector3(),_d=new THREE.Vector3();
function clearLOS(ax,az,bx,bz,dist){                // pas de coup à travers un mur
  _o.set(ax,1.2,az);_d.set(bx-ax,0,bz-az).normalize();_ray.set(_o,_d);_ray.far=Math.max(.1,dist-R);
  return _ray.intersectObjects(solidMeshes,false).length===0;
}

/* ---------- état local ---------- */
let SW=null,blockOn=false,blockT0=0,blockK=0,stunT=0,invulnT=0,kbx=0,kbz=0,wasDead=false,gbase=null;
const lastHitFrom={};

/* ====================================================================
   EFFETS DE COMBAT  (inspirés de Mirror of Fate + Mirror's Edge)
   • Arcs de coup : larges balayages blancs (flammes en rage / contre), alternés gauche-droite
   • Parade parfaite : ralenti + zoom + CONTRE (prochain coup x1.75, arc enflammé)
   • Impact : la caméra pivote (roulis) et tremble quand on frappe ou qu'on est touché
   • Takedown : coup de grâce -> ralenti, caméra qui tourne autour de la victime, bandes cinéma
   Réglages ci-dessous (tout est facultatif). Mouvement/parkour : voir MV plus bas.
   ==================================================================== */
const FX={
  arcs:true,                  // arcs visuels des coups
  slowParry:[.3,.75],         // parade parfaite : échelle de temps, durée (s réelles)
  counterMul:1.75,            // bonus de dégâts du contre
  counterWin:1.8,             // durée de la fenêtre de contre (s)
  takedown:true,              // caméra de coup de grâce
  takedownSlow:[.2,.8],       // échelle de temps, durée (s réelles)
  takedownDur:.95,            // durée du plan caméra (s réelles)
  roll:1                      // intensité du roulis caméra (0 = désactivé)
};
let slowK=1,slowT=0,slowTo=1,counterT=0,camRoll=0,zoomK=0,TD=null,tdCool=0,bars=null;
const FXS={n:0,t:0},arcs=[],ARCG={};
const _tp=new THREE.Vector3(),_tl=new THREE.Vector3(),_qm=new THREE.Matrix4(),_qt=new THREE.Quaternion();
const slowmo=(k,d)=>{slowTo=k;slowT=d};

/* --- temps : ralenti local (le dt du moteur est réduit) --- */
function fxTime(real){
  counterT=Math.max(0,counterT-real);acroCD=Math.max(0,acroCD-real);saltoT=Math.max(0,saltoT-real);kickT=Math.max(0,kickT-real);
  if(!(state==='PLAYING'&&arena())){slowK=1;slowT=0;return real}
  if(slowT>0){slowT-=real;slowK+=(slowTo-slowK)*Math.min(1,real*18)}
  else slowK+=(1-slowK)*Math.min(1,real*7);
  return real*slowK;
}

/* --- arcs de coup --- */
function arcGeo(range,half){
  const key=range.toFixed(2)+'|'+half.toFixed(2);if(ARCG[key])return ARCG[key];
  const r0=range*.5,r1=range*.95,ts=Math.PI/2-half,tl=half*2;               // arc centré vers l'avant (-Z)
  const g=new THREE.RingGeometry(r0,r1,30,1,ts,tl),p=g.attributes.position,col=new Float32Array(p.count*3);
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),s=Math.min(1,Math.max(0,(Math.atan2(y,x)-ts)/tl)),r=Math.hypot(x,y);
    const e=Math.abs(2*(r-r0)/(r1-r0)-1),b=(.04+.96*Math.pow(s,1.8))*(1-.55*e*e);   // tête brillante, queue qui s'efface
    col[3*i]=col[3*i+1]=col[3*i+2]=b;
  }
  g.setAttribute('color',new THREE.BufferAttribute(col,3));
  return ARCG[key]=g;
}
function swingFx(x,y,z,yawA,st,k,force){
  if(!FX.arcs)return;
  const now=performance.now();k=k||FXS;
  k.n=(now-(k.t||0)<900)?(k.n||0)+1:0;k.t=now;                              // enchaînement : alterne droite/gauche, 3e coup plat
  const dir=k.n%2?-1:1,roll=k.n%3===2?0:dir*.5,flame=!!force||(k===FXS&&(rageT>0||counterT>0));
  const bs=st.base||st,punch=bs===MS.punch,half=(punch?52:(flame?78:68))*Math.PI/180;
  const mat=new THREE.MeshBasicMaterial({color:flame?0xff7a1a:(bs===MS.batte?0xffe3b8:0xe4f2ff),vertexColors:true,transparent:true,
    blending:THREE.AdditiveBlending,depthWrite:false,side:THREE.DoubleSide,fog:false,opacity:punch?.55:1});
  const root=new THREE.Group(),tilt=new THREE.Group(),sw=new THREE.Group(),m=new THREE.Mesh(arcGeo(st.range,half),mat);
  m.rotation.x=-Math.PI/2;m.scale.x=dir;m.renderOrder=20;m.frustumCulled=false;
  sw.add(m);tilt.add(sw);root.add(tilt);root.position.set(x,y+1.15,z);root.rotation.y=yawA;tilt.rotation.z=roll;
  scene.add(root);arcs.push({root,sw,mat,dir,t:0,life:flame?.3:.22,op:mat.opacity});
  if(flame)burst(new THREE.Vector3(x-Math.sin(yawA)*st.range*.8,y+1.1,z-Math.cos(yawA)*st.range*.8),5,pMat.spark,3);
}
function tickArcs(real){
  for(let i=arcs.length-1;i>=0;i--){
    const a=arcs[i];a.t+=real;const u=a.t/a.life;
    if(u>=1){scene.remove(a.root);a.mat.dispose();arcs.splice(i,1);continue}
    const e=1-Math.pow(1-u,2.2);
    a.sw.rotation.y=a.dir*(-.8+1.6*e);a.root.scale.setScalar(.9+.25*u);a.mat.opacity=a.op*Math.pow(1-u,1.3);
  }
}

/* --- impact / parade / takedown --- */
const rs=()=>Math.random()<.5?-1:1;
function hitKick(st,counter){
  shakeT=Math.max(shakeT,.14+st.dmg/130);camRoll+=rs()*(.025+st.dmg/800)*FX.roll;
  if(counter){zoomK=1;shakeT=Math.max(shakeT,.4)}
}
function perfectParryFx(){
  counterT=FX.counterWin;slowmo(FX.slowParry[0],FX.slowParry[1]);zoomK=1;camRoll+=.06*FX.roll;shakeT=Math.max(shakeT,.3);
  toast('🛡 PARADE PARFAITE — CONTRE !','#38bdf8');
}
function perfectDodge(){
  if(counterT>0)return;
  counterT=FX.counterWin;slowmo(.35,.6);zoomK=1;camRoll+=rs()*.08*FX.roll;shakeT=Math.max(shakeT,.2);
  toast('💨 ESQUIVE PARFAITE — CONTRE !','#a78bfa');SFX.level&&SFX.level();echoSpawn(0xa78bfa);
}
function setBars(on){
  if(!bars){
    bars=document.createElement('div');bars.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:30;opacity:0;transition:opacity .18s';
    bars.innerHTML='<div style="position:absolute;left:0;right:0;top:0;height:9vh;background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:9vh;background:#000"></div>';
    document.body.appendChild(bars);
  }
  bars.style.opacity=on?1:0;
}
function startTakedown(id,q){
  if(!FX.takedown||TD||performance.now()<tdCool)return;
  tdCool=performance.now()+2600;TD={id,t:0,side:rs()};
  slowmo(FX.takedownSlow[0],FX.takedownSlow[1]);setBars(true);zoomK=1;
  toast('⚔ TAKEDOWN','#fbbf24');SFX.boom&&SFX.boom();shakeT=Math.max(shakeT,.5);
  if(MELEE_FBX)animAll('flip');                                                    // coup de grâce : coup de pied retourné
  burst(new THREE.Vector3(q.x,1.3,q.z),18,pMat.blood,5);
  invulnT=Math.max(invulnT,1.1);                                                   // intouchable pendant la mise à mort
  const yv=Math.atan2(-(player.pos.x-q.x),-(player.pos.z-q.z));                    // deux grands arcs enflammés en croix
  swingFx(q.x,q.y,q.z,yv,MS.katana,{n:0,t:0},true);
  setTimeout(()=>{try{swingFx(q.x,q.y+.1,q.z,yv+.5,MS.katana,{n:1,t:performance.now()},true)}catch(_){}},120);
}
function fxPost(real){
  tickArcs(real);
  const play=state==='PLAYING';
  let zoom=zoomK;
  if(play&&arena()){
    if(TD){
      const q=net.pl[TD.id];TD.t+=real;
      if(!q||TD.t>=FX.takedownDur){TD=null;setBars(false)}
      else{
        const u=TD.t/FX.takedownDur,w=Math.min(1,Math.sin(u*Math.PI)*1.8),A=player.pos;
        const dx=q.x-A.x,dz=q.z-A.z,dl=Math.hypot(dx,dz)||1,nx=dx/dl,nz=dz/dl,ang=.2+u*.9;
        if(u<.35){                                                             // glory kill : le joueur s'élance et se tourne vers la victime
          if(dl>1.4){const st=Math.min(dl-1.4,7*real);A.x+=nx*st;A.z+=nz*st}
          let dy=Math.atan2(-nx,-nz)-yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));yaw+=dy*Math.min(1,real*14);
        }
        const sx=-nz*TD.side,sz=nx*TD.side,fw=Math.sin(ang)*1.8-1.2,sd=Math.cos(ang)*2.6;
        _tp.set(A.x+dx*.6+sx*sd+nx*fw,A.y+1.5,A.z+dz*.6+sz*sd+nz*fw);          // orbite autour de la victime
        camera.position.lerp(_tp,w);
        _tl.set(q.x,1.25,q.z);_qm.lookAt(camera.position,_tl,camera.up);_qt.setFromRotationMatrix(_qm);camera.quaternion.slerp(_qt,w);
        zoom=Math.max(zoom,w*.7);
      }
    }
  }else if(TD){TD=null;setBars(false)}
  const boost=play&&MV.on?mvFov:0;
  if(play&&(zoom>.01||boost>.05)){camera.fov=((typeof ads!=='undefined'&&ads&&W)?W.fov:65)-zoom*11+boost;camera.updateProjectionMatrix()}   // zoom + FOV de vitesse (le jeu rétablit le FOV ensuite)
  const roll=(play&&arena()?camRoll:0)+(play&&MV.on?mvRollNow+mvRollAdd:0);
  if(Math.abs(roll)>.0005)camera.rotateZ(roll);
  if(play&&saltoT>0){const u=1-saltoT/ACRO.saltoDur,e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2;camera.rotateX(e*Math.PI*2)}   // salto arrière : la vue fait un tour complet
  counterHint(play&&arena()&&counterT>0);
  zoomK=Math.max(0,zoomK-real*2.2);camRoll*=Math.exp(-8*real);
}

/* ---------- animation de combat du joueur LOCAL ----------
   Visible quand la caméra le montre (takedown, ombres…). Nécessite UNE ligne dans index.html (script "fbx-chars"),
   juste après  const PL={...};  :     window.__PL=PL;
   Sans cette ligne, rien ne casse : seuls les adversaires voient l'animation. */
const LA={k:'',until:0};
function localAnim(key){
  try{
    const cfg=MELEE_ANIMS[key],P=window.__PL;if(!cfg||!P||!P.actor||!P.info||P.wasDead||P.dying)return;
    if(cfg.ue){ueLoad(cfg.file);ueTPose()}
    avNeedAnims();                                                              // (re)lance le chargement des FBX si besoin
    const now=performance.now();if(LA.k===key&&now<LA.until)return;
    const A=P.actor,n='mx_'+key;
    if(cfg.loop&&A.over&&A.over.n===n)return;                                 // animation en boucle déjà active : on ne la relance pas
    if(!A.a[n]){
      const c=avClip(P.info,cfg.file,'full',false);if(!c)return;              // FBX pas encore chargé -> on réessaiera au prochain coup
      const act=A.mixer.clipAction(c);act.setLoop(cfg.loop?THREE.LoopRepeat:(EMO2.has(key)?THREE.LoopRepeat:THREE.LoopOnce),cfg.loop?Infinity:(EMO2.has(key)?2:1));act.clampWhenFinished=!cfg.loop;A.a[n]=act;A.m[n]={clip:c,once:!cfg.loop,partial:false};
    }
    const ts=cfg.ts||1,d=((cfg.to||A.m[n].clip.duration)-(cfg.from||0))/ts*(!cfg.loop&&EMO2.has(key)?2:1);   // émotes : 2 fois puis stop
    A.playOnce(n,{ts,fade:cfg.loop?.2:.06,hold:!!cfg.loop});A.a[n].time=cfg.from||0;
    LA.k=key;LA.until=cfg.loop?0:now+d*1000;
    if(!cfg.loop)setTimeout(()=>{if(A.over&&A.over.n===n)A.clearOver(.14)},d*1000);
  }catch(e){console.warn('[arène] animation locale :',e&&e.message||e)}
}
const EMO2=new Set(['g1','g2','g3','g4','t1','t2','i1','i2','i3','i4']);   // émotes jouées 2 fois puis arrêtées
const animAll=key=>{localAnim(key);try{if(net.on)tx({t:'an',a:key})}catch(_){}};   // locale + diffusée aux adversaires

/* ---------- attaque (côté attaquant, prédiction immédiate) ---------- */
function startSwing(){
  const st=statsNow();
  if((st.base||st)===MS.punch&&comboStep()==='G'&&tryAutoGrab())return;   // (v8) ce coup de l'enchaînement est une PRISE
  SW={t:0,st,hit:new Set()};
  swingFx(player.pos.x,player.pos.y,player.pos.z,yaw,st);                 // (met aussi à jour FXS.n = rang du coup dans l'enchaînement)
  if(MV.on&&MV.lunge&&arena()){const a=grounded?4.2:2;mv.mx+=-Math.sin(yaw)*a;mv.mz+=-Math.cos(yaw)*a;mvCap()}   // le coup embarque le joueur
  const an=pickAnim(st);                                                   // animation FBX de ce coup (null = animation "torche")
  if(an)localAnim(an);
  tx({t:'sw',k:heldFists()?'punch':weaponKey,a:an||''});                   // 'a' : les adversaires jouent la même animation
  testSwing();                                       // test INSTANTANÉ au clic
}
function testSwing(){
  if(!SW)return;
  const a={x:player.pos.x,y:player.pos.y,z:player.pos.z};
  for(const id in net.pl){
    const q=net.pl[id];if(!q.al||SW.hit.has(id))continue;
    const h=hitTest(a,{x:q.x,y:q.y,z:q.z},SW.st,yaw);if(!h)continue;
    if(!clearLOS(a.x,a.z,q.x,q.z,h.dist))continue;
    SW.hit.add(id);land(id,q,SW.st,h);
  }
}
function land(id,q,st,h){
  let d=st.dmg*(rageT>0?2:1);
  const counter=counterT>0;if(counter){d*=FX.counterMul;counterT=0}
  const fatal=q.hp>0&&q.hp-d<=0;
  hits++;SFX.hit();mark(false);burst(new THREE.Vector3(q.x,1.3,q.z),9,pMat.blood,3.2);
  q.flash=.15;
  hitKick(st,counter);if(fatal)startTakedown(id,q);
  tx({t:'mh',to:id,d,ax:player.pos.x,az:player.pos.z,rg:st.range,kx:h.nx,kz:h.nz,kb:st.kb});
}

/* ---------- réception d'un coup (côté victime) ---------- */
function onMeleeHit(m){
  if(state!=='PLAYING'||selfDead||mode!=='pvp')return;
  if(rolling){                                                                                 // esquive : invulnérable ; coup reçu en début de roulade = esquive PARFAITE
    if(MV.on&&MV.dodge&&rollT<.3){const t0=performance.now();if(t0-(lastHitFrom[m.f]||0)>=110){lastHitFrom[m.f]=t0;perfectDodge()}}
    return;
  }
  if(invulnT>0){if(saltoT>.25&&counterT<=0&&performance.now()-(lastHitFrom[m.f]||0)>=110){lastHitFrom[m.f]=performance.now();perfectDodge()}return}
  const now=performance.now();if(now-(lastHitFrom[m.f]||0)<110)return;lastHitFrom[m.f]=now;   // anti double-hit
  const ex=m.ax-player.pos.x,ez=m.az-player.pos.z,dist=Math.hypot(ex,ez)||.001;
  if(dist>(+m.rg||3)+R+TOL)return;                                                             // validation de portée
  let d=Math.min(+m.d||0,45),kb=Math.min(+m.kb||0,7);
  if(blockOn){
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
    if((ex*fx+ez*fz)/dist>.25){                                                                // coup reçu de face
      if(now-blockT0<PARRY_MS){tx({t:'pr',to:m.f});perfectParryFx();SFX.level&&SFX.level();burst(new THREE.Vector3(player.pos.x,1.3,player.pos.z),12,pMat.spark,4);return}
      d*=BLOCK_DMG;kb*=.3;SFX.wall();burst(new THREE.Vector3(player.pos.x-ex/dist*.6,1.3,player.pos.z-ez/dist*.6),8,pMat.spark,3);
    }
  }
  hp-=d;lastAtk=m.f;dmgFlash=1;SFX.hurt();camRoll+=rs()*.07*FX.roll;shakeT=Math.max(shakeT,.3);kbx+=(+m.kx||0)*kb;kbz+=(+m.kz||0)*kb;
  updateHUD();if(hp<=0)gameOver();
}
function onParried(){stunT=STUN_S;SW=null;toast('⚔ COUP PARÉ !','#f87171');SFX.wall();shakeT=Math.max(shakeT,.2);camRoll-=.07*FX.roll}
function onRemoteSwing(m){
  const q=net.pl[m.f];if(!q)return;q.sw=SWING_DUR;q.swReq=1;q.swAn=MELEE_ANIMS[m.a]?m.a:'';
  swingFx(q.x,q.y,q.z,q.r,MS[m.k]||MS.katana,q.fxs||(q.fxs={n:0,t:0}));
  if(Math.hypot(q.x-player.pos.x,q.z-player.pos.z)<22)(SFX[m.k]||SFX.hit)();
}

/* ---------- garde / parade ---------- */
function setBlock(on){
  on=!!on;if(on===blockOn)return;
  if(on&&(!arena()||selfDead||state!=='PLAYING'||rolling||stunT>0||!meleeHeld()))return;
  blockOn=on;if(on){blockT0=performance.now();SW=null;setADS(false)}
  tx({t:'bk',on:on?1:0});
}
addEventListener('keydown',e=>{if(e.code==='KeyX'&&!e.repeat)setBlock(true)});
addEventListener('keyup',e=>{if(e.code==='KeyX')setBlock(false)});
addEventListener('mousedown',e=>{if(e.button===2&&arena()){e.stopImmediatePropagation();setBlock(true)}},true);
addEventListener('mouseup',e=>{if(e.button===2)setBlock(false)},true);
addEventListener('blur',()=>setBlock(false));

/* ---------- branchements sur le moteur existant ---------- */
const _sh=shoot;
shoot=function(){
  if(arena()&&(blockOn||stunT>0||selfDead))return false;
  const ok=_sh.apply(this,arguments);
  if(ok&&arena()&&meleeHeld())startSwing();
  return ok;
};
const _h=handle;
handle=function(m){
  switch(m.t){
    case 'mh':onMeleeHit(m);return;
    case 'sw':onRemoteSwing(m);return;
    case 'bk':{const q=net.pl[m.f];if(q)q.blk=!!m.on;return}
    case 'an':{const q=net.pl[m.f];if(q&&MELEE_ANIMS[m.a])q.anReq=m.a;return}      // animation seule (glissade, takedown…)
    case 'pr':onParried(m);return;
    case 'gp':onGrab(m);return;
    case 'mv':{const q=net.pl[m.f];if(q)q.mvs=m.s|0;return}
  }
  return _h.apply(this,arguments);
};
RELAY.add('sw');RELAY.add('bk');RELAY.add('mv');RELAY.add('an');RELAY.add('gp');

/* pas de chests, pas de grenades/tourelles dans l'arène mêlée */
const _sc=spawnChests;
spawnChests=function(seed){_sc(seed);if(arena()){chests.forEach(c=>scene.remove(c.g));chests=[];lootItems.forEach(l=>scene.remove(l.m));lootItems=[]}};
const _ti=throwItem;throwItem=function(){if(arena())return;return _ti.apply(this,arguments)};   // (G = prise de judo dans l'arène)
const _pt=placeTurret;placeTurret=function(){if(arena())return;return _pt.apply(this,arguments)};

/* points d'apparition rapprochés (duels rapides) */
function arenaSpawns(){
  if(window.__MAPSPAWN){PV.splice(0,8,...window.__MAPSPAWN.map(p=>p.slice()));return}      // map .glb : points calculés dans la zone jouable
  const pts=[];
  for(let i=0;i<8;i++){
    const a=i/8*Math.PI*2+.4;let p=null;
    for(const r of [20,24,28,16,32,12]){const x=Math.cos(a)*r,z=Math.sin(a)*r;if(spotFree(x,z,1.6)){p=[+x.toFixed(1),+z.toFixed(1)];break}}
    pts.push(p||PV[i]);
  }
  PV.splice(0,8,...pts);
}
const _sg=startGame;
startGame=function(){if(arena())arenaSpawns();const r=_sg.apply(this,arguments);invulnT=2;kbx=kbz=0;SW=null;blockOn=false;return r};

/* ---------- joueurs distants : modèle FBX Mixamo + arme DANS LA MAIN ----------
   • Le skin de chaque adversaire (net.sk[id] -> NL_SKINS[].fbx) est chargé ici (assets/<nom>.fbx).
     Tant qu'il n'est pas prêt, ou s'il échoue, on garde les cubes d'origine (rien ne casse).
   • L'arme est attachée à l'os de la main droite (traverse -> mixamorigRightHand, sinon repli par nom).
   • AUCUN réglage nécessaire : l'orientation et le point de prise du katana sont CALCULÉS
     (axe de la lame + côté poignée déduits de la géométrie du GLB, axes de la paume déduits
     des os des doigts). WEAPON_TWEAK ne sert qu'à d'éventuels micro-réglages (tout à 0 = auto).
   ------------------------------------------------------------------------- */
const AV_BASES=['assets/',''];               // mêmes dossiers que le reste du jeu
const AV_H=1.82;                             // taille des joueurs (identique au joueur local)
const AV_ANIM={walk:'Rifle_Walk',run:'Run_Forward',pose:'Hit_Reaction',melee:'Standing_Torch_Melee_Attack_02'};
const AV_LOOP={fall:'Falling_Idle',climb:'Climbing'};   // chute libre + grimpe (boucles corps entier, vues par les adversaires)

/* ---------- ANIMATIONS DE COMBAT (FBX Mixamo, corps entier) ----------
   Fichiers cherchés dans assets/ (puis à côté de index.html), comme le reste.
   file : nom du .fbx (sans extension)
   from : seconde du clip où on démarre (saute le préparatif, l'impact tombe ~0,15 s après le clic)
   to   : seconde où on s'arrête (le reste du clip est coupé)
   ts   : vitesse de lecture (1 = vitesse d'origine ; les clips Mixamo sont lents pour un jeu de combat)
   Flip_Kick1.fbx est identique à Flip_Kick.fbx (mêmes images clés) : un seul est utilisé. */
const MELEE_FBX=true;                        // false = on garde uniquement l'ancienne animation "torche"
const ANIM_ROLL=true;                        // les adversaires font un salto arrière quand ils roulent (esquive)
const MELEE_ANIMS={
  kickA:  {file:'Martelo_3',                from:.35,to:1.55,ts:2.2},   // coup de pied tournant (enchaînement à mains nues, 1er coup)
  kickB:  {file:'Macaco_Side',              from:.50,to:1.95,ts:2.4},   // capoeira (enchaînement à mains nues, 2e coup)
  flip:   {file:'Flip_Kick',                from:0,  to:1.70,ts:2.0},   // coup de pied retourné (3e coup à mains nues + TAKEDOWN)
  twirl:  {file:'Butterfly_Twirl',          from:.80,to:2.40,ts:2.2},   // vrille (3e coup d'un enchaînement à l'arme)
  air:    {file:'Flying_Kick',              from:.30,to:1.30,ts:1.8},   // coup de pied sauté
  slide:  {file:'Northern_Soul_Floor_Spin', from:1.40,to:3.60,ts:3.0},   // glissade / tacle (balayage au sol)
  counter:{file:'Ginga_Sideways_To_Au',     from:1.00,to:2.80,ts:2.4},   // CONTRE après parade / esquive parfaite
  dodge:  {file:'Backflip',                 from:.10,to:1.50,ts:3.1},
  crawl:  {file:'Crawling',from:0,ts:1,loop:true}   // (v8) à 4 pattes : joueur AU SOL en coop (assets/Crawling.fbx)    // salto arrière (roulade vue par les adversaires)
};
/* quelle animation pour quel coup ? (null = animation "torche" d'origine, haut du corps) */
/* ---------- PACK RamsterZ : les 40 animations (assets/RamsterZ_EpicMegaJam_2022/) ---------- */
const UE_DIR='RamsterZ_EpicMegaJam_2022/';
const _ue=(f,o)=>Object.assign({file:UE_DIR+f,ue:true,from:0,ts:1},o||{});
Object.assign(MELEE_ANIMS,{
  /* coups : enchaînements à mains nues (poings + pieds) et à l'arme */
  pA:_ue('H2H_PunchCombo01',{ts:1.7}),pB:_ue('H2H_PunchCombo02',{ts:1.7}),pC:_ue('H2H_PunchCombo03',{ts:1.7}),
  kA:_ue('H2H_Kick01',{ts:1.6}),kB:_ue('H2H_Kick02',{ts:1.6}),kC:_ue('H2H_Kick03',{ts:1.6}),kD:_ue('H2H_Kick04',{ts:1.6}),
  sw1:_ue('1HM_AerialSwing01_2HitCombo',{ts:1.5}),sw2:_ue('1HM_AerialSwing01_Forward',{ts:1.5}),
  /* prises à deux (A = attaquant, V = victime) — jouées en même temps, voir GRABS */
  thA:_ue('Paired_PressUpThrow_Att'),thV:_ue('Paired_PressUpThrow_Vic'),
  psA:_ue('Paired_PushShove_Att'),psV:_ue('Paired_PushShove_Vic'),
  gkA:_ue('Paired_GroinKick_Att'),gkV:_ue('Paired_GroinKick_Vic'),
  cpA:_ue('Paired_CounterPunch_PalmStrike_Att'),cpV:_ue('Paired_CounterPunch_PalmStrike_Vic'),
  chA:_ue('Paired_ForceChoke_Att'),chV:_ue('Paired_ForceChoke_Vic'),
  chSA:_ue('Paired_ForceChoke_Start_Att'),chSV:_ue('Paired_ForceChoke_Start_Vic'),
  chLA:_ue('Paired_ForceChoke_Loop_Att'),chLV:_ue('Paired_ForceChoke_Loop_Vic'),
  chEA:_ue('Paired_ForceChoke_End_Att'),chEV:_ue('Paired_ForceChoke_End_Vic'),
  nbA:_ue('Paired_SneakNeckBreak_Att'),nbV:_ue('Paired_SneakNeckBreak_Vic'),
  knA:_ue('Paired_Knife_Stealth_KidneyAndNeck_Att'),knV:_ue('Paired_Knife_Stealth_KidneyAndNeck_Vic'),
  kgA:_ue('Paired_Knife_GripVariant_Stealth_KidneyAndNeck_Att'),
  /* gestes et postures (touche B dans l'arène) */
  g1:_ue('SillyGesture01'),g2:_ue('SillyGesture02'),g3:_ue('SillyGesture03'),g4:_ue('SillyGesture04'),
  t1:_ue('TalkGesture_Dramatic01'),t2:_ue('TalkGesture_Dramatic02'),
  i1:_ue('H2H_Idle'),i2:_ue('1HM_Idle'),i3:_ue('Standing_Idle'),i4:_ue('Stealth_Idle')
});
const FIST_COMBOS=[['pA','kA','kB'],['pB','kC','flip'],['pC','kD','kA'],['kA','pB','kD']];   // 3 coups par enchaînement
let _cv=0,_cs=null;
const uOK=k=>{const c=MELEE_ANIMS[k];return !!c&&(!c.ue||!!AVRAW[c.file])};                 // clip prêt ? (sinon on retombe sur les anciennes animations)
/* ---------- (v8) ENCHAÎNEMENTS VARIÉS : droites + prises de corps à corps ----------
   Chaque enchaînement est tiré au hasard : P = coup de poing direct (clip H2H_PunchCombo au hasard, vitesse légèrement variable),
   G = PRISE automatique (projection, poussée, coup bas, paume, étranglement…) si un adversaire est à portée devant toi.
   Plus de combo en boucle : jamais le même clip deux fois de suite, et la prise tombe à des moments différents. */
const PUNCHES=['pA','pB','pC'];
let _lp=null,_lw=null,_lg=-1;
function pickRand(pool,last,ok){const c=pool.filter(k=>k!==last&&(!ok||ok(k)));const p=c.length?c:pool.filter(k=>!ok||ok(k));return p.length?p[Math.random()*p.length|0]:null}
function pickPunch(){
  const k=pickRand(PUNCHES,_lp,uOK);
  if(!k)return Math.random()<.5?'kickA':'kickB';          // clips du pack pas encore chargés : anciennes animations
  _lp=k;const c=MELEE_ANIMS[k];c.ts0=c.ts0||c.ts;c.ts=c.ts0*(.9+Math.random()*.3);return k;
}
const COMBO_PLANS=[['P','P','G'],['P','G'],['P','P','P'],['P','P','P','G'],['P','P','G'],['P','G']];
const CMB={plan:null,i:0,t:0};
function comboStep(){
  const now=performance.now();
  if(!CMB.plan||now-CMB.t>1100||CMB.i>=CMB.plan.length){CMB.plan=COMBO_PLANS[Math.random()*COMBO_PLANS.length|0];CMB.i=0}
  CMB.t=now;return CMB.plan[CMB.i++];
}
function tryAutoGrab(){
  if(!arena()||state!=='PLAYING'||selfDead||stunT>0||rolling||TD||gripT>0||grabCD>0||blockOn)return false;
  if(!findGrab())return false;
  doGrab();return true;
}
function pickAnim(st){
  if(!MELEE_FBX)return null;
  if(st.kind==='air')return 'air';
  if(st.kind==='slide')return 'slide';
  if(counterT>0)return uOK('cpA')?'cpA':'counter';
  const fist=(st.base||st)===MS.punch;
  if(fist)return pickPunch();                               // (v8) poings : droites tirées au hasard (jamais deux fois la même d'affilée)
  const k=pickRand(['sw1','sw2','twirl'],_lw,uOK);if(k){_lw=k;return k}
  return null;
}
const WEAPON_KEY='katana';
const GRIP_AT=.14;                           // point de prise = 14 % de la longueur depuis le bout de la poignée
/* micro-réglages OPTIONNELS (pos en mètres dans le repère de l'arme, rot en degrés, scale = multiplicateur) */
const WEAPON_TWEAK=window.WEAPON_TWEAK={pos:{x:0,y:0,z:0},rot:{x:0,y:0,z:0},scale:1};

// @@HELPERS-BEGIN  (maths pures, testées hors du jeu)
/* Analyse la géométrie de l'arme : axe de la lame, côté poignée (le plus épais), point de prise. */
function analyzeWeapon(w){
  w.updateMatrixWorld(true);
  const P=[],v=new THREE.Vector3(),mn=new THREE.Vector3(1e9,1e9,1e9),mx=new THREE.Vector3(-1e9,-1e9,-1e9);
  w.traverse(o=>{
    const a=o.isMesh&&o.geometry&&o.geometry.attributes&&o.geometry.attributes.position;if(!a)return;
    const st=Math.max(1,Math.floor(a.count/20000));
    for(let i=0;i<a.count;i+=st){v.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld);P.push(v.x,v.y,v.z);mn.min(v);mx.max(v)}
  });
  const n=P.length/3;if(n<8)return null;
  const mnA=[mn.x,mn.y,mn.z],mxA=[mx.x,mx.y,mx.z],ext=mnA.map((m,i)=>mxA[i]-m);
  const iL=ext[0]>=ext[1]&&ext[0]>=ext[2]?0:(ext[1]>=ext[2]?1:2),o1=(iL+1)%3,o2=(iL+2)%3;   // axe long = plus grande dimension
  const sd=i=>{let m=0,q=0;for(let j=0;j<n;j++){const x=P[3*j+i];m+=x;q+=x*x}m/=n;return q/n-m*m};
  const iW=sd(o1)>=sd(o2)?o1:o2,iT=iW===o1?o2:o1;            // largeur de lame (plus dispersée) / épaisseur
  const len=ext[iL]||1,zone=.18*len;
  const area=(lo,hi)=>{                                       // section (largeur x épaisseur) du bout de l'arme
    let a1=1e9,b1=-1e9,a2=1e9,b2=-1e9;
    for(let i=0;i<n;i++){const l=P[3*i+iL];if(l>=lo&&l<=hi){const u=P[3*i+o1],t=P[3*i+o2];if(u<a1)a1=u;if(u>b1)b1=u;if(t<a2)a2=t;if(t>b2)b2=t}}
    return b1>a1&&b2>a2?(b1-a1)*(b2-a2):0};
  const aLo=area(mnA[iL],mnA[iL]+zone),aHi=area(mxA[iL]-zone,mxA[iL]);
  const handleLow=aLo>=aHi*.95,sg=handleLow?1:-1;           // la poignée est le bout à plus grosse section (égalité : bout "bas")
  const eL=new THREE.Vector3(),eW=new THREE.Vector3(),grip=new THREE.Vector3();
  eL.setComponent(iL,sg);eW.setComponent(iW,1);              // eL = de la poignée vers la pointe
  grip.setComponent(iL,(handleLow?mnA[iL]:mxA[iL])+sg*GRIP_AT*len);
  grip.setComponent(iW,(mnA[iW]+mxA[iW])/2);grip.setComponent(iT,(mnA[iT]+mxA[iT])/2);
  return{eL,eW,grip,len};
}
const DEFAULT_AN={eL:new THREE.Vector3(1,0,0),eW:new THREE.Vector3(0,1,0),grip:new THREE.Vector3(-.35,0,0),len:.95};

/* Repère de la paume, déduit des os-enfants de la main (Thumb1 / Pinky1 / Middle1), en coordonnées LOCALES de l'os. */
function handFrame(hand){
  const kid={};hand.children.forEach(c=>{const m=/(Thumb1|Index1|Middle1|Ring1|Pinky1)$/.exec(c.name||'');if(m)kid[m[1]]=c});
  const mid=kid.Middle1||kid.Index1||kid.Ring1;
  const finger=mid?mid.position.clone():new THREE.Vector3(0,1,0),fl=finger.length()||1;finger.normalize();   // poignet -> doigts
  const perp=v=>v.clone().addScaledVector(finger,-v.dot(finger));
  const lat=new THREE.Vector3();                                                                             // auriculaire -> pouce
  if(kid.Thumb1)lat.add(perp(kid.Thumb1.position));
  if(kid.Pinky1)lat.sub(perp(kid.Pinky1.position));
  if(lat.lengthSq()<1e-10)lat.copy(perp(new THREE.Vector3(0,0,1)));
  if(lat.lengthSq()<1e-10)lat.copy(perp(new THREE.Vector3(1,0,0)));
  lat.normalize();
  const back=new THREE.Vector3().crossVectors(finger,lat).normalize();                                       // dos de la main
  return{
    blade:finger.clone().multiplyScalar(.82).addScaledVector(lat,.57),   // lame : dans le prolongement de l'avant-bras, ~35° côté pouce
    edge:lat.clone().negate(),                                           // tranchant côté auriculaire (plat de la lame face à la paume)
    grip:finger.clone().multiplyScalar(fl*.55).addScaledVector(back,-fl*.18)   // milieu de la paume, un peu vers l'intérieur
  };
}
/* Repère de secours pour les joueurs en cubes : la "main" est le bout du bras. */
const BOX_FRAME={blade:new THREE.Vector3(0,.5,-.87),edge:new THREE.Vector3(0,-.87,-.5),grip:new THREE.Vector3(0,0,0),comp:1};

/* Pose l'arme : l'axe de la lame -> fr.blade, le point de prise -> fr.grip (rotation autour de la prise). */
function mountMath(w,fr,an,tw){
  const eT=new THREE.Vector3().crossVectors(an.eL,an.eW);
  const bw=new THREE.Matrix4().makeBasis(an.eL,an.eW,eT);
  const bd=fr.blade.clone().normalize();
  const ed=fr.edge.clone().addScaledVector(bd,-fr.edge.dot(bd));
  if(ed.lengthSq()<1e-8)ed.set(bd.y,-bd.x,0);
  ed.normalize();
  const et=new THREE.Vector3().crossVectors(bd,ed);
  const bt=new THREE.Matrix4().makeBasis(bd,ed,et);
  const q=new THREE.Quaternion().setFromRotationMatrix(bt.multiply(bw.transpose()));
  const d=Math.PI/180;
  q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tw.rot.x*d,tw.rot.y*d,tw.rot.z*d)));
  const s=fr.comp*tw.scale;
  w.quaternion.copy(q);w.scale.setScalar(s);
  w.position.copy(fr.grip).addScaledVector(new THREE.Vector3(tw.pos.x,tw.pos.y,tw.pos.z),fr.comp)
    .sub(an.grip.clone().multiplyScalar(s).applyQuaternion(q));
}
// @@HELPERS-END

/* Recherche de l'os de la main droite : noms Mixamo connus, puis repli par expression (doigts exclus). */
const HAND_NAMES=['mixamorigRightHand','mixamorig:RightHand','RightHand','Right_Hand','hand_r','Hand_R','hand.R','R_Hand'];
function findHandBone(model){
  let found=null;
  model.traverse(o=>{if(!found&&o.isBone&&(HAND_NAMES.includes(o.name)||/^mixamorig\d*:?RightHand$/.test(o.name)))found=o});
  if(found)return found;
  const finger=/thumb|index|middle|ring|pinky|finger/i;
  model.traverse(o=>{if(!found&&o.isBone&&/right.?hand|hand.?(r|right)$/i.test(o.name)&&!finger.test(o.name))found=o});
  if(!found){const l=[];model.traverse(o=>o.isBone&&l.push(o.name));console.warn('[arène] os de la main droite introuvable. Os :',l)}
  return found;
}
const findBone=(model,re)=>{let f=null;model.traverse(o=>{if(!f&&o.isBone&&re.test(o.name))f=o});return f};
const avCl=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ---------- chargement des modèles / animations ---------- */
const avFiles={};
function avLoad(name){
  return avFiles[name]||(avFiles[name]=new Promise((ok,ko)=>{
    let i=0;const T=[];AV_BASES.forEach(b=>{T.push(b+name+'.fbx');if(/T_pose$/.test(name))T.push(b+name+'.FBX')});
    const next=()=>{
      if(i>=T.length)return ko(new Error(name+'.fbx introuvable'));
      new THREE.FBXLoader().load(T[i++],ok,undefined,()=>next());
    };next();
  }));
}
const AVRAW={};let avAnimP=null;
function avNeedAnims(){
  const names=Object.keys(AV_ANIM).map(k=>AV_ANIM[k]);
  if(MELEE_FBX)Object.keys(MELEE_ANIMS).forEach(k=>{if(!MELEE_ANIMS[k].ue)names.push(MELEE_ANIMS[k].file)});   // les animations du pack Unreal se chargent à part (ueWarm)
  Object.keys(AV_LOOP).forEach(k=>names.push(AV_LOOP[k]));
  ueWarm();
  return avAnimP||(avAnimP=Promise.all(names.filter((n,i)=>names.indexOf(n)===i).map(n=>
    avLoad(n).then(o=>{const c=o.animations&&o.animations[0];if(c)AVRAW[n]=c;delete avFiles[n]})
      .catch(()=>console.warn('[arène] animation absente :',n)))));
}

/* ====================================================================
   PACK RamsterZ (squelette Unreal) -> personnages Mixamo   (v5)
   Les 40 animations de assets/RamsterZ_EpicMegaJam_2022/ n'ont pas les mêmes os que Mixamo :
   elles sont RETARGETÉES ici (pelvis -> Hips, upperarm_l -> LeftArm…) en s'appuyant sur T_pose.FBX.
   Chargement paresseux en arrière-plan (ueWarm) pour ne pas retarder le début de partie.
   ==================================================================== */
const UE_MAP={pelvis:'Hips',spine_01:'Spine',spine_02:'Spine1',spine_03:'Spine2',neck_01:'Neck',head:'Head',
  clavicle_l:'LeftShoulder',upperarm_l:'LeftArm',lowerarm_l:'LeftForeArm',hand_l:'LeftHand',
  clavicle_r:'RightShoulder',upperarm_r:'RightArm',lowerarm_r:'RightForeArm',hand_r:'RightHand',
  thigh_l:'LeftUpLeg',calf_l:'LeftLeg',foot_l:'LeftFoot',ball_l:'LeftToeBase',
  thigh_r:'RightUpLeg',calf_r:'RightLeg',foot_r:'RightFoot',ball_r:'RightToeBase'};
const MX2UE={};for(const u in UE_MAP)MX2UE[UE_MAP[u]]=u;
const UE_PAR={Spine:'Hips',Spine1:'Spine',Spine2:'Spine1',Neck:'Spine2',Head:'Neck',
  LeftShoulder:'Spine2',LeftArm:'LeftShoulder',LeftForeArm:'LeftArm',LeftHand:'LeftForeArm',
  RightShoulder:'Spine2',RightArm:'RightShoulder',RightForeArm:'RightArm',RightHand:'RightForeArm',
  LeftUpLeg:'Hips',LeftLeg:'LeftUpLeg',LeftFoot:'LeftLeg',LeftToeBase:'LeftFoot',
  RightUpLeg:'Hips',RightLeg:'RightUpLeg',RightFoot:'RightLeg',RightToeBase:'RightFoot'};
const UE_ORDER=['Hips','Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand',
  'RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];
let AVTP=null,UETP=null,ueWarmed=false;const UEL={};
function ueTPose(){
  if(AVTP!==null)return Promise.resolve(AVTP);
  return UETP||(UETP=avLoad(UE_DIR+'T_pose').then(o=>{AVTP=o;delete avFiles[UE_DIR+'T_pose'];return o})
    .catch(()=>{AVTP=false;console.warn('[judo] T_pose.FBX introuvable : pose de repos = 1re image de chaque clip');return false}));
}
function ueLoad(file){
  if(AVRAW[file])return Promise.resolve(true);
  return UEL[file]||(UEL[file]=avLoad(file).then(o=>{const c=o.animations&&o.animations[0];if(c){c.__src=o;AVRAW[file]=c}delete avFiles[file];return !!c})
    .catch(()=>{console.warn('[judo] animation absente :',file);return false}));
}
function ueWarm(){
  if(ueWarmed||!MELEE_FBX||!arena())return;ueWarmed=true;
  const files=Object.keys(MELEE_ANIMS).filter(k=>MELEE_ANIMS[k].ue).map(k=>MELEE_ANIMS[k].file);
  let i=0;const next=()=>{if(i>=files.length)return;ueLoad(files[i++]).then(()=>setTimeout(next,50))};
  setTimeout(()=>{ueTPose().then(()=>{next();next()})},2500);
}
function ueClip(info,file,raw){
  const id=file+'|ue';if(info.cl[id])return info.cl[id];
  if(AVTP===null){ueTPose();return null}                                  // T-pose pas encore chargée : on réessaiera
  try{
    const src=raw.__src,tp=AVTP||src,B=info.bones,hips=B&&B.get('Hips');if(!src||!hips)return null;
    const byName=g=>{const m={};g.traverse(n=>{if(n.name)m[n.name]=n});return m};
    const S=byName(src),T=byName(tp);if(!S.pelvis||!T.pelvis)return null;
    let top=tp;while(top.parent)top=top.parent;top.updateMatrixWorld(true);
    let tr=hips;while(tr.parent)tr=tr.parent;tr.updateMatrixWorld(true);
    const wq=n=>n.getWorldQuaternion(new THREE.Quaternion()),wp=n=>n.getWorldPosition(new THREE.Vector3());
    const basis=(up,side)=>{const e1=up.clone().normalize(),e2=side.clone().sub(e1.clone().multiplyScalar(side.dot(e1))).normalize(),e3=new THREE.Vector3().crossVectors(e1,e2);return new THREE.Matrix4().makeBasis(e1,e2,e3)};
    const Bs=basis(wp(T.head).sub(wp(T.pelvis)),wp(T.thigh_l).sub(wp(T.thigh_r)));
    const Bt=basis(wp(B.get('Head')).sub(wp(hips)),wp(B.get('LeftUpLeg')).sub(wp(B.get('RightUpLeg'))));
    const C=new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().multiplyMatrices(Bt,Bs.clone().transpose())),Ci=C.clone().invert();
    const WsR={},WtR={};
    for(const u in UE_MAP){const b=UE_MAP[u];if(T[u]&&S[u]&&B.get(b)){WsR[u]=wq(T[u]);WtR[b]=wq(B.get(b))}}
    const trk={};raw.tracks.forEach(t=>{const m=/^(.+)\.(position|quaternion)$/.exec(t.name);if(m)(trk[m[1]]||(trk[m[1]]={}))[m[2]]=t});
    if(!trk.pelvis||!trk.pelvis.quaternion)return null;
    const itp={},ev=(n,p,t)=>{const e=trk[n]&&trk[n][p];if(!e)return null;return(itp[n+p]||(itp[n+p]=e.createInterpolant())).evaluate(t)};
    const times=Array.from(trk.pelvis.quaternion.times);
    let curT=0;const memo=new Map(),lq=(n,out)=>{const v=ev(n.name,'quaternion',curT);return v?out.set(v[0],v[1],v[2],v[3]):out.copy(n.quaternion)};
    const worldA=n=>{if(!n)return new THREE.Quaternion();let q=memo.get(n);if(q)return q;q=worldA(n.parent).clone().multiply(lq(n,new THREE.Quaternion()));memo.set(n,q);return q};
    const hpq=hips.parent?wq(hips.parent):new THREE.Quaternion(),H0=wp(hips),Pinv=hips.parent?hips.parent.matrixWorld.clone().invert():new THREE.Matrix4();
    const tpPos=wp(T.pelvis),r=wp(hips).distanceTo(wp(B.get('LeftFoot')))/Math.max(wp(T.pelvis).distanceTo(wp(T.foot_l)),1e-6);
    const path=[];for(let n=S.pelvis;n;n=n.parent)path.unshift(n);
    const pair=/Paired_/.test(file),outQ={},prev={},posV=[],m4=new THREE.Matrix4(),mw=new THREE.Matrix4(),pp=new THREE.Vector3(),qq=new THREE.Quaternion();
    UE_ORDER.forEach(b=>outQ[b]=[]);
    for(const t of times){
      curT=t;memo.clear();const WA={};
      for(const b of UE_ORDER){
        const u=MX2UE[b];if(!WsR[u]||!WtR[b])continue;
        const D=C.clone().multiply(worldA(S[u]).clone().multiply(WsR[u].clone().invert())).multiply(Ci);
        WA[b]=D.multiply(WtR[b]);
        const par=UE_PAR[b],Wp=par?WA[par]:hpq;if(!Wp)continue;
        const L=Wp.clone().invert().multiply(WA[b]);
        if(prev[b]&&prev[b].dot(L)<0)L.set(-L.x,-L.y,-L.z,-L.w);
        prev[b]=L;outQ[b].push(L.x,L.y,L.z,L.w);
      }
      mw.identity();
      for(const n of path){const pv=ev(n.name,'position',t);pp.set(pv?pv[0]:n.position.x,pv?pv[1]:n.position.y,pv?pv[2]:n.position.z);lq(n,qq);m4.compose(pp,qq,n.scale);mw.multiply(m4)}
      const d=new THREE.Vector3().setFromMatrixPosition(mw).sub(tpPos).applyQuaternion(C).multiplyScalar(r);
      if(!pair){d.x=0;d.z=0}                                               // pas de déplacement horizontal sauf pour les prises (couple)
      const w=H0.clone().add(d).applyMatrix4(Pinv);posV.push(w.x,w.y,w.z);
    }
    const tracks=[];
    UE_ORDER.forEach(b=>{if(outQ[b].length===times.length*4&&B.has(b))tracks.push(new THREE.QuaternionKeyframeTrack(info.prefix+b+'.quaternion',times,outQ[b]))});
    tracks.push(new THREE.VectorKeyframeTrack(info.prefix+'Hips.position',times,posV));
    return info.cl[id]=new THREE.AnimationClip(id,Math.max(raw.duration,times[times.length-1]),tracks);
  }catch(e){console.warn('[judo] retarget impossible :',file,e&&e.message||e);return null}
}
function avShrink(t,max){                      // les skins "nonPBR" ont des textures énormes
  const im=t&&t.image;if(!im)return;
  const go=()=>{
    const w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
    if(!w||!h||Math.max(w,h)<=max)return;
    const k=max/Math.max(w,h),c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);t.image=c;t.needsUpdate=true;
  };
  if(im.complete===false&&im.addEventListener)im.addEventListener('load',go,{once:true});else go();
}
function avPrep(name,obj){
  const bones=new Map();let prefix='mixamorig',hips=null;
  obj.traverse(n=>{
    if(n.name&&n.name.indexOf(':')>=0&&/^mixamorig/.test(n.name))n.name=n.name.replace(/:/g,'');
    const m=/^(mixamorig\d*)(.+)$/.exec(n.name||'');
    if(m){bones.set(m[2],n);if(m[2]==='Hips'){prefix=m[1];hips=n}}
    if(n.isMesh){
      n.frustumCulled=false;n.castShadow=false;n.receiveShadow=false;
      (Array.isArray(n.material)?n.material:[n.material]).forEach(mt=>{
        if(!mt)return;mt.side=THREE.DoubleSide;
        ['map','normalMap','specularMap','emissiveMap','alphaMap'].forEach(k=>{if(mt[k])avShrink(mt[k],1024)});
        if(mt.shininess!==undefined)mt.shininess=Math.min(mt.shininess,18);
        if(mt.specular&&mt.specular.multiplyScalar)mt.specular.multiplyScalar(.35);
      });
    }
  });
  obj.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(obj),sz=box.getSize(new THREE.Vector3());
  const rawH=(isFinite(sz.y)&&sz.y>1e-6)?sz.y:170,minY=isFinite(box.min.y)?box.min.y:0;
  return{name,obj,prefix,bones,hipsY:hips?hips.position.y:0,rawH,minY,cl:{}};
}
const avChars={};
function avChar(name){return avChars[name]||(avChars[name]=avLoad(name).then(o=>{delete avFiles[name];return avPrep(name,o)}))}

/* retarget d'un clip Mixamo sur le squelette du perso (couches : 'upper' haut du corps, 'leg' jambes) */
const LEGRE=/(Leg|Foot|Toe)/;
function avClip(info,key,part,freeze){
  const raw=AVRAW[key];if(!raw)return null;
  if(raw.__src)return part==='full'?ueClip(info,key,raw):null;     // clip du pack Unreal : retarget dédié
  const id=key+'|'+part+'|'+(freeze?1:0);if(info.cl[id])return info.cl[id];
  let k=1;const hp=raw.tracks.find(t=>/Hips\.position$/.test(t.name));
  if(hp&&info.hipsY>0&&hp.values[1]>0){
    const r=info.hipsY/hp.values[1];
    if(part==='full'){if(r<.6||r>1.7)k=r}      // clips corps entier : poses de départ basses (ginga…) -> on ne corrige que cm vs m
    else if(Math.abs(r-1)>.08)k=r;
  }
  const out=[];
  for(const t of raw.tracks){
    const m=/^mixamorig\d*:?(.+)\.(position|quaternion|scale)$/.exec(t.name);if(!m)continue;
    const bone=m[1],prop=m[2];
    if(prop==='scale'||!info.bones.has(bone))continue;
    if(prop==='position'&&bone!=='Hips')continue;
    const leg=LEGRE.test(bone);
    if(part==='leg'&&(!leg||prop!=='quaternion'))continue;
    if(part==='upper'&&leg)continue;
    let times=Array.from(t.times),vals=Array.from(t.values);
    if(prop==='position'){const x0=vals[0]*k,z0=vals[2]*k;for(let i=0;i<vals.length;i+=3){vals[i]=x0;vals[i+1]*=k;vals[i+2]=z0}}
    if(freeze){const sz=prop==='position'?3:4;vals=vals.slice(0,sz).concat(vals.slice(0,sz));times=[0,1]}
    out.push(new t.constructor(info.prefix+bone+'.'+prop,times,vals));
  }
  if(!out.length)return null;
  return info.cl[id]=new THREE.AnimationClip(id,freeze?1:raw.duration,out);
}
function avInstance(info){
  const obj=THREE.SkeletonUtils.clone(info.obj),k=AV_H/info.rawH,pivot=new THREE.Group(),root=new THREE.Group();
  pivot.scale.setScalar(k);pivot.position.y=-info.minY*k;pivot.add(obj);root.add(pivot);
  root.rotation.y=Math.PI;                      // les modèles Mixamo regardent vers +Z, le jeu vers -Z
  obj.traverse(n=>{                             // matériaux propres à chaque joueur (flash de touche)
    if(!n.isMesh)return;const arr=Array.isArray(n.material);
    const o=(arr?n.material:[n.material]).map(m=>{if(!m)return m;const c=m.clone();c.skinning=true;return c});
    n.material=arr?o:o[0];
  });
  return{root,obj};
}
/* mini-acteur : une couche "haut du corps" + une couche "jambes" */
function avActor(info,obj){
  const mixer=new THREE.AnimationMixer(obj),A={mixer,up:null,lo:null,act:{},info};
  const mk=(n,key,part,freeze,once)=>{
    const c=avClip(info,key,part,freeze);if(!c)return;
    const a=mixer.clipAction(c);a.setLoop(once?THREE.LoopOnce:THREE.LoopRepeat,once?1:Infinity);a.clampWhenFinished=!!once;A.act[n]=a;
  };
  mk('upIdle',AV_ANIM.pose,'upper',true);mk('loIdle',AV_ANIM.pose,'leg',true);
  mk('loWalk',AV_ANIM.walk,'leg',false);mk('loRun',AV_ANIM.run,'leg',false);
  mk('melee',AV_ANIM.melee,'upper',false,true);
  mk('f_fall',AV_LOOP.fall,'full',false);mk('f_climb',AV_LOOP.climb,'full',false);
  if(MELEE_FBX)for(const key in MELEE_ANIMS)if(!MELEE_ANIMS[key].ue)mk('f_'+key,MELEE_ANIMS[key].file,'full',false,true);   // animations de combat : corps entier
  mixer.addEventListener('finished',e=>{
    if(e.action===A.act.melee&&A.up==='melee')avSet(A,'up','upIdle',.15);
    if(A.fa&&e.action===A.fa)avFullEnd(A);
  });
  return A;
}
/* joue une animation de combat "corps entier" : elle remplace haut du corps + jambes jusqu'à sa fin */
function avFull(A,key){
  const cfg=MELEE_ANIMS[key];let a=cfg&&A.act['f_'+key];
  if(cfg&&!a&&cfg.ue){                                                  // clip du pack Unreal : créé à la demande (chargé en arrière-plan)
    ueLoad(cfg.file);const c=A.info&&avClip(A.info,cfg.file,'full',false);
    if(c){a=A.mixer.clipAction(c);a.setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;A.act['f_'+key]=a}
  }
  if(!cfg||!a)return false;
  if(cfg.loop){a.setLoop(THREE.LoopRepeat,Infinity);a.clampWhenFinished=false}   // à 4 pattes : boucle (maintenue en vie par les messages 'an')
  if(A.lp){const o=A.act[A.lp];if(o)o.fadeOut(.08);A.lp=null;A.up=null;A.lo=null}
  if(A.fa&&A.fk===key){if(cfg.loop)A.ft=0;return true}                                     // déjà en cours : on ne la relance pas
  if(A.fa)A.fa.fadeOut(.08);
  ['up','lo'].forEach(l=>{const o=A.act[A[l]];if(o)o.fadeOut(.08);A[l]=null});
  a.reset();a.time=cfg.from||0;a.setEffectiveWeight(1);a.setEffectiveTimeScale(cfg.ts||1);a.fadeIn(.06);a.play();
  A.fa=a;A.fk=key;A.ft=0;A.fe=cfg.loop?1.2:Math.max(.25,((cfg.to||a.getClip().duration)-(cfg.from||0))/(cfg.ts||1));
  return true;
}
function avFullEnd(A){
  if(!A.fa)return;
  A.fa.fadeOut(.14);A.fa=null;A.fk=null;A.up=null;A.lo=null;          // tickRemotes relance les jambes ; on relance le haut du corps ici
  avSet(A,'up','upIdle',.14);
}
function avSet(A,layer,name,fade){
  if(A[layer]===name)return;
  const old=A.act[A[layer]],nw=A.act[name];
  if(old){if(fade>0)old.fadeOut(fade);else old.stop()}
  if(nw){nw.reset();nw.setEffectiveWeight(1);if(fade>0)nw.fadeIn(fade);nw.play()}
  A[layer]=name;
}

/* skin FBX d'un joueur distant (net.sk[id] est envoyé par le réseau ; repli = skin par défaut, comme le lobby) */
function skinFbx(id){
  const list=window.NL_SKINS||[],sid=(net.sk||{})[id];
  const s=list.find(k=>k.id===sid)||list[0];
  return s&&s.fbx||null;
}
function avStart(id,q){
  if(typeof THREE.FBXLoader!=='function'||!THREE.SkeletonUtils)return;
  const nm=skinFbx(id);if(!nm)return;
  Promise.all([avNeedAnims(),avChar(nm)]).then(r=>{if(net.pl[id]===q&&!q.fb)avBuild(q,r[1])})
    .catch(e=>console.warn('[arène] modèle adversaire non chargé, cubes conservés :',nm,e&&e.message||e));
}
function avBuild(q,info){
  const inst=avInstance(info),bone=findHandBone(inst.obj);
  if(!bone){console.warn('[arène] pas d\'os de main : cubes conservés');return}
  q.g.add(inst.root);q.g.updateMatrixWorld(true);
  const sc=new THREE.Vector3();bone.getWorldScale(sc);                 // les rigs FBX sont souvent à l'échelle 0.01
  const fr=handFrame(bone);fr.comp=1/(sc.x||1);                        // -> l'arme garde sa taille réelle en mètres
  const A=avActor(info,inst.obj);avSet(A,'up','upIdle',0);avSet(A,'lo','loIdle',0);A.mixer.update(.01);
  const mats=[];inst.obj.traverse(n=>{if(n.isMesh)[].concat(n.material).forEach(m=>{if(m&&m.emissive)mats.push(m)})});
  q.meshes.forEach(m=>{m.visible=false});                              // les cubes restent comme zones de touche invisibles
  Object.assign(q,{fb:inst,A,bone,fr,mats,lo:'loIdle',vs:0,fl:undefined,
    arm:findBone(inst.obj,/RightArm$/),fore:findBone(inst.obj,/RightForeArm$/)});
  if(q.wpn){bone.add(q.wpn)}                                            // l'arme passe de la main-cube à l'os
  mountWeapon(q);
}

/* ---------- arme ---------- */
const ANCACHE={};
function makeWeapon(){
  if(window.WEAPON_GLB&&WEAPON_GLB.has(WEAPON_KEY)){const w=WEAPON_GLB.held(WEAPON_KEY);w.rotation.set(0,0,0);return{w,glb:true}}
  const w=new THREE.Group();w.add(new THREE.Mesh(new THREE.BoxGeometry(.95,.05,.014),new THREE.MeshBasicMaterial({color:0xcfd6dd})));
  return{w,glb:false};
}
function ensureWeapon(q){
  const glb=!!(window.WEAPON_GLB&&WEAPON_GLB.has(WEAPON_KEY));
  if(q.wpn&&(q.wpnGlb||!glb))return;
  if(q.wpn&&q.wpn.parent)q.wpn.parent.remove(q.wpn);                   // remplace la lame de secours par le vrai katana
  const m=makeWeapon(),k=m.glb?'glb':'box';
  q.wpn=m.w;q.wpnGlb=m.glb;q.an=ANCACHE[k]||(ANCACHE[k]=analyzeWeapon(m.w)||DEFAULT_AN);
  (q.bone||q.hand).add(q.wpn);mountWeapon(q);
}
function mountWeapon(q){if(q.wpn&&q.an)mountMath(q.wpn,q.fr||BOX_FRAME,q.an,WEAPON_TWEAK)}

/* ---------- joueurs distants ---------- */
const _mk=mkPl;
mkPl=function(id,name){
  const q=_mk(id,name);
  q.meshes[q.meshes.length-1].visible=false;                           // boîte "arme" d'origine
  /* repli cubes : bras droit sur un pivot d'épaule + "main" au bout du bras */
  const arm=q.meshes[11],shoulder=new THREE.Group(),hand=new THREE.Group();
  shoulder.position.set(.46,1.725,-.3);q.g.add(shoulder);
  arm.position.set(0,-.325,0);shoulder.add(arm);
  hand.position.set(0,-.65,0);shoulder.add(hand);
  Object.assign(q,{hand,shoulder,legs:[q.meshes[0],q.meshes[1]],feet:[q.meshes[2],q.meshes[3]],
    px:0,pz:0,ph:0,sw:0,swReq:0,blk:false,bk:0,flash:0,hp0:100});
  return q;
};
const _ax=new THREE.Vector3(),_qa=new THREE.Quaternion(),_qb=new THREE.Quaternion(),_qc=new THREE.Quaternion();
function bendBone(bone,model,ang){                                     // rotation autour de l'axe latéral du MODÈLE, quel que soit le rig
  if(!bone||!bone.parent)return;
  /* le mixer ne réécrit pas un os dont la valeur animée ne change pas (poses figées) :
     on mémorise la valeur animée ("base") pour repartir d'elle à chaque frame, sans cumul */
  const u=bone.userData,base=u.bBase||(u.bBase=new THREE.Quaternion()),out=u.bOut||(u.bOut=new THREE.Quaternion());
  if(u.bSet&&bone.quaternion.equals(out))bone.quaternion.copy(base);else base.copy(bone.quaternion);
  u.bSet=false;if(Math.abs(ang)<1e-3)return;
  bone.parent.getWorldQuaternion(_qa);model.getWorldQuaternion(_qb);
  _ax.set(1,0,0).applyQuaternion(_qb).applyQuaternion(_qa.invert());
  bone.quaternion.premultiply(_qc.setFromAxisAngle(_ax,ang));
  out.copy(bone.quaternion);u.bSet=true;
}
let avBudget=1;
function tickRemotes(dt){
  avBudget=1;                                                          // (v7) un seul avatar FBX construit par image
  for(const id in net.pl){
    const q=net.pl[id];if(!q.hand)continue;
    if(q.pin){if(performance.now()<q.pin.until){q.x=q.tx=q.pin.x;q.z=q.tz=q.pin.z;q.r=q.pin.r}else q.pin=null}   // prise en cours : avatar calé sur l'attaquant
    if(!q.fbS&&avBudget>0){avBudget--;q.fbS=1;avStart(id,q)}
    if(mode==='pvp'){ensureWeapon(q);mountWeapon(q)}
    const sp=Math.min(12,Math.hypot(q.x-q.px,q.z-q.pz)/Math.max(dt,1e-3));q.px=q.x;q.pz=q.z;
    let k=0;if(q.sw>0){q.sw-=dt;k=Math.sin((1-Math.max(0,q.sw)/SWING_DUR)*Math.PI)}
    q.bk+=((q.blk?1:0)-q.bk)*Math.min(1,dt*18);
    if(q.hp<q.hp0-.5)q.flash=.15;q.hp0=q.hp;q.flash=Math.max(0,q.flash-dt);
    if(q.fb){
      const A=q.A;
      if(ANIM_ROLL&&q.rl&&!q.rlP)avFull(A,'dodge');                     // roulade d'un adversaire -> salto arrière
      q.rlP=q.rl;
      if(q.anReq){const an=q.anReq;q.anReq='';avFull(A,an)}             // animation seule reçue ('an' : glissade, takedown…)
      if(q.swReq){                                                      // coup reçu par le réseau -> anim de frappe
        q.swReq=0;const an=q.swAn;q.swAn='';
        if(!(an&&avFull(A,an))){                                        // pas d'animation FBX dédiée -> animation "torche" d'origine
          const m=A.act.melee;
          if(m&&!A.fa){m.setEffectiveTimeScale(1.8);if(A.up==='melee'){m.reset();m.setEffectiveWeight(1);m.play()}else avSet(A,'up','melee',.05)}
        }
      }
      q.vs+=(sp-q.vs)*Math.min(1,dt*10);const v=q.vs;
      if(A.fa){A.ft+=dt;if(A.ft>=A.fe)avFullEnd(A)}                    // animation corps entier : fin au "to" configuré
      {let want=(!A.fa&&q.mvs===4)?'f_fall':(!A.fa&&q.mvs===5)?'f_climb':null;       // chute libre / grimpe d'un adversaire
        if(want&&!A.act[want])want=null;
        if(want!==(A.lp||null)){
          if(A.lp){const o=A.act[A.lp];if(o)o.fadeOut(.15)}
          if(want){['up','lo'].forEach(l=>{const o=A.act[A[l]];if(o)o.fadeOut(.15);A[l]=null});const n=A.act[want];n.reset();n.setEffectiveWeight(1);n.fadeIn(.15);n.play();A.lp=want}
          else{A.lp=null;A.up=null;A.lo=null;avSet(A,'up','upIdle',.15)}
        }}
      if(!A.fa&&!A.lp){                                                 // jambes : idle / marche / course (avec hystérésis)
        let lo=q.lo;
        if(lo==='loIdle'){if(v>.9)lo='loWalk'}
        else if(lo==='loWalk'){if(v<.4)lo='loIdle';else if(v>3.2)lo='loRun'}
        else if(v<2.8)lo=v<.4?'loIdle':'loWalk';
        q.lo=lo;const use=A.act[lo]?lo:'loIdle';avSet(A,'lo',use,.2);
        if(use==='loWalk')A.act.loWalk.setEffectiveTimeScale(avCl(v/1.5,.8,1.8));
        else if(use==='loRun')A.act.loRun.setEffectiveTimeScale(avCl(v/3.8,.8,1.5));
      }
      if(q.al)A.mixer.update(dt);
      q.slK=(q.slK||0)+((q.mvs===1?1:0)-(q.slK||0))*Math.min(1,dt*12);                // glissade d'un adversaire : corps penché en arrière
      const tilt=(A.fa&&A.fk==='slide')?0:q.slK;                                      // (l'animation de glissade penche déjà le corps)
      q.fb.root.rotation.x=1.1*tilt;q.fb.root.position.y=.18*tilt;
      if(q.al&&!A.fa&&!A.lp){bendBone(q.arm,q.fb.obj,q.bk>.02?-1.15*q.bk:0);bendBone(q.fore,q.fb.obj,q.bk>.02?-1.0*q.bk:0)}   // garde : bras levé, arme devant
      const fl=q.flash>0?0x771111:0;
      if(q.fl!==fl){q.fl=fl;q.mats.forEach(m=>m.emissive.setHex(fl))}
    }else{                                                              // repli cubes
      q.ph+=dt*Math.min(sp,9)*1.5;const amp=Math.min(1,sp/4)*.75,s=Math.sin(q.ph)*amp;
      q.legs[0].rotation.x=s;q.legs[1].rotation.x=-s;q.feet[0].rotation.x=s;q.feet[1].rotation.x=-s;
      q.shoulder.rotation.set(2.4*k+1.2*q.bk,0,-.5*q.bk);
      const t=q.meshes[4];if(t&&t.material&&t.material.emissive)t.material.emissive.setHex(q.flash>0?0x771111:0);
    }
  }
}

/* ====================================================================
   MOUVEMENT & STYLE  —  Mirror of Fate (A) + Mirror's Edge (B)
   --------------------------------------------------------------------
   A · Mirror of Fate : double saut, réception LOURDE (poussière, pause,
       caméra qui plonge), CROIX DE COMBAT = grappin à chaîne (balancier,
       treuillage, inertie conservée), le coup "embarque" le joueur (fente),
       ESQUIVE PARFAITE (roulade au bon timing -> ralenti + contre).
   B · Mirror's Edge  : WALL-RUN + saut mural, GLISSADE (+ tacle),
       coup de pied sauté / glissé (le coup dépend du mouvement), élan de
       course, FLOU DE VITESSE + FOV, ÉCHO rouge du coureur, balancement
       de caméra, roulade de réception (Ctrl juste avant l'impact).
   Commandes : Espace en l'air = double saut · H = grappin (re-appuyer ou
   Espace = lâcher) · Shift en courant = glissade · Ctrl = roulade/esquive.
   Tout est réglable / désactivable dans MV (MV.on=false coupe tout).
   ==================================================================== */
const MV={
  on:true,
  doubleJump:true, airJump:.82,                 // A : force du 2e saut (fraction du saut normal)
  heavy:true,                                   // A : réception lourde
  climb:true, fallAnim:true, fallAlt:2.0,        // grimpe (double saut près d'un rebord) + animation de chute libre (altitude mini en m)
  hook:true, hookKey:'KeyH', hookRange:26, hookReel:5.5,   // A : Croix de combat (portée m, treuil m/s)
  lunge:true,                                   // A : le coup embarque le joueur
  dodge:true,                                   // A : esquive parfaite
  slide:true, slideSpeed:9, slideKick:true,     // B : glissade + tacle
  wall:true, wallDur:1.5,                       // B : wall-run
  kick:true,                                    // B : coup de pied sauté / glissé
  momentum:.25,                                 // B : élan de course (+25 % après ~1,6 s)
  echo:true, blur:true, bob:true,               // B : écho rouge, flou de vitesse, balancement
  rollLand:.3                                   // B : fenêtre (s) de la roulade de réception
};
const mv={air:1,wasG:true,fall:0,slide:0,mx:0,mz:0,wall:0,wt:0,wcool:0,wlost:0,wnx:0,wnz:0,wtx:0,wtz:0,wside:1,
  gr:null,stag:0,dip:0,run:0,blur:0,rollP:-1e9,hookReq:false,prev:{},kicked:null,echoT:0,code:0,bobT:0,rs:1,wasRoll:false,hint:0,cl:null,fl:0};
let mvFov=0,mvRollNow=0,mvRollAdd=0,mvErr=0;
const _m1=new THREE.Vector3(),_m2=new THREE.Vector3(),_m3=new THREE.Vector3(),_mUp=new THREE.Vector3(0,1,0);
const inVeh=()=>typeof V!=='undefined'&&V&&V.cur;
const mvLive=()=>MV.on&&state==='PLAYING'&&!selfDead&&!inVeh();
const mvEdge=(n,v)=>{const r=!!v&&!mv.prev[n];mv.prev[n]=!!v;return r};
const fwdIn=()=>joy.f+(keys.KeyW||keys.KeyZ||keys.ArrowUp?1:0)-(keys.KeyS||keys.ArrowDown?1:0);
const sideIn=()=>joy.r+(keys.KeyD||keys.ArrowRight?1:0)-(keys.KeyA||keys.KeyQ||keys.ArrowLeft?1:0);
const mvCap=()=>{const m=Math.hypot(mv.mx,mv.mz);if(m>14){mv.mx*=14/m;mv.mz*=14/m}};

/* variantes de coup : le coup dépend du mouvement (coup de pied sauté / glissé) */
const MVV={};
function variant(b,kind){
  const key=kind+(b===MS.punch?'p':b===MS.batte?'b':'k');
  return MVV[key]||(MVV[key]={dmg:b.dmg*(kind==='air'?1.35:1.2),range:b.range+.3,cos:Math.max(.1,b.cos-.12),kb:b.kb*1.5,base:b,kind});
}
function statsNow(){
  const b=heldFists()?MS.punch:(MS[weaponKey]||MS.katana);
  if(!MV.on||!MV.kick||!mvLive())return b;
  if(mv.slide>0)return variant(b,'slide');
  if(!grounded)return variant(b,'air');
  return b;
}

/* ---------- Croix de combat : chaîne + balancier ---------- */
const chainGeo=new THREE.CylinderGeometry(.028,.028,1,6);chainGeo.translate(0,.5,0);
const chainMat=new THREE.MeshBasicMaterial({color:0xdfe6ee,fog:false}),hookMat=new THREE.MeshBasicMaterial({color:0xffd060,fog:false});
let chainM=null,hookM=null;
function chainShow(on){
  if(on&&!chainM){
    chainM=new THREE.Mesh(chainGeo,chainMat);hookM=new THREE.Mesh(new THREE.SphereGeometry(.1,8,6),hookMat);
    chainM.frustumCulled=hookM.frustumCulled=false;scene.add(chainM);scene.add(hookM);
  }
  if(chainM)chainM.visible=hookM.visible=!!on;
}
function chainUpdate(){
  const g=mv.gr;if(!g){if(chainM&&chainM.visible)chainShow(false);return}
  chainShow(true);
  const pp=playerMesh.position,h=_m1.set(pp.x,pp.y+1.35,pp.z);
  const e=_m2.set(g.ax,g.ay,g.az).sub(h).multiplyScalar(g.ext).add(h);
  const d=_m3.copy(e).sub(h),len=d.length()||.001;
  chainM.position.copy(h);chainM.quaternion.setFromUnitVectors(_mUp,d.multiplyScalar(1/len));chainM.scale.set(1,len,1);hookM.position.copy(e);
}
function hookFire(){
  if(!MV.hook||mv.gr||rolling||stunT>0||blockOn)return;
  _ray.setFromCamera({x:0,y:0},camera);_ray.far=MV.hookRange+8;
  const hits=_ray.intersectObjects(solidMeshes,false),pp=playerMesh.position;
  let h=null;for(const x of hits){const d=x.point.distanceTo(pp);if(d>3&&d<=MV.hookRange){h=x;break}}
  if(!h){toast('🪝 Rien à portée','#9ca3af');return}
  mv.gr={ax:h.point.x,ay:h.point.y,az:h.point.z,ext:0,t:0,att:false,L:0,vx:0,vy:0,vz:0};
  mv.slide=0;mv.wall=0;SFX.toss&&SFX.toss();
}
function hookStep(dt,jump){                       // renvoie true quand le grappin pilote le joueur
  const g=mv.gr,p=player.pos;g.t+=dt;
  if(!g.att){                                     // la chaîne est projetée (0,12 s), le joueur reste libre
    g.ext=Math.min(1,g.ext+dt/.12);
    if(g.ext>=1){
      g.att=true;g.L=Math.max(3,Math.hypot(g.ax-p.x,g.ay-(p.y+1.3),g.az-p.z));
      g.vx=player.vel.x+mv.mx;g.vz=player.vel.z+mv.mz;g.vy=Math.max(player.vy,grounded?4:-3);mv.mx=mv.mz=0;
      if(grounded){grounded=false;p.y+=.05}
      burst(new THREE.Vector3(g.ax,g.ay,g.az),8,pMat.spark,3);SFX.wall&&SFX.wall();shakeT=Math.max(shakeT,.12);
    }
    return false;
  }
  if(jump){hookRelease(true);return false}
  g.vy-=GRAV*.8*dt;
  const f=fwdIn(),r=sideIn();                     // contrôle aérien léger pendant le balancement
  g.vx+=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*5*dt;g.vz+=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*5*dt;
  const sp=Math.hypot(g.vx,g.vy,g.vz);if(sp>20){const k=20/sp;g.vx*=k;g.vy*=k;g.vz*=k}
  p.x+=g.vx*dt;p.y+=g.vy*dt;p.z+=g.vz*dt;
  const dx=p.x-g.ax,dy=p.y+1.3-g.ay,dz=p.z-g.az,d=Math.hypot(dx,dy,dz)||.001;   // corde tendue : balancier
  if(d>g.L){
    const nx=dx/d,ny=dy/d,nz=dz/d;p.x=g.ax+nx*g.L;p.z=g.az+nz*g.L;p.y=g.ay+ny*g.L-1.3;
    const vr=g.vx*nx+g.vy*ny+g.vz*nz;if(vr>0){g.vx-=nx*vr;g.vy-=ny*vr;g.vz-=nz*vr}
  }
  g.L=Math.max(2.2,g.L-MV.hookReel*dt);          // treuil : on se hisse peu à peu
  player.vy=0;player.vel.set(0,0,0);
  if(g.L<=2.5){hookRelease(false,true);return false}
  return true;
}
function hookRelease(jump,hoist){
  const g=mv.gr;if(!g)return;mv.gr=null;chainShow(false);
  if(!g.att)return;
  mv.mx=g.vx;mv.mz=g.vz;player.vy=g.vy+(jump?JUMP_V*.4:0);mv.air=MV.doubleJump?1:0;   // l'inertie est conservée
  if(hoist&&g.ay>player.pos.y+.4){                // arrivée en haut : on s'agrippe et on se hisse
    player.vy=Math.max(player.vy,JUMP_V*1.05);
    const d=Math.hypot(g.ax-player.pos.x,g.az-player.pos.z)||1;mv.mx+=(g.ax-player.pos.x)/d*3.2;mv.mz+=(g.az-player.pos.z)/d*3.2;
  }
  mvCap();SFX.jump&&SFX.jump();
}

/* ---------- Grimpe : saut près d'un rebord -> accroche + traction (animation Climbing) ---------- */
function ledgeNow(){
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
  return window.__PVPQ?window.__PVPQ.ledge(player.pos.x,player.pos.y,player.pos.z,fx,fz):null;
}
function climbStart(L){
  const sy=player.pos.y,hangY=Math.max(sy,L.top-1.6),A=Math.max(.12,(hangY-sy)/5.5),B=.85;
  const dx=L.lx-player.pos.x,dz=L.lz-player.pos.z;
  mv.cl={t:0,A,B,sx:player.pos.x,sz:player.pos.z,sy,hy:hangY,hx:L.hx,hz:L.hz,top:L.top,lx:L.lx,lz:L.lz,yw:Math.atan2(-dx,-dz)};
  mv.mx=mv.mz=0;mv.slide=0;mv.wall=0;player.vel.set(0,0,0);player.vy=0;
  SFX.jump&&SFX.jump();burst(new THREE.Vector3(player.pos.x,player.pos.y+1.2,player.pos.z),5,pMat.dust,2);
}
function climbPose(){
  const c=mv.cl;if(!c)return;
  const ez=u=>u*u*(3-2*u);let x,y,z;
  if(c.t<c.A){const u=ez(Math.min(1,c.t/c.A));x=c.sx+(c.hx-c.sx)*u;z=c.sz+(c.hz-c.sz)*u;y=c.sy+(c.hy-c.sy)*u}
  else{
    const u=Math.min(1,(c.t-c.A)/c.B);y=c.hy+(c.top-c.hy)*(1-(1-u)*(1-u));
    const w=u<.45?0:ez((u-.45)/.55);x=c.hx+(c.lx-c.hx)*w;z=c.hz+(c.lz-c.hz)*w;
  }
  player.pos.set(x,y,z);player.vy=0;player.vel.set(0,0,0);grounded=false;
}
function climbStep(dt){
  const c=mv.cl;
  if(selfDead||stunT>0||rolling){mv.cl=null;mv.wcool=.4;return}
  c.t+=dt;
  if(c.t>=c.A+c.B){
    player.pos.set(c.lx,c.top,c.lz);player.vy=0;mv.cl=null;mv.wcool=.3;mv.mx=mv.mz=0;
    burst(new THREE.Vector3(c.lx,c.top+.1,c.lz),6,pMat.dust,2.2);SFX.land&&SFX.land();return;
  }
  climbPose();
}

/* ---------- Wall-run ---------- */
function wallProbe(){
  const px=player.pos.x,pz=player.pos.z,py=player.pos.y;let best=null,bd=.7;
  for(const b of boxes){
    if(b.top<py+1.8)continue;
    if(Math.abs(px-b.x)>b.hx+bd||Math.abs(pz-b.z)>b.hz+bd)continue;
    const cx=clamp(px,b.x-b.hx,b.x+b.hx),cz=clamp(pz,b.z-b.hz,b.z+b.hz),dx=px-cx,dz=pz-cz,d=Math.hypot(dx,dz);
    if(d<bd&&d>1e-3){bd=d;best={nx:dx/d,nz:dz/d}}
  }
  return best;
}
function wallEnd(){mv.wall=0;mv.wcool=.35}
function wallJump(){
  mv.mx=mv.wnx*6+mv.wtx*3.5;mv.mz=mv.wnz*6+mv.wtz*3.5;player.vy=JUMP_V*.95;mv.wall=0;mv.wcool=.45;mv.air=MV.doubleJump?1:0;
  SFX.jump&&SFX.jump();burst(new THREE.Vector3(player.pos.x-mv.wnx*.4,player.pos.y+1,player.pos.z-mv.wnz*.4),6,pMat.dust,2.5);echoSpawn(0xff2a3a);mvCap();
}
function wallStep(dt){
  const f=fwdIn();
  if(mv.wall>0){
    const w=wallProbe();if(w){mv.wlost=0;mv.wnx=w.nx;mv.wnz=w.nz}else mv.wlost+=dt;
    mv.wt+=dt;
    if(grounded||mv.wlost>.14||mv.wt>MV.wallDur||f<=.2){wallEnd();return}
    const fx=-Math.sin(yaw),fz=-Math.cos(yaw),d=fx*mv.wnx+fz*mv.wnz;
    let tx0=fx-mv.wnx*d,tz0=fz-mv.wnz*d;const l=Math.hypot(tx0,tz0)||1;tx0/=l;tz0/=l;
    mv.wtx=tx0;mv.wtz=tz0;mv.mx=tx0*5.6;mv.mz=tz0*5.6;
    player.vy=mv.wt<.3?Math.max(player.vy,2.8):Math.max(player.vy,-1.4);       // il monte puis glisse le long du mur
    player.pos.x-=mv.wnx*.7*dt;player.pos.z-=mv.wnz*.7*dt;                      // reste collé
    return;
  }
  if(grounded||mv.wcool>0||f<=.3||rolling||mv.gr)return;
  if(player.pos.y-groundAt(player.pos.x,player.pos.z,player.pos.y)<.6)return;
  if(Math.hypot(player.vel.x+mv.mx,player.vel.z+mv.mz)<2.2)return;
  const w=wallProbe();if(!w)return;
  const fx=-Math.sin(yaw),fz=-Math.cos(yaw);if(Math.abs(fx*w.nx+fz*w.nz)>.75)return;   // de face : pas de wall-run
  const rx=Math.cos(yaw),rz=-Math.sin(yaw);
  mv.wall=1;mv.wt=0;mv.wlost=0;mv.wnx=w.nx;mv.wnz=w.nz;mv.wside=-(w.nx*rx+w.nz*rz)>0?1:-1;mv.air=MV.doubleJump?1:0;
  burst(new THREE.Vector3(player.pos.x-w.nx*.4,player.pos.y+1,player.pos.z-w.nz*.4),5,pMat.dust,2);
}

/* ---------- glissade / saut / élan ---------- */
function trySlide(){
  if(mv.slide>0||!grounded||rolling||stunT>0||blockOn||mv.gr)return;
  const sp=Math.hypot(player.vel.x,player.vel.z);if(sp<3.2)return;
  const v=Math.max(MV.slideSpeed,sp*1.6);mv.mx=player.vel.x/sp*v;mv.mz=player.vel.z/sp*v;mv.slide=.8;mv.kicked=new Set();
  SFX.roll&&SFX.roll();burst(new THREE.Vector3(player.pos.x,.1,player.pos.z),7,pMat.dust,2.6);echoSpawn(0xff2a3a);
  if(MELEE_FBX&&arena())animAll('slide');                                          // balayage au sol (vu par les adversaires)
}
function airJump(){
  mv.air--;player.vy=JUMP_V*MV.airJump;SFX.jump&&SFX.jump();
  const p=player.pos;burst(new THREE.Vector3(p.x,p.y+.1,p.z),7,pMat.dust,2.4);zoomK=Math.max(zoomK,.3);echoSpawn(0xff2a3a);
}
const slideSt={dmg:12,range:1.5,cos:.2,kb:7,base:null};
function slideKick(){
  const yv=Math.atan2(-mv.mx,-mv.mz),a={x:player.pos.x,y:player.pos.y,z:player.pos.z};
  for(const id in net.pl){
    const q=net.pl[id];if(!q.al||mv.kicked.has(id))continue;
    const h=hitTest(a,{x:q.x,y:q.y,z:q.z},slideSt,yv);if(!h||!clearLOS(a.x,a.z,q.x,q.z,h.dist))continue;
    mv.kicked.add(id);land(id,q,slideSt,h);toast('🦵 TACLE','#fbbf24');
  }
}
function mvMove(dt){                                // inertie : poussée + frottement (sol / glissade / air)
  const m=Math.hypot(mv.mx,mv.mz);if(m<.05){mv.mx=mv.mz=0;return}
  player.pos.x+=mv.mx*dt;player.pos.z+=mv.mz*dt;
  if(mv.wall>0)return;
  const k=Math.exp(-(grounded?(mv.slide>0?2.3:7):.45)*dt);mv.mx*=k;mv.mz*=k;
}

/* ---------- avant le moteur : décisions + déplacements ---------- */
function mvPre(dt){
  if(!mvLive()){mvReset();return}
  const sp=mvEdge('sp',keys.Space),sh=mvEdge('sh',keys.ShiftLeft||keys.ShiftRight),hkE=mvEdge('hk',keys[MV.hookKey]),ct=mvEdge('ct',keys.ControlLeft||keys.ControlRight);
  const hk=hkE||mv.hookReq;mv.hookReq=false;
  if(ct)mv.rollP=performance.now();
  mv.fall=Math.max(0,-player.vy);mv.wcool=Math.max(0,mv.wcool-dt);
  if(grounded)mv.air=MV.doubleJump?1:0;
  if(mv.cl){climbStep(dt);return}
  if(sp&&MV.climb&&!grounded&&!rolling&&stunT<=0&&!mv.gr&&!blockOn){const L=ledgeNow();if(L){climbStart(L);return}}   // double saut près d'un rebord = traction
  if(MV.hook&&hk){if(mv.gr)hookRelease(false);else hookFire()}
  if(mv.gr&&hookStep(dt,sp))return;                 // le grappin pilote le joueur
  if(sp){
    if(mv.wall>0)wallJump();
    else if(!mv.wasG&&!grounded&&mv.air>0&&!rolling&&MV.doubleJump)airJump();
  }
  if(sh&&MV.slide)trySlide();
  if(MV.wall)wallStep(dt);
  if(mv.stag>0){mv.stag-=dt;player.vel.multiplyScalar(Math.exp(-9*dt));mv.mx*=Math.exp(-6*dt);mv.mz*=Math.exp(-6*dt)}   // réception lourde
  const f=fwdIn(),mov=Math.hypot(player.vel.x,player.vel.z);                                                         // élan de course
  if(grounded&&mv.slide<=0&&!rolling&&f>.3&&mov>3.3&&!blockOn&&!ads)mv.run=Math.min(1,mv.run+dt/1.6);
  else mv.run=Math.max(0,mv.run-dt*(grounded?2.5:.4));
  if(MV.momentum>0&&mv.run>0&&grounded){player.pos.x+=player.vel.x*mv.run*MV.momentum*dt;player.pos.z+=player.vel.z*mv.run*MV.momentum*dt}
  mvMove(dt);
}

/* ---------- Écho du coureur (silhouette rouge qui s'efface) ---------- */
const ECHOS=[],EG={
  torso:new THREE.BoxGeometry(.5,.7,.28),head:new THREE.BoxGeometry(.26,.28,.26),
  leg:(()=>{const g=new THREE.BoxGeometry(.2,.8,.22);g.translate(0,-.4,0);return g})(),
  arm:(()=>{const g=new THREE.BoxGeometry(.16,.62,.16);g.translate(0,-.31,0);return g})()
};
function echoPose(){
  const ph=Math.sin(performance.now()*.018);
  if(rolling)return{lean:tumble.rotation.x,l0:-1.2,l1:-1.2,a0:-1,a1:-1};
  if(mv.slide>0)return{lean:1.15,l0:.3,l1:.35,a0:-1.3,a1:-1.1};
  if(mv.gr&&mv.gr.att)return{lean:-.15,l0:-.4,l1:.5,a0:Math.PI,a1:2.7};
  if(mv.wall>0)return{lean:-.2,l0:.9*ph,l1:-.9*ph,a0:-1.4,a1:1.4};
  if(!grounded)return{lean:-.2,l0:-.6,l1:.7,a0:-.4,a1:.4};
  return{lean:-.3,l0:.9*ph,l1:-.9*ph,a0:-.7*ph,a1:.7*ph};
}
function echoSpawn(col){
  if(!MV.echo||!rolling||!playerMesh||!playerMesh.visible)return;     // silhouette rouge : UNIQUEMENT pendant la roulade
  const mat=new THREE.MeshBasicMaterial({color:col||(counterT>0?0xff9a2a:0xff2a3a),transparent:true,opacity:.5,depthWrite:false,blending:THREE.AdditiveBlending,fog:false});
  const P=echoPose(),g=new THREE.Group(),piv=new THREE.Group(),body=new THREE.Group();
  const add=(geo,x,y,z,rx)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.rotation.x=rx||0;m.frustumCulled=false;body.add(m)};
  add(EG.torso,0,1.2,0);add(EG.head,0,1.72,0);add(EG.leg,-.13,.85,0,P.l0);add(EG.leg,.13,.85,0,P.l1);add(EG.arm,-.34,1.52,0,P.a0);add(EG.arm,.34,1.52,0,P.a1);
  piv.position.y=.9;piv.rotation.x=P.lean;body.position.y=-.9;piv.add(body);g.add(piv);
  g.position.copy(playerMesh.position);g.rotation.y=playerMesh.rotation.y;scene.add(g);
  ECHOS.push({g,mat,t:0,life:.45,op:.5});
  while(ECHOS.length>11){const o=ECHOS.shift();scene.remove(o.g);o.mat.dispose()}
}
function tickEchoes(real){
  for(let i=ECHOS.length-1;i>=0;i--){
    const e=ECHOS[i];e.t+=real;const u=e.t/e.life;
    if(u>=1){scene.remove(e.g);e.mat.dispose();ECHOS.splice(i,1);continue}
    e.mat.opacity=e.op*Math.pow(1-u,1.5);e.g.scale.setScalar(1+.06*u);
  }
}

/* ---------- flou de vitesse (lignes + flou périphérique) ---------- */
let blurEl=null,blurLast=-1;
function blurTo(k){
  if(!MV.blur)k=0;
  if(!blurEl){
    if(k<=.01)return;
    blurEl=document.createElement('div');
    const mask='radial-gradient(ellipse at center,transparent 42%,#000 100%)';
    blurEl.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;'+
      (isTouch?'':'backdrop-filter:blur(2.5px);-webkit-backdrop-filter:blur(2.5px);')+
      '-webkit-mask-image:'+mask+';mask-image:'+mask+';'+
      'background:repeating-conic-gradient(from 3deg at 50% 50%,rgba(255,255,255,0) 0 4deg,rgba(255,255,255,.07) 4.6deg 5.2deg,rgba(255,255,255,0) 5.8deg 11deg)';
    document.body.appendChild(blurEl);
  }
  k=Math.round(k*50)/50;if(k!==blurLast){blurLast=k;blurEl.style.opacity=k}
}

/* ---------- réception ---------- */
function landFx(fall){
  if(!MV.heavy||fall<6)return;
  const k=Math.min(1,(fall-5)/13);
  if(MV.rollLand&&performance.now()-mv.rollP<MV.rollLand*1000&&rollCD<=0){          // roulade de réception : pas de pause
    tryRoll();camRoll+=rs()*.12*FX.roll;mv.dip=.15;burst(new THREE.Vector3(player.pos.x,.1,player.pos.z),6,pMat.dust,3);
    toast('🌀 ROULADE DE RÉCEPTION','#38bdf8');return;
  }
  burst(new THREE.Vector3(player.pos.x,.1,player.pos.z),6+Math.round(k*10),pMat.dust,2+k*3);
  shakeT=Math.max(shakeT,.1+.25*k);mv.dip=.18+.35*k;mv.stag=.08+.2*k;mv.mx*=.4;mv.mz*=.4;
}

/* ---------- après le moteur : effets, caméra, réseau ---------- */
function mvReset(){
  mv.cl=null;mv.fl=0;window.__CLIMBING=false;
  if(mv.gr){mv.gr=null;chainShow(false)}
  mv.slide=0;mv.wall=0;mv.mx=mv.mz=0;mv.run=0;mv.stag=0;mv.wasG=true;mvFov=0;mvRollNow=0;mvRollAdd=0;mv.blur=0;blurTo(0);
  if(mv.code!==0){mv.code=0;try{if(net.on)tx({t:'mv',s:0})}catch(_){}}
}
function mvPost(dt,real){
  tickEchoes(real);
  if(!mvLive()){mvReset();return}
  window.__CLIMBING=!!mv.cl;
  if(mv.cl){climbPose();playerMesh.position.copy(player.pos);playerMesh.rotation.y=mv.cl.yw}                       // la grimpe pilote la position (face au mur)
  if(MV.fallAnim){                                                                                              // chute libre : à partir d'une certaine altitude
    const alt=player.pos.y-groundAt(player.pos.x,player.pos.z,player.pos.y);
    if(grounded||mv.cl||mv.wall>0||rolling||mv.slide>0||(mv.gr&&mv.gr.att)||alt<.5)mv.fl=0;else if(alt>=MV.fallAlt)mv.fl=1;
  }
  if(grounded&&!mv.wasG)landFx(mv.fall);
  mv.wasG=grounded;
  if(mv.gr&&mv.gr.att&&((grounded&&mv.gr.t>.25)||mv.gr.t>5))hookRelease(false);
  if(mv.slide>0){
    mv.slide-=dt;player.vel.multiplyScalar(Math.exp(-9*dt));               // pas de pilotage pendant la glissade
    if(!grounded||mv.slide<=0||Math.hypot(mv.mx,mv.mz)<2.2)mv.slide=0;
    else if(MV.slideKick&&arena())slideKick();
  }
  chainUpdate();
  const spd=Math.hypot(player.vel.x+mv.mx,player.vel.z+mv.mz),vv=Math.max(0,-player.vy)*.7;
  mv.blur+=(Math.min(1,Math.max(0,(Math.hypot(spd,vv)-5.2)/8))-mv.blur)*Math.min(1,real*5);
  mvFov=MV.blur?mv.blur*9:0;blurTo(mv.blur*.85);
  if(rolling&&!mv.wasRoll)mv.rs=rs();mv.wasRoll=rolling;
  const target=mv.wall>0?mv.wside*.17:0;
  mvRollNow+=(target-mvRollNow)*Math.min(1,real*9);
  mvRollAdd=rolling?Math.sin(Math.min(1,rollT/ROLL_DUR)*Math.PI)*.2*mv.rs:0;
  if(MV.echo&&!ads){
    mv.echoT-=real;
    const fast=rolling;
    if(fast&&mv.echoT<=0){echoSpawn();mv.echoT=.075}
  }
  if(!TD){                                                                 // poids de la course + plongée à la réception
    mv.dip*=Math.exp(-9*real);let by=-mv.dip;
    if(MV.bob&&grounded&&!rolling&&spd>2.5&&mv.slide<=0){mv.bobT+=real*spd*1.5;by+=Math.sin(mv.bobT*2)*.035*Math.min(1,spd/6)}
    if(mv.slide>0)by-=.3;
    camera.position.y+=by;
  }
  const code=mv.cl?5:mv.gr&&mv.gr.att?3:mv.wall>0?2:mv.slide>0?1:mv.fl?4:0;
  if(code!==mv.code){mv.code=code;try{if(net.on)tx({t:'mv',s:code})}catch(_){}}
  if(!mv.hint){mv.hint=1;setTimeout(()=>toast('🪝 H grappin · Shift en courant = glissade · Espace ×2 = double saut · double saut près d\'un rebord = grimpe','#e5e7eb'),1500)}
}
const mvSafe=(f,a,b)=>{
  if(mvErr>5)return;
  try{f(a,b)}catch(e){mvErr++;console.warn('[mouvement]',e);if(mvErr>5){MV.on=false;try{mvReset()}catch(_){}}}
};

/* ---------- boucle : collisions, recul, balayage du coup, pose de garde ---------- */
const _u=update;
update=function(dt){
  const real=dt;dt=fxTime(real);                        // ralenti local : le moteur reçoit un dt réduit
  mvSafe(mvPre,dt);
  const r=_u.call(this,dt);
  fxPost(real);
  mvSafe(mvPost,dt,real);
  if(state==='PLAYING'&&mode==='coop'&&net.on){try{tickRemotes(real)}catch(e){console.warn('[coop avatars]',e&&e.message||e)}}   // (v8) coop : les coéquipiers ont leur vrai skin FBX (plus de cubes)
  if(state!=='PLAYING'||mode!=='pvp'||!net.on)return r;
  if(wasDead&&!selfDead)invulnT=1.5;wasDead=selfDead;
  invulnT=Math.max(0,invulnT-dt);stunT=Math.max(0,stunT-dt);
  gripT=Math.max(0,gripT-dt);grabCD=Math.max(0,grabCD-dt);
  if(gripT>0&&gripPos){player.vel.x=0;player.vel.z=0;mv.mx=0;mv.mz=0;player.pos.x=gripPos.x;player.pos.z=gripPos.z}   // prise : on ne bouge plus
  if(selfDead){if(blockOn)setBlock(false);SW=null}
  if(SW){SW.t+=dt;testSwing();if(SW&&SW.t>SWING_DUR)SW=null}
  if(blockOn){player.pos.x-=player.vel.x*dt*.45;player.pos.z-=player.vel.z*dt*.45}   // garde = on ralentit
  if(!selfDead){
    for(const id in net.pl){                                                            // collision joueur ↔ joueur
      const q=net.pl[id];if(!q.al||Math.abs(q.y-player.pos.y)>1.6)continue;
      const dx=player.pos.x-q.x,dz=player.pos.z-q.z,d=Math.hypot(dx,dz);
      if(d<SEP){const nx=d>1e-3?dx/d:1,nz=d>1e-3?dz/d:0,p=(SEP-d)*.6;player.pos.x+=nx*p;player.pos.z+=nz*p}
    }
    if(Math.abs(kbx)+Math.abs(kbz)>.05){player.pos.x+=kbx*dt;player.pos.z+=kbz*dt;const f=Math.exp(-9*dt);kbx*=f;kbz*=f}else kbx=kbz=0;
    if(!mv.cl)pushBoxes(player.pos,.4,player.pos.y,true);   // (v7) pushXZ balayé après CHAQUE déplacement : glissade, salto, kick, recul, prise
    try{window.__PVPQ&&__PVPQ.guard&&__PVPQ.guard()}catch(_){}   // jamais sous le sol
  }
  tickRemotes(real);
  try{judoTick(dt,real)}catch(e){JT.length=0;setBars(false);console.warn('[judo]',e&&e.message||e)}
  if(gun&&gun.visible){                                                                  // pose de garde (vue FPS)
    blockK+=((blockOn?1:0)-blockK)*Math.min(1,dt*18);
    if(blockK>.02){if(!gbase)gbase={x:gun.position.x,y:gun.position.y};
      gun.rotation.z=-1.25*blockK;gun.rotation.y=.5*blockK;gun.position.x=gbase.x-.22*blockK;gun.position.y=gbase.y+.12*blockK}
    else if(gbase){gun.rotation.z=0;gun.rotation.y=0;gun.position.x=gbase.x;gun.position.y=gbase.y;gbase=null}
  }
  return r;
};


/* ====================================================================
   ACROBATIES + CONTRE-ATTAQUE (v4)
   K = salto arrière (esquive acrobatique, invulnérable ~0,5 s)   L = kick sauté / CONTRE-ATTAQUE après une parade
   X ou clic droit = parade (maintenue) — parade parfaite dans les premiers instants -> CONTRE
   ==================================================================== */
const ACRO={key:{salto:'KeyK',kick:'KeyN'},cd:1.1,saltoDur:.6};
const kickSt={dmg:16,range:2.5,cos:.3,kb:8.5,base:null,kind:'air'};
let acroCD=0,saltoT=0,kickT=0,kickSet=null,hintEl=null;
const keyName=c=>window.KBN?KBN(c):c.replace(/^Key|^Digit/,'');   // suit la touche choisie dans Paramètres → Contrôles
function counterHint(on){
  if(!hintEl){
    if(!on)return;
    hintEl=document.createElement('div');
    hintEl.style.cssText='position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:31;pointer-events:none;padding:10px 18px;border-radius:14px;'+
      'background:rgba(0,0,0,.65);border:2px solid #fb923c;color:#fff;font:800 clamp(14px,2.4vw,22px) Inter,system-ui,sans-serif;text-align:center;text-shadow:0 2px 6px #000;display:none;white-space:nowrap';
    hintEl.innerHTML=isTouch?'⚔ Appuie sur <b style="color:#fb923c">🗡 / 🦶</b> pour contre-attaquer'
      :'⚔ Appuyer sur <b style="color:#fb923c">[Clic gauche]</b> ou <b style="color:#fb923c">['+keyName(ACRO.key.kick)+']</b> pour faire une contre-attaque';
    document.body.appendChild(hintEl);
  }
  const d=on?'block':'none';if(hintEl.style.display!==d)hintEl.style.display=d;
}
const acroOK=()=>arena()&&state==='PLAYING'&&!selfDead&&stunT<=0&&!rolling&&!TD&&acroCD<=0;
function doSalto(){
  if(!acroOK())return;
  setBlock(false);acroCD=ACRO.cd;saltoT=ACRO.saltoDur;invulnT=Math.max(invulnT,.5);SW=null;
  mv.mx+=Math.sin(yaw)*9;mv.mz+=Math.cos(yaw)*9;mvCap();                 // recul : on part vers l'arrière
  if(grounded)player.vy=JUMP_V*1.05;
  SFX.jump&&SFX.jump();burst(new THREE.Vector3(player.pos.x,.1,player.pos.z),8,pMat.dust,2.8);
  if(MELEE_FBX)animAll('dodge');
  toast('🤸 SALTO','#a78bfa');
}
function kickHit(){
  if(!kickSet)return;
  const a={x:player.pos.x,y:player.pos.y,z:player.pos.z};
  for(const id in net.pl){
    const q=net.pl[id];if(!q.al||kickSet.has(id))continue;
    const h=hitTest(a,{x:q.x,y:q.y,z:q.z},kickSt,yaw);if(!h||!clearLOS(a.x,a.z,q.x,q.z,h.dist))continue;
    kickSet.add(id);land(id,q,kickSt,h);toast('🦶 KICK ACROBATIQUE','#fbbf24');
  }
}
function doKick(){
  if(!arena()||state!=='PLAYING'||selfDead||stunT>0||TD)return;
  if(counterT>0){setBlock(false);startSwing();return}                      // CONTRE-ATTAQUE (dégâts x1,75 + animation de contre)
  if(!acroOK())return;
  setBlock(false);acroCD=ACRO.cd*.9;kickT=.4;SW=null;kickSet=new Set();
  const f=grounded?5.5:3.2;mv.mx+=-Math.sin(yaw)*f;mv.mz+=-Math.cos(yaw)*f;mvCap();   // élan vers l'avant
  if(grounded)player.vy=JUMP_V*.6;
  SFX.jump&&SFX.jump();zoomK=Math.max(zoomK,.4);
  if(MELEE_FBX)animAll('air');
  tx({t:'sw',k:'punch',a:'air'});
  [120,220,320].forEach(ms=>setTimeout(()=>{if(kickSet)kickHit()},ms));
  setTimeout(()=>{kickSet=null},420);
}
addEventListener('keydown',e=>{
  if(e.repeat||/INPUT|TEXTAREA|SELECT/.test((e.target||{}).tagName||''))return;
  if(e.code===ACRO.key.salto)doSalto();else if(e.code===ACRO.key.kick)doKick();
});


/* ====================================================================
   PRISES DE JUDO (touche G) + GESTES (touche B)   (v5)
   G : saisit l'adversaire le plus proche DEVANT toi (portée 2,4 m). La prise contourne la garde.
       Par derrière -> nuque / furtif ; de face -> projection, poussée, coup bas, paume, étranglements.
       Les deux joueurs jouent les animations couplées (A = toi, V = lui), l'adversaire est placé devant toi.
   B : fait défiler les 10 gestes / postures (visibles par les autres joueurs).
   ==================================================================== */
const JUDO_FBX=true;                  // true = projection jouée depuis les fichiers .fbx (MELEE_ANIMS.thA / thV = assets/RamsterZ_EpicMegaJam_2022/Paired_PressUpThrow_Att / _Vic) ; false = ancienne projection codée
const judoFbxReady=G=>JUDO_FBX;       // (v10b) plus de secours « codé » : la projection joue toujours les fichiers .fbx (chargés à la demande)
const GRAB_R=2.4,PAIR_OFF=0;           // PAIR_OFF : décalage (m) de la victime devant l'attaquant si les deux modèles se chevauchent
const GRABS=[
  {n:'PROJECTION DE JUDO',a:['thA'],v:['thV'],dmg:26,front:1,th:1},
  {n:'POUSSÉE',a:['psA'],v:['psV'],dmg:10,front:1},
  {n:'COUP BAS',a:['gkA'],v:['gkV'],dmg:14,front:1},
  {n:'PAUME',a:['cpA'],v:['cpV'],dmg:18,front:1},
  {n:'ÉTRANGLEMENT',a:['chA'],v:['chV'],dmg:28,front:1},
  {n:'ÉTRANGLEMENT LONG',a:['chSA','chLA','chEA'],v:['chSV','chLV','chEV'],dmg:34,front:1},
  {n:'RUPTURE DE NUQUE',a:['nbA'],v:['nbV'],dmg:40,back:1},
  {n:'ATTAQUE FURTIVE',a:['knA'],v:['knV'],dmg:36,back:1},
  {n:'ATTAQUE FURTIVE (variante)',a:['kgA'],v:['knV'],dmg:36,back:1}
];
const EMOTES=[['g1','Geste 1'],['g2','Geste 2'],['g3','Geste 3'],['g4','Geste 4'],['t1','Discours 1'],['t2','Discours 2'],['i1','Garde poings'],['i2','Garde arme'],['i3','Debout'],['i4','Furtif']];
let gripT=0,grabCD=0,grabN=0,gripPos=null,emN=0;
const animDur=k=>{const c=MELEE_ANIMS[k],r=c&&AVRAW[c.file];return r?Math.max(.3,((c.to||r.duration)-(c.from||0))/(c.ts||1)):0};
const seqDur=ks=>ks.reduce((s,k)=>s+(animDur(k)||1.6),0);
function seqPlay(ks,fn){let t=0;ks.forEach(k=>{setTimeout(()=>fn(k),t*1000);t+=animDur(k)||1.6})}   // enchaîne les clips d'une prise longue
function findGrab(){
  let best=null,bd=1e9;const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
  for(const id in net.pl){
    const q=net.pl[id];if(!q.al||Math.abs(q.y-player.pos.y)>1.5)continue;
    const dx=q.x-player.pos.x,dz=q.z-player.pos.z,d=Math.hypot(dx,dz);
    if(d>GRAB_R||d<.05||(dx*fx+dz*fz)/d<.35)continue;
    if(!clearLOS(player.pos.x,player.pos.z,q.x,q.z,d))continue;      // (v7) pas de prise à travers un mur
    if(d<bd){bd=d;best=id}
  }
  return best;
}
function doGrab(){
  /* (v9) CONTRE : dans les 0,5 s qui suivent une prise subie, G retourne la prise contre l'attaquant */
  let id=null,counter=false;
  if(counterUntil>performance.now()&&lastGrabber&&net.pl[lastGrabber]&&net.pl[lastGrabber].al&&arena()&&state==='PLAYING'&&!selfDead){
    id=lastGrabber;counter=true;counterUntil=0;lastGrabber=null;stunT=0;gripT=0;grabCD=0;
    const q0=net.pl[id];yaw=Math.atan2(-(q0.x-player.pos.x),-(q0.z-player.pos.z));            // on se tourne vers lui
  }
  if(!counter&&(!arena()||state!=='PLAYING'||selfDead||stunT>0||rolling||TD||gripT>0||grabCD>0))return;
  if(!counter)id=findGrab();
  if(!id){grabCD=.35;toast('🥋 Aucun adversaire à portée','#94a3b8');return}
  const q=net.pl[id],behind=!counter&&Math.cos(q.r-yaw)>.45,pool=[];                   // adversaire de dos = même direction que moi
  GRABS.forEach((g,i)=>{if(behind?g.back:g.front)pool.push(i)});
  let gi;
  if(behind)gi=pool[grabN++%pool.length];
  else if(counter)gi=0;
  else{const w=[];pool.forEach(i=>{if(i!==_lg){w.push(i);if(GRABS[i].th)w.push(i)}});gi=w.length?w[Math.random()*w.length|0]:pool[0]}   // (v8) de face : prise variée (projection favorisée, jamais deux fois la même)
  _lg=gi;const G=GRABS[gi];                  // (v9) de face : toujours la PROJECTION DE JUDO
  G.a.concat(G.v).forEach(k=>ueLoad(MELEE_ANIMS[k].file));ueTPose();
  const dur=Math.max(seqDur(G.a),seqDur(G.v));
  setBlock(false);SW=null;stunT=Math.max(stunT,dur);gripT=dur;grabCD=dur+1.4;gripPos={x:player.pos.x,z:player.pos.z};
  const m={t:'gp',f:net.id,v:id,g:gi,x:player.pos.x,z:player.pos.z,r:yaw};
  tx(m);onGrab(m);
  toast(counter?'🥋 CONTRE ! '+G.n:'🥋 '+G.n,'#fbbf24');
}
function onGrab(m){                                  // exécuté chez TOUS les joueurs (attaquant, victime, spectateurs)
  const G=GRABS[m.g|0];if(!G||!arena())return;
  /* (v10) PROJECTION DE JUDO : on joue maintenant les vrais fichiers FBX du dossier assets (JUDO_ANIM : attaquant + victime).
     L'ancienne projection « codée » (startThrow) ne sert plus que de secours si les .fbx ne sont pas encore chargés / introuvables. */
  const TH=!!G.th&&!judoFbxReady(G);
  const me=String(net.id),dur=TH?1.2:Math.max(seqDur(G.a),seqDur(G.v)),until=performance.now()+(TH?3400:dur*1000+150);
  if(TH)startThrow(m,dur);
  const att=String(m.f)===me?null:net.pl[m.f];
  if(att){att.pin={x:m.x,z:m.z,r:m.r,until};if(!TH)seqPlay(G.a,k=>{att.anReq=k})}
  else if(!TH)seqPlay(G.a,k=>localAnim(k));
  if(String(m.v)!==me){
    const qv=net.pl[m.v];
    if(qv){qv.pin={x:m.x-Math.sin(m.r)*PAIR_OFF,z:m.z-Math.cos(m.r)*PAIR_OFF,r:m.r,until};if(!TH)seqPlay(G.v,k=>{qv.anReq=k})}
    return;
  }
  /* je suis la victime */
  if(state!=='PLAYING'||selfDead||mode!=='pvp'||rolling||invulnT>0||TD)return;
  if(Math.hypot(m.x-player.pos.x,m.z-player.pos.z)>GRAB_R+R+TOL)return;
  setBlock(false);SW=null;stunT=Math.max(stunT,dur);gripT=dur;kbx=0;kbz=0;               // la prise passe la garde
  {const tx0=m.x-Math.sin(m.r)*.7,tz0=m.z-Math.cos(m.r)*.7,P=window.__PVPQ,t=(P&&P.active&&P.active())?P.place(m.x,m.z,tx0,tz0,player.pos.y,.4):{x:tx0,z:tz0};   // (v7) la victime est posée SANS traverser mur ni sortir de la zone
   player.pos.x=t.x;player.pos.z=t.z;gripPos={x:t.x,z:t.z}}
  yaw=m.r+Math.PI;                                                                       // face à l'attaquant
  if(!TH)seqPlay(G.v,k=>localAnim(k));
  lastGrabber=String(m.f);counterUntil=performance.now()+500;
  toast('🥋 '+G.n+' subie ! — appuie sur '+keyName('KeyG')+' pour CONTRER','#f87171');
  if(!TH)setTimeout(()=>{if(state==='PLAYING'&&!selfDead&&mode==='pvp'){hp-=G.dmg;lastAtk=m.f;dmgFlash=1;SFX.hurt();shakeT=Math.max(shakeT,.4);updateHUD();if(hp<=0)gameOver()}},dur*550);
}
/* ==================== (v9) PROJECTION DE JUDO ====================
   Chronologie (1,2 s de temps de jeu, ralenti x0,4 = ~3 s à l'écran pour les deux joueurs concernés) : 0-25 % saisie et levée · 25-70 % l'adversaire passe par-dessus l'épaule de l'attaquant et se retrouve DERRIÈRE lui ·
   70 % impact (dégâts, secousse, poussière) · 70-85 % au sol · 85-100 % il se relève. Position d'arrivée calculée par balayage collision :
   jamais dans un mur, jamais hors de la zone. Contre possible 0,5 s (G). */
const JT=[];let grabId=0,counterUntil=0,lastGrabber=null;
const _ss=x=>x<=0?0:x>=1?1:x*x*(3-2*x);
function jMesh(id){if(String(id)===String(net.id))return playerMesh;const q=net.pl[id];return q&&q.g||null}
function jReset(o){const m=jMesh(o);if(m){m.rotation.x=0;m.rotation.order='XYZ'}}
function jEnd(J){jReset(J.att);jReset(J.vic);if(J.inv&&!TD)setBars(false)}
function startThrow(m,dur){
  for(let i=JT.length-1;i>=0;i--){const J=JT[i];if(J.att===String(m.f)||J.vic===String(m.f)||J.att===String(m.v)||J.vic===String(m.v)){jEnd(J);JT.splice(i,1)}}
  const fx=-Math.sin(m.r),fz=-Math.cos(m.r),P=window.__PVPQ,act=P&&P.active&&P.active();
  const front={x:m.x+fx*.7,z:m.z+fz*.7},bx=m.x-fx*1.4,bz=m.z-fz*1.4;
  const back=act?P.place(m.x,m.z,bx,bz,0,.4):{x:bx,z:bz};                                        // arrivée derrière l'attaquant, arrêtée par les murs
  const me=String(net.id),inv=String(m.f)===me||String(m.v)===me;                      // participant : ralenti + caméra cinématique
  const J={att:String(m.f),vic:String(m.v),t:0,dur:inv?dur:dur/.4,inv,side:rs()>0?1:-1,m,front,back,hit:false,dmg:(GRABS[m.g|0]||{}).dmg||26};
  JT.push(J);
  if(inv){slowmo(.4,dur/.4-.15);setBars(true);zoomK=Math.max(zoomK,.5);SFX.boom&&SFX.boom()}
}
function judoTick(dt,real){
  for(let i=JT.length-1;i>=0;i--){
    const J=JT[i];J.t+=J.inv?dt:real;const u=J.t/J.dur,me=String(net.id);          // participants : temps de jeu (ralenti) ; spectateurs : temps réel
    const vm=jMesh(J.vic),am=jMesh(J.att);
    if(u>=1||!vm||state!=='PLAYING'){jEnd(J);JT.splice(i,1);continue}
    const s=_ss((u-.25)/.45);
    let rx=u<.25?0:u<.7?(Math.PI/2)*s+Math.PI*.5*Math.sin(Math.PI*s):u<.85?Math.PI/2:(Math.PI/2)*(1-(u-.85)/.15);
    const y=u<.25?.45*_ss(u/.25):u<.7?.45+1.5*Math.sin(Math.PI*s):u<.85?.12:.12*(1-(u-.85)/.15);
    const x=J.front.x+(J.back.x-J.front.x)*s,z=J.front.z+(J.back.z-J.front.z)*s;
    vm.rotation.order='YXZ';vm.rotation.x=rx;vm.position.y+=y;
    if(J.vic===me){gripPos={x,z};player.pos.x=x;player.pos.z=z}                                 // la victime locale suit l'arc (arrivée déjà validée)
    else{const q=net.pl[J.vic];if(q)q.pin={x,z,r:J.m.r+Math.PI,until:performance.now()+250}}
    if(J.inv){                                                                                 // caméra : vue de CÔTÉ qui tourne autour du couple
      playerMesh.visible=true;
      const A=J.m,cx=(J.front.x+J.back.x)/2,cz=(J.front.z+J.back.z)/2,fx=-Math.sin(A.r),fz=-Math.cos(A.r);
      const ang=.15+u*.95,sd=Math.cos(ang)*4.3,fw=Math.sin(ang)*4.3,w=Math.min(1,Math.sin(Math.min(1,u)*Math.PI)*3);
      let cxp=cx-fz*J.side*sd+fx*fw*.6,czp=cz+fx*J.side*sd+fz*fw*.6;
      const P=window.__PVPQ;if(P&&P.active&&P.active()){const r=P.place(cx,cz,cxp,czp,player.pos.y,.3);cxp=r.x;czp=r.z}   // la caméra ne passe pas derrière un mur
      _tp.set(cxp,player.pos.y+1.5+.5*Math.sin(Math.PI*Math.min(1,u*1.4)),czp);
      camera.position.lerp(_tp,w);
      _tl.set(cx,player.pos.y+1.0+.5*Math.sin(Math.PI*Math.min(1,s)),cz);_qm.lookAt(camera.position,_tl,camera.up);_qt.setFromRotationMatrix(_qm);camera.quaternion.slerp(_qt,w);
    }
    if(am&&am!==vm){am.rotation.order='YXZ';am.rotation.x=-.4*Math.sin(Math.PI*Math.min(1,u/.7))}   // l'attaquant se penche en avant
    if(!J.hit&&u>=.7){
      J.hit=true;SFX.wall();burst(new THREE.Vector3(J.back.x,.3,J.back.z),12,pMat.spark,3.5);
      if(J.vic===me&&state==='PLAYING'&&!selfDead&&mode==='pvp'){hp-=J.dmg;lastAtk=J.m.f;dmgFlash=1;SFX.hurt();shakeT=Math.max(shakeT,.5);camRoll+=.12;updateHUD();if(hp<=0)gameOver()}
    }
  }
}
function doEmote(){
  if(!arena()||state!=='PLAYING'||selfDead||stunT>0||rolling||TD||gripT>0)return;
  const e=EMOTES[emN++%EMOTES.length],c=MELEE_ANIMS[e[0]];
  if(!uOK(e[0])){ueLoad(c.file);ueTPose();toast('Animation en chargement…','#94a3b8');return}
  animAll(e[0]);toast('🕺 '+e[1],'#a78bfa');
}
addEventListener('keydown',e=>{
  if(e.repeat||/INPUT|TEXTAREA|SELECT/.test((e.target||{}).tagName||''))return;
  if(e.code==='KeyG')doGrab();else if(e.code==='KeyB')doEmote();
});

/* (v7) PRÉCHAUFFAGE : charge en asynchrone (écran de tirage de la map) les animations et la T-pose, pour que rien ne se charge au 1er coup */
window.__AREN_WARM=async function(){
  const lim=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(r,ms))]);
  try{
    if(!arena())return;
    await lim(avNeedAnims(),7000);
    await lim(ueTPose(),3000);
    const f=['thA','thV'].map(k=>MELEE_ANIMS[k].file).concat(Object.keys(MELEE_ANIMS).filter(k=>MELEE_ANIMS[k].ue&&k!=='thA'&&k!=='thV').map(k=>MELEE_ANIMS[k].file).slice(0,6));   // les plus utilisées d'abord, le reste en fond (ueWarm)
    await lim(Promise.all(f.map(x=>ueLoad(x))),4000);
  }catch(e){console.warn('[arène] préchauffage :',e&&e.message||e)}
};

/* (v8) précharge les skins FBX des adversaires (appelé pendant le matchmaking) */
window.__AREN_ANIM=k=>animAll(k);window.__AREN_ANIMDUR=k=>animDur(k)||0;
/* clip « corps entier » d'une animation (utilisé par les danses du salon). cfg = {file,from,ts} pour une animation hors liste (ex. danse Mixamo ajoutée dans assets/) */
window.__AREN_CLIP=(info,key,cfg)=>{try{
  if(!MELEE_ANIMS[key]&&cfg)MELEE_ANIMS[key]=Object.assign({from:0,ts:1},cfg);
  const c=MELEE_ANIMS[key];if(!c||!info)return null;
  if(c.ue){ueLoad(c.file);ueTPose()}
  else if(!AVRAW[c.file]&&!c.__ld){c.__ld=1;avLoad(c.file).then(o=>{const a=o.animations&&o.animations[0];if(a)AVRAW[c.file]=a}).catch(()=>{c.__ld=0})}
  avNeedAnims();return avClip(info,c.file,'full',false);
}catch(e){return null}};
window.__AREN_PRELOAD=function(names){return Promise.all((names||[]).map(n=>{try{return avChar(n).catch(()=>0)}catch(e){return 0}}))};

/* (v7) invite de proximité : un adversaire à portée de prise -> « [G] Prise de judo » */
(function(){
  let el=null;
  setInterval(()=>{
    try{
      const on=arena()&&state==='PLAYING'&&!selfDead&&gripT<=0&&grabCD<=0&&stunT<=0&&counterT<=0&&!TD&&!!findGrab();
      if(!el){if(!on)return;
        el=document.createElement('div');
        el.style.cssText='position:fixed;left:50%;bottom:34%;transform:translateX(-50%);z-index:30;pointer-events:none;padding:8px 16px;border-radius:14px;background:rgba(0,0,0,.6);border:2px solid #fbbf24;color:#fff;font:800 clamp(13px,2vw,19px) Inter,system-ui,sans-serif;white-space:nowrap;display:none';
        el.innerHTML=isTouch?'🥋 Appuie sur <b style="color:#fbbf24">🥋</b> : prise de judo':'🥋 <b style="color:#fbbf24">['+keyName('KeyG')+']</b> prise de judo';
        document.body.appendChild(el);
      }
      const d=on?'block':'none';if(el.style.display!==d)el.style.display=d;
    }catch(_){}
  },150);
})();

/* ---------- arme dans la main des modèles du LOBBY (v4) ---------- */
window.__AREN_HELD={
  attach(root,key){
    try{
      if(!root||root.userData.heldDone)return;
      const bone=findHandBone(root);if(!bone)return;
      const k=key&&window.WEAPON_GLB&&WEAPON_GLB.has(key)?key:(window.WEAPON_GLB&&WEAPON_GLB.has(WEAPON_KEY)?WEAPON_KEY:null);
      if(!k)return;
      const w=WEAPON_GLB.held(k);w.rotation.set(0,0,0);
      const an=analyzeWeapon(w)||DEFAULT_AN;
      root.updateMatrixWorld(true);bone.add(w);root.updateMatrixWorld(true);
      const sc=new THREE.Vector3();bone.getWorldScale(sc);
      const fr=handFrame(bone);fr.comp=1/(sc.x||1);
      mountMath(w,fr,an,WEAPON_TWEAK);
      root.userData.heldDone=1;root.userData.heldW=w;
    }catch(e){console.warn('[arène] arme du lobby :',e&&e.message||e)}
  }
};
/* ---------- bouton de garde sur mobile ---------- */
const _st=setupTouch;
setupTouch=function(){
  _st.apply(this,arguments);
  if(!isTouch)return;
  const b=mkBtn('🛡',100,196,54,()=>setBlock(true),()=>setBlock(false));b.id='block-btn';b.style.display='none';
  setInterval(()=>{const d=arena()&&state==='PLAYING'?'flex':'none';if(b.style.display!==d)b.style.display=d},250);
  mkBtn('🪝',162,150,46,()=>{mv.hookReq=true});mkBtn('🛷',162,98,46,()=>trySlide());     // grappin + glissade (mobile)
  const bs=mkBtn('🤸',224,150,46,()=>doSalto()),bk=mkBtn('🦶',224,98,46,()=>doKick()),bg=mkBtn('🥋',286,150,46,()=>doGrab()),be=mkBtn('🕺',286,98,46,()=>doEmote());   // salto + kick / contre-attaque (mobile)
  setInterval(()=>{const d=arena()&&state==='PLAYING'?'flex':'none';[bs,bk,bg,be].forEach(x=>{if(x&&x.style.display!==d)x.style.display=d})},250);
};
/* aide de combat sur PC : rappel des touches de parade / acrobaties */
(function(){
  if(isTouch)return;
  const h=document.createElement('div');
  h.style.cssText='position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:12;pointer-events:none;padding:6px 14px;border-radius:999px;background:rgba(0,0,0,.55);'+
    'border:1px solid rgba(255,255,255,.2);color:#fff;font:700 12px Inter,system-ui,sans-serif;white-space:nowrap;display:none';
  h.innerHTML='🛡 <b>'+keyName('KeyX')+'</b> / clic droit : parer &nbsp;·&nbsp; 🤸 <b>'+keyName(ACRO.key.salto)+'</b> : salto &nbsp;·&nbsp; 🦶 <b>'+keyName(ACRO.key.kick)+'</b> : kick / contre';
  document.body.appendChild(h);
  setInterval(()=>{const d=arena()&&state==='PLAYING'&&!selfDead?'block':'none';if(h.style.display!==d)h.style.display=d;
    h.style.borderColor=blockOn?'#38bdf8':'rgba(255,255,255,.2)';h.style.opacity=blockOn?1:.8},200);
})();

/* ---------- réseau plus réactif en PvP ---------- */
window.__arene={hitTest,MS,R,SEP,PARRY_MS,WEAPON_TWEAK,FX,MV,mv};
})();
