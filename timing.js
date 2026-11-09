// Lyric Studio · Pantalla completa de sincronización (se carga después de app.js)
(()=>{
const OFFK='lyricStudio.tapOffset', LRC=/\[\d+:\d+(?:\.\d+)?\]/, SPAN=10;
let off=(v=>v===null?0.1:Math.min(.3,Math.max(0,+v||0)))(localStorage.getItem(OFFK));
let D=[],O=[],ci=0,cw=0,H=[],mode='line',raf=0,prevRate=1,prevSel='1',finished=false,stop=null,rv=false,rvBackup=null,rvR=[0,0];

const T=document.createElement('div'); T.id='timer'; T.hidden=true;
T.innerHTML=`<div class="tm-top">
 <button class="btn-sm" id="tmExit">← Salir</button><b id="tmTitle">Sincronizar letra</b><span class="grow"></span>
 <div class="seg" id="tmMode"><button data-m="line" class="active">Por línea</button><button data-m="word">Por palabra</button></div>
 <div class="seg" id="tmSpeed"><button data-s="0.5">0.5×</button><button data-s="0.75">0.75×</button><button data-s="1" class="active">1×</button></div>
 <label class="tm-off" title="Compensa el retraso al tocar: se resta a cada marca">Compensar reacción <input type="range" id="tmOff" min="0" max="300" step="10"><output id="tmOffV"></output></label>
 <button class="btn-primary" id="tmDone">Guardar</button></div>
<div class="tm-prevwrap"><canvas id="tmPrev"></canvas></div>
<div class="tm-lines" id="tmLines"></div>
<div class="tm-bot">
 <canvas class="tm-wave" id="tmWave"></canvas>
 <div class="tm-bar"><span id="tmT">00:00</span><div class="tm-prog" id="tmProg"><i id="tmFill"></i></div><span id="tmD">00:00</span></div>
 <div class="tm-ctl"><button class="btn-sm" id="tmBack">−5 s</button><button class="btn-sm" id="tmPlay">▶</button>
  <button class="tm-tap" id="tmTap">MARCAR</button>
  <button class="btn-sm" id="tmUndo">↶ Deshacer</button><button class="btn-sm" id="tmEnd" title="La línea anterior termina aquí (pausa instrumental)">Fin de línea</button>
  <button class="btn-sm" id="tmReview" title="Reproduce lo marcado con tu animación real, en bucle">▶ Repasar con animación</button></div>
 <p class="tm-help" id="tmHelp"></p></div>`;
document.body.append(T);
const q=id=>T.querySelector('#'+id), L=q('tmLines'), K=id=>hotkeyLabel(hotkeys[id]);

const toggle=()=>$('playBtn').click();
const curT=()=>Math.max(0,audioEl.currentTime-off*audioEl.playbackRate);
const snap=()=>JSON.stringify([ci,cw,D.map(l=>[l.start,l.end,l.wt||null,l._m,l._e])]);
const push=()=>{H.push(snap());if(H.length>300)H.shift();};
const help=()=>{q('tmHelp').textContent=rv?'Repaso: así se verá con tu animación. Haz clic en una línea para repetirlo en bucle.':
 finished?'¡Terminaste! Pulsa «Repasar con animación» para verlo con la animación o «Guardar» para guardar. Clic en una línea para repetirla.':
 `${K('tmMark')}: marcar ${mode==='word'?'cada palabra':'el inicio de cada línea'} justo cuando se canta · ${K('tmUndo')}: deshacer · ${K('tmEnd')}: fin de línea · ${K('tmPlay')}: play/pausa · clic en una línea: repetirla`;};

function build(){
  L.innerHTML=D.map((l,i)=>`<div class="tm-l" data-i="${i}"><span class="ts"></span>${wordsOf(l.text).map(w=>`<span class="w">${esc(w)}</span>`).join(' ')||'<i>(vacía)</i>'}</div>`).join('');
}
function paint(scroll){
  T.classList.toggle('word',mode==='word'); help();
  [...L.children].forEach((e,i)=>{ const l=D[i];
    e.className='tm-l'+(i<ci?' done':i===ci?' cur':'')+(stop!==null&&i!==stop?' ctx':''); e.firstChild.textContent=l._m?fmtTime(l.start):'';
    if(mode==='word') e.querySelectorAll('.w').forEach((w,j)=>w.className='w'+(i<ci||(i===ci&&j<cw)?' on':i===ci&&j===cw?' nx':'')); });
  if(scroll) L.children[Math.min(ci,D.length-1)]?.scrollIntoView({block:'center',behavior:'smooth'});
}
function mark(){
  if(finished||rv) return;
  if(audioEl.paused){ toggle(); return; }
  const l=D[ci], p=D[ci-1], word=mode==='word', n=wordsOf(l.text).length, dur=tlDur(); let t=curT();
  push(); if(p&&t<p.start+.05) t=p.start+.05;
  if(!word||!n||cw===0){
    l.start=t; l._m=1; l._e=0; if(p&&!p._e&&(p._m||p.end>t)) p.end=Math.max(p.start+.05,t);
    if(word&&n) l.wt=[t]; else delete l.wt;
  } else l.wt.push(Math.max(t,l.wt[cw-1]+.03));
  if(!l._e) l.end=Math.min(dur,Math.max(l.start+.5,t+(word?1.2:3)));
  if(word&&n){ cw++; if(cw<n){ paint(); return; } cw=0; }
  ci++; if(ci>=D.length||(stop!==null&&ci>stop)){ finished=true; if(!audioEl.paused) toggle(); }
  paint(true);
}
function markEnd(){
  if(rv) return; const target=(mode==='word'&&cw>0)?D[ci]:D[ci-1]; if(!target||!target._m) return;
  push(); target.end=Math.max(target.start+.1,curT()); target._e=1; paint();
}
function undo(){
  if(rv) return; const s=H.pop(); if(!s) return; const [a,b,arr]=JSON.parse(s);
  ci=a; cw=b; finished=false;
  arr.forEach((v,i)=>{ const l=D[i]; [l.start,l.end,,l._m,l._e]=v; if(v[2]) l.wt=v[2]; else delete l.wt; });
  const t0=cw>0&&D[ci].wt?D[ci].wt[cw-1]:(ci>0?D[ci-1].start:0); seekTo(Math.max(0,t0-1.5)); paint(true);
}
function jump(i){
  ci=i; cw=0; finished=false; const p=D[i-1]; seekTo(Math.max(0,(p&&p._m?p.start:D[i].start)-1.5)); paint(true);
}
function setSpeed(s){
  audioEl.playbackRate=s; audioEl.preservesPitch=true;
  q('tmSpeed').querySelectorAll('button').forEach(b=>b.classList.toggle('active',+b.dataset.s===s));
}

// Borrador -> letra final (ordena tramos sin marcar; en modo "una línea" solo ajusta ese línea)
function draftToLines(){
  const dur=tlDur(), E=D.map(l=>({...l,wt:l.wt?[...l.wt]:undefined}));
  if(stop===null){
    for(let i=1;i<E.length;i++){ const l=E[i],p=E[i-1]; if(l._m||l.start>=p.start+.1) continue;
      let j=i; while(j<E.length&&!E[j]._m) j++;
      const lo=Math.min(p.start+2.5,dur), hi=j<E.length?E[j].start:dur, run=j-i, step=Math.max(.5,(hi-lo)/run);
      for(let k=0;k<run;k++){ E[i+k].start=lo+k*step; E[i+k].end=lo+(k+1)*step; delete E[i+k].wt; } i=j-1; }
  }else{
    const l=E[stop], o=O[stop], nx=E[stop+1];
    if(l&&l._m){
      if(!l._e) l.end=l.start+(o.end-o.start);
      if(!l.wt&&o.wt&&mode==='line') l.wt=o.wt.map(x=>x+l.start-o.start);   // resincronizar por línea conserva los tiempos de palabra
      if(l.wt) l.end=Math.max(l.end,l.wt[l.wt.length-1]+.3);
      if(nx) l.end=Math.min(l.end,Math.max(l.start+.05,nx.start));
    }
  }
  return E.map(({_m,_e,...l})=>(l.wt||delete l.wt,l));
}

// Repaso: aplica el borrador de forma temporal y lo reproduce con el render real
function review(on){
  if(on===rv) return;
  if(on){
    if(!D.some(l=>l._m)){ toast('Marca al menos una línea para repasar.'); return; }
    if(!audioEl.paused) toggle();
    rvBackup=lyricLines; lyricLines=draftToLines(); sel=null;
    const m=D.map((l,i)=>l._m?i:-1).filter(i=>i>=0), a=lyricLines[m[0]], b=lyricLines[m[m.length-1]];
    rvR=[Math.max(0,a.start-1),Math.min(tlDur(),b.end+1)];
    rv=true; T.classList.add('review'); q('tmReview').textContent='■ Volver a marcar'; seekTo(rvR[0]); toggle();
  }else{
    if(!audioEl.paused) toggle();
    lyricLines=rvBackup; rvBackup=null; rv=false; T.classList.remove('review'); q('tmReview').textContent='▶ Repasar con animación';
  }
  paint();
}

// Onda del audio con marcas
function drawWave(){
  const cv=q('tmWave'); if(!peaks){ cv.style.display='none'; return; } cv.style.display='';
  const dpr=devicePixelRatio||1, W=cv.clientWidth, Hh=cv.clientHeight; if(!W) return;
  if(cv.width!==Math.round(W*dpr)){ cv.width=Math.round(W*dpr); cv.height=Math.round(Hh*dpr); }
  const c=cv.getContext('2d'), t0=audioEl.currentTime-SPAN*.3, px=W/SPAN, X=t=>(t-t0)*px;
  c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,W,Hh); c.fillStyle='rgba(62,201,167,.55)';
  for(let x=0;x<W;x++){ const ta=t0+x/px, a=Math.floor(ta*PPS_B), b=Math.max(a+1,Math.floor((ta+1/px)*PPS_B)); let m=0;
    for(let i=Math.max(0,a);i<b&&i<peaks.length;i++) if(peaks[i]>m) m=peaks[i]; const hh=m*Hh*.46; c.fillRect(x,Hh/2-hh,1,Math.max(1,hh*2)); }
  (rv?lyricLines:D).forEach((l,i)=>{ if(!rv&&!l._m) return;
    if(l.start>=t0&&l.start<=t0+SPAN){ c.fillStyle=(!rv&&i===ci-1)?'#fff':TC('#E8A33D'); c.fillRect(X(l.start)-1,0,2,Hh); }
    if(l.wt) l.wt.forEach((w,j)=>{ if(j&&w>=t0&&w<=t0+SPAN){ c.fillStyle='rgba(255,255,255,.55)'; c.fillRect(X(w),Hh*.25,1,Hh*.5); } }); });
  c.fillStyle='rgba(255,255,255,.3)'; c.fillRect(X(curT()),0,1,Hh);          // dónde caería una marca ahora
  c.fillStyle='#fff'; c.fillRect(X(audioEl.currentTime)-1,0,2,Hh);           // cabezal
}
function loop(){
  const d=tlDur(), t=audioEl.currentTime;
  q('tmT').textContent=fmtTimeShort(t); q('tmD').textContent=fmtTimeShort(d); q('tmFill').style.width=(d?Math.min(100,t/d*100):0)+'%';
  q('tmPlay').textContent=audioEl.paused?'▶':'❚❚'; drawWave();
  if(rv){ drawFrame(t); const pv=q('tmPrev'); pv.getContext('2d').drawImage(canvas,0,0,pv.width,pv.height);
    if(t>=rvR[1]-.02||(audioEl.paused&&audioEl.ended)){ seekTo(rvR[0]); if(audioEl.paused) toggle(); } }
  raf=requestAnimationFrame(loop);
}
function open(o){
  const opt=(o&&typeof o.from==='number')?o:{};
  if(!audioLoaded){ toast('Carga primero el audio para poder sincronizar la letra.'); return; }
  if(!lyricLines.length){ toast('Primero carga o pega la letra.'); return; }
  if(!audioEl.paused) toggle();
  O=lyricLines; D=lyricLines.map(l=>({...l,wt:l.wt?[...l.wt]:undefined,_m:0,_e:0})); H=[]; finished=false; cw=0; rv=false; rvBackup=null;
  stop=typeof opt.from==='number'?opt.from:null; ci=stop!==null?stop:Math.max(0,lyricLines.indexOf(sel)); mode=opt.mode||'line';
  prevRate=audioEl.playbackRate; prevSel=$('rate').value;
  q('tmTitle').textContent=stop!==null?`Resincronizar línea ${stop+1}`:'Sincronizar letra';
  q('tmMode').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.m===mode));
  q('tmOff').value=Math.round(off*1000); q('tmOffV').textContent=Math.round(off*1000)+' ms';
  const pv=q('tmPrev'); pv.width=Math.min(canvas.width,640); pv.height=Math.round(pv.width*canvas.height/canvas.width);
  T.classList.remove('review'); q('tmReview').textContent='▶ Repasar con animación';
  T.hidden=false; build(); setSpeed(1); seekTo(stop!==null||ci>0?Math.max(0,lyricLines[ci].start-2):0); paint(true); cancelAnimationFrame(raf); loop();
}
function close(){
  if(rv) review(false);
  if(!audioEl.paused) toggle(); cancelAnimationFrame(raf); audioEl.playbackRate=prevRate; $('rate').value=prevSel; T.hidden=true;
}
function apply(){
  if(rv) review(false);
  const marked=D.filter(l=>l._m).length;
  if(!marked){ close(); return; }
  const rest=D.length-marked;
  if(stop===null&&rest&&!confirm(`Quedan ${rest} líneas sin marcar: conservarán su tiempo anterior (o se repartirán de forma pareja si quedan desordenadas). ¿Guardar de todos modos?`)) return;
  lyricLines=draftToLines(); sel=null;
  close(); buildEditor(); checkReady(); redraw(); toast(stop!==null?'Línea resincronizada.':`Sincronización guardada: ${marked} líneas marcadas.`);
}
function cancel(){ if(D.some(l=>l._m)&&!confirm('¿Descartar los tiempos que marcaste?')) return; close(); }

// controles
q('tmTap').onpointerdown=e=>{ e.preventDefault(); mark(); };
q('tmUndo').onclick=undo; q('tmEnd').onclick=markEnd; q('tmPlay').onclick=toggle; q('tmReview').onclick=()=>review(!rv);
q('tmBack').onclick=()=>seekTo(audioEl.currentTime-5);
q('tmExit').onclick=cancel; q('tmDone').onclick=apply;
q('tmProg').onclick=e=>{ const r=e.currentTarget.getBoundingClientRect(); seekTo((e.clientX-r.left)/r.width*tlDur()); };
q('tmWave').onclick=e=>{ const r=e.currentTarget.getBoundingClientRect(); seekTo(audioEl.currentTime-SPAN*.3+(e.clientX-r.left)/r.width*SPAN); };
q('tmMode').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; mode=b.dataset.m; cw=0;
  q('tmMode').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b)); paint(); };
q('tmSpeed').onclick=e=>{ const b=e.target.closest('button'); if(b) setSpeed(+b.dataset.s); };
q('tmOff').oninput=e=>{ off=e.target.value/1000; q('tmOffV').textContent=e.target.value+' ms'; try{localStorage.setItem(OFFK,off);}catch(x){} };
L.onclick=e=>{ const r=e.target.closest('.tm-l'); if(!r) return; const i=+r.dataset.i;
  if(rv){ const l=lyricLines[i]; rvR=[Math.max(0,l.start-1),Math.min(tlDur(),l.end+1)]; seekTo(rvR[0]); if(audioEl.paused) toggle(); return; }
  if(stop!==null&&i!==stop) return; jump(i); };
T.addEventListener('click',e=>e.target.closest('button')?.blur());
audioEl.addEventListener('ended',()=>{ if(!T.hidden&&!rv){ finished=true; paint(); } });
document.addEventListener('keydown',e=>{
  if(T.hidden) return; e.stopImmediatePropagation();
  if(e.target.matches('input')) return;
  const hit=f=>{ e.preventDefault(); if(!e.repeat) f(); };
  if(matchesHotkey(e,'tmMark')) hit(mark);
  else if(matchesHotkey(e,'tmUndo')||e.code==='Backspace') hit(undo);
  else if(matchesHotkey(e,'tmEnd')||e.code==='ArrowDown') hit(markEnd);
  else if(matchesHotkey(e,'tmPlay')) hit(toggle);
  else if(e.code==='Escape') hit(cancel);
},true);
document.addEventListener('keyup',e=>{ if(!T.hidden&&hotkeys.tmMark&&e.code===hotkeys.tmMark.code) e.preventDefault(); },true);

// ===== Puntos de entrada =====
$('syncBtn').onclick=()=>open(); $('syncBtn').textContent='⏱ Sincronizar letra'; $('syncBtn').title='Abre la pantalla completa de sincronización';

// Wizard: detecta LRC pegado y, si es texto plano con audio, lleva directo a la sincronización
const _wc=wzCreate;
wzCreate=function(noLyrics){
  if(!noLyrics&&LRC.test($('wLyrics').value)){ const p=parseLRC($('wLyrics').value); if(p.length){ $('wLyrics').value=p.map(l=>l.text).join('\n'); wzTimed=p; } }
  const plain=!noLyrics&&!wzTimed&&wzRows().length>0&&audioLoaded;
  _wc(noLyrics); if(plain){ const whenFree=()=>{ if(document.getElementById('tutorialRoot')) setTimeout(whenFree,600); else open(); }; setTimeout(whenFree,700); }  // espera a que termine el tutorial
};
const _wh=wzHint;
wzHint=function(){ _wh(); const raw=$('wLyrics').value, h=$('wHint'); if(!h||!raw.trim()) return;
  if(LRC.test(raw)) h.textContent='Detecté formato LRC: se usan los tiempos que trae.';
  else if(!wzTimed&&audioLoaded) h.textContent=`${wzRows().length} líneas. Al crear el proyecto pasas a la pantalla de sincronización para marcarlas con el audio.`; };
$('wLyrics').addEventListener('input',()=>wzHint());

// Editor: "Usar este texto" también detecta LRC y lleva a la sincronización si hay audio
const _pb=$('pasteBtn').onclick;
$('pasteBtn').onclick=function(){
  const raw=$('pasteLyrics').value;
  if(LRC.test(raw)){ const p=parseLRC(raw);
    if(p.length){ if(lyricLines.length&&!confirm('Ya hay una letra cargada. ¿Reemplazarla?')) return;
      lyricLines=p; sel=null; buildEditor(); checkReady(); redraw(); toast(p.length+' líneas con sus tiempos (LRC).'); return; } }
  const before=lyricLines; _pb.call(this);
  if(lyricLines!==before){ if(audioLoaded) setTimeout(()=>open(),300); else toast('Letra cargada. Sube el audio y pulsa ⏱ Sincronizar letra para marcarla.'); }
};
window.openLyricTimer=open;
})();
