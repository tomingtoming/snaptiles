// Oracle for the Rust core (core/PORT.md, stage 1): the TypeScript parse and rest-pose assembly of every corpus
// model and every sample, as JSON for core/tests/oracle.rs.   bun tools/export-oracle.ts [outDir]
//
// Corpus: D:/snaptiles-models/quarantine/original/runs/geom/index.tsv (n<TAB>path), text in models/<n>.txt.
// The assembly uses the default Val values the way Simulation does at load: Vals keyed by upper-case name (a later
// declaration of the same name wins), no chip names yet.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRc, countNodes, type ChipNode, type RcModel } from '../src/rc/parser';
import { assemble, assemblyBottom } from '../src/model/assemble';
import { SAMPLES } from '../src/samples';

const GEOM = 'D:/snaptiles-models/quarantine/original/runs/geom';
const OUT = resolve(process.argv[2] ?? 'D:/snaptiles-models/quarantine/oracle');
mkdirSync(OUT, { recursive: true });

const v3 = (v: { x: number; y: number; z: number }) => [v.x, v.y, v.z];

function nodes(n: ChipNode, out: unknown[] = []): unknown[] {
  out.push({ type: n.type, dir: n.dir, line: n.line, children: n.children.length, attrs: Object.entries(n.attrs) });
  for (const c of n.children) nodes(c, out);
  return out;
}

function oracle(name: string, sourcePath: string, origin: string) {
  const text = readFileSync(sourcePath, 'utf8');
  const out: Record<string, unknown> = { name, source: sourcePath, origin };
  let model: RcModel;
  try {
    model = parseRc(text);
  } catch (e) {
    out.parse = { error: (e as Error).message, errorClass: (e as Error).constructor.name };
    return out;
  }
  out.parse = {
    vals: model.vals.map((v) => ({ name: v.name, default: v.default, min: v.min, max: v.max, step: v.step, disp: v.disp ?? null })),
    keys: model.keys.map((k) => ({ key: k.key, var: k.var, step: k.step })),
    bodies: model.bodies.length,
    nodeCount: model.bodies.reduce((s, b) => s + countNodes(b), 0),
    nodes: model.bodies.flatMap((b) => nodes(b)),
    script: model.script && { lang: model.script.lang, line: model.script.line, firstLine: model.script.firstLine, source: model.script.source },
    warnings: model.warnings,
  };
  const vals = new Map<string, number>();
  for (const v of model.vals) vals.set(v.name.toUpperCase(), v.default);
  const env = (n: string) => vals.get(n.toUpperCase());
  try {
    const a = assemble(model, env);
    out.assemble = a && {
      chipCount: a.chipCount,
      roots: a.roots.map((r) => r.id),
      bottom: assemblyBottom(a),
      tiles: a.tiles.map((t) => ({
        type: t.type,
        dir: t.dir,
        parent: t.parent ? t.parent.id : -1,
        chipIndex: t.chipIndex,
        mass: t.mass,
        option: t.option,
        ghost: t.ghost,
        name: t.name,
        color: t.color,
        colorExpr: t.colorExpr,
        effectExpr: t.effectExpr,
        position: v3(t.position),
        quaternion: [t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w],
        anchor: v3(t.anchor),
        axis: v3(t.axis),
        rimAnchor: v3(t.rimAnchor),
        rimAxis: v3(t.rimAxis),
        dirAxis: v3(t.dirAxis),
        local: t.local && { anchor: v3(t.local.anchor), axis: v3(t.local.axis), rimAnchor: v3(t.local.rimAnchor), rimAxis: v3(t.local.rimAxis), dirAxis: v3(t.local.dirAxis) },
      })),
    };
  } catch (e) {
    out.assemble = { error: (e as Error).message };
  }
  return out;
}

let count = 0;
const index = join(GEOM, 'index.tsv');
if (existsSync(index)) {
  for (const row of readFileSync(index, 'utf8').split(/\r?\n/)) {
    if (!row.trim()) continue;
    const [n, path] = row.split('\t');
    const src = join(GEOM, 'models', `${n}.txt`).replace(/\\/g, '/');
    writeFileSync(join(OUT, `corpus-${n}.json`), JSON.stringify(oracle(`corpus-${n}`, src, path)));
    count++;
  }
} else {
  console.warn(`no corpus index at ${index}`);
}
// synthetic edge cases for paths the corpus does not reach (errors, odd lexing, section rules)
const EDGES: Record<string, string> = {
  'unknown-part': 'Body{ Core(){ N:Chip(){} E:Gizmo(angle=3) } }',
  'unclosed': 'Val{ A(default=1) }\r\nBody\r\n{ Core(){ N:Chip() }\r\n',
  'key-before-number': 'Key{ A(step=1) }',
  'missing-paren': 'Body{\n Core(){\n  N:Chip(angle=1, \n }\n}',
  'ident-expected': 'Val{ A(default=1) 5 }',
  'eof-after-equals': 'Val{ A(default= }',
  'eof-in-children': 'Body{ Core(){ "}" }',
  'scripts': 'Script\n{ a = 1 }\nLua\n\n{\n x = "}" -- }\n --[[ { ]]\n}\nScript { b }\nFoo{ x }\nBody{ Core() }',
  'values': [
    'Var{ A(default=#27AD96, min=-1e3, max=0x10, step=.5, disp=0), B(default=1e999), A(default=7) ; C }',
    'Key{ 0:A(step=-2) B 1.5:C(5) #A:D }',
    '/* { */ Body{ // }',
    ' Core(color=#f00, name = "co re", effect=A*2){',
    '  n:Chip(angle=-A*2+(3/0)--comment',
    '  , option=1){ W:Frame(option=1, angle=45){ S:Wheel(angle=90){} } E:Trim(angle=30){ N:Rudder(angle=20) } }',
    '  Weight(option=12) Weight(option=0) RLW(name=x) Cowl(color=B) Jet(angle=1e-1) Arm(option=A/0)',
    ' }, ;',
    ' Core(){ S:TrimF(angle=-90){ W:RudderF(angle=180) } }',
    '}',
  ].join('\n'),
};
for (const [name, source] of Object.entries(EDGES)) {
  const src = join(OUT, `edge-${name}.rc`).replace(/\\/g, '/');
  writeFileSync(src, source);
  writeFileSync(join(OUT, `edge-${name}.json`), JSON.stringify(oracle(`edge-${name}`, src, 'tools/export-oracle.ts')));
  count++;
}
for (const s of SAMPLES) {
  // samples live in TypeScript strings; write the text next to the JSON so the Rust test can read it
  const src = join(OUT, `sample-${s.name}.rc`).replace(/\\/g, '/');
  writeFileSync(src, s.source);
  writeFileSync(join(OUT, `sample-${s.name}.json`), JSON.stringify(oracle(`sample-${s.name}`, src, `src/samples/${s.name}.ts`)));
  count++;
}
console.log(`wrote ${count} oracle files to ${OUT}`);
