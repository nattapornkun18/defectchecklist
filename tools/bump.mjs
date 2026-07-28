#!/usr/bin/env node
/*
 * bump.mjs — บวกเลขเวอร์ชันไฟล์ static ให้ครบทุกที่ในคำสั่งเดียว
 *
 *   node tools/bump.mjs          บวก 1 จากเลขปัจจุบัน
 *   node tools/bump.mjs 20       ตั้งเป็นเลขที่ต้องการ
 *   node tools/bump.mjs --dry    ดูว่าจะแก้อะไรบ้าง โดยยังไม่แก้จริง
 *
 * ทำไมต้องมี: เบราว์เซอร์ cache ไฟล์ js/css/รูปไว้ ถ้าเลขไม่เปลี่ยน
 * มือถือของผู้ตรวจจะยังใช้ของเก่าต่อไปแม้เรา push ของใหม่แล้ว
 * เลขนี้ต้องตรงกันทั้ง 5 ไฟล์ ถ้าตกหล่นที่เดียวก็เพี้ยนทั้งระบบ
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = ['index.html', 'tag.html', 'summary.html'];
const CONFIG = 'js/config.js';
const VERSION = 'version.json';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const explicit = args.find((a) => /^\d+$/.test(a));

const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

// เลขปัจจุบันถือตาม config.js เป็นหลัก
const cur = (read(CONFIG).match(/const ASSET_VERSION = '(\d+)'/) || [])[1];
if (!cur) {
  console.error('หา ASSET_VERSION ใน ' + CONFIG + ' ไม่เจอ');
  process.exit(1);
}
const next = explicit || String(Number(cur) + 1);

console.log('เวอร์ชัน ' + cur + ' → ' + next + (dry ? '   (--dry ยังไม่แก้จริง)' : ''));

const changes = [];

changes.push([CONFIG, read(CONFIG).replace(
  /const ASSET_VERSION = '\d+'/, "const ASSET_VERSION = '" + next + "'")]);

changes.push([VERSION, '{ "version": "' + next + '" }\n']);

for (const f of HTML) {
  const before = read(f);
  const after = before.replace(/\?v=\d+"/g, '?v=' + next + '"');
  const hits = (before.match(/\?v=\d+"/g) || []).length;
  if (!hits) console.warn('  ⚠️  ' + f + ' ไม่มี ?v= สักอัน — ตรวจดูด้วย');
  changes.push([f, after, hits]);
}

let bad = false;
for (const [f, after, hits] of changes) {
  const left = (after.match(/\?v=(\d+)"/g) || [])
    .map((m) => m.match(/\d+/)[0])
    .filter((v) => v !== next);
  if (left.length) { console.error('  ❌ ' + f + ' ยังเหลือเลขเก่า: ' + left.join(', ')); bad = true; }
  console.log('  ' + (hits != null ? hits + ' จุด' : 'ตั้งค่า') + '  ' + f);
  if (!dry) write(f, after);
}
if (bad) process.exit(1);

if (dry) {
  console.log('\nยังไม่ได้แก้ไฟล์ — เอา --dry ออกเพื่อแก้จริง');
} else {
  console.log('\nแก้ครบแล้ว ขั้นต่อไป: git add -A && git commit && git push');
  console.log('ถ้าแก้ apps-script/Code.gs ด้วย อย่าลืมเอาไปวางในชีทแล้ว Deploy');
}
