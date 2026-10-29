import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5175/');
  await page.waitForFunction(() => window.__sim);
  await page.evaluate(() => {
    window.probe = {frees:{}, releases:{}, started:{}};
    const track = (sim, tag) => {
      const world = sim.physics.world, free = world.free.bind(world);
      world.free = () => { window.probe.frees[tag] = (window.probe.frees[tag] ?? 0) + 1; free(); };
    };
    track(window.__sim, 0);
    const proto = Object.getPrototypeOf(window.__sim), start = proto.start;
    proto.start = async function() {
      const tag = this.env('TAG'); track(this, tag);
      window.probe.started[tag] = true;
      if (tag === 1 || tag === 3) await new Promise(resolve => {window.probe.releases[tag] = resolve;});
      return start.call(this);
    };
  });
  const run = tag => page.evaluate(tag => {
    document.querySelector('#source').value = `Val { TAG(default=${tag}) } ${tag === 4 ? '' : 'Body { Core() }'}`;
    document.querySelector('#run').click();
  }, tag);
  await run(1);
  await page.waitForFunction(() => window.probe.releases[1]);
  await run(2);
  await page.waitForFunction(() => window.__sim?.env('TAG') === 2 && location.hash.startsWith('#m='));
  const hash = await page.evaluate(() => location.hash);
  await page.evaluate(() => window.probe.releases[1]());
  await page.waitForFunction(() => window.probe.frees[1] === 1);
  assert.deepEqual(await page.evaluate(() => ({tag:window.__sim.env('TAG'), free:window.probe.frees[0], hash:location.hash})), {tag:2, free:1, hash});
  await run(3);
  await page.waitForFunction(() => window.probe.releases[3]);
  await page.locator('#build').click();
  await page.evaluate(() => window.probe.releases[3]());
  await page.waitForFunction(() => window.probe.frees[3] === 1);
  assert.equal(await page.evaluate(() => document.body.classList.contains('building') && window.__sim === null), true);
  await run(4);
  await page.waitForFunction(() => window.probe.frees[4] === 1 && document.querySelector('#status').textContent.length > 0);
  assert.equal(await page.evaluate(() => location.hash), hash);
  await run(5);
  await page.waitForFunction(() => window.__sim?.env('TAG') === 5);
  assert.deepEqual(await page.evaluate(() => window.probe.frees), {'0':1,'1':1,'2':1,'3':1,'4':1});
  assert.equal(await page.locator('#status').textContent(), '');
  console.log('Load lifecycle: latest request wins; editor cancels; failure releases; recovery passes');
} finally { await browser.close(); }
