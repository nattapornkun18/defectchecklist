/* tag.js — เครื่องมือตั้งพิกัดหมุดบนรูปอ้างอิง (ทำครั้งเดียว) */
(function () {
  'use strict';

  var KEY = 'dc:pins';
  var $ = function (id) { return document.getElementById(id); };

  var cat = CATEGORIES[0];
  var store = load();

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); }
    catch (e) { toast('พื้นที่เก็บในเครื่องเต็ม', 'err'); }
  }

  function pinsOf(id) {
    if (!store[id]) store[id] = [];
    return store[id];
  }

  /** จุดถัดไปที่ยังไม่ได้ตั้งพิกัด */
  function nextItem() {
    var done = {};
    pinsOf(cat.id).forEach(function (p) { done[p.no] = 1; });
    for (var i = 0; i < cat.items.length; i++) {
      if (!done[cat.items[i].no]) return cat.items[i];
    }
    return null;
  }

  function fillCats() {
    CATEGORIES.forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.no + '. ' + c.th + ' (' + c.name + ') — ' + c.items.length + ' จุด';
      $('fCat').appendChild(o);
    });
    $('fCat').addEventListener('change', function () {
      cat = CATEGORIES.filter(function (c) { return c.id === this.value; }, this)[0] ||
            CATEGORIES.filter(function (c) { return c.id === $('fCat').value; })[0];
      selectCat();
    });
  }

  function selectCat() {
    $('img').src = cat.img;
    $('sub').textContent = cat.no + '. ' + cat.th + ' · ' + cat.name;
    render();
  }

  function render() {
    var pins = pinsOf(cat.id);
    var stage = $('stage');
    stage.querySelectorAll('.tag-pin').forEach(function (p) { p.remove(); });

    var nxt = nextItem();
    pins.filter(function (p) { return p.x >= 0 && p.y >= 0; }).forEach(function (p) {
      var el = document.createElement('div');
      el.className = 'tag-pin';
      el.style.left = (p.x * 100) + '%';
      el.style.top = (p.y * 100) + '%';
      el.textContent = p.no;
      stage.appendChild(el);
    });

    $('curNo').textContent = nxt ? 'แตะที่หมายเลข ' + nxt.no : '✓ ครบแล้ว';
    $('curText').textContent = nxt ? nxt.th : 'หมวดนี้ตั้งพิกัดครบทุกจุดแล้ว';
    $('curCount').textContent = 'ตั้งแล้ว ' + pins.length + ' / ' + cat.items.length + ' จุด';

    $('bar').style.width = (pins.length / cat.items.length * 100) + '%';
    var totalDone = CATEGORIES.reduce(function (a, c) { return a + pinsOf(c.id).length; }, 0);
    $('legend').innerHTML = '<span>หมวดนี้ ' + pins.length + '/' + cat.items.length + '</span>' +
      '<span>รวมทุกหมวด ' + totalDone + '/' + TOTAL_ITEMS + '</span>';

    $('out').value = codeFor();
  }

  function codeFor() {
    var lines = [];
    CATEGORIES.forEach(function (c) {
      var pins = pinsOf(c.id);
      if (!pins.length) return;
      var body = pins.slice().sort(function (a, b) { return a.no - b.no; }).map(function (p) {
        return '{ no: ' + p.no + ', x: ' + p.x.toFixed(4) + ', y: ' + p.y.toFixed(4) + ' }';
      }).join(', ');
      lines.push('// ' + c.no + '. ' + c.th + ' (' + c.name + ')');
      lines.push("// วางทับบรรทัด  pins: [],  ของหมวด id: '" + c.id + "'");
      lines.push('pins: [' + body + '],');
      lines.push('');
    });
    return lines.length ? lines.join('\n')
      : '// ยังไม่มีพิกัดที่ตั้งไว้ — แตะบนรูปเพื่อเริ่ม';
  }

  function place(ev) {
    var nxt = nextItem();
    if (!nxt) { toast('หมวดนี้ครบแล้ว', 'ok'); return; }
    var img = $('img');
    var r = img.getBoundingClientRect();
    var x = (ev.clientX - r.left) / r.width;
    var y = (ev.clientY - r.top) / r.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    pinsOf(cat.id).push({ no: nxt.no, x: x, y: y });
    save();
    render();
  }

  var toastTimer = null;
  function toast(msg, kind) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 2500);
  }

  function bind() {
    $('img').addEventListener('click', place);

    $('btnUndo').addEventListener('click', function () {
      var pins = pinsOf(cat.id);
      if (!pins.length) { toast('ยังไม่มีจุดให้ย้อนกลับ'); return; }
      pins.pop();
      save();
      render();
    });

    $('btnSkip').addEventListener('click', function () {
      var nxt = nextItem();
      if (!nxt) return;
      // ใส่พิกัดนอกกรอบไว้เป็นตัวคั่น แล้วลบทิ้งตอน export
      pinsOf(cat.id).push({ no: nxt.no, x: -1, y: -1 });
      save();
      render();
      toast('ข้ามข้อ ' + nxt.no + ' แล้ว');
    });

    $('btnClear').addEventListener('click', function () {
      if (!confirm('ล้างพิกัดทั้งหมดของหมวด ' + cat.th + '?')) return;
      store[cat.id] = [];
      save();
      render();
    });

    $('btnCopy').addEventListener('click', function () {
      var out = $('out');
      out.select();
      out.setSelectionRange(0, out.value.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(out.value).then(function () {
          toast('คัดลอกแล้ว — ไปวางใน js/checklist.js', 'ok');
        }, function () {
          toast(ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ กรุณาเลือกข้อความเอง', ok ? 'ok' : 'err');
        });
      } else {
        toast(ok ? 'คัดลอกแล้ว' : 'คัดลอกไม่สำเร็จ กรุณาเลือกข้อความเอง', ok ? 'ok' : 'err');
      }
    });
  }

  // พิกัดที่ถูกข้าม (-1) ไม่ควรถูก export ออกไป
  var origCode = codeFor;
  codeFor = function () {
    CATEGORIES.forEach(function (c) {
      store[c.id] = pinsOf(c.id);
    });
    var saved = {};
    CATEGORIES.forEach(function (c) {
      saved[c.id] = store[c.id];
      store[c.id] = store[c.id].filter(function (p) { return p.x >= 0 && p.y >= 0; });
    });
    var out = origCode();
    CATEGORIES.forEach(function (c) { store[c.id] = saved[c.id]; });
    return out;
  };

  fillCats();
  bind();
  selectCat();
})();
