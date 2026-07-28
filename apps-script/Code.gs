/**
 * Code.gs — Backend สำหรับ Defect Checklist (10 - Deluxe King - Right)
 *
 * วิธีติดตั้ง (ย่อ — ดูละเอียดใน README.md):
 *   1. เปิด Google Sheet ที่ต้องการเก็บข้อมูล → Extensions → Apps Script
 *   2. วางไฟล์นี้ทับ Code.gs เดิมทั้งหมด
 *   3. Deploy → New deployment → Web app
 *        Execute as:      Me
 *        Who has access:  Anyone
 *   4. คัดลอก Web app URL ไปใส่ในหน้าเว็บ (ปุ่ม ⚙ ตั้งค่า)
 *
 * ชีทที่ใช้ (สร้างอัตโนมัติถ้ายังไม่มี):
 *   Inspections — สรุป 1 แถวต่อการตรวจ 1 ครั้ง
 *   DefectLog   — 1 แถวต่อ 1 จุดที่ติด "ส่งคืน" หรือ "แก้เอง"
 */

var SHEET_SUMMARY = 'Inspections';
var SHEET_DETAIL = 'DefectLog';
var SHEET_PIVOT = 'สรุปรวม';           // ตารางสรุปที่สร้างใหม่ทุกครั้งที่บันทึก
var PHOTO_FOLDER = 'Defect Checklist Photos';

var HEAD_SUMMARY = [
  'Timestamp', 'InspectionID', 'Room', 'RoomType', 'Round', 'Inspector', 'Date',
  'จุดตรวจทั้งหมด', 'ตรวจแล้ว', 'ผ่าน', 'ส่งคืน', 'แก้เอง', 'จำนวนจุดที่พบ', 'Progress %', 'หมายเหตุ'
];

var HEAD_DETAIL = [
  'Timestamp', 'InspectionID', 'Room', 'Round', 'Inspector', 'Date',
  'หมวดที่', 'หมวด', 'หมวด (TH)', 'ข้อที่', 'จุดตรวจสอบ',
  'ผล', 'จำนวน', 'รายละเอียด', 'รูปถ่าย'
];

var STATUS_COL = 12;   // คอลัมน์ L = ผล

/* ───────────────────────── entry points ───────────────────────── */

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = body.action || 'submit';

    if (action === 'ping') {
      return json({
        ok: true,
        spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
        time: new Date().toISOString()
      });
    }
    if (action === 'submit') return json(handleSubmit(body));
    if (action === 'load') return json(handleLoad(body));
    if (action === 'summary') return json(handleSummary(body));
    if (action === 'rebuildSheet') { buildSummarySheet(); return json({ ok: true }); }

    return json({ ok: false, error: 'ไม่รู้จัก action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'status';
  if (action === 'status') {
    return json({
      ok: true,
      spreadsheetName: SpreadsheetApp.getActiveSpreadsheet().getName(),
      time: new Date().toISOString()
    });
  }
  return json({ ok: false, error: 'ไม่รู้จัก action: ' + action });
}

/* ───────────────────────── core ───────────────────────── */

function handleSubmit(p) {
  if (!p.inspectionId) return { ok: false, error: 'ไม่มี inspectionId' };
  if (!p.room) return { ok: false, error: 'ไม่ได้ระบุห้อง' };

  // ล็อกกันเขียนชนกันเมื่อผู้ตรวจหลายคนกดบันทึกพร้อมกัน
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sumSheet = ensureSheet(ss, SHEET_SUMMARY, HEAD_SUMMARY);
    var detSheet = ensureSheet(ss, SHEET_DETAIL, HEAD_DETAIL);

    // ส่งซ้ำของการตรวจครั้งเดิม = แทนที่ ไม่ใช่เพิ่มซ้ำ
    deleteRowsById(sumSheet, 2, p.inspectionId);
    deleteRowsById(detSheet, 2, p.inspectionId);

    var now = new Date();
    var s = p.summary || {};

    sumSheet.appendRow([
      now, p.inspectionId, p.room, p.roomType || '', p.round || '',
      p.inspector || '', p.date || '',
      num(s.total), num(s.checked), num(s.pass), num(s.ret), num(s.fix),
      num(s.defectQty), num(s.progressPct), p.note || ''
    ]);

    var rows = p.rows || [];
    var folder = null;
    var out = rows.map(function (r) {
      var urls = '';
      if (r.photos && r.photos.length) {
        if (!folder) folder = ensureFolder(PHOTO_FOLDER);
        urls = r.photos.map(function (dataUrl, i) {
          return savePhoto(folder, dataUrl, [p.inspectionId, r.key, i + 1].join('_'));
        }).filter(String).join('\n');
      }
      return [
        now, p.inspectionId, p.room, p.round || '', p.inspector || '', p.date || '',
        num(r.catNo), r.cat || '', r.catTh || '', num(r.no), r.item || '',
        resultLabel(r.result), num(r.qty), r.note || '', urls
      ];
    });

    if (out.length) {
      var firstRow = detSheet.getLastRow() + 1;
      detSheet.getRange(firstRow, 1, out.length, HEAD_DETAIL.length).setValues(out);
      shadeStatusRows(detSheet, firstRow, out);
    }

    styleHeaders(sumSheet, detSheet);

    // จำรายชื่อหมวดของ room type นี้ไว้ เพื่อให้ตารางสรุปมีคอลัมน์ครบ
    // แม้บางหมวดจะยังไม่เคยเจอ defect เลย
    if (p.roomType && p.catalog && p.catalog.length) {
      try {
        PropertiesService.getScriptProperties()
          .setProperty('cats:' + p.roomType, JSON.stringify(p.catalog));
      } catch (e) { /* ไม่ใช่เรื่องคอขาดบาดตาย */ }
    }

    try { buildSummarySheet(); } catch (e) { /* สรุปพังไม่ควรทำให้บันทึกล้มเหลว */ }

    return { ok: true, rowsWritten: out.length, inspectionId: p.inspectionId };
  } finally {
    lock.releaseLock();
  }
}

/**
 * ดึงผลตรวจที่บันทึกไว้แล้วกลับไปแสดงในหน้าเว็บ (two-way)
 * รับ { inspectionId } หรือ { room, date, round } — ถ้าไม่ระบุ date/round จะเอาครั้งล่าสุดของห้องนั้น
 */
function handleLoad(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sumSheet = ss.getSheetByName(SHEET_SUMMARY);
  var detSheet = ss.getSheetByName(SHEET_DETAIL);
  if (!sumSheet || sumSheet.getLastRow() < 2) return { ok: true, found: false };

  var rows = sumSheet.getRange(2, 1, sumSheet.getLastRow() - 1, HEAD_SUMMARY.length).getValues();
  var hit = null;

  if (p.inspectionId) {
    for (var i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][1]) === String(p.inspectionId)) { hit = rows[i]; break; }
    }
  } else if (p.room) {
    // ไล่จากล่างขึ้นบน = ได้แถวที่บันทึกล่าสุดก่อน
    for (var j = rows.length - 1; j >= 0; j--) {
      if (String(rows[j][2]) !== String(p.room)) continue;
      if (p.date && dateKey(rows[j][6]) !== String(p.date)) continue;
      if (p.round && String(rows[j][4]) !== String(p.round)) continue;
      hit = rows[j]; break;
    }
  }
  if (!hit) return { ok: true, found: false };

  var id = String(hit[1]);
  var items = [];
  if (detSheet && detSheet.getLastRow() >= 2) {
    var d = detSheet.getRange(2, 1, detSheet.getLastRow() - 1, HEAD_DETAIL.length).getValues();
    for (var k = 0; k < d.length; k++) {
      if (String(d[k][1]) !== id) continue;
      items.push({
        cat: String(d[k][7]),          // ชื่อหมวดภาษาอังกฤษ
        no: num(d[k][9]),
        result: d[k][11] === 'ส่งคืน' ? 'return' : d[k][11] === 'แก้เอง' ? 'fix' : 'pass',
        qty: num(d[k][12]),
        note: String(d[k][13] || ''),
        photos: String(d[k][14] || '').split('\n').filter(String)
      });
    }
  }

  return {
    ok: true, found: true,
    inspection: {
      inspectionId: id, room: String(hit[2]), roomType: String(hit[3]),
      round: String(hit[4]), inspector: String(hit[5]), date: dateKey(hit[6]),
      total: num(hit[7]), checked: num(hit[8]), pass: num(hit[9]),
      ret: num(hit[10]), fix: num(hit[11]), defectQty: num(hit[12]),
      note: String(hit[14] || ''), savedAt: iso(hit[0])
    },
    items: items
  };
}

/** สรุปจำนวน defect ต่อห้อง แยกตามหมวด — ใช้กับหน้า summary.html */
function handleSummary(p) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sumSheet = ss.getSheetByName(SHEET_SUMMARY);
  var detSheet = ss.getSheetByName(SHEET_DETAIL);
  if (!sumSheet || sumSheet.getLastRow() < 2) return { ok: true, inspections: [] };

  var rows = sumSheet.getRange(2, 1, sumSheet.getLastRow() - 1, HEAD_SUMMARY.length).getValues();
  var byId = {}, order = [];
  rows.forEach(function (r) {
    var id = String(r[1]);
    if (!byId[id]) order.push(id);
    byId[id] = {                       // แถวหลังทับแถวก่อน = ได้ข้อมูลล่าสุด
      inspectionId: id, room: String(r[2]), roomType: String(r[3]),
      round: String(r[4]), inspector: String(r[5]), date: dateKey(r[6]),
      total: num(r[7]), checked: num(r[8]), pass: num(r[9]),
      ret: num(r[10]), fix: num(r[11]), defectQty: num(r[12]),
      note: String(r[14] || ''), savedAt: iso(r[0]), cats: {}
    };
  });

  if (detSheet && detSheet.getLastRow() >= 2) {
    var d = detSheet.getRange(2, 1, detSheet.getLastRow() - 1, HEAD_DETAIL.length).getValues();
    d.forEach(function (r) {
      var insp = byId[String(r[1])];
      if (!insp) return;
      var cat = String(r[7]);
      var c = insp.cats[cat] ||
        (insp.cats[cat] = { ret: 0, fix: 0, qty: 0, retQty: 0, fixQty: 0 });
      var q = Math.max(1, num(r[12]));
      if (r[11] === 'ส่งคืน') { c.ret++; c.retQty += q; c.qty += q; }
      else if (r[11] === 'แก้เอง') { c.fix++; c.fixQty += q; c.qty += q; }
    });
  }

  return { ok: true, inspections: order.map(function (id) { return byId[id]; }) };
}

/* ═════════════════════ ตารางสรุปในชีท ═════════════════════ */

/**
 * สร้างชีท "สรุปรวม" ใหม่ทั้งแผ่น — แยกกลุ่มตาม room type
 * แถว = ห้อง · คอลัมน์ = หมวด · มีคอลัมน์รวม % และแถวรวมทั้งกลุ่ม
 *
 * เรียกอัตโนมัติทุกครั้งที่บันทึก และเรียกเองได้จากเมนู "Defect Checklist"
 */
function buildSummarySheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = handleSummary({});
  var list = latestPerRoom(data.inspections || []);

  var sh = ss.getSheetByName(SHEET_PIVOT) || ss.insertSheet(SHEET_PIVOT);
  sh.clear();
  sh.clearConditionalFormatRules();

  if (!list.length) {
    sh.getRange(1, 1).setValue('ยังไม่มีผลตรวจ').setFontWeight('bold');
    return;
  }

  // จัดกลุ่มตาม room type
  var groups = {}, order = [];
  list.forEach(function (i) {
    var k = i.roomType || '(ไม่ระบุ room type)';
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(i);
  });

  var rows = [], fmt = [];       // fmt เก็บพิกัดไว้ระบายสีทีหลัง
  rows.push(['บันทึกจำนวน Defect รวม แยกตามห้อง / โซน']);
  rows.push(['อัปเดตอัตโนมัติทุกครั้งที่มีการบันทึกจากหน้าเว็บ · ล่าสุด ' +
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'd MMM yyyy HH:mm')]);
  rows.push([]);

  var maxCols = 0, maxVal = 0;
  order.forEach(function (rt) {
    groups[rt].forEach(function (i) {
      catsOf(rt).forEach(function (c) { maxVal = Math.max(maxVal, catQty(i, c.name)); });
    });
  });

  order.forEach(function (rt) {
    var cats = catsOf(rt);
    var g = groups[rt];

    var header = ['หมายเลขห้อง', 'Room type', '%', 'รวม']
      .concat(cats.map(function (c) { return c.th; }))
      .concat(['วันที่', 'รอบ', 'ผู้ตรวจ']);
    maxCols = Math.max(maxCols, header.length);

    rows.push([rt]);
    fmt.push({ type: 'group', row: rows.length, cols: header.length });
    rows.push(header);
    fmt.push({ type: 'header', row: rows.length, cols: header.length });

    var colTotals = cats.map(function () { return 0; });
    var grand = 0;

    g.forEach(function (i) {
      var vals = cats.map(function (c) { return catQty(i, c.name); });
      var tot = vals.reduce(function (a, b) { return a + b; }, 0);
      grand += tot;
      vals.forEach(function (v, ix) { colTotals[ix] += v; });
      var pts = i.total || 0;

      rows.push([i.room, rt, pts ? tot / pts : 0, tot]
        .concat(vals)
        .concat([i.date, i.round, i.inspector]));
      fmt.push({ type: 'data', row: rows.length, first: 5, vals: vals, cols: header.length });
    });

    rows.push(['รวมทั้งกลุ่ม', '', '', grand].concat(colTotals).concat(['', '', '']));
    fmt.push({ type: 'total', row: rows.length, cols: header.length });
    rows.push([]);
  });

  // เขียนทีเดียวจบ เร็วกว่าเขียนทีละแถวมาก
  var width = Math.max(maxCols, 1);
  var grid = rows.map(function (r) {
    var line = r.slice();
    while (line.length < width) line.push('');
    return line;
  });
  sh.getRange(1, 1, grid.length, width).setValues(grid);

  // ── จัดรูปแบบ ──
  sh.getRange(1, 1).setFontSize(13).setFontWeight('bold');
  sh.getRange(2, 1).setFontSize(9).setFontColor('#5e6a7e');

  fmt.forEach(function (f) {
    var r = sh.getRange(f.row, 1, 1, f.cols);
    if (f.type === 'group') {
      r.merge().setBackground('#14607a').setFontColor('#ffffff').setFontWeight('bold');
    } else if (f.type === 'header') {
      r.setBackground('#eef1f6').setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center').setWrap(true);
      sh.getRange(f.row, 1, 1, 2).setHorizontalAlignment('left');
    } else if (f.type === 'total') {
      r.setBackground('#dfe7ee').setFontWeight('bold');
    } else if (f.type === 'data') {
      sh.getRange(f.row, 3).setNumberFormat('0.00%');
      // ระบายสีตามจำนวนที่พบ เข้ม = เยอะ
      var colors = f.vals.map(function (v) { return heatColor(v, maxVal); });
      sh.getRange(f.row, f.first, 1, colors.length).setBackgrounds([colors]);
    }
  });

  sh.setFrozenColumns(1);
  sh.autoResizeColumns(1, Math.min(width, 20));
  sh.getRange(1, 1, grid.length, width).setVerticalAlignment('middle');

  // ย้ายไปเป็นแท็บแรก จะได้เห็นก่อนเพื่อน
  ss.setActiveSheet(sh);
  ss.moveActiveSheet(1);
}

/** ไล่เฉดสีเดียว อ่อน → เข้ม (ตัวเลขยังอยู่ในช่อง สีเป็นแค่ตัวช่วยอ่าน) */
function heatColor(v, max) {
  if (!v) return '#ffffff';
  var steps = ['#fdeceb', '#fad3d1', '#f4aeaa', '#e8817c', '#d4534d', '#ad2f2a'];
  if (max <= 1) return steps[2];
  var f = v / max;
  var i = f <= 0.10 ? 0 : f <= 0.25 ? 1 : f <= 0.45 ? 2 : f <= 0.65 ? 3 : f <= 0.85 ? 4 : 5;
  return steps[i];
}

/** ห้องเดียวกันที่ตรวจหลายรอบ → เอาครั้งที่บันทึกล่าสุด */
function latestPerRoom(list) {
  var by = {};
  list.forEach(function (i) {
    var cur = by[i.room];
    if (!cur || String(i.savedAt) > String(cur.savedAt)) by[i.room] = i;
  });
  return Object.keys(by).sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (k) { return by[k]; });
}

/** รายชื่อหมวดของ room type — เอาจากที่หน้าเว็บส่งมา ถ้าไม่มีก็อนุมานจาก DefectLog */
function catsOf(roomType) {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty('cats:' + roomType);
    if (raw) {
      var arr = JSON.parse(raw);
      if (arr && arr.length) {
        return arr.sort(function (a, b) { return a.no - b.no; });
      }
    }
  } catch (e) { /* ตกไปใช้วิธีสำรอง */ }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var det = ss.getSheetByName(SHEET_DETAIL);
  if (!det || det.getLastRow() < 2) return [];
  var d = det.getRange(2, 7, det.getLastRow() - 1, 3).getValues();   // หมวดที่ / หมวด / หมวด(TH)
  var seen = {}, out = [];
  d.forEach(function (r) {
    var name = String(r[1]);
    if (!name || seen[name]) return;
    seen[name] = 1;
    out.push({ no: num(r[0]), name: name, th: String(r[2] || name) });
  });
  return out.sort(function (a, b) { return a.no - b.no; });
}

function catQty(insp, catName) {
  var c = insp.cats && insp.cats[catName];
  return c ? (c.qty || 0) : 0;
}

/** เมนูในชีท เผื่ออยากสั่งอัปเดตเอง */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Defect Checklist')
    .addItem('อัปเดตชีทสรุปรวม', 'buildSummarySheet')
    .addItem('สร้างชีทที่จำเป็น', 'setupSheets')
    .addToUi();
}

/* ───────────────────────── helpers ───────────────────────── */

/** คืนวันที่รูปแบบ YYYY-MM-DD ไม่ว่าเซลล์จะเก็บเป็น Date หรือข้อความ */
function dateKey(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

function iso(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}

function ensureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** ลบทุกแถวที่คอลัมน์ idCol ตรงกับ id (ไล่จากล่างขึ้นบน) */
function deleteRowsById(sheet, idCol, id) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var vals = sheet.getRange(2, idCol, last - 1, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]) === String(id)) sheet.deleteRow(i + 2);
  }
}

function ensureFolder(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function savePhoto(folder, dataUrl, baseName) {
  try {
    var m = /^data:(image\/[a-z+]+);base64,(.*)$/i.exec(dataUrl || '');
    if (!m) return '';
    var ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    var blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], baseName + '.' + ext);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch (err) {
    return '';   // รูปเสียไม่ควรทำให้การบันทึกทั้งชุดล้มเหลว
  }
}

function resultLabel(r) {
  if (r === 'return') return 'ส่งคืน';
  if (r === 'fix') return 'แก้เอง';
  if (r === 'pass') return 'ผ่าน';
  return String(r || '');
}

function num(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function styleHeaders(sumSheet, detSheet) {
  [sumSheet, detSheet].forEach(function (sh) {
    sh.getRange(1, 1, 1, sh.getLastColumn())
      .setFontWeight('bold').setBackground('#14607a').setFontColor('#ffffff');
  });
}

/** ระบายสีพื้นหลังตามผล เฉพาะแถวที่เพิ่งเขียนใหม่ */
function shadeStatusRows(sheet, firstRow, rows) {
  var colors = rows.map(function (r) {
    var v = r[STATUS_COL - 1];
    var c = v === 'ส่งคืน' ? '#fdeaea' : v === 'แก้เอง' ? '#fdf3e0' : '#ffffff';
    var line = [];
    for (var i = 0; i < HEAD_DETAIL.length; i++) line.push(c);
    return line;
  });
  sheet.getRange(firstRow, 1, rows.length, HEAD_DETAIL.length).setBackgrounds(colors);
}

/** เรียกครั้งเดียวจาก editor เพื่อสร้างชีทเปล่าล่วงหน้า (ไม่บังคับ) */
function setupSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(ss, SHEET_SUMMARY, HEAD_SUMMARY);
  ensureSheet(ss, SHEET_DETAIL, HEAD_DETAIL);
}
