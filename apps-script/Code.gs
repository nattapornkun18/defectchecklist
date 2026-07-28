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

/* ───────────────────────── helpers ───────────────────────── */

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
