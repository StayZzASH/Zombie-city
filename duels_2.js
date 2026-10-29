/* =====================================================================
   DUELS  —  PvP par équipes : 1v1 · 2v2 · 3v3 (système de manches)
   ---------------------------------------------------------------------
   • Le chef choisit « PvP 1v1 / 2v2 / 3v3 » dans le lobby : il faut EXACTEMENT
     2 / 4 / 6 joueurs dans le groupe, tous « ✔ PRÊT », pour lancer.
   • Équipes : A (bleue) = 1er, 3e, 5e joueur · B (rouge) = 2e, 4e, 6e.
   • Chaque manche : 4 s (10 s en 3v3) de préparation, puis combat chronométré.
     Pas de réapparition : la manche se termine quand une équipe est éliminée.
   • 1v1 : 150 PV · 3 manches gagnantes · manches de 2 min.
   • 2v2 : état « À TERRE » (saignement 25 s) · un allié te relève en 5 s
           (maintenir C, ou bouton à l'écran) et tu repars avec 50 PV.
   • 3v3 : +500 crédits par manche (achat d'armes pendant la préparation) ·
           tirs alliés à 25 % · 5 manches gagnantes · changement de côté dès la 3e.
   • Points de classement : voir FMT (kill / win / rev / streak) — transmis
     à classements.js via window.DUELS.pts() et CLASSEMENTS.addScore().
   • Le serveur de jeu est le chef (hôte) : il arbitre manches, éliminations et relevages.
   Messages réseau : fm im rn tm dn dm rv rvd bo rs mo sb
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[duels]',e&&e.message||e)}};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- réglages des formats ---------- */
const FMT={
  '1v1':{n:2,hp:150,wins:3,sec:120,prep:4, kill:100,win:300,rev:0, bleed:0, ff:0,  cred:0,  swap:0,down:false,streak:0},
  '2v2':{n:4,hp:100,wins:3,sec:150,prep:4, kill:75, win:200,rev:40,bleed:25,ff:0,  cred:0,  swap:0,down:true, streak:0},
  '3v3':{n:6,hp:100,wins:5,sec:180,prep:10,kill:50, win:150,rev:60,bleed:25,ff:.25,cred:500,swap:3,down:true, streak:150}
};
const TC=['#60a5fa','#f87171'],TN=['A','B'];
const price=k=>Math.round(WEAPONS[k].val*3);          // prix d'achat (crédits)

const cfg=()=>{try{return(mode==='pvp'&&net.on&&net.fmt&&FMT[net.fmt])||null}catch(e){return null}};
const D={team:{},sc:[0,0],rd:0,sw:0,phase:'wait',t:0,out:{},dw:{},mk:{},ks:{},cred:0,downSelf:false,rvT:0,rvPos:null,held:false,final:null,sent:0};
function reset(){D.team={};D.sc=[0,0];D.rd=0;D.sw=0;D.phase='wait';D.t=0;D.out={};D.dw={};D.ks={};D.cred=0;D.downSelf=false;D.rvT=0;D.rvPos=null;D.final=null}
const teamOf=id=>(D.team[id]!==undefined)?D.team[id]:ids().indexOf(id)%2;
const myTeam=()=>teamOf(net.id);
const standing=t=>ids().filter(id=>teamOf(id)===t&&!D.out[id]);
const addPts=n=>safe(()=>window.CLASSEMENTS&&CLASSEMENTS.addScore&&CLASSEMENTS.addScore(n));
function wrap(name,fn){const o=window[name];if(typeof o!=='function'){console.warn('[duels] fonction introuvable :',name);return}window[name]=function(){return fn.call(this,o,arguments)}}

/* ======================= INTERFACE ======================= */
const css=document.createElement('style');
css.textContent=
'#dl-hud{position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:45;display:none;padding:5px 14px;border-radius:999px;background:rgba(2,6,23,.72);border:1px solid rgba(255,255,255,.18);color:#fff;font:800 13px Inter,system-ui,sans-serif;white-space:nowrap;pointer-events:none}'+
'#dl-prep{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(2,6,23,.55);pointer-events:none;color:#fff;font-family:Inter,system-ui,sans-serif;text-align:center;padding:16px}'+
'#dl-prep h2{font-size:32px;font-weight:900;letter-spacing:.06em;margin:0}'+
'#dl-buy{display:none;flex-wrap:wrap;gap:8px;justify-content:center;max-width:560px;pointer-events:auto}'+
'#dl-buy button{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(15,23,42,.92);color:#fff;font-weight:800;font-size:13px;cursor:pointer}'+
'#dl-buy button:disabled{opacity:.4;cursor:not-allowed}'+
'#dl-rv{position:fixed;left:50%;bottom:22%;transform:translateX(-50%);z-index:46;display:none;padding:10px 16px;border-radius:12px;background:rgba(2,6,23,.85);border:1px solid #4ade80;color:#4ade80;font:800 14px Inter,system-ui,sans-serif;text-align:center;touch-action:none;user-select:none;cursor:pointer}'+
'#dl-rv i{display:block;height:5px;margin-top:6px;border-radius:3px;background:#4ade80;width:0}'+
'#dl-dn{position:fixed;left:50%;top:38%;transform:translateX(-50%);z-index:46;display:none;color:#fca5a5;font:900 20px Inter,system-ui,sans-serif;text-shadow:0 2px 8px #000;pointer-events:none;text-align:center}';
document.head.appendChild(css);
const mk=(tag,id,html)=>{const e=document.createElement(tag);e.id=id;if(html)e.innerHTML=html;document.body.appendChild(e);return e};
mk('div','dl-hud');
mk('div','dl-prep','<h2 id="dl-pt"></h2><div id="dl-ps" style="font-weight:700"></div><div id="dl-buy"></div><div id="dl-pc" style="font-weight:800;color:#fbbf24"></div>');
mk('div','dl-rv','🩹 <span id="dl-rvt"></span><i id="dl-rvb"></i>');
mk('div','dl-dn');

function hud(){
  const c=cfg(),el=$('dl-hud');
  if(!c||typeof state==='undefined'||state!=='PLAYING'||D.phase==='wait'){el.style.display='none';return}
  const t=Math.max(0,Math.ceil(D.t)),mm=Math.floor(t/60)+':'+('0'+t%60).slice(-2),me=myTeam();
  el.innerHTML='<span style="color:'+TC[0]+'">'+(me===0?'★ ':'')+'A '+D.sc[0]+'</span> – <span style="color:'+TC[1]+'">'+D.sc[1]+' B'+(me===1?' ★':'')+'</span> · Manche '+D.rd+' · '+(D.phase==='prep'?'départ '+t+' s':(D.phase==='live'?mm:'…'));
  el.style.display='block';
  const dn=$('dl-dn');
  if(selfDead&&D.phase==='live'){dn.textContent=D.downSelf?'🩸 À TERRE — un allié peut te relever':'☠ ÉLIMINÉ — attends la fin de la manche';dn.style.display='block'}else dn.style.display='none';
  if(D.phase==='prep'){$('dl-ps').textContent=($('dl-ps').dataset.base||'')+' · départ dans '+t+' s'}
}
function hideAll(){['dl-hud','dl-prep','dl-rv','dl-dn'].forEach(i=>{const e=$(i);if(e)e.style.display='none'})}

/* ---------- boutique de la préparation (3v3) ---------- */
function buildBuy(){
  const c=cfg(),box=$('dl-buy');
  if(!c||!c.cred){box.style.display='none';$('dl-pc').textContent='';return}
  box.style.display='flex';
  box.innerHTML=Object.keys(WEAPONS).map(k=>{const w=WEAPONS[k],p=price(k);return '<button data-k="'+k+'"'+(D.cred<p?' disabled':'')+'>'+w.ic+' '+esc(w.name)+' — '+p+' 🪙</button>'}).join('');
  $('dl-pc').textContent='Crédits : '+D.cred+' 🪙';
}
$('dl-buy').addEventListener('click',e=>{
  const b=e.target.closest('button[data-k]');if(!b||D.phase!=='prep')return;
  const k=b.dataset.k,p=price(k);if(D.cred<p)return;
  let i=1;while(i<5&&slots[i])i++;if(i>=5)i=1;
  slots[i]={k,r:0,a:effW(k,0).mag};D.cred-=p;equip(i);updateHUD();buildBuy();
  toast('🛒 '+WEAPONS[k].name+' acheté','#fbbf24');
});

/* ---------- corps des joueurs à terre ---------- */
function mkMarker(id,x,y,z){
  rmMarker(id);
  const g=new THREE.Group();
  const body=new THREE.Mesh(new THREE.BoxGeometry(.55,.22,1.7),new THREE.MeshBasicMaterial({color:new THREE.Color(TC[teamOf(id)])}));body.position.y=.15;g.add(body);
  const ring=new THREE.Mesh(new THREE.RingGeometry(1.2,1.45,40),new THREE.MeshBasicMaterial({color:0x4ade80,side:THREE.DoubleSide,transparent:true,opacity:.8}));ring.rotation.x=-Math.PI/2;ring.position.y=.06;g.add(ring);
  g.position.set(x,y,z);g.userData={x,y,z};scene.add(g);D.mk[id]=g;
}
function rmMarker(id){const g=D.mk[id];if(!g)return;scene.remove(g);g.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose()});delete D.mk[id]}
function clearMk(){Object.keys(D.mk).forEach(rmMarker)}

/* ======================= DÉROULÉ DES MANCHES ======================= */
/* --- tous les clients --- */
function applyPrep(r,sw,sc,s){
  const c=cfg();if(!c)return;
  D.rd=r;D.sw=sw;D.sc=sc;D.phase='prep';D.t=s;D.out={};D.dw={};D.downSelf=false;D.rvT=0;
  clearMk();
  selfDead=false;respT=0;lastAtk=null;hp=c.hp;playerMesh.visible=true;rolling=false;
  const mine=ids().filter(id=>teamOf(id)===myTeam()),ix=Math.max(0,mine.indexOf(net.id));
  const side=myTeam()^sw,SP=side?[1,3,5,7]:[0,2,4,6],sp=PV[SP[ix%4]];
  player.pos.set(sp[0],0,sp[1]);player.vel.set(0,0,0);player.vy=0;
  try{if(window.__PVPQ&&__PVPQ.active&&__PVPQ.active()){player.pos.y=groundAt(sp[0],sp[1],0)+.02}}catch(_){}   // (v7) posé sur le sol réel de la map, jamais dedans
  if(!c.cred||!slots[0]){slots=[null,null,null,null,null];slots[0]={k:MELEE_START,r:0,a:effW(MELEE_START,0).mag}}   // 3v3 : on garde les armes achetées
  equip(0);
  if(c.cred)D.cred+=c.cred;
  updateHUD();
  $('dl-pt').textContent='MANCHE '+r+(c.swap&&r===c.swap?' · CHANGEMENT DE CÔTÉ':'');
  $('dl-ps').dataset.base='Équipe '+TN[myTeam()]+(myTeam()?' (rouge)':' (bleue)')+' · premier à '+c.wins+' manches';
  $('dl-prep').style.display='flex';
  buildBuy();
  if(c.cred){try{document.exitPointerLock()}catch(_){}}
  hud();
}
function applyGo(){
  const c=cfg();if(!c)return;
  D.phase='live';D.t=c.sec;$('dl-prep').style.display='none';
  banner('⚔ MANCHE '+D.rd+' — GO !',1500);
  try{renderer.domElement.requestPointerLock()}catch(_){}
}
function applyRs(w,sc){
  D.phase='post';D.t=3.5;if(sc)D.sc=sc;
  banner(w===null?'⏱ MANCHE NULLE':(w===myTeam()?'🏆 MANCHE GAGNÉE':'💀 MANCHE PERDUE'),3000);
  $('dl-rv').style.display='none';
}
function applyRevive(id,by,x,y,z){
  const c=cfg();rmMarker(id);
  if(id===net.id){D.downSelf=false;selfDead=false;hp=50;playerMesh.visible=true;player.pos.set(x,y,z);player.vel.set(0,0,0);player.vy=0;updateHUD();banner('🩹 Relevé !',1500)}
  if(by===net.id&&c){addPts(c.rev);toast('🩹 Allié relevé · +'+c.rev+' pts','#4ade80')}
}
function applyBleed(id){rmMarker(id);if(id===net.id&&D.downSelf){D.downSelf=false;banner('☠ ÉLIMINÉ',2500)}}
function bonus(c){addPts(c.streak);toast('🔥 Série de 3 éliminations ! +'+c.streak+' pts','#fbbf24')}

/* --- chef (hôte) : arbitrage --- */
function hostPrep(r){
  const c=cfg();if(!c)return;
  const sw=(c.swap&&r>=c.swap)?1:0;
  tx({t:'im',r,sw,sc:D.sc,s:c.prep});applyPrep(r,sw,D.sc,c.prep);
}
function hostDown(id,by,x,y,z,marker){
  const c=cfg();if(!c||D.phase!=='live'||D.out[id]||!net.ro[id])return;
  D.out[id]=1;
  if(by&&by!==id&&net.ro[by]&&teamOf(by)!==teamOf(id)){
    net.sc[by]=(net.sc[by]||0)+1;
    if(c.streak){D.ks[by]=(D.ks[by]||0)+1;if(D.ks[by]%3===0){if(by===net.id)bonus(c);else tx({t:'sb',to:by})}}
  }
  D.ks[id]=0;
  tx({t:'sc',sc:net.sc,v:id,k:by});showKill(id,by);
  if(marker){D.dw[id]={x,y,z,t:c.bleed};tx({t:'dm',id,x,y,z});mkMarker(id,x,y,z)}
  checkRound();
}
function hostRevive(by,id){
  const d=D.dw[id];
  if(D.phase!=='live'||!d||by===id||teamOf(by)!==teamOf(id)||D.out[by])return;
  delete D.dw[id];delete D.out[id];
  tx({t:'rvd',id,by,x:d.x,y:d.y,z:d.z});applyRevive(id,by,d.x,d.y,d.z);
}
function checkRound(){
  if(D.phase!=='live')return;
  const a=standing(0).length,b=standing(1).length;
  if(a===0&&b===0)endRound(null);else if(a===0)endRound(1);else if(b===0)endRound(0);
}
function endRound(w){
  if(D.phase!=='live')return;
  if(w!==null)D.sc[w]++;
  tx({t:'rs',w,sc:D.sc,r:D.rd});applyRs(w,D.sc);
}
function matchOver(w){
  D.phase='over';D.final=w;
  tx({t:'mo',w,sc:D.sc});tx({t:'ov',sc:net.sc});
  endPvp();
}
let tmS=-1;
function hostLoop(c,dt){
  if(D.phase==='wait'||D.phase==='over')return;
  D.t-=dt;
  const s=Math.ceil(Math.max(0,D.t));if(s!==tmS){tmS=s;tx({t:'tm',s:D.t})}
  if(D.phase==='prep'){if(D.t<=0){D.phase='live';D.t=c.sec;tx({t:'rn'});applyGo()}return}
  if(D.phase==='live'){
    Object.keys(D.dw).forEach(id=>{const d=D.dw[id];d.t-=dt;if(d.t<=0){delete D.dw[id];tx({t:'bo',id});applyBleed(id)}});
    checkRound();
    if(D.phase==='live'&&D.t<=0){const a=standing(0).length,b=standing(1).length;endRound(a>b?0:(b>a?1:null))}
    return;
  }
  if(D.phase==='post'&&D.t<=0){
    if(D.sc[0]>=c.wins||D.sc[1]>=c.wins||D.rd>=c.wins*2+2)matchOver(D.sc[0]>D.sc[1]?0:(D.sc[1]>D.sc[0]?1:myTeam()));
    else hostPrep(D.rd+1);
  }
}

/* un joueur quitte la partie en cours (mais reste dans le groupe) : il compte comme éliminé */
function onGone(id){
  const c=cfg();if(!c||!net.host)return;
  D.out[id]=1;delete D.dw[id];rmMarker(id);tx({t:'bo',id});
  const a=ids().some(i=>teamOf(i)===0),b=ids().some(i=>teamOf(i)===1);
  if(D.phase!=='over'&&D.phase!=='wait'&&(!a||!b)){matchOver(a?0:(b?1:myTeam()));return}
  checkRound();
}

/* ======================= MESSAGES RÉSEAU ======================= */
const _h=window.handle;
function pre(m){
  const c=cfg();
  if(net.away&&state==='MENU'&&m.t!=='fm')return false;     // joueur sorti de la partie : il ignore les manches
  switch(m.t){
    case 'fm':if(!net.host)net.fmt=m.f||'';return true;
    case 'im':if(c&&!net.host)applyPrep(m.r,m.sw,m.sc,m.s);return true;
    case 'rn':if(c&&!net.host)applyGo();return true;
    case 'tm':if(!net.host)D.t=m.s;return true;
    case 'dn':if(c&&net.host)hostDown(m.f,m.by,m.x,m.y,m.z,true);return true;
    case 'dm':if(c&&!net.host)mkMarker(m.id,m.x,m.y,m.z);return true;
    case 'rv':if(c&&net.host)hostRevive(m.f,m.id);return true;
    case 'rvd':if(c&&!net.host)applyRevive(m.id,m.by,m.x,m.y,m.z);return true;
    case 'bo':if(c&&!net.host)applyBleed(m.id);return true;
    case 'rs':if(c&&!net.host)applyRs(m.w,m.sc);return true;
    case 'mo':D.final=m.w;if(m.sc)D.sc=m.sc;return true;
    case 'sb':if(c&&m.to===net.id)bonus(c);return true;
    case 'ph':case 'mh':{                         // dégâts reçus : hors manche = ignorés, tirs alliés = réduits ou ignorés
      if(!c||state!=='PLAYING')return false;
      if(D.phase!=='live')return true;
      if(m.f&&m.f!==net.id&&teamOf(m.f)===myTeam()){if(!c.ff)return true;m.d=(m.d||0)*c.ff}
      return false;
    }
  }
  return false;
}
window.handle=function(m){
  let stop=false;
  try{stop=pre(m)===true}catch(e){console.warn('[duels]',e&&e.message||e)}
  if(stop)return;
  return _h.apply(this,arguments);
};

/* ======================= CROCHETS SUR LE JEU ======================= */
wrap('startGame',(o,a)=>{
  const r=o.apply(null,a);
  safe(()=>{
    const c=cfg();clearMk();hideAll();reset();if(!c)return;
    ids().forEach(id=>{D.team[id]=ids().indexOf(id)%2});
    hp=c.hp;updateHUD();
    banner('⚔ '+net.fmt.toUpperCase()+' — premier à '+c.wins+' manches',3000);
    if(net.host)setTimeout(()=>{if(cfg()&&state==='PLAYING'&&D.phase==='wait')hostPrep(1)},1500);
  });
  return r;
});
wrap('tally',(o,a)=>{                                   // mort sans état « à terre » (1v1) : l'hôte arbitre
  if(!cfg())return o.apply(null,a);
  hostDown(a[0],a[1],0,0,0,false);
});
wrap('gameOver',(o,a)=>{
  const c=cfg();
  if(!c)return o.apply(null,a);
  if(selfDead||state==='GAMEOVER')return;
  if(D.phase!=='live'){hp=Math.max(1,hp);return}      // pas de mort hors manche
  if(c.down&&!D.downSelf){
    D.downSelf=true;selfDead=true;respT=0;playerMesh.visible=false;
    const by=lastAtk;lastAtk=null;
    const x=player.pos.x,y=player.pos.y,z=player.pos.z;
    if(net.host)hostDown(net.id,by,x,y,z,true);else tx({t:'dn',by,x,y,z});
    return;
  }
  const r=o.apply(null,a);respT=0;
  banner('☠ ÉLIMINÉ — attends la fin de la manche',2600);
  return r;
});
wrap('drawBoard',(o,a)=>{
  if(!cfg())return o.apply(null,a);
  $('mp-board').innerHTML=ids().map(id=>{
    const me=id===net.id,q=net.pl[id],al=me?!selfDead:q&&q.al;
    return '<div class="flex justify-between gap-3"><span style="color:'+TC[teamOf(id)]+'">['+TN[teamOf(id)]+'] '+esc(net.ro[id]||id)+(me?' (vous)':'')+'</span><b>'+(al?(net.sc[id]||0)+' ☠':'✖')+'</b></div>';
  }).join('');
});
wrap('endPvp',(o,a)=>{
  const c=cfg();
  if(!c)return o.apply(null,a);
  if(state==='GAMEOVER')return;
  const r=o.apply(null,a);
  safe(()=>{
    let w=D.final;
    if(w==null){                                         // abandon : l'équipe encore présente gagne
      const present=[0,1].map(t=>ids().some(id=>teamOf(id)===t));
      w=present[0]&&!present[1]?0:(present[1]&&!present[0]?1:(D.sc[0]===D.sc[1]?myTeam():(D.sc[0]>D.sc[1]?0:1)));
    }
    $('go-title').innerText=(w===myTeam())?'🏆 VICTOIRE !':'DÉFAITE — équipe '+TN[w];
    const rows=ids().sort((x,y)=>(net.sc[y]||0)-(net.sc[x]||0)).map(id=>'<li class="flex justify-between"><span style="color:'+TC[teamOf(id)]+'">['+TN[teamOf(id)]+'] '+esc(net.ro[id]||id)+(id===net.id?' (vous)':'')+'</span><b>'+(net.sc[id]||0)+' éliminations</b></li>');
    $('final-board').innerHTML='<li class="flex justify-between"><b>Manches</b><b>A '+D.sc[0]+' – '+D.sc[1]+' B</b></li>'+rows.join('');
  });
  return r;
});
wrap('finalOver',(o,a)=>{
  const r=o.apply(null,a);
  safe(()=>{hideAll();clearMk();if(D.phase!=='wait')D.phase='over'});
  return r;
});

/* ======================= BOUCLES ======================= */
let lastFm='',fmN=0,lt=performance.now();
function syncFmt(){
  if(!net.on){net.fmt='';return}
  if(!net.host)return;
  const f=(window.LOBBY&&LOBBY.get().fmt)||'';
  if(state==='MENU'&&net.fmt!==f)net.fmt=f;              // en attente : on suit le mode choisi par le chef
  const sig=(net.fmt||'')+'|'+Object.keys(net.ro).join(',');
  if(sig!==lastFm||++fmN%8===0){lastFm=sig;tx({t:'fm',f:net.fmt||''})}
}
setInterval(()=>safe(()=>{
  const now=performance.now(),dt=Math.min(1,(now-lt)/1000);lt=now;
  syncFmt();
  const c=cfg();
  if(!c||state!=='PLAYING'){hideAll();return}
  if(!net.host&&D.t>0)D.t=Math.max(0,D.t-dt);
  if(net.host)hostLoop(c,dt);
  hud();
}),250);

/* ---------- relever un allié : maintenir C (ou toucher le bouton) pendant 5 s ---------- */
addEventListener('keydown',e=>{if(e.code==='KeyC')D.held=true},true);
addEventListener('keyup',e=>{if(e.code==='KeyC')D.held=false},true);
const rv=$('dl-rv');
rv.addEventListener('pointerdown',e=>{D.held=true;e.preventDefault()});
['pointerup','pointerleave','pointercancel'].forEach(ev=>rv.addEventListener(ev,()=>{D.held=false}));
setInterval(()=>safe(()=>{
  const c=cfg(),dt=.1;
  if(!c||!c.down||state!=='PLAYING'||selfDead||D.phase!=='live'){rv.style.display='none';D.rvT=0;return}
  let tgt=null,bd=3;
  for(const id in D.mk){if(teamOf(id)!==myTeam()||id===net.id)continue;const u=D.mk[id].userData,d=Math.hypot(player.pos.x-u.x,player.pos.z-u.z);if(d<bd){bd=d;tgt=id}}
  if(!tgt){rv.style.display='none';D.rvT=0;return}
  rv.style.display='block';$('dl-rvt').textContent='Relever '+(net.ro[tgt]||tgt)+' — maintenir C';
  if(D.held){
    if(!D.rvPos||D.rvT===0)D.rvPos={x:player.pos.x,z:player.pos.z};
    if(Math.hypot(player.pos.x-D.rvPos.x,player.pos.z-D.rvPos.z)>1.2){D.rvT=0;D.rvPos=null}
    else D.rvT+=dt;
    if(D.rvT>=5&&performance.now()-D.sent>1200){
      D.rvT=0;D.sent=performance.now();
      if(net.host)hostRevive(net.id,tgt);else tx({t:'rv',id:tgt});
    }
  }else D.rvT=Math.max(0,D.rvT-dt*2);
  $('dl-rvb').style.width=Math.min(100,D.rvT/5*100)+'%';
}),100);

window.DUELS={FMT,cfg,onGone,pts:()=>{const c=cfg();return c?{kill:c.kill,win:c.win,rev:c.rev,streak:c.streak}:null}};
})();
