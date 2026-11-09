// ---------- state ----------
let lyricLines = []; // {start, end, text}
let audioEl = new Audio();
let audioLoaded = false;
let bgMode = 'color';
let bgImageEl = null;
let bgVideoEl = null;
const TC=(h,al)=>window.Theme?Theme.color(h,al):(al==null?h:`rgba(${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)},${al})`);   // color de interfaz según el tema
let kfView = null;            // null | 'edit' | 'play' (editor de keyframes)
const projectFiles={audio:null,image:null,video:null,watermark:null};
let customFontLoaded = null;
let aspect = '9:16';
let isPlaying = false;
let rafId = null;
let mediaRecorder = null;
let recordedChunks = [];

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const aspectDims = {
  '9:16':[720,1280], '16:9':[1280,720], '1:1':[900,900], '4:5':[864,1080]
};

function setCanvasSize(){
  const [w,h] = aspectDims[aspect];
  canvas.width = w; canvas.height = h;
}
setCanvasSize();

// ---------- file drop helpers ----------
function wireDrop(dropId, inputId, cb){
  const drop = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  const go = f=>{ fileNames[dropId]=f.name; cb(f, drop); changed(); };
  const blocked=()=>dropId==='dropFont'&&!featurePro;
  drop.addEventListener('click', ()=>{if(blocked()){openFontPreview();return;}input.click();});
  drop.addEventListener('dragover', e=>{e.preventDefault(); drop.style.borderColor='var(--gold)';});
  drop.addEventListener('dragleave', ()=>drop.style.borderColor='');
  drop.addEventListener('drop', e=>{
    e.preventDefault(); drop.style.borderColor='';
    if(blocked()){openFontPreview();return;}
    if(e.dataTransfer.files[0]) go(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', ()=>{ if(input.files[0]){if(blocked()){openFontPreview();input.value='';return;}go(input.files[0]);} });
}

// ---------- lyrics parsing ----------
function timeToSec_lrc(tag){
  // [mm:ss.xx]
  const m = tag.match(/(\d+):(\d+(?:\.\d+)?)/);
  if(!m) return null;
  return parseInt(m[1])*60 + parseFloat(m[2]);
}
function timeToSec_srt(tag){
  // hh:mm:ss,mmm
  const m = tag.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if(!m) return null;
  return parseInt(m[1])*3600 + parseInt(m[2])*60 + parseInt(m[3]) + parseInt(m[4])/1000;
}

function parseLRC(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  for(const line of lines){
    const tags = [...line.matchAll(/\[(\d+:\d+(?:\.\d+)?)\]/g)];
    if(tags.length === 0) continue;
    const content = line.replace(/\[\d+:\d+(?:\.\d+)?\]/g,'').trim();
    if(!content) continue;
    for(const t of tags){
      const s = timeToSec_lrc(t[1]);
      if(s!==null) out.push({start:s, end:null, text:content});
    }
  }
  out.sort((a,b)=>a.start-b.start);
  for(let i=0;i<out.length;i++){
    out[i].end = (i<out.length-1) ? out[i+1].start : out[i].start + 4;
  }
  return out;
}

function parseSRT(text){
  const blocks = text.split(/\r?\n\r?\n/);
  const out = [];
  for(const b of blocks){
    const lines = b.split(/\r?\n/).filter(l=>l.trim().length);
    if(lines.length < 2) continue;
    const timeLine = lines.find(l=>l.includes('-->'));
    if(!timeLine) continue;
    const [a,c] = timeLine.split('-->').map(s=>s.trim());
    const start = timeToSec_srt(a), end = timeToSec_srt(c);
    const textLines = lines.slice(lines.indexOf(timeLine)+1);
    const content = textLines.join(' ').trim();
    if(start!==null && end!==null && content) out.push({start,end,text:content});
  }
  return out;
}

function detectAndParse(filename, text){
  const lower = filename.toLowerCase();
  if(lower.endsWith('.srt')) return parseSRT(text);
  if(lower.endsWith('.lrc')) return parseLRC(text);
  // fallback: try to detect by content
  if(text.includes('-->')) return parseSRT(text);
  return parseLRC(text);
}

wireDrop('dropLyrics','fileLyrics',(file, drop)=>{
  const reader = new FileReader();
  reader.onload = ()=>{
    lyricLines = detectAndParse(file.name, reader.result);
    if(!lyricLines.length) lyricLines = plainToLines(reader.result);
    drop.textContent = file.name;
    drop.classList.add('has-file');
    buildEditor();
    checkReady();
    redraw();
  };
  reader.readAsText(file);
});


// ---------- audio ----------
function resetDrop(drop,text){ drop.textContent=drop.dataset.def||text||''; drop.classList.remove('has-file'); }
function useAudioFile(file,drop=$('dropAudio')){
  if(!drop.dataset.def) drop.dataset.def=drop.textContent;
  const url=URL.createObjectURL(file);
  let settled=false;
  const fail=why=>{
    if(settled) return; settled=true;
    URL.revokeObjectURL(url);
    audioEl.onloadedmetadata=audioEl.onerror=null;
    audioLoaded=false; audioBuf=null; peaks=null; projectFiles.audio=null;
    audioEl.removeAttribute('src'); audioEl.load();
    resetDrop(drop); $('audioInfo').textContent='Sin archivo cargado.';
    toast('El archivo de audio «'+file.name+'» '+why,'error');
    checkReady(); drawTimeline(0);
  };
  projectFiles.audio=file;
  audioLoaded=false;
  loadWave(file);
  audioEl.onerror=()=>fail('está dañado o su formato no es compatible.');
  audioEl.src=url;
  const t=setTimeout(()=>fail('tardó demasiado en cargar. Puede estar dañado.'),20000);
  audioEl.onloadedmetadata=()=>{
    clearTimeout(t);
    if(!isFinite(audioEl.duration)||audioEl.duration<=0){ fail('no tiene una duración válida (posiblemente dañado).'); return; }
    settled=true; audioLoaded=true;
    document.getElementById('seek').max=audioEl.duration;
    updateTimeDisplay(); checkReady();
  };
  drop.textContent=file.name;
  drop.classList.add('has-file');
  document.getElementById('audioInfo').textContent=file.name;
}
wireDrop('dropAudio','fileAudio',useAudioFile);

// ---------- background mode ----------
document.querySelectorAll('.bgmode button').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.bgmode button').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    bgMode = btn.dataset.bg;
    ['bgColorPanel','bgImagePanel','bgVideoPanel','bgGradientPanel'].forEach(id=>{
      document.getElementById(id).style.display = 'none';
    });
    if(bgMode==='color') document.getElementById('bgColorPanel').style.display='block';
    if(bgMode==='image') document.getElementById('bgImagePanel').style.display='block';
    if(bgMode==='video') document.getElementById('bgVideoPanel').style.display='block';
    if(bgMode==='gradient') document.getElementById('bgGradientPanel').style.display='block';
    const fxAnim=document.getElementById('bgFxAnim'); if(fxAnim) fxAnim.style.display=bgMode==='image'?'':'none';
    redraw();
  });
});

function useBackgroundImage(file,drop=$('dropImg')){
  if(!drop.dataset.def) drop.dataset.def=drop.textContent;
  const img=new Image(), url=URL.createObjectURL(file);
  img.onload=()=>{ if(!img.naturalWidth){ img.onerror(); return; } projectFiles.image=file; bgImageEl=img; drop.textContent=file.name; drop.classList.add('has-file'); redraw(); };
  img.onerror=()=>{ URL.revokeObjectURL(url); toast('La imagen «'+file.name+'» está dañada o no es compatible.','error'); };
  img.src=url;
}
wireDrop('dropImg','fileImg',useBackgroundImage);

function useBackgroundVideo(file,drop=$('dropVid')){
  if(!drop.dataset.def) drop.dataset.def=drop.textContent;
  const v=document.createElement('video'), url=URL.createObjectURL(file);
  v.muted=true; v.loop=true; v.playsInline=true; v.preload='metadata';
  const ready=new Promise(resolve=>{
    let done=false;
    const finish=ok=>{
      if(done) return; done=true; clearTimeout(timer);
      if(ok&&(!v.videoWidth||!v.videoHeight)) ok=false;
      if(ok){ projectFiles.video=file; bgVideoEl=v; drop.textContent=file.name; drop.classList.add('has-file'); redraw(); }
      else{ URL.revokeObjectURL(url); toast('El video «'+file.name+'» está dañado o su formato no es compatible con este navegador.','error'); }
      resolve(ok);
    };
    const timer=setTimeout(()=>finish(false),30000);
    v.onloadeddata=()=>finish(true); v.onerror=()=>finish(false);
  });
  v.src=url; v.load();
  return ready;
}
wireDrop('dropVid','fileVid',useBackgroundVideo);

wireDrop('dropFont','fileFont',(file, drop)=>{
  if(!canUseFont('CustomUserFont')){ openFontPreview(); return; }
  const r = new FileReader();
  r.onload = async ()=>{
    try{
      const b64 = bufToB64(r.result);
      await registerCustomFont(r.result, file.name);
      customFontB64 = b64; customFontLabel = file.name; redraw();
      drop.textContent = file.name; drop.classList.add('has-file');
    }catch(e){ toast('No pude leer la tipografía «'+file.name+'»: el archivo está dañado o no es válido.','error'); }
  };
  r.onerror=()=>toast('No pude leer el archivo de tipografía.','error');
  r.readAsArrayBuffer(file);
});

// ---------- aspect ----------
document.getElementById('aspectSeg').addEventListener('click', e=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#aspectSeg button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  aspect = e.target.dataset.a;
  setCanvasSize();
  redraw();
});

['fontSelect','animSelect','textColor','accentColor','fontSize','bgColor','gradA','gradB',
 'posVCustom','bgFx','bgFxAmt','bgFxSpd','bgDim','wmText','strokeW','strokeColor','glowAmt','glowColor','shAmt','shDist','upper','inDur','outSelect','vignetteToggle','accentMarkToggle','textBgToggle','wordSyncToggle','watermarkToggle','wmOpacity'].forEach(id=>{
  document.getElementById(id).addEventListener('input', ()=>redraw());
});

// vertical position preset
let posV = 'center';
document.getElementById('posVSeg').addEventListener('click', e=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#posVSeg button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  posV = e.target.dataset.pv;
  document.getElementById('customVWrap').style.display = posV==='custom' ? 'block' : 'none';
  redraw();
});

// horizontal alignment
let posH = 'center';
document.getElementById('posHSeg').addEventListener('click', e=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#posHSeg button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  posH = e.target.dataset.ph;
  redraw();
});

// watermark corner
const wmDefaultSize=t=>(t==='image'||t==='video')?12:2.2;
let wmCorner = 'br', wmType='text', wmSize=2.2, wmImageEl=null, wmVideoEl=null, wmAssetUrl='', wmAssetName='';
document.getElementById('wmCornerSeg').addEventListener('click', e=>{
  if(e.target.tagName!=='BUTTON') return;
  document.querySelectorAll('#wmCornerSeg button').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  wmCorner = e.target.dataset.c;
  redraw();
});

function getTextY(h){
  if(posV==='top') return h*0.16;
  if(posV==='center') return h*0.5;
  if(posV==='custom') return h*(S.posVCustom/100);
  return h*0.74; // bottom default
}

// ---------- time helpers ----------
function fmtTime(s){
  if(isNaN(s)) s=0;
  const m = Math.floor(s/60);
  const sec = (s%60).toFixed(2).padStart(5,'0');
  return String(m).padStart(2,'0')+':'+sec;
}
function fmtTimeShort(s){
  if(isNaN(s)) s=0;
  const m = Math.floor(s/60), sec = Math.floor(s%60);
  return String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function getCurrentTime(){ return audioLoaded ? audioEl.currentTime : 0; }

function currentLineIndex(t){
  for(let i=0;i<lyricLines.length;i++){
    if(t >= lyricLines[i].start && t < lyricLines[i].end) return i;
  }
  return -1;
}

// ---------- drawing ----------
let studyOutputCanvas=null,studyOutputCtx=null,studyMode=false,stageBackdropCanvas=null,outputBackdropCanvas=null,workstationWindow=null,workstationScreenDetails=null;
let workstationSettings={mainScreen:0,outputScreen:1};try{workstationSettings={...workstationSettings,...JSON.parse(localStorage.getItem('lyricStudio.workstation')||'{}')};}catch(e){}
function drawFrame(t){ drawFrame0(t); syncStudyGuides(); if(stageBackdropCanvas){if(stageBackdropCanvas.width!==canvas.width||stageBackdropCanvas.height!==canvas.height){stageBackdropCanvas.width=canvas.width;stageBackdropCanvas.height=canvas.height;}stageBackdropCanvas.getContext('2d').drawImage(canvas,0,0);} if(studyOutputCanvas){ if(studyOutputCanvas.width!==canvas.width||studyOutputCanvas.height!==canvas.height){studyOutputCanvas.width=canvas.width;studyOutputCanvas.height=canvas.height;} studyOutputCtx.clearRect(0,0,canvas.width,canvas.height);studyOutputCtx.drawImage(canvas,0,0);if(outputBackdropCanvas){if(outputBackdropCanvas.width!==canvas.width||outputBackdropCanvas.height!==canvas.height){outputBackdropCanvas.width=canvas.width;outputBackdropCanvas.height=canvas.height;}outputBackdropCanvas.getContext('2d').drawImage(canvas,0,0);} } syncWorkstationPreview(t);drawTimeline(t); updateBox(t); syncStudyControls(); }
function drawFrame0(t){
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  // background
  ctx.save(); bgFx(t,w,h);
  if(bgMode==='color'){
    ctx.fillStyle = S.bgColor;
    ctx.fillRect(0,0,w,h);
  } else if(bgMode==='gradient'){
    const g = ctx.createLinearGradient(0,0,w,h);
    g.addColorStop(0, S.gradA);
    g.addColorStop(1, S.gradB);
    ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
  } else if(bgMode==='image' && bgImageEl){
    drawCover(bgImageEl, w, h);
  } else if(bgMode==='video' && bgVideoEl){
    drawCover(bgVideoEl, w, h);
  } else {
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,w,h);
  }
  ctx.restore();
  if(S.bgDim>0){ ctx.fillStyle='rgba(0,0,0,'+S.bgDim/100+')'; ctx.fillRect(0,0,w,h); }

  // vignette for readability (optional)
  if(S.vignette){
    const cy0 = getTextY(h);
    const vg = ctx.createRadialGradient(w/2,cy0,h*0.15, w/2,cy0,h*0.75);
    vg.addColorStop(0,'rgba(0,0,0,0.55)');
    vg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle = vg; ctx.fillRect(0,0,w,h);
  }

  // lyric text
  const idx = currentLineIndex(t);
  document.getElementById('tcBadge').textContent = fmtTime(t);
  document.getElementById('tcIdx').textContent = 'línea ' + (idx>=0?idx+1:'—') + ' / ' + lyricLines.length;
  const act=activeLines(t), akey=act.map(l=>lyricLines.indexOf(l)).join(','); if(akey!==lastIdx){ lastIdx=akey; document.querySelectorAll('#lyricsLog .lrow').forEach((d,i)=>d.classList.toggle('cur', act.includes(lyricLines[i]))); }

  const visible=(kfView==='edit'&&kfEditor)?[lyricLines[kfEditor.i]]:activeLines(t), laneOffsets=stackedLaneOffsets(visible,t);
  visible.forEach(l=>drawLineText(l,t,laneOffsets.get(l.ly||0)||0));

  // Free siempre lleva la marca del producto; PRO puede personalizarla o quitarla.
  if(!featurePro||S.watermark){
    const wmDrawType=featurePro?S.wmType:'text',wmDrawCorner=featurePro?wmCorner:'br',wmDrawSize=featurePro?(S.wmSize||wmDefaultSize(wmDrawType)):2.2;
    ctx.save();ctx.globalAlpha=featurePro?(S.wmOpacity||55)/100:.62;const pad=w*.025;
    if(wmDrawType==='image'&&wmImageEl?.complete&&wmImageEl.naturalWidth){
      const maxW=w*wmDrawSize/100,maxH=h*.9,sc=Math.min(maxW/wmImageEl.naturalWidth,maxH/wmImageEl.naturalHeight),dw=wmImageEl.naturalWidth*sc,dh=wmImageEl.naturalHeight*sc;
      const x=wmDrawCorner.endsWith('r')?w-pad-dw:pad,y=wmDrawCorner.startsWith('b')?h-pad-dh:pad;ctx.drawImage(wmImageEl,x,y,dw,dh);
    }else if(wmDrawType==='video'&&wmVideoEl?.readyState>=2){
      const maxW=w*wmDrawSize/100,maxH=h*.9,sc=Math.min(maxW/(wmVideoEl.videoWidth||1),maxH/(wmVideoEl.videoHeight||1)),dw=wmVideoEl.videoWidth*sc,dh=wmVideoEl.videoHeight*sc;
      const x=wmDrawCorner.endsWith('r')?w-pad-dw:pad,y=wmDrawCorner.startsWith('b')?h-pad-dh:pad;ctx.drawImage(wmVideoEl,x,y,dw,dh);
    }else if(wmDrawType==='text'){
      const fs=Math.max(11,w*wmDrawSize/100);ctx.font=`500 ${fs}px 'JetBrains Mono', monospace`;ctx.fillStyle='#fff';ctx.shadowColor='rgba(0,0,0,.6)';ctx.shadowBlur=4;ctx.textBaseline='middle';
      const wx=wmDrawCorner.endsWith('r')?w-pad:pad,wy=wmDrawCorner.startsWith('b')?h-pad*1.4:pad*1.4;ctx.textAlign=wmDrawCorner.endsWith('r')?'right':'left';ctx.fillText(featurePro?(S.wmText||'LyricStudio.site'):'LyricStudio.site',wx,wy);
    }
    ctx.restore();
  }
}

function drawCover(media, w, h){
  const mw = media.videoWidth || media.naturalWidth || media.width;
  const mh = media.videoHeight || media.naturalHeight || media.height;
  const scale = Math.max(w/mw, h/mh);
  const dw = mw*scale, dh = mh*scale;
  ctx.drawImage(media, (w-dw)/2, (h-dh)/2, dw, dh);
}

// ---------- transport ----------
function updateTimeDisplay(){
  document.getElementById('tDisplay').textContent =
    fmtTimeShort(audioEl.currentTime) + ' / ' + fmtTimeShort(audioEl.duration||0);
  document.getElementById('seek').value = audioEl.currentTime;
}

function loop(){
  if(bgVideoEl && !bgVideoEl.paused){ /* keep drawing */ }
  drawFrame(getCurrentTime());
  updateTimeDisplay();
  if(isPlaying) rafId = requestAnimationFrame(loop);
}

document.getElementById('playBtn').addEventListener('click', ()=>{
  if(!audioLoaded){ toast('Falta el audio: sube un archivo de audio para reproducir el video.','error'); return; }
  if(isPlaying){
    audioEl.pause();
    if(bgVideoEl) bgVideoEl.pause();
    isPlaying = false;
    document.getElementById('playBtn').textContent = '▶';
    cancelAnimationFrame(rafId);
  } else {
    audioEl.play();
    if(bgVideoEl){
      bgVideoEl.currentTime = audioEl.currentTime % (bgVideoEl.duration || audioEl.currentTime || 1);
      bgVideoEl.play();
    }
    isPlaying = true;
    document.getElementById('playBtn').textContent = '❚❚';
    loop();
  }
});

document.getElementById('seek').addEventListener('input', e=>{
  const t = parseFloat(e.target.value);
  audioEl.currentTime = t;
  if(bgVideoEl){
    bgVideoEl.currentTime = t % (bgVideoEl.duration || t || 1);
  }
  drawFrame(getCurrentTime());
  updateTimeDisplay();
});

audioEl.addEventListener('ended', ()=>{
  isPlaying=false;
  document.getElementById('playBtn').textContent='▶';
  cancelAnimationFrame(rafId);
});

function checkReady(){
  const ready = lyricLines.length>0 && audioLoaded;
  document.getElementById('expStatus').textContent = ready ? 'Listo para exportar.' : 'Carga letra + audio para exportar';
  return ready;
}

// ---------- export ----------
function setControlsLocked(locked){
  document.body.classList.toggle('locked',locked);
  const app=document.getElementById('app');if(app)app.inert=locked;
  const shield=document.getElementById('exportInteractionShield');if(shield)shield.hidden=!locked;
  const cancelBtn=document.getElementById('stopBtn');
  if(cancelBtn){const slot=document.getElementById('exportStopSlot'),bar=document.querySelector('.export-bar');if(locked&&slot)slot.append(cancelBtn);else if(!locked&&bar){const progress=bar.querySelector('.progress-line');bar.insertBefore(cancelBtn,progress||null);}cancelBtn.disabled=false;cancelBtn.setAttribute('aria-disabled','false');cancelBtn.title='Detener exportación';}
}
document.addEventListener('keydown',e=>{if(document.body.classList.contains('locked')){e.preventDefault();e.stopImmediatePropagation();}},true);

function exportDimensions(shortSide){ const [bw,bh]=aspectDims[aspect]||[720,1280],r=bw/bh; return r>=1?[Math.round(shortSide*r),shortSide]:[shortSide,Math.round(shortSide/r)]; }
// Elige el nivel H.264 (perfil High) mínimo que soporta ese tamaño y fps.
// Con un nivel fijo (4.2) combinaciones como 1080p a 120/240 fps se descartaban por error.
function h264Codec(w,h,fps){
  const fs=Math.ceil(w/16)*Math.ceil(h/16), mbps=fs*fps;
  const levels=[['1E',40500,1620],['1F',108000,3600],['20',216000,5120],['28',245760,8192],['2A',522240,8704],['32',589824,22080],['33',983040,36864],['34',2073600,36864],['3C',4177920,139264],['3D',8355840,139264],['3E',16711680,139264]];
  const lv=levels.find(l=>fs<=l[2]&&mbps<=l[1])||levels[levels.length-1];
  return 'avc1.6400'+lv[0];
}
function exportBitrate(w,h,fps){return Math.min(120_000_000,Math.round(w*h*fps*0.12));}
function mp4ExportAvailable(){return !!(window.VideoEncoder&&window.AudioEncoder&&window.Mp4Muxer&&audioBuf);}
let exportConfig={format:'mp4',fps:30,res:720,originalSize:null}, mp4SupportMap={}, mp4SupportAspect='', mp4SupportAudioKey='', mp4ProbePromise=null, exportUiRequest=0, exportInProgress=false;
async function probeMp4Support(){
  if(!mp4ExportAvailable()) return {};
  const audioKey=audioBuf.sampleRate+':'+audioBuf.numberOfChannels;
  if(mp4SupportAspect===aspect&&mp4SupportAudioKey===audioKey) return mp4SupportMap;
  if(mp4ProbePromise) await mp4ProbePromise;
  if(mp4SupportAspect===aspect&&mp4SupportAudioKey===audioKey) return mp4SupportMap;
  const aspectKey=aspect, matrix={}; mp4SupportAspect='';
  mp4ProbePromise=(async()=>{
    const acfg={codec:'mp4a.40.2',sampleRate:audioBuf.sampleRate,numberOfChannels:Math.min(2,audioBuf.numberOfChannels),bitrate:128000};
    let audioOk=false; try{audioOk=(await AudioEncoder.isConfigSupported(acfg)).supported;}catch(e){}
    await Promise.all([480,720,1080].map(async res=>{
      const dims=exportDimensions(res); matrix[res]={};
      await Promise.all([30,60,120,240].map(async fps=>{
        try{
          const cfg={codec:h264Codec(dims[0],dims[1],fps),width:dims[0],height:dims[1],bitrate:exportBitrate(dims[0],dims[1],fps),framerate:fps};
          matrix[res][fps]=audioOk&&(await VideoEncoder.isConfigSupported(cfg)).supported;
        }catch(e){matrix[res][fps]=false;}
      }));
    }));
    if(aspect===aspectKey){mp4SupportMap=matrix;mp4SupportAspect=aspectKey;mp4SupportAudioKey=audioKey;}
  })();
  await mp4ProbePromise; mp4ProbePromise=null;
  return mp4SupportAspect===aspect?mp4SupportMap:{};
}
function applyMp4Options(matrix){
  const rs=$('expRes'),fs=$('expFps'),resOptions=[...rs.options],fpsOptions=[...fs.options];
  const supportedRes=resOptions.filter(o=>[30,60,120,240].some(f=>matrix[o.value]?.[f]));
  resOptions.forEach(o=>{o.hidden=!supportedRes.includes(o);o.disabled=o.hidden;});
  if(!supportedRes.length)return false;
  if(!supportedRes.some(o=>o.value===rs.value))rs.value=supportedRes[0].value;
  const supportedFps=fpsOptions.filter(o=>matrix[rs.value]?.[o.value]);
  fpsOptions.forEach(o=>{o.hidden=!supportedFps.includes(o);o.disabled=o.hidden;});
  if(!supportedFps.length)return false;
  if(!supportedFps.some(o=>o.value===fs.value))fs.value=supportedFps[0].value;
  return true;
}
// WebM no permite elegir fps ni resolución: en vez de mostrar valores que no se aplican, se muestra un texto fijo.
function setExportAuto(sel,on){
  let opt=sel.querySelector('option[data-auto]');
  if(on){
    if(!opt){ sel.dataset.prev=sel.value; opt=document.createElement('option'); opt.value=''; opt.dataset.auto='1'; opt.textContent='A decidir por el navegador'; sel.prepend(opt); }
    sel.value='';
  }else if(opt){
    const prev=sel.dataset.prev; opt.remove(); delete sel.dataset.prev;
    if(prev&&[...sel.options].some(o=>o.value===prev)) sel.value=prev;
  }
}
// "Exportación exigente" solo cuando la carga real es alta (p. ej. 1080p ≥ 120 fps, 720p a 240 fps).
function isDemandingExport(w,h,fps){ return w*h*fps>=1920*1080*100; }
async function updateExportDims(){
  const request=++exportUiRequest, ready=checkReady(), fmt=$('expFormat').value, fps=$('expFps'), res=$('expRes'), mp4=fmt==='mp4';
  fps.disabled=res.disabled=!mp4;
  setExportAuto(fps,!mp4); setExportAuto(res,!mp4);
  const warn=$('expWarning'); if(warn) warn.hidden=true;
  if(!ready){$('exportStart').disabled=true;$('expDims').textContent='Primero carga audio y letra para habilitar la exportación.';return;}
  if(!mp4){$('exportStart').disabled=false;$('expDims').textContent='WebM: usa la vista previa ('+canvas.width+' × '+canvas.height+' px). La captura es en tiempo real y el navegador determina los FPS; no se pueden fijar aquí.';return;}
  if(!mp4ExportAvailable()){$('exportStart').disabled=true;$('expDims').textContent='MP4 no está disponible en este navegador/audio.';return;}
  $('exportStart').disabled=true;$('expDims').textContent='Comprobando combinaciones H.264 compatibles con este equipo…';
  const matrix=await probeMp4Support();
  if(request!==exportUiRequest||$('expFormat').value!=='mp4')return;
  if(!applyMp4Options(matrix)){$('expDims').textContent='Este navegador no ofrece una combinación MP4 compatible para esta proporción.';return;}
  const d=exportDimensions(+res.value), ok=!!matrix[res.value]?.[fps.value];
  $('exportStart').disabled=!ok;
  if(warn) warn.hidden=!isDemandingExport(d[0],d[1],+fps.value);
  $('expDims').textContent='MP4 H.264: '+d[0]+' × '+d[1]+' px · '+fps.value+' FPS'+(ok?' · compatible con este codificador':'');
}
document.getElementById('exportBtn').addEventListener('click',()=>{if(exportInProgress){toast('Ya hay una exportación en curso.');return;}updateExportDims();document.getElementById('exportModal').hidden=false;});
document.getElementById('expFormat').addEventListener('change',e=>{if(e.target.value==='mp4'&&!requireProFeature('La exportación MP4'))e.target.value='webm';updateExportDims();});
document.getElementById('expFps').addEventListener('change',updateExportDims);document.getElementById('expRes').addEventListener('change',updateExportDims);
document.getElementById('exportCancel').addEventListener('click',()=>document.getElementById('exportModal').hidden=true);
document.getElementById('exportModal').addEventListener('click',e=>{if(e.target===document.getElementById('exportModal'))document.getElementById('exportModal').hidden=true;});
const exportTop=document.getElementById('exportProgressTop'), exportTopFill=document.getElementById('exportTopFill');
let exportTopStartedAt=0, exportTopHideTimer=0;
function beginTopExport(title){clearTimeout(exportTopHideTimer);exportTopStartedAt=performance.now();exportTop.hidden=false;exportTop.classList.remove('indeterminate');exportTopFill.style.width='0%';document.getElementById('exportTopTitle').textContent=title;document.getElementById('exportTopEta').textContent='Estimando…';document.getElementById('exportTopPct').textContent='0%';document.getElementById('exportTopDetail').textContent='Preparando el proyecto';const bar=exportTop.querySelector('[role="progressbar"]');bar.removeAttribute('aria-valuenow');}
function updateTopExport(progress,detail,title){if(exportTop.hidden)return;if(title)document.getElementById('exportTopTitle').textContent=title;document.getElementById('exportTopDetail').textContent=detail||'';const bar=exportTop.querySelector('[role="progressbar"]');if(progress==null){exportTop.classList.add('indeterminate');document.getElementById('exportTopEta').textContent='Preparando…';document.getElementById('exportTopPct').textContent='…';bar.removeAttribute('aria-valuenow');return;}exportTop.classList.remove('indeterminate');const p=Math.max(0,Math.min(1,progress)),pct=Math.round(p*100);exportTopFill.style.width=pct+'%';bar.setAttribute('aria-valuenow',String(pct));document.getElementById('exportTopPct').textContent=pct+'%';if(p>=.995)document.getElementById('exportTopEta').textContent='Finalizando…';else if(p<.025)document.getElementById('exportTopEta').textContent='Estimando…';else{const left=Math.max(1,(performance.now()-exportTopStartedAt)/1000*(1-p)/p);document.getElementById('exportTopEta').textContent='~ '+fmtTimeShort(left)+' restantes';}}
function finishTopExport(ok,message){if(exportTop.hidden)return;exportTop.classList.remove('indeterminate');if(ok){exportTopFill.style.width='100%';document.getElementById('exportTopPct').textContent='100%';document.getElementById('exportTopEta').textContent='Completado';}document.getElementById('exportTopTitle').textContent=ok?'¡Video listo!':'Exportación detenida';document.getElementById('exportTopDetail').textContent=message||(ok?'Tu archivo ya está listo para descargar.':'La exportación se interrumpió.');exportTopHideTimer=setTimeout(()=>{exportTop.hidden=true;},4200);}
document.getElementById('exportStart').addEventListener('click',async()=>{const modal=document.getElementById('exportModal'); const btn=document.getElementById('exportBtn'),stopBtn=document.getElementById('stopBtn'),status=document.getElementById('expStatus'),fill=document.getElementById('progFill');
  if(exportInProgress)return;
  if(!checkReady()){status.textContent='Carga audio y letra antes de exportar.';toast('Carga audio y letra antes de exportar.','error');updateExportDims();return;}
  const format=$('expFormat').value, originalSize=[canvas.width,canvas.height];
  if(format==='mp4'&&!requireProFeature('La exportación MP4')){$('expFormat').value='webm';updateExportDims();return;}
  const restoreCanvas=()=>{canvas.width=originalSize[0];canvas.height=originalSize[1];drawFrame(getCurrentTime());};
  if(format==='mp4'){
    if(!mp4ExportAvailable()){status.textContent='MP4 no está disponible con este navegador o audio. Elige WebM para grabar la vista previa.';toast('MP4 no está disponible con este navegador o audio. Elige WebM para grabar la vista previa.','error');updateExportDims();return;}
    const chosenFps=+$('expFps').value, chosenRes=+$('expRes').value, dims=exportDimensions(chosenRes);
    if(!mp4SupportMap[chosenRes]?.[chosenFps]){await updateExportDims();return;}
    exportInProgress=true;
    canvas.width=dims[0];canvas.height=dims[1];exportConfig={format,fps:chosenFps,res:chosenRes,originalSize};
    modal.hidden=true;
    if(await exportMp4(btn,stopBtn,status,fill)){exportInProgress=false;restoreCanvas();return;}
    exportInProgress=false;
    restoreCanvas();status.textContent='El navegador no admite esta combinación MP4. Prueba una resolución o FPS menor, o elige WebM.';modal.hidden=false;updateExportDims();return;
  }
  exportInProgress=true;exportConfig={format,fps:null,res:null,originalSize};modal.hidden=true;
  if(isPlaying) document.getElementById('playBtn').click(); // pause first
  audioEl.currentTime = 0;
  if(bgVideoEl){ bgVideoEl.currentTime = 0; }
  setControlsLocked(true);
  stopBtn.style.display = 'inline-flex';

  const stream = canvas.captureStream();
  // attach audio track via a MediaElementSource -> MediaStreamDestination
  if(!expCtx){ // createMediaElementSource solo se puede llamar UNA vez por <audio>
    expCtx = new (window.AudioContext||window.webkitAudioContext)();
    expSrc = expCtx.createMediaElementSource(audioEl);
    expSrc.connect(expCtx.destination);
  }
  await expCtx.resume();
  const dest = expCtx.createMediaStreamDestination();
  expSrc.connect(dest);
  dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));

  let mime = 'video/webm;codecs=vp9,opus';
  if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm;codecs=vp8,opus';
  if(!MediaRecorder.isTypeSupported(mime)) mime = 'video/webm';

  recordedChunks = [];
  mediaRecorder = new MediaRecorder(stream, {mimeType:mime, videoBitsPerSecond:exportBitrate(canvas.width,canvas.height,30)});
  mediaRecorder.ondataavailable = e=>{ if(e.data.size>0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = ()=>{
    const blob = new Blob(recordedChunks, {type:'video/webm'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'lyric-video.webm';
    a.className='dl';
    status.innerHTML = '';
    a.textContent = '✓ Descargar lyric-video.webm';
    status.appendChild(a);
    finishTopExport(!webmStoppedEarly,webmStoppedEarly?'Grabación detenida antes del final. El fragmento grabado ya está listo.':'Archivo WebM listo para descargar.');
    btn.disabled = false;
    btn.classList.remove('recording');
    btn.textContent = 'Exportar video';
    fill.style.width='100%';
    stopBtn.style.display = 'none';
    exportInProgress=false;
    setControlsLocked(false);
    try{ expSrc.disconnect(dest); }catch(e){}
    restoreCanvas();
  };

  btn.classList.add('recording');
  btn.textContent = 'Grabando…';
  status.textContent = 'Renderizando…';

  mediaRecorder.start();
  beginTopExport('Grabando WebM');
  updateTopExport(0,'Capturando audio y video');
  audioEl.play();
  if(bgVideoEl) bgVideoEl.play();
  isPlaying = true;
  loop();

  const duration = audioEl.duration;
  const timer = setInterval(()=>{
    const progress=Math.min(1,audioEl.currentTime/duration);fill.style.width = (progress*100) + '%';
    status.textContent = 'Renderizando… ' + fmtTimeShort(audioEl.currentTime) + ' / ' + fmtTimeShort(duration);
    updateTopExport(progress,'Tiempo procesado '+fmtTimeShort(audioEl.currentTime)+' / '+fmtTimeShort(duration));
  }, 200);

  let webmStoppedEarly=false;
  function stopHandler(){
    clearInterval(timer);
    webmStoppedEarly=audioEl.currentTime<duration-.25;
    if(mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    audioEl.pause();
    if(bgVideoEl) bgVideoEl.pause();
    isPlaying = false;
    audioEl.removeEventListener('ended', stopHandler);
  }
  audioEl.addEventListener('ended', stopHandler);
  document.getElementById('stopBtn').onclick = stopHandler;
});

// ================= FASE 1: proyecto, guardado, editor, historial =================
const $ = id => document.getElementById(id);
const controlsPanel=document.createElement('div');controlsPanel.className='controls-panel';controlsPanel.innerHTML='<h2>Controles y atajos</h2><p class="hint">Personaliza los atajos de teclado para esta computadora.</p><div id="hotkeyRows"></div><button class="btn-sm" id="hotkeyReset">Restablecer valores</button>';
const controlsModal=document.createElement('div');controlsModal.className='export-modal';controlsModal.id='controlsModal';controlsModal.hidden=true;controlsModal.innerHTML='<div class="export-box"><div id="controlsDialogHost"></div><div class="export-actions"><button class="btn-primary" id="hotkeyClose" type="button">Listo</button></div></div>';controlsModal.querySelector('#controlsDialogHost').append(controlsPanel);document.body.append(controlsModal);
const HOTKEY_ACTIONS=[['save','Guardar proyecto'],['undo','Deshacer'],['redo','Rehacer'],['play','Reproducir / pausar'],['tmMark','Sincronizar letra: marcar'],['tmUndo','Sincronizar letra: deshacer marca'],['tmEnd','Sincronizar letra: fin de línea'],['tmPlay','Sincronizar letra: reproducir / pausar']];
function renderHotkeys(){$('hotkeyRows').innerHTML=HOTKEY_ACTIONS.map(([id,label])=>'<div class="hotkey-row"><span>'+label+'</span><button class="btn-sm" data-hotkey="'+id+'">'+hotkeyLabel(hotkeys[id])+'</button></div>').join('');$('hotkeyRows').querySelectorAll('[data-hotkey]').forEach(b=>b.onclick=()=>captureHotkey(b.dataset.hotkey,b));}
function openControlsModal(){if(!requireProFeature('La personalización de controles'))return;renderHotkeys();$('controlsModal').hidden=false;}
function captureHotkey(id,button){button.textContent='Presiona una combinación…';const listener=e=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();document.removeEventListener('keydown',listener,true);renderHotkeys();return;}if(['Control','Shift','Alt','Meta'].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();const binding={code:e.code,ctrl:e.ctrlKey||e.metaKey,alt:e.altKey,shift:e.shiftKey};const conflict=Object.entries(hotkeys).find(([key,val])=>key!==id&&HK_TIMER.has(key)===HK_TIMER.has(id)&&val.code===binding.code&&!!val.ctrl===binding.ctrl&&!!val.alt===binding.alt&&!!val.shift===binding.shift);if(conflict){button.textContent='Ya asignado';document.removeEventListener('keydown',listener,true);setTimeout(renderHotkeys,900);return;}hotkeys[id]=binding;saveHotkeys();document.removeEventListener('keydown',listener,true);renderHotkeys();};document.addEventListener('keydown',listener,true);}
controlsPanel.querySelector('#hotkeyReset').onclick=()=>{hotkeys={...HOTKEY_DEFAULTS};saveHotkeys();renderHotkeys();};$('hotkeyClose').onclick=()=>$('controlsModal').hidden=true;$('controlsModal').addEventListener('click',e=>{if(e.target===$('controlsModal'))$('controlsModal').hidden=true;});
const S = {};                 // ajustes visuales: el render lee de aquí, no del DOM
const fileNames = {};         // nombres de archivos cargados (audio/imagen/video)
const undoStack = []; let hi = -1;
let customFontB64 = null, customFontLabel = '', customFace = null;
let loading = false, tChg = null, pendingRestore = false, lastIdx = -2, expCtx = null, expSrc = null;
const AUTOSAVE_KEY = 'lyricStudio.autosave';

function syncSettings(){ markFont();
  Object.assign(S,{ aspect, bgMode, posV, posH, wmCorner, inDur:+$('inDur').value, strokeW:+$('strokeW').value, strokeColor:$('strokeColor').value, glowAmt:+$('glowAmt').value, glowColor:$('glowColor').value, shAmt:+$('shAmt').value, shDist:+$('shDist').value, upper:$('upper').checked, bgFx:$('bgFx').value, bgFxAmt:+$('bgFxAmt').value, bgFxSpd:+$('bgFxSpd').value, bgDim:+$('bgDim').value, wmText:$('wmText').value, outAnim:$('outSelect').value,
    bgColor:$('bgColor').value, gradA:$('gradA').value, gradB:$('gradB').value,
    font:$('fontSelect').value, anim:$('animSelect').value, textColor:$('textColor').value, accent:$('accentColor').value,
    fontSize:+$('fontSize').value, posVCustom:+$('posVCustom').value, wmOpacity:+$('wmOpacity').value, wmType, wmSize,
    vignette:$('vignetteToggle').checked, accentMark:$('accentMarkToggle').checked,
    textBg:$('textBgToggle').checked, wordSync:$('wordSyncToggle').checked, watermark:featurePro?$('watermarkToggle').checked:true });
  syncWordSyncField(); pstMark();
}
function applySettings(o){
  const v=(id,x)=>{ if(x!==undefined) $(id).value=x; }, c=(id,x)=>{ if(x!==undefined) $(id).checked=x; };
  v('bgColor',o.bgColor); v('inDur',o.inDur); v('outSelect',o.outAnim); v('strokeW',o.strokeW); v('strokeColor',o.strokeColor); v('glowAmt',o.glowAmt); v('glowColor',o.glowColor); v('shAmt',o.shAmt); v('shDist',o.shDist); c('upper',o.upper); v('bgFx',o.bgFx); v('bgFxAmt',o.bgFxAmt); v('bgFxSpd',o.bgFxSpd); v('bgDim',o.bgDim); v('wmText',o.wmText); v('gradA',o.gradA); v('gradB',o.gradB); v('animSelect',canUseAnimation(o.anim)?o.anim:'slide'); v('textColor',o.textColor);
  v('accentColor',o.accent); v('fontSize',o.fontSize); v('posVCustom',o.posVCustom); v('wmOpacity',o.wmOpacity); wmType=o.wmType||'text'; wmSize=o.wmSize||wmDefaultSize(wmType);
  c('vignetteToggle',o.vignette); c('accentMarkToggle',o.accentMark); c('textBgToggle',o.textBg); c('wordSyncToggle',o.wordSync); c('watermarkToggle',o.watermark);
  if([...$('fontSelect').options].some(x=>x.value===o.font)&&canUseFont(o.font)) $('fontSelect').value=o.font;
  else if(o.font) $('fontSelect').value='Space Grotesk';
  const click=sel=>{ const b=document.querySelector(sel); if(b) b.click(); };
  if(o.aspect) click(`#aspectSeg [data-a="${o.aspect}"]`);
  if(o.bgMode) click(`.bgmode [data-bg="${o.bgMode}"]`);
  if(o.posV) click(`#posVSeg [data-pv="${o.posV}"]`);
  if(o.posH) click(`#posHSeg [data-ph="${o.posH}"]`);
  if(o.wmCorner) click(`#wmCornerSeg [data-c="${o.wmCorner}"]`);
  syncSettings();
}
function openWatermarkModal(){
  if(!featurePro){openWatermarkPreview();return;}
  $('wmModalEnabled').checked=$('watermarkToggle').checked;$('wmModalText').value=$('wmText').value||'LyricStudio.site';$('wmModalOpacity').value=$('wmOpacity').value||55;$('wmModalSize').value=wmSize;
  $('wmOpacityLabel').textContent=$('wmModalOpacity').value+'%';$('wmSizeLabel').textContent=wmSize+'% del ancho';
  document.querySelectorAll('.wm-types button').forEach(b=>b.classList.toggle('active',b.dataset.wmType===wmType));$('wmTextFields').hidden=wmType!=='text';$('wmAssetFields').hidden=wmType==='text';$('wmImageFile').hidden=wmType!=='image';$('wmVideoFile').hidden=wmType!=='video';
  document.querySelectorAll('#wmModalCorners button').forEach(b=>b.classList.toggle('active',b.dataset.c===wmCorner));$('wmModal').hidden=false;
}
function setWmType(type){if(!requireProFeature('La marca de agua personalizada'))return;wmType=type;if(type!=='text'&&wmSize<5){wmSize=12;$('wmModalSize').value=12;$('wmSizeLabel').textContent='12% del ancho';}else if(type==='text'&&wmSize>6){wmSize=2.2;$('wmModalSize').value=2.2;$('wmSizeLabel').textContent='2.2% del ancho';}document.querySelectorAll('.wm-types button').forEach(b=>b.classList.toggle('active',b.dataset.wmType===type));$('wmTextFields').hidden=type!=='text';$('wmAssetFields').hidden=type==='text';$('wmImageFile').hidden=type!=='image';$('wmVideoFile').hidden=type!=='video';redraw();}
$('wmConfigOpen').addEventListener('click',openWatermarkModal);$('wmModalCancel').addEventListener('click',()=>$('wmModal').hidden=true);$('wmModalDone').addEventListener('click',()=>$('wmModal').hidden=true);
$('wmModal').addEventListener('click',e=>{if(e.target===$('wmModal'))$('wmModal').hidden=true;});
$('wmModalEnabled').addEventListener('input',()=>{$('watermarkToggle').checked=$('wmModalEnabled').checked;$('watermarkToggle').dispatchEvent(new Event('input',{bubbles:true}));});
$('wmModalText').addEventListener('input',()=>{$('wmText').value=$('wmModalText').value;$('wmText').dispatchEvent(new Event('input',{bubbles:true}));});
$('wmModalOpacity').addEventListener('input',()=>{$('wmOpacity').value=$('wmModalOpacity').value;$('wmOpacityLabel').textContent=$('wmModalOpacity').value+'%';$('wmOpacity').dispatchEvent(new Event('input',{bubbles:true}));});
$('wmModalSize').addEventListener('input',()=>{wmSize=+$('wmModalSize').value;$('wmSizeLabel').textContent=wmSize+'% del ancho';redraw();});
document.querySelectorAll('.wm-types button').forEach(b=>b.addEventListener('click',()=>setWmType(b.dataset.wmType)));
$('wmModalCorners').addEventListener('click',e=>{const b=e.target.closest('button[data-c]');if(!b)return;wmCorner=b.dataset.c;document.querySelectorAll('#wmModalCorners button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('#wmCornerSeg button').forEach(x=>x.classList.toggle('active',x.dataset.c===wmCorner));redraw();});
$('wmChooseAsset').addEventListener('click',()=>$(wmType==='video'?'wmVideoFile':'wmImageFile').click());
function clearWmAsset(){if(wmAssetUrl)URL.revokeObjectURL(wmAssetUrl);wmAssetUrl='';wmAssetName='';wmImageEl=null;projectFiles.watermark=null;if(wmVideoEl){wmVideoEl.pause();wmVideoEl.removeAttribute('src');wmVideoEl.load();}wmVideoEl=null;$('wmAssetName').textContent='Sin archivo seleccionado';$('wmRemoveAsset').hidden=true;redraw();}
$('wmRemoveAsset').addEventListener('click',clearWmAsset);
$('wmImageFile').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;clearWmAsset();projectFiles.watermark=f;wmAssetUrl=URL.createObjectURL(f);const im=new Image();im.onload=()=>{wmImageEl=im;wmAssetName=f.name;$('wmAssetName').textContent=f.name;$('wmRemoveAsset').hidden=false;wmType='image';setWmType('image');};im.src=wmAssetUrl;e.target.value='';});
$('wmVideoFile').addEventListener('change',e=>{const f=e.target.files[0];if(!f)return;clearWmAsset();projectFiles.watermark=f;wmAssetUrl=URL.createObjectURL(f);const v=document.createElement('video');v.src=wmAssetUrl;v.muted=true;v.loop=true;v.playsInline=true;v.onloadeddata=()=>{wmVideoEl=v;wmAssetName=f.name;$('wmAssetName').textContent=f.name;$('wmRemoveAsset').hidden=false;wmType='video';setWmType('video');v.play().catch(()=>{});const paint=()=>{if(wmVideoEl!==v)return;if(!isPlaying)drawFrame(getCurrentTime());if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(paint);else setTimeout(paint,40);};if(v.requestVideoFrameCallback)v.requestVideoFrameCallback(paint);};e.target.value='';});
function redraw(){ syncSettings(); changed(); drawFrame(getCurrentTime()); }
const TOAST_ERR=/^(No pude|No se pudo|No hay|Carga |Falta |Necesitas|Pon el cursor|Pega algo|Elige una|La línea necesita|Escribe un nombre|Ya hay|Monitor .* desconectado|Error|El archivo)/i;
function toast(m,kind){
  $('projStatus').textContent=m;
  if(!kind&&TOAST_ERR.test(m)) kind='error';
  if(kind!=='error'&&kind!=='warn') return;
  let host=$('toastHost');
  if(!host){ host=document.createElement('div'); host.id='toastHost'; host.setAttribute('aria-live','assertive'); document.body.append(host); }
  while(host.children.length>=3) host.firstChild.remove();           // sin apilar avisos sin fin
  const el=document.createElement('div'); el.className='toast toast-'+kind; el.setAttribute('role',kind==='error'?'alert':'status');
  const txt=document.createElement('span'); txt.textContent=m;
  const x=document.createElement('button'); x.type='button'; x.setAttribute('aria-label','Cerrar aviso'); x.textContent='✕'; x.onclick=()=>el.remove();
  el.append(txt,x); host.append(el); setTimeout(()=>el.remove(),kind==='warn'?9000:6000);
}
// Karaoke solo luce bien con la letra marcada palabra por palabra: se avisa una sola vez.
function karaokeHint(animKey){
  if(!animKey||!FX[animKey]||!FX[animKey].k) return;
  try{ if(localStorage.getItem('lyricStudio.karaokeHint')) return; localStorage.setItem('lyricStudio.karaokeHint','1'); }catch(e){ if(window.__karaokeHinted) return; window.__karaokeHinted=true; }
  toast('Para que Karaoke sea preciso, marca la letra palabra por palabra (⏱ en cada línea → «Resincronizar por palabra»). Sin eso, los tiempos se estiman.','warn');
}
const esc = t => String(t??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

// tipografía propia (se guarda dentro del .lyr)
function bufToB64(buf){ let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000) s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000)); return btoa(s); }
function b64ToBuf(b){ const s=atob(b),u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return u.buffer; }
const LYRIC_PROJECT_MAGIC='LYRICPRJ', PROJECT_MEDIA_ORDER=['audio','image','video','watermark'];
function makeProjectBlob(){
  const p=getProject(),parts=[];
  for(const key of PROJECT_MEDIA_ORDER){const file=projectFiles[key];if(!file)continue;p.assets[key]={name:file.name,type:file.type||'application/octet-stream',size:file.size,embedded:true};parts.push(file);}
  const meta=new TextEncoder().encode(JSON.stringify(p)),header=new Uint8Array(12);
  for(let i=0;i<LYRIC_PROJECT_MAGIC.length;i++)header[i]=LYRIC_PROJECT_MAGIC.charCodeAt(i);
  new DataView(header.buffer).setUint32(8,meta.byteLength);
  return new Blob([header,meta,...parts],{type:'application/x-lyricstudio-project'});
}
async function readProjectFile(file){
  const head=new Uint8Array(await file.slice(0,12).arrayBuffer()),isPackage=head.length===12&&LYRIC_PROJECT_MAGIC.split('').every((c,i)=>head[i]===c.charCodeAt(0));
  if(!isPackage)return {project:JSON.parse(await file.text()),media:{}};
  const metaSize=new DataView(head.buffer,head.byteOffset,head.byteLength).getUint32(8),metaEnd=12+metaSize;
  if(metaEnd>file.size)throw new Error('El archivo de proyecto está incompleto.');
  const p=JSON.parse(await file.slice(12,metaEnd).text()),media={};let offset=metaEnd;
  for(const key of PROJECT_MEDIA_ORDER){const asset=p.assets&&p.assets[key];if(!asset||!asset.embedded)continue;const end=offset+Number(asset.size);if(!Number.isSafeInteger(end)||end>file.size)throw new Error('Falta un archivo multimedia dentro del proyecto.');media[key]=new File([file.slice(offset,end,asset.type)],asset.name||key,{type:asset.type||'application/octet-stream'});offset=end;}
  return {project:p,media};
}
function decodeProjectFile(asset){return asset&&asset.data?new File([b64ToBuf(asset.data)],asset.name||'asset',{type:asset.type||'application/octet-stream'}):null;}
async function registerCustomFont(buf,label){
  if(!canUseFont('CustomUserFont')){ openUpgradeForFeature(); return; }
  const ff=new FontFace('CustomUserFont',buf); await ff.load();
  if(customFace) document.fonts.delete(customFace);
  document.fonts.add(ff); customFace=ff;
  let opt=[...$('fontSelect').options].find(o=>o.value==='CustomUserFont');
  if(!opt){ opt=document.createElement('option'); opt.value='CustomUserFont'; $('fontSelect').appendChild(opt); }
  opt.textContent='Tu tipografía ('+label+')'; $('fontSelect').value='CustomUserFont'; buildFontList();
}

// proyecto
function getProject(){
  syncSettings();
  return { app:'lyric-studio', v:2, requiresPro:!!featurePro, name:$('projName').value.trim(), savedAt:new Date().toISOString(),
    vlocked:vlocked, lines:JSON.parse(JSON.stringify(lyricLines)), settings:{...S},
    workspace:{studyMode:!!studyMode,workstation:{...workstationSettings},guidesOn:!!document.querySelector('#center')?.classList.contains('guides-on'),playbackRate:+$('rate').value||1,loopOn:!!loopOn,tlStart:typeof tlStart==='number'?tlStart:0,pps:typeof pps==='number'?pps:50},
    assets:{ audio:fileNames.dropAudio||'', image:fileNames.dropImg||'', video:fileNames.dropVid||'', watermark:wmAssetName||'',
             font: customFontB64 ? {label:customFontLabel,data:customFontB64} : null } };
}
function projectRequiresPro(p){
  if(p.requiresPro===true)return true;
  const a=p.assets||{},s=p.settings||{};
  if(p.workspace&&(p.workspace.studyMode||p.workspace.guidesOn||p.workspace.workstation?.enabled))return true;
  if(a.font||a.watermark&&(typeof a.watermark==='object'||typeof a.watermark==='string'))return true;
  if(s.watermark===false||s.wmType&&s.wmType!=='text'||s.wmSize>2.2||s.wmText&&s.wmText!=='LyricStudio.site')return true;
  return (p.lines||[]).some(l=>l.kf?.length||l.ly||l.st);
}
async function loadProject(p,embeddedFiles={}){
  if(projectRequiresPro(p)&&!featurePro){const err=new Error('Este proyecto contiene funciones PRO. Inicia sesión con una cuenta PRO para abrirlo.');err.code='PRO_REQUIRED';throw err;}
  loading=true;
  try{
    const a=p.assets||{};
    if(a.font&&a.font.data&&canUseFont('CustomUserFont')){ await registerCustomFont(b64ToBuf(a.font.data),a.font.label||'tipografía'); customFontB64=a.font.data; customFontLabel=a.font.label||''; }
    const embeddedAudio=embeddedFiles.audio||decodeProjectFile(a.audio),embeddedImage=embeddedFiles.image||decodeProjectFile(a.image),embeddedVideo=embeddedFiles.video||decodeProjectFile(a.video),embeddedWm=embeddedFiles.watermark||decodeProjectFile(a.watermark);
    if(embeddedAudio){fileNames.dropAudio=embeddedAudio.name;useAudioFile(embeddedAudio);}
    if(embeddedImage){fileNames.dropImg=embeddedImage.name;useBackgroundImage(embeddedImage);}
    let videoReady=true;if(embeddedVideo){fileNames.dropVid=embeddedVideo.name;videoReady=await useBackgroundVideo(embeddedVideo);}
    if(embeddedWm){clearWmAsset();projectFiles.watermark=embeddedWm;wmAssetName=embeddedWm.name;wmAssetUrl=URL.createObjectURL(embeddedWm);$('wmAssetName').textContent=wmAssetName;$('wmRemoveAsset').hidden=false;if((p.settings||{}).wmType==='video'){const v=document.createElement('video');v.src=wmAssetUrl;v.muted=true;v.loop=true;v.playsInline=true;v.onloadeddata=()=>{wmVideoEl=v;v.play().catch(()=>{});};}else{const im=new Image();im.onload=()=>wmImageEl=im;im.src=wmAssetUrl;}}
    $('projName').value=p.name||'';
    lyricLines=(p.lines||[]).map(l=>({...l,start:+l.start,end:+l.end,text:String(l.text)})); sanitizeProLineStyles();
    applySettings({...DEF_VIDEO,...DEF_STYLE,...(p.settings||{})}); setMode((p.vlocked??(p.lines&&p.lines.length>0))?'lyrics':'video',(p.vlocked??(p.lines&&p.lines.length>0)));
    if(typeof a.audio==='string'&&a.audio&&!audioLoaded){ fileNames.dropAudio=a.audio; $('dropAudio').textContent='Falta el audio: '+a.audio+' (haz clic para cargarlo)'; $('audioInfo').textContent='El proyecto usa «'+a.audio+'». Vuelve a cargarlo.'; }
    if(typeof a.image==='string'&&a.image&&!bgImageEl){ fileNames.dropImg=a.image; $('dropImg').textContent='Falta la imagen: '+a.image; }
    if(typeof a.video==='string'&&a.video&&!bgVideoEl){ fileNames.dropVid=a.video; $('dropVid').textContent='Falta el video: '+a.video; }
    if(p.workspace){studyMode=!!p.workspace.studyMode;document.querySelector('#center')?.classList.toggle('study-on',studyMode);document.querySelector('#center')?.classList.toggle('guides-on',!!p.workspace.guidesOn);if(p.workspace.workstation){workstationSettings={...workstationSettings,...p.workspace.workstation};saveWorkstationSettings();}if(p.workspace.playbackRate){$('rate').value=p.workspace.playbackRate;audioEl.playbackRate=p.workspace.playbackRate;}if(typeof loopOn!=='undefined')loopOn=!!p.workspace.loopOn;if(typeof p.workspace.tlStart==='number')tlStart=p.workspace.tlStart;if(typeof p.workspace.pps==='number')pps=p.workspace.pps;}
    buildEditor(); checkReady(); drawFrame(getCurrentTime());return !videoReady;
  } finally { loading=false; }
}
function downloadBlob(blob,name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),2000); }
function projectLoadOverlay(message){let el=$('projectLoadOverlay');if(!el){el=document.createElement('div');el.id='projectLoadOverlay';el.style.cssText='position:fixed;inset:0;z-index:20000;background:'+TC('#08070d',0.91)+';display:grid;place-items:center;padding:20px';el.innerHTML='<div style="width:min(440px,92vw);padding:26px;border:1px solid '+TC('#69563a')+';border-radius:16px;background:'+TC('#17131d')+';box-shadow:0 24px 80px #000a;color:'+TC('#f4edf7')+';font:14px Inter,system-ui;text-align:center"><div style="font-size:20px;font-weight:700;margin-bottom:8px">Abriendo proyecto</div><div data-load-message style="color:'+TC('#c8bfcc')+';margin-bottom:18px"></div><div data-load-progress style="height:7px;border-radius:99px;background:'+TC('#312a36')+';overflow:hidden"><div style="height:100%;width:38%;border-radius:99px;background:linear-gradient(90deg,'+TC('#bd8739')+','+TC('#ffe29a')+','+TC('#bd8739')+');animation:projectLoadMove 1.2s ease-in-out infinite alternate"></div></div><div data-load-hint style="color:'+TC('#89808e')+';font-size:12px;margin-top:12px">Los proyectos con videos pesados pueden tardar según el equipo.</div><button data-load-close style="display:none;margin:18px auto 0;padding:9px 22px;border:1px solid '+TC('#806b4b')+';border-radius:8px;background:'+TC('#302537')+';color:#fff;cursor:pointer">Cerrar</button></div><style>@keyframes projectLoadMove{from{transform:translateX(-15%)}to{transform:translateX(190%)}}</style>';el.querySelector('[data-load-close]').onclick=hideProjectLoadOverlay;document.body.appendChild(el);}el.querySelector('[data-load-message]').textContent=message;el.querySelector('[data-load-progress]').style.display='block';el.querySelector('[data-load-hint]').style.display='block';el.querySelector('[data-load-close]').style.display='none';el.style.display='grid';}
function projectLoadMessage(message){const el=$('projectLoadOverlay');if(el)el.querySelector('[data-load-message]').textContent=message;}
function projectLoadError(message){const el=$('projectLoadOverlay');if(!el)return;el.querySelector('[data-load-message]').textContent=message;el.querySelector('[data-load-progress]').style.display='none';el.querySelector('[data-load-hint]').style.display='none';el.querySelector('[data-load-close]').style.display='block';}
function hideProjectLoadOverlay(){const el=$('projectLoadOverlay');if(el)el.style.display='none';}
function saveWorkstationSettings(){try{localStorage.setItem('lyricStudio.workstation',JSON.stringify(workstationSettings));}catch(e){}}
function ensureWorkstationModal(){
  if($('workstationModal'))return $('workstationModal');
  const modal=document.createElement('div');modal.id='workstationModal';modal.className='ws-modal';modal.hidden=true;modal.innerHTML='<section class="ws-box" role="dialog" aria-modal="true" aria-labelledby="wsTitle"><h2 id="wsTitle">Configurar WorkStation</h2><p>La ventana principal queda para editar y usar la timeline. La ventana de salida muestra información de la línea y una vista previa grande en el otro monitor.</p><div class="ws-screen-fields"><label>Monitor principal · edición<select id="wsMainScreen"></select></label><label>Monitor secundario · vista previa<select id="wsOutputScreen"></select></label></div><div id="wsScreenStatus">Detecta las pantallas para asignar cada monitor.</div><div class="ws-actions"><button class="btn-sm" type="button" data-ws-close>Cerrar</button><button class="btn-sm" type="button" data-ws-detect>Detectar monitores</button><button class="btn-primary" type="button" data-ws-start>Abrir WorkStation</button></div></section>';
  document.body.appendChild(modal);modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-ws-close]'))modal.hidden=true;});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)modal.hidden=true;});
  modal.querySelector('[data-ws-detect]').onclick=()=>detectWorkstationScreens();modal.querySelector('[data-ws-start]').onclick=()=>launchWorkstation();
  ['wsMainScreen','wsOutputScreen'].forEach(id=>$(id).addEventListener('change',()=>{workstationSettings.mainScreen=+$('wsMainScreen').value;workstationSettings.outputScreen=+$('wsOutputScreen').value;saveWorkstationSettings();}));
  return modal;
}
function populateWorkstationScreens(screens){
  const names=screens.map((s,i)=>`Pantalla ${i+1}${s.isPrimary?' · principal':''} · ${s.availWidth} × ${s.availHeight}`);
  for(const [id,key] of [['wsMainScreen','mainScreen'],['wsOutputScreen','outputScreen']]){const select=$(id);select.innerHTML=names.map((n,i)=>`<option value="${i}">${esc(n)}</option>`).join('');if(screens.length>1&&id==='wsOutputScreen'&&workstationSettings.outputScreen===0)workstationSettings.outputScreen=1;select.value=String(Math.min(screens.length-1,Math.max(0,workstationSettings[key]||0)));}
  workstationSettings.mainScreen=+$('wsMainScreen').value||0;workstationSettings.outputScreen=+$('wsOutputScreen').value||0;saveWorkstationSettings();
}
async function detectWorkstationScreens(){
  const status=$('wsScreenStatus');if(!window.getScreenDetails){status.textContent='Este navegador no permite detectar pantallas. Puedes abrir la vista y arrastrar su ventana al segundo monitor.';return null;}
  status.textContent='Esperando permiso para consultar las pantallas…';
  try{workstationScreenDetails=await window.getScreenDetails();populateWorkstationScreens(workstationScreenDetails.screens);status.textContent=workstationScreenDetails.screens.length>1?'Pantallas detectadas. Elige dónde va cada vista.':'Solo se detectó una pantalla; conecta la segunda o usa la ventana manualmente.';return workstationScreenDetails.screens;}
  catch(err){status.textContent='No se pudieron consultar las pantallas. La vista secundaria se puede mover manualmente.';return null;}
}
function openWorkstationSettings(){if(!requireProFeature('El modo WorkStation'))return;const modal=ensureWorkstationModal();modal.hidden=false;if(!window.getScreenDetails){$('wsScreenStatus').textContent='Este navegador no ofrece detección de pantallas. La ventana de salida se puede arrastrar al monitor secundario.';return;}if(!workstationScreenDetails)$('wsScreenStatus').textContent='Pulsa “Detectar monitores” para elegir las pantallas.';else populateWorkstationScreens(workstationScreenDetails.screens);}
function workstationDocument(){return '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lyric Studio · Monitor de salida</title><style>*{box-sizing:border-box}body{margin:0;background:'+TC('#09070c')+';color:'+TC('#f6f1f7')+';font:14px system-ui;min-height:100vh;display:grid;grid-template-rows:auto 1fr}header{display:flex;align-items:center;gap:16px;padding:12px 18px;background:'+TC('#17121d')+';border-bottom:1px solid '+TC('#ffffff',0.13)+'}.brand{font-weight:750;letter-spacing:.02em}.time{font:600 14px ui-monospace,monospace;color:'+TC('#e8b45f')+'}.line{flex:1;min-width:0;color:'+TC('#eee7f0')+';white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.close{border:1px solid '+TC('#ffffff',0.16)+';border-radius:8px;background:'+TC('#241c29')+';color:#eee;padding:8px 12px;cursor:pointer}.area{min-height:0;display:grid;grid-template-columns:minmax(190px,260px) 1fr;gap:14px;padding:14px}.info{padding:18px;border:1px solid '+TC('#ffffff',0.09)+';border-radius:12px;background:'+TC('#17121d')+'}.info small{display:block;color:'+TC('#a79baa')+';text-transform:uppercase;letter-spacing:.12em;font-size:10px;margin:4px 0 8px}.info strong{display:block;font-size:16px;overflow-wrap:anywhere}.preview{position:relative;display:grid;place-items:center;min-width:0;min-height:0;overflow:hidden;border:1px solid '+TC('#ffffff',0.09)+';border-radius:12px;background:'+TC('#17121d')+'}.preview canvas{position:absolute;width:100%;height:100%;object-fit:contain}.preview canvas#backdrop{object-fit:cover;filter:blur(26px) brightness(.42);transform:scale(1.08)}.preview canvas#out{z-index:1}.hint{position:absolute;z-index:2;right:12px;bottom:10px;color:'+TC('#ffffff',0.57)+';font-size:11px}.bar{height:6px;border-radius:99px;background:'+TC('#ffffff',0.12)+';overflow:hidden}.bar i{display:block;height:100%;width:0;background:'+TC('#e8b45f')+'}.fsgate{position:fixed;inset:0;z-index:10;display:grid;place-items:center;background:'+TC('#09070c',0.88)+';color:'+TC('#f6f1f7')+';font:600 20px system-ui;cursor:pointer;text-align:center;padding:24px}.fsgate[hidden]{display:none}@media(max-width:700px){.area{grid-template-columns:1fr;grid-template-rows:auto 1fr}.info{padding:10px}.info small{display:inline;margin-right:8px}}</style><header><span class="brand">LYRIC STUDIO · WORKSTATION</span><span class="time" id="time">00:00</span><span class="line" id="line">Listo para reproducir</span><button class="close" id="fsBtn">Pantalla completa</button><button class="close" onclick="window.close()">Cerrar monitor</button></header><main class="area"><aside class="info"><small>Proyecto</small><strong id="project">Lyric Studio</strong><small style="margin-top:22px">Línea actual</small><strong id="verse">—</strong><small style="margin-top:22px">Estado</small><strong id="status">Vista de salida conectada</strong><small style="margin-top:22px">Progreso</small><div class="bar"><i id="bar"></i></div><strong id="prog" style="margin-top:6px">00:00 / 00:00</strong><small style="margin-top:22px">Línea</small><strong id="idx">— / —</strong><small style="margin-top:22px">Siguiente línea</small><strong id="next">—</strong><small style="margin-top:22px">Salida</small><strong id="fmt">—</strong></aside><section class="preview"><canvas id="backdrop"></canvas><canvas id="out"></canvas><span class="hint">VISTA PREVIA · SALIDA</span></section></main><div class="fsgate" id="fsGate" hidden>Haz clic aquí para poner este monitor en pantalla completa</div></html>';}
async function launchWorkstation(){
  if(!requireProFeature('El modo WorkStation'))return;
  const win=window.open('about:blank','lyricstudio-workstation','popup=yes,width=1200,height=850');if(!win){$('wsScreenStatus').textContent='El navegador bloqueó la ventana. Permite ventanas emergentes para Lyric Studio e intenta de nuevo.';return;}
  workstationWindow=win;win.document.open();win.document.write(workstationDocument());win.document.close();$('workstationModal').hidden=true;
  win.addEventListener('beforeunload',()=>{try{if(window.opener)window.opener.postMessage({type:'lyricstudio-workstation-close'},'*');}catch(e){}});
  if(!workstationMessageBound){window.addEventListener('message',e=>{if(e.source===workstationWindow&&e.data?.type==='lyricstudio-workstation-close'){workstationWindow=null;toast('Monitor WorkStation desconectado.');}});workstationMessageBound=true;}
  if(studyMode){studyMode=false;document.querySelector('#center')?.classList.remove('study-on');$('studyToggle')?.classList.remove('on');if($('studyToggle'))$('studyToggle').textContent='Modo Estudio';}
  if(window.getScreenDetails){const screens=await detectWorkstationScreens();if(screens?.length){const main=screens[workstationSettings.mainScreen]||screens.find(s=>s.isPrimary)||screens[0],out=screens[workstationSettings.outputScreen]||screens.find(s=>!s.isPrimary)||screens[0];try{window.moveTo(main.availLeft+8,main.availTop+8);win.moveTo(out.availLeft+8,out.availTop+8);win.resizeTo(out.availWidth-16,out.availHeight-16);}catch(e){}
    workstationFullscreen(win,main,screens.length>1);}}
  workstationFullscreen(win,null,false);   // si no se detectaron pantallas, igual deja el botón y la tecla F
  if(!window.getScreenDetails)toast('WorkStation abierto. Arrastra la ventana de salida al segundo monitor.');else toast('WorkStation activo en las pantallas configuradas.');
  drawFrame(getCurrentTime());
}
// Pantalla completa en cada monitor configurado.
// Monitor principal: requestFullscreen({screen}) (API de gestión de ventanas).
// Monitor de salida: el navegador exige un gesto del usuario dentro de esa ventana, así que se intenta
// automáticamente y, si no se permite, aparece un aviso grande para hacer clic (o tecla F).
function workstationFullscreen(win,mainScreen,multi){
  if(win.__fsWired) return; win.__fsWired=true;
  const d=win.document,gate=d.getElementById('fsGate'),btn=d.getElementById('fsBtn'),root=d.documentElement;
  const toggle=()=>{ if(d.fullscreenElement) d.exitFullscreen?.(); else root.requestFullscreen?.().catch(()=>{}); };
  if(btn) btn.onclick=toggle;
  d.addEventListener('keydown',e=>{ if(e.key==='f'||e.key==='F') toggle(); });
  d.addEventListener('fullscreenchange',()=>{ if(gate) gate.hidden=!!d.fullscreenElement; });
  if(gate) gate.onclick=()=>{ root.requestFullscreen?.().catch(()=>{}); gate.hidden=true; };
  if(multi&&root.requestFullscreen){
    try{ Promise.resolve(root.requestFullscreen()).catch(()=>{ if(gate) gate.hidden=false; }); }catch(e){ if(gate) gate.hidden=false; }
  }else if(gate&&root.requestFullscreen) gate.hidden=false;
  if(multi&&mainScreen&&!document.fullscreenElement){
    try{ Promise.resolve(document.documentElement.requestFullscreen({screen:mainScreen})).catch(()=>{}); }catch(e){}
  }
}
let workstationMessageBound=false;
function syncWorkstationPreview(t){if(!workstationWindow||workstationWindow.closed){workstationWindow=null;return;}try{const d=workstationWindow.document,out=d.getElementById('out'),back=d.getElementById('backdrop');if(!out||!back)return;for(const target of [out,back])if(target.width!==canvas.width||target.height!==canvas.height){target.width=canvas.width;target.height=canvas.height;}out.getContext('2d').drawImage(canvas,0,0);back.getContext('2d').drawImage(canvas,0,0);d.getElementById('time').textContent=fmtTime(t);d.getElementById('project').textContent=$('projName').value.trim()||'Lyric Studio';const current=activeLines(t),verse=current.map(l=>l.text).join(' · ');d.getElementById('verse').textContent=verse||'—';d.getElementById('line').textContent=verse||'Listo para reproducir';d.getElementById('status').textContent=isPlaying?'Reproduciendo':'En pausa';
    const total=tlDur(),idx=current.length?lyricLines.indexOf(current[0])+1:0,nx=lyricLines.filter(l=>l.start>t).sort((a,b)=>a.start-b.start)[0];
    d.getElementById('bar').style.width=(total>0?Math.min(100,t/total*100):0)+'%';
    d.getElementById('prog').textContent=fmtTime(t)+' / '+fmtTime(total)+' · quedan '+fmtTime(Math.max(0,total-t));
    d.getElementById('idx').textContent=(idx||'—')+' / '+lyricLines.length;
    d.getElementById('next').textContent=nx?nx.text+'  (en '+Math.max(0,nx.start-t).toFixed(1)+' s)':'—';
    d.getElementById('fmt').textContent=aspect+' · '+canvas.width+' × '+canvas.height+' px';
  }catch(e){workstationWindow=null;}}
const safeName = () => ($('projName').value.trim()||'proyecto').replace(/[\\/:*?"<>|]+/g,'-');
$('saveBtn').onclick=()=>{const name=safeName()+'.lyr';try{toast('Preparando el proyecto…');downloadBlob(makeProjectBlob(),name);toast('Guardado con configuraciones y medios: '+name);}catch(err){console.error(err);toast('No pude guardar el proyecto. Revisa el espacio disponible y vuelve a intentar.');}};
$('openBtn').onclick=()=>$('projFile').click();
$('projFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; if(!f) return;
  let opened=false;projectLoadOverlay('Leyendo el proyecto…');
  try{ const {project:p,media}=await readProjectFile(f); if(p.app!=='lyric-studio'||!Array.isArray(p.lines)) throw 0;
    projectLoadMessage(media.video?'Preparando el video de fondo…':'Restaurando ajustes y líneas…');const videoWarning=await loadProject(p,media);commit();autosave();toast(videoWarning?'Proyecto abierto, pero el navegador no pudo preparar el video. Prueba con MP4 o WebM.':'Abierto: '+f.name);enterEditor();opened=true;
  }catch(err){const message=err?.code==='PRO_REQUIRED'?err.message:err?.message||'Ese archivo no es un proyecto de Lyric Studio.';toast(message);projectLoadError(message);}
  finally{if(opened)hideProjectLoadOverlay();e.target.value='';}
});
$('projName').addEventListener('input',changed);

// historial + autoguardado
function snapshot(){ const p=getProject(); return JSON.stringify({lines:p.lines,settings:p.settings}); }
function updateUndoBtns(){ $('undoBtn').disabled=hi<=0; $('redoBtn').disabled=hi>=undoStack.length-1; }
function commit(){ const x=snapshot(); if(x===undoStack[hi]) return; undoStack.splice(hi+1); undoStack.push(x); if(undoStack.length>100) undoStack.shift(); hi=undoStack.length-1; updateUndoBtns(); }
function loadSnapshot(str){
  const o=JSON.parse(str); loading=true;
  try{ lyricLines=o.lines.map(l=>({...l}));if(!featurePro)sanitizeProLineStyles();applySettings(o.settings); buildEditor(); checkReady(); drawFrame(getCurrentTime()); } finally{ loading=false; }
  updateUndoBtns(); autosave();
}
function undo(){ clearTimeout(tChg); commit(); if(hi>0){ hi--; loadSnapshot(undoStack[hi]); } }
function redo(){ if(hi<undoStack.length-1){ hi++; loadSnapshot(undoStack[hi]); } }
$('undoBtn').onclick=undo; $('redoBtn').onclick=redo;
function changed(){ if(loading) return; clearTimeout(tChg); tChg=setTimeout(()=>{ commit(); autosave(); },500); }
function autosave(){
  if(pendingRestore){ toast('Autoguardado en pausa: elige Restaurar o Descartar arriba.'); return; }
  try{ localStorage.setItem(AUTOSAVE_KEY,JSON.stringify(getProject())); toast('Autoguardado '+new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})); }
  catch(e){ toast('No pude autoguardar: guarda el .lyr a mano.'); }
}
const HOTKEY_KEY='lyricStudio.hotkeys';
const HK_TIMER=new Set(['tmMark','tmUndo','tmEnd','tmPlay']);   // la sincronización es otro contexto: no choca con los atajos del editor
const HOTKEY_DEFAULTS={save:{code:'KeyS',ctrl:true},undo:{code:'KeyZ',ctrl:true},redo:{code:'KeyY',ctrl:true},play:{code:'Space'},tmMark:{code:'Space'},tmUndo:{code:'ArrowLeft'},tmEnd:{code:'KeyF'},tmPlay:{code:'KeyP'}};
let hotkeys={...HOTKEY_DEFAULTS};try{hotkeys={...HOTKEY_DEFAULTS,...JSON.parse(localStorage.getItem(HOTKEY_KEY)||'{}')};}catch(e){}
delete hotkeys.mark; delete hotkeys.back;   // atajos del sincronizador viejo
const hotkeyLabel=b=>(b.ctrl?'Ctrl+':'')+(b.alt?'Alt+':'')+(b.shift?'Shift+':'')+({Space:'Espacio',Enter:'Enter',Backspace:'Retroceso',ArrowLeft:'←',ArrowRight:'→',ArrowDown:'↓',ArrowUp:'↑'}[b.code]||b.code.replace(/^Key/,'').replace(/^Digit/,''));
function matchesHotkey(e,id){const b=hotkeys[id];return !!b&&e.code===b.code&&!!e.ctrlKey===!!b.ctrl&&!!e.altKey===!!b.alt&&!!e.shiftKey===!!b.shift;}
function saveHotkeys(){try{localStorage.setItem(HOTKEY_KEY,JSON.stringify(hotkeys));}catch(e){}}

document.addEventListener('keydown',e=>{
  if(matchesHotkey(e,'save')){e.preventDefault();$('saveBtn').click();return;}
  if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if(matchesHotkey(e,'undo')){e.preventDefault();undo();}else if(matchesHotkey(e,'redo')){e.preventDefault();redo();}
});

// editor de líneas
function parseTime(x){ x=String(x).trim().replace(',','.'); const m=x.match(/^(\d+):(\d+(?:\.\d+)?)$/); if(m) return +m[1]*60+parseFloat(m[2]); const n=parseFloat(x); return isNaN(n)?null:Math.max(0,n); }
function plainToLines(text){
  const rows=text.split(/\r?\n/).map(t=>t.trim()).filter(Boolean); if(!rows.length) return [];
  const total=(audioLoaded&&audioEl.duration)?audioEl.duration:rows.length*4, step=total/rows.length;
  return rows.map((t,i)=>({start:i*step,end:(i+1)*step,text:t}));
}
function buildEditor(){
  const box=$('lyricsLog'); lastIdx=-2; queueMicrotask(markSel);
  if(!lyricLines.length){ box.innerHTML='<div class="empty">Todavía no hay líneas. Sube un archivo .lrc o .srt, pega la letra en el panel de arriba o usa “+ Agregar línea”.</div>'; return; }
  box.innerHTML=lyricLines.map((l,i)=>`<div class="lrow" data-i="${i}">
    <input type="text" class="tm" data-f="start" value="${fmtTime(l.start)}" aria-label="Inicio">
    <input type="text" class="tm" data-f="end" value="${fmtTime(l.end)}" aria-label="Fin">
    <input type="text" data-f="text" value="${esc(l.text)}" aria-label="Texto de la línea">
    <div class="ops"><button data-op="go" title="Ir a esta línea">▶</button><button data-op="retime" title="Resincronizar esta línea">⏱</button><button data-op="kf" class="${featurePro?'':'pro-locked'}" title="Keyframes: movimiento del texto · PRO">◇</button><button data-op="advanced" class="${featurePro?'':'pro-locked'}" title="Opciones avanzadas de la línea · PRO" aria-label="Opciones avanzadas de la línea PRO">${featurePro?'⚙':'🔒'}</button><button data-op="add" title="Agregar línea debajo">+</button><button data-op="del" title="Borrar línea">✕</button></div></div><div class="advrow" data-adv-row="${i}" hidden></div>`).join('');
  $('lyricsInfo').textContent=lyricLines.length+' líneas en el proyecto.';
}
function advancedMarkup(i){
  const l=lyricLines[i],words=wordsOf(l.text),starts=wordTimes(l,words.length).map(x=>x[0]);
  const wordRows=words.map((word,j)=>`<div class="adv-word"><span>${j+1}. ${esc(word)}</span><input type="number" min="${l.start}" max="${l.end}" step="0.01" value="${(starts[j]||l.start).toFixed(2)}" data-word-time="${j}" aria-label="Inicio de ${esc(word)}"><button class="btn-sm" data-adv-op="stamp-word" data-word="${j}" title="Fijar al tiempo actual">● Fijar aquí</button></div>`).join('');
  return `<div class="adv-panel"><div class="adv-head"><span>Opciones avanzadas · línea ${i+1}</span><button class="btn-sm" data-adv-op="close">Cerrar</button></div>
    <div class="adv-tools"><b>Tiempo</b><input type="number" step="0.01" value="${l.start.toFixed(2)}" data-line-time="start" aria-label="Inicio en segundos"><button class="btn-sm" data-adv-op="nudge-start" data-delta="-0.05">−0.05</button><button class="btn-sm" data-adv-op="nudge-start" data-delta="0.05">+0.05</button>
    <input type="number" step="0.01" value="${l.end.toFixed(2)}" data-line-time="end" aria-label="Fin en segundos"><button class="btn-sm" data-adv-op="nudge-end" data-delta="-0.05">−0.05</button><button class="btn-sm" data-adv-op="nudge-end" data-delta="0.05">+0.05</button></div>
    <div class="adv-section"><h4>Sincronización para animaciones por palabra</h4><div class="adv-tools" style="margin-bottom:7px"><button class="btn-sm" data-adv-op="retime-words" title="Abre la pantalla de sincronización solo con esta línea, palabra por palabra">⏱ Resincronizar por palabra</button><button class="btn-sm" data-adv-op="distribute-words">Repartir tiempos</button><span class="dim">Estos tiempos controlan karaoke y entradas por palabra.</span></div><div class="adv-words">${wordRows||'<span class="dim">Escribe la línea para editar sus palabras.</span>'}</div></div>
    <div class="adv-section"><h4>Movimiento con keyframes</h4><div class="adv-tools"><button class="btn-primary" data-adv-op="edit-kf">Abrir editor de movimiento</button><span class="dim">Define cómo se mueve el texto durante la línea.</span></div></div></div>`;
}
function refreshAdvanced(i){if(!requireProFeature('Las opciones avanzadas por línea'))return;const panel=document.querySelector(`.advrow[data-adv-row="${i}"]`);if(panel){panel.innerHTML=advancedMarkup(i);panel.hidden=false;} }
function keyframeState(l,t){
  const frames=(l.kf||[]).slice().filter(f=>Number.isFinite(+f.t)).sort((a,b)=>a.t-b.t),base={x:0,y:0,scale:1,rot:0,opacity:1};
  if(!frames.length) return base;
  const u=clamp01((t-l.start)/Math.max(.01,l.end-l.start));
  const val=(f,k,d)=>Number.isFinite(+f[k])?+f[k]:d;
  if(u<=frames[0].t) return {x:val(frames[0],'x',0),y:val(frames[0],'y',0),scale:val(frames[0],'scale',1),rot:val(frames[0],'rot',0),opacity:val(frames[0],'opacity',1)};
  if(u>=frames[frames.length-1].t){const f=frames[frames.length-1];return {x:val(f,'x',0),y:val(f,'y',0),scale:val(f,'scale',1),rot:val(f,'rot',0),opacity:val(f,'opacity',1)};}
  let a=frames[0],b=frames[1];for(let i=1;i<frames.length;i++)if(u<=frames[i].t){a=frames[i-1];b=frames[i];break;}
  const q=clamp01((u-a.t)/Math.max(.0001,b.t-a.t));
  return {x:lerp(val(a,'x',0),val(b,'x',0),q),y:lerp(val(a,'y',0),val(b,'y',0),q),scale:lerp(val(a,'scale',1),val(b,'scale',1),q),rot:lerp(val(a,'rot',0),val(b,'rot',0),q),opacity:lerp(val(a,'opacity',1),val(b,'opacity',1),q)};
}
let kfEditor=null;
const KF_PRESETS=[
  {id:'up',n:'⬆ Sube',f:[{t:0,y:12,opacity:0},{t:.2,y:0},{t:1,y:-6}]},
  {id:'down',n:'⬇ Baja',f:[{t:0,y:-12,opacity:0},{t:.2,y:0},{t:1,y:6}]},
  {id:'zin',n:'🔍 Acercar',f:[{t:0,scale:.8,opacity:0},{t:.2,scale:1},{t:1,scale:1.12}]},
  {id:'zout',n:'🔎 Alejar',f:[{t:0,scale:1.3,opacity:0},{t:.2,scale:1},{t:1,scale:.94}]},
  {id:'left',n:'➡ Desde la izquierda',f:[{t:0,x:-32,opacity:0},{t:.22,x:0}]},
  {id:'right',n:'⬅ Desde la derecha',f:[{t:0,x:32,opacity:0},{t:.22,x:0}]},
  {id:'beat',n:'💓 Latido',f:[{t:0},{t:.25,scale:1.12},{t:.5},{t:.75,scale:1.12},{t:1}]},
  {id:'sway',n:'〰 Balanceo',f:[{t:0,rot:-4},{t:.5,rot:4},{t:1,rot:-4}]},
  {id:'clear',n:'✕ Quitar movimiento',f:[]}
];
function syncWordSyncField(){
  const f=document.getElementById('wordSyncField');if(!f)return;let show=false;
  try{show=FX[S.anim]?.u==='word'||lyricLines.some(l=>FX[l.st?.anim]?.u==='word');}catch(e){}
  f.style.display=show?'':'none';
}
function openKeyframeEditor(i){
  if(!featurePro){openKeyframePreview(i);return;}
  const l=lyricLines[i];if(l.kf)l.kf.sort((a,b)=>a.t-b.t);kfEditor={i,u:0,selected:null,drag:null};kfView='edit';if(isPlaying)$('playBtn').click();
  const modal=document.createElement('div');modal.className='kf-modal';modal.id='kfModal';
  modal.innerHTML=`<div class="kf-window" role="dialog" aria-modal="true" aria-label="Editor visual de keyframes">
    <div class="adv-head"><span>Movimiento · ${esc(l.text||'Línea sin texto')}</span><button class="btn-sm" data-kf-close>Cerrar</button></div>
    <div class="kf-stage" id="kfStage"><canvas id="kfView"></canvas></div>
    <div class="kf-presets"><span class="dim">Movimientos listos:</span>${KF_PRESETS.map(p=>`<button class="btn-sm" data-kf-preset="${p.id}">${p.n}</button>`).join('')}</div>
    <div class="kf-track-wrap"><div class="adv-head"><span>Vida del texto</span><span class="dim" id="kfTime"></span></div><div class="kf-track" id="kfTrack"><div class="kf-playhead" id="kfPlayhead"></div><div id="kfMarkers"></div></div>
      <input type="range" id="kfScrub" min="0" max="1000" value="0" aria-label="Cursor en la vida de la línea"></div>
    <div class="kf-controls">
      <label>X · %<input type="range" min="-45" max="45" step="0.1" data-kf-edit="x"></label>
      <label>Y · %<input type="range" min="-45" max="45" step="0.1" data-kf-edit="y"></label>
      <label>Escala · %<input type="range" min="10" max="300" step="1" data-kf-edit="scale"></label>
      <label>Rotación · °<input type="range" min="-180" max="180" step="1" data-kf-edit="rot"></label>
      <label>Opacidad · %<input type="range" min="0" max="100" step="1" data-kf-edit="opacity"></label>
    </div>
    <div class="kf-modal-actions"><span class="dim">Mueve el cursor por la línea de tiempo, agrega un keyframe y acomoda el texto arrastrándolo sobre el fondo o con los controles. La línea punteada muestra el recorrido.</span><div class="adv-tools"><button class="btn-primary" data-kf-play>▶ Previsualizar</button><button class="btn-sm" data-kf-add>＋ Keyframe en este instante</button><button class="btn-sm danger" data-kf-delete disabled>Quitar keyframe</button></div></div>
  </div>`;
  document.body.append(modal);
  const track=modal.querySelector('#kfTrack'),stage=modal.querySelector('#kfStage'),kv=modal.querySelector('#kfView');
  stage.style.setProperty('--ar',canvas.width/canvas.height);kv.width=Math.min(canvas.width,540);kv.height=Math.round(kv.width*canvas.height/canvas.width);
  modal.querySelector('[data-kf-close]').onclick=closeKf;
  modal.addEventListener('click',e=>{if(e.target===modal)closeKf();});
  modal.querySelector('#kfScrub').oninput=e=>{kfEditor.u=+e.target.value/1000;kfEditor.selected=(l.kf||[]).find(f=>Math.abs(f.t-kfEditor.u)<.004)||null;syncKeyframeModal();};
  modal.querySelector('[data-kf-add]').onclick=()=>{
    const time=l.start+kfEditor.u*Math.max(.01,l.end-l.start),pose=keyframeState(l,time);l.kf=l.kf||[];
    let f=l.kf.find(x=>Math.abs(x.t-kfEditor.u)<.004);
    if(!f){f={...pose,t:kfEditor.u};l.kf.push(f);}kfEditor.selected=f;l.kf.sort((a,b)=>a.t-b.t);syncKeyframeModal();redraw();
  };
  modal.querySelector('[data-kf-delete]').onclick=()=>{if(!kfEditor.selected)return;l.kf=l.kf.filter(f=>f!==kfEditor.selected);if(!l.kf.length)delete l.kf;kfEditor.selected=null;syncKeyframeModal();redraw();};
  modal.querySelectorAll('[data-kf-edit]').forEach(input=>input.addEventListener('input',()=>{
    if(!kfEditor.selected)modal.querySelector('[data-kf-add]').click();
    if(!kfEditor.selected)return;
    const prop=input.dataset.kfEdit,value=+input.value;
    kfEditor.selected[prop]=prop==='scale'?value/100:prop==='opacity'?value/100:value;
    syncKeyframeModal();redraw();
  }));
  const setFromX=x=>{const r=track.getBoundingClientRect();kfEditor.u=clamp01((x-r.left)/r.width);kfEditor.selected=(l.kf||[]).find(f=>Math.abs(f.t-kfEditor.u)<.025)||null;syncKeyframeModal();};
  track.addEventListener('pointerdown',e=>{
    const marker=e.target.closest('[data-kf-index]');track.setPointerCapture(e.pointerId);
    if(marker){kfEditor.drag=l.kf[+marker.dataset.kfIndex];kfEditor.selected=kfEditor.drag;kfEditor.u=kfEditor.drag.t;syncKeyframeModal();}
    else {kfEditor.drag=null;setFromX(e.clientX);}
  });
  track.addEventListener('pointermove',e=>{
    if(!kfEditor.drag)return;const r=track.getBoundingClientRect();kfEditor.drag.t=clamp01((e.clientX-r.left)/r.width);kfEditor.u=kfEditor.drag.t;l.kf.sort((a,b)=>a.t-b.t);syncKeyframeModal();redraw();
  });
  const stopDrag=()=>{kfEditor.drag=null;syncKeyframeModal();};track.addEventListener('pointerup',stopDrag);track.addEventListener('pointercancel',stopDrag);
  let dragSt=null;
  kv.addEventListener('pointerdown',e=>{
    if(kfView!=='edit')return;e.preventDefault();kv.setPointerCapture(e.pointerId);
    if(!kfEditor.selected)modal.querySelector('[data-kf-add]').click();
    const f=kfEditor.selected;if(!f)return;dragSt={x:e.clientX,y:e.clientY,fx:f.x||0,fy:f.y||0};
  });
  kv.addEventListener('pointermove',e=>{
    if(!dragSt||!kfEditor.selected)return;const r=kv.getBoundingClientRect(),f=kfEditor.selected;
    f.x=Math.max(-45,Math.min(45,dragSt.fx+(e.clientX-dragSt.x)/r.width*100));f.y=Math.max(-45,Math.min(45,dragSt.fy+(e.clientY-dragSt.y)/r.height*100));
    syncKeyframeModal();redraw();
  });
  const endDrag=()=>{dragSt=null;};kv.addEventListener('pointerup',endDrag);kv.addEventListener('pointercancel',endDrag);
  modal.querySelector('[data-kf-play]').onclick=kfPlayToggle;
  modal.querySelectorAll('[data-kf-preset]').forEach(b=>b.onclick=()=>{
    const pr=KF_PRESETS.find(x=>x.id===b.dataset.kfPreset),ln=lyricLines[kfEditor.i];if(!pr)return;
    if((ln.kf||[]).length&&!confirm('Esto reemplaza los keyframes de esta línea. ¿Continuar?'))return;
    if(pr.f.length)ln.kf=pr.f.map(f=>({x:0,y:0,scale:1,rot:0,opacity:1,...f}));else delete ln.kf;
    kfEditor.selected=null;kfEditor.u=0;syncKeyframeModal();redraw();
  });
  if(bgVideoEl){kfEditor.onSeeked=()=>kfPaint();bgVideoEl.addEventListener('seeked',kfEditor.onSeeked);}
  syncKeyframeModal();
}
function syncKeyframeModal(){
  const modal=$('kfModal');if(!modal||!kfEditor)return;const l=lyricLines[kfEditor.i],u=kfEditor.u,time=l.start+u*Math.max(.01,l.end-l.start),pose=keyframeState(l,time);
  modal.querySelector('#kfTime').textContent=`${(time-l.start).toFixed(2)} s / ${(l.end-l.start).toFixed(2)} s`;
  modal.querySelector('#kfPlayhead').style.left=`${u*100}%`;modal.querySelector('#kfScrub').value=Math.round(u*1000);
  modal.querySelectorAll('[data-kf-edit]').forEach(input=>{const prop=input.dataset.kfEdit,value=prop==='scale'?pose.scale*100:prop==='opacity'?pose.opacity*100:pose[prop];input.value=String(Math.round(value*10)/10);});
  const markers=modal.querySelector('#kfMarkers');markers.innerHTML=(l.kf||[]).map((f,i)=>`<button class="kf-marker${f===kfEditor.selected?' sel':''}" style="left:${f.t*100}%" data-kf-index="${i}" title="Keyframe ${i+1} · ${(f.t*100).toFixed(1)}%"></button>`).join('');
  modal.querySelector('[data-kf-delete]').disabled=!kfEditor.selected;
  kfPaint();
}
// Pinta en el escenario el frame REAL del proyecto (fondo, efectos, marca) con la línea en su pose
function kfPaint(){
  const modal=$('kfModal');if(!modal||!kfEditor||!kfView)return;
  const kv=modal.querySelector('#kfView'),c=kv.getContext('2d'),l=lyricLines[kfEditor.i];
  const t=kfView==='play'?audioEl.currentTime:l.start+kfEditor.u*Math.max(.01,l.end-l.start);
  if(kfView==='edit'&&!isPlaying&&bgVideoEl&&bgMode==='video'){const tt=t%(bgVideoEl.duration||t||1);if(Math.abs(bgVideoEl.currentTime-tt)>.04)bgVideoEl.currentTime=tt;}
  drawFrame(t);c.drawImage(canvas,0,0,kv.width,kv.height);
  if(kfView==='edit')kfPath(c,kv,l,t);
}
// Recorrido del texto (línea punteada) y rombos en cada keyframe
function kfPath(c,kv,l,t){
  const g=GEO.get(l),fr=l.kf||[];if(!g||!fr.length)return;
  const W=canvas.width,H=canvas.height,sx=kv.width/W,sy=kv.height/H,pose=keyframeState(l,t),bx=g.ax-pose.x/100*W,by=g.cy-pose.y/100*H;
  const P=(x,y)=>[(bx+x/100*W)*sx,(by+y/100*H)*sy];
  c.save();c.lineWidth=2;c.setLineDash([6,5]);c.strokeStyle='rgba(61,220,200,.95)';c.beginPath();
  for(let i=0;i<=60;i++){const q=keyframeState(l,l.start+i/60*(l.end-l.start)),[x,y]=P(q.x,q.y);i?c.lineTo(x,y):c.moveTo(x,y);}
  c.stroke();c.setLineDash([]);
  fr.forEach(f=>{const [x,y]=P(f.x||0,f.y||0);c.save();c.translate(x,y);c.rotate(Math.PI/4);c.fillStyle=f===kfEditor.selected?'#fff':TC('#E8A33D');c.strokeStyle='#000';c.lineWidth=1;c.fillRect(-5,-5,10,10);c.strokeRect(-5,-5,10,10);c.restore();});
  c.restore();
}
// Previsualizar: reproduce la línea con audio, fondo y animaciones reales
let kfRaf=0;
function kfPlayToggle(){
  const m=$('kfModal');if(!m||!kfEditor)return;
  if(kfView==='play'){kfStop();return;}
  if(!audioLoaded){toast('Carga el audio para previsualizar el movimiento.');return;}
  const l=lyricLines[kfEditor.i],d=Math.max(.01,l.end-l.start);
  kfView='play';m.classList.add('kf-playing');m.querySelector('[data-kf-play]').textContent='■ Detener';
  if(isPlaying)$('playBtn').click();
  seekTo(Math.max(0,l.start-.4));$('playBtn').click();
  const tick=()=>{
    if(kfView!=='play'||!$('kfModal'))return;const t=audioEl.currentTime,u=clamp01((t-l.start)/d);kfEditor.u=u;
    m.querySelector('#kfPlayhead').style.left=u*100+'%';m.querySelector('#kfScrub').value=Math.round(u*1000);
    m.querySelector('#kfTime').textContent=`${Math.max(0,t-l.start).toFixed(2)} s / ${d.toFixed(2)} s`;kfPaint();
    if(t>=l.end+.35||audioEl.ended){kfStop();return;}kfRaf=requestAnimationFrame(tick);
  };
  kfRaf=requestAnimationFrame(tick);
}
function kfStop(closing){
  cancelAnimationFrame(kfRaf);if(isPlaying)$('playBtn').click();
  const m=$('kfModal');if(closing||!m||!kfEditor)return;
  kfView='edit';m.classList.remove('kf-playing');m.querySelector('[data-kf-play]').textContent='▶ Previsualizar';syncKeyframeModal();
}
function closeKf(){
  if(kfView==='play')kfStop(true);
  if(kfEditor&&kfEditor.onSeeked&&bgVideoEl)bgVideoEl.removeEventListener('seeked',kfEditor.onSeeked);
  kfView=null;$('kfModal')?.remove();kfEditor=null;redraw();
}
function setWordTime(l,index,time){
  const n=wordsOf(l.text).length;if(!n)return;
  const starts=wordTimes(l,n).map(x=>x[0]),lo=index?starts[index-1]+.01:l.start,hi=index<n-1?starts[index+1]-.01:l.end;
  starts[index]=Math.max(lo,Math.min(hi,time));l.wt=starts;
}
// Conserva las marcas de tiempo por palabra al editar el texto de una línea:
// si cambia la cantidad de palabras, se reubican las que no cambiaron y se reparten las nuevas.
function remapWordTimes(l,oldText,newText){
  if(!l.wt) return;
  const a=wordsOf(oldText), b=wordsOf(newText), ot=l.wt;
  if(ot.length!==a.length){ delete l.wt; return; }
  if(!b.length){ delete l.wt; return; }
  if(a.length===b.length) return;
  let p=0; while(p<a.length&&p<b.length&&a[p]===b[p]) p++;
  let q=0; while(q<a.length-p&&q<b.length-p&&a[a.length-1-q]===b[b.length-1-q]) q++;
  const mid=b.length-p-q, head=ot.slice(0,p), tail=ot.slice(a.length-q);
  const lo=p?ot[p-1]:l.start, hi=q?ot[a.length-q]:l.end, mids=[];
  if(mid>0){ const first=p?1:0, step=(hi-lo)/(mid+first); for(let k=0;k<mid;k++) mids.push(lo+step*(k+first)); }
  const nw=head.concat(mids,tail);
  if(nw.length===b.length&&nw.every((v,i)=>i===0||v>=nw[i-1])) l.wt=nw; else delete l.wt;
}
$('lyricsLog').addEventListener('input',e=>{
  const row=e.target.closest('.lrow'); if(!row||e.target.dataset.f!=='text') return;
  const i=+row.dataset.i;const prevText=lyricLines[i].text;lyricLines[i].text=e.target.value;remapWordTimes(lyricLines[i],prevText,e.target.value);
  const panel=row.nextElementSibling;if(panel&&!panel.hidden)panel.innerHTML=advancedMarkup(i);redraw();
});
$('lyricsLog').addEventListener('change',e=>{
  const panel=e.target.closest('.advrow');
  if(panel){
    const i=+panel.dataset.advRow,l=lyricLines[i];
    if(e.target.dataset.lineTime){
      const field=e.target.dataset.lineTime,v=+e.target.value;if(!Number.isFinite(v)){e.target.value=l[field].toFixed(2);return;}
      const old=l.start;
      if(field==='start'){l.start=Math.max(0,Math.min(l.end-.05,v));if(l.wt)l.wt=l.wt.map(t=>t+l.start-old);}
      else l.end=Math.max(l.start+.05,v);
      buildEditor();checkReady();redraw();const r=lyricLines.indexOf(l),next=document.querySelector(`.advrow[data-adv-row="${r}"]`);if(next){next.innerHTML=advancedMarkup(r);next.hidden=false;}return;
    }
    if(e.target.dataset.wordTime!==undefined){
      setWordTime(l,+e.target.dataset.wordTime,+e.target.value);e.target.value=l.wt[+e.target.dataset.wordTime].toFixed(2);redraw();return;
    }
    return;
  }
  const row=e.target.closest('.lrow'), f=e.target.dataset.f; if(!row||(f!=='start'&&f!=='end')) return;
  const i=+row.dataset.i, v=parseTime(e.target.value); if(v===null){ e.target.value=fmtTime(lyricLines[i][f]); return; }
  const l=lyricLines[i]; l[f]=v; if(l.end<=l.start) l.end=l.start+0.5;
  lyricLines.sort((a,b)=>a.start-b.start); buildEditor(); checkReady(); redraw();
});
const lineMenu=document.createElement('div');lineMenu.className='line-context';lineMenu.hidden=true;lineMenu.innerHTML='<button data-line-action="kf">◇ Keyframes</button><button data-line-action="text">✎ Editar texto</button><button data-line-action="delete">⌫ Borrar línea</button>';document.body.append(lineMenu);let contextLine=-1;
function showLineContextMenu(e,line){e.preventDefault();contextLine=lyricLines.indexOf(line);if(contextLine<0)return;sel=line;markSel();lnLoad();const width=190,height=126,x=Math.min(e.clientX,innerWidth-width-8),y=Math.min(e.clientY,innerHeight-height-8);lineMenu.style.left=Math.max(8,x)+'px';lineMenu.style.top=Math.max(8,y)+'px';lineMenu.hidden=false;}
$('lyricsLog').addEventListener('contextmenu',e=>{const row=e.target.closest('.lrow');if(row)showLineContextMenu(e,lyricLines[+row.dataset.i]);});

lineMenu.addEventListener('click',e=>{const a=e.target.closest('[data-line-action]')?.dataset.lineAction;if(!a||contextLine<0)return;const i=contextLine,l=lyricLines[i];lineMenu.hidden=true;if(a==='kf'){openKeyframeEditor(i);return;}if(a==='text'){const input=$('lyricsLog').querySelector('.lrow[data-i="'+i+'"] [data-f="text"]');input?.focus();input?.select();return;}if(a==='delete'){lyricLines.splice(i,1);if(sel===l)sel=null;buildEditor();checkReady();redraw();}});
document.addEventListener('pointerdown',e=>{if(!lineMenu.hidden&&!lineMenu.contains(e.target))lineMenu.hidden=true;});document.addEventListener('keydown',e=>{if(e.key==='Escape')lineMenu.hidden=true;});
$('lyricsLog').addEventListener('click',e=>{
  const adv=e.target.closest('[data-adv-op]');
  if(adv){
    const panel=adv.closest('.advrow'),i=+panel.dataset.advRow,l=lyricLines[i],op=adv.dataset.advOp;
    if(op==='close'){panel.hidden=true;return;}
    if(op==='nudge-start'||op==='nudge-end'){
      const d=+adv.dataset.delta,old=l.start;
      if(op==='nudge-start'){l.start=Math.max(0,Math.min(l.end-.05,l.start+d));if(l.wt)l.wt=l.wt.map(t=>t+l.start-old);}
      else l.end=Math.max(l.start+.05,l.end+d);
      buildEditor();checkReady();redraw();const next=document.querySelector(`.advrow[data-adv-row="${lyricLines.indexOf(l)}"]`);if(next){next.innerHTML=advancedMarkup(lyricLines.indexOf(l));next.hidden=false;}return;
    }
    if(op==='stamp-word'){
      if(!audioLoaded){toast('Carga el audio para fijar palabras al cursor.');return;}
      setWordTime(l,+adv.dataset.word,audioEl.currentTime);refreshAdvanced(i);redraw();return;
    }
    if(op==='distribute-words'){
      const n=wordsOf(l.text).length,dur=l.end-l.start;l.wt=wordsOf(l.text).map((_,j)=>l.start+dur*j/Math.max(1,n));refreshAdvanced(i);redraw();return;
    }
    if(op==='edit-kf'){openKeyframeEditor(i);return;}
    if(op==='retime-words'){openLyricTimer({from:i,only:true,mode:'word'});return;}
  }
  const b=e.target.closest('button[data-op]'); if(!b) return;
  const i=+b.closest('.lrow').dataset.i, l=lyricLines[i];
  if(b.dataset.op==='retime'){openLyricTimer({from:i,only:true,mode:'line'});return;}
  if(b.dataset.op==='kf'){if(!featurePro){openKeyframePreview(i);return;}openKeyframeEditor(i);return;}
  if(b.dataset.op==='advanced'){
    if(!featurePro){openKeyframePreview(i);return;}
    const panel=b.closest('.lrow').nextElementSibling;
    if(panel.hidden){panel.innerHTML=advancedMarkup(i);panel.hidden=false;}else panel.hidden=true;
    return;
  }
  if(b.dataset.op==='go'){
    const t=Math.min(l.start+0.5,(l.start+l.end)/2);
    if(audioLoaded){ audioEl.currentTime=t; updateTimeDisplay(); drawFrame(t); } else drawFrame(t);
    return;
  }
  if(b.dataset.op==='add') lyricLines.splice(i+1,0,{start:l.end,end:l.end+3,text:''});
  if(b.dataset.op==='del') lyricLines.splice(i,1);
  buildEditor(); checkReady(); redraw();
  if(b.dataset.op==='add'){ const n=$('lyricsLog').querySelector(`.lrow[data-i="${i+1}"] [data-f="text"]`); if(n) n.focus(); }
});
$('addLineBtn').onclick=()=>{
  const last=lyricLines[lyricLines.length-1], st=last?last.end:getCurrentTime();
  lyricLines.push({start:st,end:st+3,text:''}); buildEditor(); checkReady(); redraw();
  const rows=$('lyricsLog').querySelectorAll('.lrow'); rows[rows.length-1].querySelector('[data-f="text"]').focus();
};
$('pasteBtn').onclick=()=>{
  const ls=plainToLines($('pasteLyrics').value); if(!ls.length){ toast('Pega algo de letra primero.'); return; }
  if(lyricLines.length&&!confirm('Ya hay una letra cargada. ¿Reemplazarla?')) return; lyricLines=ls; buildEditor(); checkReady(); redraw(); toast(ls.length+' líneas repartidas de forma pareja.');
};
$('lrcBtn').onclick=()=>{
  if(!lyricLines.length){ toast('No hay líneas para descargar.'); return; }
  downloadBlob(new Blob([lyricLines.map(l=>`[${fmtTime(l.start)}]${l.text}`).join('\n')],{type:'text/plain'}),safeName()+'.lrc');
};

// restaurar último autoguardado
try{
  const raw=localStorage.getItem(AUTOSAVE_KEY), p=raw&&JSON.parse(raw);
  if(p&&((p.lines&&p.lines.length)||p.name)){
    pendingRestore=true; $('restoreBar').style.display='flex';
    $('restoreInfo').textContent='Encontré un proyecto sin guardar'+(p.name?': «'+p.name+'»':'')+' ('+new Date(p.savedAt).toLocaleString('es-AR')+').';
    const close=()=>{ pendingRestore=false; $('restoreBar').style.display='none'; };
    $('restoreYes').onclick=async()=>{ try{await loadProject(p);close();commit();autosave();enterEditor();}catch(err){toast(err?.code==='PRO_REQUIRED'?err.message:'No se pudo restaurar el proyecto.');} };
    $('restoreNo').onclick=close;
  }
}catch(e){}

// ================= FASE 2: timeline, onda, sincronizar =================
let TLH=150; const tl = $('tl'), tx = tl.getContext('2d'), PPS_B = 100;
let pps = 50, tlStart = 0, sel = null, tlDrag = null, peaks = null;
const t2x = t => (t - tlStart) * pps, x2t = x => tlStart + x / pps;
function tlDur(){ return (audioLoaded && audioEl.duration) ? audioEl.duration : Math.max(60, (lyricLines.length ? Math.max(...lyricLines.map(l=>l.end)) : 0) + 5); }
function tlSize(){ const d=window.devicePixelRatio||1, w=tl.clientWidth; tl.style.height=TLH+'px'; if(tl.width!==Math.round(w*d)||tl.height!==Math.round(TLH*d)){ tl.width=Math.round(w*d); tl.height=Math.round(TLH*d); } tx.setTransform(d,0,0,d,0,0); return w; }
function fitTimeline(){ pps=Math.max(5,(tl.clientWidth||600)/tlDur()); tlStart=0; drawTimeline(getCurrentTime()); }
function zoomAt(f,x){ const t=x2t(x); pps=Math.max(Math.max(5,tl.clientWidth/tlDur()*0.9),Math.min(600,pps*f)); tlStart=t-x/pps; drawTimeline(getCurrentTime()); }
function seekTo(t){ if(!audioLoaded) return; t=Math.max(0,Math.min(t,audioEl.duration)); audioEl.currentTime=t; if(bgVideoEl) bgVideoEl.currentTime=t%(bgVideoEl.duration||t||1); updateTimeDisplay(); drawFrame(t); }

async function loadWave(file){
  peaks=null; audioBuf=null;
  try{
    const ac=new (window.AudioContext||window.webkitAudioContext)();
    const buf=await ac.decodeAudioData(await file.arrayBuffer()); ac.close(); audioBuf=buf;
    const n=Math.ceil(buf.duration*PPS_B), per=buf.sampleRate/PPS_B, pk=new Float32Array(n); let mx=0;
    for(let c=0;c<buf.numberOfChannels;c++){ const d=buf.getChannelData(c);
      for(let i=0;i<n;i++){ let m=0; const a=Math.floor(i*per), b=Math.min(d.length,Math.floor((i+1)*per)); for(let j=a;j<b;j+=4){ const v=Math.abs(d[j]); if(v>m) m=v; } if(m>pk[i]) pk[i]=m; if(m>mx) mx=m; } }
    if(mx>0) for(let i=0;i<n;i++) pk[i]/=mx;
    peaks=pk;
  }catch(e){ toast('No pude analizar el audio: la onda y la exportación MP4 pueden no funcionar (¿archivo dañado?).','error'); }
  fitTimeline();
}

function drawTimeline(t){
  LY0=peaks?74:28; const nL=maxLane()+1+(maxLane()>0?1:0); TLH=LY0+nL*LS+6; const w=tlSize(), H=TLH, dur=tlDur();
  tlStart=Math.max(0,Math.min(tlStart,Math.max(0,dur-w/pps)));
  if(isPlaying&&!tlDrag){ const x=t2x(t); if(x>w*0.9||x<0) tlStart=Math.max(0,t-w*0.1/pps); }
  tx.fillStyle=TC('#1B1620'); tx.fillRect(0,0,w,H);
  const step=[0.5,1,2,5,10,15,30,60,120].find(s=>s*pps>=80)||120;
  tx.font='10px JetBrains Mono, monospace'; tx.fillStyle=TC('#A99BB8'); tx.strokeStyle=TC('#3A3145'); tx.textBaseline='top'; tx.lineWidth=1;
  for(let s=Math.ceil(tlStart/step)*step; s<=x2t(w); s+=step){ const x=Math.round(t2x(s))+.5; tx.beginPath(); tx.moveTo(x,0); tx.lineTo(x,H); tx.stroke(); tx.fillText(fmtTimeShort(s),x+3,3); }
  if(peaks){ tx.fillStyle='rgba(62,201,167,.6)';
    for(let x=0;x<w;x++){ const a=Math.floor(x2t(x)*PPS_B), b=Math.max(a+1,Math.floor(x2t(x+1)*PPS_B)); let m=0; for(let i=a;i<b&&i<peaks.length;i++) if(peaks[i]>m) m=peaks[i]; const hh=m*(LY0-30)/2; tx.fillRect(x,(LY0+18)/2-hh,1,Math.max(1,hh*2)); } }
  for(let i=0;i<nL;i++){ const y=LY0+i*LS; tx.fillStyle=i%2?'rgba(255,255,255,.035)':'rgba(255,255,255,.015)'; tx.fillRect(0,y,w,LH); tx.fillStyle=TC('#6F6280'); tx.font='9px JetBrains Mono, monospace'; tx.textBaseline='middle'; if(nL>1) tx.fillText('C'+(i+1),4,y+LH/2); }
  lyricLines.forEach(l=>{
    const x0=t2x(l.start), x1=t2x(l.end), bw=Math.max(2,x1-x0), on=l===sel, y=LY0+(l.ly||0)*LS; if(x1<0||x0>w) return;
    tx.fillStyle=on?TC('#E8A33D',.55):TC('#E8A33D',.22); tx.fillRect(x0,y,bw,LH);
    tx.strokeStyle=on?TC('#E8A33D'):TC('#7A5A22'); tx.strokeRect(x0+.5,y+.5,bw-1,LH-1);
    tx.save(); tx.beginPath(); tx.rect(x0+3,y,Math.max(0,bw-6),LH); tx.clip(); tx.fillStyle=TC('#EFE9F2'); tx.font='11px Inter, sans-serif'; tx.textBaseline='middle'; tx.fillText((l.st?'✦ ':'')+(l.text||'(vacía)'),x0+5,y+LH/2); tx.restore();
  });
  tx.fillStyle=TC('#EFE9F2'); tx.fillRect(Math.round(t2x(t))-.5,0,1.5,H);
}

function tlHit(x,y){
  if(y<LY0) return null; const ln=Math.floor((y-LY0)/LS);
  for(let i=lyricLines.length-1;i>=0;i--){ const l=lyricLines[i], x0=t2x(l.start), x1=t2x(l.end), e=Math.min(6,(x1-x0)/3);
    if(x<x0-6||x>x1+6||(l.ly||0)!==ln) continue;
    if(Math.abs(x-x0)<=e) return {l,type:'start'}; if(Math.abs(x-x1)<=e) return {l,type:'end'}; if(x>=x0&&x<=x1) return {l,type:'move'}; }
  return null;
}
const tlX = e => e.clientX - tl.getBoundingClientRect().left;
tl.addEventListener('contextmenu',e=>{const r=tl.getBoundingClientRect(),hit=tlHit(tlX(e),e.clientY-r.top);if(hit)showLineContextMenu(e,hit.l);});
tl.addEventListener('pointerdown',e=>{
  const x=tlX(e), y=e.clientY-tl.getBoundingClientRect().top, h=tlHit(x,y); tl.setPointerCapture(e.pointerId);
  if(h){ sel=h.l; markSel(); scrollRow(); showSel(); tlDrag={type:h.type,l:h.l,x0:x,s:h.l.start,e:h.l.end,wt0:h.l.wt&&h.l.wt.slice()}; }
  else { tlDrag={type:'seek'}; seekTo(x2t(x)); return; }
  drawFrame(getCurrentTime());
});
tl.addEventListener('pointermove',e=>{
  const x=tlX(e), y=e.clientY-tl.getBoundingClientRect().top, d=tlDrag;
  if(!d){ const h=tlHit(x,e.clientY-tl.getBoundingClientRect().top); tl.style.cursor=h?(h.type==='move'?'grab':'ew-resize'):'crosshair'; return; }
  if(d.type==='seek'){ seekTo(x2t(x)); return; }
  const dt=(x-d.x0)/pps;
  if(d.type==='move'){ const len0=d.e-d.s; let s=Math.max(0,d.s+dt); const sa=snapT(s,d.l), sb=snapT(s+len0,d.l)-len0; s=Math.max(0,Math.abs(sa-s)<=Math.abs(sb-s)?sa:sb); d.l.start=s; d.l.end=s+(d.e-d.s); if(d.wt0) d.l.wt=d.wt0.map(v=>v+s-d.s); const ln=Math.max(0,Math.min(maxLane()+1,Math.floor((y-LY0)/LS))); if(ln) d.l.ly=ln; else delete d.l.ly; }
  else if(d.type==='start') d.l.start=Math.max(0,Math.min(snapT(d.s+dt,d.l),d.e-0.1));
  else d.l.end=Math.max(d.s+0.1,snapT(d.e+dt,d.l));
  drawFrame(getCurrentTime());
});
const tlUp=()=>{ const d=tlDrag; tlDrag=null; if(d&&d.type!=='seek'){ normLanes(); lyricLines.sort((a,b)=>a.start-b.start); buildEditor(); checkReady(); redraw(); } };
tl.addEventListener('pointerup',tlUp); tl.addEventListener('pointercancel',tlUp);
tl.addEventListener('wheel',e=>{ e.preventDefault(); if(e.ctrlKey||e.metaKey) zoomAt(e.deltaY<0?1.25:0.8,tlX(e)); else { tlStart+=(e.deltaX||e.deltaY)/pps; drawTimeline(getCurrentTime()); } },{passive:false});
window.addEventListener('resize',()=>drawTimeline(getCurrentTime()));
const zc=()=>{ const x=t2x(getCurrentTime()); return (x>0&&x<tl.clientWidth)?x:tl.clientWidth/2; };
$('tlIn').onclick=()=>zoomAt(1.5,zc()); $('tlOut').onclick=()=>zoomAt(1/1.5,zc()); $('tlFit').onclick=fitTimeline;

// selección
function markSel(){ lnLoad(); const i=lyricLines.indexOf(sel); document.querySelectorAll('#lyricsLog .lrow').forEach((r,k)=>r.classList.toggle('sel',k===i)); }
function scrollRow(){ const b=$('lyricsLog'), r=b.children[lyricLines.indexOf(sel)]; if(r) b.scrollTop=r.offsetTop-b.clientHeight/2; }
$('lyricsLog').addEventListener('focusin',e=>{ const r=e.target.closest('.lrow'); if(r){ sel=lyricLines[+r.dataset.i]; markSel(); showSel(); drawFrame(getCurrentTime()); } });

// dividir / unir
$('splitBtn').onclick=()=>{
  const t=getCurrentTime(), l=(sel&&t>sel.start&&t<sel.end)?sel:lyricLines.find(x=>t>x.start&&t<x.end);
  if(!l){ toast('Pon el cursor adentro de una línea para dividirla.'); return; }
  const w=l.text.split(/\s+/).filter(Boolean); if(w.length<2){ toast('La línea necesita al menos 2 palabras para dividirla.'); return; }
  const k=Math.min(w.length-1,Math.max(1,Math.round(w.length*(t-l.start)/(l.end-l.start))));
  const n={start:t,end:l.end,text:w.slice(k).join(' ')}; l.end=t; l.text=w.slice(0,k).join(' '); delete l.wt;
  lyricLines.splice(lyricLines.indexOf(l)+1,0,n); sel=n; buildEditor(); checkReady(); redraw();
};
$('mergeBtn').onclick=()=>{
  const i=lyricLines.indexOf(sel); if(i<0||i>=lyricLines.length-1){ toast('Elige una línea que tenga otra después.'); return; }
  const a=lyricLines[i], b=lyricLines[i+1]; a.text=(a.text+' '+b.text).trim(); delete a.wt; a.end=Math.max(a.end,b.end); lyricLines.splice(i+1,1); buildEditor(); checkReady(); redraw();
};

// atajo global: reproducir / pausar
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.matches('textarea, select, input[type=text], input[type=number]')) return;
  if(matchesHotkey(e,'play')&&e.target.tagName!=='BUTTON'){
    e.preventDefault();
    // con el editor de keyframes abierto, Espacio controla su propia previsualización
    // (antes arrancaba el reproductor principal y ambos peleaban por el video de fondo)
    if($('kfModal')&&kfEditor){ if(!e.repeat) kfPlayToggle(); return; }
    if(e.repeat) return;
    $('playBtn').click();
  }
});

// ================= FASE 3: animación por letra / palabra =================
const lerp=(a,b,e)=>a+(b-a)*e, clamp01=x=>Math.min(1,Math.max(0,x));
const EASE={out:x=>1-Math.pow(1-x,3),
  back:x=>1+2.70158*Math.pow(x-1,3)+1.70158*Math.pow(x-1,2),
  bounce:x=>{const n=7.5625,d=2.75; if(x<1/d) return n*x*x; if(x<2/d) return n*(x-=1.5/d)*x+.75; if(x<2.5/d) return n*(x-=2.25/d)*x+.9375; return n*(x-=2.625/d)*x+.984375;},
  elastic:x=>x===0||x===1?x:Math.pow(2,-10*x)*Math.sin((x*10-.75)*(2*Math.PI/3))+1,
  step:x=>x>0?1:0};
// u = unidad que se anima (line | word | char); f = estado inicial; st = escalonado; e = easing; k = karaoke
const FX={
  none:{n:'Sin animación',u:'line',f:{}},
  fade:{n:'Fundido',u:'line',f:{a:0}},
  slide:{n:'Deslizar hacia arriba',u:'line',f:{a:0,dy:40}},
  pop:{n:'Aparecer con zoom',u:'line',f:{a:0,s:.85}},
  karaoke:{n:'Karaoke por palabra',u:'line',f:{a:0},k:1},
  cfade:{n:'Letras: fundido',u:'char',f:{a:0},st:.8},
  cup:{n:'Letras: suben',u:'char',f:{a:0,dy:50},st:.8},
  cdrop:{n:'Letras: caen con rebote',u:'char',f:{a:0,dy:-120},st:.8,e:'bounce'},
  cpop:{n:'Letras: rebote elástico',u:'char',f:{a:0,s:0},st:.8,e:'elastic'},
  crot:{n:'Letras: giran',u:'char',f:{a:0,r:-1.2,s:.3},st:.8,e:'back'},
  ctype:{n:'Máquina de escribir',u:'char',f:{a:0},st:1,e:'step'},
  wave:{n:'Letras: ola continua',u:'char',f:{a:0,dy:20},st:.6,wave:1},
  wfade:{n:'Palabras: fundido',u:'word',f:{a:0},st:.8},
  wup:{n:'Palabras: suben',u:'word',f:{a:0,dy:60},st:.8},
  wpop:{n:'Palabras: rebote',u:'word',f:{a:0,s:.4},st:.8,e:'back'},
  wslide:{n:'Palabras: entran de la derecha',u:'word',f:{a:0,dx:120},st:.8},
  wzoom:{n:'Palabras: zoom',u:'word',f:{a:0,s:2.2},st:.8}
};
const fxOpts=Object.entries(FX).map(([k,v])=>`<option value="${k}">${v.n}</option>`).join('');
$('animSelect').innerHTML=fxOpts; $('animSelect').value='slide';
$('lnAnim').innerHTML='<option value="">Como el resto</option>'+fxOpts;

const wordsOf=t=>t.split(/\s+/).filter(Boolean);
function fxState(f,e){ return {a:lerp(f.a??1,1,e), dx:(f.dx||0)*(1-e), dy:(f.dy||0)*(1-e), s:lerp(f.s??1,1,e), r:(f.r||0)*(1-e)}; }
function unitE(fx,k,N,te,D){ const g=fx.st||0, d=Math.max(.08,D*(1-g)), dl=N>1?(D-d)*k/(N-1):0; return EASE[fx.e||'out'](clamp01((te-dl)/d)); }
let animPreviewRaf=0,animPreviewStartedAt=0;
function drawAnimPreview(now){
  const cv=$('animPreviewCanvas'),c=cv.getContext('2d'),w=cv.width,h=cv.height,fx=FX[$('animSelect').value]||FX.none,phrase='Texto Ejemplo',font=$('fontSelect').value||'Space Grotesk',size=43,period=2600,elapsed=((now-animPreviewStartedAt)%period)/1000,entryTime=Math.max(0,elapsed-.18),D=.68;
  $('animPreviewName').textContent='Reproduciendo: '+(FX[$('animSelect').value]?.n||'Sin animación')+' · en bucle';c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;
  const bg=c.createLinearGradient(0,0,w,h);bg.addColorStop(0,TC('#342744'));bg.addColorStop(1,TC('#17121d'));c.clearRect(0,0,w,h);c.fillStyle=bg;c.fillRect(0,0,w,h);
  c.font=`${fontW(font)} ${size}px "${font}"`;c.textBaseline='middle';c.textAlign='left';c.shadowColor='#000a';c.shadowBlur=6;c.shadowOffsetY=2;
  const words=phrase.split(' '),fullW=c.measureText(phrase).width,left=(w-fullW)/2,baseY=h*.54;
  if(fx.k){
    c.globalAlpha=.42;c.fillStyle='#fff';c.fillText(phrase,left,baseY);const p=clamp01((elapsed-.25)/1.35);c.save();c.beginPath();c.rect(left-fullW/2,0,fullW*p+fullW/2,h);c.clip();c.globalAlpha=1;c.fillStyle=$('accentColor').value;c.fillText(phrase,left,baseY);c.restore();
  }else{
    const units=fx.u==='char'?[...phrase]:fx.u==='word'?words:[phrase],gap=fx.u==='word'?c.measureText(' ').width:0,total=units.reduce((a,u)=>a+c.measureText(u).width,0)+gap*Math.max(0,units.length-1);let x=(w-total)/2;
    c.save();
    if(fx.u==='line'){
      const q=fxState(fx.f,unitE(fx,0,1,entryTime,D));c.translate(q.dx,q.dy);c.rotate(q.r);c.scale(q.s,q.s);c.globalAlpha=q.a;
      units.forEach(u=>{c.fillStyle=$('textColor').value;c.fillText(u,x,baseY);x+=c.measureText(u).width+gap;});
    }else{
      units.forEach((u,i)=>{const q=(fx.u==='word'&&S.wordSync)?fxState(fx.f,unitE({...fx,st:0},0,1,elapsed-(.3+i*.7),.45)):fxState(fx.f,unitE(fx,i,units.length,entryTime,D)),uw=c.measureText(u).width,dy=fx.wave&&elapsed>D?Math.sin(now/190+i*.8)*6:0;c.save();c.translate(x+uw/2+q.dx,baseY+q.dy+dy);c.rotate(q.r);c.scale(Math.max(.01,q.s),Math.max(.01,q.s));c.globalAlpha=q.a;c.fillStyle=$('textColor').value;if(u.trim())c.fillText(u,-uw/2,0);c.restore();x+=uw+gap;});
    }
    c.restore();
  }
  c.shadowColor='transparent';c.shadowBlur=0;c.shadowOffsetY=0;
}
function runAnimPreview(){cancelAnimationFrame(animPreviewRaf);animPreviewStartedAt=performance.now();const tick=now=>{if(!$('animPreview').open||document.hidden){animPreviewRaf=0;return;}drawAnimPreview(now);animPreviewRaf=requestAnimationFrame(tick);};animPreviewRaf=requestAnimationFrame(tick);}
const animPreviewDetails=$('animPreview');animPreviewDetails.addEventListener('toggle',()=>{if(animPreviewDetails.open)runAnimPreview();else{cancelAnimationFrame(animPreviewRaf);animPreviewRaf=0;}});
// la vista previa es fija: no se puede plegar ni expandir
animPreviewDetails.querySelector('summary').addEventListener('click',e=>e.preventDefault());
animPreviewDetails.open=true; runAnimPreview();
document.addEventListener('visibilitychange',()=>{if(animPreviewDetails.open){if(document.hidden){cancelAnimationFrame(animPreviewRaf);animPreviewRaf=0;}else runAnimPreview();}});
$('animSelect').addEventListener('input',()=>karaokeHint($('animSelect').value));
$('lnAnim').addEventListener('input',()=>karaokeHint($('lnAnim').value));
$('animSelect').addEventListener('input',()=>{const name=FX[$('animSelect').value]?.n||'Sin animación';$('animPreviewName').textContent='Reproduciendo: '+name+' · en bucle';if(animPreviewDetails.open)drawAnimPreview(performance.now());});

// layout por palabra y letra (cacheado)
const LC=new Map();
function layout(text,fs,fam,maxW,al){
  const key=[text,fs,fam,maxW,al,document.fonts&&document.fonts.status].join('|'); if(LC.has(key)) return LC.get(key);
  const sp=ctx.measureText(' ').width, rows=[]; let cur=null;
  for(const wd of wordsOf(text)){
    const ww=ctx.measureText(wd).width;
    if(!cur||(cur.words.length&&cur.w+sp+ww>maxW)){ cur={words:[],w:0}; rows.push(cur); }
    const x=cur.w+(cur.words.length?sp:0), ch=Array.from(wd), cs=ch.map((_,i)=>ctx.measureText(ch.slice(0,i).join('')).width); cs.push(ww);
    cur.words.push({t:wd,x,w:ww,ch,cs}); cur.w=x+ww;
  }
  let k=0, nc=0; rows.forEach(r=>{ const o=al==='left'?0:al==='right'?-r.w:-r.w/2; r.words.forEach(wd=>{ wd.x+=o; wd.k=k++; nc+=wd.ch.length; }); });
  const lh=fs*1.25; const R={key,rows,lh,totalH:rows.length*lh,maxW:Math.max(0,...rows.map(r=>r.w)),nw:k,nc}; LC.set(key,R); if(LC.size>24) LC.delete(LC.keys().next().value); return R;
}
// tiempos de cada palabra: los marcados a mano (l.wt) o repartidos por cantidad de letras
function wordTimes(l,n){
  const ws=wordsOf(l.text), tot=ws.reduce((a,x)=>a+x.length,0)||1, dur=l.end-l.start; let st;
  if(l.wt&&l.wt.length===n&&l.wt[0]>=l.start-.05&&l.wt[n-1]<=l.end+.05&&l.wt.every((v,i)=>i===0||v>=l.wt[i-1])) st=l.wt;
  else { let c=0; st=ws.map(x=>{ const v=l.start+dur*c/tot; c+=x.length; return v; }); }
  return st.map((v,i)=>[v,i<n-1?st[i+1]:l.end]);
}
function drawLineText(l,t,lyOff){
  const w=canvas.width, h=canvas.height, sty=l.st||{}, fx=FX[sty.anim||S.anim]||FX.none;
  paintSty=sty;
  const pose=keyframeState(l,t);
  const fs=S.fontSize*(w/720)*((sty.sz||100)/100), fam=sty.font||S.font, col=sty.color||S.textColor, ac=S.accent;
  const fnt=`${fontW(fam)} ${fs}px "${fam}"`; ctx.font=fnt; needFont(fnt); ctx.textBaseline='middle'; ctx.textAlign='left';
  if(sty.comp){ const composition=COMPOSITIONS.find(c=>c.id===sty.comp); if(composition){ drawComposition(l,t,sty,lyOff,composition); return; } }
  const L=layout(S.upper?l.text.toUpperCase():l.text,fs,fam,w*.86,posH); if(!L.nw) return;
  const ax=posH==='left'?w*.08:posH==='right'?w*.92:w/2, cy=getTextY(h);
  GEO.set(l,{ax:ax+(sty.dx||0)*w+(pose.x/100)*w,cy:cy+(sty.dy||0)*h+(pose.y/100)*h+(lyOff||0),rot:(sty.rot||0)+pose.rot,mw:L.maxW*pose.scale,th:L.totalH*pose.scale});
  const kfEdit=kfView==='edit'&&kfEditor&&l===lyricLines[kfEditor.i], dur=Math.max(.01,l.end-l.start), te=kfEdit?1e3:t-l.start, D=Math.min(S.inDur/100,dur*.6);
  const OD=Math.min(.3,dur*.3), eo=(kfEdit||S.outAnim==='none')?0:clamp01((t-(l.end-OD))/OD);
  ctx.save(); ctx.translate(ax+(sty.dx||0)*w+(pose.x/100)*w,cy+(sty.dy||0)*h+(pose.y/100)*h+(lyOff||0)); ctx.rotate(((sty.rot||0)+pose.rot)*Math.PI/180); const OA=S.outAnim; ctx.translate(OA==='left'?-70*eo:OA==='right'?70*eo:0,OA==='up'?-40*eo:OA==='down'?40*eo:0); if(OA==='spin') ctx.rotate(eo*.5); const xs=OA==='shrink'?1-.2*eo:OA==='vanish'?Math.max(.001,1-eo):OA==='grow'?1+.3*eo:1; ctx.scale(xs*pose.scale,xs*pose.scale); ctx.globalAlpha=(1-eo)*(kfEdit?Math.max(.3,pose.opacity):pose.opacity);
  if(S.textBg){ const bx=posH==='left'?-20:posH==='right'?-L.maxW-20:-L.maxW/2-20; ctx.fillStyle='rgba(0,0,0,0.45)'; ctx.fillRect(bx,-L.totalH/2-14,L.maxW+40,L.totalH+28); }
  const N=fx.u==='char'?L.nc:fx.u==='word'?L.nw:1, ws=fx.u==='word'&&!!S.wordSync, wt=(fx.k||ws)?wordTimes(l,L.nw):null;
  if(fx.u==='line'){ const q=fxState(fx.f,unitE(fx,0,1,te,D)); ctx.translate(q.dx,q.dy); ctx.scale(q.s,q.s); ctx.rotate(q.r); ctx.globalAlpha*=clamp01(q.a); }
  const unit=(str,x,wu,y,k)=>{
    const q=fx.u==='line'?{a:1,dx:0,dy:0,s:1,r:0}:ws?fxState(fx.f,unitE({...fx,st:0},0,1,t-wt[k][0],Math.min(D,.45))):fxState(fx.f,unitE(fx,k,N,te,D)); let dy=q.dy; if(fx.wave&&te>D) dy+=Math.sin(t*4+k*.6)*7;
    ctx.save(); ctx.translate(x+wu/2+q.dx,y+dy); ctx.rotate(q.r); ctx.scale(Math.max(0,q.s),Math.max(0,q.s)); ctx.globalAlpha*=clamp01(q.a);
    paint(str,-wu/2,0,col,w); ctx.restore();
  };
  let ci=0;
  L.rows.forEach((r,ri)=>{ const y=-L.totalH/2+ri*L.lh+L.lh/2;
    r.words.forEach(wd=>{
      if(fx.k){ const [s0,e0]=wt[wd.k], f=clamp01((t-s0)/Math.max(.05,e0-s0));
        { const E=textFx(); if(E.sw>0){ ctx.lineJoin='round'; ctx.lineWidth=E.sw*2*w/720; ctx.strokeStyle=E.sc; ctx.strokeText(wd.t,wd.x,y); } } ctx.fillStyle='rgba(255,255,255,0.35)'; ctx.fillText(wd.t,wd.x,y);
        if(f>0){ ctx.save(); ctx.beginPath(); ctx.rect(wd.x,y-L.lh,wd.w*f,L.lh*2); ctx.clip(); ctx.fillStyle=ac; ctx.fillText(wd.t,wd.x,y); ctx.restore(); }
      } else if(fx.u==='char') wd.ch.forEach((c,i)=>unit(c,wd.x+wd.cs[i],wd.cs[i+1]-wd.cs[i],y,ci++));
      else unit(wd.t,wd.x,wd.w,y,wd.k);
    });
  });
  if(S.accentMark){ ctx.fillStyle=ac; ctx.fillRect(posH==='left'?0:posH==='right'?-36:-18,L.totalH/2+26,36,4); }
  ctx.restore();
}

// estilo propio de la línea seleccionada
function lnLoad(){
  const on=!!sel; $('lnBox').style.display=on&&featurePro?'block':'none'; $('lnHint').style.display=on&&!featurePro?'block':on?'none':'block'; if(!on)return;
  if(!featurePro){$('lnHint').innerHTML='🔒 <b>Estilo por línea es PRO</b><br>Usa tipografía, composición, color, capas y rotación propios para cada línea.<br><button class="btn-sm" id="lnProUnlock" type="button">Ver vista previa PRO</button>';const b=$('lnProUnlock');if(b)b.onclick=()=>openLineStylePreview();return;}
  const st=sel.st||{}; $('lnComp').value=st.comp||''; buildCompositionOptions(); markComposition(); $('lnFont').value=st.font||''; $('lnSize').value=st.sz||100; $('lnRot').value=st.rot||0; $('lnLane').value=(sel.ly||0)+1; $('lnAnim').value=st.anim||''; $('lnColorOn').checked=!!st.color; $('lnColor').value=st.color||S.textColor||'#ffffff';
  $('lnStrokeW').value=st.sw??S.strokeW; $('lnStrokeColor').value=st.sc??S.strokeColor; $('lnGlowAmt').value=st.gl??S.glowAmt; $('lnGlowColor').value=st.gc??S.glowColor; $('lnShAmt').value=st.sb??S.shAmt; $('lnShDist').value=st.sd??S.shDist;syncCompositionAnimationControl();
}
['lnComp','lnAnim','lnFont','lnSize','lnRot','lnColorOn','lnColor'].forEach(id=>$(id).addEventListener('input',()=>{
  if(!sel) return;
  if(!requireProFeature('El estilo personalizado por línea')){lnLoad();return;}
  if(id==='lnComp'&&!canUseComposition($('lnComp').value)){ $('lnComp').value=sel.st?.comp||''; openUpgradeForFeature(); return; }
  if(id==='lnFont'&&!canUseFont($('lnFont').value)){ $('lnFont').value=sel.st?.font||''; openUpgradeForFeature(); return; }
  if(id==='lnAnim'&&!canUseAnimation($('lnAnim').value)){ $('lnAnim').value=sel.st?.anim||''; openUpgradeForFeature(); return; }
  const st=sel.st||(sel.st={});
  if($('lnAnim').value) st.anim=$('lnAnim').value; else delete st.anim;
  if($('lnComp').value) st.comp=$('lnComp').value; else delete st.comp;
  if($('lnColorOn').checked) st.color=$('lnColor').value; else delete st.color;
  if($('lnFont').value) st.font=$('lnFont').value; else delete st.font;
  if(+$('lnSize').value!==100) st.sz=+$('lnSize').value; else delete st.sz;
  if(+$('lnRot').value!==0) st.rot=+$('lnRot').value; else delete st.rot;
  if(!Object.keys(st).length) delete sel.st; syncCompositionAnimationControl();redraw();markComposition();
}));

// efectos propios de la línea: solo se guardan los que el usuario toca
const LN_FX={lnStrokeW:'sw',lnStrokeColor:'sc',lnGlowAmt:'gl',lnGlowColor:'gc',lnShAmt:'sb',lnShDist:'sd'};
Object.keys(LN_FX).forEach(id=>$(id).addEventListener('input',()=>{
  if(!sel) return;
  if(!requireProFeature('El estilo personalizado por línea')){lnLoad();return;}
  const st=sel.st||(sel.st={}), el=$(id); st[LN_FX[id]]=el.type==='color'?el.value:+el.value; redraw();
}));
$('lnFxReset').addEventListener('click',()=>{
  if(!sel||!sel.st) return;
  Object.values(LN_FX).forEach(k=>delete sel.st[k]);
  if(!Object.keys(sel.st).length) delete sel.st;
  lnLoad(); redraw();
});

const FONTS=[{f:'Anton',w:400,c:'Impacto'},{f:'Bebas Neue',w:400,c:'Impacto'},{f:'Archivo Black',w:400,c:'Impacto'},{f:'Oswald',w:700,c:'Impacto'},{f:'Montserrat',w:800,c:'Impacto'},{f:'Poppins',w:800,c:'Impacto'},{f:'Russo One',w:400,c:'Impacto'},{f:'Inter',w:800,c:'Impacto'},{f:'Space Grotesk',w:700,c:'Impacto'},{f:'Bungee',w:400,c:'Divertidas'},{f:'Lilita One',w:400,c:'Divertidas'},{f:'Fredoka',w:700,c:'Divertidas'},{f:'Luckiest Guy',w:400,c:'Divertidas'},{f:'Bangers',w:400,c:'Divertidas'},{f:'Righteous',w:400,c:'Divertidas'},{f:'Creepster',w:400,c:'Divertidas'},{f:'Orbitron',w:800,c:'Tech y retro'},{f:'Press Start 2P',w:400,c:'Tech y retro'},{f:'Space Mono',w:700,c:'Tech y retro'},{f:'JetBrains Mono',w:700,c:'Tech y retro'},{f:'Monoton',w:400,c:'Tech y retro'},{f:'Playfair Display',w:800,c:'Elegantes'},{f:'Abril Fatface',w:400,c:'Elegantes'},{f:'DM Serif Display',w:400,c:'Elegantes'},{f:'Cinzel',w:700,c:'Elegantes'},{f:'Pacifico',w:400,c:'Manuscritas'},{f:'Lobster',w:400,c:'Manuscritas'},{f:'Dancing Script',w:700,c:'Manuscritas'},{f:'Caveat',w:700,c:'Manuscritas'},{f:'Permanent Marker',w:400,c:'Manuscritas'},{f:'Alfa Slab One',w:400,c:'Impacto'},{f:'Teko',w:700,c:'Impacto'},{f:'Barlow Condensed',w:700,c:'Impacto'},{f:'Kanit',w:800,c:'Impacto'},{f:'Rubik',w:800,c:'Impacto'},{f:'Black Ops One',w:400,c:'Divertidas'},{f:'Chewy',w:400,c:'Divertidas'},{f:'Fugaz One',w:400,c:'Tech y retro'},{f:'VT323',w:400,c:'Tech y retro'},{f:'Cormorant Garamond',w:700,c:'Elegantes'},{f:'Lora',w:700,c:'Elegantes'},{f:'Great Vibes',w:400,c:'Manuscritas'},{f:'Satisfy',w:400,c:'Manuscritas'},{f:'Sacramento',w:400,c:'Manuscritas'},{f:'Shadows Into Light',w:400,c:'Manuscritas'}];
// ================= FASE 4: tipografías y estilos =================
const fontW=f=>(FONTS.find(x=>x.f===f)||{w:400}).w, fontReq=new Set();
function needFont(f){ if(!document.fonts||fontReq.has(f)||document.fonts.check(f)) return; fontReq.add(f); document.fonts.load(f).then(()=>{ LC.clear(); drawFrame(getCurrentTime()); }); }
// efectos del texto efectivos: los de la línea (st.sw/sc/gl/gc/sb/sd) mandan sobre los generales
let paintSty=null;
function textFx(){ const o=paintSty||{}; return {sw:o.sw??S.strokeW, sc:o.sc??S.strokeColor, gl:o.gl??S.glowAmt, gc:o.gc??S.glowColor, sb:o.sb??S.shAmt, sd:o.sd??S.shDist}; }
function paint(str,x,y,col,w){
  const sc=w/720, E=textFx(); ctx.fillStyle=col;
  if(E.sw>0){ ctx.lineJoin='round'; ctx.lineWidth=E.sw*2*sc; ctx.strokeStyle=E.sc; ctx.strokeText(str,x,y); }
  if(E.sb>0||E.sd>0){ ctx.shadowColor='rgba(0,0,0,0.6)'; ctx.shadowBlur=E.sb*sc; ctx.shadowOffsetY=E.sd*sc; ctx.fillText(str,x,y); }
  if(E.gl>0){ ctx.shadowColor=E.gc; ctx.shadowOffsetY=0; ctx.shadowBlur=E.gl*sc; ctx.fillText(str,x,y); ctx.fillText(str,x,y); }
  ctx.shadowColor='transparent'; ctx.shadowBlur=0; ctx.shadowOffsetY=0; ctx.fillText(str,x,y);
}
$('fontSelect').innerHTML=FONTS.map(f=>`<option value="${f.f}">${f.f}</option>`).join(''); $('fontSelect').value='Space Grotesk';
const FREE_FONTS=new Set(['Anton','Bebas Neue','Archivo Black','Bungee','Fredoka','Righteous','Orbitron','JetBrains Mono','Playfair Display','Pacifico']);
const FREE_ANIMATIONS=new Set(['fade','slide','pop','karaoke','cfade','cup','cdrop','cpop']);
const COMP_LAYOUTS=[
  {id:'stair',n:'Escalera'}, {id:'zigzag',n:'Zigzag'}, {id:'center',n:'Centro protagonista'},
  {id:'column',n:'Columna editorial'}, {id:'wave',n:'Onda'}, {id:'diagonal',n:'Diagonal'},
  {id:'bookends',n:'Palabras de apertura y cierre'}, {id:'orbit',n:'Órbita'}
];
const COMP_ENTRIES=[
  {id:'rise',n:'suben en secuencia',order:'forward'},
  {id:'drop',n:'caen en secuencia',order:'forward'},
  {id:'zoom',n:'aparecen desde el centro',order:'center'}
];
const COMPOSITIONS=COMP_LAYOUTS.flatMap(layout=>COMP_ENTRIES.map(entry=>({
  id:layout.id+'-'+entry.id,n:layout.n+' · '+entry.n,layout:layout.id,entry:entry.id,order:entry.order
})));
let featurePro=false;
const canUseFont=name=>featurePro||!name||FREE_FONTS.has(name);
const canUseAnimation=name=>featurePro||!name||name==='none'||FREE_ANIMATIONS.has(name);
const canUseComposition=id=>featurePro||!id;
function openUpgradeForFeature(){ if(typeof acctOpen==='function') acctOpen(); }
function requireProFeature(name='Esta función'){
  if(featurePro)return true;
  toast(name+' es una función exclusiva de Lyric Studio PRO.');
  openUpgradeForFeature();
  return false;
}
function proTeaser(title,description,body){
  const modal=document.createElement('div');modal.className='pro-teaser-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label',title);
  modal.innerHTML=`<section class="pro-teaser-window"><header class="pro-teaser-head"><div><span class="pro-teaser-kicker">Vista previa · Lyric Studio PRO</span><h2>${title}</h2><p>${description}</p></div><button class="btn-sm" type="button" data-teaser-close aria-label="Cerrar">×</button></header>${body}<div class="pro-teaser-actions"><button class="btn-sm" type="button" data-teaser-close>Seguir en Free</button><button class="btn-primary" type="button" data-teaser-upgrade>Ver Lyric Studio PRO</button></div></section>`;
  const escKey=e=>{if(e.key==='Escape')close();},close=()=>{modal.remove();document.removeEventListener('keydown',escKey,true);};
  document.body.append(modal);modal.querySelectorAll('[data-teaser-close]').forEach(b=>b.onclick=close);modal.addEventListener('click',e=>{if(e.target===modal)close();});modal.querySelector('[data-teaser-upgrade]').onclick=()=>{close();requireProFeature(title);};
  document.addEventListener('keydown',escKey,true);return modal;
}
function openLayersPreview(){
  const lines=lyricLines.slice().sort((a,b)=>a.start-b.start).slice(0,8),fallback=[{start:0,end:4,text:'Tu letra en una capa'},{start:3,end:8,text:'Y la siguiente en otra'}],items=lines.length?lines:fallback;
  const lo=lines.length?Math.min(...lines.map(l=>l.start)):0,hi=lines.length?Math.max(...lines.map(l=>l.end)):10,dur=Math.max(.1,hi-lo);
  const active=activeLines(getCurrentTime()),monitor=(active.length>=2?active:items).slice(0,2);
  const monitorHtml=monitor.map((l,i)=>`<div class="pro-teaser-line${i?' alt':''}">${esc(l.text||'Tu letra')}</div>`).join('');
  const lanes=[0,1].map(lane=>`<div class="pro-teaser-lane"><span>Capa ${lane+1}</span>${items.filter((_,i)=>i%2===lane).map(l=>{const left=Math.max(0,Math.min(94,(l.start-lo)/dur*100)),width=Math.max(5,Math.min(100-left,(l.end-l.start)/dur*100));return `<div class="pro-teaser-block${lane?' alt':''}" style="left:${left}%;width:${width}%">${esc(l.text||'Línea')}</div>`;}).join('')}</div>`).join('');
  return proTeaser('Así se vería tu video en capas','Una muestra de tus líneas repartidas entre dos pistas. Es una vista de ejemplo; no cambia el proyecto.',`<div class="pro-teaser-body"><div class="pro-teaser-panel"><h3>Monitor · composición</h3><div class="pro-teaser-monitor">${monitorHtml}</div></div><div class="pro-teaser-panel"><h3>Timeline · capas separadas</h3><div class="pro-teaser-track">${lanes}</div><div class="pro-teaser-lock">🔒 En PRO puedes organizar y ajustar las capas.</div></div></div>`);
}
function openKeyframePreview(i){
  const l=lyricLines[i]||lyricLines.find(Boolean)||{text:'Cada palabra sigue el ritmo'};
  const phrase=wordsOf(l.text||'Cada palabra sigue el ritmo').slice(0,6).join(' ')||'Cada palabra sigue el ritmo';
  return proTeaser('Movimiento con keyframes','Mira cómo se anima una línea a lo largo de su duración. Esta vista es solo una muestra.',`<div class="pro-teaser-body"><div class="pro-teaser-panel"><h3>Vista previa de la línea</h3><div class="pro-teaser-kf-stage"><div class="pro-teaser-kf-text">${esc(phrase)}</div></div><div class="pro-teaser-disabled-controls" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div></div><div class="pro-teaser-panel"><h3>Vida del texto · ${fmtTimeShort(l.end-l.start||3)}</h3><div class="pro-teaser-timeline"><i class="pro-teaser-marker" style="left:12%"></i><i class="pro-teaser-marker" style="left:51%"></i><i class="pro-teaser-marker" style="left:88%"></i></div><div class="pro-teaser-lock">🔒 En PRO puedes arrastrar keyframes y cambiar posición, escala, giro y opacidad.</div></div></div>`);
}
function openWatermarkPreview(){
  const phrase=sel?.text||lyricLines.find(Boolean)?.text||'Tu letra sobre el video';
  return proTeaser('Marca de agua personalizada','En Free, LyricStudio.site aparece siempre en el video. PRO permite personalizar o quitar la marca. Esta es solo una muestra.',`<div class="pro-teaser-body"><div class="pro-teaser-panel"><h3>Vista previa · esquina inferior</h3><div class="pro-teaser-watermark-stage"><div class="pro-teaser-watermark-lyric">${esc(phrase)}</div><span class="pro-teaser-watermark-mark">LyricStudio.site</span></div></div><div class="pro-teaser-panel"><h3>Opciones PRO</h3><div class="pro-teaser-options"><div class="pro-teaser-option"><b>Contenido</b><br>Texto · imagen · video en bucle</div><div class="pro-teaser-option"><b>Ubicación</b><br>Cuatro esquinas del cuadro<div class="pro-teaser-control"></div></div><div class="pro-teaser-option"><b>Tamaño y opacidad</b><br>Ajustes visuales personalizados</div></div><div class="pro-teaser-lock">🔒 En PRO puedes personalizar o quitar la marca de agua.</div></div></div>`);
}
function openFontPreview(){
  const phrase=sel?.text||lyricLines.find(Boolean)?.text||'Tu letra, tu estilo';
  return proTeaser('Sube tus propias tipografías','Importa una fuente para darle una identidad propia al video. La carga de tipografías personalizadas está incluida en PRO.',`<div class="pro-teaser-body"><div class="pro-teaser-panel"><h3>Vista previa de texto</h3><div class="pro-teaser-monitor"><div class="pro-teaser-line">${esc(phrase)}</div><div class="pro-teaser-line alt" style="font-family:'Bangers',var(--display)">${esc(phrase)}</div></div></div><div class="pro-teaser-panel"><h3>Tipografía personalizada</h3><div class="pro-teaser-options"><div class="pro-teaser-option"><b>Formatos compatibles</b><br>.TTF · .OTF · .WOFF · .WOFF2</div><div class="pro-teaser-option"><b>Vista inmediata</b><br>Prueba la fuente sobre tus líneas</div><div class="pro-teaser-option"><b>Se guarda en el proyecto</b><br>La fuente viaja dentro del archivo .lyr</div></div><div class="pro-teaser-lock">🔒 Subir y usar tipografías propias es una función PRO.</div></div></div>`);
}
function openLineStylePreview(){
  const l=sel||lyricLines.find(Boolean)||{text:'Cada línea con su propio estilo',start:0,end:4},phrase=l.text||'Cada línea con su propio estilo',parts=wordsOf(phrase).slice(0,7),split=Math.max(1,Math.ceil(parts.length/2));
  const chunks=[parts.slice(0,split).join(' '),parts.slice(split).join(' ')].filter(Boolean),lines=chunks.map((w,i)=>`<div class="pro-teaser-line${i?' alt':''}">${esc(w)}</div>`).join('');
  return proTeaser('Estilo independiente por línea','Cada línea puede tener su propia apariencia y composición. Esta vista es una muestra; no cambia el proyecto.',`<div class="pro-teaser-body"><div class="pro-teaser-panel"><h3>Monitor · línea seleccionado</h3><div class="pro-teaser-line-stage">${lines}</div><div class="pro-teaser-timeline"><i class="pro-teaser-marker" style="left:14%"></i><i class="pro-teaser-marker" style="left:68%"></i></div></div><div class="pro-teaser-panel"><h3>Ajustes por línea</h3><div class="pro-teaser-options"><div class="pro-teaser-option"><b>Tipografía y tamaño</b><div class="pro-teaser-control"></div></div><div class="pro-teaser-option"><b>Composición y animación</b><br>Control independiente para esta línea</div><div class="pro-teaser-option"><b>Color · capa · rotación</b><br>Cambia una línea sin afectar las demás</div></div><div class="pro-teaser-lock">🔒 En PRO desbloqueas el estilo personalizado para cada línea.</div></div></div>`);
}
const TUTORIAL_KEY='lyricStudio.tutorial',tutorialQuery=new URLSearchParams(location.search).get('tutorial');
let tutorialAccountReady=false,tutorialRequestedMode=tutorialQuery==='pro'?'pro':null,tutorialRequestedPreview=false,tutorialRunMode='free',tutorialProPreview=false,tutorialActive=false,tutorialRoot=null,tutorialResizeHandler=null,tutorialKeyHandler=null,tutorialIndex=0,tutorialSteps=[],tutorialPreviousTab='',tutorialPreviousSelection=null,tutorialCardManual=false;
function tutorialPlan(mode){
  const common=[
    {title:'Letra y tiempos',target:'#dropLyrics',tab:'letra',mode:'lyrics',text:'Importa una letra .LRC o .SRT, pega tus líneas o escribilos. Si no tienen tiempos, puedes sincronizarlos después.'},
    {title:'Sincroniza en el timeline',target:'#dock .tlwrap',mode:'lyrics',text:'Cada bloque representa una línea. Arrástralo para moverlo y usa sus bordes para ajustar cuándo aparece y desaparece.'},
    {title:'Carga el audio',target:'#dropAudio',tab:'letra',mode:'lyrics',text:'Sube aquí el audio de tu canción. El archivo acompaña la sincronización y se mezcla en la exportación.'},
    {title:'Elige el fondo',target:'#vpane .vbody > .panel:last-child h2',mode:'video',text:'En Video eliges un fondo de color, degradado, imagen o video. Para cargar el audio, vuelve a la sección Letra.'},
    {title:'Dale estilo a la letra',target:'#side [data-t="texto"] .panel:first-child h2',tab:'texto',mode:'lyrics',text:'Desde el comienzo de esta sección eliges tipografía, animación, tamaño y color. La vista central muestra el resultado.'},
    {title:'Revisa el resultado',target:'#center .pv',mode:'lyrics',text:'Usa los controles de reproducción para revisar la sincronización y el aspecto antes de exportar.'},
    {title:'Guarda y exporta',target:'#brandMenu [data-action="export"]',menu:true,text:'Desde el menú de Lyric Studio puedes abrir o guardar proyectos y exportar el video. En Free se incluye la marca LyricStudio.site.'}
  ];
  if(mode!=='pro')return common;
  return common.concat([
    {title:'Sube tu tipografía',target:'#dropFont',tab:'texto',text:'Importa una fuente .TTF, .OTF o .WOFF. Se guarda dentro del proyecto para que puedas volver a usarla.'},
    {title:'Personaliza cada línea',target:'#lnPanel',tab:'texto',selectFirst:true,text:'Selecciona una línea para cambiar solo en esa línea su tipografía, composición, animación, color, tamaño o rotación.'},
    {title:'Acciones rápidas y keyframes',target:'#lyricsLog',tab:'letra',selectFirst:true,info:'keyframes',text:'Haz clic derecho en una línea y elige Keyframes. En la ventana visual mueves el cursor por la vida del texto, arrastras la línea y agregas puntos para animar su posición, escala, rotación y opacidad.'},
    {title:'Organiza en dos capas',target:'#autoL',tab:'letra',text:'Alterna tus líneas en dos capas para ordenar las entradas y mantener cada línea visible mientras aparece la siguiente.'},
    {title:'Personaliza la marca de agua',target:'#wmConfigOpen',tab:'pos',info:'watermark',text:'Abre Configurar marca de agua para usar texto, imagen o video en bucle. Elige la esquina, el tamaño y la opacidad; en PRO también puedes desactivarla.'},
    {title:'Modo Estudio',target:'#brandMenu [data-action="study"]',menu:true,text:'Activa la vista doble: una pantalla de edición con guías y otra limpia, tal como se verá el video.'},
    {title:'WorkStation y monitores',target:'#brandMenu [data-action="workstation"]',menu:true,info:'workstation',text:'WorkStation mantiene el editor y la timeline en el monitor principal. Abre otra ventana con la información de la línea y una vista previa grande para ubicarla en el segundo monitor.'},
    {title:'Exportación PRO',target:'#brandMenu [data-action="export"]',menu:true,text:'En MP4 puedes elegir resolución y FPS compatibles con tu equipo. Las exportaciones de alta calidad exigen más recursos.'}
  ]);
}
function tutorialInfoMarkup(kind){
  if(kind==='keyframes')return '<div class="tutorial-info-head"><div><span class="tutorial-info-label">Ventana informativa · PRO</span><h3 id="tutorialInfoTitle">Keyframes: anima la vida de la línea</h3></div><button class="btn-sm tutorial-info-close" type="button" data-info-close aria-label="Cerrar ventana">×</button></div><p>Un keyframe guarda una pose del texto en un instante. Al agregar varios, Lyric Studio interpola el movimiento entre ellos.</p><div class="tutorial-kf-demo"><div class="tutorial-kf-stage"><span class="tutorial-kf-word">Tu línea</span></div><div class="tutorial-kf-track"><i style="left:12%"></i><i style="left:48%"></i><i style="left:84%"></i><b></b></div></div><div class="tutorial-info-list"><span>1. Elige una línea y abre Keyframes</span><span>2. Mueve el cursor por su duración</span><span>3. Arrastra el texto a otra pose</span><span>4. Agrega puntos y ajusta escala, giro y opacidad</span></div><p>La línea representa desde que aparece la línea hasta que desaparece; los rombos son sus keyframes.</p>';
  if(kind==='watermark')return '<div class="tutorial-info-head"><div><span class="tutorial-info-label">Ventana informativa · PRO</span><h3 id="tutorialInfoTitle">Marca de agua a tu manera</h3></div><button class="btn-sm tutorial-info-close" type="button" data-info-close aria-label="Cerrar ventana">×</button></div><p>La marca aparece encima del video durante la reproducción y la exportación. En Free se mantiene la firma LyricStudio.site; PRO permite personalizarla.</p><div class="tutorial-wm-demo"><div class="tutorial-wm-screen">Vista del lyric video<span class="tutorial-wm-mark">Tu marca</span></div></div><div class="tutorial-info-list"><span>Texto propio o imagen</span><span>Video en bucle</span><span>Esquina y tamaño</span><span>Opacidad y activación</span></div><p>Usa <b>Configurar marca de agua…</b> para abrir los controles. La muestra del tutorial no modifica tu proyecto.</p>';
  if(kind==='workstation')return '<div class="tutorial-info-head"><div><span class="tutorial-info-label">WorkStation · PRO</span><h3 id="tutorialInfoTitle">Edita en una pantalla y monitorea en otra</h3></div><button class="btn-sm tutorial-info-close" type="button" data-info-close aria-label="Cerrar ventana">×</button></div><div class="tutorial-workstation-demo"><div><b>MONITOR 1 · EDICIÓN</b><span>Editor + timeline</span></div><i>⇄</i><div><b>MONITOR 2 · SALIDA</b><span>Información + vista previa grande</span></div></div><p>En el menú de Lyric Studio elige <b>Configurar monitores…</b>, asigna la pantalla principal y la de salida, y abre WorkStation. Si el navegador no puede detectar las pantallas, mueve la ventana de salida manualmente.</p>';
  return '';
}
function tutorialPaintSpot(){
  if(!tutorialActive||!tutorialRoot)return;const step=tutorialSteps[tutorialIndex],menu=document.getElementById('brandMenu'),brand=document.querySelector('.brand-trigger');
  if(menu){menu.hidden=!step.menu;if(brand)brand.setAttribute('aria-expanded',String(step.menu));}
  const target=document.querySelector(step.target);if(target&&target.getClientRects().length)target.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    if(!tutorialActive||!tutorialRoot)return;
    const el=document.querySelector(step.target),r=el&&el.getClientRects().length?el.getBoundingClientRect():null,W=innerWidth,H=innerHeight,pad=r?8:0;
    const x1=r?Math.max(0,r.left-pad):0,y1=r?Math.max(0,r.top-pad):0,x2=r?Math.min(W,r.right+pad):0,y2=r?Math.min(H,r.bottom+pad):0,spot=tutorialRoot.querySelector('.tutorial-spotlight');
    spot.hidden=!r;
    if(r){Object.assign(spot.style,{left:x1+'px',top:y1+'px',width:Math.max(0,x2-x1)+'px',height:Math.max(0,y2-y1)+'px'});}
    const masks=tutorialRoot.querySelectorAll('.tutorial-mask'),rects=[{left:0,top:0,width:W,height:y1},{left:0,top:y2,width:W,height:Math.max(0,H-y2)},{left:0,top:y1,width:x1,height:Math.max(0,y2-y1)},{left:x2,top:y1,width:Math.max(0,W-x2),height:Math.max(0,y2-y1)}];
    masks.forEach((m,i)=>Object.assign(m.style,{left:rects[i].left+'px',top:rects[i].top+'px',width:rects[i].width+'px',height:rects[i].height+'px'}));
    const card=tutorialRoot.querySelector('.tutorial-card');
    if(!tutorialCardManual){
      const cw=card.offsetWidth,ch=card.offsetHeight,g=14,clamp=(v,min,max)=>Math.max(min,Math.min(v,max));
      const candidates=[[g,g],[W-cw-g,g],[g,H-ch-g],[W-cw-g,H-ch-g]];
      const score=([left,top])=>{left=clamp(left,g,W-cw-g);top=clamp(top,g,H-ch-g);if(!r)return{left,top,score:0};const ox=Math.max(0,Math.min(left+cw,x2)-Math.max(left,x1)),oy=Math.max(0,Math.min(top+ch,y2)-Math.max(top,y1));return{left,top,score:ox*oy};};
      const best=candidates.map(score).sort((a,b)=>a.score-b.score)[0];Object.assign(card.style,{left:best.left+'px',top:best.top+'px',right:'auto',bottom:'auto'});tutorialCardManual=true;
    }else{
      const cr=card.getBoundingClientRect(),left=Math.max(14,Math.min(cr.left,W-cr.width-14)),top=Math.max(14,Math.min(cr.top,H-cr.height-14));
      Object.assign(card.style,{left:left+'px',top:top+'px',right:'auto',bottom:'auto'});
    }
  }));
}
function tutorialShowStep(index){
  if(!tutorialActive)return;
  tutorialIndex=Math.max(0,Math.min(index,tutorialSteps.length-1));const step=tutorialSteps[tutorialIndex];
  const currentMode=document.body.classList.contains('mv')?'video':'lyrics',modeChanged=!!step.mode&&step.mode!==currentMode;
  if(modeChanged)setMode(step.mode,step.mode==='video'?false:undefined);
  const rail=step.tab&&document.querySelector(`#rail button[data-t="${step.tab}"]`),tabChanged=!!rail&&!rail.classList.contains('on');if(tabChanged)rail.click();
  if(modeChanged||tabChanged){const side=document.getElementById('side');if(side)side.scrollTop=0;}
  if(step.selectFirst&&lyricLines.length&&!sel){sel=lyricLines[0];markSel();}
  tutorialRoot.querySelector('.tutorial-kicker').textContent='Recorrido '+(tutorialRunMode==='pro'?'PRO':'Free')+' · '+(tutorialIndex+1)+' / '+tutorialSteps.length;
  tutorialRoot.querySelector('h2').textContent=step.title;tutorialRoot.querySelector('.tutorial-copy').textContent=step.text;
  const info=tutorialRoot.querySelector('.tutorial-info-window');info.hidden=!step.info;info.innerHTML=step.info?tutorialInfoMarkup(step.info):'';info.querySelector('[data-info-close]')?.addEventListener('click',()=>{info.hidden=true;});
  tutorialRoot.querySelector('[data-tour-back]').disabled=tutorialIndex===0;
  tutorialRoot.querySelector('[data-tour-next]').textContent=tutorialIndex===tutorialSteps.length-1?'Terminar':'Siguiente →';
  tutorialPaintSpot();
}
function closeTutorial(){
  if(!tutorialActive)return;tutorialActive=false;
  if(!tutorialProPreview)try{localStorage.setItem(TUTORIAL_KEY+'.'+tutorialRunMode+'.done','1');}catch(e){}
  document.removeEventListener('keydown',tutorialKeyHandler,true);window.removeEventListener('resize',tutorialResizeHandler);window.removeEventListener('scroll',tutorialResizeHandler,true);
  const menu=document.getElementById('brandMenu'),brand=document.querySelector('.brand-trigger');if(menu)menu.hidden=true;if(brand)brand.setAttribute('aria-expanded','false');tutorialRoot?.remove();tutorialRoot=null;
  if(tutorialPreviousSelection!==sel){sel=tutorialPreviousSelection;if(sel)markSel();else{lnLoad();document.querySelectorAll('#lyricsLog .lrow').forEach(r=>r.classList.remove('sel'));}}
  const rail=tutorialPreviousTab&&document.querySelector(`#rail button[data-t="${tutorialPreviousTab}"]`);if(rail)rail.click();
  drawFrame(getCurrentTime());
}
function startTutorial(mode,manual=false,preview=false){
  if(!home.hidden){tutorialRequestedMode=mode;tutorialRequestedPreview=preview;return;}
  if(mode==='pro'&&!featurePro&&!preview)mode='free';if(tutorialActive)closeTutorial();
  tutorialCardManual=false;tutorialRunMode=mode;tutorialProPreview=mode==='pro'&&preview;tutorialSteps=tutorialPlan(mode);tutorialIndex=0;tutorialPreviousTab=document.querySelector('#rail button.on')?.dataset.t||'letra';tutorialPreviousSelection=sel;tutorialActive=true;
  tutorialRoot=document.createElement('div');tutorialRoot.id='tutorialRoot';tutorialRoot.innerHTML='<div class="tutorial-mask"></div><div class="tutorial-mask"></div><div class="tutorial-mask"></div><div class="tutorial-mask"></div><div class="tutorial-spotlight" hidden></div><section class="tutorial-info-window" role="dialog" aria-modal="false" hidden></section><section class="tutorial-card" role="dialog" aria-modal="true" aria-labelledby="tutorialTitle"><div class="tutorial-dragbar" data-tour-drag title="Arrastra para mover este cuadro"><span class="tutorial-kicker"></span><span class="tutorial-draghint">⠿ Mover</span></div><h2 id="tutorialTitle"></h2><p class="tutorial-copy"></p><div class="tutorial-step-count">Usa ← y → para avanzar · Esc para salir</div><div class="tutorial-actions"><button class="btn-sm" type="button" data-tour-skip>Saltar</button><span class="grow"></span><button class="btn-sm" type="button" data-tour-back>← Atrás</button><button class="btn-primary" type="button" data-tour-next>Siguiente →</button></div></section>';
  const dragbar=tutorialRoot.querySelector('[data-tour-drag]'),card=tutorialRoot.querySelector('.tutorial-card');let dragState=null;
  dragbar.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=card.getBoundingClientRect();dragState={x:e.clientX-r.left,y:e.clientY-r.top};tutorialCardManual=true;card.style.left=r.left+'px';card.style.top=r.top+'px';card.style.right='auto';card.style.bottom='auto';dragbar.setPointerCapture(e.pointerId);e.preventDefault();});
  dragbar.addEventListener('pointermove',e=>{if(!dragState)return;const x=Math.max(14,Math.min(e.clientX-dragState.x,innerWidth-card.offsetWidth-14)),y=Math.max(14,Math.min(e.clientY-dragState.y,innerHeight-card.offsetHeight-14));card.style.left=x+'px';card.style.top=y+'px';});
  const endDrag=()=>{dragState=null;};dragbar.addEventListener('pointerup',endDrag);dragbar.addEventListener('pointercancel',endDrag);
  document.body.append(tutorialRoot);tutorialRoot.querySelector('.tutorial-step-count').textContent='← / → avanzar · Esc salir · O recorrido PRO';tutorialRoot.querySelector('[data-tour-skip]').onclick=closeTutorial;tutorialRoot.querySelector('[data-tour-back]').onclick=()=>tutorialShowStep(tutorialIndex-1);tutorialRoot.querySelector('[data-tour-next]').onclick=()=>tutorialIndex===tutorialSteps.length-1?closeTutorial():tutorialShowStep(tutorialIndex+1);
  tutorialKeyHandler=e=>{if(e.key==='Escape'){e.preventDefault();closeTutorial();}else if(e.key==='ArrowRight'){e.preventDefault();tutorialIndex===tutorialSteps.length-1?closeTutorial():tutorialShowStep(tutorialIndex+1);}else if(e.key==='ArrowLeft'){e.preventDefault();tutorialShowStep(tutorialIndex-1);}};
  tutorialResizeHandler=()=>tutorialPaintSpot();document.addEventListener('keydown',tutorialKeyHandler,true);window.addEventListener('resize',tutorialResizeHandler);window.addEventListener('scroll',tutorialResizeHandler,true);tutorialShowStep(0);
}
function maybeStartTutorial(){
  if(!tutorialAccountReady||!home.hidden||tutorialActive)return;
  if(tutorialRequestedMode){if(tutorialRequestedMode==='pro'&&!featurePro&&!tutorialRequestedPreview)return;const mode=tutorialRequestedMode,preview=tutorialRequestedPreview;tutorialRequestedMode=null;tutorialRequestedPreview=false;history.replaceState(null,'',location.pathname);startTutorial(mode,true,preview);return;}
  const mode=featurePro?'pro':'free';try{if(!localStorage.getItem(TUTORIAL_KEY+'.'+mode+'.done'))startTutorial(mode,false);}catch(e){startTutorial(mode,false);}
}
function updateProMarkers(){
  const marks=[['pstSave',true],['wmConfigOpen',true],['studyToggle',true],['autoL',true],['pngCaptureBtn',true],['dropFont',true]];
  marks.forEach(([id,on])=>{const el=$(id);if(el){const locked=on&&!featurePro;el.classList.toggle('pro-locked',locked);if(locked){el.dataset.proTitle=el.dataset.proTitle||el.title;el.title=(el.dataset.proTitle||el.textContent)+' · PRO';}else if(el.dataset.proTitle){el.title=el.dataset.proTitle;delete el.dataset.proTitle;}}});
  document.querySelectorAll('#lyricsLog [data-op="advanced"]').forEach(el=>{el.classList.toggle('pro-locked',!featurePro);el.title='Opciones avanzadas de la línea'+(featurePro?'':' · PRO');el.setAttribute('aria-label',el.title);el.textContent=featurePro?'⚙':'🔒';});
  const controls=document.querySelector('#brandMenu [data-action="controls"]'),guides=document.querySelector('#brandMenu [data-action="guides"]');
  if(controls)controls.classList.toggle('pro-locked',!featurePro);
  if(guides)guides.classList.toggle('pro-locked',!featurePro);
  const studyMenu=document.querySelector('#brandMenu [data-action="study"]'),workstationMenu=document.querySelector('#brandMenu [data-action="workstation"]'),watermarkMenu=document.querySelector('#brandMenu [data-action="watermark"]'),captureMenu=document.querySelector('#brandMenu [data-action="capture"]'),keyframeMenu=document.querySelector('.line-context [data-line-action="kf"]');
  [studyMenu,workstationMenu,watermarkMenu,captureMenu,keyframeMenu].forEach(el=>el?.classList.toggle('pro-locked',!featurePro));
  if(typeof pstBuild==='function')pstBuild();
  const mp4=$('expFormat')?.querySelector('option[value="mp4"]');if(mp4)mp4.textContent='MP4 · cuadro por cuadro'+(featurePro?'':' · 🔒 PRO');
}
function drawCompositionPreview(target,comp,text,sty={}){
  const c=target.getContext('2d'),w=target.width,h=target.height,phrase=S.upper?(text||'TU LETRA EN PANTALLA').toUpperCase():(text||'Tu letra en pantalla'),words=wordsOf(phrase),n=words.length;
  c.clearRect(0,0,w,h);const bg=c.createLinearGradient(0,0,w,h);bg.addColorStop(0,TC('#342744'));bg.addColorStop(1,TC('#17121d'));c.fillStyle=bg;c.fillRect(0,0,w,h);
  if(!n)return;
  const fs=Math.max(9,S.fontSize*(w/720)*((sty.sz||100)/100)),fam=sty.font||S.font,maxRowW=w*.82,gap=fs*.13;
  c.font=`${fontW(fam)} ${fs}px "${fam}"`;c.textBaseline='middle';c.textAlign='left';
  const entries=words.map((word,i)=>{const slot=comp?compositionSlot(comp.layout,i,n,fs,w):{x:0,y:0,scale:1};return {word,i,slot,metrics:c.measureText(word),size:Math.min(slot.scale,maxRowW/(c.measureText(word).width||1))};}),rows=[];let row=[];
  for(const item of entries){const itemW=item.metrics.width*item.size,used=row.reduce((sum,x)=>sum+x.metrics.width*x.size,0)+gap*row.length;if(row.length&&(comp?.layout==='column'||used+itemW>maxRowW)){rows.push(row);row=[];}row.push(item);}if(row.length)rows.push(row);
  rows.forEach(r=>{r.width=r.reduce((sum,x)=>sum+x.metrics.width*x.size,0)+gap*(r.length-1);r.height=Math.max(...r.map(x=>fs*x.size*1.18));});
  const rowGap=fs*.2,totalH=rows.reduce((sum,r)=>sum+r.height,0)+rowGap*(rows.length-1),fit=Math.min(1,(h*.68)/Math.max(1,totalH));let y=-totalH*fit/2;
  c.save();c.translate(w/2,h*.53);c.rotate((sty.rot||0)*Math.PI/180);c.fillStyle=sty.color||S.textColor||'#fff';c.shadowColor='#000b';c.shadowBlur=2;c.shadowOffsetY=1;
  rows.forEach((r,ri)=>{let shift=comp?.layout==='stair'?(ri-(rows.length-1)/2)*fs*.42:comp?.layout==='zigzag'?(ri%2?1:-1)*fs*.3:comp?.layout==='diagonal'?(ri-(rows.length-1)/2)*fs*.55:0;shift=Math.max(-maxRowW*.08,Math.min(maxRowW*.08,shift));let x=Math.max(-maxRowW/2,Math.min(maxRowW/2-r.width*fit,-r.width*fit/2+shift));
    r.forEach(item=>{const {slot,metrics,size,word,i}=item,ww=metrics.width*size*fit,yy=y+r.height*fit/2+(comp?.layout==='wave'?Math.sin(i*Math.PI/2)*fs*.12:comp?.layout==='zigzag'?(i%2?1:-1)*fs*.12:slot.y*fs*.08)*fit;c.save();c.translate(x+ww/2,yy);c.rotate(slot.rot||0);c.scale(size*fit,size*fit);c.fillText(word,-metrics.width/2,0);c.restore();x+=ww+gap*fit;});y+=r.height*fit+rowGap*fit;
  });c.restore();
}
function buildCompositionOptions(){
  const select=$('lnComp'),value=select.value;
  select.innerHTML='<option value="">Composición normal</option>'+COMPOSITIONS.map(c=>`<option value="${c.id}">${c.n}${featurePro?'':' · 🔒 Pro'}</option>`).join('');select.value=value;
  const sampleText=sel?.text||'Tu letra en pantalla',sty=sel?.st||{};
  const cards=[{id:'',n:'Composición normal',layout:null,entry:null,order:'forward'},...COMPOSITIONS];
  $('compGallery').innerHTML=cards.map(c=>`<button type="button" class="comp-card${value===c.id?' selected':''}${c.id&&!featurePro?' pro-only':''}" data-comp="${c.id}" aria-pressed="${value===c.id}" title="${c.n}"><canvas class="comp-thumb" width="240" height="135" aria-hidden="true"></canvas><span class="comp-title">${c.n}</span>${c.id&&!featurePro?'<span class="comp-lock">🔒 PRO</span>':''}</button>`).join('');
  $('compGallery').querySelectorAll('[data-comp]').forEach((card,i)=>drawCompositionPreview(card.querySelector('canvas'),i?COMPOSITIONS[i-1]:null,sampleText,sty));
}
function markComposition(){
  const value=$('lnComp').value;
  document.querySelectorAll('#compGallery [data-comp]').forEach(b=>{
    const selected=b.dataset.comp===value;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));
  });
  const selected=COMPOSITIONS.find(c=>c.id===value)||null;$('compSelectedName').textContent=selected?.n||'Composición normal';drawCompositionPreview($('compSelectedThumb'),selected,sel?.text||'Tu letra en pantalla',sel?.st||{});
}
function syncCompositionAnimationControl(){const active=!!$('lnComp').value;$('lnAnim').disabled=active;$('lnAnimHint').hidden=!active;}
$('compGallery').addEventListener('click',e=>{
  const card=e.target.closest('[data-comp]');if(!card||!sel)return;
  if(card.dataset.comp&&!requireProFeature('Los presets de composición'))return;
  const value=card.dataset.comp,st=sel.st||(sel.st={});$('lnComp').value=value;if(value)st.comp=value;else delete st.comp;if(!Object.keys(st).length)delete sel.st;syncCompositionAnimationControl();markComposition();redraw();$('compPicker').open=false;
});
function compositionOrder(order,i,n){
  if(order==='reverse') return n-1-i;
  if(order==='center') return Math.abs(i-(n-1)/2);
  return i;
}
function compositionSlot(kind,i,n,fs,w){
  const q=n<2?.5:i/(n-1), x=(q-.5)*.64, alt=i%2?1:-1;
  if(kind==='stair') return {x,y:(.5-q)*1.5,scale:.78+.62*q};
  if(kind==='zigzag') return {x,y:alt*.52,scale:i%2?.82:1.18};
  if(kind==='center') return {x,y:(Math.abs(q-.5)-.25)*.9,scale:1.34-Math.abs(q-.5)*.95};
  if(kind==='column') return {x:alt*.16,y:(q-.5)*2.8,scale:1.12-.28*q};
  if(kind==='wave') return {x,y:Math.sin(q*Math.PI*2)*.68,scale:.88+.25*(.5+.5*Math.sin(q*Math.PI*2))};
  if(kind==='diagonal') return {x,y:(q-.5)*1.55,scale:.78+.55*q};
  if(kind==='bookends') return {x,y:alt*.18,scale:(i===0||i===n-1)?1.34:.78};
  const a=i*2.4, r=.18+.18*(i%3); return {x:Math.cos(a)*r,y:Math.sin(a)*r*2.2,scale:1.2-.12*(i%3),rot:Math.sin(a)*.08};
}
function drawComposition(l,t,sty,lyOff,comp){
  const w=canvas.width,h=canvas.height,words=wordsOf(S.upper?l.text.toUpperCase():l.text),n=words.length;
  if(!n) return;
  const fs=S.fontSize*(w/720)*((sty.sz||100)/100),fam=sty.font||S.font,col=sty.color||S.textColor;
  const fnt=`${fontW(fam)} ${fs}px "${fam}"`; ctx.font=fnt; needFont(fnt); ctx.textBaseline='middle'; ctx.textAlign='left';
  const pose=keyframeState(l,t),ax=(posH==='left'?w*.08:posH==='right'?w*.92:w/2)+(sty.dx||0)*w+(pose.x/100)*w;
  const cy=getTextY(h)+(sty.dy||0)*h+(pose.y/100)*h+(lyOff||0),dur=Math.max(.01,l.end-l.start),step=Math.min(.18,Math.max(.035,(dur-.28)/Math.max(1,n-1))),span=Math.max(.12,Math.min(.42,dur*.22));
  const maxRowW=w*.82,gap=fs*.13,entries=words.map((word,i)=>{
    const slot=compositionSlot(comp.layout,i,n,fs,w),metrics=ctx.measureText(word);
    return {word,i,slot,metrics,size:Math.min(slot.scale,maxRowW/(metrics.width||1))};
  }),rows=[];let row=[];
  for(const item of entries){
    const itemW=item.metrics.width*item.size,used=row.reduce((sum,x)=>sum+x.metrics.width*x.size,0)+gap*row.length;
    if(row.length&&(comp.layout==='column'||used+itemW>maxRowW)){rows.push(row);row=[];}
    row.push(item);
  }
  if(row.length) rows.push(row);
  rows.forEach(r=>{r.width=r.reduce((sum,x)=>sum+x.metrics.width*x.size,0)+gap*(r.length-1);r.height=Math.max(...r.map(x=>fs*x.size*1.18));});
  const rowGap=fs*.2,totalH=rows.reduce((sum,r)=>sum+r.height,0)+rowGap*(rows.length-1),fit=Math.min(1,(h*.56)/Math.max(1,totalH));
  let yCursor=-totalH*fit/2;
  GEO.set(l,{ax,cy,rot:sty.rot||0,mw:maxRowW,th:totalH*fit});
  ctx.save();ctx.translate(ax,cy);ctx.rotate(((sty.rot||0)+pose.rot)*Math.PI/180);ctx.scale(pose.scale,pose.scale);ctx.globalAlpha*=pose.opacity;
  if(S.textBg){ctx.fillStyle='rgba(0,0,0,0.45)';ctx.fillRect(-maxRowW/2,-totalH*fit/2-fs*.18,maxRowW,totalH*fit+fs*.36);}
  rows.forEach((r,ri)=>{
    let rowShift=comp.layout==='stair'?(ri-(rows.length-1)/2)*fs*.42:comp.layout==='zigzag'?(ri%2?1:-1)*fs*.3:comp.layout==='diagonal'?(ri-(rows.length-1)/2)*fs*.55:0;
    rowShift=Math.max(-maxRowW*.08,Math.min(maxRowW*.08,rowShift));
    const startX=Math.max(-maxRowW/2,Math.min(maxRowW/2-r.width*fit,-r.width*fit/2+rowShift));
    let xCursor=startX;
    r.forEach(item=>{
      const {word,i,slot,metrics,size}=item,wordW=metrics.width*size*fit,x=xCursor+wordW/2;
      const layoutY=comp.layout==='wave'?Math.sin(i*Math.PI/2)*fs*.12:comp.layout==='zigzag'?(i%2?1:-1)*fs*.12:slot.y*fs*.08;
      const y=yCursor+r.height*fit/2+layoutY*fit,order=compositionOrder(comp.order,i,n),start=l.start+order*step;
      const p=clamp01((t-start)/span),ease=1-Math.pow(1-p,3);let dy=0,scale=1,rot=slot.rot||0;
      if(comp.entry==='rise') dy=fs*1.2*(1-ease);
      else if(comp.entry==='drop') dy=-fs*1.2*(1-ease);
      else {scale=.25+.75*ease;rot+=(1-ease)*(i%2?-.2:.2);}
      const out=S.outAnim==='none'?1:1-clamp01((t-(l.end-Math.min(.3,dur*.3)))/Math.min(.3,dur*.3));
      ctx.save();ctx.translate(x,y+dy);ctx.rotate(rot);ctx.scale(size*fit*scale,size*fit*scale);ctx.globalAlpha*=ease*out;
      paint(word,-metrics.width/2,0,col,w);ctx.restore();
      xCursor+=wordW+gap*fit;
    });
    yCursor+=(r.height+rowGap)*fit;
  });
  if(S.accentMark){ctx.fillStyle=S.accent;ctx.fillRect(-18,totalH*fit/2+fs*.25,36,4);}
  ctx.restore();
}
function buildFontList(){
  const cats={}; [...$('fontSelect').options].forEach(o=>{ const f=FONTS.find(x=>x.f===o.value), c=f?f.c:'Tuya'; (cats[c]=cats[c]||[]).push({o,f}); });
  $('fontList').innerHTML=Object.entries(cats).map(([c,xs])=>`<h3>${c}</h3><div class="g2">${xs.map(({o,f})=>`<button data-v="${esc(o.value)}" class="${canUseFont(o.value)?'':'pro-only'}" aria-label="${esc(f?f.f:o.textContent)}${canUseFont(o.value)?'':' · Pro'}" style="font-family:'${o.value}',sans-serif;font-weight:${f?f.w:400}">${esc(f?f.f:o.textContent)}</button>`).join('')}</div>`).join('');
  markFont(); buildLnFonts();
}
function buildLnFonts(){
  const v=$('lnFont').value;
  $('lnFont').innerHTML='<option value="">Como el resto</option>'+[...$('fontSelect').options].map(o=>`<option value="${esc(o.value)}" style="font-family:'${o.value}',sans-serif">${esc(o.textContent)}${canUseFont(o.value)?'':' · 🔒 Pro'}</option>`).join('');
  $('lnFont').value=v;
}
function markFont(){ document.querySelectorAll('#fontList button').forEach(b=>b.classList.toggle('on',b.dataset.v===$('fontSelect').value)); }
$('fontList').addEventListener('click',e=>{ const b=e.target.closest('button[data-v]'); if(!b) return; if(!canUseFont(b.dataset.v)){ openUpgradeForFeature(); return; } $('fontSelect').value=b.dataset.v; $('fontSelect').dispatchEvent(new Event('input',{bubbles:true})); });
function refreshFeatureAccess(){
  buildFontList();
  buildCompositionOptions();
  updateProMarkers();
  if(!featurePro){
    if($('expFormat').value==='mp4')$('expFormat').value='webm';
    $('watermarkToggle').checked=true;
  }
  if(!featurePro&&$('lnComp').value){ $('lnComp').value=''; }
  for(const id of ['animSelect','lnAnim']){
    const select=$(id), previous=select.value;
    [...select.options].forEach(o=>{
      const allowed=canUseAnimation(o.value);
      if(!allowed&&!o.dataset.proLabel){ o.dataset.proLabel=o.textContent; o.textContent+=' · 🔒 Pro'; }
      if(allowed&&o.dataset.proLabel){ o.textContent=o.dataset.proLabel; delete o.dataset.proLabel; }
    });
    if(!canUseAnimation(previous)) select.value=id==='lnAnim'?'':(FREE_ANIMATIONS.has('slide')?'slide':'none');
  }
  if(!canUseFont($('fontSelect').value)) $('fontSelect').value='Space Grotesk';
  markComposition();
  if(!featurePro){
    document.querySelectorAll('.advrow').forEach(row=>{row.hidden=true;row.innerHTML='';});
    kfView=null;$('kfModal')?.remove();kfEditor=null;
    sanitizeProLineStyles();
    syncSettings(); redraw();
  }
  if(sel)lnLoad();
}
function sanitizeProLineStyles(){
  if(featurePro) return;
  for(const line of lyricLines){
    delete line.kf;delete line.ly;delete line.st;
  }
}
for(const id of ['animSelect','lnAnim']) $(id).addEventListener('input',()=>{
  if(canUseAnimation($(id).value)) return;
  $(id).value=id==='lnAnim'?'': 'slide'; redraw(); openUpgradeForFeature();
});
buildCompositionOptions();
buildFontList();

// ================= PRESETS DE TEXTO: incluidos + propios (se guardan en este navegador) =================
const DEF_STYLE={strokeW:0,strokeColor:'#000000',glowAmt:0,glowColor:'#3EC9A7',shAmt:14,shDist:0,upper:false};
// Punto de partida de los presets incluidos: lo que trae la app al abrir un proyecto nuevo.
const DEF_GENERAL={...DEF_STYLE,font:'Space Grotesk',fontSize:46,textColor:'#EFE9F2',accent:'#E8A33D',anim:'slide',outAnim:'none',inDur:50,posV:'center',textBg:false};
const PRESETS={
  'Clásico':{font:'Space Grotesk'},
  'Suave':{font:'Fredoka',fontSize:48,textColor:'#FFFFFF',accent:'#7DE2D1',shAmt:10,anim:'fade',outAnim:'fade'},
  'Impacto':{font:'Anton',fontSize:58,textColor:'#FFFFFF',accent:'#FF3B30',strokeW:5,shAmt:0,shDist:6,upper:true,anim:'pop'},
  'Póster':{font:'Bebas Neue',fontSize:66,textColor:'#FFFFFF',accent:'#FFD400',shAmt:18,upper:true,posV:'center',anim:'slide'},
  'Neón':{font:'Orbitron',textColor:'#FFFFFF',accent:'#3EC9A7',glowAmt:30,glowColor:'#FF2BD6',shAmt:0,anim:'fade',outAnim:'fade'},
  'Terminal':{font:'JetBrains Mono',fontSize:40,textColor:'#B6FF8A',accent:'#B6FF8A',glowAmt:12,glowColor:'#1F7A00',shAmt:0,anim:'cfade'},
  'Elegante':{font:'Playfair Display',fontSize:50,textColor:'#F5E6C8',accent:'#C9A35B',glowAmt:8,glowColor:'#C9A35B',shAmt:18,anim:'fade',outAnim:'fade'},
  'Hielo':{font:'Righteous',textColor:'#E6F6FF',accent:'#5CC8FF',glowAmt:18,glowColor:'#5CC8FF',shAmt:0,anim:'cup'},
  'Subtítulo':{font:'Archivo Black',fontSize:38,textColor:'#FFFFFF',accent:'#FFFFFF',strokeW:5,shAmt:0,posV:'bottom',anim:'fade',outAnim:'fade'},
  'Comic':{font:'Bangers',fontSize:52,textColor:'#FFE14D',strokeW:6,shAmt:0,shDist:6,upper:true,anim:'pop'},
  'Cine':{font:'Cinzel',fontSize:44,textColor:'#F2E6C9',shAmt:20,upper:true,anim:'fade',outAnim:'fade'},
  'Karaoke bar':{font:'Montserrat',fontSize:50,textColor:'#FFFFFF',accent:'#FFD400',strokeW:4,shAmt:0,upper:true,anim:'karaoke'},
  'Retro':{font:'Lobster',textColor:'#FFE8A3',accent:'#FF5A7A',strokeW:5,strokeColor:'#B5173B',shAmt:0,shDist:5,anim:'pop'},
  'Minimal':{font:'Inter',fontSize:42,textColor:'#FFFFFF',shAmt:6,anim:'fade',outAnim:'fade'},
  'Terror':{font:'Creepster',textColor:'#C6FF3D',accent:'#C6FF3D',glowAmt:16,glowColor:'#1F7A00',shAmt:0,shDist:4,anim:'fade'}
};
const PKEY='lyricStudio.presets', PKEYS=['font','fontSize','textColor','accent','strokeW','strokeColor','glowAmt','glowColor','shAmt','shDist','upper','anim','outAnim','inDur','posV','textBg'];
let userPresets={}; try{ userPresets=JSON.parse(localStorage.getItem(PKEY)||'{}'); }catch(e){}
// un preset incluido es libre si usa solo tipografías y animaciones que no son PRO
const presetFree=p=>{const q={...DEF_GENERAL,...p};return (q.font==='Space Grotesk'||canUseFont(q.font))&&canUseAnimation(q.anim);};
const presetLocked=(key)=>key[0]==='u'?!featurePro:!presetFree(PRESETS[key.slice(2)]||{});
function buildPresets(sel){
  pstBuild();
}
function applyPreset(key){
  const mine=key[0]==='u', name=key.slice(2), p=(mine?userPresets:PRESETS)[name]; if(!p) return;
  if(presetLocked(key)){ toast(mine?'Usar tus estilos guardados es una función PRO.':'«'+name+'» usa tipografías o animaciones PRO.'); openUpgradeForFeature(); return; }
  applySettings({...(mine?DEF_STYLE:DEF_GENERAL),...p}); redraw(); karaokeHint(p.anim);
  toast('Estilo «'+name+'» aplicado. Puedes ajustarlo en Texto y Posición.');
}
function savePresetNamed(raw){
  if(!requireProFeature('Guardar tus propios estilos')) return false;
  const n=(raw||'').trim(); if(!n){ toast('Escribe un nombre para el estilo.'); return false; }
  syncSettings(); userPresets[n]=Object.fromEntries(PKEYS.map(k=>[k,S[k]]));
  try{ localStorage.setItem(PKEY,JSON.stringify(userPresets)); toast('Estilo «'+n+'» guardado. Lo encuentras en Estilos → Mis estilos.'); }catch(e){ toast('No se pudo guardar el estilo en este navegador.'); }
  buildPresets('u:'+n); return true;
}
function deletePreset(name){
  if(!requireProFeature('Borrar tus estilos')) return;
  delete userPresets[name]; try{ localStorage.setItem(PKEY,JSON.stringify(userPresets)); }catch(e){}
  buildPresets(''); toast('Estilo borrado.');
}

// ---- categoría «Presets» (galería) ----
function pstPreviewStyle(p){
  const q={...DEF_GENERAL,...p}, sh=[];
  if(q.glowAmt>0) sh.push(`0 0 ${Math.round(q.glowAmt*.5)}px ${q.glowColor}`,`0 0 ${Math.round(q.glowAmt*.25)}px ${q.glowColor}`);
  if(q.shAmt>0||q.shDist>0) sh.push(`${Math.round(q.shDist*.5)}px ${Math.round(q.shDist*.5+1)}px ${Math.round(q.shAmt*.4)}px rgba(0,0,0,.85)`);
  return `font-family:'${q.font}',sans-serif;font-size:${Math.max(12,Math.round(q.fontSize*.42))}px;color:${q.textColor};`+(q.upper?'text-transform:uppercase;':'')+
    (q.strokeW>0?`-webkit-text-stroke:${(q.strokeW*.35).toFixed(1)}px ${q.strokeColor};paint-order:stroke fill;`:'')+(sh.length?`text-shadow:${sh.join(',')};`:'');
}
function pstCard(key,name,p,mine){
  const q={...DEF_GENERAL,...p}, lock=presetLocked(key), al=q.posV==='top'?'flex-start':q.posV==='center'?'center':'flex-end';
  return `<div class="pst-wrap"><button type="button" class="pst-card" data-pst="${esc(key)}" title="Aplicar «${esc(name)}»${lock?' · PRO':''}"><span class="pst-pv" style="justify-content:${al}"><span class="pst-t" style="${pstPreviewStyle(p)}">Tu letra</span><i class="pst-bar" style="background:${esc(q.accent)}"></i></span><span class="pst-name">${esc(name)}</span>${lock?'<span class="pst-pro">PRO</span>':''}</button>`+
    (mine?`<button type="button" class="pst-x" data-pstdel="${esc(name)}" title="Borrar «${esc(name)}»" aria-label="Borrar el estilo ${esc(name)}">×</button>`:'')+`</div>`;
}
function pstBuild(){
  const g=$('pstGrid'); if(!g) return;
  g.innerHTML=Object.entries(PRESETS).map(([n,p])=>pstCard('b:'+n,n,p,false)).join('');
  const m=Object.entries(userPresets);
  $('pstMine').innerHTML=m.length?m.map(([n,p])=>pstCard('u:'+n,n,p,true)).join(''):'<p class="pst-note pst-empty">Aún no tienes estilos guardados.</p>';
  pstMark();
}
// ¿el estilo actual coincide con algún preset? (para resaltarlo y avisar cuando se modificó)
function pstMatch(){
  const same=(a,b)=>typeof a==='string'?String(a).toLowerCase()===String(b).toLowerCase():a===b;
  const test=(p,base)=>{const q={...base,...p};return PKEYS.every(k=>q[k]===undefined||same(S[k],q[k]));};
  for(const [n,p] of Object.entries(PRESETS)) if(test(p,DEF_GENERAL)) return 'b:'+n;
  for(const [n,p] of Object.entries(userPresets)) if(test(p,DEF_STYLE)) return 'u:'+n;
  return null;
}
function pstMark(){
  if(!$('pstGrid')) return; const cur=pstMatch();
  document.querySelectorAll('#pstPanel .pst-card').forEach(b=>b.classList.toggle('on',b.dataset.pst===cur));
  $('pstNow').innerHTML=cur?`Estilo actual: <b>${esc(cur.slice(2))}</b>`:'Estilo actual: <b>Personalizado</b> <span class="pst-note">(lo cambiaste; puedes guardarlo en Mis estilos)</span>';
  const pn=$('pstProNote'); if(pn) pn.hidden=featurePro;
}
function pstPanelEl(){
  const d=document.createElement('div'); d.className='panel'; d.id='pstPanel';
  d.innerHTML=`<h2>Estilos de texto</h2><p class="pst-note">Un estilo es el aspecto completo del texto: tipografía, colores, contorno, resplandor, sombra, animación y posición. Elige uno para empezar y ajústalo en <b>Texto</b> y <b>Posición</b>; puedes cambiar lo que quieras.</p><div class="pst-now" id="pstNow"></div><div class="pst-grid" id="pstGrid"></div><h3 class="pst-h">Mis estilos</h3><ol class="pst-steps"><li>Ajusta el texto a tu gusto.</li><li>Escribe un nombre y pulsa <b>Guardar estilo actual</b>.</li></ol><div class="row"><input type="text" id="pstName" placeholder="Nombre del estilo" maxlength="40"><button class="btn-sm btn-fit" id="pstSave" type="button">Guardar estilo actual</button></div><p class="pst-note">Se guardan en este navegador y puedes usarlos en cualquier proyecto. Para modificar uno tuyo: aplícalo, cambia lo que quieras y guárdalo con el mismo nombre.</p><p class="pst-note" id="pstProNote">🔒 Guardar tus propios estilos es una función PRO.</p><div class="pst-grid" id="pstMine"></div>`;
  return d;
}
function pstInit(){
  const click=e=>{ const x=e.target.closest('[data-pstdel]'); if(x){ deletePreset(x.dataset.pstdel); return; } const b=e.target.closest('[data-pst]'); if(b) applyPreset(b.dataset.pst); };
  $('pstGrid').addEventListener('click',click); $('pstMine').addEventListener('click',click);
  $('pstSave').onclick=()=>{ if(savePresetNamed($('pstName').value)) $('pstName').value=''; };
  const go=$('goStyles'); if(go) go.onclick=()=>document.querySelector('#rail button[data-t="presets"]').click();
  pstBuild();
}
buildPresets('');

// ================= NOTAS DE PARCHE (compartido: menú del logo + pantalla de inicio) =================
const PATCH_NOTES={version:'Test v0.7.3',releases:[
  {v:'Test v0.7.3',date:'06/11/2026',items:[
    ['new','Pantalla completa de sincronización','Una pantalla dedicada para sincronizar la letra con el audio: Espacio (o el botón MARCAR en el celular) marca cada entrada.'],
    ['new','Sincronización por línea o por palabra','Cada salto de línea es una entrada. El modo por palabra sirve para karaoke y animaciones por palabra.'],
    ['new','Velocidad dentro de la sincronización','Baja el audio a 0.5× o 0.75× en la misma ventana para marcar con más precisión.'],
    ['new','Compensación de reacción','Ajustable de 0 a 300 ms para corregir el retraso al tocar. Se recuerda para la próxima vez.'],
    ['imp','Pegar la letra te lleva a sincronizarla','Al crear el proyecto o usar Usar este texto con el audio cargado, se abre la sincronización automáticamente.'],
    ['imp','Detección de LRC al pegar','Si pegas una letra con marcas [mm:ss.xx], se usan sus tiempos sin pasar por la sincronización.'],
    ['imp','Deshacer, fin de línea y repetir','Flecha izquierda deshace la última marca, F marca el fin de línea en partes instrumentales y un clic en una línea la repite.'],
    ['new','Estilos de texto','Nueva categoría Estilos en la barra izquierda: 15 estilos listos (tipografía, colores, contorno, resplandor, sombra, animación y posición) con vista previa. Aplícalos y ajústalos en Texto y Posición, o guarda los tuyos en Mis estilos.'],
    ['imp','Proyectos nuevos con mejor aspecto','Un proyecto nuevo empieza con el texto centrado en vertical y sin la barra inferior, para que se vea bien desde el primer momento. Tus proyectos guardados no cambian.'],
    ['imp','Estilos más fáciles de entender','El panel de Texto ahora se llama Efectos del texto (contorno, resplandor y sombra) y todo lo de estilos completos vive en la pestaña Estilos, con los pasos para guardar los tuyos.'],
    ['new','Temas de color','Elige el aspecto de la app en Menú → Apariencia: Ámbar (el de siempre), Azul, Violeta, Esmeralda y Focus (negro y grises, sobrio y profesional). Se recuerda en tu equipo.'],
    ['imp','Atajos sin duplicados','Se quitaron del panel de controles los atajos del sincronizador anterior (Marcar línea y Retroceder marca). Ahora solo están los de la pantalla Sincronizar letra.'],
    ['imp','Textos más claros','Revisamos los textos de la app: español neutro en lugar de voseo, nombres más claros (Descargar .lrc / .srt, Mover toda la letra, Sincronizar letra) y la palabra línea en lugar de verso.'],
    ['fix','Adelantar y retrasar la letra','Las descripciones de los botones −0.1 s y +0.1 s decían lo contrario de lo que hacían.'],
    ['imp','Botones de la línea sin tapar el texto','En Letra, las acciones de la línea seleccionada van en su propia línea debajo del campo en lugar de flotar encima, así siempre puedes editar el texto.'],
    ['new','Onda del audio en la sincronización','Ves la forma de onda con tus marcas y puedes hacer clic para moverte, así encuentras el golpe exacto de cada línea.'],
    ['new','Repasar con tu animación','Desde la sincronización reproduces lo marcado en bucle con la animación real y repites cualquier línea con un clic.'],
    ['new','Resincronizar una sola línea','Botón de reloj en cada línea y botón Resincronizar por palabra en opciones avanzadas: corriges solo esa línea sin tocar el resto.'],
    ['new','Movimientos listos para keyframes','Botón de rombo visible en cada línea y movimientos listos: sube, baja, acercar, alejar, desde un lado, latido y balanceo.'],
    ['imp','Atajos de la sincronización personalizables','Marcar, deshacer, fin de línea y reproducir se cambian desde el panel de controles.'],
    ['imp','Casilla de palabras solo cuando aplica','Aparece únicamente con animaciones por palabra y la vista previa en bucle ya la refleja.'],
    ['new','Keyframes sobre tu fondo','El editor de keyframes ahora muestra el video, la imagen o el fondo del proyecto con el texto real, y una línea punteada con el recorrido del movimiento.'],
    ['new','Previsualizar el movimiento','Botón para reproducir la línea con audio, fondo y animaciones reales antes de cerrar el editor.'],
    ['new','Palabras en su tiempo','Casilla en Animación: si está activa, las animaciones por palabra muestran cada palabra cuando se canta. Apagada, la línea se lee completa como siempre.'],
    ['imp','Sincronización por palabra para todos','Ya no es una función Pro: los tiempos por palabra se conservan en cualquier cuenta.'],
    ['imp','Botón Sincronizar letra en el timeline','Reemplaza al sincronizador anterior y abre la nueva pantalla completa.']
  ]},
  {v:'Test v0.7.2',date:'05/11/2026',items:[
    ['new','Tutorial guiado','Un recorrido paso a paso por el editor la primera vez que lo abres, resaltando cada zona.'],
    ['imp','Menú contextual en las líneas','Clic derecho sobre una línea del timeline para acceder rápido a sus acciones.'],
    ['imp','Vista previa de funciones Pro','Antes de activar una tipografía, un estilo de línea o una capa puedes ver cómo se aplica.'],
    ['fix','Carga de proyectos','Ahora se muestra el progreso al abrir un proyecto y un mensaje claro si el archivo no se puede leer.']
  ]},
  {v:'Test v0.7.1',date:'04/11/2026',items:[
    ['new','Marca de agua','Agrega un texto o una imagen sobre el video, con opacidad y posición ajustables.'],
    ['new','Exportación a MP4','Elige resolución, fotogramas por segundo y calidad al exportar el video.'],
    ['imp','Atajos de teclado personalizables','Cambia las teclas de reproducir, marcar y deshacer desde el panel de controles.'],
    ['fix','Deshacer y rehacer','Los cambios de estilo y de tiempos ya se restauran correctamente al retroceder.']
  ]}
]};
const PN_TAG={new:'Nuevo',imp:'Mejora',fix:'Arreglo'};
function patchPanelInner(){
  const rel=PATCH_NOTES.releases.map(r=>`<section class="pn-rel"><h4><span>${esc(r.v)}</span><time>${esc(r.date)}</time></h4><ul>${r.items.map(([t,title,desc])=>`<li><span class="pn-tag ${esc(t)}">${esc(PN_TAG[t]||'Cambio')}</span><div class="pn-item"><b>${esc(title)}</b><p>${esc(desc)}</p></div></li>`).join('')}</ul></section>`).join('');
  return `<div class="pn-head"><b>Notas de parche</b><span class="pn-ver">${esc(PATCH_NOTES.version)}</span></div><p class="pn-sub">Qué cambió en Lyric Studio.</p><div class="pn-scroll">${rel}</div><button type="button" class="pn-more" data-action="patchnotes">Ver historial completo</button>`;
}

// ================= FASE 6: diseño tipo editor =================
(function buildShell(){
  const ic=d=>`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const TABS=[['letra','Letra','<path d="M4 6h16M4 12h10M4 18h14"/>'],
    ['medios','Medios','<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>'],
    ['presets','Estilos','<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'],
    ['texto','Texto','<path d="M5 7V4h14v3M12 4v16M9 20h6"/>'],
    ['pos','Posición','<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/>']];
  const P=[...document.querySelectorAll('.panel')], app=document.createElement('div'); app.id='app';
  app.innerHTML='<header id="top"><div class="brand"></div><div class="pj"></div><span class="grow"></span><div class="ex"></div></header><nav id="rail"></nav><aside id="side"></aside><main id="center"><div class="cbar"></div><div class="pv"></div><div class="tp"></div></main><aside id="insp"></aside><section id="dock"></section>';
  document.body.prepend(app); const q=x=>app.querySelector(x), panes={};
  P.forEach(p=>{ const h=p.querySelector('h2'); h.textContent=h.textContent.replace(/^\d+\s·\s/,''); });
  const brand=q('.brand'),brandTrigger=document.createElement('button');brandTrigger.className='brand-trigger';brandTrigger.type='button';brandTrigger.setAttribute('aria-haspopup','menu');brandTrigger.setAttribute('aria-expanded','false');brandTrigger.innerHTML='<img class="logo-img" src="../icon-192.png" alt="" width="34" height="34"><h1>Lyric Studio</h1><svg class="chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  // ---- Menú principal: panel de editor con notas de parche a la izquierda ----
  const mic=d=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const MI={
    open:'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>',
    export:'<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 14v5h14v-5"/>',
    capture:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.2"/>',
    full:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    ws:'<rect x="2" y="5" width="10" height="8" rx="1.5"/><rect x="12" y="9" width="10" height="8" rx="1.5"/>',
    mon:'<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    study:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    guides:'<path d="M12 3v18M3 12h18"/><rect x="6" y="6" width="12" height="12" rx="1" stroke-dasharray="2 2"/>',
    wm:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M13 15h5"/>',
    keys:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    cmd:'<path d="M9 9V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    doc:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>'
  };
  const hk=n=>{const k=hotkeys[n];if(!k||!k.code)return '';return (k.ctrl?'Ctrl+':'')+(k.shift?'Shift+':'')+(k.alt?'Alt+':'')+k.code.replace(/^(Key|Digit)/,'');};
  const mi=(action,icon,label,desc,extra='')=>`<button type="button" class="mi" role="menuitem" data-action="${action}"><span class="mi-ico">${mic(MI[icon])}</span><span class="mi-txt"><span class="mi-label">${label}</span>${desc?`<span class="mi-desc">${desc}</span>`:''}</span>${extra}</button>`;
  const ml=(attrs,icon,label,desc)=>`<a class="mi" role="menuitem" ${attrs}><span class="mi-ico">${mic(MI[icon])}</span><span class="mi-txt"><span class="mi-label">${label}</span>${desc?`<span class="mi-desc">${desc}</span>`:''}</span></a>`;
  const brandMenu=document.createElement('div');brandMenu.className='brand-menu';brandMenu.id='brandMenu';brandMenu.hidden=true;brandMenu.setAttribute('role','menu');brandMenu.setAttribute('aria-label','Menú de Lyric Studio');
  brandMenu.innerHTML=
   `<aside class="pn" aria-label="Notas de parche">${patchPanelInner()}</aside>`+
   `<div class="bm-cols">`+
    `<div class="bm-col">`+
     `<div class="bm-group" role="group" aria-label="Proyecto"><h3>Proyecto</h3>`+
      mi('open','open','Abrir proyecto','Cargar un archivo .lyr')+
      mi('save','save','Guardar proyecto','Descargar el proyecto',`<kbd>${esc(hk('save')||'Ctrl+S')}</kbd>`)+
      mi('export','export','Exportar video','Exportación en MP4 o WebM')+
      mi('capture','capture','Captura PNG','Guardar el cuadro actual')+
      mi('fullscreen','full','Pantalla completa','')+
     `</div>`+
     `<div class="bm-group" role="group" aria-label="Ayuda"><h3>Ayuda</h3>`+
      mi('shortcuts','cmd','Atajos de teclado','')+
      mi('tutorial','spark','Tutorial interactivo','Recorrido guiado por el editor')+
      mi('licenses','info','Licencias','')+
      ml('href="mailto:support@lyricstudio.site"','mail','Soporte','support@lyricstudio.site')+
     `</div>`+
    `</div>`+
    `<div class="bm-col">`+
     `<div class="bm-group" role="group" aria-label="Espacio de trabajo"><h3>Espacio de trabajo</h3>`+
      mi('workstation','ws','WorkStation','Salida en otro monitor')+
      mi('workstation-config','mon','Configurar monitores…','')+
      mi('study','study','Modo Estudio','Edición y salida a la par','<span class="menu-check" id="menuStudyCheck"></span>')+
      mi('guides','guides','Guías y centro','Líneas de alineación','<span class="menu-check" id="menuGuidesCheck"></span>')+
      mi('watermark','wm','Marca de agua…','Texto, imagen o video')+
      mi('controls','keys','Editar controles…','Personalizar atajos')+
     `</div>`+
     (window.Theme?`<div class="bm-group" role="group" aria-label="Apariencia"><h3>Apariencia</h3><div class="theme-row" id="themeRow"></div></div>`:'')+
      `<div class="bm-group bm-legal" role="group" aria-label="Legal"><h3>Legal</h3>`+
      ml('data-legal href="../terminos.html" target="_blank" rel="noopener"','doc','Términos y condiciones','')+
      ml('data-legal href="../privacidad.html" target="_blank" rel="noopener"','doc','Política de privacidad','')+
     `</div>`+
    `</div>`+
   `</div>`;
  brand.append(brandTrigger,brandMenu);
  const themeRow=brandMenu.querySelector('#themeRow');
  if(themeRow&&window.Theme){
    const paintThemes=()=>{themeRow.innerHTML=Theme.list.map(t=>`<button type="button" class="theme-sw${t.id===Theme.current()?' on':''}" data-theme-pick="${t.id}" aria-pressed="${t.id===Theme.current()}" title="Tema ${esc(t.name)}"><i style="background:linear-gradient(135deg,${t.bg} 0 50%,${t.acc} 50% 100%)"></i><span>${esc(t.name)}</span></button>`).join('');};
    paintThemes();
    themeRow.addEventListener('click',e=>{const b=e.target.closest('[data-theme-pick]');if(!b)return;Theme.apply(b.dataset.themePick);paintThemes();});
  }
  window.addEventListener('themechange',()=>{try{drawTimeline(getCurrentTime());}catch(e){}});
  const closeBrandMenu=()=>{brandMenu.hidden=true;brandTrigger.setAttribute('aria-expanded','false');};
  brandTrigger.addEventListener('click',e=>{e.stopPropagation();brandMenu.hidden=!brandMenu.hidden;brandTrigger.setAttribute('aria-expanded',String(!brandMenu.hidden));if(!brandMenu.hidden)brandMenu.querySelector('.mi')?.focus();});
  brandMenu.addEventListener('click',e=>{if(e.target.closest('[data-legal]')){closeBrandMenu();return;}const b=e.target.closest('[data-action]');if(!b)return;const a=b.dataset.action;
    if(a==='workstation')launchWorkstation();
    if(a==='workstation-config')openWorkstationSettings();
    if(a==='study'){if(requireProFeature('El Modo Estudio')){studyBtn.click();$('menuStudyCheck').textContent=studyMode?'✓':'';}}
    if(a==='guides'){if(requireProFeature('Las guías de edición')){const center=q('#center');center.classList.toggle('guides-on');$('menuGuidesCheck').textContent=center.classList.contains('guides-on')?'✓':'';syncStudyGuides();}}
    if(a==='watermark')openWatermarkModal();
    if(a==='controls')openControlsModal();
    if(a==='open')$('openBtn').click();
    if(a==='save')$('saveBtn').click();
    if(a==='export')$('exportBtn').click();
    if(a==='capture'&&requireProFeature('La captura PNG'))$('pngCaptureBtn')?.click();
    if(a==='fullscreen'){if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();}
    if(a==='shortcuts'){const k=q('.keys');if(k.hidden)window.showShortcutsPanel?.();k.scrollIntoView({behavior:'smooth',block:'center'});}
    if(a==='tutorial')startTutorial(featurePro?'pro':'free',true);
    if(a==='licenses')$('licensesBtn')?.click();
    if(a==='patchnotes')toast('El historial de versiones estará disponible pronto.');
    closeBrandMenu();
  });
  document.addEventListener('click',e=>{if(!tutorialActive&&!brand.contains(e.target))closeBrandMenu();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!brandMenu.hidden){closeBrandMenu();brandTrigger.focus();}});
  brandMenu.addEventListener('keydown',e=>{const it=[...brandMenu.querySelectorAll('.mi,.pn-more')],i=it.indexOf(document.activeElement),go=n=>{e.preventDefault();it[(n+it.length)%it.length]?.focus();};if(e.key==='ArrowDown')go(i+1);else if(e.key==='ArrowUp')go(i<0?it.length-1:i-1);else if(e.key==='Home')go(0);else if(e.key==='End')go(it.length-1);});
  ['projName','openBtn','saveBtn','undoBtn','redoBtn','projStatus','projFile'].forEach(id=>q('.pj').append($(id)));
  $('saveBtn').textContent='Guardar'; $('undoBtn').textContent='↶'; $('redoBtn').textContent='↷'; $('openBtn').title='Abrir proyecto (.lyr)'; $('saveBtn').title='Guardar (Ctrl+S)';
  q('.ex').append(document.querySelector('.export-bar'));
  $('openBtn').hidden=true; $('saveBtn').hidden=true; $('exportBtn').hidden=true;
  TABS.forEach(([k,n,svg])=>{
    const b=document.createElement('button'); b.dataset.t=k; b.innerHTML=ic(svg)+`<span>${n}</span>`; q('#rail').append(b);
    const p=document.createElement('div'); p.dataset.t=k; panes[k]=p; q('#side').append(p);
  });
  panes.letra.append(P[0],$('lyricEditor')); panes.medios.append(P[1],P[2]); panes.texto.append(P[3],P[4]); panes.pos.append(P[5]); panes.presets.append(pstPanelEl()); pstInit();
  q('#insp').append(P[6]);
  const keys=document.createElement('div'); keys.className='panel keys';
  keys.innerHTML='<button class="keys-x" type="button" aria-label="Ocultar atajos" title="Ocultar (puedes volver a verlos desde el menú → Atajos de teclado)">✕</button><h2>Atajos</h2><ul><li><kbd>Espacio</kbd>Reproducir / pausar (en Sincronizar letra: marcar)</li><li><kbd>Ctrl+S</kbd>Guardar proyecto</li><li><kbd>Ctrl+Z</kbd>Deshacer · <kbd>Ctrl+Y</kbd>Rehacer</li><li><kbd>Ctrl+rueda</kbd>Zoom del timeline</li></ul>';
  q('#insp').append(keys);
  const KEYS_HIDE='lyricStudio.hideShortcuts';
  const setKeysHidden=(v)=>{ keys.hidden=v; try{ v?localStorage.setItem(KEYS_HIDE,'1'):localStorage.removeItem(KEYS_HIDE); }catch(e){} };
  try{ keys.hidden=localStorage.getItem(KEYS_HIDE)==='1'; }catch(e){}
  keys.querySelector('.keys-x').onclick=()=>setKeysHidden(true);
  window.showShortcutsPanel=()=>{ setKeysHidden(false); };
  q('.cbar').append($('restoreBar'));
  const studyBtn=document.createElement('button'); studyBtn.id='studyToggle'; studyBtn.className='btn-sm'; studyBtn.textContent='Modo Estudio'; studyBtn.title='Mostrar monitor de edición y salida limpia';
  const pv=q('.pv'), grid=document.createElement('div'); grid.id='studyGrid'; grid.className='study-grid';
  const editMonitor=document.createElement('div'); editMonitor.id='studyEditorMonitor'; editMonitor.className='study-monitor'; editMonitor.innerHTML='<span class="monitor-label">EDICIÓN · guías y controles</span><div class="study-guides"></div>';
  stageBackdropCanvas=document.createElement('canvas');stageBackdropCanvas.className='monitor-backdrop';stageBackdropCanvas.setAttribute('aria-hidden','true');editMonitor.append(stageBackdropCanvas);
  const outputMonitor=document.createElement('div'); outputMonitor.id='studyOutputMonitor'; outputMonitor.className='study-monitor'; outputMonitor.innerHTML='<span class="monitor-label">SALIDA · cuadro limpio</span>';
  studyOutputCanvas=document.createElement('canvas'); studyOutputCanvas.id='studyOutput'; studyOutputCanvas.width=canvas.width; studyOutputCanvas.height=canvas.height; studyOutputCtx=studyOutputCanvas.getContext('2d');
  outputBackdropCanvas=document.createElement('canvas');outputBackdropCanvas.className='monitor-backdrop';outputBackdropCanvas.setAttribute('aria-hidden','true');editMonitor.append($('stage')); outputMonitor.append(outputBackdropCanvas,studyOutputCanvas); grid.append(editMonitor,outputMonitor); pv.append(grid);
  studyBtn.onclick=()=>{if(!requireProFeature('El Modo Estudio'))return;studyMode=!studyMode; q('#center').classList.toggle('study-on',studyMode);studyBtn.classList.toggle('on',studyMode);studyBtn.textContent=studyMode?'Salir de Estudio':'Modo Estudio';if($('menuStudyCheck'))$('menuStudyCheck').textContent=studyMode?'✓':'';drawFrame(getCurrentTime());};
  q('.tp').append(document.querySelector('.timecode'),document.querySelector('.transport'));
  const studyControls=document.createElement('div');studyControls.className='study-controls';studyControls.innerHTML='<label>X <input id="studyX" type="number" step="1"></label><label>Y <input id="studyY" type="number" step="1"></label><label>Ancho <input id="studyW" type="number" min="1" step="1"></label><label>Alto <input id="studyH" type="number" readonly></label><label>Rotación <input id="studyRot" type="number" step="1"></label><span class="hint" id="studyHint">Selecciona una línea para ajustar</span>';
  q('.tp').append(studyControls);
  q('#dock').append(document.querySelector('.tlwrap'));
  $('tl').title='Arrastra un bloque para moverlo, sus bordes para recortarlo. Rueda: desplazar · Ctrl+rueda: zoom';
  const show=k=>{ q('#rail').querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.t===k)); Object.entries(panes).forEach(([t,p])=>p.hidden=t!==k); };
  q('#rail').addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) show(b.dataset.t); });
  show('letra');
  document.querySelector('.wrap').remove();
})();

// ================= INICIO + ASISTENTE DE PROYECTO NUEVO =================
let wzTimed=null, wzStep=1, wzOpen=false;
const ASP=[['9:16','Vertical','TikTok · Reels · Shorts',36,64],['1:1','Cuadrado','Posts de Instagram',52,52],['16:9','Horizontal','YouTube',64,36],['4:5','Retrato','Feed de Instagram',48,60]];
const home=document.createElement('div'); home.id='home';
home.innerHTML=`<div class="hm-shell">
 <aside class="pn hm-pn" aria-label="Notas de parche">${patchPanelInner()}</aside>
 <div class="hm-main"><div class="hm-col">
 <section id="vHub">
  <div class="hm-brand"><img class="hm-logo" src="../icon-192.png" alt="" width="52" height="52"><div><h1>Lyric Studio</h1><p class="hm-sub">Arma videos de lyrics en minutos: letra, audio y estilo.</p></div></div>
  <h2 class="hm-h">Empezar</h2>
  <div class="hm-cards">
   <button class="hm-card pri" id="hNew"><span class="hm-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></span><b>Nuevo proyecto</b><span class="hm-d">Elige el formato, carga el audio y la letra.</span></button>
   <button class="hm-card" id="hOpen"><span class="hm-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span><b>Abrir proyecto</b><span class="hm-d">Sube un archivo .lyr que guardaste.</span></button>
   <button class="hm-card wide" id="hCont" hidden><span class="hm-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4l14 8-14 8z"/></svg></span><b>Continuar</b><span class="hm-d" id="hContInfo"></span></button>
  </div>
  <p class="hm-note">Un proyecto guarda la letra, los tiempos y el estilo. El audio y las imágenes hay que volver a cargarlos al abrirlo.</p>
  <h2 class="hm-h">Recursos</h2>
  <div class="hm-links">
   <button type="button" class="mi" id="licensesBtn"><span class="mi-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></span><span class="mi-txt"><span class="mi-label">Licencias</span><span class="mi-desc">Tipografías y librerías</span></span></button>
   <a class="mi" href="mailto:support@lyricstudio.site"><span class="mi-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg></span><span class="mi-txt"><span class="mi-label">Soporte</span><span class="mi-desc">support@lyricstudio.site</span></span></a>
   <a class="mi" href="../terminos.html" target="_blank" rel="noopener"><span class="mi-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg></span><span class="mi-txt"><span class="mi-label">Términos y condiciones</span></span></a>
   <a class="mi" href="../privacidad.html" target="_blank" rel="noopener"><span class="mi-ico"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg></span><span class="mi-txt"><span class="mi-label">Política de privacidad</span></span></a>
  </div>
 </section>
 <section id="vWiz" hidden>
  <div class="steps"><i data-s="1">1 · Formato</i><i data-s="2">2 · Audio</i><i data-s="3">3 · Letra</i></div>
  <div class="wz" data-s="1"><h2>¿Para dónde es el video?</h2>
   <label>Nombre del proyecto</label><input type="text" id="wName" placeholder="Ej: Mi canción — lyric video">
   <div class="asp">${ASP.map(([a,t,d,w,h])=>`<button class="ac" data-a="${a}"><i style="width:${w}px;height:${h}px"></i><b>${a} · ${t}</b><small>${d}</small></button>`).join('')}</div></div>
  <div class="wz" data-s="2" hidden><h2>Carga el audio</h2><div class="wdrop" id="wDropA"></div>
   <p class="hm-note">Con el audio puedes sincronizar la letra y ver la onda en el timeline. Si todavía no lo tienes, omitilo y lo cargas después.</p></div>
  <div class="wz" data-s="3" hidden><h2>La letra</h2><div class="wdrop sm" id="wDropL"></div>
   <label>O escribila / pegala aquí (una línea por línea). Si subiste un archivo, puedes corregirla.</label>
   <textarea id="wLyrics" placeholder="Una línea de la letra por renglón…"></textarea><p class="hm-note" id="wHint" style="margin-top:10px;"></p></div>
  <div class="wz-nav"><button class="btn-sm" id="wBack">← Atrás</button><span class="grow"></span><button class="btn-sm" id="wSkip">Omitir</button><button class="btn-primary" id="wNext">Siguiente</button></div>
 </section>
 </div></div></div>`;
document.body.append(home);
const hq=x=>home.querySelector(x), wzRows=()=>$('wLyrics').value.split(/\r?\n/).map(t=>t.trim()).filter(Boolean);
function feed(inputId,f){ const dt=new DataTransfer(); dt.items.add(f); const i=$(inputId); i.files=dt.files; i.dispatchEvent(new Event('change')); }
function wzDrop(el,inputId){
  el.onclick=()=>$(inputId).click();
  el.ondragover=e=>{ e.preventDefault(); el.classList.add('over'); }; el.ondragleave=()=>el.classList.remove('over');
  el.ondrop=e=>{ e.preventDefault(); el.classList.remove('over'); if(e.dataTransfer.files[0]) feed(inputId,e.dataTransfer.files[0]); };
}
wzDrop(hq('#wDropA'),'fileAudio'); wzDrop(hq('#wDropL'),'fileLyrics');
function wzFiles(){
  const a=fileNames.dropAudio, l=fileNames.dropLyrics;
  hq('#wDropA').className='wdrop'+(a?' has':''); hq('#wDropA').innerHTML=a?`✓ <b>${esc(a)}</b><br><small>Haz clic para cambiarlo</small>`:'Arrastra tu audio aquí o haz clic<br><small>mp3 · wav · m4a</small>';
  hq('#wDropL').className='wdrop sm'+(l?' has':''); hq('#wDropL').innerHTML=l?`✓ <b>${esc(l)}</b> · haz clic para cambiarlo`:'Subir un archivo .lrc / .srt / .txt';
  home.querySelectorAll('.ac').forEach(b=>b.classList.toggle('on',b.dataset.a===aspect));
}
function wzHint(){
  const n=wzRows().length;
  hq('#wHint').textContent=wzTimed&&n?(n===wzTimed.length?`Letra cargada: ${n} líneas con sus tiempos. Puedes corregir el texto.`:'Cambiaste la cantidad de líneas: los tiempos se van a repartir de nuevo.'):(n?`${n} líneas. Se reparten de forma pareja sobre el audio y después las ajustas en el timeline.`:'Puedes crearla ahora o después, desde la pestaña Letra.');
}
function wzShow(n){
  wzStep=n; home.querySelectorAll('.wz').forEach(e=>e.hidden=+e.dataset.s!==n);
  home.querySelectorAll('.steps i').forEach(e=>{ e.classList.toggle('on',+e.dataset.s===n); e.classList.toggle('done',+e.dataset.s<n); });
  $('wSkip').hidden=n===1; $('wSkip').textContent=n===2?'Omitir audio':'Sin letra por ahora'; $('wNext').textContent=n<3?'Siguiente':'Crear proyecto'; wzFiles(); wzHint();
}
function wzCreate(noLyrics){
  const rows=wzRows(); $('projName').value=hq('#wName').value.trim();
  lyricLines=(noLyrics||!rows.length)?[]:(wzTimed&&rows.length===wzTimed.length)?wzTimed.map((l,i)=>({...l,text:rows[i]})):plainToLines(rows.join('\n'));
  wzOpen=false; sel=null; buildEditor(); checkReady(); redraw(); enterEditor();
  setMode('video',false);
  toast('Proyecto creado. Arma el video y después sigue con la letra.');
}
function enterEditor(){ pendingRestore=false; $('restoreBar').style.display='none'; home.hidden=true; wzOpen=false; drawTimeline(getCurrentTime());setTimeout(maybeStartTutorial,250); }
home.querySelectorAll('.ac').forEach(b=>b.onclick=()=>{ document.querySelector(`#aspectSeg [data-a="${b.dataset.a}"]`).click(); wzFiles(); });
$('hNew').onclick=()=>{ if(!$('hCont').hidden&&!confirm('Ya tienes un proyecto autoguardado. Si empiezas uno nuevo y editas, lo va a reemplazar. ¿Seguir?')) return; hq('#vHub').hidden=true; hq('#vWiz').hidden=false; wzOpen=true; wzTimed=null; applySettings({...DEF_GENERAL,accentMark:false}); redraw(); wzShow(1); };
$('hOpen').onclick=()=>$('projFile').click();
hq('.hm-pn .pn-more').onclick=e=>{const b=e.currentTarget,txt=b.textContent;b.textContent='El historial estará disponible pronto.';setTimeout(()=>{b.textContent=txt;},2200);};
$('hCont').onclick=()=>$('restoreYes').click();
$('wBack').onclick=()=>{ if(wzStep>1) wzShow(wzStep-1); else { wzOpen=false; hq('#vWiz').hidden=true; hq('#vHub').hidden=false; } };
$('wNext').onclick=()=>wzStep<3?wzShow(wzStep+1):wzCreate(false);
$('wSkip').onclick=()=>wzStep<3?wzShow(wzStep+1):wzCreate(true);
$('wLyrics').addEventListener('input',wzHint);
['fileAudio','fileLyrics'].forEach(id=>$(id).addEventListener('change',()=>setTimeout(wzFiles,60)));
new MutationObserver(()=>{ if(!wzOpen||!lyricLines.length||!fileNames.dropLyrics) return; wzTimed=lyricLines.map(l=>({...l})); $('wLyrics').value=lyricLines.map(l=>l.text).join('\n'); wzFiles(); wzHint(); }).observe($('lyricsLog'),{childList:true});
try{ const p=JSON.parse(localStorage.getItem(AUTOSAVE_KEY)||'null');
  if(p&&((p.lines&&p.lines.length)||p.name)){ $('hCont').hidden=false; $('hContInfo').textContent=(p.name?'«'+p.name+'» · ':'')+p.lines.length+' líneas · '+new Date(p.savedAt).toLocaleString('es-AR',{dateStyle:'short',timeStyle:'short'}); } }catch(e){}
document.addEventListener('keydown',e=>{ if(!home.hidden&&!e.target.matches('input,textarea')) e.stopImmediatePropagation(); },true);
const hb=document.createElement('button'); hb.className='btn-sm'; hb.id='homeBtn'; hb.textContent='⌂ Inicio'; hb.title='Volver al inicio (se autoguarda)';
document.querySelector('#top .brand').after(hb);
hb.onclick=()=>{ clearTimeout(tChg); if(lyricLines.length||$('projName').value.trim()) autosave(); location.reload(); };
// relleno de color en los sliders
setInterval(()=>!document.hidden&&document.querySelectorAll('input[type=range]').forEach(r=>r.style.setProperty('--p',((r.value-r.min)/((r.max-r.min)||1)*100)+'%')),250);

// ================= DOS EDITORES: VIDEO (simple, se bloquea) y LETRA =================
let vlocked=false, bgT=null, vpRaf=0;
const DEF_VIDEO={wmText:'LyricStudio.site',bgFx:'none',bgFxAmt:40,bgFxSpd:4,bgDim:0};
function bgFx(t,w,h){
  const k=S.bgFx; if(!k||k==='none'||bgMode!=='image') return;
  const tt=bgT===null?t:bgT, a=S.bgFxAmt/100, Pd=40/Math.max(1,S.bgFxSpd), e=0.5-0.5*Math.cos(2*Math.PI*tt/Pd);
  let sc=1,x=0,y=0;
  if(k==='zin') sc=1+.25*a*e; else if(k==='zout') sc=1+.25*a*(1-e);
  else if(k==='panr'||k==='panl'){ sc=1+.2*a; x=(k==='panr'?1:-1)*(e-.5)*2*(sc-1)*w/2; }
  else if(k==='drift'){ sc=1+.12*a; x=Math.sin(tt*2*Math.PI/Pd)*(sc-1)*w/2; y=Math.cos(tt*2*Math.PI/(Pd*1.3))*(sc-1)*h/2; }
  else if(k==='pulse') sc=1+.06*a*Math.pow(Math.abs(Math.sin(tt*Math.PI*1.2)),6);
  ctx.translate(w/2+x,h/2+y); ctx.scale(sc,sc); ctx.translate(-w/2,-h/2);
}
// armado del editor de video: formato + fondo + animación
const vp=document.createElement('div'); vp.id='vpane';
vp.innerHTML='<div class="vbanner" id="vBanner" hidden><span>🔒 El video está bloqueado.</span><button class="btn-sm" id="vUnlock">Desbloquear para editar</button></div><div class="vbody"></div><div class="vcta"><button class="btn-primary" id="vCta">Listo, seguir con la letra →</button></div>';
$('side').append(vp);
const aspP=document.createElement('div'); aspP.className='panel'; aspP.innerHTML='<h2>Formato</h2>'; aspP.append($('aspectSeg').previousElementSibling,$('aspectSeg'));
vp.querySelector('.vbody').append(aspP,$('bgColorPanel').closest('.panel'));
$('lyricEditor').before($('dropAudio').closest('.panel'));                                   // el audio vive en el editor de letra
document.querySelector('#side > div[data-t="medios"]').remove(); document.querySelector('#rail button[data-t="medios"]').remove();
const sw=document.createElement('div'); sw.className='modesw'; sw.innerHTML='<button id="modeVideo" data-m="video">Video</button><button id="modeLyrics" data-m="lyrics">Letra</button>';
$('homeBtn').after(sw);
function setMode(m,lock){
  const v=m==='video'; if(lock!==undefined) vlocked=lock; else if(!v) vlocked=true;
  document.body.classList.toggle('mv',v); document.body.classList.toggle('ml',!v); document.body.classList.toggle('vlock',vlocked);
  $('modeVideo').classList.toggle('on',v); $('modeLyrics').classList.toggle('on',!v); $('modeVideo').textContent=vlocked?'🔒 Video':'Video';
  $('vBanner').hidden=!vlocked; $('vCta').textContent=vlocked?'Volver a la letra →':'Listo, seguir con la letra →';
  if(v&&!vpRaf) vpLoop();
  setTimeout(()=>{ drawFrame(getCurrentTime()); if(!v) fitTimeline(); },40);
}
function vpLoop(){   // en el editor de video, el fondo se anima solo para que veas el efecto
  vpRaf=0; if(!document.body.classList.contains('mv')) return;
  if(!isPlaying&&home.hidden&&!document.hidden){ const l=lyricLines[0]; bgT=performance.now()/1000;
    try{ drawFrame(l?l.start+Math.min(1.2,(l.end-l.start)*.6):0); }finally{ bgT=null; } }
  vpRaf=requestAnimationFrame(vpLoop);
}
$('modeVideo').onclick=()=>setMode('video'); $('modeLyrics').onclick=()=>setMode('lyrics');
$('vCta').onclick=()=>setMode('lyrics'); $('vUnlock').onclick=()=>setMode('video',false);
setMode('video',false);

// ================= TANDA 1 DE MEJORAS: MP4, imán, velocidad, extras =================
let audioBuf=null;
async function exportMp4(btn,stopBtn,status,fill){
  if(!requireProFeature('La exportación MP4'))return false;
  if(!(window.VideoEncoder&&window.AudioEncoder&&window.Mp4Muxer&&audioBuf)) return false;
  const fps=exportConfig.fps, W=canvas.width, H=canvas.height, sr=audioBuf.sampleRate, nc=Math.min(2,audioBuf.numberOfChannels);
  const vcfg={codec:h264Codec(W,H,fps),width:W,height:H,bitrate:exportBitrate(W,H,fps),framerate:fps}, acfg={codec:'mp4a.40.2',sampleRate:sr,numberOfChannels:nc,bitrate:128000};
  try{ if(!(await VideoEncoder.isConfigSupported(vcfg)).supported||!(await AudioEncoder.isConfigSupported(acfg)).supported) return false; }catch(e){ return false; }
  if(isPlaying) $('playBtn').click();
  let cancel=false, err=null; stopBtn.style.display='inline-flex'; stopBtn.onclick=()=>{ cancel=true; };
  const wmWasPlaying=!!(wmVideoEl&&!wmVideoEl.paused);if(wmVideoEl)wmVideoEl.pause();
  setControlsLocked(true); btn.classList.add('recording'); btn.textContent='Exportando…';
  beginTopExport('Exportando MP4 · '+exportConfig.res+'p · '+fps+' FPS');
  updateTopExport(null,'Preparando el audio y el codificador…');
  const tick=()=>new Promise(r=>setTimeout(r));
  let exportSucceeded=false;
  try{
    const target=new Mp4Muxer.ArrayBufferTarget(), mux=new Mp4Muxer.Muxer({target,video:{codec:'avc',width:W,height:H},audio:{codec:'aac',numberOfChannels:nc,sampleRate:sr},fastStart:'in-memory'});
    const ve=new VideoEncoder({output:(c,m)=>mux.addVideoChunk(c,m),error:e=>{ err=e; }}); ve.configure(vcfg);
    const ae=new AudioEncoder({output:(c,m)=>mux.addAudioChunk(c,m),error:e=>{ err=e; }}); ae.configure(acfg);
    const ch=[...Array(nc).keys()].map(i=>audioBuf.getChannelData(i)), CH=4096;
    for(let o=0;o<audioBuf.length&&!err;o+=CH){
      const n=Math.min(CH,audioBuf.length-o), d=new Float32Array(n*nc); ch.forEach((c,i)=>d.set(c.subarray(o,o+n),i*n));
      ae.encode(new AudioData({format:'f32-planar',sampleRate:sr,numberOfFrames:n,numberOfChannels:nc,timestamp:Math.round(o/sr*1e6),data:d}));
      if(ae.encodeQueueSize>30) await tick();
    }
    const total=Math.round(audioBuf.duration*fps);
    for(let i=0;i<total&&!cancel&&!err;i++){
      const t=i/fps;
      if(bgMode==='video'&&bgVideoEl){ bgVideoEl.currentTime=t%(bgVideoEl.duration||1); await new Promise(r=>{ const f=()=>{ bgVideoEl.removeEventListener('seeked',f); r(); }; bgVideoEl.addEventListener('seeked',f); setTimeout(r,250); }); }
      if(S.watermark&&wmType==='video'&&wmVideoEl){const wt=t%(wmVideoEl.duration||1);if(Math.abs(wmVideoEl.currentTime-wt)>.02){wmVideoEl.currentTime=wt;await new Promise(r=>{const f=()=>{wmVideoEl.removeEventListener('seeked',f);r();};wmVideoEl.addEventListener('seeked',f);setTimeout(r,250);});}}
      drawFrame(t);
      const fr=new VideoFrame(canvas,{timestamp:Math.round(t*1e6),duration:Math.round(1e6/fps)});
      ve.encode(fr,{keyFrame:i%(fps*2)===0}); fr.close();
      if(ve.encodeQueueSize>8) await tick();
      if(i%10===0){ const progress=i/total;fill.style.width=(progress*100)+'%'; status.textContent='Exportando MP4… '+Math.round(progress*100)+'%';updateTopExport(progress,'Cuadro '+(i+1).toLocaleString('es-AR')+' de '+total.toLocaleString('es-AR'));await tick(); }
    }
    if(cancel){ status.textContent='Exportación cancelada.'; }
    else{
      // WebCodecs closes an encoder automatically if the browser or hardware
      // encoder fails (often under heavy 1080p/240 FPS load). In that case
      // flush() itself throws InvalidStateError and hides the original cause.
      if(err) throw err;
      if(ve.state!=='configured') throw new Error('El codificador de video se cerró antes de terminar. Prueba con menos FPS o resolución.');
      await ve.flush();
      if(err) throw err;
      if(ae.state!=='configured') throw new Error('El codificador de audio se cerró antes de terminar.');
      await ae.flush(); if(err) throw err; mux.finalize();
      const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([target.buffer],{type:'video/mp4'})); a.download=safeName()+'.mp4'; a.className='dl'; a.textContent='✓ Descargar '+safeName()+'.mp4';
      status.innerHTML=''; status.appendChild(a); fill.style.width='100%';exportSucceeded=true;
    }
  }catch(e){ status.textContent='No se pudo exportar el MP4: '+(e&&e.message||e); }
  finishTopExport(exportSucceeded,cancel?'Exportación cancelada.':exportSucceeded?'Archivo MP4 listo para descargar.':'No se pudo completar la exportación.');
  exportInProgress=false;btn.classList.remove('recording'); btn.textContent='Exportar video'; stopBtn.style.display='none'; setControlsLocked(false); if(wmWasPlaying&&wmVideoEl)wmVideoEl.play().catch(()=>{}); drawFrame(getCurrentTime());
  return true;
}
if(!window.VideoEncoder) $('expStatus').textContent='Este navegador exporta en .webm. Para MP4 usa Chrome o Edge actualizados.';

// imán al arrastrar bloques: playhead y bordes de otras líneas
function snapT(v,self){
  let best=v, bd=8/pps;
  [getCurrentTime(),...lyricLines.filter(l=>l!==self).flatMap(l=>[l.start,l.end])].forEach(x=>{ if(Math.abs(x-v)<bd){ bd=Math.abs(x-v); best=x; } });
  return best;
}
// velocidad de reproducción + bucle de la línea elegida
const tb=document.querySelector('.tlbar'), tg=$('splitBtn');
tb.insertAdjacentHTML('afterbegin','<button class="btn-sm" id="loopBtn" title="Repetir la línea elegida">↻ Bucle</button>');
$('rate').onchange=()=>{ audioEl.playbackRate=+$('rate').value; audioEl.preservesPitch=true; };
let loopOn=false; $('loopBtn').onclick=()=>{ loopOn=!loopOn; $('loopBtn').style.borderColor=loopOn?'var(--gold)':''; $('loopBtn').style.color=loopOn?'var(--gold)':''; };
setInterval(()=>{ if(loopOn&&isPlaying&&sel&&!document.body.classList.contains('locked')&&audioEl.currentTime>=sel.end-0.02) audioEl.currentTime=sel.start; },40);
// .srt, desfase global, PNG
const eh=document.querySelector('.editor-head span:last-child');
eh.insertAdjacentHTML('beforeend','<span class="et-group"><span class="et-label">Descargar</span><span id="dlSlot"></span><button class="btn-sm" id="srtBtn" title="Descarga subtítulos (.srt), para YouTube y editores de video">.srt</button></span><span class="et-group"><span class="et-label">Mover toda la letra</span><button class="btn-sm" id="shM" title="Adelantar toda la letra 0.1 s (aparece antes)">−0.1 s</button><button class="btn-sm" id="shP" title="Retrasar toda la letra 0.1 s (aparece después)">+0.1 s</button></span>');
$('lrcBtn').textContent='.lrc'; $('lrcBtn').title='Descarga la letra con tiempos (.lrc), para reproductores y karaoke'; $('dlSlot').replaceWith($('lrcBtn'));
const srtT=t=>{ const ms=Math.round(t*1000), p=(n,l=2)=>String(n).padStart(l,'0'); return `${p(ms/3600000|0)}:${p((ms/60000|0)%60)}:${p((ms/1000|0)%60)},${p(ms%1000,3)}`; };
$('srtBtn').onclick=()=>{ if(!lyricLines.length){ toast('No hay líneas para descargar.'); return; }
  downloadBlob(new Blob([lyricLines.map((l,i)=>`${i+1}\n${srtT(l.start)} --> ${srtT(l.end)}\n${l.text}\n`).join('\n')],{type:'text/plain'}),safeName()+'.srt'); };
function shiftAll(d){ lyricLines.forEach(l=>{ l.start=Math.max(0,l.start+d); l.end=Math.max(l.start+.1,l.end+d); if(l.wt) l.wt=l.wt.map(v=>Math.max(0,v+d)); }); buildEditor(); redraw(); }
$('shM').onclick=()=>shiftAll(-0.1); $('shP').onclick=()=>shiftAll(0.1);
const pngB=document.createElement('button'); pngB.id='pngCaptureBtn'; pngB.hidden=true; pngB.className='btn-sm'; pngB.textContent='PNG'; pngB.title='Guardar el cuadro actual como imagen';
pngB.onclick=()=>{if(!requireProFeature('La captura PNG'))return;canvas.toBlob(b=>downloadBlob(b,safeName()+'.png'));}; document.querySelector('#top .ex').prepend(pngB);
// licencias
const lb=document.createElement('div'); lb.className='licbox'; lb.hidden=true;
lb.innerHTML='<div><h2>Licencias</h2><p><b>Tipografías incluidas:</b> '+FONTS.map(f=>f.f).join(', ')+'. Se distribuyen bajo la SIL Open Font License 1.1; los derechos de autor pertenecen a sus respectivos autores (ver fonts.google.com).</p><p><b>mp4-muxer 5.2.2:</b> licencia MIT, © Vanilagy.</p><p><b>supabase-js 2.118.0:</b> licencia MIT, © Supabase.</p><p><button class="btn-sm" id="licX">Cerrar</button></p></div>';
document.body.append(lb); const lbtn=$('licensesBtn'); lbtn.onclick=()=>{ lb.hidden=false; }; lb.querySelector('#licX').onclick=()=>{ lb.hidden=true; };

// ================= ESTILO POR LÍNEA: copiar / quitar =================
const stClone=()=>JSON.parse(JSON.stringify(sel.st||null));
function stApply(list){ const st=stClone(); list.forEach(l=>{ if(l===sel) return; if(st) l.st=JSON.parse(JSON.stringify(st)); else delete l.st; }); redraw(); }
$('lnAll').onclick=()=>{if(!requireProFeature('Los estilos por línea'))return;if(!sel) return; if(!confirm('¿Copiar el estilo de esta línea a todas las demás?')) return; stApply(lyricLines); toast('Estilo copiado a todas las líneas.'); };
$('lnNext').onclick=()=>{if(!requireProFeature('Los estilos por línea'))return;if(!sel) return; stApply(lyricLines.slice(lyricLines.indexOf(sel)+1)); toast('Estilo copiado a las líneas siguientes.'); };
$('lnClear').onclick=()=>{if(!requireProFeature('Los estilos por línea'))return;if(!sel) return; delete sel.st; lnLoad(); redraw(); };

// ================= MOVER Y ROTAR EL TEXTO EN EL VISOR =================
const pvBox=document.createElement('div'); pvBox.id='pvBox'; pvBox.innerHTML='<div><u id="pvRot" title="Arrastra para rotar (Shift: de a 15°)"></u></div>';
document.querySelector('#studyEditorMonitor').append(pvBox);
const visLine=()=>lyricLines[currentLineIndex(getCurrentTime())];
function showSel(){ if(!sel||!audioLoaded||isPlaying) return; const t=getCurrentTime(); if(t<sel.start||t>=sel.end) seekTo(Math.min(sel.start+0.8,(sel.start+sel.end)/2)); }
function updateBox(t){   // marco de edición de la línea seleccionada (solo guía en pantalla, no se exporta)
  const l=sel, B=document.body.classList, g=l&&GEO.get(l);
  if(!g||isPlaying||!home.hidden||B.contains('locked')||(!B.contains('ml')&&!studyMode)||!activeLines(t).includes(l)){ pvBox.style.display='none'; return; }
  const k=canvas.clientWidth/canvas.width, o=posH==='left'?0:posH==='right'?-g.mw:-g.mw/2;
  pvBox.style.cssText=`display:block;left:${canvas.offsetLeft+g.ax*k}px;top:${canvas.offsetTop+g.cy*k}px;transform:rotate(${g.rot}deg)`;
  pvBox.firstElementChild.style.cssText=`left:${(o-12)*k}px;top:${(-g.th/2-10)*k}px;width:${(g.mw+24)*k}px;height:${(g.th+20)*k}px`;
  $('pvRot').style.left=((12-o)*k)+'px';
}
let pvDrag=null;
canvas.addEventListener('pointerdown',e=>{
  if(isPlaying||!home.hidden||(!document.body.classList.contains('ml')&&!studyMode)) return;
  if(!featurePro){if(pickLine(e))requireProFeature('El movimiento personalizado por línea');return;}
  const l=pickLine(e); if(!l) return; sel=l; markSel(); scrollRow(); canvas.setPointerCapture(e.pointerId);
  const st=l.st||(l.st={}); pvDrag={m:'move',l,x:e.clientX,y:e.clientY,dx:st.dx||0,dy:st.dy||0};
});
$('pvRot').addEventListener('pointerdown',e=>{if(!requireProFeature('La rotación personalizada por línea'))return;const l=activeLines(getCurrentTime()).includes(sel)?sel:null; if(!l) return; e.stopPropagation(); $('pvRot').setPointerCapture(e.pointerId); l.st=l.st||{}; sel=l; pvDrag={m:'rot',l}; });
const pvMove=e=>{
  const d=pvDrag; if(!d) return; const st=d.l.st;
  if(d.m==='move'){ st.dx=d.dx+(e.clientX-d.x)/canvas.clientWidth; st.dy=d.dy+(e.clientY-d.y)/canvas.clientHeight; if(Math.abs(st.dx)<0.012) st.dx=0; if(Math.abs(st.dy)<0.012) st.dy=0; }  // imán al centro
  else{ const r=pvBox.getBoundingClientRect(); let a=Math.atan2(e.clientY-r.top,e.clientX-r.left)*180/Math.PI+90; if(a>180) a-=360; st.rot=Math.round(e.shiftKey?Math.round(a/15)*15:(Math.abs(a)<4?0:a)); lnLoad(); }
  drawFrame(getCurrentTime());
};
const pvUp=()=>{ const d=pvDrag; if(!d) return; pvDrag=null; const st=d.l.st; ['dx','dy','rot'].forEach(k=>{ if(!st[k]) delete st[k]; }); if(!Object.keys(st).length) delete d.l.st; lnLoad(); redraw(); };
[canvas,$('pvRot')].forEach(el=>{ el.addEventListener('pointermove',pvMove); el.addEventListener('pointerup',pvUp); el.addEventListener('pointercancel',pvUp); });
$('lnCenter').onclick=()=>{if(!requireProFeature('El ajuste por línea'))return;if(!sel||!sel.st) return; ['dx','dy','rot'].forEach(k=>delete sel.st[k]); if(!Object.keys(sel.st).length) delete sel.st; lnLoad(); redraw(); };
function syncStudyGuides(){const m=$('studyEditorMonitor'),g=m&&m.querySelector('.study-guides');if(!g||!canvas)return;g.style.left=canvas.offsetLeft+'px';g.style.top=canvas.offsetTop+'px';g.style.width=canvas.clientWidth+'px';g.style.height=canvas.clientHeight+'px';}
function syncStudyControls(){if(!$('studyHint'))return;const g=sel&&activeLines(getCurrentTime()).includes(sel)&&GEO.get(sel),ids=['studyX','studyY','studyW','studyH','studyRot'];if(!g){ids.forEach(id=>{const el=$(id);if(el){el.value='';el.disabled=true;}});$('studyHint').textContent='Selecciona una línea para ajustar';return;}ids.forEach(id=>$(id).disabled=false);if(!document.activeElement.matches('.study-controls input')){$('studyX').value=Math.round(g.ax);$('studyY').value=Math.round(g.cy);$('studyW').value=Math.round(g.mw);$('studyH').value=Math.round(g.th);$('studyRot').value=Math.round(g.rot);} $('studyHint').textContent='Lienzo '+canvas.width+' × '+canvas.height+' px';}
function editStudyGeometry(){if(!sel)return;const g=GEO.get(sel);if(!g)return;const st=sel.st||(sel.st={}),w=canvas.width,h=canvas.height;if(document.activeElement.id==='studyX')st.dx=(+$('studyX').value-g.ax)/w+(st.dx||0);if(document.activeElement.id==='studyY')st.dy=(+$('studyY').value-g.cy)/h+(st.dy||0);if(document.activeElement.id==='studyRot'){const pose=keyframeState(sel,getCurrentTime());st.rot=(+$('studyRot').value)-pose.rot;}if(document.activeElement.id==='studyW'){const ratio=Math.max(1,+$('studyW').value)/(g.mw||1);st.sz=(st.sz||100)*ratio;}drawFrame(getCurrentTime());lnLoad();}
['studyX','studyY','studyW','studyRot'].forEach(id=>$(id).addEventListener('change',editStudyGeometry));

// ================= MULTICAPA: varias líneas en pantalla a la vez =================
const GEO=new WeakMap(), LH=26, LS=30; let LY0=92;
const maxLane=()=>lyricLines.reduce((m,l)=>Math.max(m,l.ly||0),0);
function normLanes(){ const u=[...new Set(lyricLines.map(l=>l.ly||0))].sort((a,b)=>a-b); lyricLines.forEach(l=>{ const n=u.indexOf(l.ly||0); if(n) l.ly=n; else delete l.ly; }); }
// líneas visibles en t: una por capa (si se pisan en la misma capa, gana la que empezó última), de arriba hacia abajo
function activeLines(t){
  const by={}; lyricLines.forEach(l=>{ if(t>=l.start&&t<l.end){ const k=l.ly||0; if(!by[k]||l.start>=by[k].start) by[k]=l; } });
  return Object.keys(by).map(Number).sort((a,b)=>a-b).map(k=>by[k]);
}
// Separa capas según la altura del texto visible, sus saltos de línea y rotación.
let laneLayoutMemory={offsets:new Map(),soloSince:0};
function stackedLaneOffsets(lines,t){
  const lanes=[...new Set(lines.map(l=>l.ly||0))].sort((a,b)=>a-b),result=new Map();
  if(!lanes.length)return result;
  if(lanes.length===1&&laneLayoutMemory.offsets.size>1){
    const now=performance.now();if(!laneLayoutMemory.soloSince)laneLayoutMemory.soloSince=now;
    if(now-laneLayoutMemory.soloSince<120)return new Map(laneLayoutMemory.offsets);
  }else laneLayoutMemory.soloSince=0;
  const metrics=new Map();let total=0;
  for(const lane of lanes){
    const l=lines.find(x=>(x.ly||0)===lane),sty=l.st||{},pose=keyframeState(l,t),fs=S.fontSize*(canvas.width/720)*((sty.sz||100)/100),fam=sty.font||S.font;
    let width,height;
    if(sty.comp){
      const comp=COMPOSITIONS.find(c=>c.id===sty.comp),words=wordsOf(S.upper?l.text.toUpperCase():l.text),n=words.length;
      if(n&&comp){ctx.font=fontW(fam)+' '+fs+'px "'+fam+'"';const maxRowW=canvas.width*.82,gap=fs*.13,rows=[];let row=[];
        words.forEach((word,i)=>{const slot=compositionSlot(comp.layout,i,n,fs,canvas.width),m=ctx.measureText(word),size=Math.min(slot.scale,maxRowW/(m.width||1)),item={metrics:m,size};const used=row.reduce((sum,x)=>sum+x.metrics.width*x.size,0)+gap*row.length;if(row.length&&(comp.layout==='column'||used+m.width*size>maxRowW)){rows.push(row);row=[];}row.push(item);});
        if(row.length)rows.push(row);const hs=rows.map(r=>Math.max(...r.map(x=>fs*x.size*1.18))),raw=hs.reduce((a,b)=>a+b,0)+fs*.2*Math.max(0,rows.length-1),fit=Math.min(1,(canvas.height*.56)/Math.max(1,raw));width=maxRowW*fit*pose.scale;height=raw*fit*pose.scale;
      }else{width=0;height=0;}
    }else{ctx.font=fontW(fam)+' '+fs+'px "'+fam+'"';const L=layout(S.upper?l.text.toUpperCase():l.text,fs,fam,canvas.width*.86,posH);width=L.maxW*pose.scale;height=L.totalH*pose.scale;}
    const angle=((sty.rot||0)+pose.rot)*Math.PI/180,boxH=Math.abs(Math.cos(angle))*height+Math.abs(Math.sin(angle))*width;
    const extent=Math.max(fs*1.35,boxH+fs*.42);metrics.set(lane,{extent,fs});total+=extent;
  }
  const gap=Math.max(12,S.fontSize*(canvas.width/720)*.32);total+=gap*(lanes.length-1);let cursor=-total/2;
  for(const lane of lanes){const m=metrics.get(lane),center=cursor+m.extent/2;result.set(lane,center);cursor+=m.extent+gap;}
  laneLayoutMemory.offsets=new Map(result);return result;
}
function pickLine(e){
  const r=canvas.getBoundingClientRect(), k=canvas.width/(r.width||1), px=(e.clientX-r.left)*k, py=(e.clientY-r.top)*k, act=activeLines(getCurrentTime());
  for(let i=act.length-1;i>=0;i--){ const g=GEO.get(act[i]); if(!g) continue;
    const a=-g.rot*Math.PI/180, dx=px-g.ax, dy=py-g.cy, x=dx*Math.cos(a)-dy*Math.sin(a), y=dx*Math.sin(a)+dy*Math.cos(a), o=posH==='left'?0:posH==='right'?-g.mw:-g.mw/2;
    if(x>=o-12&&x<=o+g.mw+12&&y>=-g.th/2-10&&y<=g.th/2+10) return act[i]; }
  return act.includes(sel)?sel:null;
}
$('lnLane').addEventListener('input',()=>{ if(!sel) return; const n=Math.max(1,Math.min(8,+$('lnLane').value||1))-1; if(n) sel.ly=n; else delete sel.ly; normLanes(); lnLoad(); redraw(); });
document.querySelector('.editor-head span:last-child').insertAdjacentHTML('beforeend',' <button class="btn-sm" id="autoL" title="Alterna las líneas en 2 capas y mantiene cada una visible hasta que termina la siguiente">2 capas</button>');
$('autoL').onclick=()=>{
  if(!featurePro){openLayersPreview();return;}
  const L=lyricLines.slice().sort((a,b)=>a.start-b.start); if(L.length<2){ toast('Necesitas al menos 2 líneas.'); return; }
  if(!confirm('Se van a alternar las líneas en 2 capas y extender cada una hasta que termine la siguiente (se puede deshacer con Ctrl+Z). ¿Seguir?')) return;
  L.forEach((l,i)=>{ if(i%2) l.ly=1; else delete l.ly; if(i<L.length-1) l.end=Math.max(l.end,L[i+1].end); });
  buildEditor(); redraw(); toast('Líneas repartidas en 2 capas.');
};

// ================= CUENTAS (Supabase: Google + correo) =================
const SB_CFG={ url:'https://fvnehoylbifarvwywims.supabase.co', key:'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ2bmVob3lsYmlmYXJ2d3l3aW1zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM0Nzg3NzcsImV4cCI6MjEwOTA1NDc3N30.u1_e7EZ3sgPBU9eLlo63UPXbNxAm-pjPjo3j4t29488' };   // ← pega la URL del proyecto y la clave "anon public" (Supabase → Project Settings → API). Nunca la "service_role".
const GOOGLE_CLIENT_ID='187964166185-1gqg0shbhaqip0sovsbltg2kc0mlvour.apps.googleusercontent.com';   // público (no es el secreto)
const PAYPAL_CLIENT_ID='BAAON7ZhnSLgbNwF-ogM55tHxa3f-x8nDGGz8B534pLoujT5BZdTQVpocYWPAGe4U9lJTDci0kWybdeNyo';   // ← Client ID de tu app de PayPal (es público). Sandbox para probar; el Live recién cuando vayas a cobrar de verdad.
const PRO_PRICE_TXT='US$ 15';
const Acct={ sb:null, user:null, plan:'guest' };            // plan: guest (sin sesión) | free | pro
const isPro=()=>Acct.plan==='pro';
const acctOn=()=>!!(SB_CFG.url&&SB_CFG.key&&window.supabase&&location.protocol!=='file:');
const acctMsg=(m,err)=>{ const e=document.getElementById('acctMsg'); if(e){ e.textContent=m||''; e.className='msg'+(err?' err':''); } };
const ab=document.createElement('button'); ab.className='btn-sm'; ab.id='acctBtn'; document.querySelector('#top').append(ab);
const hab=document.createElement('button'); hab.className='btn-sm'; hab.id='hAcct'; home.append(hab);
const am=document.createElement('div'); am.className='licbox'; am.hidden=true; document.body.append(am);
am.addEventListener('click',e=>{ if(e.target===am||e.target.closest('.x')) am.hidden=true; });
function acctInit(){
  if(!acctOn()){ acctUI(); tutorialAccountReady=true; maybeStartTutorial(); return; }
  Acct.sb=supabase.createClient(SB_CFG.url,SB_CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  Acct.sb.auth.onAuthStateChange((ev,ses)=>{ setTimeout(()=>acctSet(ses),0); });   // sin llamar a supabase dentro del callback
  Acct.sb.auth.getSession().then(({data})=>acctSet(data.session)).catch(()=>{tutorialAccountReady=true;maybeStartTutorial();});
}
async function acctSet(ses){
  Acct.user=ses?ses.user:null; Acct.plan=Acct.user?'free':'guest';
  if(Acct.user){ try{ const {data}=await Acct.sb.from('entitlements').select('plan').eq('user_id',Acct.user.id).maybeSingle(); if(data&&data.plan==='pro') Acct.plan='pro'; }catch(e){} }
  featurePro=isPro(); refreshFeatureAccess();tutorialAccountReady=true;maybeStartTutorial();
  if(location.hash.includes('access_token')||location.search.includes('code=')) history.replaceState(null,'',location.pathname);
  if(Acct.user&&!am.hidden) acctOpen(); acctUI();
}
function acctUI(){
  const u=Acct.user, ini=u?(u.email||'?')[0].toUpperCase():'';
  const html=u?`<span class="av">${esc(ini)}</span><span class="badge-plan${isPro()?' pro':''}">${isPro()?'PRO':'FREE'}</span>`:'Iniciar sesión';
  [ab,hab].forEach(b=>{ b.innerHTML=html; b.title=u?u.email:(acctOn()?'Iniciar sesión o crear cuenta':'Cuentas sin configurar'); });
}
function acctOpen(){
  const u=Acct.user; am.hidden=false;
  if(!acctOn()){ am.innerHTML=`<div class="acctbox"><button class="x" aria-label="Cerrar">×</button><h2>Cuentas</h2><p>${location.protocol==='file:'?'El inicio de sesión funciona solo en el sitio publicado, no abriendo el archivo desde tu computadora.':'Todavía no está configurado Supabase: pega la URL y la clave en <b>SB_CFG</b> dentro del código.'}</p></div>`; return; }
  if(u){
    am.innerHTML=`<div class="acctbox"><button class="x" aria-label="Cerrar">×</button><h2>Mi cuenta</h2><p>${esc(u.email||'')}</p>
      <p>Plan actual: <span class="badge-plan${isPro()?' pro':''}">${isPro()?'PRO':'FREE'}</span></p>
      ${isPro()?'<p>Gracias por apoyar Lyric Studio.</p>':'<div class="paybox"><p><b>Pro · '+PRO_PRICE_TXT+'</b> · pago único. Prueba la versión Free antes de comprar.</p><div id="ppBtn"></div></div>'}
      <div class="row2"><button class="btn-sm" id="aOut">Cerrar sesión</button><button class="btn-sm danger" id="aDel">Borrar mi cuenta</button></div><div class="msg" id="acctMsg"></div></div>`;
    if(!isPro()) acctPay();
    document.getElementById('aOut').onclick=async()=>{ await Acct.sb.auth.signOut(); am.hidden=true; };
    document.getElementById('aDel').onclick=async()=>{
      if(!confirm('Se borra tu cuenta y tu plan de forma permanente. Esto no se puede deshacer. ¿Seguir?')) return;
      const {error}=await Acct.sb.rpc('delete_my_account'); if(error){ acctMsg('No se pudo borrar: '+error.message,true); return; }
      await Acct.sb.auth.signOut(); am.hidden=true; toast('Cuenta borrada.');
    };
    return;
  }
  am.innerHTML=`<div class="acctbox"><button class="x" aria-label="Cerrar">×</button><h2>Iniciar sesión</h2><p>Crea una cuenta gratis o entra con la que ya tienes. Sin contraseñas.</p>
    <div id="gBtn" style="display:flex;justify-content:center;min-height:44px;"></div>
    <div class="or">o con tu correo</div><input type="email" id="aMail" placeholder="tu@correo.com" autocomplete="email"><button class="btn-primary" id="aSend" style="width:100%;">Enviarme un enlace de acceso</button><div class="msg" id="acctMsg"></div></div>`;
  acctGoogle();
  document.getElementById('aSend').onclick=async()=>{
    const mail=document.getElementById('aMail').value.trim(); if(!/^\S+@\S+\.\S+$/.test(mail)){ acctMsg('Escribe un correo válido.',true); return; }
    acctMsg('Enviando…'); const {error}=await Acct.sb.auth.signInWithOtp({email:mail,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:true}});
    acctMsg(error?error.message:'Listo: revisa tu correo y toca el enlace para entrar (mira también spam).',!!error);
  };
}
// Google con el botón oficial (Google Identity Services): no pasa por la pantalla "continuar a ...supabase.co"
let _gis=null;
function loadGIS(){
  if(window.google&&google.accounts&&google.accounts.id) return Promise.resolve();
  return _gis||(_gis=new Promise((ok,no)=>{ const sc=document.createElement('script'); sc.src='https://accounts.google.com/gsi/client'; sc.async=true; sc.onload=ok; sc.onerror=()=>{ _gis=null; no(new Error('gis')); }; document.head.appendChild(sc); setTimeout(()=>{ _gis=null; no(new Error('timeout')); },5000); }));
}
async function acctGoogle(){
  const box=document.getElementById('gBtn'); if(!box) return;
  const fallback=()=>{ box.innerHTML='<button class="gbtn" id="aGoogle"><svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>Continuar con Google</button>';
    document.getElementById('aGoogle').onclick=async()=>{ acctMsg('Abriendo Google…'); const {error}=await Acct.sb.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+location.pathname}}); if(error) acctMsg(error.message,true); }; };
  try{
    await loadGIS();
    const raw=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
    const hashed=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))].map(b=>b.toString(16).padStart(2,'0')).join('');
    google.accounts.id.initialize({ client_id:GOOGLE_CLIENT_ID, nonce:hashed, use_fedcm_for_prompt:true, callback:async r=>{
      acctMsg('Entrando…'); const {error}=await Acct.sb.auth.signInWithIdToken({provider:'google',token:r.credential,nonce:raw}); if(error) acctMsg(error.message,true); } });
    google.accounts.id.renderButton(box,{ theme:'filled_black', size:'large', text:'continue_with', shape:'rectangular', width:340, locale:'es' });
  }catch(e){ fallback(); }
}
// Pago de Pro con PayPal: la página solo muestra el botón; el servidor crea el cobro, lo verifica y activa Pro
let _pp=null;
function loadPayPal(){
  if(window.paypal&&paypal.Buttons) return Promise.resolve();
  return _pp||(_pp=new Promise((ok,no)=>{ const sc=document.createElement('script');
    sc.src='https://www.paypal.com/sdk/js?client-id='+encodeURIComponent(PAYPAL_CLIENT_ID)+'&currency=USD&intent=capture&components=buttons&disable-funding=credit,paylater';
    sc.onload=ok; sc.onerror=()=>{ _pp=null; no(new Error('paypal')); }; document.head.appendChild(sc); setTimeout(()=>{ _pp=null; no(new Error('timeout')); },8000); }));
}
async function acctPay(){
  const box=document.getElementById('ppBtn'); if(!box) return;
  if(!PAYPAL_CLIENT_ID){ box.innerHTML='<p style="color:var(--ink-dim);font-size:12.5px;margin:0;">Los pagos todavía no están activados.</p>'; return; }
  try{
    await loadPayPal();
    paypal.Buttons({
      style:{layout:'vertical',color:'gold',shape:'rect',label:'pay',height:42},
      createOrder:async()=>{ const {data,error}=await Acct.sb.functions.invoke('paypal-create-order'); if(error||!data||!data.id) throw new Error('crear'); return data.id; },
      onApprove:async d=>{
        acctMsg('Confirmando el pago…');
        const {data,error}=await Acct.sb.functions.invoke('paypal-capture-order',{body:{orderID:d.orderID}});
        if(error||!data||!data.ok){ acctMsg('Si te cobraron y no se activó Pro, escribinos a support@lyricstudio.site con este número de orden: '+d.orderID,true); return; }
        const {data:s}=await Acct.sb.auth.getSession(); await acctSet(s.session); location.assign('../gracias-pro.html');
      },
      onCancel:()=>acctMsg('Cancelaste el pago. No se cobró nada.'),
      onError:()=>acctMsg('No se pudo completar el pago. Prueba de nuevo.',true)
    }).render('#ppBtn');
  }catch(e){ box.innerHTML='<p style="color:#ff8a80;font-size:12.5px;margin:0;">No pudimos cargar PayPal. Revisa tu conexión o desactiva el bloqueador de anuncios.</p>'; }
}
ab.onclick=hab.onclick=acctOpen;
acctInit();
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||e.target.closest('input,textarea,select,[contenteditable=true]'))return;
  if(e.key.toLowerCase()==='o'){e.preventDefault();startTutorial('pro',true,!featurePro);}
});

// ---- barra superior: estados fuera de la barra ----
(function(){
  const strip=document.createElement('div'); strip.id='stStrip';
  strip.append($('projStatus'),$('expStatus'));
  document.querySelector('#center .cbar').append(strip);
})();

syncSettings(); buildEditor(); commit();
refreshFeatureAccess();
drawFrame(0);
