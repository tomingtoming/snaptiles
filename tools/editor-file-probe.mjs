import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5175/');
  await page.waitForFunction(() => window.__sim);
  await page.click('#build');
  await page.click('#new-model');
  await page.click('[data-edge="N"]');
  const source = await page.inputValue('#source');
  const download = page.waitForEvent('download'); await page.click('#save-model');
  const savedFile = await download;
  assert.equal(savedFile.suggestedFilename(), 'model.rcd');
  assert.equal(await page.locator('#samples [aria-current="true"]').count(), 0);
  const stream = await savedFile.createReadStream();
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  assert.equal(buffer.toString(), source);
  await page.click('#new-model');
  const choose = async bytes => {
    const picker = page.waitForEvent('filechooser'); await page.click('#open-model');
    await (await picker).setFiles({name:'saved.rcd',mimeType:'text/plain',buffer:bytes});
  };
  await choose(buffer);
  await page.waitForFunction(() => window.__sim?.assembly?.tiles.length === 2 && !document.body.classList.contains('building'));
  assert.equal(await page.inputValue('#source'), source);
  await page.click('#build'); await page.click('#new-model');
  await choose(buffer); // Same file can be selected again.
  await page.waitForFunction(() => window.__sim?.assembly?.tiles.length === 2 && !document.body.classList.contains('building'));
  assert.equal(await page.inputValue('#source'), source);
  const expectName = async name => {
    const download = page.waitForEvent('download'); await page.click('#save-model');
    assert.equal((await download).suggestedFilename(), name);
  };
  await page.click('#build'); await page.click('[data-edge="E"]');
  await expectName('saved.rcd');
  await page.click('#new-model'); await expectName('model.rcd');
  await page.click('#edit-undo'); await expectName('saved.rcd');
  // A reload must restore the filename together with the edited draft.
  await page.reload(); await page.waitForFunction(() => window.__sim);
  await page.click('#build'); await page.click('#restore-draft');
  await expectName('saved.rcd');
  // Legacy Shift-JIS comment: Japanese 'test' plus an ASCII model.
  const legacy = Buffer.concat([Buffer.from([47,47,32,0x83,0x65,0x83,0x58,0x83,0x67,10]),buffer]);
  await choose(legacy);
  await page.waitForFunction(() => document.querySelector('#source').value.startsWith('// テスト'));
  await page.waitForFunction(() => window.__sim?.assembly?.tiles.length === 2 && !document.body.classList.contains('building'));
  await page.click('#build');
  const before = await page.inputValue('#source');
  await page.evaluate(() => { window.originalRead = File.prototype.arrayBuffer; File.prototype.arrayBuffer = async () => {throw new Error('read failed');}; });
  await choose(buffer);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('ファイルを開けませんでした'));
  assert.equal(await page.inputValue('#source'), before);
  assert.equal(await page.locator('#builder').isVisible(), true);
  await page.screenshot({path:fileURLToPath(new URL('../.shots/editor-open-mobile.png',import.meta.url))});
  await page.evaluate(() => {File.prototype.arrayBuffer = window.originalRead;});
  await choose(buffer);
  await page.waitForFunction(() => window.__sim?.assembly?.tiles.length === 2 && !document.querySelector('#status').textContent);
  assert.deepEqual(errors, []);
  console.log('File reopening: actual download, picker, repeat selection, Shift-JIS, read failure preserves editor, recovery pass');
} finally { await browser.close(); }
