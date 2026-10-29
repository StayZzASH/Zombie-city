(function(){
const $=id=>document.getElementById(id);
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safe=f=>{try{return f()}catch(e){console.warn('[social]',e&&e.message||e)}};
const me=()=>safe(()=>window.Cloud&&Cloud.me&&Cloud.me());
const ONLINE_MS=75000;
let fs=[],pres={},view='hub',timer=null,seenReq=new Set(),firstLoad=true;

/* ---------- données ---------- */
const mine=()=>{const u=me();return u?u.uid:null};
const other=f=>{const m=mine();return f.members.find(x=>x!==m)};
const accepted=()=>fs.filter(f=>f.status==='accepted').map(f=>({id:f.id,uid:other(f),pseudo:(f.names||{})[other(f)]||'?'}));
const incoming=()=>fs.filter(f=>f.status==='pending'&&f.from!==mine()).map(f=>({id:f.id,uid:f.from,pseudo:(f.names||{})[f.from]||'?'}));
const outgoing=()=>fs.filter(f=>f.status==='pending'&&f.from===mine()).map(f=>({id:f.id,uid:other(f),pseudo:(f.names||{})[other(f)]||'?'}));
async function load(){
  const u=me();if(!u)return;
  try{
    fs=await Cloud.fsList(u.uid);
    pres=await Cloud.presence(accepted().map(f=>f.uid));
    const inc=incoming();
    inc.forEach(r=>{if(!seenReq.has(r.id)){seenReq.add(r.id);if(!firstLoad)safe(()=>toast('📨 '+r.pseudo+' veut devenir ton ami','#22c55e'))}});
    firstLoad=false;
  }catch(e){fsErr=e.code||e.message}
  if(M.style.display!=='none')render();
}
let fsErr='';

/* ---------- fenêtre ---------- */
const M=document.createElement('div');
M.style.cssText='position:fixed;inset:0;z-index:60;background:rgba(2,6,23,.6);display:none;align-items:center;justify-content:center;padding:12px;font-family:Inter,system-ui,sans-serif;color:#fff';
M.innerHTML='<div style="width:min(94vw,440px);max-height:88vh;display:flex;flex-direction:column;border-radius:18px;border:1px solid rgba(255,255,255,.18);background:rgba(15,23,42,.94);backdrop-filter:blur(12px);overflow:hidden">'+
 '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.1)"><b id="soc-t" style="font-size:18px">Paramètres</b><button id="soc-x" style="font-size:20px;padding:0 6px">✕</button></div>'+
 '<div id="soc-b" style="padding:14px 16px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px"></div></div>';
document.body.appendChild(M);
const btn=(id,label,css,extra)=>'<button data-a="'+id+'" '+(extra||'')+' style="padding:12px 14px;border-radius:12px;font-weight:800;text-align:left;'+(css||'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)')+'">'+label+'</button>';
const small=(a,u,l,c)=>'<button data-a="'+a+'" data-u="'+esc(u)+'" style="padding:6px 10px;border-radius:10px;font-weight:800;'+c+'">'+l+'</button>';
const inRoom=()=>{try{return net.on&&net.code&&net.code!=='EN LIGNE'}catch(e){return false}};
const loginMsg=()=>'<p style="color:#fbbf24;font-size:14px">Les amis nécessitent un compte (onglet <b>Compte</b>). En mode invité tu peux seulement choisir un pseudo pour la session.</p>';

function render(){
  const T=$('soc-t'),B=$('soc-b'),logged=!!me(),nreq=logged?incoming().length:0;
  if(view==='hub'){
    T.textContent='Paramètres';
    const inGame=typeof state!=='undefined'&&(state==='PLAYING'||state==='SHOP');
    let h='';
    if(inRoom())h+='<div style="padding:10px 12px;border-radius:12px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.4);font-weight:700">Salon <b style="letter-spacing:.2em;color:#fbbf24">'+esc(net.code)+'</b> · <button data-a="copy" style="text-decoration:underline">copier le code</button>'+safe(()=>'<div style="font-size:12px;font-weight:600;color:#cbd5e1;margin-top:4px">👥 '+Object.keys(net.ro).length+'/'+net.max+' joueurs · '+(net.host?'tu es le chef (tu choisis le mode)':'le chef choisit le mode')+'</div>')+'</div>';
    h+=btn('add','➕ Ajouter des amis')+btn('list','👥 Mes amis en ligne')+btn('req','📨 Demandes d’amis'+(nreq?' <span style="background:#ef4444;border-radius:999px;padding:1px 8px;margin-left:6px">'+nreq+'</span>':''))+btn('game','⚙ Paramètres du jeu');
    if(!logged)h+=btn('guest','✏ Pseudo invité');
    if(inRoom()&&!inGame)h+=btn('leave','🚪 Quitter le groupe','background:rgba(239,68,68,.25);border:1px solid #ef4444');
    if(inGame)h+=btn('quit','🚪 Quitter la partie','background:rgba(239,68,68,.25);border:1px solid #ef4444');
    B.innerHTML=h;
  }else if(view==='add'){
    T.textContent='Ajouter des amis';
    B.innerHTML=(logged?'<p style="font-size:13px;color:#94a3b8">Entre le pseudo exact. Ton ami recevra une demande et devra <b>accepter</b>.</p><input id="soc-in" maxlength="20" placeholder="Pseudo" style="padding:12px;border-radius:12px;background:#020617;border:1px solid #334155;color:#fff;font-size:16px">'+btn('doadd','Envoyer la demande','background:#f97316;color:#020617;text-align:center;border:0')+'<p id="soc-msg" style="font-size:13px;min-height:1.2em"></p>':loginMsg())+btn('back','← Retour');
  }else if(view==='list'){
    T.textContent='Mes amis';
    if(!logged){B.innerHTML=loginMsg()+btn('back','← Retour');return}
    const list=accepted(),on=f=>{const p=pres[f.uid];return p&&Date.now()-p.t<ONLINE_MS};
    const row=f=>{const p=pres[f.uid],o=on(f);
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.06)"><span style="width:10px;height:10px;border-radius:50%;background:'+(o?'#22c55e':'#64748b')+'"></span>'+
       '<div style="flex:1;min-width:0"><b>'+esc(f.pseudo)+'</b><div style="font-size:11px;color:#94a3b8">'+(o?(p.playing?'en partie':(p.room?'dans un salon':'dans le salon')):'hors ligne')+'</div></div>'+
       (o?small('inv',f.uid,'Inviter','background:#22c55e;color:#020617'):'')+small('del',f.id,'Retirer','background:rgba(239,68,68,.25);color:#fff')+'</div>'};
    const sorted=list.filter(on).concat(list.filter(f=>!on(f)));
    const pend=outgoing();
    B.innerHTML=(fsErr?'<p style="color:#f87171;font-size:12px">Erreur : '+esc(fsErr)+' (règles Firestore ?)</p>':'')+
      (list.length?'<p style="font-size:12px;color:#94a3b8">'+list.filter(on).length+' en ligne sur '+list.length+'</p>'+sorted.map(row).join(''):'<p style="color:#94a3b8">Aucun ami pour l’instant.</p>')+
      (pend.length?'<p style="font-size:12px;color:#94a3b8;margin-top:6px">En attente de réponse :</p>'+pend.map(f=>'<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.04)"><span style="flex:1">⏳ '+esc(f.pseudo)+'</span>'+small('del',f.id,'Annuler','background:rgba(255,255,255,.12);color:#fff')+'</div>').join(''):'')+
      btn('add','➕ Ajouter un ami')+btn('back','← Retour');
  }else if(view==='req'){
    T.textContent='Demandes d’amis';
    if(!logged){B.innerHTML=loginMsg()+btn('back','← Retour');return}
    const inc=incoming();
    B.innerHTML=(inc.length?inc.map(f=>'<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.06)"><span style="flex:1"><b>'+esc(f.pseudo)+'</b> veut être ton ami</span>'+small('acc',f.id,'Accepter','background:#22c55e;color:#020617')+small('del',f.id,'Refuser','background:rgba(239,68,68,.25);color:#fff')+'</div>').join(''):'<p style="color:#94a3b8">Aucune demande en attente.</p>')+btn('back','← Retour');
  }
}
function msg(t,ok){const m=$('soc-msg');if(m){m.textContent=t;m.style.color=ok?'#22c55e':'#f87171'}}
async function addFriend(){
  const u=me();if(!u){msg('Connecte-toi d’abord.');return}
  const p=($('soc-in').value||'').trim();if(!p)return;
  if(p.toLowerCase()===u.pseudo.toLowerCase()){msg('C’est ton propre pseudo !');return}
  msg('Recherche…',true);
  try{
    const f=await Cloud.findUser(p);if(!f){msg('Joueur introuvable.');return}
    const id=Cloud.fshipId(u.uid,f.uid),ex=await Cloud.fsGet(id);
    if(ex&&ex.status==='accepted'){msg('Vous êtes déjà amis.');return}
    if(ex&&ex.status==='pending'&&ex.from===u.uid){msg('Demande déjà envoyée, en attente de '+f.pseudo+'.');return}
    if(ex&&ex.status==='pending'){await Cloud.fsSet(id,{status:'accepted'});msg('✔ '+f.pseudo+' t’avait invité : vous êtes amis !',true);$('soc-in').value='';load();return}
    const names={};names[u.uid]=u.pseudo;names[f.uid]=f.pseudo;
    await Cloud.fsSet(id,{members:[u.uid,f.uid].sort(),names,from:u.uid,status:'pending',t:Date.now()});
    $('soc-in').value='';msg('✔ Demande envoyée à '+f.pseudo+'. Il doit accepter.',true);load();
  }catch(e){msg('Impossible : '+(e.code||e.message))}
}
async function invite(uid){
  const u=me();if(!u)return;
  try{
    if(!inRoom()){
      /* le mode choisi dans le lobby (Duo / Trio / Squad / PvP) est repris automatiquement : plus de « choisis un mode » */
      const L=window.LOBBY,c=L&&L.get();
      let g=(c&&(c.game==='coop'||c.game==='pvp'))?c.game:((typeof mode!=='undefined'&&(mode==='coop'||mode==='pvp'))?mode:'coop');
      if(L&&(!c||(c.game!=='coop'&&c.game!=='pvp'))&&g==='coop'){const d=L.modes.find(m=>m.id==='duo');if(d)safe(()=>L.set(d))}
      safe(()=>setMode(g));
      safe(()=>selectWeapon(L?L.weapon():weaponKey));
      createRoom();
      for(let i=0;i<40&&!inRoom();i++)await new Promise(r=>setTimeout(r,200));   // attend l'ouverture du salon (8 s max)
    }
    if(!inRoom()){alert('Le salon n’a pas pu s’ouvrir (réseau). Réessaie dans quelques secondes.');return}
    if(safe(()=>window.GROUPE&&GROUPE.full())){alert('Ton groupe est complet. Le chef peut choisir un mode avec plus de places (Trio, Squad ou PvP) pour inviter d’autres amis.');return}
    await Cloud.invite(uid,{from:u.uid,pseudo:u.pseudo,code:net.code,mode:(typeof mode!=='undefined'&&mode==='pvp')?'pvp':'coop'});
    safe(()=>toast('📨 Invitation envoyée','#22c55e'));
  }catch(e){alert('Invitation impossible : '+(e.code||e.message))}
}
/* pause en solo / hors ligne pendant que le menu est ouvert */
const setPause=on=>{window.__paused=!!on&&typeof state!=='undefined'&&state==='PLAYING'&&!(typeof net!=='undefined'&&net.on)};
function open(v){
  safe(()=>document.exitPointerLock&&document.exitPointerLock());
  view=v||'hub';M.style.display='flex';setPause(true);render();load();
  clearInterval(timer);timer=setInterval(()=>{if(M.style.display!=='none')load()},8000);
}
const close=()=>{M.style.display='none';clearInterval(timer);window.__paused=false};
M.addEventListener('click',async e=>{
  if(e.target===M||e.target.id==='soc-x'){close();return}
  const a=e.target.closest('[data-a]');if(!a)return;const k=a.dataset.a,u=me();
  if(k==='add'||k==='list'||k==='req'){view=k;render();if(k!=='add')load()}
  else if(k==='back'){view='hub';render()}
  else if(k==='game'){close();const b=$('lb-set');if(b)b.click()}
  else if(k==='doadd'){await addFriend()}
  else if(k==='inv'){invite(a.dataset.u)}
  else if(k==='acc'&&u){try{await Cloud.fsSet(a.dataset.u,{status:'accepted'})}catch(err){alert('Erreur : '+(err.code||err.message))}await load()}
  else if(k==='del'&&u){try{await Cloud.fsDel(a.dataset.u)}catch(err){alert('Erreur : '+(err.code||err.message))}await load()}
  else if(k==='leave'){close();if(window.GROUPE&&GROUPE.inGroup())GROUPE.leave();else safe(()=>leaveNet())}
  else if(k==='copy'){safe(()=>navigator.clipboard.writeText(net.code));safe(()=>toast('Code copié : '+net.code,'#22c55e'))}
  else if(k==='guest'){
    const cur=safe(()=>localStorage.getItem('zs_guest_name'))||'';
    const n=(prompt('Pseudo invité (3 à 14 caractères) :',cur)||'').trim().replace(/[^\w\- ]/g,'').slice(0,14);
    if(n.length>=3){safe(()=>localStorage.setItem('zs_guest_name',n));net.name=n;net.guest=n;safe(()=>toast('Pseudo : '+n,'#22c55e'))}
  }
  else if(k==='quit'){
    const pvp=typeof mode!=='undefined'&&mode==='pvp'&&net.on;
    const grp=!!(window.GROUPE&&GROUPE.persist&&GROUPE.persist()),sfx=grp?(net.host?' En tant que chef, la partie s\'arrête pour tout le monde, mais le groupe reste.':' Tu restes dans le groupe.'):'';
    if(!confirm((pvp?'Quitter la partie ? Si tu es seul face à un adversaire, il gagne ; sinon la partie continue sans toi.':'Quitter la partie et retourner au salon ?')+sfx))return;
    close();net.quitting=true;
    try{resetToMenu()}catch(err){console.warn(err);location.reload()}
    setTimeout(()=>{net.quitting=false},2000);
  }
});
addEventListener('keydown',e=>{if(e.code==='Escape'&&M.style.display!=='none')close()});
M.addEventListener('keydown',e=>{if(e.code==='Enter'&&e.target.id==='soc-in')addFriend()});
/* pseudo invité mémorisé */
safe(()=>{const n=localStorage.getItem('zs_guest_name');if(n){net.guest=n}});

/* ---------- le bouton ⚙ du salon ouvre ce menu ---------- */
const nls=$('nl-settings');
if(nls)nls.addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();open('hub')},true);

/* ---------- bouton ⚙ en jeu ---------- */
const g=document.createElement('button');
g.textContent='⚙';g.title='Paramètres / amis / inviter';
g.style.cssText='position:fixed;top:calc(8px + env(safe-area-inset-top,0px));right:8px;z-index:35;width:40px;height:40px;border-radius:12px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.25);color:#fff;font-size:20px;display:none;align-items:center;justify-content:center';
g.addEventListener('click',e=>{e.stopPropagation();open('hub')});
g.addEventListener('touchstart',e=>e.stopPropagation(),{passive:true});
document.body.appendChild(g);
setInterval(()=>{const lob=$('lobby'),inLobby=lob&&getComputedStyle(lob).display!=='none';
  const show=typeof state!=='undefined'&&(state==='PLAYING'||state==='SHOP')&&!inLobby;if(g.style.display!==(show?'flex':'none'))g.style.display=show?'flex':'none'},400);

/* ---------- présence, demandes et invitations reçues ---------- */
let listening=null;
function beat(){
  const u=me();if(!u)return;
  safe(()=>Cloud.ping(u.uid,{pseudo:u.pseudo,room:inRoom()?net.code:'',playing:typeof state!=='undefined'&&state==='PLAYING'}));
  if(listening!==u.uid){listening=u.uid;firstLoad=true;load();safe(()=>Cloud.onInvite(u.uid,d=>{if(Date.now()-(d.t||0)<120000&&d.from!==u.uid)showInvite(d)}))}
}
setInterval(beat,20000);setInterval(()=>{if(me()&&M.style.display==='none')load()},30000);
setTimeout(beat,3000);setTimeout(beat,8000);
function showInvite(d){
  const c=document.createElement('div');
  c.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:80;padding:12px 16px;border-radius:14px;background:rgba(15,23,42,.96);border:2px solid #22c55e;color:#fff;font:700 14px Inter,system-ui,sans-serif;display:flex;gap:10px;align-items:center;max-width:94vw';
  c.innerHTML='<span>📨 <b>'+esc(d.pseudo)+'</b> t’invite dans son groupe</span><button data-y style="padding:6px 12px;border-radius:10px;background:#22c55e;color:#020617;font-weight:800">Rejoindre</button><button data-n style="padding:6px 10px;border-radius:10px;background:rgba(255,255,255,.12)">✕</button>';
  document.body.appendChild(c);
  const done=()=>{c.remove();const u=me();if(u)safe(()=>Cloud.clearInvite(u.uid))};
  c.querySelector('[data-y]').onclick=()=>{done();safe(()=>{const m=d.mode==='pvp'?'pvp':'coop';if(net.on)leaveNet();setMode(m);safe(()=>selectWeapon(window.LOBBY?window.LOBBY.weapon():weaponKey));$('room-code').value=d.code;joinRoom()})};
  c.querySelector('[data-n]').onclick=done;
  setTimeout(()=>c.remove(),60000);
}
window.__SOCIAL={open};
})();
