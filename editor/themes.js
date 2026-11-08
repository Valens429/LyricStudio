// Lyric Studio · Temas de color
// styles.css define la paleta como variables --k-RRGGBB (valores del tema Ámbar). Este archivo las recolorea:
// cada color se clasifica (neutros de fondo / acento / otros) y se transforma según el tema elegido.
(()=>{
'use strict';
const KEY='lyricStudio.theme';
const TOKENS='05030a 050408 07050a 071d18 08050d 08060b 09070d 0a070e 100d14 100d16 100d17 111111 120e17 131018 150f1b 15111a 15111b 160f18 16121a 17121d 17131d 17131e 171717 18141d 1b1520 1b1620 1b1621 1c1722 1e2d29 1f1f1f 201a28 211a28 211a29 241804 241b2b 241d2c 261f2e 263a55 27202f 276d60 292033 29212f 2a2232 2a2331 2b2232 2b2331 2c2435 2c2436 2f2437 302337 302639 30263b 302738 33291c 342842 342a35 342b3d 35283a 352b32 393043 3a2f2a 3a3044 3a3145 3ec9a7 403149 403648 413147 45394f 463447 493522 4d4259 4fd8b5 51445f 51d4b0 5a2f33 62506c 62556d 6b566f 6b5c7b 71607f 7a4836 7a5260 80654d 827588 83768d 8c6a38 8e6b38 8e8199 8f8198 98702f 9a8aa5 9b622b a99bb8 aaaaaa c4b8cd c7bbd0 c9bdcf cdbfd5 d78227 d7cbdc d8892d d8c9e0 ddd3e3 e2a55b e6d4b7 e8654d e8a33d ef8b38 efaa42 efe9f2 f0b559 f1b24f f4bd5e f4be5b f59a85 f5c46b f6c16d f6efe3 ff8a80 ffcf72 ffd351 ffd68b fff0b7 fff8ed'.split(' ');
// base: tono (h), saturación (s, multiplicador) y oscurecido (l, multiplicador) de los neutros de fondo.
// acc: tono (h), saturación objetivo (s) y luminosidad objetivo (L) del color de acento.
const THEMES={
  ambar:    {name:'Ámbar'},
  azul:     {name:'Azul',      base:{h:222,s:.90,l:1},   acc:{h:214,s:.92,L:.62}},
  violeta:  {name:'Violeta',   base:{h:268,s:1.10,l:1},  acc:{h:262,s:.90,L:.74}},
  esmeralda:{name:'Esmeralda', base:{h:168,s:.55,l:1},   acc:{h:152,s:.60,L:.52}},
  focus:    {name:'Focus',     base:{h:230,s:.04,l:.70}, acc:{h:0,s:0,L:.93}}
};
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const M=Math.max(r,g,b),m=Math.min(r,g,b),l=(M+m)/2;let h=0,s=0;
  if(M!==m){const d=M-m;s=l>.5?d/(2-M-m):d/(M+m);h=M===r?(g-b)/d+(g<b?6:0):M===g?(b-r)/d+2:(r-g)/d+4;h*=60;}return[h,s,l];}
function hsl2rgb(h,s,l){h=((h%360)+360)%360/360;if(!s){const v=Math.round(l*255);return[v,v,v];}
  const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q,f=t=>{t=(t+1)%1;return t<1/6?p+(q-p)*6*t:t<.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};
  return[f(h+1/3),f(h),f(h-1/3)].map(v=>Math.round(clamp(v)*255));}
const toHex=a=>'#'+a.map(v=>v.toString(16).padStart(2,'0')).join('');
const parse=h=>{h=h.replace('#','');if(h.length===3)h=[...h].map(c=>c+c).join('');return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
// transforma un color del tema Ámbar al tema T
function xf(rgb,T){
  if(!T.base)return rgb;
  const[h,s,l]=rgb2hsl(...rgb);
  if(s<.07)return rgb;                                        // grises, blancos y negros: igual
  if(h>=8&&h<=58&&s>=.12){                                    // familia del acento (ámbar)
    const k=sstep(.25,.6,l);
    return hsl2rgb(T.acc.h+(h-36)*.25,Math.min(1,s*(T.acc.s/.79)),clamp(l+(T.acc.L-.57)*k,0,.98));}
  if(h>=235&&h<=335&&s<.5)                                    // neutros de fondo (violeta oscuro)
    return hsl2rgb(T.base.h+(h-285)*.2,Math.min(1,s*T.base.s),l<.55?l*T.base.l:l);
  return rgb;                                                 // verde azulado, rojo de error, etc.: igual
}
let cur='ambar',cache=new Map();
const root=document.documentElement;
function apply(name,save=true){
  const T=THEMES[name]||THEMES.ambar; if(!THEMES[name])name='ambar';
  TOKENS.forEach(t=>{ if(T.base)root.style.setProperty('--k-'+t,toHex(xf(parse(t),T))); else root.style.removeProperty('--k-'+t); });
  root.dataset.theme=name; cur=name; cache=new Map();
  const m=document.querySelector('meta[name="theme-color"]'); if(m)m.content=color('#1B1620');
  if(save){try{localStorage.setItem(KEY,name);}catch(e){}}
  window.dispatchEvent(new CustomEvent('themechange',{detail:name}));
}
// color de la interfaz para canvas y estilos en JS: Theme.color('#E8A33D') o Theme.color('#E8A33D',.5)
function color(hex,a){
  const k=hex+'|'+a; if(cache.has(k))return cache.get(k);
  const T=THEMES[cur]||THEMES.ambar,c=xf(parse(hex),T); const v=a==null?toHex(c):`rgba(${c[0]},${c[1]},${c[2]},${a})`;
  cache.set(k,v); return v;
}
window.Theme={
  apply,color,current:()=>cur,
  get list(){return Object.keys(THEMES).map(id=>{const T=THEMES[id];return{id,name:T.name,bg:toHex(xf(parse('1B1620'),T)),acc:toHex(xf(parse('E8A33D'),T))};});}
};
let saved='ambar'; try{saved=localStorage.getItem(KEY)||'ambar';}catch(e){}
apply(saved,false);
})();
