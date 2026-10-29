/* =====================================================================
   ÉTAT « AU SOL » (coop Duo / Trio / Squad)                                   (lot 3)
   ---------------------------------------------------------------------
   · À 0 PV en coop, s'il reste au moins un coéquipier debout, tu ne meurs plus : tu tombes « au sol »
     (animation à 4 pattes : assets/Crawling.fbx, vue par les autres joueurs aussi).
   · Barre de vie ROUGE de 100 PV qui baisse toute seule (≈ 2,5 PV/s, soit 40 s). À 0 : mort définitive
     (-> mode spectateur). Les coups reçus la font baisser plus vite.
   · Au sol : déplacement lent, pas de tir, pas de roulade, pas de saut.
   · Un coéquipier debout s'approche (≤ 2,2 m) et MAINTIENT la touche « ouvrir un coffre / ramasser » (C par défaut)
     ou le bouton à l'écran pendant 3 s : le joueur se relève avec 50 PV. La barre est figée pendant la réanimation.
   · Le début de vague suivante relève aussi les joueurs au sol (comme les morts).
   · Un anneau rouge pulsant marque les coéquipiers au sol.
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[au-sol]',e&&e.message||e)}};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CFG={bleed:2.5,range:2.2,time:3,reviveHp:50};
const D={on:false,rvP:0,rvAt:0,nextCrawl:0,hold:0,sendT:0,uiHold:false,tgt:null,cTry:0,sendT2:0};
safe(()=>{RELAY.add('dn')});

const isTouchDev=()=>typeof isTouch!=='undefined'&&isTouch;
const keyC=()=>safe(()=>window.KBN?KBN('KeyC'):'C')||'C';
const gone=id=>!!(net.gone&&net.gone[id]);
const mates=()=>Object.keys(net.pl||{}).filter(id=>{const q=net.pl[id];return q&&q.al&&!q.dn&&!gone(id)});
const inCoop=()=>mode==='coop'&&net.on;

/* ---------- interface ---------- */
const dn=document.createElement('div');
dn.id='dn-ui';
dn.style.cssText='position:fixed;left:50%;top:max(16%,env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:60;display:none;text-align:center;pointer-events:none;font:800 15px Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 4px #000';
dn.innerHTML='<div id="dn-txt" style="padding:7px 18px;border-radius:12px;background:rgba(127,29,29,.75);border:1px solid #ef4444"></div>'+
  '<div style="width:220px;height:8px;margin:8px auto 0;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden"><div id="dn-bar" style="height:8px;width:0;background:#22c55e"></div></div>';
document.body.appendChild(dn);
const dnTxt=dn.querySelector('#dn-txt'),dnBar=dn.querySelector('#dn-bar');

const rv=document.createElement('div');
rv.id='rv-ui';
rv.style.cssText='position:fixed;left:50%;bottom:26%;transform:translateX(-50%);z-index:60;display:none;text-align:center;pointer-events:none;font:800 15px Inter,system-ui,sans-serif;color:#fff;text-shadow:0 1px 4px #000';
rv.innerHTML='<div id="rv-txt" style="padding:7px 18px;border-radius:12px;background:rgba(2,6,23,.7);border:1px solid #22c55e"></div>'+
  '<div style="width:220px;height:8px;margin:8px auto 0;border-radius:4px;background:rgba(0,0,0,.55);overflow:hidden"><div id="rv-bar" style="height:8px;width:0;background:#22c55e"></div></div>'+
  '<button id="rv-btn" type="button" style="display:none;margin-top:10px;pointer-events:auto;padding:12px 22px;border-radius:14px;border:0;background:#22c55e;color:#052e16;font:800 16px Inter,system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);touch-action:none">🩹 Maintenir pour réanimer</button>';
document.body.appendChild(rv);
const rvTxt=rv.querySelector('#rv-txt'),rvBar=rv.querySelector('#rv-bar'),rvBtn=rv.querySelector('#rv-btn');
['pointerdown'].forEach(ev=>rvBtn.addEventListener(ev,e=>{e.preventDefault();D.uiHold=true}));
['pointerup','pointercancel','pointerleave'].forEach(ev=>rvBtn.addEventListener(ev,()=>{D.uiHold=false}));
const show=(el,on)=>{const v=on?'block':'none';if(el.style.display!==v)el.style.display=v};

/* ---------- relief : le corps à plat suit les pentes / marches / obstacles du sol ----------
   On échantillonne le sol (groundAt) à l'avant, l'arrière, la gauche et la droite du corps couché,
   puis on incline le modèle (tangage + roulis) et on le pose sur la hauteur moyenne. Lissé -> aucune saccade. */
const TILT={p:0,r:0,h:0};
const clampT=(v,m)=>Math.max(-m,Math.min(m,v));
function slope(x,z,y,yw,len,wid){
  const sx=-Math.sin(yw),sz=-Math.cos(yw),rx=Math.cos(yw),rz=-Math.sin(yw);        // avant / droite du modèle
  const g=(dx,dz)=>{const v=safe(()=>groundAt(x+dx,z+dz,y+.45));return isFinite(v)?v:y};
  const f=g(sx*len,sz*len),b=g(-sx*len,-sz*len),r=g(rx*wid,rz*wid),l=g(-rx*wid,-rz*wid),c=g(0,0);
  return{p:clampT(Math.atan2(f-b,len*2),.62),r:clampT(Math.atan2(r-l,wid*2),.45),h:Math.max(0,(f+b+r+l)/4-c)};
}
function tiltLocal(dt){
  const P=typeof playerMesh!=='undefined'&&playerMesh;if(!P)return;
  const s=slope(player.pos.x,player.pos.z,player.pos.y,yaw,.85,.45),k=Math.min(1,dt*9);
  TILT.p+=(s.p-TILT.p)*k;TILT.r+=(s.r-TILT.r)*k;TILT.h+=(s.h-TILT.h)*k;
  P.rotation.order='YXZ';P.rotation.x=TILT.p;P.rotation.z=TILT.r;
  P.position.y=player.pos.y+TILT.h*.6+.03;
}
function untiltLocal(){
  TILT.p=TILT.r=TILT.h=0;
  safe(()=>{if(typeof playerMesh!=='undefined'&&playerMesh){playerMesh.rotation.x=0;playerMesh.rotation.z=0}});
}
/* animation à 4 pattes locale : vraie boucle (plus de saut en fin de clip), vitesse liée au déplacement, pose figée à l'arrêt */
function crawlDrive(now){
  const P=window.__PL,A=P&&P.actor,a=A&&A.a&&A.a.mx_crawl;
  if(A&&!(a&&A.over&&A.over.n==='mx_crawl')&&now-D.cTry>700){D.cTry=now;safe(()=>window.__AREN_ANIM&&__AREN_ANIM('crawl'))}   // (re)lance la boucle (charge le FBX si besoin)
  else if(a&&A.over&&A.over.n==='mx_crawl'){
    const sp=Math.hypot(player.vel.x,player.vel.z);
    a.setEffectiveTimeScale(sp>.12?Math.min(1.5,.5+sp*.7):0);
  }
  if(now-D.sendT2>400){D.sendT2=now;tx({t:'an',a:'crawl'})}                       // les autres joueurs : même boucle, maintenue en vie
}

/* ---------- entrer / sortir de l'état « au sol » ---------- */
function paintHP(on){const b=$('hp-bar');if(b)b.style.background=on?'#dc2626':''}
function enterDown(){
  D.on=true;D.rvP=0;D.rvAt=0;D.nextCrawl=0;D.hold=0;D.cTry=0;D.sendT2=0;
  hp=100;mouseDown=false;fireHeld=false;pendingShot=false;
  safe(()=>setADS(false));
  tx({t:'dn',on:1});
  safe(()=>banner('🩸 AU SOL — un coéquipier doit te réanimer',3000));
  paintHP(true);safe(updateHUD);
}
function exitDown(newHp){
  if(!D.on)return;
  D.on=false;D.rvP=0;D.hold=0;
  hp=newHp;keys.ShiftLeft=false;
  tx({t:'dn',on:0});
  safe(()=>{const P=window.__PL;if(P&&P.actor)P.actor.clearOver(.25)});
  paintHP(false);show(dn,false);safe(updateHUD);untiltLocal();
}
function resetAll(){
  D.on=false;D.rvP=0;D.hold=0;D.uiHold=false;paintHP(false);show(dn,false);show(rv,false);untiltLocal();
  if(typeof keys!=='undefined')keys.ShiftLeft=false;
  Object.values(net.pl||{}).forEach(q=>{q.dn=false;if(q.g){q.g.rotation.x=0;q.g.rotation.z=0}q.tp=q.tr=0});
}

/* ---------- crochets sur le jeu ---------- */
safe(()=>{const _go=gameOver;gameOver=function(){
  if(D.on){
    if(hp>0)return;                                   // au sol : les coups font juste baisser la barre rouge
    exitDown(0);                                      // barre vide : mort définitive (logique d'origine -> spectateur)
  }else if(inCoop()&&state==='PLAYING'&&!selfDead&&mates().length){
    enterDown();return;
  }
  return _go.apply(this,arguments);
}});
safe(()=>{const _rs=reviveSelf;reviveSelf=function(){if(D.on)exitDown(60);return _rs.apply(this,arguments)}});
safe(()=>{const _sg=startGame;startGame=function(){resetAll();return _sg.apply(this,arguments)}});
safe(()=>{const _rm=resetToMenu;resetToMenu=function(){resetAll();return _rm.apply(this,arguments)}});
safe(()=>{const f=shoot;shoot=function(){return D.on?false:f.apply(this,arguments)}});       // rien d'actif au sol : tir, grenade, tourelle, rechargement, roulade
safe(()=>{const f=throwItem;throwItem=function(){if(D.on)return;return f.apply(this,arguments)}});
safe(()=>{const f=placeTurret;placeTurret=function(){if(D.on)return;return f.apply(this,arguments)}});
safe(()=>{const f=reloadWeapon;reloadWeapon=function(){if(D.on)return;return f.apply(this,arguments)}});
safe(()=>{const f=tryRoll;tryRoll=function(){if(D.on)return;return f.apply(this,arguments)}});
safe(()=>{const _h=handle;handle=function(m){
  if(m){
    if(m.t==='dn'){const q=net.pl[m.f];if(q)q.dn=!!m.on;return}
    if(m.t==='rv'){if(D.on){D.rvP=+m.p||0;D.rvAt=performance.now()}return}
    if(m.t==='rvd'){if(D.on){exitDown(CFG.reviveHp);safe(()=>toast('🩹 Réanimé !','#22c55e'));safe(()=>SFX.level())}return}
  }
  return _h.apply(this,arguments);
}});

/* ---------- anneau rouge sous les coéquipiers au sol ---------- */
function mark(q){
  if(q.dn){
    if(!q.dnM){const m=new THREE.Mesh(new THREE.RingGeometry(.55,.78,32),new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false}));
      m.rotation.x=-Math.PI/2;m.position.y=.06;q.g.add(m);q.dnM=m}
    q.dnM.visible=true;q.dnM.scale.setScalar(1+.12*Math.sin(performance.now()/160));
    const sl=slope(q.x,q.z,q.y,q.r,.85,.45);                                        // le coéquipier couché suit le relief lui aussi
    q.tp=(q.tp||0)+(sl.p-(q.tp||0))*.2;q.tr=(q.tr||0)+(sl.r-(q.tr||0))*.2;
    q.g.rotation.order='YXZ';q.g.rotation.x=q.tp;q.g.rotation.z=q.tr;
  }else{
    if(q.dnM)q.dnM.visible=false;
    if(q.tp||q.tr){q.tp=q.tr=0;q.g.rotation.x=0;q.g.rotation.z=0}
  }
}

/* ---------- boucle ---------- */
function tick(dt){
  const now=performance.now();
  for(const id in net.pl)mark(net.pl[id]);
  if(D.on){
    /* au sol : lent, barre rouge qui baisse (figée pendant la réanimation) */
    player.pos.x-=player.vel.x*dt*.5;player.pos.z-=player.vel.z*dt*.5;
    const reviving=now-D.rvAt<600;
    if(!reviving){D.rvP=0;hp-=CFG.bleed*dt}
    safe(updateHUD);
    if(hp<=0){gameOver();return}
    crawlDrive(now);                                   // animation à 4 pattes : vraie boucle, vue aussi par les coéquipiers
    tiltLocal(dt);                                     // + corps incliné selon le relief
    dnTxt.textContent=reviving?'🩹 Réanimation en cours…':'🩸 AU SOL — attends qu\'un coéquipier te réanime ('+Math.max(0,Math.ceil(hp))+')';
    dnBar.style.width=Math.round((reviving?D.rvP:0)*100)+'%';
    show(dn,true);show(rv,false);return;
  }
  show(dn,false);
  /* réanimer un coéquipier au sol */
  if(!inCoop()||selfDead||state!=='PLAYING'){D.hold=0;D.tgt=null;show(rv,false);return}
  let best=null,bd=CFG.range;
  for(const id in net.pl){
    const q=net.pl[id];if(!q.dn||!q.al||gone(id))continue;
    const d=Math.hypot(q.x-player.pos.x,q.z-player.pos.z);if(d<bd){bd=d;best=id}
  }
  if(best!==D.tgt){D.tgt=best;D.hold=0}
  if(!best){show(rv,false);return}
  const holding=!!(keys.KeyC||D.uiHold);
  D.hold=holding?D.hold+dt:Math.max(0,D.hold-dt*2);
  if(holding&&now-D.sendT>150){D.sendT=now;tx({t:'rv',to:best,p:Math.min(1,D.hold/CFG.time)})}
  if(D.hold>=CFG.time){
    tx({t:'rvd',to:best});const q=net.pl[best];if(q)q.dn=false;D.hold=0;D.tgt=null;
    safe(()=>toast('🩹 Coéquipier réanimé !','#22c55e'));safe(()=>SFX.level());show(rv,false);return;
  }
  rvTxt.innerHTML=(isTouchDev()?'Maintiens le bouton':'Maintiens <b style="color:#86efac">['+esc(keyC())+']</b>')+' pour réanimer <b>'+esc(net.ro[best]||best)+'</b>';
  rvBar.style.width=Math.round(Math.min(1,D.hold/CFG.time)*100)+'%';
  rvBtn.style.display=isTouchDev()?'inline-block':'none';
  show(rv,true);
}
safe(()=>{const _u=update;update=function(dt){
  if(D.on){keys.Space=false;keys.ShiftLeft=true;mouseDown=false;fireHeld=false;pendingShot=false;rollCD=Math.max(rollCD,1)}   // accroupi (caméra basse) + aucune action
  const r=_u.apply(this,arguments);
  if(net.on&&mode==='coop')safe(()=>tick(dt));
  return r;
}});
window.AUSOL={state:()=>({down:D.on,hp:Math.round(hp),revive:D.rvP}),cfg:CFG};
})();
