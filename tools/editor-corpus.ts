import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { strict as assert } from 'node:assert';
import { ModelDocument } from '../src/editor/document';
import { parseRc } from '../src/rc/parser';
import { assemble } from '../src/model/assemble';
const root = resolve(process.argv[2]);
function files(dir: string): string[] { return readdirSync(dir, {withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):/\.(rcd|txt|rc)$/i.test(e.name)?[join(dir,e.name)]:[]); }
const results: {file:string; state:string; nodes?:number; ms?:number; error?:string}[]=[];
for (const file of files(root)) {
 const bytes=readFileSync(file); let text=new TextDecoder().decode(bytes); if(text.includes('\ufffd')) text=new TextDecoder('shift_jis').decode(bytes);
 if (!/\bBody\s*\{/i.test(text)) { results.push({file:relative(root,file),state:'not-model'}); continue; }
 const start=performance.now();
 try {
  const d=new ModelDocument(text), original=d.text, model=parseRc(original), nodes=d.nodes();
  const env=(name:string)=>model.vals.find(v=>v.name.toUpperCase()===name.toUpperCase())?.default;
  assert.ok(assemble(model,env));
  const script=model.script?.source;
  d.add(0,'N','Chip'); assert.equal(d.nodes().length,nodes.length+1); assert.equal(parseRc(d.text).script?.source,script); d.undo(); assert.equal(d.text,original);
  const index=nodes.findIndex(n=>n.dir && (!n.attrs.angle || Number.isFinite(Number(n.attrs.angle.replace(/\s/g,'')))));
  if(index>=0) {d.angle(index,15); assert.equal(parseRc(d.text).script?.source,script);d.undo();assert.equal(d.text,original);}
  const leaf=nodes.findLastIndex(n=>n.dir && !n.attrs.name && !n.children.length);
  if(leaf>=0) {const branch=d.copyBranch(leaf);d.pasteBranch(0,'S',branch);assert.equal(d.nodes().length,nodes.length+1);d.undo();assert.equal(d.text,original);}
  results.push({file:relative(root,file),state:'pass',nodes:nodes.length,ms:Math.round(performance.now()-start)});
 } catch(error) {results.push({file:relative(root,file),state:'fail',error:String(error)});}
}
mkdirSync(resolve('.shots'),{recursive:true});writeFileSync(resolve(`.shots/editor-corpus-${basename(root)}.json`),JSON.stringify(results,null,2));
console.log(JSON.stringify({total:results.length,pass:results.filter(r=>r.state==='pass').length,nonModels:results.filter(r=>r.state==='not-model').length,failures:results.filter(r=>r.state==='fail'),slowest:results.filter(r=>r.state==='pass').sort((a,b)=>b.ms!-a.ms!).slice(0,3)},null,2));
if(results.some(r=>r.state==='fail')) process.exitCode=1;
