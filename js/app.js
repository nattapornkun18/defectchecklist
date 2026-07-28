/* app.js — ตรรกะทั้งหมดของฟอร์มตรวจ defect */
(function () {
  'use strict';

  var LS = {
    api: 'dc:apiUrl',
    photos: 'dc:uploadPhotos',
    inspector: 'dc:inspector',
    lastRoom: 'dc:lastRoom',
    queue: 'dc:queue',
    draft: function (room) { return 'dc:draft:' + room; },
  };

  var STATUS = { PASS: 'pass', DEFECT: 'defect', NA: 'na' };

  /* ───────── state ───────── */
  var state = null;      // ข้อมูลการตรวจของห้องที่เลือกอยู่
  var openZone = null;   // โซนที่เปิดใน bottom sheet
  var photoTarget = null;

  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  function todayISO() {
    var d = new Date(), off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  }

  function blankState(room) {
    return {
      room: room,
      round: ROUNDS[0],
      inspector: localStorage.getItem(LS.inspector) || '',
      date: todayISO(),
      note: '',
      items: {},              // key -> { s, qty, note, photos[] }
      updatedAt: null,
      submittedAt: null,
    };
  }

  function loadDraft(room) {
    try {
      var raw = localStorage.getItem(LS.draft(room));
      if (!raw) return blankState(room);
      var d = JSON.parse(raw);
      d.room = room;
      d.items = d.items || {};
      return d;
    } catch (e) { return blankState(room); }
  }

  function saveDraft() {
    if (!state) return;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(LS.draft(state.room), JSON.stringify(state));
    } catch (e) {
      // localStorage เต็ม — มักเกิดจากรูปถ่ายเยอะเกินไป
      toast('พื้นที่เก็บในเครื่องเต็ม กรุณาบันทึกลง Sheet แล้วลบรูปเก่าออก', 'err', 5000);
    }
  }

  function itemState(key) {
    return state.items[key] || null;
  }

  function setItem(key, patch) {
    var cur = state.items[key] || { s: null, qty: 1, note: '', photos: [] };
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    state.items[key] = cur;
    saveDraft();
  }

  /* ───────── สถิติ ───────── */
  function zoneStats(zone) {
    var st = { done: 0, pass: 0, defect: 0, na: 0, total: zone.items.length, qty: 0 };
    zone.items.forEach(function (it) {
      var s = itemState(it.key);
      if (!s || !s.s) return;
      st.done++;
      if (s.s === STATUS.PASS) st.pass++;
      else if (s.s === STATUS.DEFECT) { st.defect++; st.qty += Number(s.qty) || 1; }
      else st.na++;
    });
    return st;
  }

  function totalStats() {
    var t = { done: 0, pass: 0, defect: 0, na: 0, total: TOTAL_ITEMS, qty: 0 };
    ZONES.forEach(function (z) {
      var s = zoneStats(z);
      t.done += s.done; t.pass += s.pass; t.defect += s.defect; t.na += s.na; t.qty += s.qty;
    });
    return t;
  }

  /* ───────── หมุดบนแปลน ───────── */
  function buildHotspots() {
    var g = $('hotspots');
    g.textContent = '';
    ZONES.forEach(function (zone) {
      var el = document.createElementNS(SVGNS, 'g');
      el.setAttribute('class', 'hotspot');
      el.dataset.zone = zone.id;
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', zone.no + '. ' + zone.name);

      var halo = document.createElementNS(SVGNS, 'circle');
      halo.setAttribute('class', 'halo');
      halo.setAttribute('cx', zone.pin.x); halo.setAttribute('cy', zone.pin.y);
      halo.setAttribute('r', 26);

      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'dot');
      dot.setAttribute('cx', zone.pin.x); dot.setAttribute('cy', zone.pin.y);
      dot.setAttribute('r', 15);

      var num = document.createElementNS(SVGNS, 'text');
      num.setAttribute('class', 'num');
      num.setAttribute('x', zone.pin.x); num.setAttribute('y', zone.pin.y + 5);
      num.textContent = zone.no;

      var badgeBg = document.createElementNS(SVGNS, 'circle');
      badgeBg.setAttribute('class', 'badge-bg');
      badgeBg.setAttribute('cx', zone.pin.x + 13); badgeBg.setAttribute('cy', zone.pin.y - 13);
      badgeBg.setAttribute('r', 9);
      badgeBg.setAttribute('display', 'none');

      var badgeTx = document.createElementNS(SVGNS, 'text');
      badgeTx.setAttribute('class', 'badge-txt');
      badgeTx.setAttribute('x', zone.pin.x + 13); badgeTx.setAttribute('y', zone.pin.y - 9.5);
      badgeTx.setAttribute('display', 'none');

      el.appendChild(halo); el.appendChild(dot); el.appendChild(num);
      el.appendChild(badgeBg); el.appendChild(badgeTx);

      el.addEventListener('click', function () { openSheet(zone); });
      el.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openSheet(zone); }
      });
      g.appendChild(el);
    });
  }

  function refreshHotspots() {
    ZONES.forEach(function (zone) {
      var el = $('hotspots').querySelector('[data-zone="' + zone.id + '"]');
      if (!el) return;
      var st = zoneStats(zone);
      el.classList.toggle('is-defect', st.defect > 0);
      el.classList.toggle('is-clean', st.defect === 0 && st.done === st.total);
      var bg = el.querySelector('.badge-bg'), tx = el.querySelector('.badge-txt');
      if (st.defect > 0) {
        bg.removeAttribute('display'); tx.removeAttribute('display');
        tx.textContent = st.defect;
      } else {
        bg.setAttribute('display', 'none'); tx.setAttribute('display', 'none');
      }
    });
  }

  /* ───────── รายการโซน ───────── */
  function buildZoneList() {
    var wrap = $('zoneList');
    wrap.textContent = '';
    ZONES.forEach(function (zone) {
      var b = document.createElement('button');
      b.className = 'zone-row';
      b.dataset.zone = zone.id;
      b.innerHTML =
        '<span class="zone-no">' + zone.no + '</span>' +
        '<span class="zone-meta"><span class="nm"></span><br><span class="en"></span></span>' +
        '<span class="zone-stat"></span>';
      b.querySelector('.nm').textContent = zone.name;
      b.querySelector('.en').textContent = zone.en;
      b.addEventListener('click', function () { openSheet(zone); });
      wrap.appendChild(b);
    });
  }

  function refreshZoneList() {
    ZONES.forEach(function (zone) {
      var row = $('zoneList').querySelector('[data-zone="' + zone.id + '"]');
      if (!row) return;
      var st = zoneStats(zone);
      row.classList.toggle('is-defect', st.defect > 0);
      row.classList.toggle('is-clean', st.defect === 0 && st.done === st.total);
      var out = st.done + '/' + st.total;
      if (st.defect > 0) out += ' · <b>' + st.defect + ' defect</b>';
      row.querySelector('.zone-stat').innerHTML = out;
    });
  }

  /* ───────── Bottom sheet ───────── */
  function openSheet(zone) {
    openZone = zone;
    $('sheetTitle').textContent = zone.no + '. ' + zone.name;
    $('sheetSub').textContent = zone.en + ' · ' + zone.items.length + ' รายการ';
    renderSheetBody(zone);
    $('sheet').classList.add('open');
    $('sheetBackdrop').classList.add('open');
    $('sheetBody').scrollTop = 0;
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    $('sheet').classList.remove('open');
    $('sheetBackdrop').classList.remove('open');
    document.body.style.overflow = '';
    openZone = null;
  }

  function renderSheetBody(zone) {
    var body = $('sheetBody');
    body.textContent = '';
    zone.items.forEach(function (it) {
      body.appendChild(renderItem(zone, it));
    });
  }

  function renderItem(zone, it) {
    var box = document.createElement('div');
    box.className = 'item';
    box.dataset.key = it.key;

    var head = document.createElement('div');
    head.className = 'item-head';
    head.innerHTML = '<span class="item-no"></span>' +
      '<span class="item-text"><span class="th"></span><br><span class="en"></span></span>';
    head.querySelector('.item-no').textContent = it.no;
    head.querySelector('.th').textContent = it.th;
    head.querySelector('.en').textContent = it.en;
    box.appendChild(head);

    var seg = document.createElement('div');
    seg.className = 'seg';
    [[STATUS.PASS, '✓ ผ่าน'], [STATUS.DEFECT, '✗ Defect'], [STATUS.NA, '– N/A']]
      .forEach(function (pair) {
        var b = document.createElement('button');
        b.dataset.v = pair[0];
        b.textContent = pair[1];
        b.addEventListener('click', function () {
          var cur = itemState(it.key);
          var next = (cur && cur.s === pair[0]) ? null : pair[0];   // แตะซ้ำ = ยกเลิก
          setItem(it.key, { s: next });
          paintItem(box, it);
          refreshAll();
        });
        seg.appendChild(b);
      });
    box.appendChild(seg);

    var df = document.createElement('div');
    df.className = 'defect-fields';
    df.hidden = true;

    // จำนวน
    var qr = document.createElement('div');
    qr.className = 'qty-row';
    qr.innerHTML = '<label>จำนวนที่พบ</label>' +
      '<span class="stepper"><button type="button" data-d="-1">−</button>' +
      '<input type="number" inputmode="numeric" min="1" step="1" value="1">' +
      '<button type="button" data-d="1">+</button></span>' +
      '<span style="font-size:.78rem;color:var(--muted)">จุด / รายการ</span>';
    var qInput = qr.querySelector('input');
    qr.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = Math.max(1, (parseInt(qInput.value, 10) || 1) + parseInt(b.dataset.d, 10));
        qInput.value = v;
        setItem(it.key, { qty: v });
        refreshAll();
      });
    });
    qInput.addEventListener('input', function () {
      setItem(it.key, { qty: Math.max(1, parseInt(qInput.value, 10) || 1) });
      refreshAll();
    });
    df.appendChild(qr);

    // รายละเอียด
    var ta = document.createElement('textarea');
    ta.placeholder = 'รายละเอียด / ตำแหน่งที่พบ เช่น "ผนังฝั่งหัวเตียง ซ้ายมือ สูงจากพื้น 1.2 ม."';
    ta.addEventListener('input', function () { setItem(it.key, { note: ta.value }); });
    df.appendChild(ta);

    // รูปถ่าย
    var pr = document.createElement('div');
    pr.className = 'photo-row';
    df.appendChild(pr);

    box.appendChild(df);
    paintItem(box, it);
    return box;
  }

  function paintItem(box, it) {
    var s = itemState(it.key);
    var v = s && s.s;
    box.classList.remove('s-pass', 's-defect', 's-na');
    if (v) box.classList.add('s-' + v);
    box.querySelectorAll('.seg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === v);
    });
    var df = box.querySelector('.defect-fields');
    df.hidden = v !== STATUS.DEFECT;
    if (v === STATUS.DEFECT) {
      box.querySelector('.stepper input').value = (s && s.qty) || 1;
      box.querySelector('textarea').value = (s && s.note) || '';
      paintPhotos(box, it);
    }
  }

  function paintPhotos(box, it) {
    var s = itemState(it.key) || {};
    var photos = s.photos || [];
    var row = box.querySelector('.photo-row');
    row.textContent = '';
    photos.forEach(function (src, i) {
      var t = document.createElement('div');
      t.className = 'photo-thumb';
      var img = document.createElement('img');
      img.src = src; img.alt = 'รูป ' + (i + 1);
      var x = document.createElement('button');
      x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'ลบรูป');
      x.addEventListener('click', function () {
        photos.splice(i, 1);
        setItem(it.key, { photos: photos });
        paintPhotos(box, it);
      });
      t.appendChild(img); t.appendChild(x);
      row.appendChild(t);
    });
    if (photos.length < 3) {
      var add = document.createElement('button');
      add.type = 'button'; add.className = 'photo-add'; add.textContent = '＋';
      add.setAttribute('aria-label', 'ถ่ายรูป');
      add.addEventListener('click', function () {
        photoTarget = { key: it.key, box: box, item: it };
        $('photoInput').value = '';
        $('photoInput').click();
      });
      row.appendChild(add);
    }
  }

  /* ───────── รูปถ่าย: ย่อขนาดก่อนเก็บ ───────── */
  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(cv.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = function () { cb(null); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  $('photoInput').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file || !photoTarget) return;
    var t = photoTarget;
    compressImage(file, function (dataUrl) {
      if (!dataUrl) { toast('อ่านรูปไม่สำเร็จ', 'err'); return; }
      var s = itemState(t.key) || {};
      var photos = (s.photos || []).concat([dataUrl]);
      setItem(t.key, { photos: photos });
      paintPhotos(t.box, t.item);
    });
  });

  /* ───────── refresh ───────── */
  function refreshAll() {
    var t = totalStats();
    var pct = TOTAL_ITEMS ? Math.round(t.done / TOTAL_ITEMS * 100) : 0;
    $('progFill').style.width = pct + '%';
    $('legDone').textContent = 'ตรวจแล้ว ' + t.done + '/' + t.total + ' (' + pct + '%)';
    $('legPass').textContent = '✓ ผ่าน ' + t.pass;
    $('legDefect').textContent = '✗ Defect ' + t.defect;
    $('legNa').textContent = '– N/A ' + t.na;
    $('topSub').textContent = ROOM_TYPE + ' · ห้อง ' + state.room;
    $('bottomSum').innerHTML = t.defect > 0
      ? 'พบ <b>' + t.defect + '</b> รายการ (' + t.qty + ' จุด) · เหลืออีก ' + (t.total - t.done) + ' ข้อ'
      : 'ยังไม่พบ defect · เหลืออีก ' + (t.total - t.done) + ' ข้อ';
    refreshHotspots();
    refreshZoneList();
    renderPrintArea();
  }

  /* ───────── หัวฟอร์ม ───────── */
  function fillSelects() {
    var r = $('fRoom');
    ROOMS.forEach(function (room) {
      var o = document.createElement('option');
      o.value = room; o.textContent = 'ห้อง ' + room;
      r.appendChild(o);
    });
    var rd = $('fRound');
    ROUNDS.forEach(function (name) {
      var o = document.createElement('option');
      o.value = name; o.textContent = name;
      rd.appendChild(o);
    });
  }

  function syncHeaderFromState() {
    $('fRoom').value = state.room;
    $('fRound').value = state.round;
    $('fInspector').value = state.inspector;
    $('fDate').value = state.date;
    $('fNote').value = state.note || '';
  }

  function switchRoom(room) {
    state = loadDraft(room);
    localStorage.setItem(LS.lastRoom, room);
    if (!state.inspector) state.inspector = localStorage.getItem(LS.inspector) || '';
    syncHeaderFromState();
    refreshAll();
    if (openZone) renderSheetBody(openZone);
  }

  /* ───────── payload + ส่งขึ้น Sheet ───────── */
  function inspectionId() {
    return [state.room, state.date, ROUNDS.indexOf(state.round) + 1].join('-');
  }

  function buildPayload(includePhotos) {
    var t = totalStats();
    var rows = [];
    ZONES.forEach(function (zone) {
      zone.items.forEach(function (it) {
        var s = itemState(it.key);
        if (!s || !s.s) return;
        if (s.s === STATUS.PASS) return;            // บันทึกเฉพาะ defect และ N/A
        rows.push({
          zoneNo: zone.no,
          zone: zone.name,
          zoneEn: zone.en,
          itemNo: it.no,
          itemKey: it.key,
          itemTh: it.th,
          itemEn: it.en,
          status: s.s,
          qty: s.s === STATUS.DEFECT ? (Number(s.qty) || 1) : 0,
          note: s.note || '',
          photos: includePhotos && s.s === STATUS.DEFECT ? (s.photos || []) : [],
        });
      });
    });
    return {
      action: 'submit',
      inspectionId: inspectionId(),
      roomType: ROOM_TYPE,
      room: state.room,
      round: state.round,
      inspector: state.inspector,
      date: state.date,
      note: state.note || '',
      summary: {
        total: t.total, checked: t.done, pass: t.pass,
        defect: t.defect, na: t.na, defectQty: t.qty,
        progressPct: TOTAL_ITEMS ? Math.round(t.done / TOTAL_ITEMS * 100) : 0,
      },
      rows: rows,
      clientTime: new Date().toISOString(),
    };
  }

  function apiUrl() { return (localStorage.getItem(LS.api) || '').trim(); }

  function postJson(url, payload) {
    // ใช้ text/plain เพื่อเลี่ยง CORS preflight ที่ Apps Script ไม่รองรับ
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (data) {
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'ปลายทางตอบกลับผิดพลาด');
      return data;
    });
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(LS.queue) || '[]'); } catch (e) { return []; }
  }
  function setQueue(q) {
    try { localStorage.setItem(LS.queue, JSON.stringify(q)); } catch (e) { /* เต็ม */ }
  }
  function enqueue(payload) {
    var q = getQueue();
    q = q.filter(function (p) { return p.inspectionId !== payload.inspectionId; });
    q.push(payload);
    setQueue(q);
    renderBanners();
  }

  function flushQueue(silent) {
    var url = apiUrl();
    var q = getQueue();
    if (!url || !q.length) { renderBanners(); return Promise.resolve(0); }
    var sent = 0;
    return q.reduce(function (chain, payload) {
      return chain.then(function () {
        return postJson(url, payload).then(function () {
          sent++;
          setQueue(getQueue().filter(function (p) { return p.inspectionId !== payload.inspectionId; }));
        }).catch(function () { /* ยังส่งไม่ได้ ปล่อยค้างไว้ */ });
      });
    }, Promise.resolve()).then(function () {
      renderBanners();
      if (sent && !silent) toast('ส่งข้อมูลที่ค้างอยู่ ' + sent + ' ชุดสำเร็จ', 'ok');
      return sent;
    });
  }

  function submit() {
    var url = apiUrl();
    if (!url) {
      toast('ยังไม่ได้ตั้งค่า Web App URL', 'err');
      $('dlgSettings').showModal();
      return;
    }
    if (!state.inspector.trim()) { toast('กรุณากรอกชื่อผู้ตรวจก่อน', 'err'); $('fInspector').focus(); return; }

    var t = totalStats();
    if (t.done === 0) { toast('ยังไม่ได้ตรวจรายการใดเลย', 'err'); return; }
    if (t.done < t.total) {
      var left = t.total - t.done;
      if (!confirm('ยังตรวจไม่ครบอีก ' + left + ' รายการ\nต้องการบันทึกเลยหรือไม่?')) return;
    }

    var withPhotos = localStorage.getItem(LS.photos) !== '0';
    var payload = buildPayload(withPhotos);
    var btn = $('btnSave');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';

    postJson(url, payload).then(function (res) {
      state.submittedAt = new Date().toISOString();
      saveDraft();
      toast('บันทึกลง Google Sheet แล้ว (' + (res.rowsWritten || payload.rows.length) + ' แถว)', 'ok', 4000);
      renderBanners();
    }).catch(function (err) {
      enqueue(buildPayload(false));   // ค้างไว้แบบไม่มีรูป เพื่อไม่ให้กินพื้นที่
      toast('ส่งไม่สำเร็จ: ' + err.message + ' — เก็บไว้ส่งภายหลังแล้ว', 'err', 5500);
    }).then(function () {
      btn.disabled = false; btn.textContent = 'บันทึกลง Sheet';
    });
  }

  /* ───────── banners ───────── */
  function renderBanners() {
    var wrap = $('banners');
    wrap.textContent = '';
    if (!apiUrl()) {
      var b = document.createElement('div');
      b.className = 'banner info no-print';
      b.innerHTML = '<span>⚙</span><span>ยังไม่ได้เชื่อมต่อ Google Sheet — ข้อมูลจะถูกเก็บไว้ในเครื่องนี้เท่านั้น ' +
        '<button type="button" id="bnSetup">ตั้งค่าเลย</button></span>';
      wrap.appendChild(b);
      $('bnSetup').addEventListener('click', function () { $('dlgSettings').showModal(); });
    }
    var q = getQueue();
    if (q.length) {
      var b2 = document.createElement('div');
      b2.className = 'banner warn no-print';
      b2.innerHTML = '<span>📤</span><span>มีข้อมูล ' + q.length + ' ชุดที่ยังส่งขึ้น Sheet ไม่สำเร็จ ' +
        '<button type="button" id="bnRetry">ลองส่งอีกครั้ง</button></span>';
      wrap.appendChild(b2);
      $('bnRetry').addEventListener('click', function () { flushQueue(false); });
    }
  }

  /* ───────── พื้นที่พิมพ์ / PDF ───────── */
  function renderPrintArea() {
    var t = totalStats();
    var html = '<h1>Defect Checklist — ' + esc(ROOM_TYPE) + '</h1>' +
      '<div class="meta">ห้อง <b>' + esc(state.room) + '</b> · รอบ ' + esc(state.round) +
      ' · ผู้ตรวจ ' + esc(state.inspector || '—') + ' · วันที่ ' + esc(state.date) +
      '<br>ตรวจแล้ว ' + t.done + '/' + t.total + ' · ผ่าน ' + t.pass +
      ' · Defect ' + t.defect + ' (' + t.qty + ' จุด) · N/A ' + t.na +
      (state.note ? '<br>หมายเหตุ: ' + esc(state.note) : '') + '</div>';

    html += '<table><thead><tr><th style="width:7%">ข้อ</th><th style="width:45%">รายการตรวจ</th>' +
      '<th style="width:11%">ผล</th><th style="width:8%">จำนวน</th><th>รายละเอียด</th></tr></thead><tbody>';
    ZONES.forEach(function (zone) {
      html += '<tr class="zh"><td colspan="5">' + zone.no + '. ' + esc(zone.name) + ' / ' + esc(zone.en) + '</td></tr>';
      zone.items.forEach(function (it) {
        var s = itemState(it.key);
        var mark = !s || !s.s ? '☐' : s.s === STATUS.PASS ? '✓ ผ่าน' : s.s === STATUS.DEFECT ? '✗ Defect' : '– N/A';
        html += '<tr><td>' + zone.no + '.' + it.no + '</td><td>' + esc(it.th) + '</td><td>' + mark + '</td>' +
          '<td>' + (s && s.s === STATUS.DEFECT ? (s.qty || 1) : '') + '</td>' +
          '<td>' + esc((s && s.note) || '') + '</td></tr>';
      });
    });
    html += '</tbody></table>';
    $('printArea').innerHTML = html;
  }

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ───────── toast ───────── */
  var toastTimer = null;
  function toast(msg, kind, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 3000);
  }

  /* ───────── การผูก event ───────── */
  function bind() {
    $('fRoom').addEventListener('change', function () { switchRoom(this.value); });
    $('fRound').addEventListener('change', function () { state.round = this.value; saveDraft(); });
    $('fInspector').addEventListener('input', function () {
      state.inspector = this.value;
      localStorage.setItem(LS.inspector, this.value);
      saveDraft();
    });
    $('fDate').addEventListener('change', function () { state.date = this.value; saveDraft(); renderPrintArea(); });
    $('fNote').addEventListener('input', function () { state.note = this.value; saveDraft(); });

    $('sheetClose').addEventListener('click', closeSheet);
    $('sheetBackdrop').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openZone) closeSheet();
    });

    $('btnAllPass').addEventListener('click', function () {
      if (!openZone) return;
      openZone.items.forEach(function (it) {
        var s = itemState(it.key);
        if (!s || !s.s) setItem(it.key, { s: STATUS.PASS });
      });
      renderSheetBody(openZone);
      refreshAll();
      toast('ตั้งรายการที่ยังไม่ตรวจในโซนนี้เป็น "ผ่าน" แล้ว', 'ok');
    });

    $('btnNextZone').addEventListener('click', function () {
      if (!openZone) return;
      var i = ZONES.indexOf(openZone);
      if (i < ZONES.length - 1) openSheet(ZONES[i + 1]);
      else { closeSheet(); toast('ตรวจครบทุกโซนแล้ว'); }
    });

    $('btnSave').addEventListener('click', submit);

    $('btnReset').addEventListener('click', function () {
      if (!confirm('ล้างผลตรวจของห้อง ' + state.room + ' ทั้งหมด?\nข้อมูลที่บันทึกลง Sheet ไปแล้วจะไม่ถูกลบ')) return;
      var keep = { round: state.round, inspector: state.inspector, date: state.date };
      state = blankState(state.room);
      state.round = keep.round; state.inspector = keep.inspector; state.date = keep.date;
      saveDraft();
      syncHeaderFromState();
      if (openZone) renderSheetBody(openZone);
      refreshAll();
      toast('ล้างข้อมูลห้อง ' + state.room + ' แล้ว');
    });

    $('btnPrint').addEventListener('click', function () { renderPrintArea(); window.print(); });

    $('btnSettings').addEventListener('click', function () {
      $('fApiUrl').value = apiUrl();
      $('fUploadPhotos').checked = localStorage.getItem(LS.photos) !== '0';
      $('dlgSettings').showModal();
    });

    $('btnSaveSettings').addEventListener('click', function () {
      localStorage.setItem(LS.api, $('fApiUrl').value.trim());
      localStorage.setItem(LS.photos, $('fUploadPhotos').checked ? '1' : '0');
      $('dlgSettings').close();
      renderBanners();
      flushQueue(true);
      toast('บันทึกการตั้งค่าแล้ว', 'ok');
    });

    $('btnTestConn').addEventListener('click', function () {
      var url = $('fApiUrl').value.trim();
      var dot = $('connDot'), txt = $('connText');
      if (!url) { dot.className = 'status-dot err'; txt.textContent = 'ยังไม่ได้ใส่ URL'; return; }
      dot.className = 'status-dot'; txt.textContent = 'กำลังทดสอบ…';
      postJson(url, { action: 'ping' }).then(function (res) {
        dot.className = 'status-dot ok';
        txt.textContent = 'เชื่อมต่อสำเร็จ — ไฟล์: ' + (res.spreadsheetName || 'ไม่ทราบชื่อ');
      }).catch(function (err) {
        dot.className = 'status-dot err';
        txt.textContent = 'เชื่อมต่อไม่สำเร็จ: ' + err.message;
      });
    });

    window.addEventListener('online', function () { flushQueue(true); });
    window.addEventListener('beforeunload', function (e) {
      var t = totalStats();
      if (t.done > 0 && !state.submittedAt) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ───────── init ───────── */
  function init() {
    fillSelects();
    buildHotspots();
    buildZoneList();
    bind();
    var room = localStorage.getItem(LS.lastRoom);
    if (ROOMS.indexOf(room) === -1) room = ROOMS[0];
    switchRoom(room);
    renderBanners();
    flushQueue(true);
  }

  init();
})();
