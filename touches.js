/* =====================================================================
   TOUCHES  —  configuration complète du clavier (ordinateur)
   ---------------------------------------------------------------------
   • TOUTES les actions du jeu sont réglables (lancer, grenade, coffre, véhicule,
     pièges, soins, ping, salto, kick, armes 1-5, déplacements…).
   • Une même touche peut servir à PLUSIEURS actions (ex. « E » = ouvrir un coffre
     ET monter dans la voiture). Une action peut aussi avoir PLUSIEURS touches.
   • Les affichages du jeu (« C — Ouvrir le coffre », « Y — Monter dans la BMW »,
     l'aide en haut à gauche…) se mettent à jour avec la touche choisie : ils
     appellent window.KBN('KeyC') qui renvoie le nom de la touche actuelle.
   • Compatible avec l'ancien format de sauvegarde (migration automatique).

   Fonctionnement : le jeu écoute des codes « par défaut » (KeyC, KeyY…). Ce module
   intercepte la vraie touche pressée et la traduit en codes par défaut.
   ===================================================================== */
(function(){
'use strict';
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- liste COMPLÈTE des actions : id = code que le jeu écoute ---------- */
const GROUPS=['Déplacement','Combat','Objets et soins','Véhicules','PvP Arène'];
const ACT=[
 {id:'KeyW',label:'Avancer',g:0,def:['KeyW','KeyZ','ArrowUp']},
 {id:'KeyS',label:'Reculer',g:0,def:['KeyS','ArrowDown']},
 {id:'KeyA',label:'Gauche',g:0,def:['KeyA','KeyQ','ArrowLeft']},
 {id:'KeyD',label:'Droite',g:0,def:['KeyD','ArrowRight']},
 {id:'Space',label:'Sauter · frein à main · monter (hélico)',g:0,def:['Space']},
 {id:'ControlLeft',label:'Rouler · esquive · descendre (hélico)',g:0,def:['ControlLeft','ControlRight']},
 {id:'ShiftLeft',label:'Accroupi · glissade · turbo',g:0,def:['ShiftLeft','ShiftRight']},

 {id:'KeyE',label:'Tirer',g:1,def:['KeyE']},
 {id:'KeyR',label:'Recharger',g:1,def:['KeyR']},
 {id:'KeyF',label:'Lampe torche',g:1,def:['KeyF']},
 {id:'KeyG',label:'Lancer grenade / molotov',g:1,def:['KeyG']},
 {id:'KeyB',label:'Changer grenade ↔ molotov',g:1,def:['KeyB']},
 {id:'KeyX',label:'Barricade (PvE) · Parer (PvP)',g:1,def:['KeyX']},
 {id:'Digit1',label:'Arme / emplacement 1',g:1,def:['Digit1']},
 {id:'Digit2',label:'Arme / emplacement 2',g:1,def:['Digit2']},
 {id:'Digit3',label:'Arme / emplacement 3',g:1,def:['Digit3']},
 {id:'Digit4',label:'Arme / emplacement 4',g:1,def:['Digit4']},
 {id:'Digit5',label:'Arme / emplacement 5',g:1,def:['Digit5']},

 {id:'KeyC',label:'Ouvrir un coffre · ramasser',g:2,def:['KeyC']},
 {id:'KeyV',label:'Vendre l’arme',g:2,def:['KeyV']},
 {id:'KeyT',label:'Poser une tourelle',g:2,def:['KeyT']},
 {id:'KeyM',label:'Poser une mine · musique',g:2,def:['KeyM']},
 {id:'KeyH',label:'Barbelés (PvE) · Grappin (PvP)',g:2,def:['KeyH']},
 {id:'KeyJ',label:'Piège à loup',g:2,def:['KeyJ']},
 {id:'KeyU',label:'Bandage',g:2,def:['KeyU']},
 {id:'KeyI',label:'Trousse de soins',g:2,def:['KeyI']},
 {id:'KeyO',label:'Adrénaline',g:2,def:['KeyO']},
 {id:'KeyL',label:'Jeter l’arme',g:2,def:['KeyL']},
 {id:'KeyP',label:'Ping (marqueur)',g:2,def:['KeyP']},

 {id:'KeyY',label:'Monter / descendre du véhicule',g:3,def:['KeyY']},

 {id:'KeyK',label:'Salto arrière',g:4,def:['KeyK']},
 {id:'KeyN',label:'Kick / contre-attaque',g:4,def:['KeyN']}
];
const BYID={};ACT.forEach(a=>BYID[a.id]=a);

/* ---------- état ---------- */
let map={},inv={},GC=new Set(),store=null,listening=null,LM=null;
const defaults=()=>{const m={};ACT.forEach(a=>m[a.id]=a.def.slice());return m};
function rebuild(){
  inv={};GC=new Set();
  ACT.forEach(a=>{GC.add(a.id);a.def.forEach(c=>GC.add(c))});
  ACT.forEach(a=>(map[a.id]||[]).forEach(c=>{(inv[c]=inv[c]||[]).push(a.id)}));
}
function sync(){if(store)store.__v2={v:2,map:map}}
function persist(){
  sync();
  try{window.__zsSave&&window.__zsSave()}catch(e){}
  try{localStorage.setItem('zs_keys_v2',JSON.stringify(map))}catch(e){}
}
function load(c){
  store=(c&&typeof c==='object')?c:{};
  const m=defaults();let found=false;
  const v=store.__v2;
  if(v&&v.map){
    found=true;
    ACT.forEach(a=>{const x=v.map[a.id];if(Array.isArray(x))m[a.id]=x.filter(k=>typeof k==='string'&&k).slice(0,6)});
  }else{
    /* ancien format : { KeyG:'KeyH' } = « l'action G est maintenant sur H » */
    ACT.forEach(a=>{const o=store[a.id];if(typeof o==='string'&&o){m[a.id]=[o];found=true}});
  }
  ACT.forEach(a=>{if(typeof store[a.id]==='string')delete store[a.id]});   // l'ancien traducteur ne doit plus s'en servir
  if(!found){                                                                 // invité / rien dans le cloud : copie locale
    try{const l=JSON.parse(localStorage.getItem('zs_keys_v2')||'null');
      if(l)ACT.forEach(a=>{if(Array.isArray(l[a.id]))m[a.id]=l[a.id].filter(k=>typeof k==='string'&&k).slice(0,6)})}catch(e){}
  }
  map=m;sync();rebuild();refresh();
}

/* ---------- noms de touches (selon le vrai clavier : AZERTY, QWERTY…) ---------- */
try{if(navigator.keyboard&&navigator.keyboard.getLayoutMap)navigator.keyboard.getLayoutMap().then(m=>{LM=m;refresh()}).catch(()=>{})}catch(e){}
const SP={Space:'Espace',ControlLeft:'Ctrl',ControlRight:'Ctrl droit',ShiftLeft:'Maj',ShiftRight:'Maj droit',AltLeft:'Alt',AltRight:'Alt Gr',
 Enter:'Entrée',NumpadEnter:'Entrée (pavé)',Backspace:'Retour',Tab:'Tab',CapsLock:'Verr. Maj',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',
 Backquote:'²',Delete:'Suppr',Insert:'Inser',Home:'Début',End:'Fin',PageUp:'Pg ↑',PageDown:'Pg ↓',NumpadAdd:'Pavé +',NumpadSubtract:'Pavé −',
 NumpadMultiply:'Pavé ×',NumpadDivide:'Pavé ÷',NumpadDecimal:'Pavé .',MetaLeft:'Win',MetaRight:'Win droit',ContextMenu:'Menu'};
function nice(c){
  if(SP[c])return SP[c];
  if(/^Numpad\d$/.test(c))return 'Pavé '+c[6];
  if(/^F\d+$/.test(c))return c;
  if(/^Digit\d$/.test(c))return c[5];
  if(LM&&LM.get&&LM.get(c))return String(LM.get(c)).toUpperCase();
  return c.replace(/^Key/,'');
}
/* nom de la (première) touche d'une action — utilisé par TOUS les affichages du jeu */
function KBN(id){const k=map[id];if(!k)return nice(id);return k.length?nice(k[0]):'—'}
function KBALL(id){const k=map[id];if(!k)return nice(id);return k.length?k.map(nice).join(' / '):'—'}
window.KBN=KBN;window.KBALL=KBALL;

/* ---------- traduction : vraie touche → codes que le jeu comprend ---------- */
const keyOf=c=>/^Key[A-Z]$/.test(c)?c[3].toLowerCase():/^Digit\d$/.test(c)?c[5]:c==='Space'?' ':c.replace(/Left$|Right$/,'');
function tr(e){
  if(e.__zc||!e.code||listening)return;
  const tg=e.target;if(tg&&/INPUT|TEXTAREA|SELECT/.test(tg.tagName||''))return;
  const p=e.code,t=inv[p];
  if(!t||!t.length){
    if(GC.has(p)){e.stopImmediatePropagation();e.preventDefault()}   // touche d'origine d'une action déplacée : désactivée
    return;
  }
  const own=t.includes(p),extra=own?t.filter(x=>x!==p):t;
  if(!own){e.stopImmediatePropagation();e.preventDefault()}          // sinon la touche d'origine passe normalement
  if(!extra.length)return;
  extra.forEach(id=>{
    const n=new KeyboardEvent(e.type,{code:id,key:keyOf(id),bubbles:true,cancelable:true,repeat:e.repeat,ctrlKey:e.ctrlKey,shiftKey:e.shiftKey});
    n.__zc=1;(e.target||document).dispatchEvent(n);
  });
}
/* capture d'une nouvelle touche (doit passer AVANT tout le reste) */
addEventListener('keydown',e=>{
  if(!listening)return;
  e.preventDefault();e.stopImmediatePropagation();
  if(e.code==='Escape'||!e.code||e.code==='Unidentified'){listening=null;refresh();return}
  const L=listening;listening=null;
  const arr=map[L.id]=(map[L.id]||[]).slice();
  if(L.i>=0&&L.i<arr.length)arr[L.i]=e.code;else if(!arr.includes(e.code))arr.push(e.code);
  map[L.id]=arr.filter((c,i)=>arr.indexOf(c)===i).slice(0,6);
  persist();rebuild();refresh();
},true);
addEventListener('keyup',e=>{if(listening){e.preventDefault();e.stopImmediatePropagation()}},true);
addEventListener('keydown',tr,true);addEventListener('keyup',tr,true);

/* ---------- panneau « Paramètres → Contrôles » ---------- */
function chip(a,i,c){
  const sh=(inv[c]||[]).filter(x=>x!==a.id).map(x=>BYID[x]&&BYID[x].label).filter(Boolean);
  const on=listening&&listening.id===a.id&&listening.i===i;
  return '<span class="inline-flex items-stretch rounded overflow-hidden border '+(sh.length?'border-sky-400/70':'border-slate-600')+'" '+(sh.length?'title="Aussi utilisée pour : '+esc(sh.join(', '))+'"':'')+'>'+
    '<button data-kb="chg" data-id="'+a.id+'" data-i="'+i+'" class="px-2 py-0.5 text-xs font-bold '+(on?'bg-orange-500 text-slate-950':'bg-slate-700 text-orange-300')+'">'+(on?'Appuie sur une touche…':esc(nice(c)))+'</button>'+
    '<button data-kb="del" data-id="'+a.id+'" data-i="'+i+'" class="px-1.5 text-xs bg-slate-900 text-slate-400 hover:text-red-400" title="Retirer cette touche">✕</button></span>';
}
function panel(){
  if(document.body.classList.contains('touch'))return '<p class="text-slate-400">Le changement de touches concerne le clavier (ordinateur).</p>';
  let h='<div id="kb-root"><p class="text-slate-400 text-xs mb-3">Clique sur une touche pour la changer, sur <b>＋</b> pour en ajouter une, sur <b>✕</b> pour la retirer. '+
    'Tu peux mettre <b>la même touche sur plusieurs actions</b> (par ex. ouvrir un coffre <i>et</i> monter dans la voiture). Les touches partagées ont un contour bleu. Échap annule.</p>';
  GROUPS.forEach((gn,gi)=>{
    h+='<p class="text-[11px] font-bold uppercase tracking-widest text-yellow-400 mt-3 mb-1">'+gn+'</p><div class="grid md:grid-cols-2 gap-2">';
    ACT.filter(a=>a.g===gi).forEach(a=>{
      const ks=(map[a.id]||[]).map((c,i)=>chip(a,i,c)).join('')||'<span class="text-xs text-slate-500">aucune touche</span>';
      const adding=listening&&listening.id===a.id&&listening.i===-1;
      h+='<div class="flex items-center justify-between gap-2 bg-slate-800 rounded-lg px-3 py-2"><span class="text-sm">'+a.label+'</span>'+
        '<span class="flex flex-wrap items-center justify-end gap-1">'+ks+
        (adding?'<span class="px-2 py-0.5 rounded text-xs font-bold bg-orange-500 text-slate-950">Appuie sur une touche…</span>':
          '<button data-kb="add" data-id="'+a.id+'" class="px-2 py-0.5 rounded text-xs font-bold bg-slate-700 hover:bg-slate-600" title="Ajouter une touche">＋</button>')+'</span></div>';
    });
    h+='</div>';
  });
  h+='<div class="flex gap-2 mt-4"><button data-kb="reset" class="px-3 py-2 rounded-lg bg-red-500/20 border border-red-500/50 text-sm font-bold">↺ Touches par défaut</button></div></div>';
  return h;
}
function refresh(){
  const r=document.getElementById('kb-root');if(!r||!r.parentElement)return;
  const b=r.parentElement,st=b.scrollTop;b.innerHTML=panel();b.scrollTop=st;
}
document.addEventListener('click',e=>{
  const b=e.target.closest&&e.target.closest('[data-kb]');if(!b)return;
  e.stopPropagation();e.preventDefault();
  const k=b.dataset.kb,id=b.dataset.id,i=+b.dataset.i;
  if(k==='chg')listening={id,i};
  else if(k==='add')listening={id,i:-1};
  else if(k==='del'){map[id]=(map[id]||[]).filter((c,j)=>j!==i);persist();rebuild()}
  else if(k==='reset'){if(!confirm('Remettre toutes les touches par défaut ?'))return;map=defaults();listening=null;persist();rebuild()}
  refresh();
},true);

window.KB={load,panel,refresh,actions:ACT,get:id=>(map[id]||[]).slice(),nice};
load({});

/* ---------- aide à l'écran (en haut à gauche), suit les touches choisies ---------- */
function helpPanel(){
  const help=document.getElementById('help');if(!help)return;
  const wn=document.getElementById('weapon-name');
  const k=id=>'<b class="text-white">'+esc(KBALL(id))+'</b>';
  const row=(c,h)=>'<p class="'+c+'">'+h+'</p>';
  help.innerHTML='';
  const ctx=document.createElement('div');ctx.id='ctx-keys';help.appendChild(ctx);
  const wp=document.createElement('p');wp.innerHTML='Arme : ';if(wn){wn.removeAttribute('id')}
  const span=document.createElement('span');span.id='weapon-name';span.className='text-orange-400 font-bold';wp.appendChild(span);help.appendChild(wp);
  let last='';
  function build(){
    const pvp=typeof mode!=='undefined'&&mode==='pvp',inCar=!!(window.VEH&&VEH.cur);
    const h=[];
    h.push(row('',k('ControlLeft')+' rouler · '+k('KeyP')+' ping (2ᵉ appui = retirer)'));
    if(inCar){
      const heli=VEH.cur.type==='heli';
      h.push(row('text-sky-300',k('KeyY')+' descendre · '+(heli?k('Space')+' monter · '+k('ShiftLeft')+' / '+k('ControlLeft')+' descendre':k('Space')+' frein à main · '+k('ShiftLeft')+' turbo')));
    }else if(pvp){
      h.push(row('text-rose-300',k('KeyK')+' salto · '+k('KeyN')+' kick / contre · '+k('ShiftLeft')+' glissade · '+k('KeyH')+' grappin · '+k('KeyG')+' prise judo · '+k('KeyB')+' geste'));
      h.push(row('text-rose-300',k('KeyX')+' / clic droit : parer'));
    }else{
      h.push(row('text-emerald-300',k('KeyG')+' lancer · '+k('KeyB')+' grenade/molotov · '+k('KeyT')+' tourelle · '+k('KeyU')+' / '+k('KeyI')+' / '+k('KeyO')+' soins'));
      h.push(row('text-orange-300',k('KeyM')+' mine · '+k('KeyH')+' barbelés · '+k('KeyJ')+' piège · '+k('KeyX')+' barricade'));
      h.push(row('text-amber-300',k('KeyC')+' coffre / prendre · '+k('KeyY')+' véhicule · '+k('KeyV')+' vendre'));
    }
    const html=h.join('');if(html!==last){last=html;ctx.innerHTML=html}
  }
  build();setInterval(build,250);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(helpPanel,0));else setTimeout(helpPanel,0);
})();
