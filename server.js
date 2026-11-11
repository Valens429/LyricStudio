// Servidor local mínimo: sirve la carpeta del editor por http://127.0.0.1 (más fiable que file://
// para sesiones, almacenamiento y peticiones). Solo escucha en tu propio equipo.
'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.gif':'image/gif',
  '.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.txt':'text/plain; charset=utf-8',
  '.wasm':'application/wasm','.mjs':'text/javascript; charset=utf-8','.xml':'application/xml; charset=utf-8','.map':'application/json','.csv':'text/csv; charset=utf-8',
  '.avif':'image/avif','.m4v':'video/mp4','.mov':'video/quicktime','.m4a':'audio/mp4','.aac':'audio/aac','.ogg':'audio/ogg','.opus':'audio/ogg','.flac':'audio/flac'};

// Página que abre el navegador al terminar el login: lee la sesión del enlace y se la entrega a la app.
const CALLBACK_HTML=`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lyric Studio</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0a10;color:#fff;font:16px system-ui,sans-serif;text-align:center">
<div style="max-width:420px;padding:24px"><h1 id="t" style="font-size:22px">Conectando con Lyric Studio…</h1><p id="m" style="color:#aaa;line-height:1.5"></p></div>
<script>(()=>{const n=location.pathname.split('/').pop(),h=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search);
const b={access_token:h.get('access_token'),refresh_token:h.get('refresh_token'),error:h.get('error_description')||q.get('error_description')||h.get('error')||q.get('error')};
history.replaceState(null,'',location.pathname);
const t=document.getElementById('t'),m=document.getElementById('m');
if(!b.error&&!(b.access_token&&b.refresh_token)){t.textContent='No hay datos de sesión';m.textContent='Vuelve a Lyric Studio e inicia sesión de nuevo.';return;}
fetch('/__auth/'+n,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json()).then(r=>{
 if(r.ok){t.textContent=b.error?'No se pudo iniciar sesión':'¡Listo!';m.textContent=b.error?'Vuelve a Lyric Studio para ver el detalle.':'Ya puedes cerrar esta pestaña y volver a Lyric Studio.';}
 else{t.textContent='Enlace caducado o ya usado';m.textContent='Vuelve a Lyric Studio y pide el acceso otra vez.';}
}).catch(()=>{t.textContent='Lyric Studio no está abierto';m.textContent='Abre la app de escritorio y pide el acceso otra vez.';});})();</script></body></html>`;

function startServer(root,port,hooks){
  root=path.resolve(root); hooks=hooks||{};
  let boundPort=0;
  const sameHost=req=>req.headers.host==='127.0.0.1:'+boundPort;
  const srv=http.createServer((req,res)=>{
    try{
      const url=new URL(req.url,'http://x');
      // ── Inicio de sesión desde el navegador del sistema ──
      let m=/^\/auth-callback\/([0-9a-f]{32})$/.exec(url.pathname);
      if(m&&req.method==='GET'){
        if(!sameHost(req)){ res.writeHead(403); return res.end(); }
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}); return res.end(CALLBACK_HTML);
      }
      m=/^\/__auth\/([0-9a-f]{32})$/.exec(url.pathname);
      if(m&&req.method==='POST'){
        const origin=req.headers.origin;
        if(!sameHost(req)||(origin&&origin!=='http://127.0.0.1:'+boundPort)){ res.writeHead(403); return res.end(); }   // evita que otra web nos envíe datos
        let size=0; const chunks=[];
        req.on('data',d=>{ size+=d.length; if(size>16384){ res.writeHead(413); res.end(); req.destroy(); } else chunks.push(d); });
        req.on('end',()=>{
          if(res.writableEnded) return;
          const send=(c,o)=>{ res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(o)); };
          let b; try{ b=JSON.parse(Buffer.concat(chunks).toString('utf8')); }catch(e){ return send(400,{ok:false}); }
          const str=(v,max)=>typeof v==='string'&&v.length<=max?v:null;
          const out={access_token:str(b.access_token,4096),refresh_token:str(b.refresh_token,4096),error:str(b.error,300)};
          if(!out.error&&!(out.access_token&&out.refresh_token)) return send(400,{ok:false});
          if(!hooks.consume||!hooks.consume(m[1])) return send(410,{ok:false});         // un solo uso y con caducidad
          hooks.deliver&&hooks.deliver(out); send(200,{ok:true});
        });
        return;
      }
      let p=decodeURIComponent(url.pathname);
      if(p.endsWith('/')) p+='index.html';
      const file=path.resolve(path.join(root,p));
      if(file!==root&&!file.startsWith(root+path.sep)){ res.writeHead(403); return res.end(); }   // impide salir de la carpeta
      fs.stat(file,(e,st)=>{
        if(e||!st.isFile()){ res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'}); return res.end('No encontrado'); }
        res.writeHead(200,{'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','Cache-Control':'no-cache'});
        fs.createReadStream(file).pipe(res);
      });
    }catch(e){ res.writeHead(400); res.end(); }
  });
  // Puerto fijo para que la sesión y los datos guardados se mantengan entre aperturas (dependen del origen);
  // si está ocupado, usa otro libre.
  return new Promise((resolve,reject)=>{
    const go=pt=>{ srv.once('error',e=>{ if(e.code==='EADDRINUSE'&&pt!==0) go(0); else reject(e); });
      srv.listen(pt,'127.0.0.1',()=>{ boundPort=srv.address().port; resolve({server:srv,port:boundPort}); }); };
    go(port);
  });
}
module.exports={startServer};
