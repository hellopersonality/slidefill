#!/usr/bin/env node
// Stamp a new build version into index.html and version.json.
// Run before every commit that should notify players: `node bump-version.js`
const fs = require('fs');
const path = require('path');

const d = new Date();
const p = (n, l = 2) => String(n).padStart(l, '0');
const v = d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds());

const htmlPath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const re = /const VERSION = '\d+';/;
if (!re.test(html)) { console.error('VERSION constant not found in index.html'); process.exit(1); }
fs.writeFileSync(htmlPath, html.replace(re, "const VERSION = '" + v + "';"));
fs.writeFileSync(path.join(__dirname, 'version.json'), JSON.stringify({ version: v }) + '\n');
console.log(v);
