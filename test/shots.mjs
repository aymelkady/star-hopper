// Screenshot helper: node test/shots.mjs -> test/shots/{title,hub,meadow,cove,towers}.png
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'test/shots'), { recursive: true });
const shot = n => join(root, `test/shots/${n}.png`);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()); });
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(pathToFileURL(join(root, 'dist/star-hopper.html')).href);
await page.waitForTimeout(1200);
await page.screenshot({ path: shot('title') });
await page.click('#btn-play'); await page.click('#slot-3');
await page.waitForFunction(() => window.__game.ready);
await page.waitForTimeout(800);
await page.screenshot({ path: shot('hub') });
// spot = [x, y, z, facing, cameraYaw]
const spots = { meadow: [-38, 1, 4, -Math.PI / 2], cove: [36, 1, -2, Math.PI / 2], towers: [0, 1, -46, Math.PI] };
for (const [name, [x, y, z, f]] of Object.entries(spots)) {
  await page.evaluate(([x, y, z, f]) => { const g = window.__game; g.teleport(x, y, z); g.player.facing = f; g.camera.snap(g.player.position, f); }, [x, y, z, f]);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(500); await page.keyboard.up('KeyW');
  await page.waitForTimeout(900);
  await page.screenshot({ path: shot(name) });
}
console.log('draw calls:', await page.evaluate(() => window.__game.drawCalls()));
await browser.close();
