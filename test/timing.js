// Lyric Studio · Pantalla completa de timeo (se carga después de app.js)
(()=>{
const OFFK='lyricStudio.tapOffset', LRC=/\[\d+:\d+(?:\.\d+)?\]/;
let off=(v=>v===null?0.1:Math.min(.3,Math.max(0,+v||0)))(localStorage.getItem(OFFK));
let D=[],ci=0,cw=0,H=[],mode='line',speed=1,raf=0,prevRate=1,prevSel='1',finished=false;

const T=document.createElement('div'); T.id='timer'; T.hidden=true;
T.innerHTML=`<div class="tm-top">
 <button class="btn-sm" id="tmExit">← Volver</button><b>Timear letra</b><span class="grow"></span>
 <div class="seg" id="tmMode"><button data-m="line" class="active">Por línea</button><button data-m="word">Por palabra</button></div>
 <div class="seg" id="tmSpeed"><button data-s="0.5">0.5×</button><button data-s="0.75">0.75×</button><button data-s="1" class="active">1×</button></div>
 <label class="tm-off" title="Compensa el retraso al tocar: se resta a cada marca">Reacción <input type="range" id="tmOff" min="0" max="300" step="10"><output id="tmOffV"></output></label>
 <button class="btn-primary" id="tmDone">Listo</button></div>
<div class="tm-lines" id="tmLines"></div>
<div class="tm-bot">
 <div class="tm-bar"><span id="tmT">00:00</span><div class="tm-prog" id="tmProg"><i id="tmFill"></i></div><span id="tmD">00:00</span></div>
 <div class="tm-ctl"><button class="btn-sm" id="tmBack">−5 s</button><button class="btn-sm" id="tmPlay">▶</button>
  <button class="tm-tap" id="tmTap">MARCAR</button>
  <button class="btn-sm" id="tmUndo">↶ Deshacer</button><button class="btn-sm" id="tmEnd" title="La línea anterior termina aquí (pausa instrumental)">Fin de línea</button></div>
 <p class="tm-help" id="tmHelp"></p></div>`;
document.body.append(T);
const q=id=>T.querySelector('#'+id), L=q('tmLines');

const toggle=()=>$('playBtn').click();
const curT=()=>Math.max(0,audioEl.currentTime-off*audioEl.playbackRate);
const snap=()=>JSON.stringify([ci,cw,D.map(l=>[l.start,l.end,l.wt||null,l._m,l._e])]);
const push=()=>{H.push(snap());if(H.length>300)H.shift();};
const help=()=>{q('tmHelp').textContent=finished?'¡Terminaste! Revisa la letra y pulsa «Listo». Puedes hacer clic en una línea para repetirla.':
 `Espacio: marcar ${mode==='word'?'cada palabra':'el inicio de cada línea'} justo cuando se canta · ←: deshacer · F: fin de línea · P: play/pausa · clic en una línea: repetirla`;};

function build(){
  L.innerHTML=D.map((l,i)=>`<div class="tm-l" data-i="${i}"><span class="ts"></span>${wordsOf(l.text).map(w=>`<span class="w">${esc(w)}</span>`).join(' ')||'<i>(vacía)</i>'}</div>`).join('');
}
function paint(scroll){
  T.classList.toggle('word',mode==='word'); help();
  [...L.children].forEach((e,i)=>{ const l=D[i];
    e.className='tm-l'+(i<ci?' done':i===ci?' cur':''); e.firstChild.textContent=l._m?fmtTime(l.start):'';
    if(mode==='word') e.querySelectorAll('.w').forEach((w,j)=>w.className='w'+(i<ci||(i===ci&&j<cw)?' on':i===ci&&j===cw?' nx':'')); });
  if(scroll) L.children[Math.min(ci,D.length-1)]?.scrollIntoView({block:'center',behavior:'smooth'});
}
function mark(){
  if(finished) return;
  if(audioEl.paused){ toggle(); return; }
  const l=D[ci], p=D[ci-1], word=mode==='word', n=wordsOf(l.text).length, dur=tlDur(); let t=curT();
  push(); if(p&&t<p.start+.05) t=p.start+.05;
  if(!word||!n||cw===0){
    l.start=t; l._m=1; l._e=0; if(p&&!p._e) p.end=Math.max(p.start+.05,t);
    if(word&&n) l.wt=[t]; else delete l.wt;
  } else l.wt.push(Math.max(t,l.wt[cw-1]+.03));
  if(!l._e) l.end=Math.min(dur,Math.max(l.start+.5,t+(word?1.2:3)));
  if(word&&n){ cw++; if(cw<n){ paint(); return; } cw=0; }
  ci++; if(ci>=D.length){ finished=true; if(!audioEl.paused) toggle(); }
  paint(true);
}
function markEnd(){
  const target=(mode==='word'&&cw>0)?D[ci]:D[ci-1]; if(!target||!target._m) return;
  push(); target.end=Math.max(target.start+.1,curT()); target._e=1; paint();
}
function undo(){
  const s=H.pop(); if(!s) return; const [a,b,arr]=JSON.parse(s);
  ci=a; cw=b; finished=false;
  arr.forEach((v,i)=>{ const l=D[i]; [l.start,l.end,,l._m,l._e]=v; if(v[2]) l.wt=v[2]; else delete l.wt; });
  const t0=cw>0&&D[ci].wt?D[ci].wt[cw-1]:(ci>0?D[ci-1].start:0); seekTo(Math.max(0,t0-1.5)); paint(true);
}
function jump(i){
  ci=i; cw=0; finished=false; const p=D[i-1]; seekTo(Math.max(0,(p&&p._m?p.start:D[i].start)-1.5)); paint(true);
}
function setSpeed(s){
  speed=s; audioEl.playbackRate=s; audioEl.preservesPitch=true;
  q('tmSpeed').querySelectorAll('button').forEach(b=>b.classList.toggle('active',+b.dataset.s===s));
}
function loop(){
  const d=tlDur(), t=audioEl.currentTime;
  q('tmT').textContent=fmtTimeShort(t); q('tmD').textContent=fmtTimeShort(d); q('tmFill').style.width=(d?Math.min(100,t/d*100):0)+'%';
  q('tmPlay').textContent=audioEl.paused?'▶':'❚❚'; raf=requestAnimationFrame(loop);
}
function open(){
  if(!audioLoaded){ toast('Cargá el audio primero para poder timear.'); return; }
  if(!lyricLines.length){ toast('Cargá o pegá la letra primero.'); return; }
  if(!audioEl.paused) toggle();
  D=lyricLines.map(l=>({...l,wt:l.wt?[...l.wt]:undefined,_m:0,_e:0})); H=[]; finished=false; cw=0;
  const i=lyricLines.indexOf(sel); ci=Math.max(0,i);
  prevRate=audioEl.playbackRate; prevSel=$('rate').value; mode='line';
  q('tmMode').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.m==='line'));
  q('tmOff').value=Math.round(off*1000); q('tmOffV').textContent=Math.round(off*1000)+' ms';
  T.hidden=false; build(); setSpeed(1); seekTo(i>0?Math.max(0,lyricLines[i].start-2):0); paint(true); cancelAnimationFrame(raf); loop();
}
function close(){
  if(!audioEl.paused) toggle(); cancelAnimationFrame(raf); audioEl.playbackRate=prevRate; $('rate').value=prevSel; T.hidden=true;
}
function apply(){
  const marked=D.filter(l=>l._m).length, dur=tlDur();
  if(!marked){ close(); return; }
  const rest=D.length-marked;
  if(rest&&!confirm(`Quedan ${rest} líneas sin marcar. Se mantienen con su tiempo anterior (o se reparten parejo si quedan desordenadas). ¿Guardar igual?`)) return;
  for(let i=1;i<D.length;i++){ const l=D[i],p=D[i-1]; if(l._m||l.start>=p.start+.1) continue;
    let j=i; while(j<D.length&&!D[j]._m) j++;
    const lo=Math.min(p.start+2.5,dur), hi=j<D.length?D[j].start:dur, run=j-i, step=Math.max(.5,(hi-lo)/run);
    for(let k=0;k<run;k++){ D[i+k].start=lo+k*step; D[i+k].end=lo+(k+1)*step; delete D[i+k].wt; } i=j-1; }
  lyricLines=D.map(({_m,_e,...l})=>(l.wt||delete l.wt,l)); sel=null;
  close(); buildEditor(); checkReady(); redraw(); toast(`Timeo guardado: ${marked} líneas marcadas.`);
}
function cancel(){ if(D.some(l=>l._m)&&!confirm('¿Descartar los tiempos que marcaste?')) return; close(); }

// controles
q('tmTap').onpointerdown=e=>{ e.preventDefault(); mark(); };
q('tmUndo').onclick=undo; q('tmEnd').onclick=markEnd; q('tmPlay').onclick=toggle;
q('tmBack').onclick=()=>seekTo(audioEl.currentTime-5);
q('tmExit').onclick=cancel; q('tmDone').onclick=apply;
q('tmProg').onclick=e=>{ const r=e.currentTarget.getBoundingClientRect(); seekTo((e.clientX-r.left)/r.width*tlDur()); };
q('tmMode').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; mode=b.dataset.m; cw=0;
  q('tmMode').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b)); paint(); };
q('tmSpeed').onclick=e=>{ const b=e.target.closest('button'); if(b) setSpeed(+b.dataset.s); };
q('tmOff').oninput=e=>{ off=e.target.value/1000; q('tmOffV').textContent=e.target.value+' ms'; try{localStorage.setItem(OFFK,off);}catch(x){} };
L.onclick=e=>{ const r=e.target.closest('.tm-l'); if(r) jump(+r.dataset.i); };
T.addEventListener('click',e=>e.target.closest('button')?.blur());
audioEl.addEventListener('ended',()=>{ if(!T.hidden){ finished=true; paint(); } });
document.addEventListener('keydown',e=>{
  if(T.hidden) return; e.stopImmediatePropagation();
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('input')) return;
  const k=e.code, hit=f=>{ e.preventDefault(); if(!e.repeat) f(); };
  if(k==='Space') hit(mark); else if(k==='ArrowLeft'||k==='Backspace') hit(undo);
  else if(k==='KeyF'||k==='ArrowDown') hit(markEnd); else if(k==='KeyP') hit(toggle); else if(k==='Escape') hit(cancel);
},true);
document.addEventListener('keyup',e=>{ if(!T.hidden&&e.code==='Space') e.preventDefault(); },true);

// ===== Puntos de entrada =====
$('tapBtn').onclick=open; $('tapBtn').textContent='⏱ Timear letra'; $('tapBtn').title='Abre la pantalla completa de timeo';
const tw=$('tapWords')?.closest('label'); if(tw) tw.style.display='none';

// Wizard: detecta LRC pegado y, si es texto plano con audio, lleva directo al timeo
const _wc=wzCreate;
wzCreate=function(noLyrics){
  if(!noLyrics&&LRC.test($('wLyrics').value)){ const p=parseLRC($('wLyrics').value); if(p.length){ $('wLyrics').value=p.map(l=>l.text).join('\n'); wzTimed=p; } }
  const plain=!noLyrics&&!wzTimed&&wzRows().length>0&&audioLoaded;
  _wc(noLyrics); if(plain) setTimeout(open,700);
};
const _wh=wzHint;
wzHint=function(){ _wh(); const raw=$('wLyrics').value, h=$('wHint'); if(!h||!raw.trim()) return;
  if(LRC.test(raw)) h.textContent='Detecté formato LRC: se usan los tiempos que trae.';
  else if(!wzTimed&&audioLoaded) h.textContent=`${wzRows().length} líneas. Al crear el proyecto pasas a la pantalla de timeo para marcarlas con el audio.`; };
$('wLyrics').addEventListener('input',()=>wzHint());
// Editor: "Usar este texto" también detecta LRC y lleva al timeo si hay audio
const _pb=$('pasteBtn').onclick;
$('pasteBtn').onclick=function(){
  const raw=$('pasteLyrics').value;
  if(LRC.test(raw)){ const p=parseLRC(raw);
    if(p.length){ if(lyricLines.length&&!confirm('Ya hay una letra cargada. ¿Reemplazarla?')) return;
      lyricLines=p; sel=null; buildEditor(); checkReady(); redraw(); toast(p.length+' líneas con sus tiempos (LRC).'); return; } }
  const before=lyricLines; _pb.call(this);
  if(lyricLines!==before){ if(audioLoaded) setTimeout(open,300); else toast('Letra cargada. Sube el audio y pulsa ⏱ Timear letra para marcarla.'); }
};
window.openLyricTimer=open;
})();
