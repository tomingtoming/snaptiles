import { findBlocks } from '../rc/parser';

/** A Lua API entry for the builder's reference list: what to insert and a one-line Japanese description. */
export interface LuaRef { name: string; insert: string; ja: string; group: string }

// Curated from docs/spec/lua-api.md and the measurements in docs/measured.md (n = chip number or a part name).
export const LUA_REF: LuaRef[] = [
  { group: '入力・時間', name: '_KEY(n)', insert: '_KEY(0)', ja: 'キーnを押している間1（0=↑ 1=↓ 2=← 3=→ …）' },
  { group: '入力・時間', name: '_KEYDOWN(n)', insert: '_KEYDOWN(0)', ja: 'キーnを押したフレームだけ1' },
  { group: '入力・時間', name: '_KEYUP(n)', insert: '_KEYUP(0)', ja: 'キーnを離したフレームだけ1' },
  { group: '入力・時間', name: '_TICKS()', insert: '_TICKS()', ja: '読み込みからのフレーム数（1フレーム=1/30秒）' },
  { group: '入力・時間', name: '_FPS()', insert: '_FPS()', ja: '1秒あたりの更新回数' },
  { group: '入力・時間', name: 'out(行, ...)', insert: 'out(0, "value ", 0)', ja: '画面のn行目に値や文字を表示' },
  { group: '入力・時間', name: '_ZOOM(fov)', insert: '_ZOOM(0)', ja: '視野角（0で現在値を取得）' },
  { group: '位置・姿勢', name: '_X(n) _Y(n) _Z(n)', insert: '_Y(0)', ja: 'チップのワールド座標（m、_Yは海抜の高さ）' },
  { group: '位置・姿勢', name: '_H(n)', insert: '_H(0)', ja: '高さ：真下の地面までの距離（m、届かなければ−100000）' },
  { group: '位置・姿勢', name: '_EX(n) _EY(n) _EZ(n)', insert: '_EX(0)', ja: 'オイラー角（rad）' },
  { group: '位置・姿勢', name: '_AX(n) _AZ(n)', insert: '_AX(0)', ja: 'チップ自身の軸の傾き（rad、裏返しのチップでも0付近）' },
  { group: '位置・姿勢', name: '_AY(n)', insert: '_AY(0)', ja: '向き（ヨー、rad）' },
  { group: '位置・姿勢', name: '_RX(a,b) _RY(a,b) _RZ(a,b)', insert: '_RY(0, 1)', ja: 'チップbから見たaの相対角（rad）' },
  { group: '位置・姿勢', name: '_XX(n) … _ZZ(n)', insert: '_YY(0)', ja: 'チップのローカル軸のワールド成分（_YYは上向き成分）' },
  { group: '速度', name: '_VX(n) _VY(n) _VZ(n)', insert: '_VZ(0)', ja: '速度（m/s、チップから見た右/上/後ろ）' },
  { group: '速度', name: '_WX(n) _WY(n) _WZ(n)', insert: '_WX(0)', ja: '角速度（rad/s）。車輪の_WYは回転数' },
  { group: '機体', name: '_WEIGHT()', insert: '_WEIGHT()', ja: 'コアにつながっている部分の質量（kg、切り離した部分は除く）' },
  { group: '機体', name: '_CHIPS()', insert: '_CHIPS()', ja: 'チップ数（切り離した部分も含む）' },
  { group: '機体', name: '_M(n)', insert: '_M(0)', ja: 'チップの質量（kg）' },
  { group: '機体', name: '_GX(n) _GY(n) _GZ(n)', insert: '_GY(0)', ja: 'nから先の部分の重心' },
  { group: '機体', name: '_TYPE(n)', insert: '_TYPE(0)', ja: '種類番号（0 Core, 1 Chip, 4 Wheel, 7 Jet …）' },
  { group: '機体', name: '_PARENT(n)', insert: '_PARENT(0)', ja: '親チップの番号（なければ−1）' },
  { group: '機体', name: '_TOP(n)', insert: '_TOP(0)', ja: '属する系の根元のチップ番号' },
  { group: '機体', name: '_ANGLE(n) _POWER(n) …', insert: '_POWER(0)', ja: '部品の設定値（角度は度）' },
  { group: '機体', name: '_SPLIT(n)', insert: '_SPLIT(0)', ja: 'nを親から切り離す（出力は維持）' },
  { group: '機体', name: '_BYE(n)', insert: '_BYE(0)', ja: 'nを親から切り離す（出力は0に）' },
  { group: '機体', name: '_T(n)', insert: '_T(0)', ja: '耐久（0〜10000、壊れると−1）' },
  { group: '機体', name: '_FUEL(n) _FUELMAX(n)', insert: '_FUEL(0)', ja: 'nから先の部分の燃料と最大燃料' },
  { group: '数学', name: 'math.sin(x) math.cos(x)', insert: 'math.sin(0)', ja: '三角関数（rad）' },
  { group: '数学', name: 'math.atan2(y, x)', insert: 'math.atan2(0, 1)', ja: '角度（rad）' },
  { group: '数学', name: 'math.abs(x)', insert: 'math.abs(0)', ja: '絶対値' },
  { group: '数学', name: 'math.sqrt(x)', insert: 'math.sqrt(0)', ja: '平方根' },
  { group: '数学', name: 'math.max(a, b) math.min(a, b)', insert: 'math.max(0, 0)', ja: '大きい方／小さい方' },
  { group: '数学', name: 'math.rad(deg) math.deg(rad)', insert: 'math.rad(0)', ja: '度とradの変換' },
];

/** Ready-made pieces. VALUE/NAME are placeholders the builder replaces with the model's first Val. */
export const LUA_SNIPPETS: { label: string; body: string }[] = [
  { label: '毎フレームの処理（OnFrame）', body: 'function OnFrame()\n  \nend' },
  { label: '値を画面に表示', body: 'out(0, "VALUE = ", VALUE)' },
  { label: 'キーで値を動かす（押す間だけ）', body: 'if _KEY(0) > 0 then VALUE = 1000 elseif _KEY(1) > 0 then VALUE = -1000 else VALUE = 0 end' },
  { label: '高さを保つ（PD制御）', body: '-- 高さ5mを保つ: 目標との差と上下速度から出力を決める\nVALUE = (5 - _Y(0)) * 2000 - _VY(0) * 1000' },
  { label: '傾きを戻す（PD制御）', body: '-- 左右の傾き_AZと角速度_WZから操舵する\nVALUE = -(_AZ(0) * 40 + _WZ(0) * 10)' },
];

/** Where an insertion goes: inside the Lua section at the caret, else at the end of that section; with no Lua section
 *  one is appended holding an OnFrame (a snippet that is itself an OnFrame goes in as it is). */
export function insertScript(text: string, caret: number, snippet: string): { text: string; caret: number } {
  const lua = findBlocks(text).find(b => /^lua$/i.test(b.name));
  if (!lua) {
    const own = /^function\s+OnFrame\b/.test(snippet);
    const head = `${text.endsWith('\n') || !text ? '' : '\n'}Lua {\n`;
    const body = own ? snippet : `function OnFrame()\n  ${snippet.replace(/\n/g, '\n  ')}\nend`;
    const at = own ? body.indexOf('\n  ') + 3 : 'function OnFrame()\n  '.length + snippet.replace(/\n/g, '\n  ').length;
    return { text: `${text}${head}${body}\n}\n`, caret: text.length + head.length + at };
  }
  const start = lua.offset, end = lua.offset + lua.inner.length;
  if (caret >= start && caret <= end) return { text: text.slice(0, caret) + snippet + text.slice(caret), caret: caret + snippet.length };
  const lead = lua.inner.endsWith('\n') ? '' : '\n';
  return { text: text.slice(0, end) + lead + snippet + '\n' + text.slice(end), caret: end + lead.length + snippet.length };
}

/** The first "line N:" a diagnostic names, as offsets of that line in the source. */
export function diagnosticLine(text: string, message: string): { line: number; start: number; end: number } | null {
  const m = /\bline (\d+):/.exec(message);
  if (!m) return null;
  const line = Number(m[1]), lines = text.split('\n');
  if (line < 1 || line > lines.length) return null;
  const start = lines.slice(0, line - 1).reduce((s, l) => s + l.length + 1, 0);
  return { line, start, end: start + lines[line - 1].length };
}
