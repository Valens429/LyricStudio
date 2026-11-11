// Inicio de sesión con Google / enlace por correo en la app de escritorio.
// Google NO permite iniciar sesión dentro de ventanas embebidas (Electron), así que el login se hace en el
// navegador normal del usuario y la sesión vuelve a la app por el servidor local (ver server.js).
'use strict';
const {ipcMain,shell}=require('electron');
const crypto=require('crypto');
const pending=new Map();                       // nonce → caducidad. Un solo uso.
const TTL=60*60*1000;                          // el enlace del correo puede tardar en abrirse

function register({getWindow,getOrigin}){
  const sweep=()=>{ const now=Date.now(); pending.forEach((exp,k)=>{ if(exp<now) pending.delete(k); }); };
  ipcMain.handle('auth:begin',()=>{
    sweep(); const n=crypto.randomBytes(16).toString('hex'); pending.set(n,Date.now()+TTL);
    return {redirectTo:getOrigin()+'/auth-callback/'+n};            // sin parámetros: encaja con "http://127.0.0.1:47831/**" en Supabase
  });
  ipcMain.handle('auth:openExternal',(e,url)=>{
    try{ const u=new URL(url); if(u.protocol!=='https:') return false; shell.openExternal(u.href); return true; }catch(_){ return false; }
  });
  return {
    consume(n){ const exp=pending.get(n); if(!exp||exp<Date.now()) return false; pending.delete(n); return true; },
    deliver(payload){ const w=getWindow(); if(!w) return; w.webContents.send('auth:result',payload); if(w.isMinimized()) w.restore(); w.show(); w.focus(); }
  };
}
module.exports={register};
