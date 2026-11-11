// Lyric Studio · Versión de escritorio (Electron)
// Abre tu editor (carpeta ./editor) en una ventana y le da acceso a FFmpeg.
'use strict';
const {app,BrowserWindow,shell,dialog}=require('electron');
const path=require('path'),fs=require('fs');
const {startServer}=require('./server');
const ffmpeg=require('./electron-ffmpeg');
const desktopAuth=require('./desktop-auth-main');

const EDITOR_DIR=path.resolve(process.env.LYRIC_EDITOR_DIR||path.join(__dirname,'editor'));
const PORT=47831;
let win=null, origin='';

async function createWindow(){
  if(!fs.existsSync(path.join(EDITOR_DIR,'index.html'))){
    dialog.showErrorBox('Lyric Studio','No encuentro el editor.\nCopia el contenido de tu carpeta "editor" dentro de:\n'+EDITOR_DIR);
    app.quit(); return;
  }
  ffmpeg.register(EDITOR_DIR);
  const auth=desktopAuth.register({getWindow:()=>win,getOrigin:()=>origin});
  const {port}=await startServer(EDITOR_DIR,PORT,auth);
  origin='http://127.0.0.1:'+port;
  win=new BrowserWindow({
    width:1440,height:900,minWidth:1000,minHeight:650,backgroundColor:'#0b0a10',title:'Lyric Studio',
    webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,
      additionalArguments:['--lyric-version='+app.getVersion()]}
  });
  // Enlaces externos → navegador; ventanas propias del editor (p. ej. segundo monitor) → dentro de la app.
  win.webContents.setWindowOpenHandler(({url})=>{
    if(url.startsWith(origin)||url==='about:blank') return {action:'allow'};
    if(/^https?:/i.test(url)) shell.openExternal(url);
    return {action:'deny'};
  });
  win.webContents.on('will-navigate',(e,url)=>{ if(!url.startsWith(origin)){ e.preventDefault(); if(/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on('closed',()=>{ win=null; });
  win.loadURL(origin+'/index.html');
}

if(!app.requestSingleInstanceLock()) app.quit();
else{
  app.on('second-instance',()=>{ if(win){ if(win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on('window-all-closed',()=>app.quit());
}
