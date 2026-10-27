#!/usr/bin/env node
// Build: embeds engine.dev.js into index.html and bakes the campaign levels.
//   node build.js          reuse baked levels if the engine is unchanged
//   node build.js --force  rebake all levels
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const COUNT = 120;
const dir = __dirname;
const enginePath = path.join(dir, 'engine.dev.js'), htmlPath = path.join(dir, 'index.html'), cachePath = path.join(dir, 'levels.baked.json');
const engine = fs.readFileSync(enginePath, 'utf8');
const hash = crypto.createHash('sha1').update(engine).update(String(COUNT)).digest('hex').slice(0, 12);
const E = new Function(engine + '\nreturn {generateLevel,encodeLevel,decodeLevel,verify,goalOf};')();

let cache = null;
try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) {}
let levels;
if (cache && cache.hash === hash && cache.levels.length === COUNT && !process.argv.includes('--force')) {
  levels = cache.levels; console.log('using cached levels');
} else {
  levels = [];
  const t0 = Date.now();
  for (let n = 1; n <= COUNT; n++) {
    const lv = E.generateLevel(n, { candidates: 60, cap: 20000 });
    E.goalOf(lv);
    if (!E.verify(lv)) throw new Error('level ' + n + ' failed verification');
    levels.push(E.encodeLevel(lv));
    if (n % 10 === 0) console.log('baked', n, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  fs.writeFileSync(cachePath, JSON.stringify({ hash, levels }) + '\n');
}

let html = fs.readFileSync(htmlPath, 'utf8');
const swap = (a, b, body) => {
  const re = new RegExp('(/\\*' + a + '\\*/)[\\s\\S]*?(/\\*' + b + '\\*/)');
  if (!re.test(html)) throw new Error('marker ' + a + ' missing');
  html = html.replace(re, (m, s, e) => s + '\n' + body + '\n' + e);
};
swap('ENGINE-START', 'ENGINE-END', engine.replace(/\$/g, '$'));
swap('BAKED-START', 'BAKED-END', 'const BAKED = ' + JSON.stringify(levels) + ';');
fs.writeFileSync(htmlPath, html);
console.log('built: ' + levels.length + ' levels, engine ' + hash);
