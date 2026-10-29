// Manual diagnostic: native WebKit dialog cancellation before/after presentation.
// Reports counts; the immediate-input case is timing-dependent, not a product test.
import {webkit} from 'playwright';const b=await webkit.launch();try{
 for(const settle of [false,true]){let failed=0;for(let i=0;i<12;i++){
  const p=await b.newPage();await p.setContent('<button id="open">open</button><dialog id="modal"><select id="select"><option>A</option><option>B</option></select></dialog><script>document.querySelector("#open").onclick=()=>{document.querySelector("#modal").showModal();document.querySelector("#select").focus()}</script>');await p.click('#open');
  if(settle)await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await p.keyboard.press('Escape');try{await p.waitForFunction(()=>!document.querySelector('#modal').open,null,{timeout:300})}catch{failed++}await p.close();
 }console.log(JSON.stringify({minimal:true,settle,failed,total:12}))}
}finally{await b.close()}
