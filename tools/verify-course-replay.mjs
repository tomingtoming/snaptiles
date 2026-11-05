import assert from 'node:assert/strict';
import { firefox, webkit } from 'playwright';

/** @param {string} link @param {string} time @param {string[]} [rows] */
export async function verifyCourseReplay(link, time, rows = []) {
  // Re-run the same link in the other browser engines. Fast-forward the physics
  // to just before the finish, then let the normal UI evaluate the goal and time.
  for (const engine of [firefox, webkit]) {
    const receiver = await engine.launch();
    try {
      const tab = await receiver.newPage();
      await tab.goto(link);
      await tab.waitForFunction(() => window.__sim?.replaying, null, { timeout: 30000 });
      await tab.evaluate(frame => {
        const sim = window.__sim;
        while (sim.frame < frame) sim.step();
      }, Math.round(Number(time) * 30) - 12);
      const verified = tab.locator('#challenge-result[open]');
      await verified.waitFor({ timeout: 30000 });
      const body = await verified.textContent();
      assert.match(body, /確認済み/);
      assert.ok(body.includes('タイム' + time + ' 秒'), engine.name() + ': ' + body);
      for (const row of rows) assert.ok(body.includes(row), engine.name() + ': ' + row);
      console.log(engine.name(), 'verified', await tab.evaluate(() => window.__sim.scenario.id), 'in', time, 's');
    } finally {
      await receiver.close();
    }
  }
}
