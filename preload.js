// Puente seguro entre el editor y la app de escritorio. platform.js detecta window.lyricDesktop.
'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const arg=process.argv.find(a=>a.startsWith('--lyric-version='));
contextBridge.exposeInMainWorld('lyricDesktop',{
  version:arg?arg.split('=')[1]:'dev',
  auth:{
    begin:()=>ipcRenderer.invoke('auth:begin'),
    openExternal:u=>ipcRenderer.invoke('auth:openExternal',u),
    onResult:cb=>{ ipcRenderer.on('auth:result',(e,d)=>cb(d)); }
  },
  ffmpeg:{
    probe:()=>ipcRenderer.invoke('ff:probe'),
    test:spec=>ipcRenderer.invoke('ff:test',spec),
    chooseOutput:o=>ipcRenderer.invoke('ff:chooseOutput',o),
    stashAudio:o=>ipcRenderer.invoke('ff:stashAudio',o),
    start:req=>ipcRenderer.invoke('ff:start',req),
    write:(id,buf)=>ipcRenderer.invoke('ff:write',id,buf),
    finish:id=>ipcRenderer.invoke('ff:finish',id),
    cancel:id=>ipcRenderer.invoke('ff:cancel',id),
    reveal:t=>ipcRenderer.invoke('ff:reveal',t)
  }
});
