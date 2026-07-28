/* app.js — ตรรกะทั้งหมดของฟอร์มตรวจ defect */
(function () {
  'use strict';

  var LS = {
    api: 'dc:apiUrl',
    photos: 'dc:uploadPhotos',
    inspector: 'dc:inspector',
    lastRoom: 'dc:lastRoom',
    queue: 'dc:queue',
    pins: 'dc:pins',                                   // พิกัดหมุดที่ทำไว้จาก tag.html
    draft: function (room) { return 'dc:draft:' + room; },
  };

  var state = null;       // ผลตรวจของห้องที่เลือกอยู่
  var openCat = null;     // หมวดที่เปิดอยู่
  var filter = 'all';
  var photoTarget = null;

  var $ = function (id) { return document.getElementById(id); };

  /** ต่อเลขเวอร์ชันท้าย URL รูป กันเบราว์เซอร์ใช้รูปเก่าที่ cache ไว้ */
  function imgUrl(cat) {
    var v = typeof ASSET_VERSION === 'string' ? ASSET_VERSION : '';
    return v ? cat.img + '?v=' + v : cat.img;
  }

  function todayISO() {
    var d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  /* ═════════ พิกัดหมุด (ถ้ามี) ═════════ */
  function loadPins() {
    var stored;
    try { stored = JSON.parse(localStorage.getItem(LS.pins) || '{}'); } catch (e) { stored = {}; }
    CATEGORIES.forEach(function (cat) {
      var pins = (stored[cat.id] && stored[cat.id].length) ? stored[cat.id] : cat.pins;
      cat.pinMap = {};
      (pins || []).forEach(function (p) {
        if (p && p.x >= 0 && p.y >= 0) cat.pinMap[p.no] = p;   // ข้าม (-1,-1) ที่ถูกข้ามไว้
      });
      cat.hasPins = Object.keys(cat.pinMap).length > 0;
    });
  }

  /* ═════════ state ═════════ */
  function blankState(room) {
    return {
      room: room,
      round: ROUNDS[0],
      inspector: localStorage.getItem(LS.inspector) || '',
      date: todayISO(),
      note: '',
      items: {},                 // key -> { r, qty, note, photos[] }
      updatedAt: null,
      submittedAt: null,
    };
  }

  function loadDraft(room) {
    try {
      var d = JSON.parse(localStorage.getItem(LS.draft(room)) || 'null');
      if (!d) return blankState(room);
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
      toast('พื้นที่เก็บในเครื่องเต็ม — บันทึกลง Sheet แล้วลบรูปเก่าออก', 'err', 5000);
    }
  }

  function itemState(key) { return state.items[key] || null; }

  function setItem(key, patch) {
    var cur = state.items[key] || { r: null, qty: 1, note: '', photos: [] };
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    state.items[key] = cur;
    saveDraft();
  }

  /* ═════════ สถิติ ═════════ */
  function statsOf(items) {
    var s = { total: items.length, done: 0, pass: 0, ret: 0, fix: 0, qty: 0 };
    items.forEach(function (it) {
      var v = itemState(it.key);
      if (!v || !v.r) return;
      s.done++;
      if (v.r === 'pass') s.pass++;
      else if (v.r === 'return') { s.ret++; s.qty += Number(v.qty) || 1; }
      else if (v.r === 'fix') { s.fix++; s.qty += Number(v.qty) || 1; }
    });
    return s;
  }

  function allItems() {
    return CATEGORIES.reduce(function (a, c) { return a.concat(c.items); }, []);
  }

  function pct(n, d) { return d ? (n / d * 100) : 0; }

  /* ═════════ หน้าแรก ═════════ */
  function buildCatGrid() {
    var grid = $('catGrid');
    grid.textContent = '';
    CATEGORIES.forEach(function (cat) {
      var b = document.createElement('button');
      b.className = 'cat-card';
      b.dataset.cat = cat.id;
      b.innerHTML =
        '<img class="cat-thumb" loading="lazy" alt="">' +
        '<div class="cat-body">' +
          '<div class="cat-head"><span class="cat-no"></span>' +
          '<span style="min-width:0"><span class="cat-name"></span><br><span class="cat-en"></span></span></div>' +
          '<div class="cat-bar"><span class="p-pass"></span><span class="p-return"></span><span class="p-fix"></span></div>' +
          '<div class="cat-stat"></div>' +
        '</div>';
      b.querySelector('.cat-thumb').src = imgUrl(cat);
      b.querySelector('.cat-no').textContent = cat.no;
      b.querySelector('.cat-name').textContent = cat.th;
      b.querySelector('.cat-en').textContent = cat.name + ' · ' + cat.items.length + ' จุด';
      b.addEventListener('click', function () { openCategory(cat); });
      grid.appendChild(b);
    });
  }

  function refreshHome() {
    var t = statsOf(allItems());
    $('barPass').style.width = pct(t.pass, t.total) + '%';
    $('barReturn').style.width = pct(t.ret, t.total) + '%';
    $('barFix').style.width = pct(t.fix, t.total) + '%';
    $('homeLegend').innerHTML = legendHtml(t);
    $('homeSub').textContent = ROOM_TYPE + ' · ห้อง ' + state.room;

    CATEGORIES.forEach(function (cat) {
      var card = $('catGrid').querySelector('[data-cat="' + cat.id + '"]');
      if (!card) return;
      var s = statsOf(cat.items);
      card.classList.toggle('done', s.done === s.total && s.ret === 0 && s.fix === 0);
      card.classList.toggle('has-defect', s.ret > 0 || s.fix > 0);
      card.querySelector('.cat-bar .p-pass').style.width = pct(s.pass, s.total) + '%';
      card.querySelector('.cat-bar .p-return').style.width = pct(s.ret, s.total) + '%';
      card.querySelector('.cat-bar .p-fix').style.width = pct(s.fix, s.total) + '%';
      var bits = ['ตรวจแล้ว ' + s.done + '/' + s.total];
      if (s.ret) bits.push('<span class="bad">ส่งคืน ' + s.ret + '</span>');
      if (s.fix) bits.push('<span class="amb">แก้เอง ' + s.fix + '</span>');
      card.querySelector('.cat-stat').innerHTML = bits.join('');
    });

    var blanks = t.total - t.done;
    var tail = blanks
      ? ' · <span style="color:var(--muted)">อีก ' + blanks + ' จุดที่ไม่กรอก = ผ่าน</span>'
      : ' · ตรวจครบทุกจุด';
    $('bottomSum').innerHTML = (t.ret || t.fix)
      ? 'ส่งคืน <b class="bad">' + t.ret + '</b> · แก้เอง <b class="amb">' + t.fix + '</b>' + tail
      : 'ยังไม่พบ defect' + tail;

    renderPrintArea();
  }

  function legendHtml(s) {
    return '<span>ตรวจแล้ว ' + s.done + '/' + s.total + ' (' + Math.round(pct(s.done, s.total)) + '%)</span>' +
           '<span>✓ ผ่าน ' + s.pass + '</span>' +
           '<span>↩ ส่งคืน ' + s.ret + '</span>' +
           '<span>🔧 แก้เอง ' + s.fix + '</span>';
  }

  /* ═════════ หน้าหมวด ═════════ */
  function openCategory(cat) {
    openCat = cat;
    filter = 'all';
    $('catTitle').textContent = cat.no + '. ' + cat.th;
    $('catSub').textContent = cat.name + ' · ห้อง ' + state.room + ' · ' + cat.items.length + ' จุดตรวจ';
    $('catImg').src = imgUrl(cat);
    $('catImg').alt = 'รูปอ้างอิงจุดตรวจ ' + cat.th;
    $('photoHintText').textContent = cat.hasPins
      ? 'แตะหมุดบนรูปเพื่อไปยังจุดนั้น'
      : 'ดูหมายเลขบนรูป แล้วพิมพ์เลขในช่องด้านล่าง';

    var notes = cat.notes || [];
    $('notesCard').hidden = notes.length === 0;
    $('notesList').innerHTML = notes.map(function (n) {
      return '<li>' + esc(n) + '</li>';
    }).join('');

    buildFilters();
    renderPins();
    renderItems();
    refreshCat();
    showScreen('screenCat');
    window.scrollTo(0, 0);
  }

  function buildFilters() {
    var opts = [
      ['all', 'ทั้งหมด'], ['todo', 'ยังไม่ตรวจ'],
      ['return', '↩ ส่งคืน'], ['fix', '🔧 แก้เอง'], ['pass', '✓ ผ่าน'],
    ];
    var row = $('filterRow');
    row.textContent = '';
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.dataset.f = o[0];
      b.textContent = o[1];
      b.classList.toggle('on', filter === o[0]);
      b.addEventListener('click', function () {
        filter = o[0];
        row.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.f === filter); });
        renderItems();
      });
      row.appendChild(b);
    });
  }

  function visibleItems() {
    return openCat.items.filter(function (it) {
      var v = itemState(it.key);
      var r = v && v.r;
      if (filter === 'all') return true;
      if (filter === 'todo') return !r;
      return r === filter;
    });
  }

  function renderItems() {
    var list = $('itemList');
    list.textContent = '';
    var items = visibleItems();
    if (!items.length) {
      list.innerHTML = '<div class="banner info">ไม่มีรายการในตัวกรองนี้</div>';
      return;
    }
    items.forEach(function (it) { list.appendChild(renderItem(it)); });
  }

  function renderItem(it) {
    var box = document.createElement('div');
    box.className = 'item';
    box.dataset.key = it.key;
    box.dataset.no = it.no;

    var head = document.createElement('div');
    head.className = 'item-head';
    head.innerHTML = '<span class="item-no"></span><span class="item-text"></span>';
    head.querySelector('.item-no').textContent = it.no;
    head.querySelector('.item-text').textContent = it.th;
    if (openCat.pinMap[it.no]) {
      var loc = document.createElement('button');
      loc.className = 'item-loc';
      loc.textContent = '📍';
      loc.title = 'ดูตำแหน่งบนรูป';
      loc.addEventListener('click', function () { flashPin(it.no); });
      head.appendChild(loc);
    }
    box.appendChild(head);

    var seg = document.createElement('div');
    seg.className = 'seg';
    RESULTS.forEach(function (res) {
      var b = document.createElement('button');
      b.dataset.v = res.id;
      b.textContent = res.short + ' ' + res.label;
      b.addEventListener('click', function () {
        var cur = itemState(it.key);
        setItem(it.key, { r: (cur && cur.r === res.id) ? null : res.id });
        paintItem(box, it);
        refreshCat();
        refreshHome();
        renderPins();
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);

    var det = document.createElement('div');
    det.className = 'detail';
    det.hidden = true;

    var qr = document.createElement('div');
    qr.className = 'qty-row';
    qr.innerHTML = '<label>จำนวนจุดที่พบ</label>' +
      '<span class="stepper"><button type="button" data-d="-1">−</button>' +
      '<input type="number" inputmode="numeric" min="1" step="1" value="1">' +
      '<button type="button" data-d="1">+</button></span>';
    var qi = qr.querySelector('input');
    qr.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = Math.max(1, (parseInt(qi.value, 10) || 1) + parseInt(b.dataset.d, 10));
        qi.value = v;
        setItem(it.key, { qty: v });
        refreshCat();
        refreshHome();
      });
    });
    qi.addEventListener('input', function () {
      setItem(it.key, { qty: Math.max(1, parseInt(qi.value, 10) || 1) });
      refreshCat();
      refreshHome();
    });
    det.appendChild(qr);

    var ta = document.createElement('textarea');
    ta.placeholder = 'รายละเอียด / ตำแหน่งที่พบ';
    ta.addEventListener('input', function () { setItem(it.key, { note: ta.value }); });
    det.appendChild(ta);

    var pr = document.createElement('div');
    pr.className = 'photo-row';
    det.appendChild(pr);

    box.appendChild(det);
    paintItem(box, it);
    return box;
  }

  function paintItem(box, it) {
    var v = itemState(it.key);
    var r = v && v.r;
    box.classList.remove('r-pass', 'r-return', 'r-fix');
    if (r) box.classList.add('r-' + r);
    box.querySelectorAll('.seg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.v === r);
    });
    var det = box.querySelector('.detail');
    det.hidden = !(r === 'return' || r === 'fix');
    if (!det.hidden) {
      box.querySelector('.stepper input').value = (v && v.qty) || 1;
      box.querySelector('textarea').value = (v && v.note) || '';
      paintPhotos(box, it);
    }
  }

  function paintPhotos(box, it) {
    var v = itemState(it.key) || {};
    var photos = v.photos || [];
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

  function refreshCat() {
    if (!openCat) return;
    var s = statsOf(openCat.items);
    $('cBarPass').style.width = pct(s.pass, s.total) + '%';
    $('cBarReturn').style.width = pct(s.ret, s.total) + '%';
    $('cBarFix').style.width = pct(s.fix, s.total) + '%';
    $('catLegend').innerHTML = legendHtml(s);
  }

  /* ═════════ หมุดบนรูป ═════════ */
  function renderPins() {
    var wrap = $('photoWrap');
    wrap.querySelectorAll('.pin').forEach(function (p) { p.remove(); });
    if (!openCat || !openCat.hasPins) return;
    openCat.items.forEach(function (it) {
      var p = openCat.pinMap[it.no];
      if (!p) return;
      var v = itemState(it.key);
      var el = document.createElement('button');
      el.className = 'pin' + (v && v.r ? ' r-' + v.r : '');
      el.dataset.no = it.no;
      el.style.left = (p.x * 100) + '%';
      el.style.top = (p.y * 100) + '%';
      el.textContent = it.no;
      el.title = it.th;
      el.addEventListener('click', function () { jumpTo(it.no); });
      wrap.appendChild(el);
    });
  }

  function flashPin(no) {
    var el = $('photoWrap').querySelector('.pin[data-no="' + no + '"]');
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  function jumpTo(no) {
    if (!openCat) return;
    var it = openCat.items.filter(function (x) { return x.no === Number(no); })[0];
    if (!it) { toast('ไม่มีข้อ ' + no + ' ในหมวดนี้', 'err'); return; }
    if (filter !== 'all') {
      filter = 'all';
      buildFilters();
      renderItems();
    }
    var box = $('itemList').querySelector('[data-key="' + it.key + '"]');
    if (!box) return;
    box.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.classList.add('target');
    setTimeout(function () { box.classList.remove('target'); }, 1800);
  }

  /* ═════════ รูปถ่าย ═════════ */
  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000;
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var w = Math.round(img.width * s), h = Math.round(img.height * s);
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
    compressImage(file, function (url) {
      if (!url) { toast('อ่านรูปไม่สำเร็จ', 'err'); return; }
      var v = itemState(t.key) || {};
      setItem(t.key, { photos: (v.photos || []).concat([url]) });
      paintPhotos(t.box, t.item);
    });
  });

  /* ═════════ ตัวดูรูปแบบขยาย ═════════ */
  var vz = { scale: 1, x: 0, y: 0, base: 1 };

  function openViewer() {
    if (!openCat) return;
    $('viewerTitle').textContent = openCat.no + '. ' + openCat.th + ' (' + openCat.name + ')';
    var img = $('viewerImg');
    img.src = imgUrl(openCat);
    $('viewer').classList.add('open');
    document.body.style.overflow = 'hidden';
    img.onload = fitViewer;
    if (img.complete) fitViewer();
  }

  function fitViewer() {
    var stage = $('viewerStage');
    var img = $('viewerImg');
    // อ่านขนาดจริงจากไฟล์รูป จะเปลี่ยนรูปใหม่โดยไม่ต้องแก้โค้ดก็ได้
    var iw = img.naturalWidth || openCat.imgW;
    var ih = img.naturalHeight || openCat.imgH;
    if (!iw || !ih) return;
    vz.base = Math.min(stage.clientWidth / iw, stage.clientHeight / ih);
    vz.scale = vz.base;
    vz.x = (stage.clientWidth - iw * vz.scale) / 2;
    vz.y = (stage.clientHeight - ih * vz.scale) / 2;
    $('viewerImg').style.width = iw + 'px';
    $('viewerImg').style.height = ih + 'px';
    applyViewer();
  }

  function applyViewer() {
    $('viewerInner').style.transform =
      'translate(' + vz.x + 'px,' + vz.y + 'px) scale(' + vz.scale + ')';
  }

  function zoomAt(cx, cy, factor) {
    var ns = Math.max(vz.base * 0.8, Math.min(vz.base * 12, vz.scale * factor));
    var k = ns / vz.scale;
    vz.x = cx - (cx - vz.x) * k;
    vz.y = cy - (cy - vz.y) * k;
    vz.scale = ns;
    applyViewer();
  }

  function bindViewer() {
    var stage = $('viewerStage');
    var pts = {}, lastDist = 0, lastMid = null, moved = false, lastTap = 0;

    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      moved = false;
      lastDist = 0;
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return;
      var prev = pts[e.pointerId];
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      var r = stage.getBoundingClientRect();

      if (ids.length === 1) {
        vz.x += e.clientX - prev.x;
        vz.y += e.clientY - prev.y;
        if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 2) moved = true;
        applyViewer();
      } else if (ids.length >= 2) {
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
        if (lastDist) {
          zoomAt(mid.x, mid.y, d / lastDist);
          if (lastMid) { vz.x += mid.x - lastMid.x; vz.y += mid.y - lastMid.y; applyViewer(); }
        }
        lastDist = d;
        lastMid = mid;
        moved = true;
      }
    });

    function up(e) {
      delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) { lastDist = 0; lastMid = null; }
      if (!moved && e.type === 'pointerup') {
        var now = Date.now();
        if (now - lastTap < 300) {
          var r = stage.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, vz.scale > vz.base * 1.8 ? 0.4 : 2.5);
          lastTap = 0;
        } else { lastTap = now; }
      }
    }
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    }, { passive: false });

    $('viewerIn').addEventListener('click', function () {
      zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.5);
    });
    $('viewerOut').addEventListener('click', function () {
      zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.5);
    });
    $('viewerClose').addEventListener('click', function () {
      $('viewer').classList.remove('open');
      document.body.style.overflow = '';
    });
  }

  /* ═════════ payload / ส่งขึ้น Sheet ═════════ */
  function inspectionId() {
    return [state.room, state.date, ROUNDS.indexOf(state.round) + 1].join('-');
  }

  function buildPayload(withPhotos) {
    var t = statsOf(allItems());
    var rows = [];
    CATEGORIES.forEach(function (cat) {
      cat.items.forEach(function (it) {
        var v = itemState(it.key);
        if (!v || !v.r || v.r === 'pass') return;      // บันทึกเฉพาะ ส่งคืน / แก้เอง
        rows.push({
          catNo: cat.no, cat: cat.name, catTh: cat.th,
          no: it.no, key: it.key, item: it.th,
          result: v.r,
          qty: Number(v.qty) || 1,
          note: v.note || '',
          photos: withPhotos ? (v.photos || []) : [],
        });
      });
    });
    return {
      action: 'submit',
      inspectionId: inspectionId(),
      roomType: ROOM_TYPE,
      room: state.room, round: state.round,
      inspector: state.inspector, date: state.date, note: state.note || '',
      summary: {
        total: t.total, checked: t.done, pass: t.pass,
        ret: t.ret, fix: t.fix, defectQty: t.qty,
        progressPct: Math.round(pct(t.done, t.total)),
      },
      rows: rows,
      // ส่งรายชื่อหมวดไปด้วย ชีทสรุปจะได้มีคอลัมน์ครบแม้บางหมวดไม่มี defect เลย
      catalog: CATEGORIES.map(function (c) {
        return { no: c.no, name: c.name, th: c.th };
      }),
      clientTime: new Date().toISOString(),
    };
  }

  /** ค่าเริ่มต้นจาก config.js — ผู้ตรวจจึงไม่ต้องตั้งค่าอะไรเลย */
  function defaultApiUrl() {
    return (typeof API_URL === 'string' ? API_URL : '').trim();
  }

  /** ค่าที่ตั้งทับไว้เฉพาะเครื่องนี้ (ปกติไม่มี) */
  function overrideApiUrl() {
    return (localStorage.getItem(LS.api) || '').trim();
  }

  function apiUrl() { return overrideApiUrl() || defaultApiUrl(); }

  /**
   * ตั้งจุดที่ยังไม่ได้กรอกผลให้เป็น "ผ่าน" ทั้งหมด
   * ผู้ตรวจจึงกรอกเฉพาะจุดที่เป็น ส่งคืน / แก้เอง เท่านั้น
   */
  function autoPassBlanks() {
    var n = 0;
    allItems().forEach(function (it) {
      var v = itemState(it.key);
      if (!v || !v.r) { setItem(it.key, { r: 'pass' }); n++; }
    });
    if (n) {
      refreshHome();
      if (openCat) { renderItems(); renderPins(); refreshCat(); }
    }
    return n;
  }

  function uploadPhotos() {
    var v = localStorage.getItem(LS.photos);
    if (v === null) return typeof UPLOAD_PHOTOS_DEFAULT === 'boolean' ? UPLOAD_PHOTOS_DEFAULT : true;
    return v !== '0';
  }

  function postJson(url, payload) {
    if (window.DCAuth) DCAuth.sign(payload);      // แนบรหัสไปด้วยทุกครั้ง
    // text/plain เพื่อเลี่ยง CORS preflight ที่ Apps Script ไม่รองรับ
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (d) {
      if (!d || d.ok !== true) throw new Error((d && d.error) || 'ปลายทางตอบกลับผิดพลาด');
      return d;
    });
  }

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(LS.queue) || '[]'); } catch (e) { return []; }
  }
  function setQueue(q) {
    try { localStorage.setItem(LS.queue, JSON.stringify(q)); } catch (e) { /* เต็ม */ }
  }
  function enqueue(p) {
    setQueue(getQueue().filter(function (x) { return x.inspectionId !== p.inspectionId; }).concat([p]));
    renderBanners();
  }

  function flushQueue(silent) {
    var url = apiUrl(), q = getQueue();
    if (!url || !q.length) { renderBanners(); return Promise.resolve(0); }
    var sent = 0;
    return q.reduce(function (chain, p) {
      return chain.then(function () {
        return postJson(url, p).then(function () {
          sent++;
          setQueue(getQueue().filter(function (x) { return x.inspectionId !== p.inspectionId; }));
        }).catch(function () { /* ยังส่งไม่ได้ */ });
      });
    }, Promise.resolve()).then(function () {
      renderBanners();
      if (sent && !silent) toast('ส่งข้อมูลที่ค้างอยู่ ' + sent + ' ชุดสำเร็จ', 'ok');
      return sent;
    });
  }

  /**
   * ดึงผลตรวจที่บันทึกไว้ในชีทกลับมาลงเครื่อง (two-way)
   * ทับข้อมูลในเครื่องทั้งชุด จึงถามยืนยันก่อนเสมอถ้ามีของค้างอยู่
   */
  function loadFromSheet() {
    var url = apiUrl();
    if (!url) { toast('ยังไม่ได้ตั้งค่า Web App URL', 'err'); $('dlgSettings').showModal(); return; }

    var btn = $('btnLoad');
    btn.disabled = true; btn.textContent = 'กำลังดึง…';

    postJson(url, { action: 'load', room: state.room, date: state.date, round: state.round })
      .then(function (res) {
        if (!res.found) {
          // ไม่เจอของ วัน+รอบ นี้ ลองหาครั้งล่าสุดของห้องนี้แทน
          return postJson(url, { action: 'load', room: state.room }).then(function (r2) {
            if (!r2.found) { toast('ยังไม่มีข้อมูลของห้อง ' + state.room + ' ในชีท', 'err', 4000); return null; }
            if (!confirm('ไม่พบข้อมูลของ ' + state.date + ' รอบ "' + state.round + '"\n\n' +
                         'พบครั้งล่าสุดคือ ' + r2.inspection.date + ' รอบ "' + r2.inspection.round + '"\n' +
                         'ต้องการดึงชุดนั้นมาแทนหรือไม่?')) return null;
            return r2;
          });
        }
        return res;
      })
      .then(function (res) {
        if (!res) return;
        var local = statsOf(allItems());
        if (local.done && !confirm('ในเครื่องนี้มีผลตรวจอยู่ ' + local.done + ' จุด\n\n' +
                                   'การดึงข้อมูลจะทับของเดิมทั้งหมด ยืนยันหรือไม่?')) return;
        applyLoaded(res.inspection, res.items);
        toast('ดึงข้อมูลจากชีทแล้ว — ' + res.items.length + ' จุดที่เป็น defect', 'ok', 4000);
      })
      .catch(function (err) { toast('ดึงข้อมูลไม่สำเร็จ: ' + err.message, 'err', 5000); })
      .then(function () { btn.disabled = false; btn.textContent = '⭳ ดึงข้อมูลจาก Sheet'; });
  }

  /** เขียนผลที่ดึงมาลง state — จุดที่ไม่อยู่ในรายการ defect คือ "ผ่าน" */
  function applyLoaded(insp, items) {
    var byCat = {};
    CATEGORIES.forEach(function (c) { byCat[c.name] = c; });

    state = blankState(insp.room);
    state.round = insp.round || state.round;
    state.inspector = insp.inspector || state.inspector;
    state.date = insp.date || state.date;
    state.note = insp.note || '';

    var missed = 0;
    items.forEach(function (it) {
      var cat = byCat[it.cat];
      if (!cat) { missed++; return; }
      state.items[cat.id + '-' + it.no] = {
        r: it.result, qty: Math.max(1, it.qty || 1),
        note: it.note || '', photos: [],           // รูปอยู่บน Drive แล้ว ไม่ดึงกลับมากินพื้นที่
        photoUrls: it.photos || []
      };
    });

    // ชีทเก็บเฉพาะ defect — ที่เหลือคือผ่าน (ตรงกับตอนบันทึก)
    if (insp.checked >= insp.total) {
      allItems().forEach(function (x) { if (!state.items[x.key]) state.items[x.key] = { r: 'pass', qty: 1, note: '', photos: [] }; });
    }

    state.submittedAt = insp.savedAt || new Date().toISOString();
    saveDraft();
    switchRoom(insp.room);
    if (openCat) { renderItems(); renderPins(); refreshCat(); }
    if (missed) toast('มี ' + missed + ' แถวที่หมวดไม่ตรงกับฟอร์มปัจจุบัน ข้ามไป', 'err', 5000);
  }

  function submit() {
    var url = apiUrl();
    if (!url) { toast('ยังไม่ได้ตั้งค่า Web App URL', 'err'); $('dlgSettings').showModal(); return; }
    if (!state.inspector.trim()) {
      toast('กรุณากรอกชื่อผู้ตรวจก่อน', 'err');
      showScreen('screenHome');
      $('fInspector').focus();
      return;
    }
    var before = statsOf(allItems());
    if (!before.done) { toast('ยังไม่ได้กรอกจุดใดเลย', 'err'); return; }

    // จุดที่ไม่ได้กรอก ส่งคืน/แก้เอง = ผ่าน อัตโนมัติ
    var blanks = before.total - before.done;
    if (blanks) {
      if (!confirm('ยังไม่ได้กรอก ' + blanks + ' จุด\n\n' +
                   'ระบบจะบันทึกจุดเหล่านี้เป็น "ผ่าน" ทั้งหมด\nยืนยันบันทึกหรือไม่?')) return;
      autoPassBlanks();
    }

    var payload = buildPayload(uploadPhotos());
    var btn = $('btnSave');
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';

    postJson(url, payload).then(function (res) {
      state.submittedAt = new Date().toISOString();
      saveDraft();
      toast('บันทึกลง Google Sheet แล้ว (' + (res.rowsWritten != null ? res.rowsWritten : payload.rows.length) + ' แถว)', 'ok', 4000);
      renderBanners();
    }).catch(function (err) {
      enqueue(buildPayload(false));
      toast('ส่งไม่สำเร็จ: ' + err.message + ' — เก็บไว้ส่งภายหลังแล้ว', 'err', 5500);
    }).then(function () {
      btn.disabled = false; btn.textContent = 'บันทึก';
    });
  }

  /** บอกว่า URL ที่ใช้อยู่มาจากไหน — ค่าเริ่มต้นของระบบ หรือที่ตั้งทับไว้เครื่องนี้ */
  function paintApiSource() {
    var note = $('apiSrcNote'), reset = $('btnResetConn'), ver = $('verText');
    if (ver) {
      var r = window.DCAuth ? DCAuth.role() : '';
      ver.textContent = 'v' + (typeof ASSET_VERSION === 'string' ? ASSET_VERSION : '?') +
        (r ? ' · เข้าใช้งานเป็น ' + (r === 'admin' ? 'ผู้ดูแล' : 'ผู้ตรวจ') : '');
    }
    var lo = $('btnLogout');
    if (lo) lo.hidden = !(window.DCAuth && DCAuth.role());
    if (!note) return;
    if (overrideApiUrl()) {
      note.innerHTML = '⚠️ เครื่องนี้ตั้ง URL ทับค่าเริ่มต้นไว้ ' +
        'ถ้าไม่ได้ตั้งใจให้กด "คืนค่าเริ่มต้น" เพื่อใช้ค่าเดียวกับเครื่องอื่น';
      if (reset) reset.hidden = false;
    } else if (defaultApiUrl()) {
      note.textContent = '✓ ใช้ค่าเริ่มต้นที่ตั้งไว้ในระบบ (js/config.js) — ผู้ตรวจไม่ต้องกรอกอะไรเอง ' +
        'แก้ที่นี่เฉพาะกรณีอยากให้เครื่องนี้ส่งไป Sheet คนละไฟล์';
      if (reset) reset.hidden = true;
    } else {
      note.textContent = 'ยังไม่ได้ตั้งค่าเริ่มต้นใน js/config.js — วาง Web App URL ที่ได้จาก Apps Script ที่นี่';
      if (reset) reset.hidden = true;
    }
  }

  /* ═════════ banners ═════════ */
  function renderBanners() {
    var wrap = $('banners');
    wrap.textContent = '';
    if (!apiUrl()) {
      var b = document.createElement('div');
      b.className = 'banner info no-print';
      b.innerHTML = '<span>⚙</span><span>ยังไม่ได้เชื่อมต่อ Google Sheet — ข้อมูลเก็บในเครื่องนี้เท่านั้น ' +
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

  /* ═════════ พิมพ์ ═════════ */
  function renderPrintArea() {
    var t = statsOf(allItems());
    var h = '<h1>Defect Checklist — ' + esc(ROOM_TYPE) + '</h1>' +
      '<div class="meta">ห้อง <b>' + esc(state.room) + '</b> · ' + esc(state.round) +
      ' · ผู้ตรวจ ' + esc(state.inspector || '—') + ' · ' + esc(state.date) +
      '<br>ตรวจแล้ว ' + t.done + '/' + t.total + ' · ผ่าน ' + t.pass +
      ' · ส่งคืน ' + t.ret + ' · แก้เอง ' + t.fix +
      (state.note ? '<br>หมายเหตุ: ' + esc(state.note) : '') + '</div>';

    h += '<table><thead><tr><th style="width:7%">ข้อ</th><th style="width:42%">จุดตรวจสอบ</th>' +
      '<th style="width:9%">ส่งคืน</th><th style="width:9%">แก้เอง</th><th>รายละเอียด</th></tr></thead><tbody>';
    CATEGORIES.forEach(function (cat) {
      h += '<tr class="ch"><td colspan="5">' + cat.no + '. ' + esc(cat.th) + ' / ' + esc(cat.name) + '</td></tr>';
      cat.items.forEach(function (it) {
        var v = itemState(it.key);
        var r = v && v.r;
        h += '<tr><td>' + it.no + '</td><td>' + esc(it.th) + '</td>' +
          '<td>' + (r === 'return' ? '✓ ' + (v.qty || 1) : '') + '</td>' +
          '<td>' + (r === 'fix' ? '✓ ' + (v.qty || 1) : '') + '</td>' +
          '<td>' + esc((v && v.note) || (r === 'pass' ? 'ผ่าน' : '')) + '</td></tr>';
      });
    });
    $('printArea').innerHTML = h + '</tbody></table>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ═════════ toast / screens ═════════ */
  var toastTimer = null;
  function toast(msg, kind, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, ms || 3000);
  }

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(function (s) {
      s.classList.toggle('active', s.id === id);
    });
  }

  /* ═════════ หัวฟอร์ม ═════════ */
  function fillSelects() {
    ROOMS.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = 'ห้อง ' + r;
      $('fRoom').appendChild(o);
    });
    ROUNDS.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = r;
      $('fRound').appendChild(o);
    });
  }

  function switchRoom(room) {
    state = loadDraft(room);
    localStorage.setItem(LS.lastRoom, room);
    if (!state.inspector) state.inspector = localStorage.getItem(LS.inspector) || '';
    $('fRoom').value = state.room;
    $('fRound').value = state.round;
    $('fInspector').value = state.inspector;
    $('fDate').value = state.date;
    $('fNote').value = state.note || '';
    refreshHome();
    if (openCat) { renderItems(); renderPins(); refreshCat(); }
  }

  /* ═════════ bind ═════════ */
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

    $('btnBack').addEventListener('click', function () {
      showScreen('screenHome');
      openCat = null;
      window.scrollTo(0, 0);
    });

    $('btnAllPass').addEventListener('click', function () {
      if (!openCat) return;
      var n = 0;
      openCat.items.forEach(function (it) {
        var v = itemState(it.key);
        if (!v || !v.r) { setItem(it.key, { r: 'pass' }); n++; }
      });
      renderItems(); renderPins(); refreshCat(); refreshHome();
      toast(n ? 'ตั้ง ' + n + ' จุดที่ยังไม่ตรวจเป็น "ผ่าน" แล้ว' : 'ตรวจครบทุกจุดแล้ว', 'ok');
    });

    $('btnJump').addEventListener('click', function () { jumpTo($('fJump').value); });
    $('fJump').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); jumpTo(this.value); }
    });

    $('photoWrap').addEventListener('click', function (e) {
      if (!e.target.classList.contains('pin')) openViewer();
    });
    $('btnZoom').addEventListener('click', openViewer);
    bindViewer();

    $('btnSave').addEventListener('click', submit);
    $('btnLoad').addEventListener('click', loadFromSheet);

    $('btnReset').addEventListener('click', function () {
      // ปุ่มนี้แตะแค่ข้อมูลในเครื่อง ไม่มีการติดต่อ Sheet เลย
      if (!confirm(
        'ล้างผลตรวจของห้อง ' + state.room + ' "เฉพาะในเครื่องนี้"?\n\n' +
        '• แถวที่บันทึกลง Sheet ไปแล้วยังอยู่ครบ — ปุ่มนี้ไม่ได้ต่อเน็ต\n' +
        '• ถ้าล้างผิด ดึงกลับได้ด้วยปุ่ม ⭳ ดึงข้อมูลจาก Sheet\n\n' +
        'แต่ถ้าตรวจใหม่แล้วกดบันทึกด้วย ห้อง + วันที่ + รอบ เดิม\n' +
        'แถวเก่าใน Sheet จะถูกแทนที่ด้วยของใหม่')) return;
      var keep = { round: state.round, inspector: state.inspector, date: state.date };
      state = blankState(state.room);
      state.round = keep.round; state.inspector = keep.inspector; state.date = keep.date;
      saveDraft();
      switchRoom(state.room);
      if (openCat) { renderItems(); renderPins(); refreshCat(); }
      toast('ล้างข้อมูลห้อง ' + state.room + ' ในเครื่องแล้ว — Sheet ยังอยู่ครบ กด ⭳ ดึงกลับได้', 'ok', 5000);
    });

    $('btnPrint').addEventListener('click', function () { renderPrintArea(); window.print(); });

    $('btnSettings').addEventListener('click', function () {
      $('fApiUrl').value = apiUrl();
      $('fUploadPhotos').checked = uploadPhotos();
      paintApiSource();
      $('dlgSettings').showModal();
    });

    $('btnSaveSettings').addEventListener('click', function () {
      var v = $('fApiUrl').value.trim();
      // ตรงกับค่าเริ่มต้นอยู่แล้ว = ไม่ต้องเก็บทับ จะได้อัปเดตตามโค้ดเสมอ
      if (!v || v === defaultApiUrl()) localStorage.removeItem(LS.api);
      else localStorage.setItem(LS.api, v);
      localStorage.setItem(LS.photos, $('fUploadPhotos').checked ? '1' : '0');
      paintApiSource();
      $('dlgSettings').close();
      renderBanners();
      flushQueue(true);
      toast('บันทึกการตั้งค่าแล้ว', 'ok');
    });

    $('btnLogout').addEventListener('click', function () {
      if (confirm('ออกจากระบบ? ครั้งหน้าต้องใส่รหัสใหม่\n(ผลตรวจที่ค้างอยู่ในเครื่องไม่หาย)')) {
        DCAuth.logout();
      }
    });

    $('btnResetConn').addEventListener('click', function () {
      localStorage.removeItem(LS.api);
      $('fApiUrl').value = defaultApiUrl();
      paintApiSource();
      renderBanners();
      toast('กลับมาใช้ค่าเริ่มต้นของระบบแล้ว', 'ok');
    });
    $('btnTestConn').addEventListener('click', function () {
      var url = $('fApiUrl').value.trim(), dot = $('connDot'), txt = $('connText');
      if (!url) { dot.className = 'status-dot err'; txt.textContent = 'ยังไม่ได้ใส่ URL'; return; }
      dot.className = 'status-dot'; txt.textContent = 'กำลังทดสอบ…';
      postJson(url, { action: 'ping' }).then(function (r) {
        dot.className = 'status-dot ok';
        txt.textContent = 'เชื่อมต่อสำเร็จ — ไฟล์: ' + (r.spreadsheetName || 'ไม่ทราบชื่อ');
      }).catch(function (e) {
        dot.className = 'status-dot err';
        txt.textContent = 'เชื่อมต่อไม่สำเร็จ: ' + e.message;
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('viewer').classList.contains('open')) {
        $('viewer').classList.remove('open');
        document.body.style.overflow = '';
      } else if (openCat) {
        showScreen('screenHome');
        openCat = null;
      }
    });

    window.addEventListener('online', function () { flushQueue(true); });
    window.addEventListener('resize', function () {
      if ($('viewer').classList.contains('open')) fitViewer();
    });
    window.addEventListener('beforeunload', function (e) {
      var t = statsOf(allItems());
      if (t.done > 0 && !state.submittedAt) { e.preventDefault(); e.returnValue = ''; }
    });
  }


  /**
   * บอก Apps Script ว่า room type นี้มีหมวดอะไรบ้าง
   * ทำครั้งเดียวต่อเวอร์ชัน เพื่อให้ชีทสรุปมีคอลัมน์ครบทุกหมวด
   * แม้บางหมวดจะไม่เคยเจอ defect เลย
   */
  function registerCatalog() {
    var url = apiUrl();
    if (!url) return;
    var tag = ROOM_TYPE + '@' + (typeof ASSET_VERSION === 'string' ? ASSET_VERSION : '');
    if (localStorage.getItem('dc:catReg') === tag) return;

    postJson(url, {
      action: 'registerCatalog',
      roomType: ROOM_TYPE,
      catalog: CATEGORIES.map(function (c) { return { no: c.no, name: c.name, th: c.th }; }),
    }).then(function () {
      localStorage.setItem('dc:catReg', tag);
    }).catch(function () { /* ออฟไลน์อยู่ ไว้ค่อยลองใหม่คราวหน้า */ });
  }

  /* ═════════ ตรวจว่ามีเวอร์ชันใหม่หรือยัง ═════════ */
  /* ?v= กันแคชได้แค่ css/js/รูป แต่ตัวไฟล์ HTML เองยังถูกแคชได้
     จึงถาม version.json ตรง ๆ แบบไม่ผ่านแคช แล้วเทียบกับเวอร์ชันที่โหลดมาจริง */
  function checkForUpdate() {
    if (typeof ASSET_VERSION !== 'string') return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.version || String(d.version) === ASSET_VERSION) return;
        showUpdateBar(String(d.version));
      })
      .catch(function () { /* ออฟไลน์อยู่ ไม่ต้องทำอะไร */ });
  }

  function showUpdateBar(newVer) {
    if (document.getElementById('updBar')) return;
    var bar = document.createElement('div');
    bar.id = 'updBar';
    bar.className = 'update-bar';
    bar.innerHTML = '<span>มีเวอร์ชันใหม่ (v' + newVer + ') — ตอนนี้ใช้ v' +
      ASSET_VERSION + ' อยู่</span><button type="button">อัปเดตเลย</button>';
    bar.querySelector('button').addEventListener('click', function () {
      // ใส่ query ใหม่ท้าย URL เพื่อบังคับให้โหลดไฟล์ HTML ใหม่จริง ๆ
      var base = location.href.split('?')[0].split('#')[0];
      location.replace(base + '?u=' + Date.now());
    });
    document.body.appendChild(bar);
  }

  /* ═════════ init ═════════ */
  loadPins();
  fillSelects();
  buildCatGrid();
  bind();
  var room = localStorage.getItem(LS.lastRoom);
  if (ROOMS.indexOf(room) === -1) room = ROOMS[0];
  switchRoom(room);
  renderBanners();
  flushQueue(true);
  checkForUpdate();
  registerCatalog();
})();
