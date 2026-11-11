// Lyric Studio · Exportación de escritorio con FFmpeg
// Se carga DESPUÉS de app.js y ffmpeg-spec.js. Solo actúa en la versión de escritorio, con cuenta PRO
// y si el puente window.lyricDesktop.ffmpeg existe; en cualquier otro caso se usa el modal de siempre.
(()=>{
'use strict';
const FF=window.FFSpec, P=window.Platform, LS='lyricStudio.exportDesktop';
if(!FF||!P||!P.features.extremeExport) return;
const bridge=()=>window.lyricDesktop&&window.lyricDesktop.ffmpeg;
const el=id=>document.getElementById(id);
const sleep0=()=>new Promise(r=>setTimeout(r));
let caps=null, built=false, bypass=false, seq=0, busy=false, locked=false;
const sizeCache=new Map();

/* ───────────── utilidades ───────────── */
const fmtB=n=>n>=1e9?(n/1e9).toFixed(1).replace('.',',')+' GB':n>=1e6?Math.round(n/1e6)+' MB':Math.round(n/1e3)+' KB';
const fmtT=s=>{s=Math.max(0,Math.round(s));return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
const evenDims=res=>exportDimensions(res).map(v=>Math.max(2,Math.round(v/2)*2));
const duration=()=>audioBuf?audioBuf.duration:(audioEl.duration||0);
const srcName=()=>(projectFiles.audio&&projectFiles.audio.name)||'audio';
const opts=(list,sel)=>list.map(([v,t,dis])=>`<option value="${v}"${String(v)===String(sel)?' selected':''}${dis?' disabled':''}>${t}</option>`).join('');
function fill(id,list,def){ const s=el(id),cur=s.value||(def!=null?String(def):''); s.innerHTML=opts(list,cur); if(!list.some(x=>String(x[0])===cur)) s.selectedIndex=Math.max(0,list.findIndex(x=>!x[2])); }
const show=(f,on)=>{ const n=document.querySelector('#dxModal [data-f="'+f+'"]'); if(n) n.hidden=!on; };

/* ───────────── interfaz ───────────── */
function build(){
  if(built) return; built=true;
  const f=(k,label,inner)=>`<label data-f="${k}"><span>${label}</span>${inner}</label>`;
  const S=id=>`<select id="${id}"></select>`, N=(id,min,max,v)=>`<input type="number" id="${id}" min="${min}" max="${max}" value="${v}">`;
  const m=document.createElement('div');
  m.className='export-modal'; m.id='dxModal'; m.hidden=true; m.setAttribute('role','dialog'); m.setAttribute('aria-modal','true'); m.setAttribute('aria-labelledby','dxTitle');
  m.innerHTML=`<div class="export-box dx-box">
    <h2 id="dxTitle">Exportar video</h2>
    <p id="dxSub">Versión de escritorio · motor FFmpeg</p>
    <div class="dx-tabs" role="tablist">
      <button type="button" role="tab" data-tab="basic" aria-selected="true">Básico</button>
      <button type="button" role="tab" data-tab="adv" aria-selected="false">Avanzado</button>
    </div>
    <div class="dx-grid dx-panel" data-panel="basic">
      ${f('ext','Formato (extensión)',S('dxExt'))}${f('fps','FPS (fotogramas por segundo)',S('dxFps'))}${f('res','Resolución',S('dxRes'))}
    </div>
    <div class="dx-panel" data-panel="adv" hidden>
      <h3>Video</h3>
      <div class="dx-grid">
        ${f('codec','Códec',S('dxCodec'))}${f('enc','Encoder',S('dxEnc'))}
        ${f('quality','Calidad',S('dxQuality'))}${f('crf','CRF (0 = máxima, 51 = mínima)',N('dxCrf',0,51,18))}
        ${f('kbps','Tasa de bits (kbps)',N('dxKbps',100,800000,20000))}${f('speed','Velocidad de compresión',S('dxSpeed'))}
        ${f('bits','Profundidad de color',S('dxBits'))}${f('chroma','Submuestreo de color',S('dxChroma'))}
        ${f('prores','Perfil ProRes',S('dxProres'))}${f('gop','Intervalo de fotogramas clave (s)',N('dxGop',0,10,2))}
        ${f('threads','Hilos de CPU (0 = automático)',N('dxThreads',0,64,0))}
      </div>
      <div class="dx-checks">
        <label data-f="bt"><input type="checkbox" id="dxBt" checked> Etiquetar color BT.709 (recomendado)</label>
        <label data-f="fast"><input type="checkbox" id="dxFast" checked> Inicio rápido (faststart) para reproducir mientras carga</label>
      </div>
      <h3 data-f="audioH">Audio</h3>
      <div class="dx-grid">
        ${f('acodec','Códec de audio',S('dxAcodec'))}${f('abr','Tasa de bits (kbps)',N('dxAbr',32,512,192))}
        ${f('asr','Frecuencia de muestreo',S('dxAsr'))}${f('ach','Canales',S('dxAch'))}
      </div>
    </div>
    <div class="export-dims" id="dxDims"></div>
    <div class="export-warning" id="dxWarn" role="note" hidden></div>
    <div class="dx-compat" id="dxCompat" aria-live="polite"></div>
    <div class="export-actions"><button class="btn-sm" id="dxCancel" type="button">Cancelar</button><button class="btn-primary" id="dxStart" type="button">Iniciar exportación</button></div>
  </div>`;
  document.body.append(m);
  m.addEventListener('click',e=>{ if(e.target===m&&!busy) m.hidden=true; });
  m.addEventListener('keydown',e=>{ if(e.key==='Escape'&&!busy) m.hidden=true; });
  el('dxCancel').onclick=()=>{ m.hidden=true; };
  el('dxStart').onclick=start;
  m.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{
    if(locked&&b.dataset.tab==='adv'){ requireProFeature('Las opciones avanzadas de exportación'); return; }
    m.querySelectorAll('[data-tab]').forEach(x=>x.setAttribute('aria-selected',x===b?'true':'false'));
    m.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==b.dataset.tab);
  });
  m.addEventListener('change',e=>{ if(locked){ lockedChange(e); return; } sync(); });
  m.addEventListener('input',e=>{ if(!locked&&e.target.type==='number') sync(true); });
}

function read(){
  const v=id=>el(id).value;
  return {ext:v('dxExt'),fps:+v('dxFps'),res:+v('dxRes'),codec:v('dxCodec'),enc:v('dxEnc'),quality:v('dxQuality'),crf:+v('dxCrf'),kbps:+v('dxKbps'),
    speed:+v('dxSpeed'),bits:+v('dxBits'),chroma:v('dxChroma'),prores:+v('dxProres'),gop:+v('dxGop'),threads:+v('dxThreads'),
    faststart:el('dxFast').checked,bt709:el('dxBt').checked,acodec:v('dxAcodec'),abr:+v('dxAbr'),asr:+v('dxAsr'),ach:+v('dxAch')};
}
function save(){ try{ localStorage.setItem(LS,JSON.stringify(read())); }catch(e){} }
function restore(){
  let s={}; try{ s=JSON.parse(localStorage.getItem(LS)||'{}')||{}; }catch(e){}
  const set=(id,val)=>{ if(val!=null&&el(id)){ el(id).value=val; } };
  fill('dxExt',Object.keys(FF.CONTAINERS).map(k=>[k,FF.CONTAINERS[k].label]));
  set('dxExt',s.ext||'mp4'); sync(true);
  [['dxFps',s.fps],['dxRes',s.res],['dxCodec',s.codec]].forEach(([i,x])=>set(i,x)); sync(true);
  [['dxEnc',s.enc],['dxQuality',s.quality],['dxCrf',s.crf],['dxKbps',s.kbps],['dxSpeed',s.speed],['dxBits',s.bits],['dxChroma',s.chroma],['dxProres',s.prores],
   ['dxGop',s.gop],['dxThreads',s.threads],['dxAcodec',s.acodec],['dxAbr',s.abr],['dxAsr',s.asr],['dxAch',s.ach]].forEach(([i,x])=>set(i,x));
  if(s.faststart!=null) el('dxFast').checked=!!s.faststart; if(s.bt709!=null) el('dxBt').checked=!!s.bt709;
  sync(true);
}

// Ajusta cada lista según lo que permite el formato y el códec elegidos, y actualiza avisos.
function sync(skipSave){
  const v=read(), C=FF.CONTAINERS[v.ext];
  fill('dxFps',FF.FPS.filter(x=>x<=(C.maxFps||240)).map(x=>[x,x+' FPS']),30);
  fill('dxRes',FF.RES.filter(x=>x<=(C.maxRes||4320)).map(x=>[x,FF.RES_LABEL[x]]),1080);
  fill('dxCodec',C.video.map(c=>[c,FF.CODECS[c].label]));
  const codec=el('dxCodec').value, K=FF.CODECS[codec], intra=!K.gop;
  // encoders disponibles para este códec
  const have=n=>!caps||caps.encoders.includes(n), hwOk=n=>FF.ENC[n].hw&&have(n)&&(caps?caps.working.includes(n):true);
  const names=FF.PREF[codec].filter(n=>FF.ENC[n].hw?hwOk(n):have(n));
  const encList=[['auto','Automático (hardware si funciona, si no software)'],['sw','Solo software']];
  if(names.some(n=>FF.ENC[n].hw)) encList.push(['hw','Solo hardware']);
  names.forEach(n=>encList.push([n,FF.ENC_LABEL(n)+(FF.ENC[n].hw?' · hardware':'')]));
  fill('dxEnc',encList);
  const encSel=el('dxEnc').value, hwForced=encSel==='hw'||(FF.ENC[encSel]&&FF.ENC[encSel].hw);
  // calidad
  const q=[]; if(K.rates.includes('crf')) q.push(['max',FF.QUALITY.max.label],['high',FF.QUALITY.high.label],['balanced',FF.QUALITY.balanced.label],['small',FF.QUALITY.small.label],['crf',FF.QUALITY.crf.label]);
  if(K.rates.includes('bitrate')) q.push(['bitrate',FF.QUALITY.bitrate.label]);
  if(K.rates.includes('lossless')&&K.rates.length>1) q.push(['lossless',FF.QUALITY.lossless.label,hwForced]);
  fill('dxQuality',q,'high');
  fill('dxSpeed',FF.SPEED_LABEL.map((t,i)=>[i,t]),2);
  fill('dxBits',K.bits.map(b=>[b,b+' bits']));
  fill('dxChroma',[['420','4:2:0 (compatible)',false],['422','4:2:2',hwForced],['444','4:4:4',hwForced]].filter(x=>K.chroma.includes(x[0])));
  if(hwForced&&el('dxChroma').value!=='420') el('dxChroma').value='420';
  fill('dxProres',FF.PRORES_LABEL.map((t,i)=>[i,t]),3);
  fill('dxAsr',[[0,'Original'],[44100,'44,1 kHz'],[48000,'48 kHz'],[96000,'96 kHz']]);
  fill('dxAch',[[0,'Original'],[1,'Mono'],[2,'Estéreo']]);
  fill('dxAcodec',C.audio.map(a=>[a,FF.ACODECS[a]+(a==='copy'&&!FF.canCopyAudio(srcName(),v.ext)?' — no compatible con este audio':''),a==='copy'&&!FF.canCopyAudio(srcName(),v.ext)]));
  const ac=el('dxAcodec').value, qv=el('dxQuality').value;
  // visibilidad
  show('enc',FF.PREF[codec].length>1); show('quality',K.rates.includes('crf')); show('crf',qv==='crf'); show('kbps',qv==='bitrate');
  show('speed',!['prores','ffv1','gif'].includes(codec)); show('bits',K.bits.length>1); show('chroma',K.chroma.length>1);
  show('prores',codec==='prores'); show('gop',!!K.gop); show('bt',codec!=='gif'); show('fast',!!C.faststart);
  ['audioH','acodec'].forEach(k=>show(k,C.audio.length>0)); show('abr',['aac','mp3','opus'].includes(ac)); show('asr',!!ac&&ac!=='copy'&&ac!=='opus'); show('ach',!!ac&&ac!=='copy');
  info(); if(skipSave!==true) save(); refreshCompat();
}

function currentSpec(){
  const v=read(), [w,h]=evenDims(v.res);
  return {spec:FF.normalize({...v,w,h,hasAudio:true,srcName:srcName(),inPix:'rgba'},caps),mode:v.enc,w,h,res:v.res};
}

function info(){
  const {spec,w,h}=currentSpec(), d=duration(), frames=Math.round(d*spec.fps), dm=FF.demanding(w,h,spec.fps,spec);
  el('dxDims').textContent='Salida: '+w+' × '+h+' px · '+spec.fps+' FPS · '+frames.toLocaleString('es-AR')+' cuadros ('+fmtT(d)+')';
  if(!checkReady()) el('dxDims').textContent='Primero carga audio y letra para habilitar la exportación.';
  const warn=el('dxWarn'); warn.hidden=!dm.on;
  if(dm.on) warn.innerHTML='<span aria-hidden="true">⚠</span><span><b>Exportación exigente:</b> '+dm.reasons.join(', ')+'. Puede consumir mucha CPU, GPU, memoria y disco, y tardar bastante; la velocidad y la estabilidad dependen del equipo. Cada cuadro sin comprimir pesa '+fmtB(dm.frameBytes)+' y se envía a FFmpeg a unos '+fmtB(dm.flowBps)+'/s. Si se congela o falla, baja los FPS o la resolución.</span>';
}

// Resuelve qué encoder se usará; los de hardware se prueban de verdad con ese tamaño y FPS.
async function resolve(spec,mode){
  const order=FF.encoderOrder(spec,caps,mode); let note='';
  for(const n of order){
    if(!FF.ENC[n].hw) return {name:n,note};
    const key=[n,spec.w,spec.h,spec.fps,spec.bits,spec.rate].join('|');
    if(!sizeCache.has(key)) sizeCache.set(key,Promise.resolve(bridge().test({...spec,encoder:n})).catch(()=>false));
    if(await sizeCache.get(key)) return {name:n,note};
    note='El hardware ('+FF.ENC_LABEL(n)+') no admite '+spec.w+'×'+spec.h+' a '+spec.fps+' FPS con estos ajustes. ';
  }
  return null;
}
async function refreshCompat(){
  const my=++seq, out=el('dxCompat'), btn=el('dxStart');
  const {spec,mode}=currentSpec(); btn.disabled=true; out.textContent='Comprobando compatibilidad con tu equipo…';
  const r=await resolve(spec,mode); if(my!==seq) return;
  if(!r){ out.innerHTML='⚠ Este equipo no puede codificar esta combinación. Prueba otro códec, encoder, resolución o FPS.'; return; }
  const hw=FF.ENC[r.name].hw; btn.disabled=!checkReady();
  out.textContent=(r.note||'')+'Se usará '+FF.ENC_LABEL(r.name)+(hw?' (hardware).':'.');
}

/* modo bloqueado (sin PRO): se ve el mismo cuadro, pero solo WebM (gratis, grabación del navegador)
   está disponible; los demás formatos aparecen con 🔒 y la pestaña Avanzado queda bloqueada. */
const FREE_EXT='webm', AUTO_TXT='A decidir por el navegador';
function applyLock(){
  const m=el('dxModal'), adv=m.querySelector('[data-tab="adv"]');
  m.classList.toggle('dx-locked',locked);
  adv.textContent=locked?'🔒 Avanzado · PRO':'Avanzado'; adv.classList.toggle('pro-locked',locked);
  if(!locked){ el('dxFps').disabled=false; el('dxRes').disabled=false; return; }
  seq++;                                   // descarta comprobaciones de compatibilidad pendientes
  m.querySelector('[data-tab="basic"]').click();
  el('dxExt').innerHTML=Object.keys(FF.CONTAINERS).map(k=>'<option value="'+k+'">'+FF.CONTAINERS[k].label+(k===FREE_EXT?'':' · 🔒 PRO')+'</option>').join('');
  el('dxExt').value=FREE_EXT;
  ['dxFps','dxRes'].forEach(id=>{ el(id).innerHTML='<option value="">'+AUTO_TXT+'</option>'; el(id).disabled=true; });
  el('dxDims').textContent='WebM: usa la vista previa ('+canvas.width+' × '+canvas.height+' px). La captura es en tiempo real y el navegador determina los FPS; no se pueden fijar aquí.';
  el('dxWarn').hidden=true; el('dxCompat').textContent='Los demás formatos, FPS, resoluciones y opciones avanzadas (FFmpeg, hardware) son parte de Lyric Studio PRO.';
  el('dxStart').disabled=!checkReady();
  if(!checkReady()) el('dxDims').textContent='Primero carga audio y letra para habilitar la exportación.';
}
function lockedChange(e){
  if(e.target.id==='dxExt'&&e.target.value!==FREE_EXT){ e.target.value=FREE_EXT; requireProFeature('Este formato de exportación'); }
}
// Exportación gratuita: reutiliza el exportador WebM de siempre.
function startFree(){
  if(exportInProgress) return;
  if(!checkReady()){ toast('Carga audio y letra antes de exportar.','error'); return; }
  el('dxModal').hidden=true;
  el('expFormat').value='webm'; updateExportDims(); el('exportStart').click();
}

/* ───────────── exportación ───────────── */
const RGB={RGBA:'rgba',BGRA:'bgra',RGBX:'rgb0',BGRX:'bgr0'};
async function start(){
  if(locked){ startFree(); return; }
  if(busy||exportInProgress) return;
  if(!checkReady()){ toast('Carga audio y letra antes de exportar.','error'); return; }
  busy=true;
  const b=bridge(), {spec:sp0,mode,w:W,h:H,res}=currentSpec();
  const r=await resolve(sp0,mode); if(!r){ busy=false; toast('Esta combinación no es compatible con tu equipo.','error'); return; }
  const spec={...sp0,encoder:r.name}, fps=spec.fps;
  let out=null; try{ out=await b.chooseOutput({name:safeName()+'.'+spec.ext,ext:spec.ext}); }catch(e){ out=null; }
  if(!out){ busy=false; return; }
  const modal=el('dxModal'), btn=el('exportBtn'), stopBtn=el('stopBtn'), status=el('expStatus'), fill_=el('progFill');
  const original=[canvas.width,canvas.height];
  let job=null, cancel=false, ok=false, wmWasPlaying=false, audioTok=null;
  exportInProgress=true; modal.hidden=true;
  try{
    stopBtn.style.display='inline-flex'; stopBtn.onclick=()=>{ cancel=true; };
    if(isPlaying) el('playBtn').click();
    wmWasPlaying=!!(wmVideoEl&&!wmVideoEl.paused); if(wmVideoEl) wmVideoEl.pause();
    setControlsLocked(true); btn.classList.add('recording'); btn.textContent='Exportando…';
    beginTopExport('Exportando '+spec.ext.toUpperCase()+' · '+res+'p · '+fps+' FPS · '+FF.ENC_LABEL(spec.encoder));
    updateTopExport(null,'Preparando FFmpeg…');
    if(spec.hasAudio){
      const data=await (projectFiles.audio?projectFiles.audio.arrayBuffer():fetch(audioEl.src).then(x=>x.arrayBuffer()));
      audioTok=await b.stashAudio({name:srcName(),data});
    }
    canvas.width=W; canvas.height=H;
    const total=Math.max(1,Math.round(duration()*fps)), bufs=[null,null];
    // Primer cuadro: fija el formato de píxel real del canvas y el tamaño del búfer.
    drawFrame(0);
    let pix='rgba';
    const grab=async(i)=>{
      if(typeof VideoFrame!=='undefined'){
        const vf=new VideoFrame(canvas,{timestamp:0});
        try{
          const p=RGB[vf.format];
          if(p){ const buf=bufs[i&1]&&bufs[i&1].byteLength===vf.allocationSize()?bufs[i&1]:(bufs[i&1]=new Uint8Array(vf.allocationSize())); await vf.copyTo(buf); return {buf,pix:p}; }
        }finally{ vf.close(); }
      }
      const d=ctx.getImageData(0,0,W,H); return {buf:new Uint8Array(d.data.buffer),pix:'rgba'};
    };
    let first; try{ first=await grab(0); }catch(e){ throw new Error('No pude crear un lienzo de '+W+'×'+H+' (puede faltar memoria de video). Prueba una resolución menor.'); }
    pix=first.pix; spec.inPix=pix;
    job=await b.start({spec,w:W,h:H,fps,out,audio:audioTok,duration:duration()});
    const t0=performance.now(); let inflight=null, lastUi=0;
    for(let i=0;i<total&&!cancel;i++){
      const t=Math.min(i/fps,duration());
      if(bgMode==='video'&&bgVideoEl){ bgVideoEl.currentTime=t%(bgVideoEl.duration||1); await new Promise(rs=>{ const f=()=>{ bgVideoEl.removeEventListener('seeked',f); rs(); }; bgVideoEl.addEventListener('seeked',f); setTimeout(rs,250); }); }
      if(S.watermark&&wmType==='video'&&wmVideoEl){ const wt=t%(wmVideoEl.duration||1); if(Math.abs(wmVideoEl.currentTime-wt)>.02){ wmVideoEl.currentTime=wt; await new Promise(rs=>{ const f=()=>{ wmVideoEl.removeEventListener('seeked',f); rs(); }; wmVideoEl.addEventListener('seeked',f); setTimeout(rs,250); }); } }
      drawFrame(t);
      const g=await grab(i);
      if(g.pix!==pix) throw new Error('El formato de píxel del lienzo cambió durante la exportación.');
      if(inflight) await inflight;               // el cuadro anterior ya se está escribiendo mientras este se dibujaba
      inflight=b.write(job.id,g.buf);
      const now=performance.now();
      if(now-lastUi>150||i===total-1){
        lastUi=now; const prog=(i+1)/total, rate=(i+1)/((now-t0)/1000), eta=(total-i-1)/Math.max(rate,.01);
        fill_.style.width=(prog*100)+'%'; status.textContent='Exportando… '+Math.round(prog*100)+'%';
        updateTopExport(prog,'Cuadro '+(i+1).toLocaleString('es-AR')+' de '+total.toLocaleString('es-AR')+' · '+rate.toFixed(1).replace('.',',')+' cuadros/s · faltan '+fmtT(eta));
        await sleep0();
      }
    }
    if(inflight) await inflight;
    if(cancel){ await b.cancel(job.id); job=null; status.textContent='Exportación cancelada.'; }
    else{
      updateTopExport(null,'Finalizando el archivo…');
      const res2=await b.finish(job.id); job=null;
      if(!res2.ok) throw new Error(res2.error||'FFmpeg terminó con error.');
      const a=document.createElement('button'); a.type='button'; a.className='dl'; a.textContent='✓ Guardado · Mostrar en la carpeta'; a.onclick=()=>b.reveal(out);
      status.innerHTML=''; status.appendChild(a); fill_.style.width='100%'; ok=true;
    }
  }catch(e){
    if(job){ try{ await b.cancel(job.id); }catch(_){} }
    status.textContent='No se pudo exportar: '+(e&&e.message||e); toast(status.textContent,'error');
  }finally{
    finishTopExport(ok,cancel?'Exportación cancelada.':ok?'Video guardado en tu equipo.':'No se pudo completar la exportación.');
    canvas.width=original[0]; canvas.height=original[1];
    exportInProgress=false; busy=false; btn.classList.remove('recording'); btn.textContent='Exportar video'; stopBtn.style.display='none';
    setControlsLocked(false); if(wmWasPlaying&&wmVideoEl) wmVideoEl.play().catch(()=>{}); drawFrame(getCurrentTime());
  }
}

/* ───────────── enganche al botón de exportar ───────────── */
async function open(){
  build();
  if(!caps){
    try{ caps=await bridge().probe(); }catch(e){ caps=null; }
    if(!caps||!caps.encoders||!caps.encoders.length){ caps=null; toast('No encuentro FFmpeg en esta instalación. Uso el exportador básico.','error'); bypass=true; el('exportBtn').click(); bypass=false; return; }
    el('dxSub').textContent='Versión de escritorio · FFmpeg '+(caps.version||'');
  }
  locked=!featurePro; applyLock();
  if(!locked) restore();
  el('dxModal').hidden=false; el('dxStart').focus();
}
el('exportBtn').addEventListener('click',e=>{
  if(bypass||!bridge()||typeof featurePro==='undefined') return;   // web o sin puente → modal original (sin PRO también se usa este cuadro, bloqueado)
  e.stopImmediatePropagation(); e.preventDefault();
  if(exportInProgress){ toast('Ya hay una exportación en curso.'); return; }
  open();
},true);
})();
