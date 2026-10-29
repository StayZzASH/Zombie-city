/* =====================================================================
   CLASSEMENTS  —  3 tableaux : Global · Zombie (PvE) · PvP
   ---------------------------------------------------------------------
   • Suivi automatique des stats du joueur connecté (compte requis) :
       Global : score cumulé (tous modes), niveau, temps de jeu
       Zombie : record de vagues, zombies éliminés, boss vaincus
       PvP    : éliminations, morts, ratio K/D
   • Sauvegarde dans Firestore (collection « stats », voir classements-cloud.js).
   • Affichage dans l'onglet « Classement » du menu.

   Barème du score global
       zombie +10 (+5 headshot) · boss +500 · nouvelle vague +100
       frag PvP +50 · victoire PvP +200 · temps de jeu +2 / minute
   Niveau = 1 + √(score / 200)
   ===================================================================== */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const safe=f=>{try{return f()}catch(e){console.warn('[classements]',e&&e.message||e)}};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const me=()=>safe(()=>window.Cloud&&Cloud.me&&Cloud.me());
const PTS={zombie:10,head:5,boss:500,wave:100,frag:50,win:200,minute:2};
const levelOf=s=>1+Math.floor(Math.sqrt(Math.max(0,s)/200));
const nf=n=>Math.round(+n||0).toLocaleString('fr-FR');
const dur=s=>{s=Math.max(0,Math.floor(+s||0));return Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m'};

/* ======================= 1. SUIVI DES STATS ======================= */
const A0=()=>({score:0,time:0,zKills:0,zBoss:0,pk:0,pd:0,pw:0,games:0});
let A=A0(),rec={zWave:0},known={},knownUid=null,errCode='',secAcc=0,maxWave=0,lastFlush=0;
const logged=()=>!!me();
function add(k,v){if(!logged())return;A[k]=(A[k]||0)+v}

function flush(){
  const u=me();if(!u||!window.Cloud||!Cloud.statsAdd)return;
  const inc={};Object.keys(A).forEach(k=>{if(A[k]>0)inc[k]=A[k]});
  const r={};if(rec.zWave>(known.zWave||0))r.zWave=rec.zWave;
  if(!Object.keys(inc).length&&!Object.keys(r).length)return;
  const sent=A;A=A0();
  Cloud.statsAdd(u.uid,u.pseudo,inc,r).then(()=>{
    errCode='';
    Object.keys(inc).forEach(k=>{known[k]=(known[k]||0)+inc[k]});
    if(r.zWave)known.zWave=r.zWave;
    cache={};
  }).catch(e=>{errCode=e&&(e.code||e.message)||'erreur';Object.keys(sent).forEach(k=>{A[k]=(A[k]||0)+sent[k]})});
}
function loadKnown(){
  const u=me();
  if(!u){knownUid=null;known={};A=A0();return}
  if(knownUid===u.uid)return;
  knownUid=u.uid;known={};
  if(Cloud.statsGet)Cloud.statsGet(u.uid).then(d=>{known=d||{}}).catch(e=>{errCode=e&&(e.code||e.message)||'erreur'});
}

/* --- crochets sur le jeu (les fonctions du jeu sont des déclarations globales : on les enveloppe) --- */
function wrap(name,fn){const o=window[name];if(typeof o!=='function')return;window[name]=function(){return fn.call(this,o,arguments)}}
wrap('reward',(o,a)=>{                     // le joueur local vient de tuer un zombie
  const r=o.apply(null,a);
  safe(()=>{const ty=a[0],head=!!a[1];
    add('zKills',1);add('score',PTS.zombie+(head?PTS.head:0));
    if(ty==='boss'){add('zBoss',1);add('score',PTS.boss)}});
  return r;
});
wrap('showKill',(o,a)=>{                   // PvP : v = victime, k = tueur
  const r=o.apply(null,a);
  safe(()=>{const v=a[0],k=a[1],id=net.id;
    if(v===id)add('pd',1);
    if(k===id&&v!==id){add('pk',1);add('score',(window.DUELS&&DUELS.pts())?DUELS.pts().kill:PTS.frag)}});
  return r;
});
wrap('startGame',(o,a)=>{
  const r=o.apply(null,a);
  safe(()=>{add('games',1);maxWave=(typeof wave!=='undefined'&&mode!=='pvp')?(+wave||0):0});
  return r;
});
wrap('finalOver',(o,a)=>{
  const was=(typeof state!=='undefined'&&state==='GAMEOVER');
  const r=o.apply(null,a);
  safe(()=>{if(was)return;
    if(mode!=='pvp'){const w=Math.max(maxWave,+wave||0);if(w>rec.zWave)rec.zWave=w}
    flush()});
  return r;
});
wrap('endPvp',(o,a)=>{
  const was=(typeof state!=='undefined'&&state==='GAMEOVER');
  const r=o.apply(null,a);
  safe(()=>{if(was)return;
    const t=$('go-title');if(t&&/VICTOIRE/i.test(t.innerText)){add('pw',1);add('score',(window.DUELS&&DUELS.pts())?DUELS.pts().win:PTS.win)}
    flush()});
  return r;
});
/* temps de jeu + vagues atteintes */
setInterval(()=>{
  loadKnown();
  if(!logged()||window.__paused)return;
  if(typeof state==='undefined'||(state!=='PLAYING'&&state!=='SHOP'))return;
  add('time',1);secAcc++;
  if(secAcc>=60){secAcc=0;add('score',PTS.minute)}
  if(mode!=='pvp'){
    const w=+wave||0;
    if(w>maxWave){const n=Math.min(w-maxWave,20);for(let i=0;i<n;i++)add('score',PTS.wave);maxWave=w}
    if(w>rec.zWave)rec.zWave=w;
  }
},1000);
setInterval(()=>{if(Date.now()-lastFlush>20000){lastFlush=Date.now();flush()}},5000);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flush()});
addEventListener('pagehide',flush);

/* ======================= 2. INTERFACE ======================= */
const TABS={
  global:{lab:'🌍 Global',field:'score',title:'Classement Global (score total)',
    cols:['Rang','Pseudo','Score Global','Niveau','Temps de Jeu'],
    row:d=>[nf(d.score),levelOf(d.score),dur(d.time)]},
  zombie:{lab:'🧟 Mode Zombie',field:'zWave',title:'Classement Mode Zombie (survie PvE)',
    cols:['Rang','Pseudo','Record de Vagues','Zombies Éliminés','Boss Vaincus'],
    row:d=>['Vague '+nf(d.zWave),nf(d.zKills),nf(d.zBoss)]},
  pvp:{lab:'⚔️ PvP',field:'pk',title:'Classement PvP (joueur contre joueur)',
    cols:['Rang','Pseudo','Éliminations PvP','Morts PvP','Ratio (K/D) PvP'],
    row:d=>[nf(d.pk),nf(d.pd),((+d.pd>0)?(+d.pk/+d.pd):(+d.pk||0)).toFixed(2)]}
};
let tab='global',cache={},busy=false;
const Q=sel=>P.querySelector(sel);

const P=document.createElement('div');
P.id='cls';P.setAttribute('data-views','board');
P.className='bg-slate-900/80 border border-slate-700 rounded-2xl p-4 text-left mt-4 mx-auto';
P.style.cssText='width:min(100%,52rem)';
P.innerHTML='<div class="flex items-center justify-between gap-2 mb-3"><h2 class="font-black uppercase tracking-widest text-sm text-yellow-400">🏆 Classements</h2>'+
  '<button id="cls-ref" class="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm font-bold" title="Actualiser">↻</button></div>'+
  '<div id="cls-tabs" class="flex gap-2 flex-wrap mb-3"></div>'+
  '<div id="cls-me" class="text-xs text-slate-300 mb-2"></div>'+
  '<div id="cls-body" class="overflow-x-auto"></div>'+
  '<details class="mt-3 text-xs text-slate-400"><summary class="cursor-pointer font-bold">Comment gagner des points ?</summary>'+
  '<p class="mt-1">Zombie +10 (+5 tir à la tête) · Boss +500 · Nouvelle vague +100 · Frag PvP +50 · Victoire PvP +200 · Temps de jeu +2 / minute. '+
  'Niveau = 1 + √(score ÷ 200). Un compte est nécessaire pour apparaître dans les classements.</p></details>';

function mount(){
  const ms=$('menu-screen');if(!ms||!ms.firstElementChild||P.isConnected)return;
  const inner=ms.firstElementChild,af=$('auth-form'),grid=af&&af.parentElement&&af.parentElement.parentElement;
  if(grid&&grid.parentElement===inner)inner.insertBefore(P,grid.nextSibling);else inner.appendChild(P);
}
function paintTabs(){
  Q('#cls-tabs').innerHTML=Object.keys(TABS).map(k=>'<button data-ct="'+k+'" class="px-4 py-1.5 rounded-lg font-bold text-sm '+(k===tab?'bg-orange-500 text-slate-950':'bg-slate-800 text-slate-200 hover:bg-slate-700')+'">'+TABS[k].lab+'</button>').join('');
}
function paintMe(){
  const u=me(),el=Q('#cls-me');
  if(!u){el.innerHTML='<span class="text-amber-300">Mode invité : connecte-toi (onglet Compte) pour enregistrer tes stats et apparaître ici.</span>';return}
  const s=Object.assign({},known);Object.keys(A).forEach(k=>{s[k]=(+s[k]||0)+A[k]});
  s.zWave=Math.max(+known.zWave||0,rec.zWave||0);
  const ratio=(+s.pd>0)?(+s.pk/+s.pd):(+s.pk||0);
  el.innerHTML='<b class="text-white">'+esc(u.pseudo)+'</b> · score '+nf(s.score)+' · niv. '+levelOf(s.score)+' · '+dur(s.time)+
    ' · 🧟 vague '+nf(s.zWave)+' · ⚔ K/D '+ratio.toFixed(2)+(errCode?' <span class="text-red-400">(sauvegarde : '+esc(errCode)+')</span>':'');
}
function table(T,rows){
  const u=me(),th=T.cols.map((c,i)=>'<th class="px-2 py-1.5 '+(i<2?'text-left':'text-right')+' text-[11px] uppercase tracking-wider text-slate-400 font-bold whitespace-nowrap">'+c+'</th>').join('');
  const medal=['🥇','🥈','🥉'];
  const body=rows.map((d,i)=>{
    const mine=u&&d.uid===u.uid,cells=T.row(d);
    return '<tr class="'+(mine?'bg-amber-400/15':(i%2?'bg-white/[.03]':''))+'"><td class="px-2 py-1.5 font-black '+(i<3?'text-yellow-300':'text-slate-400')+'">'+(i<3?medal[i]+' ':'')+(i+1)+'</td>'+
      '<td class="px-2 py-1.5 font-bold '+(mine?'text-amber-300':'text-white')+'">'+esc(d.pseudo||'?')+'</td>'+
      cells.map(c=>'<td class="px-2 py-1.5 text-right tabular-nums">'+esc(c)+'</td>').join('')+'</tr>';
  }).join('');
  return '<table class="w-full text-sm min-w-[30rem]"><thead><tr class="border-b border-slate-700">'+th+'</tr></thead><tbody>'+body+'</tbody></table>';
}
async function show(force){
  mount();paintTabs();paintMe();
  const my=tab,T=TABS[my],body=Q('#cls-body'),c=cache[my];
  if(c&&!force&&Date.now()-c.t<20000){body.innerHTML=c.html;return}
  if(!window.Cloud||!Cloud.statsTop){body.innerHTML='<p class="text-slate-400 text-sm">Classements indisponibles (connexion au cloud impossible).</p>';return}
  if(busy)return;busy=true;
  body.innerHTML='<p class="text-slate-400 text-sm">Chargement…</p>';
  let html='';
  try{
    if(logged())flush();
    const rows=(await Cloud.statsTop(T.field,20)).filter(d=>(+d[T.field]||0)>0);
    html='<p class="text-xs text-slate-500 mb-1">'+T.title+' · top 20</p>'+
      (rows.length?table(T,rows):'<p class="text-slate-400 text-sm">Aucun joueur classé pour le moment. Sois le premier !</p>');
    cache[my]={t:Date.now(),html};
  }catch(e){
    const code=e&&(e.code||e.message)||'erreur';
    html='<p class="text-red-400 text-sm">Impossible de charger le classement ('+esc(code)+').</p>'+
      (/permission/i.test(code)?'<p class="text-xs text-slate-400 mt-1">Ajoute dans les règles Firestore : <code>match /stats/{uid} { allow read: if true; allow write: if request.auth != null &amp;&amp; request.auth.uid == uid; }</code></p>':'');
  }
  busy=false;
  if(tab===my)body.innerHTML=html;else show(false);
  paintMe();
}
P.addEventListener('click',e=>{
  const t=e.target.closest('[data-ct]');
  if(t){tab=t.dataset.ct;show(false);return}
  if(e.target.closest('#cls-ref'))show(true);
});
/* s'affiche quand on ouvre l'onglet « Classement » */
function watch(){
  mount();
  const ms=$('menu-screen');if(!ms)return;
  const chk=()=>{if(ms.getAttribute('data-view')==='board'&&!ms.classList.contains('hidden'))show(false)};
  new MutationObserver(chk).observe(ms,{attributes:true,attributeFilter:['data-view','class']});
  chk();
}
paintTabs();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watch);else watch();

window.CLASSEMENTS={flush,show,levelOf,myLevel:()=>levelOf(myStats().score),addScore:n=>add('score',n),get pending(){return Object.assign({},A)}};
})();
