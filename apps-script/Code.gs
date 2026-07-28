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
