/* =====================================================================
   SPECTATEUR (coop Duo / Trio / Squad)  +  PRÉCHARGEMENT PENDANT LE MATCHMAKING
   ---------------------------------------------------------------------
   1) SPECTATEUR
      Quand tu meurs en coop (selfDead) et qu'au moins un coéquipier est en vie, la caméra
      passe derrière l'épaule du coéquipier (même vue que la sienne, tu vois son personnage et
      son arme en direct) sans pouvoir le contrôler.
        · Duo   : bascule automatique sur l'unique coéquipier
        · Trio / Squad : bouton « Changer de coéquipier » (touches Espace ou ← → au clavier)
      Si le coéquipier observé meurt, on passe au suivant ; si tout le monde est à terre,
      la partie se termine comme avant (logique existante de l'hôte).
      Limite : l'inclinaison verticale (haut/bas) du regard n'est pas envoyée par le réseau,
      la caméra garde donc une inclinaison fixe légère.

   2) PRÉCHARGEMENT
      Dès que le matchmaking démarre (compte à rebours / écran « Matchmaking… » avec le fond du salon),
      le jeu charge en arrière-plan : skins FBX de tous les joueurs, animations de l'arène,
      et — en PvP — la MAP tirée au sort (l'hôte annonce la graine à l'avance : message « pre »),
      puis compile les shaders. À l'arrivée sur la map, tout est déjà prêt.
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[spectateur]',e&&e.message||e)}};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ======================= 1. SPECTATEUR ======================= */
let tgt=null,sy=0,uiOn=false,crossHid=false;
const gone=id=>!!(net.gone&&net.gone[id]);
const alive=()=>Object.keys(net.pl||{}).filter(id=>{const q=net.pl[id];return q&&q.al&&!gone(id)}).sort();
const active=()=>mode==='coop'&&net.on&&selfDead&&state==='PLAYING'&&alive().length>0;

const ui=document.createElement('div');
ui.id='spec-ui';
ui.style.cssText='position:fixed;left:50%;top:max(14px,env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:60;display:none;text-align:center;pointer-events:none;font:800 14px Inter,system-ui,sans-serif;color:#fff';
ui.innerHTML='<div id="spec-name" style="display:inline-block;padding:6px 16px;border-radius:12px;background:rgba(2,6,23,.62);border:1px solid rgba(255,255,255,.22);text-shadow:0 1px 4px #000"></div>'+
  '<div><button id="spec-next" type="button" style="display:none;margin-top:8px;pointer-events:auto;cursor:pointer;padding:8px 16px;border-radius:12px;background:#f97316;color:#0f172a;font:800 14px Inter,system-ui,sans-serif;border:0;box-shadow:0 2px 10px rgba(0,0,0,.5)"></button></div>';
document.body.appendChild(ui);
const nameEl=ui.querySelector('#spec-name'),btn=ui.querySelector('#spec-next');
btn.textContent='🔄 Changer de coéquipier'+((typeof isTouch!=='undefined'&&isTouch)?'':'  [Espace]');

function cycle(dir){
  const L=alive();if(!L.length)return;
  const i=L.indexOf(tgt);tgt=L[(i+dir+L.length)%L.length];sy=net.pl[tgt].r;
}
btn.addEventListener('click',e=>{e.stopPropagation();cycle(1)});
btn.addEventListener('touchstart',e=>{e.preventDefault();e.stopPropagation();cycle(1)},{passive:false});
addEventListener('keydown',e=>{
  if(!active()||alive().length<2)return;
  if(e.code==='Space'||e.code==='ArrowRight'){e.preventDefault();cycle(1)}
  else if(e.code==='ArrowLeft'){e.preventDefault();cycle(-1)}
},true);

function setUI(on){
  if(on!==uiOn){uiOn=on;ui.style.display=on?'block':'none'}
  const cr=$('crosshair');
  if(on&&cr&&!cr.classList.contains('hidden')){cr.classList.add('hidden');crossHid=true}
  else if(!on&&crossHid){crossHid=false;if(cr&&state==='PLAYING')cr.classList.remove('hidden')}
}
function spec(dt){
  if(!active()){tgt=null;setUI(false);return}
  const L=alive();
  if(!tgt||L.indexOf(tgt)<0){tgt=L[0];sy=net.pl[tgt].r}          // coéquipier observé mort / parti : on passe au suivant
  const q=net.pl[tgt];
  let d=((q.r-sy+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;sy+=d*Math.min(1,dt*14);
  q.spt=(q.spt||0)+((q.pt||0)-(q.spt||0))*Math.min(1,dt*14);
  const pitch0=q.spt,cd=new THREE.Vector3(-Math.sin(sy)*Math.cos(pitch0),Math.sin(pitch0),-Math.cos(sy)*Math.cos(pitch0)),
        cr=new THREE.Vector3(Math.cos(sy),0,-Math.sin(sy)),
        pivot=new THREE.Vector3(q.x,q.y+1.55-.6*(q.ck||0),q.z),
        cp=pivot.clone().addScaledVector(cr,q.ad?.55:.95).addScaledVector(cd,-(q.ad?2.4:4));   // même caméra épaule que le joueur suivi (hauteur, visée, tangage)
  cp.y=Math.max(.4,cp.y);
  const toCam=cp.clone().sub(pivot),dist=toCam.length();
  const ch=new THREE.Raycaster(pivot,toCam.normalize(),0,dist).intersectObjects(solidMeshes,false)[0];
  if(ch)cp.copy(pivot).addScaledVector(toCam,Math.max(.6,ch.distance-.25));
  camera.position.copy(cp);camera.lookAt(cp.clone().add(cd));
  camera.fov+=(65-camera.fov)*Math.min(1,12*dt);camera.updateProjectionMatrix();
  safe(()=>{sky.position.copy(camera.position);torch.position.copy(pivot).addScaledVector(cr,.3);torch.target.position.copy(pivot).addScaledVector(cd,14)});
  q.g.visible=true;
  setUI(true);
  const col=safe(()=>colOf(tgt))||'#fff';
  nameEl.innerHTML='👁 SPECTATEUR · <span style="color:'+col+'">'+esc(net.ro[tgt]||tgt)+'</span> · '+Math.max(0,Math.round(q.hp))+' ❤';
  btn.style.display=L.length>1?'inline-block':'none';
}
safe(()=>{const _u=update;update=function(dt){const r=_u.apply(this,arguments);safe(()=>spec(dt));return r}});

/* ======================= 2. PRÉCHARGEMENT ======================= */
const P={seed:null,tasks:{},total:0,done:0,run:false,t0:0};
const hint=document.createElement('div');
hint.id='pre-ui';
hint.style.cssText='position:fixed;left:24px;bottom:64px;z-index:152;display:none;min-width:150px;padding:6px 12px;border-radius:10px;background:rgba(2,6,23,.55);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px);color:#e2e8f0;font:600 12px Inter,system-ui,sans-serif';
hint.innerHTML='<div id="pre-txt">Préchargement…</div><div style="height:4px;margin-top:5px;border-radius:2px;background:rgba(255,255,255,.15)"><div id="pre-bar" style="height:4px;width:0;border-radius:2px;background:#fbbf24;transition:width .25s"></div></div>';
document.body.appendChild(hint);
const preTxt=hint.querySelector('#pre-txt'),preBar=hint.querySelector('#pre-bar');
function paintPre(){
  const pct=P.total?Math.round(P.done/P.total*100):0;
  preBar.style.width=pct+'%';preTxt.textContent=pct>=100?'✅ Carte et personnages prêts':'Préchargement : '+pct+' %';
}
const withTimeout=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(r,ms))]);
function addTask(key,fn,ms){
  if(P.tasks[key])return;
  P.tasks[key]=1;P.total++;paintPre();
  let pr;try{pr=Promise.resolve(fn())}catch(e){pr=Promise.resolve()}
  withTimeout(pr.catch(e=>console.warn('[précharge]',key,e&&e.message||e)),ms||30000).then(()=>{P.done++;paintPre();if(P.done>=P.total)safe(()=>renderer.compile(scene,camera))});
}
function skinNames(){
  const list=window.NL_SKINS||[],out=[];
  Object.keys(net.ro||{}).concat(net.on?[]:['_me']).forEach(id=>{
    const sid=(id===net.id||id==='_me')?(typeof NLSKIN==='function'?NLSKIN():''):((net.sk||{})[id]);
    const s=list.find(k=>k.id===sid)||list[0],n=s&&s.fbx;if(n&&out.indexOf(n)<0)out.push(n);
  });
  return out;
}
function trigger(){
  if(state!=='MENU')return;
  P.run=true;
  if(!P.t0)P.t0=Date.now();
  skinNames().forEach(n=>addTask('skin:'+n,()=>new Promise(res=>{
    if(!window.FBXC||!FBXC.lobbyModel){res();return}
    const r=FBXC.lobbyModel(n,()=>res());if(r)res();            // déjà chargé -> rien à faire
  })));
  if(mode==='pvp'&&window.__AREN_PRELOAD){
    addTask('arene-skins',()=>window.__AREN_PRELOAD(skinNames()));
    addTask('arene-anims',()=>window.__AREN_WARM&&window.__AREN_WARM(),12000);
  }
  if(mode==='pvp'&&P.seed!==null&&window.__PVPMAPS&&__PVPMAPS.prefetch)addTask('map:'+P.seed,()=>__PVPMAPS.prefetch(P.seed),60000);
  const ov=$('grp-mmbg');
  hint.style.display=(ov&&ov.style.display==='block')?'block':'none';
}
function reset(){
  P.seed=null;P.tasks={};P.total=0;P.done=0;P.run=false;P.t0=0;hint.style.display='none';
}
/* l'hôte tire la graine (donc la map) AVANT le départ et la diffuse : tout le monde peut précharger la même map */
function hostPlan(){
  if(!(net.on&&net.host)||mode!=='pvp')return;
  if(P.seed===null){P.seed=(Math.random()*1e9|0)+1;tx({t:'pre',seed:P.seed})}
}
safe(()=>{const _tx=tx;tx=function(m){if(m&&(m.t==='cd'||m.t==='mm')&&state==='MENU')safe(()=>{hostPlan();trigger()});return _tx.apply(this,arguments)}});
safe(()=>{const _h=handle;handle=function(m){
  if(m&&m.t==='pre'){if(typeof m.seed==='number'){P.seed=m.seed;safe(trigger)}return}
  if(m&&(m.t==='cd'||m.t==='mm'))safe(trigger);
  return _h.apply(this,arguments)}});
/* l'hôte lance la partie avec la graine annoncée (sinon onStart en tire une autre) */
safe(()=>{const _os=onStart;window.onStart=onStart=function(){
  const S=(net.on&&net.host&&mode==='pvp'&&P.seed!==null)?P.seed:null,R=Math.random;
  if(S!==null){let used=false;Math.random=function(){if(used)return R();used=true;return (S+.5)/1e9}}
  try{return _os.apply(this,arguments)}finally{Math.random=R}
}});
/* le fond « Matchmaking… » apparaît : on s'assure que le préchargement tourne (solo / coop lancé seul inclus) */
safe(()=>{
  const ov=$('grp-mmbg');if(!ov)return;
  new MutationObserver(()=>{
    if(ov.style.display==='block'){safe(()=>{hostPlan();trigger()})}
    else hint.style.display='none';
  }).observe(ov,{attributes:true,attributeFilter:['style']});
});
setInterval(()=>{
  if(state==='PLAYING'||state==='GAMEOVER'){if(P.run||P.seed!==null)reset()}
  else if(!net.on&&mode!=='solo'&&P.seed!==null)reset();
},700);
window.PRECHARGE={state:()=>({seed:P.seed,done:P.done,total:P.total}),spectating:()=>uiOn};
})();
