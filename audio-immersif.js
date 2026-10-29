/* =====================================================================
   AUDIO IMMERSIF  —  musique d'ambiance générative + effets sonores (SFX) enrichis
   ---------------------------------------------------------------------
   Aucun fichier audio : tout est synthétisé par Web Audio (le jeu reste un seul fichier, hors-ligne).

   MUSIQUE (remplace la boucle « synthwave » d'origine ; M / le curseur « Musique » du menu la règlent toujours)
     · nappes sombres (chaînes désaccordées + filtre lent) sur une progression en la mineur, sub-basse, souffle de vent,
       cloches espacées avec écho, réverbération de grande salle
     · l'intensité suit l'action : menu / boutique = calme · vague en cours = battement de cœur + tambours lointains,
       qui montent avec le numéro de vague · boss = drone dissonant · arène PvP = pulsation + arpèges
     · hurlements lointains de temps en temps (PvE de nuit)

   EFFETS SONORES (même noms qu'avant : SFX.pistol(), SFX.step(), SFX.groan()… rien à changer ailleurs)
     · tirs en couches (claquement + corps + queue de réverbération), variations aléatoires -> plus de « mitraillette » répétitive
     · pas alternés gauche/droite (stéréo), plus feutrés accroupi, plus lourds en sprint, « flac » sous la pluie
     · rechargement en plusieurs temps, impacts chair / mur, zombies à formants vocaux, chute, roulade, ramassage…
     · SFX.ui() / SFX.tick() : clics de menu discrets (boutons, navigation à la manette)
   ===================================================================== */
(function(){
'use strict';
const safe=f=>{try{return f()}catch(e){console.warn('[audio]',e&&e.message||e)}};
const rnd=(a,b)=>a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const mf=n=>440*Math.pow(2,(n-69)/12);

let ready=false,srevIn=null,mrevIn=null,mbus=null,echoIn=null,I=.18,Ttarget=.18,airG=null,bossGain=null;

/* ---------- réverbération (réponse impulsionnelle synthétique) ---------- */
function impulse(sec,decay){
  const n=Math.floor(AC.sampleRate*sec),b=AC.createBuffer(2,n,AC.sampleRate);
  for(let c=0;c<2;c++){const d=b.getChannelData(c);let lp=0;
    for(let i=0;i<n;i++){const t=i/n;lp+=((Math.random()*2-1)-lp)*(.55-.4*t);d[i]=lp*Math.pow(1-t,decay)*1.6}}
  return b;
}

/* ---------- sorties (pan + envoi réverb) ---------- */
function out(node,o){
  let last=node;
  if(o&&o.pan&&AC.createStereoPanner){const p=AC.createStereoPanner();p.pan.value=Math.max(-1,Math.min(1,o.pan));node.connect(p);last=p}
  last.connect(master);
  if(o&&o.rev&&srevIn){const s=AC.createGain();s.gain.value=o.rev;last.connect(s);s.connect(srevIn)}
}
function N(dur,f0,f1,vol,type,delay,o){                     // salve de bruit filtré
  if(!AC||!noiseBuf||live>40)return;o=o||{};
  const t=AC.currentTime+(delay||0),s=AC.createBufferSource();s.buffer=noiseBuf;
  const f=AC.createBiquadFilter();f.type=type||'lowpass';f.frequency.setValueAtTime(f0,t);f.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);if(o.q)f.Q.value=o.q;
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+(o.att||.002));g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  s.connect(f);f.connect(g);out(g,o);live++;s.onended=()=>{live--};s.start(t,Math.random()*.6);s.stop(t+dur+.05);
}
function T(type,f0,f1,dur,vol,delay,o){                      // oscillateur à enveloppe
  if(!AC||live>40)return;o=o||{};
  const t=AC.currentTime+(delay||0),s=AC.createOscillator();s.type=type;
  s.frequency.setValueAtTime(f0,t);s.frequency.exponentialRampToValueAtTime(Math.max(20,f1),t+dur);
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+(o.att||.003));g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  s.connect(g);out(g,o);live++;s.onended=()=>{live--};s.start(t);s.stop(t+dur+.05);
}
function V(f0,f1,dur,vol,forms,o){                           // voix : dent de scie + formants + vibrato
  if(!AC||live>40)return;o=o||{};
  const t=AC.currentTime+(o.delay||0),s=AC.createOscillator();s.type='sawtooth';
  s.frequency.setValueAtTime(f0,t);s.frequency.exponentialRampToValueAtTime(Math.max(30,f1),t+dur);
  const vb=AC.createOscillator(),vg=AC.createGain();vb.frequency.value=rnd(4.5,8);vg.gain.value=f0*.035;vb.connect(vg);vg.connect(s.frequency);
  const g=AC.createGain();g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+dur*.18);g.gain.exponentialRampToValueAtTime(.0008,t+dur);
  forms.forEach(([f,q,a])=>{
    const b=AC.createBiquadFilter();b.type='bandpass';b.frequency.setValueAtTime(f,t);b.frequency.linearRampToValueAtTime(f*rnd(.72,.95),t+dur);b.Q.value=q;
    const fg=AC.createGain();fg.gain.value=a;s.connect(b);b.connect(fg);fg.connect(g);
  });
  out(g,o);live++;s.onended=()=>{live--};s.start(t);vb.start(t);s.stop(t+dur+.05);vb.stop(t+dur+.05);
}

/* =====================================================================
   SFX
   ===================================================================== */
let side=1,live=0;
const jit=()=>rnd(.92,1.1);
function crack(vol,tail,o){                                   // claquement d'un tir : transitoire + tail
  N(.03,7000,2500,vol*.55,'highpass',0,o);
}
const NEW_SFX={
  pistol(){const j=jit();crack(.8);N(.12,2800*j,380,.8,'bandpass',0,{q:.7,rev:.18});T('square',210*j,58,.1,.28);T('sine',120,48,.14,.4);N(.5,900,120,.12,'lowpass',.03,{rev:.35})},
  rifle(){const j=jit();crack(.7);N(.09,3300*j,550,.7,'bandpass',0,{q:.6,rev:.14});T('sawtooth',160*j,48,.09,.3);T('sine',95,40,.12,.35);N(.35,700,100,.09,'lowpass',.02,{rev:.25})},
  sniper(){crack(1);N(.55,4200,110,1,'lowpass',0,{rev:.3});T('sine',105,26,.5,.75);N(1.1,1100,90,.22,'lowpass',.1,{rev:.7});T('sine',60,30,.8,.2,.12,{rev:.5})},
  revolver(){const j=jit();crack(.9);N(.22,2600*j,180,.9,'bandpass',0,{q:.6,rev:.2});T('square',150*j,42,.16,.4);T('sine',90,35,.2,.45);N(.6,800,100,.12,'lowpass',.04,{rev:.35})},
  reload(rt){
    rt=rt||1500;const k=rt/1000;
    N(.05,3000,900,.22,'bandpass',0,{q:2});T('square',300,180,.05,.12);                       // déclic du chargeur
    N(.09,1200,300,.28,'lowpass',.18*k,{});T('triangle',180,120,.1,.18,.18*k);                   // chargeur sorti
    N(.07,2500,1000,.2,'bandpass',.5*k,{q:3});                                                   // sortie
    N(.1,1500,400,.32,'lowpass',.72*k,{});T('triangle',220,140,.1,.2,.72*k);                      // chargeur inséré
    N(.04,4000,1500,.3,'highpass',.95*k,{});T('square',900,600,.04,.14,.95*k);T('square',500,300,.06,.18,.98*k)   // verrou
  },
  hit(){N(.09,1800,350,.4,'lowpass',0,{q:.5});T('sine',150,55,.1,.25)},
  wall(){N(.05,5200,2200,.18,'highpass');T('triangle',1400*jit(),600,.05,.1);T('sine',2600,1800,.18,.04,.01,{rev:.3})},
  groan(v){v=v===undefined?1:v;const b=rnd(80,130),p=rnd(-.5,.5);
    V(b*1.7,b*.8,rnd(.55,.9),.2*v,[[600,6,1],[1100,8,.6],[2400,10,.25]],{pan:p,rev:.18});
    if(Math.random()<.5)N(.4,500,150,.07*v,'bandpass',.1,{pan:p,q:3})},
  zdie(){V(190,45,.85,.34,[[550,6,1],[1000,8,.7]],{rev:.25});N(.5,900,90,.28,'lowpass',.05,{rev:.2});T('sine',110,40,.25,.35,.55);N(.12,500,100,.3,'lowpass',.62)},
  hurt(){V(300,120,.28,.3,[[700,7,1],[1300,8,.5]]);T('sine',200,55,.26,.5);N(.18,700,180,.34,'lowpass');T('sine',62,40,.4,.3,.12)},
  step(m,c){
    if(!AC)return;side*=-1;const crouch=!!c,sp=m===undefined?4:m;
    const v=crouch?.38:(sp>4.8?1.15:.85),pan=.18*side,wet=!!(rainG&&rainG.gain.value>.015);
    N(.09,(520+Math.random()*260)*(crouch?.7:1),110,.23*v,'lowpass',0,{pan,q:.4});          // talon
    N(.05,3300+side*250,1300,.05*v,'bandpass',.012,{pan,q:.9});                                // gravillons
    if(sp>3&&!crouch)N(.14,2000,450,.03*v,'highpass',.02,{pan});                               // frottement des vêtements
    if(wet)N(.13,2300,800,.07*v,'bandpass',.008,{pan,rev:.25});                                // flaque
  },
  jump(){N(.14,700,2600,.1,'bandpass',0,{q:1.2});T('sine',190,360,.12,.1)},
  land(){N(.14,650,90,.38,'lowpass');T('sine',120,45,.16,.35);N(.08,2500,900,.06,'bandpass',.02)},
  roll(){N(.35,500,2600,.3,'bandpass',0,{q:.8});N(.3,2600,320,.2,'bandpass',.1,{q:.8});T('sine',130,50,.12,.3,.28);N(.1,500,100,.25,'lowpass',.3)},
  coin(){T('sine',1320,1330,.35,.12,0,{rev:.3});T('sine',1976,1990,.4,.1,.07,{rev:.35});T('triangle',3950,3900,.12,.04,.07)},
  chest(){N(.22,300,700,.12,'bandpass',0,{q:2});[523,659,784,1046,1318].forEach((f,i)=>{T('sine',f,f*1.004,.5,.12,.12+i*.07,{rev:.45});T('triangle',f*2,f*2,.25,.03,.12+i*.07,{rev:.3})})},
  level(){[440,554,659,880,1108].forEach((f,i)=>{T('sine',f,f,.6,.14,i*.09,{rev:.5});T('triangle',f*2,f*2,.3,.04,i*.09,{rev:.4})});T('sine',110,110,1.1,.12,0,{rev:.4})},
  explode(){N(1.7,1600,35,1,'lowpass',0,{rev:.45});T('sine',92,18,1.3,.85);N(.9,5200,280,.5,'highpass',0,{rev:.3});N(.7,800,55,.5,'bandpass',.22,{q:.5,rev:.4});N(1.4,500,60,.25,'lowpass',.5,{rev:.6});for(let i=0;i<4;i++)N(.06,3500,900,.12,'bandpass',.5+Math.random()*.9,{pan:rnd(-.7,.7)})},
  boom(){N(1.4,300,28,.4,'lowpass',0,{rev:.5});T('sine',60,22,1.1,.3)},
  clang(){T('triangle',420*jit(),380,.45,.07,0,{rev:.35});T('triangle',630*jit(),600,.35,.05,0,{rev:.3});N(.04,5000,2500,.08,'highpass')},
  toss(){N(.2,600,2600,.2,'bandpass',0,{q:.7})},
  fire(){N(.8,3200,280,.42,'bandpass',0,{q:.5,rev:.25});T('sawtooth',300,85,.45,.1);for(let i=0;i<5;i++)N(.03,4000,2000,.1,'highpass',.1+Math.random()*.6)},
  spit(){T('sawtooth',540,190,.2,.15);N(.18,2000,450,.16,'bandpass',0,{q:1.5})},
  turret(){N(.04,3800,1300,.1,'bandpass');T('square',600,300,.03,.04)},
  ui(){T('sine',1500,980,.05,.07);N(.03,5000,3000,.03,'highpass')},
  tick(){T('sine',1100,1100,.025,.05)},
  hitHead(){T('sine',2500,1900,.13,.17,0,{rev:.2});T('triangle',3700,3100,.07,.07);N(.03,6500,3000,.1,'highpass')},
  kill(){T('sine',165,58,.26,.3);T('sine',880,1320,.32,.11,.04,{rev:.3});T('triangle',1760,1760,.2,.04,.08,{rev:.3});N(.1,2600,300,.14,'bandpass')}
};

/* ---------- musique ---------- */
const CH=[[45,52,55,60],[41,48,52,57],[50,57,60,64],[40,47,50,55]];     // Am7 · Fmaj7 · Dm9 · Em7
const PENTA=[0,3,5,7,10];                                                // pentatonique mineure (la)
let nextChord=0,chordIdx=0,nextBell=0,nextBeat=0,beatN=0,nextHowl=0,lastScan=0,nextArp=0,arpN=0;

function mvoice(f,t,dur,vol,cut){
  const o1=AC.createOscillator(),o2=AC.createOscillator(),g=AC.createGain(),fl=AC.createBiquadFilter(),at=Math.min(4.5,dur*.38);
  o1.type='sawtooth';o2.type='sawtooth';o1.frequency.value=f;o2.frequency.value=f;o1.detune.value=-10;o2.detune.value=10;
  fl.type='lowpass';fl.Q.value=.6;fl.frequency.setValueAtTime(cut*.45,t);fl.frequency.linearRampToValueAtTime(cut,t+dur*.55);fl.frequency.linearRampToValueAtTime(cut*.4,t+dur+1.6);
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+at);g.gain.linearRampToValueAtTime(vol*.8,t+dur);g.gain.linearRampToValueAtTime(.0001,t+dur+1.8);
  o1.connect(fl);o2.connect(fl);fl.connect(g);g.connect(mbus);
  const s=AC.createGain();s.gain.value=.5;g.connect(s);s.connect(mrevIn);
  o1.start(t);o2.start(t);o1.stop(t+dur+1.9);o2.stop(t+dur+1.9);
}
function msub(f,t,dur,vol){
  const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.value=f;
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+3);g.gain.linearRampToValueAtTime(.0001,t+dur+2);
  o.connect(g);g.connect(mbus);o.start(t);o.stop(t+dur+2.1);
}
function bell(f,t,vol,pan){
  const g=AC.createGain(),o1=AC.createOscillator(),o2=AC.createOscillator(),o3=AC.createOscillator();
  o1.type='sine';o2.type='sine';o3.type='triangle';o1.frequency.value=f;o2.frequency.value=f*2.76;o3.frequency.value=f*.5;
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+.008);g.gain.exponentialRampToValueAtTime(.0005,t+3.2);
  const g2=AC.createGain();g2.gain.value=.2;o2.connect(g2);g2.connect(g);o1.connect(g);o3.connect(g);
  let last=g;if(AC.createStereoPanner){const p=AC.createStereoPanner();p.pan.value=pan||0;g.connect(p);last=p}
  last.connect(mbus);const e=AC.createGain();e.gain.value=.7;last.connect(e);e.connect(echoIn);const r=AC.createGain();r.gain.value=.6;last.connect(r);r.connect(mrevIn);
  o1.start(t);o2.start(t);o3.start(t);o1.stop(t+3.3);o2.stop(t+3.3);o3.stop(t+3.3);
}
function heart(t,vol){
  [[0,1],[.22,.62]].forEach(([d,k])=>{
    const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.setValueAtTime(78,t+d);o.frequency.exponentialRampToValueAtTime(34,t+d+.16);
    g.gain.setValueAtTime(vol*k,t+d);g.gain.exponentialRampToValueAtTime(.001,t+d+.2);o.connect(g);g.connect(mbus);o.start(t+d);o.stop(t+d+.24);
  });
}
function taiko(t,vol,f){
  const o=AC.createOscillator(),g=AC.createGain();o.type='sine';o.frequency.setValueAtTime(f*1.6,t);o.frequency.exponentialRampToValueAtTime(f,t+.12);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(.001,t+.7);o.connect(g);g.connect(mbus);
  const r=AC.createGain();r.gain.value=.7;g.connect(r);r.connect(mrevIn);o.start(t);o.stop(t+.75);
  const s=AC.createBufferSource();s.buffer=noiseBuf;const fl=AC.createBiquadFilter();fl.type='lowpass';fl.frequency.value=500;const ng=AC.createGain();
  ng.gain.setValueAtTime(vol*.5,t);ng.gain.exponentialRampToValueAtTime(.001,t+.2);s.connect(fl);fl.connect(ng);ng.connect(mbus);s.start(t,Math.random()*.5);s.stop(t+.25);
}
function arp(f,t,vol){
  const o=AC.createOscillator(),g=AC.createGain(),fl=AC.createBiquadFilter();o.type='triangle';o.frequency.value=f;fl.type='lowpass';fl.frequency.value=2400;
  g.gain.setValueAtTime(.0001,t);g.gain.linearRampToValueAtTime(vol,t+.01);g.gain.exponentialRampToValueAtTime(.0005,t+.32);
  o.connect(fl);fl.connect(g);g.connect(mbus);const e=AC.createGain();e.gain.value=.35;g.connect(e);e.connect(echoIn);o.start(t);o.stop(t+.35);
}

function targetIntensity(){
  let T=.18;
  const st=typeof state!=='undefined'?state:'MENU';
  if(st==='PLAYING'){
    const pvp=typeof mode!=='undefined'&&mode==='pvp';
    const combat=safe(()=>toSpawn>0||zombies.some(z=>!z.dead));
    T=pvp?.72:(combat?.58+Math.min(typeof wave==='number'?wave:0,14)*.022:.34);
    if(safe(()=>!!bossZ))T=1;
    if(safe(()=>selfDead))T=Math.min(T,.22);
  }else if(st==='SHOP')T=.28;else if(st==='GAMEOVER')T=.1;
  return T;
}

function schedule(){
  if(!AC||!ready||AC.state!=='running'||!mbus)return;
  const now=AC.currentTime,ahead=now+.9;
  if(typeof mMuted!=='undefined'&&mMuted){nextChord=nextBell=nextBeat=nextArp=0;return}
  if(now-lastScan>.25){lastScan=now;Ttarget=targetIntensity()}
  I+=(Ttarget-I)*.035;
  const pvp=safe(()=>mode==='pvp')&&safe(()=>state==='PLAYING');
  /* nappes + sub */
  if(nextChord<now)nextChord=now+.1;
  while(nextChord<ahead){
    const len=pvp?7.5:(I>.5?9:13),ch=CH[chordIdx%4],cut=520+I*1500;
    ch.forEach((n,i)=>mvoice(mf(n+(i===0?0:0)),nextChord+i*.15,len*1.15,(i===0?.07:.055)*(1-.2*I),cut));
    msub(mf(ch[0]-12),nextChord,len,.16);
    chordIdx++;nextChord+=len;
  }
  /* souffle : plus présent quand c'est calme */
  if(airG)airG.gain.setTargetAtTime(.05*(1-I*.6),now,2);
  if(bossGain)bossGain.gain.setTargetAtTime(Ttarget>=.99?.09:0,now,1.5);
  /* cloches espacées */
  if(nextBell<now)nextBell=now+rnd(1,3);
  while(nextBell<ahead){
    if(!pvp){
      const ch=CH[(chordIdx+3)%4],base=ch[0]+24+pick(PENTA);
      bell(mf(base),nextBell,.05*(1-.45*I),rnd(-.6,.6));
      if(Math.random()<.35)bell(mf(base+pick([7,12,-5])),nextBell+rnd(.3,.7),.035*(1-.4*I),rnd(-.6,.6));
    }
    nextBell+=rnd(2.4,5.5)*(1+I*.9);
  }
  /* battement de cœur + tambours */
  if(I>.5){
    const bpm=62+I*44,per=60/bpm;
    if(nextBeat<now)nextBeat=now+.05;
    while(nextBeat<ahead){
      const k=Math.min(1,(I-.45)/.4);
      heart(nextBeat,.34*k);
      if(I>.68&&beatN%2===0)taiko(nextBeat+per*.5,.24*(I-.5),(beatN%4===0?58:66));
      if(I>.9&&beatN%4===3)taiko(nextBeat+per*.25,.16,74);
      beatN++;nextBeat+=per;
    }
  }else nextBeat=0;
  /* arène PvP : arpège en croches */
  if(pvp){
    const sd=60/104/2;if(nextArp<now)nextArp=now+.05;
    while(nextArp<ahead){
      const ch=CH[(chordIdx+3)%4],n=ch[arpN%4]+12+(arpN%8>=4?12:0);
      if(arpN%2===0||Math.random()<.6)arp(mf(n),nextArp,.05);
      arpN++;nextArp+=sd;
    }
  }else nextArp=0;
  /* hurlements lointains (PvE en partie) */
  if(safe(()=>state==='PLAYING')&&!pvp){
    if(!nextHowl)nextHowl=now+rnd(14,30);
    if(now>nextHowl){
      const p=rnd(-.9,.9),f=rnd(150,230);
      V(f*1.5,f*.55,rnd(2.2,3.6),.05,[[650,7,1],[1150,9,.5]],{pan:p,rev:.9});
      nextHowl=now+rnd(22,55);
    }
  }
}

function setup(){
  if(ready||typeof AC==='undefined'||!AC||!noiseBuf)return;
  ready=true;
  const imp=impulse(3.4,2.4);
  /* réverb des SFX (sort vers master) */
  srevIn=AC.createGain();const sr=AC.createConvolver();sr.buffer=imp;const so=AC.createGain();so.gain.value=.55;srevIn.connect(sr);sr.connect(so);so.connect(master);
  /* bus de la musique (sort vers musicG : volume + coupure M conservés) */
  mbus=AC.createGain();mbus.gain.value=.95;mbus.connect(musicG);
  mrevIn=AC.createGain();const mr=AC.createConvolver();mr.buffer=impulse(5,2);const mo=AC.createGain();mo.gain.value=.8;mrevIn.connect(mr);mr.connect(mo);mo.connect(musicG);
  /* écho des cloches */
  echoIn=AC.createGain();const d=AC.createDelay(2);d.delayTime.value=.42;const fb=AC.createGain();fb.gain.value=.42;const ef=AC.createBiquadFilter();ef.type='lowpass';ef.frequency.value=2200;
  echoIn.connect(d);d.connect(ef);ef.connect(fb);fb.connect(d);const eo=AC.createGain();eo.gain.value=.8;ef.connect(eo);eo.connect(mbus);eo.connect(mrevIn);
  /* souffle de vent */
  const w=AC.createBufferSource();w.buffer=noiseBuf;w.loop=true;const bp=AC.createBiquadFilter();bp.type='bandpass';bp.Q.value=1.1;bp.frequency.value=500;
  const lf=AC.createOscillator(),lg=AC.createGain();lf.frequency.value=.06;lg.gain.value=260;lf.connect(lg);lg.connect(bp.frequency);
  airG=AC.createGain();airG.gain.value=.05;w.connect(bp);bp.connect(airG);airG.connect(mbus);w.start();lf.start();
  /* drone de boss (triton) */
  bossGain=AC.createGain();bossGain.gain.value=0;const bf=AC.createBiquadFilter();bf.type='lowpass';bf.frequency.value=240;
  [55,55*1.4983].forEach((f,i)=>{const o=AC.createOscillator();o.type='sawtooth';o.frequency.value=f;o.detune.value=i?7:-7;o.connect(bf);o.start()});
  bf.connect(bossGain);bossGain.connect(mbus);
  /* on remplace SFX + on coupe l'ancienne boucle musicale */
  Object.assign(SFX,NEW_SFX);SFX.smg=SFX.rifle;
  /* grognements : ambiance non directionnelle coupée, volume réduit, jamais 2 en même temps */
  {const _g=SFX.groan;let lastG=0;SFX.groan=function(v){if(v!==undefined&&v<=1)return;const t=AC.currentTime;if(t-lastG<.4)return;lastG=t;if(window.ZVOICE)return ZVOICE.global(v);return _g.call(this,Math.min(v===undefined?1:v,1.6)*.45)}}
  safe(()=>{musicTick=function(){}});
  setInterval(()=>safe(schedule),120);
}

/* initAudio : le jeu le rappelle à chaque lancement -> on branche notre moteur juste après sa création */
const _ia=window.initAudio;
if(typeof _ia==='function'){
  window.initAudio=function(){const r=_ia.apply(this,arguments);safe(setup);return r};
  try{initAudio=window.initAudio}catch(_){}
}else safe(setup);

/* le moteur démarre dès le premier geste (menu compris) : clic, touche, bouton de manette */
let armed=false;
function arm(e){
  if(armed&&typeof AC!=='undefined'&&AC&&AC.state==='running')return;
  safe(()=>{initAudio();if(AC&&AC.state==='suspended')AC.resume();armed=true;setup()});
}
['pointerdown','keydown','touchstart'].forEach(ev=>addEventListener(ev,arm,true));
addEventListener('gp-change',arm);
(function poll(){const p=(navigator.getGamepads&&navigator.getGamepads())||[];for(const g of p)if(g&&g.buttons&&g.buttons.some(b=>b.pressed)){arm();break}setTimeout(poll,500)})();

/* clics de menu */
document.addEventListener('click',e=>{
  if(typeof AC==='undefined'||!AC||!ready)return;
  const t=e.target&&e.target.closest&&e.target.closest('button,a[href],[role=button]');
  if(t&&(typeof state==='undefined'||state!=='PLAYING'))safe(()=>SFX.ui());
},true);

window.AUDIO_IMMERSIF={intensity:()=>I,target:()=>Ttarget,ready:()=>ready};
})();
