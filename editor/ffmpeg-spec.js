// Lyric Studio · Especificación de exportación FFmpeg
// UN SOLO archivo compartido: lo usa la interfaz (export-desktop.js, vía window.FFSpec)
// y el proceso principal (electron-ffmpeg.js, vía require). El proceso principal vuelve a
// validar todo con normalize(), así la interfaz nunca puede pasarle argumentos arbitrarios a FFmpeg.
(function(root,factory){ if(typeof module==='object'&&module.exports) module.exports=factory(); else root.FFSpec=factory(); })(typeof self!=='undefined'?self:this,function(){
'use strict';

const RES=[144,240,360,480,720,1080,1440,2160,4320];
const RES_LABEL={144:'144p',240:'240p',360:'360p',480:'480p',720:'720p (HD)',1080:'1080p (Full HD)',1440:'1440p (2K)',2160:'2160p (4K)',4320:'4320p (8K)'};
const FPS=[24,25,30,50,60,72,90,120,144,165,240];
const SPEED_LABEL=['Muy rápida (menos compresión)','Rápida','Equilibrada','Lenta','Muy lenta (máxima compresión)'];
const QUALITY={
  max:{label:'Máxima (CRF 12)',crf:12}, high:{label:'Alta (CRF 18)',crf:18},
  balanced:{label:'Equilibrada (CRF 23)',crf:23}, small:{label:'Archivo pequeño (CRF 28)',crf:28},
  crf:{label:'Personalizada (CRF)'}, bitrate:{label:'Tasa de bits fija (kbps)'}, lossless:{label:'Sin pérdida'}
};

// Contenedor (la "extensión" que elige la persona) → qué códecs de video y audio admite.
const CONTAINERS={
  mp4 :{label:'MP4 (.mp4)',video:['h264','hevc','av1'],audio:['aac','mp3','copy'],faststart:true},
  mov :{label:'MOV (.mov)',video:['prores','h264','hevc'],audio:['aac','pcm','copy'],faststart:true},
  mkv :{label:'MKV (.mkv)',video:['h264','hevc','av1','vp9','ffv1'],audio:['aac','opus','flac','pcm','mp3','copy']},
  webm:{label:'WebM (.webm)',video:['vp9','av1'],audio:['opus']},
  gif :{label:'GIF animado (.gif)',video:['gif'],audio:[],maxRes:1080,maxFps:50}
};
const CODECS={
  h264  :{label:'H.264 / AVC',bits:[8],chroma:['420','422','444'],rates:['crf','bitrate','lossless'],gop:true},
  hevc  :{label:'H.265 / HEVC',bits:[8,10],chroma:['420','422','444'],rates:['crf','bitrate','lossless'],gop:true},
  av1   :{label:'AV1',bits:[8,10],chroma:['420'],rates:['crf','bitrate'],gop:true},
  vp9   :{label:'VP9',bits:[8,10],chroma:['420','422','444'],rates:['crf','bitrate','lossless'],gop:true},
  prores:{label:'Apple ProRes',bits:[10],chroma:[],rates:['profile']},
  ffv1  :{label:'FFV1 (sin pérdida)',bits:[8,10],chroma:['444'],rates:['lossless']},
  gif   :{label:'GIF',bits:[8],chroma:[],rates:[]}
};
const PRORES_LABEL=['Proxy','LT','422 estándar','422 HQ','4444','4444 XQ'];
const ACODECS={aac:'AAC',mp3:'MP3',opus:'Opus',flac:'FLAC (sin pérdida)',pcm:'PCM 24 bits (sin pérdida)',copy:'Original (sin recodificar)'};
// Audio que se puede copiar tal cual (por extensión del archivo de origen) a cada contenedor.
const COPY_OK={aac:['mp4','mov','mkv'],m4a:['mp4','mov','mkv'],mp3:['mp4','mkv'],flac:['mkv'],wav:['mov','mkv'],opus:['mkv','webm'],ogg:['mkv']};

// fam = familia de encoder de hardware (cada una usa opciones distintas)
const ENC={
  libx264:{codec:'h264'}, h264_nvenc:{codec:'h264',hw:1,fam:'nvenc'}, h264_qsv:{codec:'h264',hw:1,fam:'qsv'}, h264_amf:{codec:'h264',hw:1,fam:'amf'}, h264_videotoolbox:{codec:'h264',hw:1,fam:'vt'},
  libx265:{codec:'hevc'}, hevc_nvenc:{codec:'hevc',hw:1,fam:'nvenc'}, hevc_qsv:{codec:'hevc',hw:1,fam:'qsv'}, hevc_amf:{codec:'hevc',hw:1,fam:'amf'}, hevc_videotoolbox:{codec:'hevc',hw:1,fam:'vt'},
  libsvtav1:{codec:'av1'}, av1_nvenc:{codec:'av1',hw:1,fam:'nvenc'}, av1_qsv:{codec:'av1',hw:1,fam:'qsv'}, av1_amf:{codec:'av1',hw:1,fam:'amf'},
  'libvpx-vp9':{codec:'vp9'}, prores_ks:{codec:'prores'}, ffv1:{codec:'ffv1'}, gif:{codec:'gif'}
};
const PREF={
  h264:['h264_nvenc','h264_qsv','h264_amf','h264_videotoolbox','libx264'],
  hevc:['hevc_nvenc','hevc_qsv','hevc_amf','hevc_videotoolbox','libx265'],
  av1 :['av1_nvenc','av1_qsv','av1_amf','libsvtav1'],
  vp9 :['libvpx-vp9'], prores:['prores_ks'], ffv1:['ffv1'], gif:['gif']
};
const HW_NAMES=Object.keys(ENC).filter(n=>ENC[n].hw);
const ENC_LABEL=n=>({nvenc:'NVIDIA NVENC',qsv:'Intel Quick Sync',amf:'AMD AMF',vt:'Apple VideoToolbox'}[ENC[n].fam]||'Software ('+n+')');

// "Velocidad" 0 (muy rápida) … 4 (muy lenta) → valor propio de cada encoder.
const X26={0:'veryfast',1:'fast',2:'medium',3:'slow',4:'veryslow'};
const SVT=[11,9,7,5,3], VPX=[5,4,2,1,0], NV=['p1','p3','p4','p5','p7'], QSV=['veryfast','fast','medium','slow','veryslow'], AMF=['speed','speed','balanced','quality','quality'];

const pick=(v,list,def)=>list.includes(v)?v:def;
const num=(v,min,max,def)=>{v=+v;return Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):def;};
const ext_=name=>((String(name||'').split('.').pop())||'').toLowerCase();
const canCopyAudio=(srcName,ext)=>!!(COPY_OK[ext_(srcName)]||[]).includes(ext);

// Convierte lo que venga (interfaz o IPC) en una especificación segura y coherente.
function normalize(r,caps){
  r=r||{};
  const ext=pick(r.ext,Object.keys(CONTAINERS),'mp4'), C=CONTAINERS[ext];
  const codec=pick(r.codec,C.video,C.video[0]), K=CODECS[codec];
  const s={ext,codec};
  s.w=num(r.w,2,8192,1280); s.w-=s.w%2; s.h=num(r.h,2,8192,720); s.h-=s.h%2;
  s.fps=num(r.fps,1,C.maxFps||240,30);
  const q=Object.keys(QUALITY).includes(r.quality)?r.quality:'high';
  if(codec==='prores') s.rate='profile'; else if(codec==='ffv1') s.rate='lossless'; else if(codec==='gif') s.rate='none';
  else if(q==='bitrate') s.rate='bitrate'; else if(q==='lossless'&&K.rates.includes('lossless')) s.rate='lossless'; else s.rate='crf';
  s.crf=QUALITY[q]&&QUALITY[q].crf!=null?QUALITY[q].crf:num(r.crf,0,51,18);
  s.kbps=num(r.kbps,100,800000,20000);
  s.speed=num(r.speed,0,4,2);
  s.bits=pick(+r.bits,K.bits,K.bits[0]);
  s.chroma=K.chroma.length?pick(r.chroma,K.chroma,'420'):'420';
  s.prores=num(r.prores,0,5,3);
  s.gop=num(r.gop,0,10,2); s.threads=num(r.threads,0,64,0);
  s.faststart=!!(r.faststart&&C.faststart); s.bt709=r.bt709!==false;
  s.encoder=ENC[r.encoder]&&ENC[r.encoder].codec===codec&&(!caps||!caps.encoders||caps.encoders.includes(r.encoder))?r.encoder:null;
  s.hasAudio=C.audio.length>0&&r.hasAudio!==false;
  s.acodec=pick(r.acodec,C.audio,C.audio.find(a=>a!=='copy')||'');
  if(s.acodec==='copy'&&!canCopyAudio(r.srcName,ext)) s.acodec=C.audio.find(a=>a!=='copy');
  s.abr=num(r.abr,32,512,192); s.asr=pick(+r.asr,[0,44100,48000,96000],0); s.ach=pick(+r.ach,[0,1,2],0);
  s.inPix=pick(r.inPix,['rgba','bgra','rgb0','bgr0'],'rgba');
  return s;
}

// Orden de encoders a probar. mode: 'auto' | 'hw' | 'sw' | nombre concreto de encoder.
// El hardware solo entra si el equipo lo tiene Y funciona (caps.working), y nunca para sin pérdida ni 4:2:2/4:4:4.
function encoderOrder(spec,caps,mode){
  const all=PREF[spec.codec]||[], has=n=>!caps||!caps.encoders||caps.encoders.includes(n);
  if(ENC[mode]) return ENC[mode].codec===spec.codec&&has(mode)?[mode]:[];
  const sw=all.filter(n=>!ENC[n].hw&&has(n));
  const hw=all.filter(n=>ENC[n].hw&&has(n)&&spec.rate!=='lossless'&&spec.chroma==='420'&&(!caps||!caps.working||caps.working.includes(n)));
  return mode==='sw'?sw:mode==='hw'?hw:hw.concat(sw);
}

function pixFor(s){
  const e=ENC[s.encoder], ten=s.bits===10;
  if(s.codec==='prores') return s.prores>=4?'yuv444p10le':'yuv422p10le';
  if(s.codec==='ffv1') return 'yuv444p'+(ten?'10le':'');
  if(s.codec==='gif') return 'rgb24';
  if(e.hw) return ten?'p010le':(e.fam==='qsv'||e.fam==='amf'?'nv12':'yuv420p');
  return 'yuv'+s.chroma+'p'+(ten?'10le':'');
}

// Filtro + códec de video (sin entradas ni salida). Se reutiliza para la prueba de compatibilidad.
function videoPart(s){
  const enc=s.encoder, e=ENC[enc], pix=pixFor(s), K=CODECS[s.codec], a=[];
  if(s.codec==='gif'){
    a.push('-vf','split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle','-loop','0');
    return a;
  }
  a.push('-vf',(s.bt709?'scale=out_color_matrix=bt709:out_range=tv,':'')+'format='+pix,'-c:v',enc);
  const crf=s.crf, c63=Math.round(crf*63/51), br=['-b:v',s.kbps+'k','-maxrate',Math.round(s.kbps*1.5)+'k','-bufsize',s.kbps*2+'k'];
  const bitrate=s.rate==='bitrate', lossless=s.rate==='lossless';
  if(enc==='libx264'||enc==='libx265'){
    a.push('-preset',X26[s.speed]);
    if(bitrate) a.push(...br); else if(lossless) a.push(...(enc==='libx264'?['-qp','0']:[])); else a.push('-crf',String(crf));
    if(enc==='libx265') a.push('-x265-params',(lossless?'lossless=1:':'')+'log-level=error');
  }else if(enc==='libsvtav1'){
    a.push('-preset',String(SVT[s.speed])); if(bitrate) a.push('-b:v',s.kbps+'k'); else a.push('-crf',String(c63));
  }else if(enc==='libvpx-vp9'){
    a.push('-row-mt','1','-deadline','good','-cpu-used',String(VPX[s.speed]));
    if(lossless) a.push('-lossless','1'); else if(bitrate) a.push('-b:v',s.kbps+'k'); else a.push('-crf',String(c63),'-b:v','0');
  }else if(e.fam==='nvenc'){
    a.push('-preset',NV[s.speed],'-tune','hq','-rc','vbr'); if(bitrate) a.push(...br); else a.push('-cq',String(crf),'-b:v','0');
  }else if(e.fam==='qsv'){
    a.push('-preset',QSV[s.speed]); if(bitrate) a.push(...br); else a.push('-global_quality',String(crf));
  }else if(e.fam==='amf'){
    a.push('-quality',AMF[s.speed]);
    if(bitrate) a.push('-rc','vbr_peak',...br); else a.push('-rc','cqp','-qp_i',String(crf),'-qp_p',String(crf),...(s.codec==='av1'?[]:['-qp_b',String(crf)]));
  }else if(e.fam==='vt'){
    if(bitrate) a.push(...br); else a.push('-q:v',String(Math.max(1,Math.min(100,Math.round(100-crf*1.7)))));
  }else if(enc==='prores_ks'){
    a.push('-profile:v',String(s.prores),'-vendor','apl0');
  }else if(enc==='ffv1'){
    a.push('-level','3','-slicecrc','1');
  }
  if(K.gop&&s.gop>0) a.push('-g',String(Math.max(1,Math.round(s.gop*s.fps))));
  if(s.threads>0) a.push('-threads',String(s.threads));
  return a;
}

function audioPart(s){
  if(!s.hasAudio||!s.acodec) return [];
  const a=[], c=s.acodec;
  if(c==='copy') return ['-c:a','copy'];
  const lib={aac:'aac',mp3:'libmp3lame',opus:'libopus',flac:'flac',pcm:'pcm_s24le'}[c];
  a.push('-c:a',lib);
  if(c==='aac'||c==='mp3'||c==='opus') a.push('-b:a',s.abr+'k');
  if(c==='opus') a.push('-ar','48000'); else if(s.asr) a.push('-ar',String(s.asr));
  if(s.ach) a.push('-ac',String(s.ach));
  return a;
}

// Argumentos completos: los cuadros llegan crudos por stdin (pipe:0) y el audio es el archivo original.
function buildArgs(s,o){
  const a=['-y','-hide_banner','-loglevel','error','-nostats','-progress','pipe:1',
    '-f','rawvideo','-pix_fmt',s.inPix,'-s',s.w+'x'+s.h,'-framerate',String(s.fps),'-i','pipe:0'];
  const audio=s.hasAudio&&o.audioPath;
  if(audio) a.push('-i',o.audioPath);
  a.push('-map','0:v:0'); if(audio) a.push('-map','1:a:0');
  a.push(...videoPart(s));
  if(s.codec!=='gif'&&s.bt709) a.push('-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv');
  if(s.codec==='hevc'&&(s.ext==='mp4'||s.ext==='mov')) a.push('-tag:v','hvc1');
  if(audio) a.push(...audioPart(s));
  if(s.faststart) a.push('-movflags','+faststart');
  a.push(o.out);
  return a;
}

// Prueba corta (3 cuadros negros) para saber si un encoder realmente funciona con ese tamaño y fps.
function testArgs(s){
  return ['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s='+s.w+'x'+s.h+':r='+s.fps,
    '-frames:v','3',...videoPart(s),'-f','null','-'];
}

// "Exportación exigente": misma regla de siempre (≥ 1080p a 100 fps de carga) + 4K/8K + sin pérdida en alta resolución.
function demanding(w,h,fps,s){
  const reasons=[];
  if(w*h*fps>=1920*1080*100) reasons.push('muchos píxeles por segundo');
  if(Math.min(w,h)>=2160) reasons.push('resolución 4K o superior');
  if(s&&s.rate==='lossless'&&Math.min(w,h)>=1080) reasons.push('compresión sin pérdida');
  return {on:reasons.length>0,reasons,frameBytes:w*h*4,flowBps:w*h*4*fps};
}

return {RES,RES_LABEL,FPS,SPEED_LABEL,QUALITY,CONTAINERS,CODECS,PRORES_LABEL,ACODECS,ENC,PREF,HW_NAMES,ENC_LABEL,
  canCopyAudio,normalize,encoderOrder,videoPart,audioPart,buildArgs,testArgs,demanding};
});
