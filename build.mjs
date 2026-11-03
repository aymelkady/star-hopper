// Bundles src/main.js with esbuild and inlines JS + CSS into dist/star-hopper.html
// (single self-contained file, no external references, opens from file://).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const result = await build({
  entryPoints: [join(root, 'src/main.js')],
  bundle: true, format: 'iife', minify: !process.env.DEBUG, target: 'es2020', write: false, legalComments: 'eof',
  logLevel: 'warning',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(join(root, 'src/style.css'), 'utf8');
let html = readFileSync(join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="src\/style.css">/, () => `<style>\n${css}\n</style>`);
html = html.replace(/<script type="module" src="src\/main.js"><\/script>/, () => `<script>\n${js}\n</script>`);
if (/src="src\//.test(html) || /href="src\//.test(html)) throw new Error('build: unreplaced src/ reference in index.html');
mkdirSync(join(root, 'dist'), { recursive: true });
const out = join(root, 'dist/star-hopper.html');
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(0);
console.log(`built dist/star-hopper.html (${kb} KB)`);

// Artifact variant: claude.ai Artifacts wrap the file in their own <!doctype html><head><body>
// skeleton, so emit head content + body content without the outer tags.
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset="utf-8">\s*/i, '').replace(/<title>Star Hopper<\/title>\s*/i, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const artifact = `<title>Star Hopper</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${head}\n${body}`;
const outA = join(root, 'dist/star-hopper.artifact.html');
writeFileSync(outA, artifact);
console.log(`built dist/star-hopper.artifact.html (${(statSync(outA).size / 1024).toFixed(0)} KB)`);
