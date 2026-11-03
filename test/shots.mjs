// Screenshot helper: node test/shots.mjs -> test/shots/*.png (+ draw-call report)
// Captures the title, the classic zone views and the graphics vantage points from DESIGN.md §5.2:
// treehouse top looking at the mountains, the Sky Towers summit looking out (both ways), the cove
// beach, the meadow waterfall and a phone-size shot.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'test/shots'), { recursive: true });
const shot = n => join(root, `test/shots/${n}.png`);
const url = pathToFileURL(join(root, 'dist/star-hopper.html')).href;
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;

// spot = [x, y, z, facing]; facing 0 = +z, PI/2 = +x, PI = -z, -PI/2 = -x
const SPOTS = {
  meadow: [-38, 1, 4, -Math.PI / 2],
  cove: [36, 1, -2, Math.PI / 2],
  towers: [0, 1, -46, Math.PI],
  'hub-treetop': [1, 7.2, -4.7, -Math.PI / 2 + 0.2],
  'hub-east': [4.5, 7.2, -1, Math.PI / 2 + 0.3],
  'towers-summit': [1, 17.7, -92.6, 0.15],
  'towers-north': [1, 17.7, -93, Math.PI - 0.5],
  'cove-beach': [34, 1, 12, Math.PI / 2 + 0.35],
  'meadow-waterfall': [-74, 1, 3, -Math.PI / 2],
  'meadow-hill': [HILLX(), 13, -22, 0.6],
};
function HILLX() { return -67; }

async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
  page.on('pageerror', e => console.log('page error:', e.message));
  await page.goto(url);
  await page.waitForTimeout(1000);
  return { ctx, page };
}
async function startPlay(page) {
  await page.evaluate(() => window.__game.start(3));
  await page.waitForFunction(() => window.__game.ready);
  // hide DOM overlays that might cover the world (quest card etc.) for clean art shots
  await page.evaluate(() => { for (const el of document.querySelectorAll('.quest-card, #quest-card, .toast, #toast')) el.style.display = 'none'; });
  await page.waitForTimeout(600);
}
async function goTo(page, [x, y, z, f]) {
  await page.evaluate(([x, y, z, f]) => {
    const g = window.__game; g.teleport(x, y, z); g.player.facing = f; g.camera.snap(g.player.position, f);
  }, [x, y, z, f]);
  await page.waitForTimeout(900);
}

const browser = await chromium.launch();
const report = {};
{ // desktop 1280x720
  const { ctx, page } = await open(browser, { viewport: { width: 1280, height: 720 } });
  if (!only || only.has('title')) await page.screenshot({ path: shot('title') });
  await page.click('#btn-play'); await page.click('#slot-3');
  await page.waitForFunction(() => window.__game.ready);
  await page.waitForTimeout(900);
  if (!only || only.has('hub')) await page.screenshot({ path: shot('hub') });
  report.desktop = { hub: await page.evaluate(() => window.__game.drawCalls()) };
  for (const [name, spot] of Object.entries(SPOTS)) {
    if (only && !only.has(name)) continue;
    await goTo(page, spot);
    await page.screenshot({ path: shot(name) });
    report.desktop[name] = await page.evaluate(() => window.__game.drawCalls());
  }
  await ctx.close();
}
if (!only || only.has('phone')) { // phone 844x390 touch
  const { ctx, page } = await open(browser, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await startPlay(page);
  await page.touchscreen.tap(422, 300); await page.waitForTimeout(500); // dismiss the how-to-move card
  await page.screenshot({ path: shot('phone') });
  report.mobile = { hub: await page.evaluate(() => window.__game.drawCalls()) };
  for (const name of ['towers-summit', 'cove-beach']) { await goTo(page, SPOTS[name]); report.mobile[name] = await page.evaluate(() => window.__game.drawCalls()); }
  await goTo(page, SPOTS['hub-treetop']);
  await page.screenshot({ path: shot('phone-treetop') });
  report.mobile['hub-treetop'] = await page.evaluate(() => window.__game.drawCalls());
  await ctx.close();
}
console.log('draw calls:', JSON.stringify(report));
await browser.close();
