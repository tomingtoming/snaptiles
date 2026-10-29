// Diagnostic only: distinguish Windows WebKit screenshot limitations from app rendering.
// Run: node tools/webkit-resize-diagnostic.mjs
import {webkit} from 'playwright';
const browser=await webkit.launch();
try {
 const page=await browser.newPage({viewport:{width:390,height:400}});
 const inspector=await browser.newPage();
 await page.setContent('<canvas width="300" height="200"></canvas>');
 await page.evaluate(()=>{
  const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2');
  if(!gl)throw new Error('WebGL2 unavailable');
  window.diagnosticGL=gl;
  function draw(){gl.clearColor(1,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);requestAnimationFrame(draw)}draw();
 });
 async function capturedPixel(){
  const png=await page.screenshot();
  return inspector.evaluate(async base64=>{
   const img=new Image();img.src=`data:image/png;base64,${base64}`;await img.decode();
   const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
   const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(100,100,1,1).data];
  },png.toString('base64'));
 }
 const before=await capturedPixel();
 await page.evaluate(()=>{document.querySelector('canvas').height=150;window.diagnosticGL.viewport(0,0,300,150)});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const after=await capturedPixel();
 const framebuffer=await page.evaluate(()=>{
  const gl=window.diagnosticGL;gl.clearColor(1,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT);
  const pixel=new Uint8Array(4);gl.readPixels(100,100,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
  return {pixel:[...pixel],error:gl.getError(),lost:gl.isContextLost()};
 });
 console.log(JSON.stringify({platform:process.platform,webkit:browser.version(),before,after,framebuffer,
  captureLostAfterResize:before[0]===255&&before[1]===0&&after[1]===255&&framebuffer.pixel[1]===0}));
} finally {await browser.close()}
