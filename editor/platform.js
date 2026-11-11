// Lyric Studio · Detector de plataforma (web vs. escritorio)
// Se carga ANTES de app.js. Expone window.Platform y marca <html data-platform="web|desktop">.
(()=>{
'use strict';
// URL a la que lleva el cartel «Descargar versión de escritorio». Cámbiala cuando exista.
const DOWNLOAD_URL='https://lyricstudio.site/downloads';

function detect(){
  // 1) Override solo para pruebas locales: ?platform=desktop | ?platform=web | ?platform=reset
  const local=/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)||location.protocol==='file:';
  if(local){
    try{
      const q=new URLSearchParams(location.search).get('platform');
      if(q==='desktop'||q==='web') sessionStorage.setItem('lyricStudio.platform',q);
      if(q==='reset') sessionStorage.removeItem('lyricStudio.platform');
      const o=sessionStorage.getItem('lyricStudio.platform');
      if(o) return {kind:o==='desktop'?'override':'web',desktop:o==='desktop'};
    }catch(e){}
  }
  // 2) Puente explícito (RECOMENDADO): expónlo desde el preload, p. ej.
  //    contextBridge.exposeInMainWorld('lyricDesktop',{version:app.getVersion()})
  if(window.lyricDesktop) return {kind:'bridge',desktop:true};
  // 3) Electron (user-agent o process.versions)
  if(/\bElectron\//i.test(navigator.userAgent)||window.process?.versions?.electron) return {kind:'electron',desktop:true};
  // 4) Tauri v1 / v2
  if(window.__TAURI__||window.__TAURI_INTERNALS__) return {kind:'tauri',desktop:true};
  return {kind:'web',desktop:false};
}

const d=detect(), isDesktop=d.desktop;

const Platform={
  kind:d.kind,                       // 'web' | 'bridge' | 'electron' | 'tauri' | 'override'
  isDesktop, isWeb:!isDesktop,
  version:window.lyricDesktop?.version||null,
  downloadUrl:DOWNLOAD_URL,
  // Una sola fuente de verdad para "qué existe en cada versión".
  features:{
    workstation:isDesktop,           // salida a segundo monitor
    extremeExport:isDesktop,         // 1080p 240 fps, 4K60 y formatos extra (pendiente de implementar)
  },
  is:p=>p==='desktop'?isDesktop:!isDesktop,
  // Cartel para usuarios PRO en la web: la función vive en la app de escritorio.
  showDesktopNotice(featureName='Esta función'){
    document.getElementById('desktopNotice')?.remove();
    const m=document.createElement('div');
    m.id='desktopNotice';m.className='ws-modal';m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    m.innerHTML=`<section class="ws-box"><h2>${featureName} está en la versión de escritorio</h2>
      <p>Tu cuenta PRO ya la incluye. Para usar ${featureName} descarga la app de escritorio de Lyric Studio: necesita controlar tus monitores, algo que el navegador no permite de forma fiable.</p>
      <div class="ws-actions"><button class="btn-sm" type="button" data-close>Ahora no</button>
      <a class="btn-primary" href="${DOWNLOAD_URL}" target="_blank" rel="noopener" style="text-decoration:none;display:inline-flex;align-items:center">Descargar versión de escritorio</a></div></section>`;
    const esc=e=>{if(e.key==='Escape')close();};
    const close=()=>{m.remove();document.removeEventListener('keydown',esc,true);};
    m.addEventListener('click',e=>{if(e.target===m||e.target.closest('[data-close]'))close();});
    document.addEventListener('keydown',esc,true);
    document.body.append(m);m.querySelector('a').focus();
  }
};
window.Platform=Platform;

// Hooks para CSS: <elemento data-desktop-only> / <elemento data-web-only>
document.documentElement.dataset.platform=isDesktop?'desktop':'web';
const st=document.createElement('style');
st.textContent='[data-platform="web"] [data-desktop-only],[data-platform="desktop"] [data-web-only]{display:none!important}';
document.head.append(st);
})();
