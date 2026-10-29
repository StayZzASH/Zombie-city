/* =====================================================================
   MANETTES  —  Xbox · PlayStation (DualShock 4 / DualSense) · Nintendo Switch (Pro Controller)
   ---------------------------------------------------------------------
   · PC / Mac / Android / iOS : API Gamepad du navigateur (manette USB ou Bluetooth).
   · Détection automatique du type de manette (id du pad) -> les bons boutons s'affichent :
       Xbox  : A B X Y LB RB LT RT          PlayStation : ✕ ○ □ △ L1 R1 L2 R2          Switch : B A Y X L R ZL ZR
   · Bascule dynamique clavier/souris/tactile <-> manette : les aides à l'écran (« Maintiens [C] pour réanimer »,
     « [Y] Monter dans la BMW »…) passent toutes seules au nom du bon bouton (window.KBN est enveloppé).
   · Sur téléphone, l'interface tactile se masque quand la manette est utilisée et revient au premier toucher.
   · Pas de modification du moteur : la manette envoie les MÊMES entrées que le clavier (touches « par défaut »
     du jeu : KeyE = tirer, KeyR = recharger, Space = sauter…), le stick gauche pilote `joy` (déplacement analogique)
     et le stick droit tourne la caméra (yaw / pitch).
   · Menus : stick gauche / croix directionnelle = déplacer la sélection, A (✕) = valider, B (○) = retour.

   Disposition en jeu (identique sur les 3 manettes, seuls les noms changent) :
     Stick G  déplacement           Stick D  caméra               L3  sprint (verrou)     R3  accroupi
     RT       tirer / frapper       LT       viser (PvE) · parer (PvP)
     A        sauter                B        rouler / esquiver     X   recharger (PvP : prise)   Y  arme suivante
     RB       ouvrir · ramasser · réanimer (maintenir)  (PvP : kick)      LB  grenade (PvP : salto)
     Croix    ↑ véhicule   ↓ lampe   ← soin (bandage)   → grenade ↔ molotov
     Menu (☰ / Options / +)  pause     Vue (⧉ / Créer / −)  afficher / masquer l'aide des boutons
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[manette]',e&&e.message||e)}};
const clampN=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ---------- types de manettes ---------- */
function kindOf(id){
  id=String(id||'').toLowerCase();
  if(/xbox|xinput|045e/.test(id))return 'xbox';                       // « Xbox Wireless Controller » contient « wireless controller » : on teste Xbox d'abord
  if(/054c|playstation|dualsense|dualshock|sony|wireless controller/.test(id))return 'ps';
  if(/057e|nintendo|switch|pro controller|joy-?con/.test(id))return 'switch';
  return 'xbox';
}
const NAMES={xbox:'Xbox',ps:'PlayStation',switch:'Switch'};
const LAB={
  xbox:{0:'A',1:'B',2:'X',3:'Y',4:'LB',5:'RB',6:'LT',7:'RT',8:'Vue',9:'Menu',10:'LS',11:'RS',12:'↑',13:'↓',14:'←',15:'→'},
  ps:{0:'✕',1:'○',2:'□',3:'△',4:'L1',5:'R1',6:'L2',7:'R2',8:'Créer',9:'Options',10:'L3',11:'R3',12:'↑',13:'↓',14:'←',15:'→'},
  switch:{0:'B',1:'A',2:'Y',3:'X',4:'L',5:'R',6:'ZL',7:'ZR',8:'−',9:'+',10:'LS',11:'RS',12:'↑',13:'↓',14:'←',15:'→'}
};
/* couleur des boutons de face (comme sur la vraie manette) */
const COL={
  xbox:{0:'#22c55e',1:'#ef4444',2:'#3b82f6',3:'#eab308'},
  ps:{0:'#60a5fa',1:'#f87171',2:'#f472b6',3:'#34d399'},
  switch:{}
};

const G={pad:null,type:'xbox',active:false,sprint:false,legend:false,
  label(i){return(LAB[G.type]||LAB.xbox)[i]||('B'+i)},
  name(){return NAMES[G.type]||'Manette'},
  chip(i){const c=(COL[G.type]||{})[i];return '<b class="gp-chip"'+(c?' style="background:'+c+';color:#0b1020"':'')+'>'+G.label(i)+'</b>'}
};
window.GP=G;

/* ---------- actions : touche « par défaut » du jeu <-> bouton ---------- */
const BTN={A:0,B:1,X:2,Y:3,LB:4,RB:5,LT:6,RT:7,VIEW:8,MENU:9,LS:10,RS:11,UP:12,DOWN:13,LEFT:14,RIGHT:15};
/* bouton -> touche tenue (le bouton est « enfoncé » tant que la touche l'est) */
const PVE={[BTN.A]:'Space',[BTN.B]:'ControlLeft',[BTN.X]:'KeyR',[BTN.RB]:'KeyC',[BTN.LB]:'KeyG',[BTN.RT]:'KeyE',
  [BTN.RS]:'ShiftLeft',[BTN.UP]:'KeyY',[BTN.DOWN]:'KeyF',[BTN.LEFT]:'KeyU',[BTN.RIGHT]:'KeyB'};
const PVP={[BTN.A]:'Space',[BTN.B]:'ControlLeft',[BTN.X]:'KeyG',[BTN.RB]:'KeyN',[BTN.LB]:'KeyK',[BTN.RT]:'KeyE',[BTN.LT]:'KeyX',
  [BTN.RS]:'ShiftLeft',[BTN.UP]:'KeyY',[BTN.DOWN]:'KeyF',[BTN.LEFT]:'KeyU',[BTN.RIGHT]:'KeyB'};
const isPvp=()=>safe(()=>typeof mode!=='undefined'&&mode==='pvp');
const MAP=()=>isPvp()?PVP:PVE;
/* touche -> bouton (pour afficher « [RB] » à la place de « [C] ») */
function codeToBtn(code){
  const m=MAP();for(const b in m)if(m[b]===code)return +b;
  if(code==='KeyK'||code==='KeyN'||code==='KeyX'||code==='KeyG'){const o=isPvp()?PVE:PVP;for(const b in o)if(o[b]===code)return +b}
  return -1;
}
/* l'aide du jeu appelle KBN('KeyC') : si on joue à la manette, on répond avec le nom du bouton */
safe(()=>{
  const old=window.KBN||function(c){return String(c).replace(/^Key|^Digit/,'')};
  window.KBN=function(c){
    if(G.active){
      if(/^Digit[1-5]$/.test(c))return G.label(BTN.Y);                 // armes 1-5 : « arme suivante » sur la manette
      const b=codeToBtn(c);if(b>=0)return G.label(b);
    }
    return old.apply(this,arguments);
  };
});

/* ---------- émission d'entrées « clavier » synthétiques ---------- */
const down={};                      // touches actuellement tenues par la manette
function keyEv(type,code){
  const key=code==='Space'?' ':code.replace(/^Key|^Digit|Left$/,'').toLowerCase();
  const e=new KeyboardEvent(type,{code,key,bubbles:true,cancelable:true});
  e.__zc=1;                          // ignoré par la traduction des touches (module « touches »)
  return e;
}
function kdown(code){if(down[code])return;down[code]=1;safe(()=>window.dispatchEvent(keyEv('keydown',code)))}
function kup(code){if(!down[code])return;down[code]=0;safe(()=>window.dispatchEvent(keyEv('keyup',code)))}
function releaseAll(){Object.keys(down).forEach(kup);safe(()=>{joy.f=joy.r=0});G.sprint=false;window.__GPSPRINT=false}

/* ---------- état des boutons ---------- */
const prev=[];let btnDown=[];
const pressed=(pad,i)=>{const b=pad.buttons[i];return !!b&&(typeof b==='object'?(b.pressed||b.value>.55):b>.55)};
const val=(pad,i)=>{const b=pad.buttons[i];return !b?0:(typeof b==='object'?b.value:+b)||0};
const dz=(x,y,d)=>{const m=Math.hypot(x,y);if(m<d)return[0,0];const k=(Math.min(1,m)-d)/(1-d)/m;return[x*k,y*k]};

/* ---------- jeu actif / menus ---------- */
let overlayOn=false;
function scanOverlay(){
  let f=false;
  for(const el of document.body.children){
    if(!el.id||/^(gp-|touch-ui|hud|minimap|help|prompt|combo|slots)/.test(el.id))continue;
    const cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden'||cs.pointerEvents==='none')continue;
    if(cs.position!=='fixed'&&cs.position!=='absolute')continue;
    const r=el.getBoundingClientRect();
    if(r.width*r.height<innerWidth*innerHeight*.28)continue;
    if(el.querySelector('button,[role=button],input,select'))f=true;
  }
  overlayOn=f;
}
setInterval(()=>safe(scanOverlay),350);
const inGameScreen=()=>safe(()=>typeof state!=='undefined'&&state==='PLAYING'&&!window.__paused&&!overlayOn);

let lastAct=0;
function setActive(on,why){
  if(G.active===on)return;
  G.active=on;document.body.classList.toggle('gp-on',on);
  if(!on)releaseAll();
  safe(()=>window.dispatchEvent(new CustomEvent('gp-change',{detail:{active:on,type:G.type}})));
  refreshHints();
}
/* le premier geste clavier / souris / toucher reprend la main */
['keydown','mousedown','touchstart','pointerdown'].forEach(ev=>addEventListener(ev,e=>{
  if(e.__zc)return;
  if(ev==='pointerdown'&&e.pointerType==='mouse'&&!e.isTrusted)return;
  if(e.isTrusted)setActive(false);
},true));
addEventListener('mousemove',e=>{if(e.isTrusted&&(Math.abs(e.movementX||0)+Math.abs(e.movementY||0)>2))setActive(false)},true);

/* ---------- aide des boutons à l'écran ---------- */
const css=document.createElement('style');
css.textContent=`
.gp-chip{display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 7px;border-radius:13px;background:#e2e8f0;color:#0b1020;font:800 12px Inter,system-ui,sans-serif;box-shadow:0 1px 0 rgba(0,0,0,.5)}
#gp-legend{position:fixed;right:max(12px,env(safe-area-inset-right,0px));bottom:max(12px,env(safe-area-inset-bottom,0px));z-index:70;display:none;pointer-events:none;
  padding:10px 12px;border-radius:14px;background:rgba(2,6,23,.78);border:1px solid rgba(148,163,184,.35);color:#e2e8f0;font:600 12px Inter,system-ui,sans-serif;backdrop-filter:blur(6px)}
#gp-legend.on{display:block}
#gp-legend .r{display:flex;align-items:center;gap:8px;margin:4px 0;white-space:nowrap}
#gp-legend .t{font:800 10px Inter,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#fbbf24;margin-bottom:4px}
#gp-toast{position:fixed;left:50%;top:max(14px,env(safe-area-inset-top,0px));transform:translate(-50%,-20px);opacity:0;z-index:80;pointer-events:none;transition:all .35s ease;
  padding:9px 16px;border-radius:14px;background:rgba(2,6,23,.88);border:1px solid #22c55e;color:#fff;font:700 14px Inter,system-ui,sans-serif;white-space:nowrap}
#gp-toast.on{opacity:1;transform:translate(-50%,0)}
.gp-focus{outline:3px solid #fbbf24!important;outline-offset:2px!important;box-shadow:0 0 0 6px rgba(251,191,36,.25)!important;border-radius:8px}
body.gp-on #touch-ui{visibility:hidden}
body.gp-on *{cursor:none!important}
`;
document.head.appendChild(css);
const leg=document.createElement('div');leg.id='gp-legend';document.body.appendChild(leg);
const badge=document.createElement('div');badge.id='gp-badge';
badge.style.cssText='position:fixed;left:max(10px,env(safe-area-inset-left,0px));top:max(10px,env(safe-area-inset-top,0px));z-index:70;display:none;pointer-events:none;padding:4px 9px;border-radius:12px;background:rgba(2,6,23,.65);border:1px solid rgba(148,163,184,.35);color:#e2e8f0;font:700 12px Inter,system-ui,sans-serif';
document.body.appendChild(badge);
setInterval(()=>{const on=!!G.pad;badge.style.display=on?'block':'none';if(on){badge.textContent='🎮 '+G.name();badge.style.opacity=G.active?1:.55;badge.style.borderColor=G.active?'#22c55e':'rgba(148,163,184,.35)'}},700);
const toastEl=document.createElement('div');toastEl.id='gp-toast';document.body.appendChild(toastEl);
let toastT=0,legT=0;
function gpToast(h,ms){toastEl.innerHTML=h;toastEl.classList.add('on');clearTimeout(toastT);toastT=setTimeout(()=>toastEl.classList.remove('on'),ms||2800)}
function legendHTML(){
  const P=isPvp();
  const rows=inGameScreen()?(P?[[BTN.RT,'Frapper'],[BTN.LT,'Parer'],[BTN.A,'Sauter'],[BTN.B,'Rouler'],[BTN.LB,'Salto'],[BTN.RB,'Kick'],[BTN.X,'Prise']]
    :[[BTN.RT,'Tirer'],[BTN.LT,'Viser'],[BTN.X,'Recharger'],[BTN.A,'Sauter'],[BTN.B,'Rouler'],[BTN.Y,'Arme suivante'],[BTN.RB,'Interagir / réanimer'],[BTN.LB,'Grenade'],[BTN.LS,'Sprint']])
    :[[BTN.A,'Valider'],[BTN.B,'Retour'],[BTN.UP,'Naviguer']];
  return '<div class="t">🎮 '+G.name()+'</div>'+rows.map(r=>'<div class="r">'+G.chip(r[0])+'<span>'+r[1]+'</span></div>').join('');
}
function refreshHints(){
  if(G.active&&G.legend){leg.innerHTML=legendHTML();leg.classList.add('on')}else leg.classList.remove('on');
}
function showLegend(ms){G.legend=true;refreshHints();clearTimeout(legT);if(ms)legT=setTimeout(()=>{G.legend=false;refreshHints()},ms)}
setInterval(()=>{if(G.active&&G.legend)refreshHints()},1500);     // suit le mode (PvE / PvP / menu)

/* ---------- connexion / déconnexion ---------- */
function pickPad(){
  const l=(navigator.getGamepads&&navigator.getGamepads())||[];
  let best=null;for(const p of l){if(p&&p.connected&&(!best||(p.mapping==='standard'&&best.mapping!=='standard')))best=p}
  return best;
}
addEventListener('gamepadconnected',e=>{
  G.pad=e.gamepad;const t=kindOf(e.gamepad.id);const nw=t!==G.type||!G.pad;G.type=t;
  gpToast('🎮 Manette '+NAMES[t]+' connectée',2600);showLegend(7000);setActive(true);
});
addEventListener('gamepaddisconnected',e=>{
  const p=pickPad();
  if(p){G.pad=p;G.type=kindOf(p.id);return}
  G.pad=null;releaseAll();gpToast('🎮 Manette déconnectée',2200);setActive(false);G.legend=false;refreshHints();
  safe(()=>{if(inGameScreen()&&!(typeof net!=='undefined'&&net.on)&&window.__GPPAUSE)window.__GPPAUSE()});
});
addEventListener('blur',releaseAll);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAll()});

/* ---------- navigation dans les menus ---------- */
const SEL='button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[onclick],[data-ct],[data-kb],.cursor-pointer,[data-go],[data-t],[data-lk],[data-w],[data-close],.mode-item,.wp,nav li';
let focusEl=null,navT=0;
function scrollParent(el){
  let p=el.parentElement;
  while(p&&p!==document.body&&p!==document.documentElement){
    const o=getComputedStyle(p).overflowY;
    if((o==='auto'||o==='scroll')&&p.scrollHeight>p.clientHeight+4)return p;
    p=p.parentElement;
  }
  return null;
}
/* tout ce qui est cliquable : balises, attributs, et n'importe quel élément au curseur « main » (onglets, cartes, quêtes…) */
function visibleEls(){
  const out=[],SC=new Map(),cand=new Set(document.querySelectorAll(SEL));
  document.querySelectorAll('div,span,li,td,label,img,svg,section,article').forEach(el=>{
    if(cand.has(el)||el.closest('[hidden],.hidden'))return;
    const r=el.getBoundingClientRect();if(r.width<6||r.height<6)return;
    if(getComputedStyle(el).cursor==='pointer'&&!(el.parentElement&&cand.has(el.parentElement)))cand.add(el);
  });
  const docScroll=document.scrollingElement&&document.scrollingElement.scrollHeight>innerHeight+4;
  cand.forEach(el=>{
    if(el.disabled||el.closest('[hidden],.hidden'))return;
    const r=el.getBoundingClientRect();if(r.width<6||r.height<6)return;
    const cs=getComputedStyle(el);if(cs.visibility==='hidden'||cs.display==='none'||+cs.opacity===0||cs.pointerEvents==='none')return;
    const off=r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth;
    if(!off){
      const cx=clampN(r.left+r.width/2,1,innerWidth-1),cy=clampN(r.top+r.height/2,1,innerHeight-1);
      const top=document.elementFromPoint(cx,cy);if(!top||!(top===el||el.contains(top)||top.contains(el)))return;
      out.push({el,r,cx,cy});return;
    }
    /* hors écran : accessible seulement s'il est dans une zone qui défile (on descend avec la manette) */
    if(r.right<0||r.left>innerWidth)return;
    const sp=scrollParent(el);
    if(sp){
      const sr=sp.getBoundingClientRect();if(sr.width<6||sr.bottom<0||sr.top>innerHeight)return;
      let ok=SC.get(sp);
      if(ok===undefined){
        const t=document.elementFromPoint(clampN(sr.left+sr.width/2,1,innerWidth-1),clampN(sr.top+Math.min(sr.height,innerHeight-sr.top)/2,1,innerHeight-1));
        ok=!!t&&(sp===t||sp.contains(t)||t.contains(sp));SC.set(sp,ok);
      }
      if(!ok)return;
    }else if(!docScroll)return;
    out.push({el,r,cx:r.left+r.width/2,cy:r.top+r.height/2});
  });
  return out;
}
function setFocus(el){
  if(focusEl)focusEl.classList.remove('gp-focus');
  focusEl=el;if(el){el.classList.add('gp-focus');safe(()=>el.scrollIntoView({block:'center',inline:'nearest'}))}
}
function nav(dx,dy){
  /* curseur / liste déroulante sous le focus : gauche-droite règle la valeur */
  if(focusEl&&document.contains(focusEl)&&dx){
    const f=focusEl;
    if(f.tagName==='INPUT'&&f.type==='range'){
      const mn=+f.min||0,mx=f.max===''?100:+f.max,st=+f.step||1;
      f.value=Math.max(mn,Math.min(mx,(+f.value)+dx*Math.max(st,(mx-mn)/20)));
      ['input','change'].forEach(t=>f.dispatchEvent(new Event(t,{bubbles:true})));return;
    }
    if(f.tagName==='SELECT'){
      f.selectedIndex=Math.max(0,Math.min(f.options.length-1,f.selectedIndex+dx));
      ['input','change'].forEach(t=>f.dispatchEvent(new Event(t,{bubbles:true})));return;
    }
  }
  const list=visibleEls();if(!list.length)return;
  let cur=focusEl&&document.contains(focusEl)?list.find(o=>o.el===focusEl):null;
  if(!cur){
    // premier appui : le bouton principal (JOUER…) ou le plus central
    cur=list.find(o=>/jouer|play|lancer|start/i.test(o.el.textContent||''))||list.slice().sort((a,b)=>Math.hypot(a.cx-innerWidth/2,a.cy-innerHeight/2)-Math.hypot(b.cx-innerWidth/2,b.cy-innerHeight/2))[0];
    setFocus(cur.el);return;
  }
  let best=null,bs=1e9;
  for(const o of list){
    if(o===cur)continue;
    const vx=o.cx-cur.cx,vy=o.cy-cur.cy,along=vx*dx+vy*dy;if(along<=4)continue;
    const across=Math.abs(vx*dy)+Math.abs(vy*dx),s=along+across*2.2;
    if(s<bs){bs=s;best=o}
  }
  if(best)setFocus(best.el);
  else if(dy){   // plus rien dans cette direction : on fait défiler pour découvrir la suite
    const sp=scrollParent(cur.el)||document.scrollingElement;if(sp)sp.scrollTop+=dy*320;
  }
}
/* LB / RB : onglet précédent / suivant (Jouer, Boutique, Casier, Passe, Quêtes, Compte, Classement) */
function cycleTab(dir){
  const tabs=[...document.querySelectorAll('[data-go]')].filter(e=>{
    if(e.closest('[hidden],.hidden'))return false;
    const r=e.getBoundingClientRect();if(r.width<6||r.height<6)return false;
    return e.tagName==='LI'||e.closest('nav');
  });
  if(!tabs.length)return false;
  const dom=()=>{const a=tabs.find(e=>e.classList.contains('nv-active'));return a?a.dataset.go:''};
  let i=-1;
  /* Casier / Passe / Quêtes ne mettent pas la barre à jour (le jeu garde « Jouer » ou l'ancien onglet) :
     on retient donc nous-mêmes l'onglet atteint, tant que la barre n'a pas changé depuis. */
  if(tabMem&&tabMem.dom===dom())i=tabs.findIndex(e=>e.dataset.go===tabMem.go);
  if(i<0)i=tabs.findIndex(e=>e.classList.contains('nv-active'));
  if(i<0)i=0;
  const t=tabs[(i+dir+tabs.length)%tabs.length];
  safe(()=>{const p=document.getElementById('pz-panel');if(p)p.style.display='none'});   // le panneau Passe / Quêtes recouvre le menu : on le ferme
  setFocus(t);activate();
  tabMem={go:t.dataset.go,dom:dom()};
  return true;
}
let tabMem=null;
function activate(){
  const el=focusEl&&document.contains(focusEl)?focusEl:null;if(!el)return;
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  const tag=el.tagName;
  if(tag==='INPUT'&&/^(checkbox|radio|button|submit|reset)$/.test(el.type)){el.click();safe(()=>window.SFX&&SFX.ui&&SFX.ui());return}
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'){el.focus();if(tag==='SELECT')safe(()=>el.showPicker&&el.showPicker());return}
  ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{
    const ev=t.startsWith('pointer')?new PointerEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,pointerType:'mouse',button:0,isPrimary:true}):new MouseEvent(t,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0,view:window});
    ev.__zc=1;el.dispatchEvent(ev);
  });
  safe(()=>window.SFX&&SFX.ui&&SFX.ui());
}
function back(){
  const e=new KeyboardEvent('keydown',{code:'Escape',key:'Escape',bubbles:true,cancelable:true});e.__zc=1;window.dispatchEvent(e);
  const u=new KeyboardEvent('keyup',{code:'Escape',key:'Escape',bubbles:true,cancelable:true});u.__zc=1;window.dispatchEvent(u);
  // ferme aussi les boutons « ✕ / Fermer / Retour » visibles
  const c=[...document.querySelectorAll('button,[role=button]')].find(b=>{const r=b.getBoundingClientRect();return r.width>4&&/^(✕|✖|×|x|fermer|retour|close|annuler)$/i.test((b.textContent||'').trim())});
  if(c)c.click();
}

/* ---------- boucle principale ---------- */
let last=performance.now(),yawCarry=0;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.05,(now-last)/1000);last=now;
  const pad=pickPad();
  if(!pad){if(G.pad){G.pad=null}return}
  G.pad=pad;const type=kindOf(pad.id);if(type!==G.type){G.type=type;refreshHints()}
  const lx=pad.axes[0]||0,ly=pad.axes[1]||0,rx=pad.axes[2]||0,ry=pad.axes[3]||0;
  let any=Math.hypot(lx,ly)>.3||Math.hypot(rx,ry)>.3;
  for(let i=0;i<17;i++){const p=pressed(pad,i);if(p)any=true;btnDown[i]=p}
  if(any){lastAct=now;if(!G.active){setActive(true);if(!G.legend)showLegend(6000)}}
  if(!G.active){for(let i=0;i<17;i++)prev[i]=btnDown[i];return}

  const edge=i=>btnDown[i]&&!prev[i],rel=i=>!btnDown[i]&&prev[i];
  const gameOn=inGameScreen();

  /* ===== ÉCRANS DE MENU / PAUSE / BOUTIQUE ===== */
  if(!gameOn){
    if(Object.keys(down).length)releaseAll();
    const [mx,my]=dz(lx,ly,.5);
    if(now-navT>200){
      let dx=0,dy=0;
      if(btnDown[BTN.UP]||my<-.5)dy=-1;else if(btnDown[BTN.DOWN]||my>.5)dy=1;
      else if(btnDown[BTN.LEFT]||mx<-.5)dx=-1;else if(btnDown[BTN.RIGHT]||mx>.5)dx=1;
      if(dx||dy){navT=now;nav(dx,dy);safe(()=>window.SFX&&SFX.tick&&SFX.tick())}
    }
    if(edge(BTN.A))activate();
    if(edge(BTN.LB))cycleTab(-1);
    if(edge(BTN.RB))cycleTab(1);
    if(edge(BTN.B))back();
    if(edge(BTN.MENU)&&typeof state!=='undefined'&&state==='PLAYING')back();
    if(edge(BTN.VIEW)){G.legend=!G.legend;refreshHints()}
    // défilement avec le stick droit
    if(Math.abs(ry)>.3){const sc=document.scrollingElement;((focusEl&&scrollParent(focusEl))||sc).scrollTop+=ry*900*dt}
    for(let i=0;i<17;i++)prev[i]=btnDown[i];
    return;
  }
  if(focusEl){setFocus(null)}

  /* ===== EN JEU ===== */
  const alive=!(safe(()=>selfDead));
  /* déplacement analogique (stick gauche -> joy) */
  const [mx,my]=dz(lx,ly,.16);
  safe(()=>{joy.r=alive?mx:0;joy.f=alive?-my:0});
  /* sprint : L3 verrouille, relâché quand on s'arrête */
  if(edge(BTN.LS))G.sprint=!G.sprint;
  if(Math.hypot(mx,my)<.12)G.sprint=false;
  window.__GPSPRINT=G.sprint&&alive;
  /* caméra (stick droit) : courbe progressive pour viser précisément */
  const [cx,cy]=dz(rx,ry,.14);
  const curve=v=>Math.sign(v)*Math.pow(Math.abs(v),1.7);
  safe(()=>{
    const aimK=(typeof ads!=='undefined'&&ads)?(weaponKey==='sniper'?.28:.55):1;
    const sens=(window.ZS&&(ZS.sensPad||ZS.sens))||1;
    const speed=3.3*aimK*sens;
    yaw-=curve(cx)*speed*dt;
    pitch=clamp(pitch-curve(cy)*(window.ZS&&ZS.invP?-1:1)*speed*.8*dt,-1.5,1.5);
  });
  /* gâchettes : LT = viser (PvE) ; RT = tirer */
  const lt=val(pad,BTN.LT),m=MAP();
  if(!isPvp()){
    const want=lt>.35&&alive;
    safe(()=>{if(want!==!!ads&&typeof setADS==='function')setADS(want)});
  }
  /* boutons -> touches tenues */
  for(const b in m){
    const code=m[b];
    let on=!!btnDown[b]&&alive;
    if(!alive&&code!=='KeyC'&&code!=='KeyG')on=false;
    if(code==='KeyX'){on=lt>.35&&alive}                                  // PvP : parade tant que LT est tenu
    if(code==='ShiftLeft'){if(edge(+b)&&alive)G.crouch=!G.crouch;on=!!G.crouch&&alive;if(!alive)G.crouch=false}   // R3 = accroupi (bascule)
    if(code==='Space'&&alive===false)on=false;
    if(on)kdown(code);else kup(code);
  }
  /* Y : arme suivante (PvE) */
  if(edge(BTN.Y)&&alive&&!isPvp()){
    safe(()=>{
      for(let k=1;k<=5;k++){const i=(cur+k)%5;if(slots[i]){equip(i);break}}
    });
  }
  /* Menu : pause · Vue : aide */
  if(edge(BTN.MENU))safe(()=>{if(window.__GPPAUSE)window.__GPPAUSE();else back()});
  if(edge(BTN.VIEW)){G.legend=!G.legend;refreshHints()}
  /* vibration discrète quand on prend des dégâts */
  safe(()=>{
    const h=typeof hp==='number'?hp:100;
    if(G.lastHp===undefined)G.lastHp=h;
    if(h<G.lastHp-.5&&pad.vibrationActuator&&pad.vibrationActuator.playEffect&&now-(G.vibT||0)>250){
      G.vibT=now;pad.vibrationActuator.playEffect('dual-rumble',{duration:Math.min(260,80+(G.lastHp-h)*8),strongMagnitude:Math.min(1,(G.lastHp-h)/25),weakMagnitude:.5}).catch(()=>{});
    }
    G.lastHp=h;
  });
  for(let i=0;i<17;i++)prev[i]=btnDown[i];
}
requestAnimationFrame(frame);

/* pause : même mécanisme que la touche Échap du jeu (menu de pause / réglages) */
window.__GPPAUSE=()=>{
  const g=[...document.querySelectorAll('button,[role=button],div,span')].find(b=>{
    const r=b.getBoundingClientRect();return r.width>8&&r.width<90&&r.height>8&&r.height<90&&/^(⚙️?|⚙|☰|≡)$/.test((b.textContent||'').trim())});
  if(g){g.click();return}
  back();
};

/* petite aide pour les autres modules */
G.isActive=()=>G.active;
G.rumble=(ms,s,w)=>safe(()=>{const p=G.pad;if(p&&p.vibrationActuator&&p.vibrationActuator.playEffect)p.vibrationActuator.playEffect('dual-rumble',{duration:ms||120,strongMagnitude:s||.5,weakMagnitude:w||.3}).catch(()=>{})});

/* une manette déjà branchée au chargement de la page (Chrome l'expose après le 1er bouton) */
safe(()=>{const p=pickPad();if(p){G.pad=p;G.type=kindOf(p.id)}});
})();
