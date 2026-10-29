/* =====================================================================
   GROUPE  —  salon privé (amis / code) : chef, mode, « prêt », quitter
   ---------------------------------------------------------------------
   1. Quitter le groupe : bouton 🚪 dans le menu ⚙ Paramètres (avec le code du salon).
   2. Seul le CHEF (l'hôte) choisit le mode de jeu. Les autres voient 🔒.
      Le mode doit avoir AU MINIMUM autant de places que de joueurs dans le groupe
      (3 joueurs → Duo grisé, Trio / Squad / PvP possibles). Changer de mode ne
      détruit plus le salon : le chef met le salon à jour pour tout le monde.
   3. Lancement : CHAQUE joueur du groupe appuie sur JOUER = « prêt ». Tout le monde
      voit en direct qui est prêt (✔ vert) et qui ne l'est pas (✖). Quand tous sont
      prêts, un compte à rebours de 10 s démarre (annulé si quelqu'un se retire). Ensuite : PHASE MATCHMAKING = image du salon en plein écran + « Matchmaking... »
      en bas à gauche pendant 5 s, puis lancement. Pendant cette phase il est IMPOSSIBLE d'annuler (ni « non prêt », ni quitter, ni annuler la recherche).
      (v9) Même système pour Solo / Coop / PvP lancés seul : Jouer = prêt -> 10 s -> Matchmaking verrouillé -> lancement (recherche aléatoire comprise).
   Messages réseau ajoutés (PeerJS) : gm (chef → tous : mode choisi, v7), rdy (joueur → chef), rd (chef → tous),
   rdc (annulation du départ). Les parties « Jouer en ligne (aléatoire) »
   ne sont pas concernées : elles gardent leur lancement automatique.
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[groupe]',e&&e.message||e)}};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const say=(m,c)=>safe(()=>toast(m,c||'#f87171'));

const inGroup=()=>{try{return !!(net.on&&!net.mm&&state==='MENU')}catch(e){return false}};
const members=()=>{try{return (typeof ids==='function')?ids():Object.keys(net.ro||{}).sort()}catch(e){return []}};
const rdy=()=>net.rdy||(net.rdy={});
const isReady=id=>inGroup()&&!!rdy()[id];
const curMode=()=>safe(()=>window.LOBBY&&LOBBY.get())||{};
const modeById=id=>safe(()=>LOBBY.modes.find(m=>m.id===id));
const curGame=()=>curMode().game||'solo';
const lobbyOn=()=>{const l=$('lobby');return !!l&&getComputedStyle(l).display!=='none'};

/* ---------- 2. qui peut choisir quel mode ---------- */
function allow(m){
  if(!inGroup())return {ok:true};
  if(!net.host)return {ok:false,why:'🔒 Seul le chef du groupe choisit le mode de jeu.'};
  if(!m||m.game==='custom')return {ok:true};
  const n=members().length;
  if(m.players<n)return {ok:false,why:'Ton groupe compte '+n+' joueurs : choisis un mode d’au moins '+n+' places.'};
  return {ok:true};
}
/* le chef change de mode SANS détruire le salon (setMode() d'origine le détruirait) */
function applyMode(m){
  mode=m.game;                                   // variable globale du jeu
  net.max=(m.game==='coop'||m.fmt)?m.players:6;
  net.rdy={};cancel(true);lastSig='';
  net.gm=m.id;
  safe(()=>sendRo());safe(()=>paintMode());
  sendMode(true);                                 // (v7) diffusion immédiate du mode à tous les membres
  say('Mode changé : '+m.name+' · tout le monde doit se remettre prêt','#22c55e');
}
/* (v7) SYNCHRO DU MODE : le chef diffuse l'id du mode (gm) ; les membres l'appliquent tout de suite à leur lobby (titre, sièges, note).
   Renvoyé quand le mode change, quand un joueur arrive (liste des membres modifiée) et toutes les ~2,5 s (rattrapage si un message est perdu). */
let gmSig='',gmN=0;
function sendMode(force){
  if(!net.on||!net.host)return;
  const c=curMode();if(!c||!c.id)return;
  const sig=c.id+'|'+members().join(',');
  if(force||sig!==gmSig||++gmN%8===0){gmSig=sig;net.gm=c.id;safe(()=>tx({t:'gm',id:c.id}))}
}
function applyRemoteMode(id){
  const md=modeById(id);if(!md||net.host)return;
  const changed=net.gm!==md.id;
  net.gm=md.id;net.fmt=md.fmt||'';
  if(md.game!=='custom'&&md.game!=='solo'){mode=md.game;net.max=(md.game==='coop'||md.fmt)?md.players:6}
  if(changed){net.rdy={};lastSig='';cancel(true)}
  safe(()=>LOBBY.set(md));                         // met à jour l'UI du lobby immédiatement
  safe(()=>paintMode());
  if(changed&&state==='MENU')say('👑 Le chef a choisi : '+md.name,'#22c55e');
  render(true);
}

/* ---------- 3. système « prêt » ---------- */
/* ---------- 3b. écran « Matchmaking... » : 5 s entre la fin du compte à rebours et le chargement de la partie ---------- */
const MM_S=5;let grpMM=null,mmHide=null,mmLock=false;
const sf={on:false,left:0,t:null,mm:false,search:false,bypass:false,gap:0};   // (v9) lancement « seul » (solo / coop / PvP aléatoire) : compte à rebours -> matchmaking verrouillé
(function(){
  const s=document.createElement('style');
  s.textContent='#grp-mmbg{position:fixed;inset:0;z-index:150;display:none;background:#05070d center/cover no-repeat}#grp-mm{position:fixed;left:24px;bottom:22px;z-index:151;display:none;padding:7px 14px;border-radius:10px;background:rgba(2,6,23,.55);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(6px);color:#e2e8f0;font:800 22px Inter,system-ui,sans-serif;letter-spacing:.4px;pointer-events:none;text-shadow:0 1px 3px #000;animation:grpmm 1.2s ease-in-out infinite}@keyframes grpmm{50%{opacity:.55}}';
  document.head.appendChild(s);
  const d=document.createElement('div');d.id='grp-mm';d.textContent='Matchmaking...';document.body.appendChild(d);
  const b=document.createElement('div');b.id='grp-mmbg';document.body.appendChild(b);
})();
function lobbyImg(){                                  // image d'arrière-plan du salon (celle du jour) : on la reprend telle quelle
  return safe(()=>{
    const bg=$('nl-bg');if(!bg)return '';
    const ch=[].slice.call(bg.children).filter(d=>d.style.backgroundImage);
    const on=ch.find(d=>+getComputedStyle(d).opacity>.5)||ch[0];
    if(on)return on.style.backgroundImage;
    const c=getComputedStyle(bg).backgroundImage;return c&&c!=='none'?c:'';
  })||'';
}
function showMM(sec,persist){
  const e=$('grp-mm'),b=$('grp-mmbg');if(!e||!b)return;
  const im=lobbyImg();if(im)b.style.backgroundImage=im;
  b.style.display='block';e.style.display='block';mmLock=true;   // verrou : plus aucune annulation possible
  safe(()=>document.exitPointerLock&&document.exitPointerLock());
  clearTimeout(mmHide);mmHide=null;
  if(!persist)mmHide=setTimeout(hideMM,((sec||MM_S)+4)*1000);   // filet de sécurité si le départ n'arrive jamais
}
function hideMM(){
  clearTimeout(mmHide);mmHide=null;mmLock=false;sf.mm=false;sf.search=false;
  const e=$('grp-mm'),b=$('grp-mmbg');if(e)e.style.display='none';if(b)b.style.display='none';
}
const locked=()=>mmLock;
const lockMsg=()=>say('🔒 Matchmaking en cours : impossible d’annuler.','#fbbf24');

let cd=null,cdLeft=0,lastSig='',launchLock=0;
const needN=()=>{const c=curMode();return c&&c.fmt?c.players:0};   // modes par équipes : effectif exact
function allReady(){const m=members();return m.length>=2&&(!needN()||m.length===needN())&&m.every(id=>rdy()[id])}
function cancel(quiet){
  if(cd){clearInterval(cd);cd=null;
    if(!quiet&&net.host){safe(()=>{$('room-msg').innerText='';tx({t:'rdc'})})}}
}
function announce(){
  safe(()=>tx({t:'cd',s:Math.max(0,cdLeft)}));
  const r=$('room-msg');if(r)r.innerText='✅ Tout le monde est prêt ! Départ dans '+Math.max(0,cdLeft)+' s…';
}
function check(){
  if(!net.host||!inGroup()){cancel(true);return}
  if(Date.now()<launchLock)return;                                    // (v8) partie en cours de lancement : pas de 2e compte à rebours
  const ok=allReady();
  if(ok&&!cd){cdLeft=10;announce();cd=setInterval(()=>{
    if(!allReady()||!inGroup()){cancel();return}
    cdLeft--;
    if(cdLeft<=0){clearInterval(cd);cd=null;
      launchLock=Date.now()+60000;                          // verrou immédiat : un seul lancement, pas de 2e compte à rebours
      safe(()=>tx({t:'mm',s:MM_S}));showMM(MM_S);           // le salon reste affiché, « Matchmaking... » en bas à gauche pendant 5 s
      grpMM=setTimeout(()=>{
        grpMM=null;hideMM();
        if(!inGroup()||!net.host||!allReady()){launchLock=0;safe(()=>tx({t:'mmc'}));return}   // quelqu'un est parti pendant les 5 s : annulé
        safe(()=>selectWeapon(window.LOBBY.weapon()));
        net.gone={};
        net.rdy={};safe(()=>tx({t:'rd',rd:{}}));          // tout le monde « pas prêt » après le lancement
        safe(()=>onStart());
      },MM_S*1000);
    }else announce();
  },1000)}
  else if(!ok&&cd)cancel();
}
function setReady(id,v){rdy()[id]=!!v;safe(()=>tx({t:'rd',rd:rdy()}));check();render(true)}
/* ---------- messages réseau (on s'insère devant handle()) ---------- */
const _handle=window.handle;
if(typeof _handle==='function'){
  window.handle=function(m){
    if(m&&typeof m.t==='string'){
      if(net.away&&state==='MENU'&&!AWAY_OK[m.t])return;                 // sorti de la partie en cours : on ignore le jeu
      if(m.t==='lg'){if(net.host&&m.f&&net.ro[m.f]&&(state==='PLAYING'||state==='SHOP'))gone(m.f,true);return}
      if(m.t==='gn'){if(!net.host&&m.id)gone(m.id,false);return}
      if(m.t==='ge'){if(!net.host&&(state==='PLAYING'||state==='SHOP'||state==='GAMEOVER')){say('Le chef a quitté la partie — retour au salon','#fbbf24');softReset(false)}return}
      if(m.t==='gr'){if(!net.host){net.away=false;net.rdy={};net.gone={};cancel(true);lastSig='';render(true)}return}
      if(m.t==='mm'){if(!net.host)showMM(m.s|0||MM_S);return}
      if(m.t==='mmc'){hideMM();return}
      if(m.t==='st'){net.gone={};net.away=false;hideMM()}
      if(m.t==='gm'){if(!net.host&&m.id)applyRemoteMode(String(m.id));return}
      if(m.t==='rd'){if(!net.host&&m.rd&&typeof m.rd==='object')net.rdy=m.rd;render(true);return}
      if(m.t==='rdy'){if(net.host&&mmLock)return;if(net.host&&m.f&&net.ro[m.f]){rdy()[m.f]=!!m.r;safe(()=>tx({t:'rd',rd:rdy()}));check();render(true)}return}
      if(m.t==='rdc'){gcd=null;render(true);if(!net.host){const r=$('room-msg');if(r)r.innerText=''}return}
      if(m.t==='cd'&&inGroup()){gcd=m.s|0;gcdT=Date.now();render(true);const r=$('room-msg');if(r)r.innerText='✅ Tout le monde est prêt ! Départ dans '+(m.s|0)+' s…';return}
    }
    return _handle.apply(this,arguments);
  };
}
/* ---------- rester dans le groupe quand on quitte une partie ----------
   Avant : « Quitter la partie » / « Retour au menu » appelait resetToMenu() → leaveNet() : le groupe était détruit.
   Maintenant (salon privé uniquement, pas le matchmaking aléatoire) :
   • un joueur qui quitte en cours de partie prévient le chef (lg) : il sort de la partie mais RESTE dans le groupe ;
     les autres continuent sans lui (net.gone) et il ignore les messages de jeu tant que le chef n'est pas revenu au salon ;
   • si c'est le chef qui quitte, la partie s'arrête pour tous (ge) et tout le monde retrouve le groupe au salon ;
   • à la fin d'une partie, « Retour au menu » ramène au salon sans dissoudre le groupe ; les « prêt » sont remis à zéro (gr). */
const persist=()=>{try{return !!(net.on&&!net.mm&&net.code&&net.code!=='EN LIGNE')}catch(e){return false}};
const AWAY_OK={gm:1,ro:1,rd:1,rdc:1,cd:1,fm:1,st:1,gr:1,ge:1,gn:1,id:1,full:1};
function gone(id,asHost){
  net.gone=net.gone||{};net.gone[id]=1;
  safe(()=>{const q=net.pl[id];if(q){scene.remove(q.g);delete net.pl[id]}});
  say((net.ro[id]||id)+' a quitté la partie (il reste dans le groupe)','#fbbf24');
  if(!asHost)return;
  safe(()=>tx({t:'gn',id}));
  safe(()=>{if(window.DUELS&&DUELS.onGone)DUELS.onGone(id)});
  safe(()=>{
    if(mode==='pvp'&&state==='PLAYING'&&!(window.DUELS&&DUELS.cfg&&DUELS.cfg())&&ids().length<=1){
      net.sc[net.id]=Math.max(net.sc[net.id]||0,KILLS);tx({t:'ov',sc:net.sc});
      toast('Tous les adversaires ont quitté — victoire !','#22c55e');endPvp();
    }
  });
}
function softReset(playing){
  hideMM();
  safe(()=>document.exitPointerLock&&document.exitPointerLock());
  safe(()=>{for(const id in net.pl)scene.remove(net.pl[id].g)});
  net.pl={};net.sc={};net.rdy={};net.gone={};cancel(true);lastSig='';
  net.away=!!playing&&!net.host;
  slots=[null,null,null,null,null];cur=0;selfDead=false;wave=0;
  $('gameover-screen').classList.add('hidden');$('menu-screen').classList.remove('hidden');
  state='MENU';
  safe(()=>$('mp-board').classList.add('hidden'));
  safe(()=>paintMode());safe(()=>renderMenu());
  if(net.host)safe(()=>{sendRo();tx({t:'gr'})});
  render(true);
}
const _reset=window.resetToMenu;
if(typeof _reset==='function'){
  window.resetToMenu=function(){
    if(!persist())return _reset.apply(this,arguments);
    const playing=(state==='PLAYING'||state==='SHOP');
    if(playing)safe(()=>tx({t:net.host?'ge':'lg'}));       // chef : la partie s'arrête pour tous · joueur : prévient le chef
    softReset(playing);
  };
}
/* « Jouer » = je suis prêt / je ne suis plus prêt */
function toggleReady(){
  if(!inGroup())return;
  if(locked()){lockMsg();return}
  const id=net.id,v=!isReady(id);
  if(v){
    safe(()=>selectWeapon(window.LOBBY.weapon()));
    if(members().length<2)say('Invite au moins un ami pour pouvoir lancer (menu ⚙ → amis).','#fbbf24');
    else if(needN()&&members().length!==needN())say('Ce mode demande exactement '+needN()+' joueurs ('+members().length+'/'+needN()+').','#fbbf24');
  }
  if(net.host)setReady('H',v);
  else if(net.hc&&net.hc.open){rdy()[id]=v;net.hc.send({t:'rdy',r:v})}
  render(true);
}

/* ---------- (v9) lancement SANS groupe : Solo, Coop ou PvP en recherche aléatoire ----------
   Jouer = « prêt » -> 10 s (rappuyer = annuler) -> matchmaking VERROUILLÉ (image du salon + « Matchmaking... ») -> lancement.
   Pour Coop / PvP la recherche aléatoire démarre à la fin des 5 s et reste verrouillée tant qu'elle dure. */
const searching=()=>{try{return (typeof mmIdx!=='undefined'&&mmIdx>=0)||!!net.mm}catch(e){return false}};
const flowOK=()=>{
  if(typeof state==='undefined'||state!=='MENU')return false;
  const g=curGame();if(g==='custom'||searching())return false;
  if(g==='solo')return true;
  return !inGroup()&&!net.on;
};
function sfCancel(){clearInterval(sf.t);sf.t=null;sf.on=false;render(true)}
function sfStart(){
  safe(()=>selectWeapon(window.LOBBY.weapon()));
  sf.on=true;sf.left=10;render(true);
  clearInterval(sf.t);
  sf.t=setInterval(()=>{
    if(!flowOK()){sfCancel();return}
    sf.left--;
    if(sf.left>0){render(true);return}
    clearInterval(sf.t);sf.t=null;sf.on=false;render(true);
    sf.mm=true;showMM(MM_S);                                   // phase matchmaking : plus d'annulation possible
    grpMM=setTimeout(()=>{grpMM=null;sfLaunch()},MM_S*1000);
  },1000);
}
function sfLaunch(){
  sf.bypass=true;
  try{const b=$('nl-play');if(b)b.click()}catch(e){console.warn('[groupe]',e)}
  sf.bypass=false;
  if(typeof state!=='undefined'&&state==='MENU'&&searching()){sf.search=true;sf.mm=false;showMM(0,true)}   // recherche aléatoire en cours : écran + verrou conservés
  else if(typeof state==='undefined'||state==='MENU'){hideMM()}                                            // rien ne s'est lancé : on déverrouille
}

/* ---------- 1. quitter le groupe ---------- */
function leave(){
  if(!inGroup())return;
  if(locked()){lockMsg();return}
  if(net.host&&members().length>1&&!confirm('Tu es le chef : si tu quittes, le groupe est dissous pour tout le monde. Continuer ?'))return;
  cancel(true);
  safe(()=>leaveNet());
  net.rdy={};lastSig='';
  say('Tu as quitté le groupe','#fbbf24');
  render(true);
}

/* ---------- interface : plus de grand panneau « GROUPE » ----------
   • Couronne 👑 du chef + « ✔ PRÊT / ✖ PAS PRÊT » : sous chaque personnage 3D du lobby.
   • Code du salon + « Quitter le groupe » : menu ⚙ Paramètres.
   • Il ne reste qu'une petite pastille « Départ dans N s » pendant le compte à rebours. */
const st=document.createElement('style');
st.textContent='#grp-cd{position:absolute;left:50%;top:72px;transform:translateX(-50%);z-index:25;display:none;padding:6px 14px;border-radius:999px;background:rgba(2,6,23,.72);border:1px solid rgba(74,222,128,.5);backdrop-filter:blur(8px);color:#4ade80;font:800 13px Inter,system-ui,sans-serif;pointer-events:none;white-space:nowrap}';
document.head.appendChild(st);
const P=document.createElement('div');P.id='grp-cd';
(document.getElementById('lobby')||document.body).appendChild(P);
let sig='',gcd=null,gcdT=0;
function render(force){
  let left=null;
  if(sf.on&&lobbyOn())left=Math.max(0,sf.left);
  else if(inGroup()&&lobbyOn()){
    if(cd)left=Math.max(0,cdLeft);                                   // chef : compte à rebours local
    else if(gcd!==null&&Date.now()-gcdT<2500)left=Math.max(0,gcd);   // autres joueurs : valeur reçue du chef
  }
  const s=String(left);
  if(!force&&s===sig)return;sig=s;
  if(left===null){P.style.display='none';return}
  P.textContent='⏱ Départ dans '+left+' s';P.style.display='block';
}

/* ---------- interception des clics du lobby (phase de capture) ---------- */
document.addEventListener('click',e=>{
  const t=e.target;if(!t||!t.closest)return;
  if(sf.bypass)return;
  if(locked()&&t.closest('#nl-play,#np-start,#np-leave,#qp-btn,#nl-mode-btn,#nl-list .mode-item')){e.stopImmediatePropagation();e.preventDefault();lockMsg();return}
  const li=t.closest('#nl-list .mode-item');
  if(li){
    const m=modeById(li.dataset.id),a=allow(m);
    if(!a.ok){e.stopImmediatePropagation();e.preventDefault();say(a.why);return}
    if(inGroup()&&net.host&&m&&(m.game==='coop'||m.game==='pvp'))applyMode(m);
    return;
  }
  if(t.closest('#nl-mode-btn')&&inGroup()&&!net.host){e.stopImmediatePropagation();e.preventDefault();say('🔒 Seul le chef du groupe choisit le mode de jeu.');return}
  if(t.closest('#nl-play')){
    if(inGroup()&&curGame()!=='solo'){e.stopImmediatePropagation();e.preventDefault();toggleReady();return}
    if(sf.on){e.stopImmediatePropagation();e.preventDefault();sfCancel();return}              // « non prêt » (encore possible pendant les 10 s)
    if(flowOK()){e.stopImmediatePropagation();e.preventDefault();sfStart();return}
    return;
  }
  if(t.closest('#np-start')&&inGroup()){e.stopImmediatePropagation();e.preventDefault();toggleReady();return}
},true);

/* ---------- boucle : synchronisation chef → joueurs + verrous visuels ---------- */
function tick(){
  const g=inGroup();
  if(sf.search){if(searching())sf.gap=0;else if(++sf.gap>=4)hideMM()}                                          // recherche terminée / échouée
  if((sf.mm||sf.search||sf.on)&&typeof state!=='undefined'&&state!=='MENU'){sfCancel();hideMM()}   // la partie a démarré
  if(!g){
    if(!sf.mm&&!sf.search)hideMM();
    if(net.rdy&&Object.keys(net.rdy).length)net.rdy={};
    cancel(true);lastSig='';net.gm=null;gmSig='';
  }else if(net.host){
    sendMode(false);
    const m=members(),r=rdy();let ch=false;
    Object.keys(r).forEach(k=>{if(!m.includes(k)){delete r[k];ch=true}});
    const s=m.join(',')+'|'+JSON.stringify(r);
    if(ch||s!==lastSig){lastSig=s;safe(()=>tx({t:'rd',rd:r}))}
    check();
  }
  /* liste des modes : grisés si interdits */
  const list=$('nl-list');
  if(list)list.querySelectorAll('.mode-item').forEach(li=>{
    const a=allow(modeById(li.dataset.id));
    li.style.opacity=a.ok?'':'.35';li.style.cursor=a.ok?'':'not-allowed';li.title=a.ok?'':a.why.replace('🔒 ','');
  });
  const mb=$('nl-mode-btn');
  if(mb){const lock=g&&!net.host,s=mb.firstElementChild;if(s&&s.tagName==='SPAN'){const w=lock?'🔒 Mode choisi par le chef':'Changer de mode';if(s.textContent!==w)s.textContent=w}mb.style.opacity=lock?'.65':''}
  /* bouton JOUER : vert quand je suis prêt */
  const pb=$('nl-play');
  if(pb){const rd=sf.on||(g&&curGame()!=='solo'&&isReady(net.id));pb.style.background=rd?'#22c55e':'';pb.style.borderBottomColor=rd?'#15803d':'';pb.style.color=rd?'#022c22':''}
  render(false);
}
setInterval(tick,300);

/* ---------- API utilisée par index.html / social.js ---------- */
window.GROUPE={
  inGroup,leave,allow,persist:()=>persist(),toggleReady:()=>toggleReady(),members,
  rd:id=>inGroup()?!!rdy()[id]:undefined,                       // pastilles sur les personnages 3D
  mark:id=>inGroup()?(rdy()[id]?'  ✔ prêt':'  ✖ pas prêt'):'',  // liste de la « Partie perso »
  playLabel:searching=>{
    if(mmLock)return 'Matchmaking...';
    if(sf.on)return '✔ PRÊT';
    if(searching)return 'Annuler';
    if(!inGroup()||curGame()==='solo')return 'Jouer';
    return isReady(net.id)?'✔ PRÊT':'Jouer';
  },
  npLabel:n=>inGroup()?(isReady(net.id)?'✔ Prêt — cliquer pour annuler':'Je suis prêt'):(n<2?'En attente de joueurs…':'Lancer la partie'),
  locked:()=>mmLock,
  full:()=>{try{return members().length>=net.max}catch(e){return false}}
};
})();
