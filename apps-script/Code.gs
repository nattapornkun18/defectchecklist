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
    // ── ตรวจรหัสก่อน ──
    var who = roleOf(body.pin);

    if (action === 'auth') {
      // หน้าเว็บเปิดใช้รหัสแล้ว แต่ในชีทยังไม่ได้ตั้ง = ตั้งค่าไม่ครบ ต้องบอกให้รู้
      // ไม่งั้นจะกลายเป็นใส่รหัสอะไรก็ผ่าน โดยไม่มีอะไรเตือน
      if (body.expectPin && !pinsConfigured()) {
        return json({ ok: false, authError: true,
          error: 'ยังไม่ได้ตั้งรหัสในชีท — ' +
          'เปิดชีทแล้วไปที่เมนู Defect Checklist → 🔑 ตั้งรหัสเข้าใช้งาน ก่อน' });
      }
      return json(who
        ? { ok: true, role: who }
        : { ok: false, authError: true, error: 'รหัสไม่ถูกต้อง' });
    }
    if (!who) return json({ ok: false, authError: true,
      error: 'รหัสไม่ถูกต้องหรือยังไม่ได้ใส่รหัส' });

    if (action === 'submit') return json(handleSubmit(body));

    // หน้าเว็บส่งรายชื่อหมวดมาลงทะเบียนเอง ตอนเปิดหน้าครั้งแรกของแต่ละเวอร์ชัน
    // ทำให้ชีทสรุปมีคอลัมน์ครบโดยไม่ต้องรอให้ใครกดบันทึกก่อน
    if (action === 'registerCatalog') return json(handleRegisterCatalog(body));

    // สามอย่างนี้เป็นการ "อ่านข้อมูลออกไป" จึงให้เฉพาะผู้ดูแล
    if (who !== 'admin') {
      return json({ ok: false, authError: true,
        error: 'ต้องใช้รหัสผู้ดูแล (admin) สำหรับคำสั่งนี้' });
    }
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

    // สร้างชีทสรุปไม่สำเร็จไม่ควรทำให้บันทึกล้มเหลว แต่ต้องรู้ว่าพังเพราะอะไร
    var summaryError = '';
    try {
      buildSummarySheet();
    } catch (e) {
      summaryError = String((e && e.message) || e);
      try {
        PropertiesService.getScriptProperties()
          .setProperty('lastSummaryError', new Date().toISOString() + ' — ' + summaryError);
      } catch (e2) { /* ไม่เป็นไร */ }
    }

    return {
      ok: true, rowsWritten: out.length, inspectionId: p.inspectionId,
      summaryError: summaryError
    };
  } finally {
    lock.releaseLock();
  }
}

/** เก็บรายชื่อหมวดของ room type ไว้ใช้ทำคอลัมน์ในชีทสรุป */
function handleRegisterCatalog(p) {
  if (!p.roomType) return { ok: false, error: 'ไม่ได้ระบุ roomType' };
  if (!p.catalog || !p.catalog.length) return { ok: false, error: 'ไม่มีรายชื่อหมวด' };

  var key = 'cats:' + p.roomType;
  var props = PropertiesService.getScriptProperties();
  var before = props.getProperty(key);
  var after = JSON.stringify(p.catalog);
  props.setProperty(key, after);

  // ถ้ารายชื่อหมวดเปลี่ยน ต้องสร้างชีทสรุปใหม่ให้คอลัมน์ตรง
  var changed = before !== after;
  if (changed) { try { buildSummarySheet(); } catch (e) { /* ไม่เป็นไร */ } }

  return { ok: true, cats: p.catalog.length, changed: changed };
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
  Logger.log('buildSummarySheet: เริ่ม');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('getActiveSpreadsheet() คืนค่า null — สคริปต์อาจไม่ได้ผูกกับชีทนี้');
  Logger.log('ไฟล์: ' + ss.getName());

  var data = handleSummary({});
  var list = latestPerRoom(data.inspections || []);
  Logger.log('อ่านผลตรวจได้ ' + (data.inspections || []).length + ' ครั้ง → ใช้จริง ' + list.length + ' ห้อง');

  var sh = ss.getSheetByName(SHEET_PIVOT);
  if (!sh) {
    sh = ss.insertSheet(SHEET_PIVOT);
    Logger.log('สร้างแท็บ "' + SHEET_PIVOT + '" ใหม่');
  } else {
    Logger.log('เจอแท็บ "' + SHEET_PIVOT + '" เดิมอยู่แล้ว');
  }
  sh.clear();
  sh.clearConditionalFormatRules();
  // clear() ไม่ได้ยกเลิก merge ที่ทำไว้รอบก่อน ถ้าไม่ยกเลิกก่อน
  // รอบถัดไปจะ merge ทับช่วงเดิมแบบไม่พอดีแล้ว throw
  if (sh.getMaxRows() > 0 && sh.getMaxColumns() > 0) {
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  }

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

      // นำหน้าด้วย ' เพื่อให้เป็นข้อความ ไม่งั้นห้อง "03" จะกลายเป็น 3
      rows.push(["'" + i.room, rt, pts ? tot / pts : 0, tot]
        .concat(vals)
        .concat([i.date, i.round, i.inspector]));
      fmt.push({ type: 'data', row: rows.length, first: 5, vals: vals,
                 cols: header.length, nCats: cats.length });
    });

    rows.push(['รวมทั้งกลุ่ม', '', '', grand].concat(colTotals).concat(['', '', '']));
    fmt.push({ type: 'total', row: rows.length, cols: header.length, nCats: cats.length });
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
  Logger.log('เขียนข้อมูลลงแท็บแล้ว ' + grid.length + ' แถว × ' + width + ' คอลัมน์');

  // ── รูปแบบตัวเลข ──
  // ต้องทำก่อนและแยกจากการตกแต่ง เพราะถ้าไปอยู่รวมกัน แล้วการตกแต่ง
  // (เช่น merge) พังก่อน จะข้ามส่วนนี้ไปทั้งหมด ทำให้ตัวเลขแสดงผิด
  // เช่นเลข 28 โผล่มาเป็นวันที่ 1900-01-27 เพราะรูปแบบเก่าค้างอยู่
  var fmtOk = 0;
  fmt.forEach(function (f) {
    if (f.type !== 'data' && f.type !== 'total') return;
    try {
      sh.getRange(f.row, 1, 1, f.cols)
        .setNumberFormats([numberFormatRow(f.cols, f.nCats)]);
      fmtOk++;
    } catch (e) { /* แถวเดียวพัง ไม่ควรลามแถวอื่น */ }
  });
  Logger.log('ตั้งรูปแบบตัวเลขแล้ว ' + fmtOk + ' แถว');

  // ── ตกแต่ง ── (ห่อไว้ เพราะถึงตกแต่งพัง ตัวเลขก็ต้องถูกต้องแล้ว)
  try {
  sh.getRange(1, 1).setFontSize(13).setFontWeight('bold');
  sh.getRange(2, 1).setFontSize(9).setFontColor('#5e6a7e');

  var decorFails = 0, firstDecorErr = '';
  fmt.forEach(function (f) {
    try {
    var r = sh.getRange(f.row, 1, 1, f.cols);
    if (f.type === 'group') {
      // ไม่ merge เพราะเซลล์ที่ merge ยาวทั้งแถวทำให้ setFrozenColumns(1) ใช้ไม่ได้
      // ("can't freeze columns which contain only part of a merged cell")
      // ระบายสีทั้งแถวแทน ได้หน้าตาเหมือนกันทุกประการ
      r.setBackground('#14607a').setFontColor('#ffffff').setFontWeight('bold');
    } else if (f.type === 'header') {
      r.setBackground('#eef1f6').setFontWeight('bold').setFontSize(9)
        .setHorizontalAlignment('center').setWrap(true);
      sh.getRange(f.row, 1, 1, 2).setHorizontalAlignment('left');
    } else if (f.type === 'total') {
      r.setBackground('#dfe7ee').setFontWeight('bold');
    } else if (f.type === 'data') {
      // ระบายสีตามจำนวนที่พบ เข้ม = เยอะ
      var colors = f.vals.map(function (v) { return heatColor(v, maxVal); });
      if (colors.length) {
        sh.getRange(f.row, f.first, 1, colors.length).setBackgrounds([colors]);
      }
    }
    } catch (e) {
      // แถวเดียวตกแต่งไม่ได้ ไม่ควรลามแถวอื่น แต่ต้องนับไว้ให้รู้
      decorFails++;
      if (!firstDecorErr) firstDecorErr = 'แถว ' + f.row + ' (' + f.type + '): ' +
        String((e && e.message) || e);
    }
  });

  if (decorFails) {
    Logger.log('⚠️ ตกแต่งไม่สำเร็จ ' + decorFails + ' แถว — ' + firstDecorErr);
    try {
      PropertiesService.getScriptProperties().setProperty('lastSummaryError',
        new Date().toISOString() + ' — ตกแต่งไม่สำเร็จ ' + decorFails +
        ' แถว (ตัวเลขยังถูกต้อง): ' + firstDecorErr);
    } catch (e) { /* ไม่เป็นไร */ }
  }

  try { sh.setFrozenColumns(1); } catch (e) { /* มี merge ค้างอยู่ ไม่ใช่เรื่องคอขาดบาดตาย */ }
  sh.autoResizeColumns(1, Math.min(width, 20));
  sh.getRange(1, 1, grid.length, width).setVerticalAlignment('middle');
  } catch (fmtErr) {
    try {
      PropertiesService.getScriptProperties().setProperty('lastSummaryError',
        new Date().toISOString() + ' — จัดรูปแบบไม่สำเร็จ (ตัวเลขยังถูกต้อง): ' +
        String((fmtErr && fmtErr.message) || fmtErr));
    } catch (e) { /* ไม่เป็นไร */ }
  }

  // ย้ายไปเป็นแท็บแรก จะได้เห็นก่อนเพื่อน — ล้มเหลวได้ ไม่ใช่เรื่องสำคัญ
  try {
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(1);
  } catch (e) { /* ไม่เป็นไร */ }

  Logger.log('buildSummarySheet: เสร็จเรียบร้อย');
}

/**
 * รูปแบบตัวเลขของ 1 แถวข้อมูล
 * คอลัมน์: ห้อง | Room type | % | รวม | หมวด×n | วันที่ | รอบ | ผู้ตรวจ
 */
function numberFormatRow(cols, nCats) {
  var f = ['@', '@', '0.00%', '0'];              // ห้อง / type / % / รวม
  for (var i = 0; i < nCats; i++) f.push('0');   // ทุกหมวดเป็นจำนวนเต็ม
  while (f.length < cols) f.push('@');           // วันที่ / รอบ / ผู้ตรวจ เป็นข้อความ
  return f.slice(0, cols);
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

/** เมนูในชีท */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Defect Checklist')
    .addItem('อัปเดตชีทสรุปรวม', 'buildSummarySheet')
    .addItem('🗑 ลบผลตรวจของแถวที่เลือก', 'deleteSelectedInspection')
    .addItem('ลบผลตรวจ (พิมพ์ InspectionID เอง)', 'deleteInspectionByPrompt')
    .addItem('ดูข้อผิดพลาดล่าสุดของชีทสรุป', 'showLastSummaryError')
    .addItem('🔍 ตรวจสอบระบบ (diagnose)', 'diagnose')
    .addSeparator()
    .addItem('🔑 ตั้งรหัสเข้าใช้งาน', 'setupPins')
    .addItem('ยกเลิกระบบรหัส', 'clearPins')
    .addItem('สร้างชีทที่จำเป็น', 'setupSheets')
    .addToUi();
}

/**
 * ลบผลตรวจของ "แถวที่เลือกอยู่" — วิธีที่สะดวกที่สุด
 * คลิกแถวไหนก็ได้ในชีท Inspections หรือ DefectLog แล้วสั่งจากเมนู
 */
function deleteSelectedInspection() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getActiveSheet();
  var name = sh.getName();

  if (name !== SHEET_SUMMARY && name !== SHEET_DETAIL) {
    ui.alert('เลือกแถวก่อน',
      'ให้ไปที่แท็บ "' + SHEET_SUMMARY + '" (หรือ "' + SHEET_DETAIL + '")\n' +
      'คลิกที่แถวของผลตรวจที่จะลบ แล้วค่อยสั่งเมนูนี้อีกครั้ง',
      ui.ButtonSet.OK);
    return;
  }

  var row = sh.getActiveRange().getRow();
  if (row < 2) { ui.alert('แถวที่เลือกเป็นหัวตาราง ไม่ใช่ข้อมูล'); return; }

  var id = String(sh.getRange(row, 2).getValue()).trim();   // คอลัมน์ B = InspectionID
  if (!id) { ui.alert('แถวนี้ไม่มี InspectionID'); return; }

  removeInspection(id, ui);
}

/**
 * ลบผลตรวจโดยพิมพ์ InspectionID เอง (สำรอง เผื่อหาแถวไม่เจอ)
 */
function deleteInspectionByPrompt() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('ลบผลตรวจ 1 ครั้ง',
    'ใส่ InspectionID ที่จะลบ (ก๊อปจากคอลัมน์ B ของชีท Inspections)\n' +
    'รูปแบบ: ห้อง-วันที่-เลขรอบ  เช่น  310-2026-07-28-1',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var id = res.getResponseText().trim();
  if (!id) { ui.alert('ไม่ได้ใส่ InspectionID'); return; }
  removeInspection(id, ui);
}

/** ลบจริง — ใช้ร่วมกันทั้งสองวิธี */
function removeInspection(id, ui) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sumSheet = ss.getSheetByName(SHEET_SUMMARY);
  var detSheet = ss.getSheetByName(SHEET_DETAIL);

  // หารายละเอียดมาแสดงตอนยืนยัน จะได้ไม่ลบผิดแถว
  var info = '', defects = 0;
  if (sumSheet && sumSheet.getLastRow() >= 2) {
    sumSheet.getRange(2, 1, sumSheet.getLastRow() - 1, HEAD_SUMMARY.length).getValues()
      .forEach(function (r) {
        if (String(r[1]) !== id) return;
        info = 'ห้อง ' + r[2] + ' · ' + r[4] + ' · ' + dateKey(r[6]) +
               ' · ผู้ตรวจ ' + r[5] + '\nพบ defect ' + num(r[12]) + ' จุด';
      });
  }
  if (!info) { ui.alert('ไม่พบ InspectionID "' + id + '" ในชีท ' + SHEET_SUMMARY); return; }

  if (detSheet && detSheet.getLastRow() >= 2) {
    detSheet.getRange(2, 2, detSheet.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { if (String(r[0]) === id) defects++; });
  }

  if (ui.alert('ยืนยันการลบ',
      info + '\n\nจะลบออกจาก ' + SHEET_SUMMARY + ' 1 แถว และ ' +
      SHEET_DETAIL + ' ' + defects + ' แถว\n' +
      'ลบแล้วกู้คืนไม่ได้ ยืนยันหรือไม่?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (sumSheet) deleteRowsById(sumSheet, 2, id);
    if (detSheet) deleteRowsById(detSheet, 2, id);
    buildSummarySheet();
  } finally {
    lock.releaseLock();
  }
  ui.alert('ลบเรียบร้อย', 'ลบ "' + id + '" แล้ว และอัปเดตชีทสรุปรวมให้ด้วย',
    ui.ButtonSet.OK);
}

/**
 * ตรวจสอบระบบทั้งหมด — เลือกฟังก์ชันนี้แล้วกด Run
 * แล้วดูผลที่ Execution log (ปุ่มบนแถบเครื่องมือ)
 */
function diagnose() {
  var out = [];
  function add(k, v) { out.push(k + ': ' + v); Logger.log(k + ': ' + v); }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    add('ชีทที่ผูกอยู่', ss ? ss.getName() : '❌ null (สคริปต์ไม่ได้ผูกกับชีท)');
    if (!ss) return out.join('\n');

    add('แท็บทั้งหมด', ss.getSheets().map(function (x) { return x.getName(); }).join(' | '));

    var sum = ss.getSheetByName(SHEET_SUMMARY);
    var det = ss.getSheetByName(SHEET_DETAIL);
    add('Inspections', sum ? sum.getLastRow() - 1 + ' แถวข้อมูล' : '❌ ไม่มีแท็บนี้');
    add('DefectLog', det ? det.getLastRow() - 1 + ' แถวข้อมูล' : '❌ ไม่มีแท็บนี้');

    var data = handleSummary({});
    add('handleSummary อ่านได้', (data.inspections || []).length + ' ครั้งการตรวจ');

    var rts = {};
    (data.inspections || []).forEach(function (i) { rts[i.roomType] = 1; });
    add('room type ที่เจอ', Object.keys(rts).join(' | ') || '(ไม่มี)');

    Object.keys(rts).forEach(function (rt) {
      add('หมวดของ "' + rt + '"', catsOf(rt).length + ' หมวด → ' +
        catsOf(rt).map(function (c) { return c.th; }).join(', '));
    });

    add('เวอร์ชันโค้ด', 'มี buildSummarySheet = ' + (typeof buildSummarySheet === 'function') +
      ' · มี roleOf = ' + (typeof roleOf === 'function') +
      ' · มี pinsConfigured = ' + (typeof pinsConfigured === 'function'));

    // สถานะระบบรหัส — จุดที่คนสับสนบ่อยว่า "ใส่รหัสในเว็บ" กับ "ตั้งรหัส" คนละเรื่อง
    var pp = PropertiesService.getScriptProperties();
    var pa = (pp.getProperty('PIN_ADMIN') || '').trim();
    var pi = (pp.getProperty('PIN_INSPECTOR') || '').trim();
    if (!pa && !pi) {
      add('🔓 ระบบรหัส', 'ยังไม่ได้ตั้ง — ใครใส่รหัสอะไรก็เข้าได้หมด ' +
        'ถ้าตั้งใจจะใช้รหัส ให้ไปที่เมนู Defect Checklist → 🔑 ตั้งรหัสเข้าใช้งาน');
    } else {
      add('🔒 ระบบรหัส', 'ตั้งแล้ว — ผู้ดูแล ' + (pa ? '✓ (' + pa.length + ' หลัก)' : '✗ ยังไม่ได้ตั้ง') +
        ' · ผู้ตรวจ ' + (pi ? '✓ (' + pi.length + ' หลัก)' : '✗ ยังไม่ได้ตั้ง'));
    }

    buildSummarySheet();
    var pv = ss.getSheetByName(SHEET_PIVOT);
    add('ผลลัพธ์', pv ? '✅ แท็บ "' + SHEET_PIVOT + '" มีแล้ว ' + pv.getLastRow() + ' แถว'
                     : '❌ ยังไม่มีแท็บ "' + SHEET_PIVOT + '"');
  } catch (err) {
    add('❌ ERROR', String((err && err.stack) || (err && err.message) || err));
  }

  var text = out.join('\n');
  try { SpreadsheetApp.getUi().alert('ผลตรวจสอบระบบ', text, SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (e) { /* รันจาก editor ไม่มี UI — ดูที่ Execution log แทน */ }
  return text;
}

/** ดูว่าชีทสรุปพังเพราะอะไรครั้งล่าสุด */
function showLastSummaryError() {
  var msg;
  try {
    msg = PropertiesService.getScriptProperties().getProperty('lastSummaryError');
  } catch (e) { msg = null; }
  SpreadsheetApp.getUi().alert('ข้อผิดพลาดล่าสุดของชีทสรุป',
    msg || 'ไม่มีข้อผิดพลาดที่บันทึกไว้', SpreadsheetApp.getUi().ButtonSet.OK);
}

/* ═════════════════════ รหัสเข้าใช้งาน ═════════════════════ */

/**
 * คืนค่า 'admin' / 'inspector' ถ้ารหัสถูก, คืน '' ถ้าผิด
 * ถ้ายังไม่ได้ตั้งรหัสไว้เลย จะปล่อยผ่านเป็น admin (ระบบเดิมใช้งานได้เหมือนเคย)
 */
/** ตั้งรหัสไว้แล้วอย่างน้อย 1 อัน หรือยัง */
function pinsConfigured() {
  try {
    var props = PropertiesService.getScriptProperties();
    return !!((props.getProperty('PIN_ADMIN') || '').trim() ||
              (props.getProperty('PIN_INSPECTOR') || '').trim());
  } catch (e) { return false; }
}

function roleOf(pin) {
  var props;
  try { props = PropertiesService.getScriptProperties(); } catch (e) { return 'admin'; }

  var admin = (props.getProperty('PIN_ADMIN') || '').trim();
  var insp = (props.getProperty('PIN_INSPECTOR') || '').trim();

  if (!admin && !insp) return 'admin';        // ยังไม่ได้เปิดใช้ระบบรหัส

  pin = String(pin == null ? '' : pin).trim();
  if (admin && pin === admin) return 'admin';
  if (insp && pin === insp) return 'inspector';
  return '';
}

/** ตั้ง / เปลี่ยน / ยกเลิกรหัส — สั่งจากเมนูในชีท */
function setupPins() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var cur = 'ตอนนี้: ผู้ดูแล = ' + (props.getProperty('PIN_ADMIN') ? 'ตั้งไว้แล้ว' : 'ยังไม่ได้ตั้ง') +
            ' · ผู้ตรวจ = ' + (props.getProperty('PIN_INSPECTOR') ? 'ตั้งไว้แล้ว' : 'ยังไม่ได้ตั้ง');

  var a = ui.prompt('รหัสผู้ดูแล (admin)',
    cur + '\n\nใส่รหัสตัวเลขสำหรับผู้ดูแล — ดูหน้าสรุปและดึงข้อมูลได้\n' +
    '(เว้นว่างแล้วกด OK = ไม่เปลี่ยนของเดิม)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;

  var b = ui.prompt('รหัสผู้ตรวจ (inspector)',
    'ใส่รหัสตัวเลขสำหรับผู้ตรวจหน้างาน — กรอกและบันทึกได้อย่างเดียว\n' +
    '(เว้นว่างแล้วกด OK = ไม่เปลี่ยนของเดิม)', ui.ButtonSet.OK_CANCEL);
  if (b.getSelectedButton() !== ui.Button.OK) return;

  var av = a.getResponseText().trim();
  var bv = b.getResponseText().trim();
  if (av) props.setProperty('PIN_ADMIN', av);
  if (bv) props.setProperty('PIN_INSPECTOR', bv);

  if (av && bv && av === bv) {
    ui.alert('รหัสซ้ำกัน', 'รหัสผู้ดูแลกับผู้ตรวจต้องไม่เหมือนกัน กรุณาตั้งใหม่', ui.ButtonSet.OK);
    return;
  }

  ui.alert('ตั้งรหัสแล้ว',
    'ผู้ดูแล: ' + (props.getProperty('PIN_ADMIN') || '(ยังไม่ได้ตั้ง)') + '\n' +
    'ผู้ตรวจ: ' + (props.getProperty('PIN_INSPECTOR') || '(ยังไม่ได้ตั้ง)') + '\n\n' +
    'อย่าลืมตั้ง REQUIRE_PIN = true ใน js/config.js แล้ว Deploy ใหม่\n' +
    'ถ้าเพิ่งเปลี่ยนรหัส คนที่ใส่รหัสเก่าไว้จะถูกให้ใส่ใหม่เองตอนบันทึกครั้งถัดไป',
    ui.ButtonSet.OK);
}

/** ยกเลิกระบบรหัสทั้งหมด กลับไปเปิดให้ทุกคนใช้ */
function clearPins() {
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('ยกเลิกระบบรหัส',
      'ทุกคนที่มีลิงก์จะใช้งานได้ทุกอย่างโดยไม่ต้องใส่รหัส ยืนยันหรือไม่?',
      ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('PIN_ADMIN');
  props.deleteProperty('PIN_INSPECTOR');
  ui.alert('ยกเลิกแล้ว', 'อย่าลืมตั้ง REQUIRE_PIN = false ใน js/config.js ด้วย', ui.ButtonSet.OK);
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
