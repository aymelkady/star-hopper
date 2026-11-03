// Colour audit: node test/color-audit.mjs [--write]
// Loads dist/star-hopper.html in Playwright, starts a game, walks scene.traverse() and lists every
// material (name, type, colour hex, HSL saturation, mesh count, vertex-colour stats).  Flags any
// neutral grey (HSL saturation < 8 %, lightness 6-96 %) in material colours AND in vertex colours.
// --write regenerates docs/COLOR-AUDIT.md.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// where each named material is created (for the report)
const FILES = {
  'static-vc': 'src/world/world.js (zone builders: zones/*.js, dressing.js)', terrain: 'src/world/terrain.js', horizon: 'src/world/horizon.js',
  'cloud-sea': 'src/world/horizon.js', 'sky-dome': 'src/world/sky.js', sun: 'src/world/sky.js', cloud: 'src/world/sky.js', water: 'src/world/water.js',
  'props-vc': 'src/world/props.js', coin: 'src/world/props.js', 'red-coin': 'src/world/props.js', star: 'src/world/props.js', 'star-ghost': 'src/world/props.js',
  'star-glow': 'src/world/props.js', 'checkpoint-flag': 'src/world/props.js', 'switch-button': 'src/world/props.js', 'lantern-glass': 'src/world/props.js',
  'lantern-glow': 'src/world/props.js', 'sign-board': 'src/world/props-extra.js', waterfall: 'src/world/props-extra.js', bell: 'src/world/props-extra.js',
  'chime-number': 'src/world/props-extra.js', 'race-ghost': 'src/world/props-extra.js', 'wind-streaks': 'src/world/props-extra.js',
  'grass-tufts': 'src/world/dressing.js', 'flower-petals': 'src/world/dressing.js', 'flower-stems': 'src/world/dressing.js',
};
const METALLIC = new Set(['bell', 'chime-1', 'chime-2', 'chime-3', 'chime-4']);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(pathToFileURL(join(root, 'dist/star-hopper.html')).href);
await page.waitForTimeout(800);
await page.evaluate(() => window.__game.start(3));
await page.waitForFunction(() => window.__game.ready);
await page.waitForTimeout(400);
const mats = await page.evaluate(() => {
  const toS = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
  const hsl = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; const d = mx - mn; const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1)); return [s, l]; };
  const isGrey = (r, g, b) => { const [s, l] = hsl(r, g, b); return s < 0.08 && l > 0.06 && l < 0.96; };
  const out = new Map();
  window.__game.scene.traverse(o => {
    const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of list) {
      const key = m.uuid;
      let e = out.get(key);
      if (!e) {
        const hex = m.color ? '#' + m.color.getHexString() : '-';
        const [s, l] = m.color ? hsl(...m.color.toArray().map(toS)) : [1, 0.5];
        e = { name: m.name || '(unnamed)', type: m.type, hex, sat: +(s * 100).toFixed(0), light: +(l * 100).toFixed(0), vertexColors: !!m.vertexColors,
          map: !!m.map, emissive: m.emissive ? '#' + m.emissive.getHexString() : '', meshes: 0, objects: new Set(), vc: { verts: 0, grey: 0, uniq: new Set() }, inst: { n: 0, grey: 0 } };
        out.set(key, e);
      }
      e.meshes++; e.objects.add(o.name || o.parent?.name || o.type);
      const col = o.geometry && o.geometry.attributes && o.geometry.attributes.color;
      if (m.vertexColors && col) {
        const a = col.array, it = col.itemSize;
        for (let i = 0; i < col.count; i++) {
          const r = toS(Math.min(1, a[i * it])), g = toS(Math.min(1, a[i * it + 1])), b = toS(Math.min(1, a[i * it + 2]));
          e.vc.verts++; if (isGrey(r, g, b)) e.vc.grey++;
          if (e.vc.uniq.size < 4000) e.vc.uniq.add(((r * 31) | 0) * 1024 + ((g * 31) | 0) * 32 + ((b * 31) | 0));
        }
      }
      if (o.isInstancedMesh && o.instanceColor) {
        const a = o.instanceColor.array;
        for (let i = 0; i < o.count; i++) { e.inst.n++; if (isGrey(toS(a[i * 3]), toS(a[i * 3 + 1]), toS(a[i * 3 + 2]))) e.inst.grey++; }
      }
    }
  });
  return [...out.values()].map(e => ({ ...e, objects: [...e.objects].slice(0, 6).join(', '), vc: { verts: e.vc.verts, grey: e.vc.grey, colours: e.vc.uniq.size } }));
});
const drawCalls = await page.evaluate(() => window.__game.drawCalls());
await browser.close();

// merge identical (name, type, hex) rows
const rows = new Map();
for (const m of mats) {
  const k = `${m.name}|${m.type}|${m.hex}|${m.vertexColors}`;
  const r = rows.get(k);
  if (r) { r.count++; r.meshes += m.meshes; r.vc.verts += m.vc.verts; r.vc.grey += m.vc.grey; if (!r.objects.includes(m.objects.split(',')[0])) r.objects += ', ' + m.objects.split(',')[0]; }
  else rows.set(k, { ...m, count: 1 });
}
const list = [...rows.values()].sort((a, b) => (FILES[a.name] ? 0 : 1) - (FILES[b.name] ? 0 : 1) || a.name.localeCompare(b.name));
const greyMat = r => !r.vertexColors && !r.map && r.sat < 8 && r.light > 6 && r.light < 96;
let worldGrey = 0, otherGrey = 0, vcGrey = 0, vcTotal = 0;
for (const r of list) {
  const mine = !!FILES[r.name] || /^chime-/.test(r.name);
  r.file = FILES[r.name] || (/^chime-/.test(r.name) ? 'src/world/props-extra.js' : 'not src/world (player / systems / fx)');
  r.grey = greyMat(r) && !METALLIC.has(r.name);
  if (r.grey) (mine ? worldGrey++ : otherGrey++);
  if (mine) { vcGrey += r.vc.grey + (r.inst?.grey || 0); vcTotal += r.vc.verts; }
}
const lines = [];
lines.push('| Material | File | Type | Colour | Sat % | Instances | Where used | Vertex colours (grey / total) |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const r of list) lines.push(`| ${r.name}${r.grey ? ' **GREY**' : ''} | ${r.file} | ${r.type.replace('Material', '')} | \`${r.hex}\`${r.map ? ' + map' : ''}${r.vertexColors ? ' x vertex colours' : ''} | ${r.sat} | ${r.count} mat / ${r.meshes} mesh | ${r.objects} | ${r.vertexColors ? `${r.vc.grey} / ${r.vc.verts}` : '-'} |`);
const summary = [`Materials (unique by name/type/colour): ${list.length} (${mats.length} material objects)`,
  `Neutral-grey materials in src/world: ${worldGrey}`,
  `Grey vertex colours in src/world meshes: ${vcGrey} of ${vcTotal}`,
  `Grey materials outside src/world (not owned by the world pass): ${otherGrey}${otherGrey ? ' -> ' + list.filter(r => r.grey && r.file.startsWith('not')).map(r => `${r.name} ${r.hex} (${r.objects})`).join('; ') : ''}`,
  `Draw calls at the hub spawn: ${drawCalls}`];
console.log(lines.join('\n'));
console.log('\n' + summary.join('\n'));
if (process.argv.includes('--write')) {
  mkdirSync(join(root, 'docs'), { recursive: true });
  const md = `# Colour audit

Generated by \`node test/color-audit.mjs --write\` (Playwright: loads \`dist/star-hopper.html\`, starts a game,
walks \`scene.traverse()\` and lists every material).  Grey = HSL saturation < 8 % with lightness between 6 % and 96 %
(pure white highlights and near-black ink are not "grey areas").  Vertex-coloured meshes multiply a white material by
per-vertex colours taken from \`src/world/palette.js\`; every one of those vertices is checked too.  The deliberately
metallic details (bell, chimes) are exempt by design but are tinted anyway.

## Summary

${summary.map(s => '- ' + s).join('\n')}

## Every material in the scene

${lines.join('\n')}

## Palette (src/world/palette.js)

All world colours are named constants in \`src/world/palette.js\` (grass base \`#58c832\` / highlight \`#8fe85a\` / shadow \`#2f9a2a\`,
earth \`#b97a46\`, sand \`#f3d58a\`, warm stone \`#c9b8a8\` / \`#8c7466\`, layered sandstone, wood, leaves, water, sky, 3 mountain
layers, snow, 4 flower colours, painted tower stone and zone accents).  No other file in \`src/world\` contains a colour hex literal
except the black "off" emissive of the chimes / unlit lanterns (canvas textures for signs, sun glow and waterfall use CSS colours).
`;
  writeFileSync(join(root, 'docs/COLOR-AUDIT.md'), md);
  console.log('wrote docs/COLOR-AUDIT.md');
}
