/* =====================================================================
   IMPACT & RÉTICULE  —  hitmarker animé, sons de touche distincts, réticule personnalisable
   ---------------------------------------------------------------------
   · Hitmarker : 4 traits qui « claquent » au centre. Blanc = touche, rouge = tête (headshot), or plus gros = élimination.
   · Sons : touche normale (SFX.hit d'origine) + « ping » aigu sur headshot + coup sourd et carillon sur élimination.
   · Réticule : forme, taille et couleur au choix (Paramètres > Jouabilité). Réglages enregistrés avec les autres paramètres.
   · Le marqueur de touche peut être coupé (Paramètres > Jouabilité).
   ===================================================================== */
(function(){
'use strict';
const safe=f=>{try{return f()}catch(e){console.warn('[impact]',e&&e.message||e)}};
const Z=()=>window.ZS||{};

/* ---------- réticule ---------- */
const SH={
  ring:c=>'<circle cx="20" cy="20" r="9" fill="none" stroke="'+c+'" stroke-width="2.2"/><circle cx="20" cy="20" r="1.8" fill="#ef4444"/>',
  circle:c=>'<circle cx="20" cy="20" r="9" fill="none" stroke="'+c+'" stroke-width="2.2"/>',
  dot:c=>'<circle cx="20" cy="20" r="2.6" fill="'+c+'"/>',
  cross:c=>'<path d="M20 5v10M20 25v10M5 20h10M25 20h10" stroke="'+c+'" stroke-width="2.4" stroke-linecap="round"/>',
  plus:c=>'<path d="M20 8v24M8 20h24" stroke="'+c+'" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="20" r="1.4" fill="'+c+'"/>',
  t:c=>'<path d="M20 22v13M5 20h10M25 20h10" stroke="'+c+'" stroke-width="2.4" stroke-linecap="round"/>'
};
let sig='';
function applyCross(){
  const el=document.getElementById('crosshair');if(!el)return;
  const z=Z(),shape=SH[z.cs]?z.cs:'ring',size=Math.max(.6,Math.min(2.5,+z.csz||1)),col=/^#[0-9a-f]{3,8}$/i.test(z.ccol||'')?z.ccol:'#fb923c';
  const k=shape+'|'+size+'|'+col;if(k===sig)return;sig=k;
  const px=Math.round(26*size);
  el.innerHTML='<svg width="'+px+'" height="'+px+'" viewBox="0 0 40 40" style="display:block;filter:drop-shadow(0 0 1.5px rgba(0,0,0,.9))">'+SH[shape](col)+'</svg>';
}
window.__applyCross=applyCross;
setInterval(()=>safe(applyCross),700);

/* ---------- hitmarker ---------- */
const css=document.createElement('style');
css.textContent=`
#hitmark{font-size:0!important;transition:none!important;opacity:0;width:44px;height:44px;margin:0}
#hitmark svg{width:100%;height:100%;display:block;filter:drop-shadow(0 0 2px rgba(0,0,0,.9))}
#hitmark.hm-go{animation:hmpop .26s ease-out forwards}
#hitmark.hm-kill{animation:hmkill .5s ease-out forwards}
@keyframes hmpop{0%{opacity:1;transform:translate(-50%,-50%) scale(.55)}35%{opacity:1;transform:translate(-50%,-50%) scale(1.15)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.35)}}
@keyframes hmkill{0%{opacity:1;transform:translate(-50%,-50%) scale(.5) rotate(0)}30%{opacity:1;transform:translate(-50%,-50%) scale(1.5) rotate(0)}100%{opacity:0;transform:translate(-50%,-50%) scale(2.1) rotate(8deg)}}`;
document.head.appendChild(css);
function paint(color){
  const h=document.getElementById('hitmark');if(!h)return null;
  h.innerHTML='<svg viewBox="0 0 44 44"><path d="M8 8l9 9M36 8l-9 9M8 36l9-9M36 36l-9-9" stroke="'+color+'" stroke-width="3.4" stroke-linecap="round"/></svg>';
  return h;
}
function fire(color,cls){
  if(Z().hm===0)return;
  const h=paint(color);if(!h)return;
  h.classList.remove('hm-go','hm-kill');void h.offsetWidth;h.classList.add(cls);
}
/* le jeu appelle mark(head) à chaque touche */
const _mark=window.mark;
window.mark=function(head){
  if(Z().hm===0&&typeof _mark==='function')return _mark.apply(this,arguments);
  fire(head?'#ef4444':'#ffffff','hm-go');
  if(head)safe(()=>window.SFX&&SFX.hitHead&&SFX.hitHead());
};
try{mark=window.mark}catch(_){}
/* élimination : marqueur doré + son dédié */
const _kz=window.killZombie;
if(typeof _kz==='function'){
  window.killZombie=function(z,head){
    const r=_kz.apply(this,arguments);
    safe(()=>{fire('#fbbf24','hm-kill');window.SFX&&SFX.kill&&SFX.kill()});
    return r;
  };
  try{killZombie=window.killZombie}catch(_){}
}
window.IMPACT={apply:applyCross};
})();
