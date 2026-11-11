// Lyric Studio · Inicio de sesión en la app de escritorio
// Google bloquea el login dentro de ventanas embebidas (Electron). Aquí, en escritorio, Google y el enlace por
// correo se abren en el navegador normal y la sesión vuelve a la app. En la web no hace nada.
// Se carga DESPUÉS de app.js.
(()=>{
'use strict';
const A=window.lyricDesktop&&window.lyricDesktop.auth;
if(!A||typeof Acct==='undefined') return;
const msg=(t,err)=>{ if(typeof acctMsg==='function') acctMsg(t,!!err); };

// La sesión llega desde el navegador → se activa en la app.
A.onResult(async r=>{
  if(r.error){ msg(r.error,true); return; }
  try{
    const {error}=await Acct.sb.auth.setSession({access_token:r.access_token,refresh_token:r.refresh_token});
    if(error) msg(error.message,true);
  }catch(e){ msg('No pude activar la sesión: '+(e&&e.message||e),true); }
});

const G_SVG='<svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>';

// Sustituye el botón oficial de Google (GIS), que Google no deja usar dentro de Electron.
function renderGoogle(){
  const box=document.getElementById('gBtn'); if(!box) return;
  box.innerHTML='<button class="gbtn" id="aGoogle" type="button">'+G_SVG+'Continuar con Google</button>';
  document.getElementById('aGoogle').onclick=async()=>{
    msg('Abriendo tu navegador…');
    try{
      const {redirectTo}=await A.begin();
      const {data,error}=await Acct.sb.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}});
      if(error||!data||!data.url){ msg((error&&error.message)||'No pude iniciar el acceso con Google.',true); return; }
      if(!(await A.openExternal(data.url))){ msg('No pude abrir el navegador.',true); return; }
      msg('Termina el inicio de sesión en tu navegador. Cuando acabes, esta ventana entrará sola.');
    }catch(e){ msg('No pude iniciar el acceso: '+(e&&e.message||e),true); }
  };
}
acctGoogle=async function(){ renderGoogle(); };      // acctUI() lo llama cada vez que dibuja el panel de cuenta
if(document.getElementById('gBtn')) renderGoogle();   // por si el panel ya estaba dibujado

// Enlace por correo: el correo debe volver a la app, no abrir el editor en el navegador.
document.addEventListener('click',async e=>{
  if(!(e.target.closest&&e.target.closest('#aSend'))) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const mail=(document.getElementById('aMail').value||'').trim();
  if(!/^\S+@\S+\.\S+$/.test(mail)){ msg('Escribe un correo válido.',true); return; }
  msg('Enviando…');
  try{
    const {redirectTo}=await A.begin();
    const {error}=await Acct.sb.auth.signInWithOtp({email:mail,options:{emailRedirectTo:redirectTo,shouldCreateUser:true}});
    msg(error?error.message:'Listo: revisa tu correo y toca el enlace (mira también spam). Se abrirá en tu navegador y la sesión volverá aquí; deja esta app abierta.',!!error);
  }catch(err){ msg('No pude enviar el enlace: '+(err&&err.message||err),true); }
},true);
})();
