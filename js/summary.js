/* summary.js — หน้าสรุปผลตรวจ ดึงข้อมูลจาก Google Sheet มาทำตารางรวม */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var all = [];        // ผลตรวจทั้งหมดที่ดึงมาจากชีท

  function apiUrl() {
    var override = (localStorage.getItem('dc:apiUrl') || '').trim();
    return override || (typeof API_URL === 'string' ? API_URL.trim() : '');
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      if (!d || d.ok !== true) throw new Error((d && d.error) || 'ปลายทางตอบกลับผิดพลาด');
      return d;
    });
  }

  /* ═════════ โหลดข้อมูล ═════════ */
  function load() {
    var url = apiUrl();
    if (!url) {
      banner('warn', 'ยังไม่ได้ตั้งค่า Web App URL — เปิดหน้าฟอร์มแล้วกดปุ่ม ⚙ เพื่อตั้งค่าก่อน');
      $('sub').textContent = 'ยังไม่ได้เชื่อมต่อ';
      return;
    }
    $('sub').textContent = 'กำลังโหลด…';
    banner();
    postJson(url, { action: 'summary' }).then(function (res) {
      all = res.inspections || [];
      if (!all.length) {
        $('sub').textContent = 'ยังไม่มีข้อมูล';
        $('tables').innerHTML = '<div class="card empty"><div class="big">📋</div>' +
          'ยังไม่มีผลตรวจในชีท<br>ไปที่หน้าฟอร์ม ตรวจแล้วกดบันทึกก่อน</div>';
        return;
      }
      initFilters();
      render();
    }).catch(function (err) {
      $('sub').textContent = 'โหลดไม่สำเร็จ';
      banner('warn', 'ดึงข้อมูลไม่สำเร็จ: ' + err.message +
        ' — ถ้าเพิ่งแก้ Code.gs ต้อง Deploy → Manage deployments → New version ก่อน');
    });
  }

  function banner(kind, msg) {
    var w = $('banners');
    w.textContent = '';
    if (!kind) return;
    var b = document.createElement('div');
    b.className = 'banner ' + kind;
    b.innerHTML = '<span>⚠️</span><span></span>';
    b.querySelector('span:last-child').textContent = msg;
    w.appendChild(b);
  }

  /* ═════════ ตัวกรอง ═════════ */
  function initFilters() {
    var rounds = [], dates = [];
    all.forEach(function (i) {
      if (i.round && rounds.indexOf(i.round) === -1) rounds.push(i.round);
      if (i.date) dates.push(i.date);
    });
    var sel = $('fRound');
    sel.length = 1;
    rounds.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r; o.textContent = r;
      sel.appendChild(o);
    });
    dates.sort();
    $('fFrom').value = dates[0] || '';
    $('fTo').value = dates[dates.length - 1] || '';
    $('filterCard').hidden = false;

    ['fRound', 'fFrom', 'fTo', 'fMode'].forEach(function (id) {
      $(id).addEventListener('change', render);
    });
  }

  function filtered() {
    var round = $('fRound').value, from = $('fFrom').value, to = $('fTo').value;
    return all.filter(function (i) {
      if (round && i.round !== round) return false;
      if (from && i.date && i.date < from) return false;
      if (to && i.date && i.date > to) return false;
      return true;
    });
  }

  /** ถ้าห้องเดียวกันมีหลายรอบ/หลายวัน ให้เอาครั้งที่บันทึกล่าสุด */
  function latestPerRoom(list) {
    var by = {};
    list.forEach(function (i) {
      var cur = by[i.room];
      if (!cur || String(i.savedAt) > String(cur.savedAt)) by[i.room] = i;
    });
    return Object.keys(by).sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return by[k]; });
  }

  /* ═════════ นับจำนวน ═════════ */
  function mode() { return $('fMode').value; }

  function catValue(insp, catName) {
    var c = insp.cats && insp.cats[catName];
    if (!c) return 0;
    var m = mode();
    // ทุกโหมดนับเป็น "จำนวนจุดที่พบ" เหมือนกัน เพื่อให้เทียบกันได้ตรง ๆ
    if (m === 'return') return c.retQty != null ? c.retQty : c.ret;
    if (m === 'fix') return c.fixQty != null ? c.fixQty : c.fix;
    return c.qty || (c.ret + c.fix);
  }

  /** คอลัมน์ = หมวดตามฟอร์ม แล้วต่อท้ายด้วยหมวดอื่นที่เจอในชีทแต่ไม่มีในฟอร์ม */
  function columnsFor(list) {
    var cols = CATEGORIES.map(function (c) { return { name: c.name, th: c.th }; });
    var known = {};
    cols.forEach(function (c) { known[c.name] = 1; });
    list.forEach(function (i) {
      Object.keys(i.cats || {}).forEach(function (n) {
        if (!known[n]) { known[n] = 1; cols.push({ name: n, th: n }); }
      });
    });
    return cols;
  }

  /* ═════════ วาด ═════════ */
  function render() {
    var list = latestPerRoom(filtered());
    var cols = columnsFor(list);

    $('sub').textContent = list.length + ' ห้อง · ' +
      ($('fRound').value || 'ทุกรอบ');
    $('filterNote').textContent = list.length
      ? 'แสดงผลตรวจครั้งล่าสุดของแต่ละห้องในช่วงที่เลือก · ' +
        (mode() === 'all' ? 'นับทั้ง ส่งคืน และ แก้เอง'
         : mode() === 'return' ? 'นับเฉพาะจำนวนจุดที่ส่งคืน' : 'นับเฉพาะจำนวนจุดที่แก้เอง')
      : 'ไม่มีข้อมูลในช่วงที่เลือก';

    renderTiles(list, cols);
    renderTables(list, cols);
    $('legendCard').hidden = list.length === 0;
  }

  function rowTotal(insp, cols) {
    return cols.reduce(function (s, c) { return s + catValue(insp, c.name); }, 0);
  }

  function renderTiles(list, cols) {
    var wrap = $('tiles');
    if (!list.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    var totals = list.map(function (i) { return rowTotal(i, cols); });
    var sum = totals.reduce(function (a, b) { return a + b; }, 0);
    var worstIdx = totals.indexOf(Math.max.apply(null, totals));
    var pts = list.reduce(function (a, i) { return a + (i.total || TOTAL_ITEMS); }, 0);

    // หมวดที่พบ defect รวมเยอะสุด
    var byCat = {};
    cols.forEach(function (c) {
      byCat[c.name] = list.reduce(function (a, i) { return a + catValue(i, c.name); }, 0);
    });
    var worstCat = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
    var worstCatTh = (cols.filter(function (c) { return c.name === worstCat; })[0] || {}).th || worstCat;

    wrap.innerHTML =
      tile('ห้องที่ตรวจแล้ว', list.length + ' ห้อง', 'จาก ' + ROOMS.length + ' ห้องทั้งหมด') +
      tile('จุดที่พบ defect', String(sum), pts ? (sum / pts * 100).toFixed(2) + '% ของจุดตรวจทั้งหมด' : '', true) +
      tile('เฉลี่ยต่อห้อง', (sum / list.length).toFixed(1) + ' จุด',
           'มากสุด ' + list[worstIdx].room + ' (' + totals[worstIdx] + ' จุด)') +
      tile('หมวดที่พบมากสุด', worstCatTh, byCat[worstCat] + ' จุด รวมทุกห้อง');
  }

  function tile(k, v, s, bad) {
    return '<div class="tile"><div class="k">' + esc(k) + '</div>' +
      '<div class="v' + (bad ? ' bad' : '') + '">' + esc(v) + '</div>' +
      '<div class="s">' + esc(s || '') + '</div></div>';
  }

  function renderTables(list, cols) {
    var wrap = $('tables');
    wrap.textContent = '';
    if (!list.length) {
      wrap.innerHTML = '<div class="card empty">ไม่มีข้อมูลในช่วงวันที่ที่เลือก</div>';
      return;
    }

    // แยกกลุ่มตาม room type เหมือนในชีทเดิม
    var groups = {}, order = [];
    list.forEach(function (i) {
      var k = i.roomType || '(ไม่ระบุ room type)';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(i);
    });

    // สเกลสีคิดจากค่าสูงสุดของทั้งหน้า เพื่อให้เทียบข้ามกลุ่มได้
    var max = 0;
    list.forEach(function (i) {
      cols.forEach(function (c) { max = Math.max(max, catValue(i, c.name)); });
    });

    order.forEach(function (k) {
      wrap.appendChild(tableFor(k, groups[k], cols, max));
    });
  }

  function tableFor(roomType, list, cols, max) {
    var card = document.createElement('div');
    card.className = 'tbl-card';

    var totals = list.map(function (i) { return rowTotal(i, cols); });
    var groupSum = totals.reduce(function (a, b) { return a + b; }, 0);

    var h = '<div class="tbl-head"><h2>' + esc(roomType) + '</h2>' +
      '<span class="meta">' + list.length + ' ห้อง · พบรวม ' + groupSum + ' จุด</span></div>' +
      '<div class="tbl-scroll"><table class="sum"><thead><tr>' +
      '<th class="room">ห้อง</th><th>รวม</th><th>%</th>' +
      cols.map(function (c) { return '<th title="' + esc(c.name) + '">' + esc(c.th) + '</th>'; }).join('') +
      '<th>วันที่</th><th>ผู้ตรวจ</th></tr></thead><tbody>';

    list.forEach(function (i, idx) {
      var tot = totals[idx];
      var pts = i.total || TOTAL_ITEMS;
      h += '<tr><td class="room' + (tot ? ' has' : '') + '" data-i="' + idx + '">' + esc(i.room) + '</td>' +
        '<td class="num total' + (tot ? ' has' : '') + '" data-i="' + idx + '">' + tot + '</td>' +
        '<td class="num pct">' + (pts ? (tot / pts * 100).toFixed(2) : '0') + '%</td>' +
        cols.map(function (c) {
          var v = catValue(i, c.name);
          var lvl = level(v, max);
          var cc = i.cats && i.cats[c.name];
          return '<td class="num cell' + (lvl >= 5 ? ' hot' : '') + (v ? ' has' : ' zero') + '"' +
            ' style="background:var(--heat-' + lvl + ')"' +
            ' data-i="' + idx + '" data-cn="' + esc(c.name) + '"' +
            ' data-room="' + esc(i.room) + '" data-cat="' + esc(c.th) + '"' +
            ' data-ret="' + ((cc && cc.ret) || 0) + '" data-fix="' + ((cc && cc.fix) || 0) + '"' +
            ' data-qty="' + ((cc && cc.qty) || 0) + '">' + (v || '–') + '</td>';
        }).join('') +
        '<td>' + esc(i.date || '—') + '</td><td>' + esc(i.inspector || '—') + '</td></tr>';
    });

    // แถวรวมทั้งกลุ่ม
    h += '<tr class="grand"><td class="room">รวมทั้งกลุ่ม</td>' +
      '<td class="num">' + groupSum + '</td><td></td>' +
      cols.map(function (c) {
        var s = list.reduce(function (a, i) { return a + catValue(i, c.name); }, 0);
        return '<td class="num">' + (s || '–') + '</td>';
      }).join('') + '<td></td><td></td></tr>';

    card.innerHTML = h + '</tbody></table></div>';
    bindTips(card);
    bindDrill(card, list);
    return card;
  }

  /** แบ่งค่าเป็น 0–6 ระดับความเข้ม (0 = ไม่พบเลย) */
  function level(v, max) {
    if (!v) return 0;
    if (max <= 1) return 3;
    var f = v / max;
    return f <= 0.10 ? 1 : f <= 0.25 ? 2 : f <= 0.45 ? 3 : f <= 0.65 ? 4 : f <= 0.85 ? 5 : 6;
  }

  /* ═════════ กดดูรายจุดที่ต้องแก้ ═════════ */
  var detailCache = {};      // inspectionId -> items[]

  /** หาข้อความจุดตรวจจาก checklist.js ด้วยชื่อหมวด + เลขข้อ */
  function itemText(catName, no) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (CATEGORIES[i].name !== catName) continue;
      var found = CATEGORIES[i].items.filter(function (x) { return x.no === Number(no); })[0];
      return found ? found.th : '(ไม่มีข้อ ' + no + ' ในฟอร์มปัจจุบัน)';
    }
    return '(ไม่มีหมวด ' + catName + ' ในฟอร์มปัจจุบัน)';
  }

  function catThOf(catName) {
    var c = CATEGORIES.filter(function (x) { return x.name === catName; })[0];
    return c ? c.th : catName;
  }

  /** เปิดกล่องรายละเอียด — catName ว่าง = แสดงทุกหมวดของห้องนั้น */
  function openDetail(insp, catName) {
    $('dTitle').textContent = 'ห้อง ' + insp.room +
      (catName ? ' · ' + catThOf(catName) : ' · ทุกหมวด');
    $('dMeta').textContent = [insp.roomType, insp.round, insp.date,
      insp.inspector ? 'ผู้ตรวจ ' + insp.inspector : ''].filter(Boolean).join(' · ');
    $('dBody').innerHTML = '<div class="loading">กำลังโหลดรายละเอียด…</div>';
    $('dSum').textContent = '';
    $('dlgDetail').showModal();

    var cached = detailCache[insp.inspectionId];
    if (cached) { paintDetail(cached, catName); return; }

    postJson(apiUrl(), { action: 'load', inspectionId: insp.inspectionId })
      .then(function (res) {
        var items = (res && res.items) || [];
        detailCache[insp.inspectionId] = items;
        paintDetail(items, catName);
      })
      .catch(function (err) {
        $('dBody').innerHTML = '<div class="loading">โหลดรายละเอียดไม่สำเร็จ<br>' + esc(err.message) + '</div>';
      });
  }

  function paintDetail(items, catName) {
    var m = mode();
    var list = items.filter(function (it) {
      if (it.result !== 'return' && it.result !== 'fix') return false;
      if (catName && it.cat !== catName) return false;
      if (m === 'return' && it.result !== 'return') return false;
      if (m === 'fix' && it.result !== 'fix') return false;
      return true;
    });

    if (!list.length) {
      $('dBody').innerHTML = '<div class="loading">ไม่มีจุดที่ต้องแก้ในส่วนนี้</div>';
      $('dSum').textContent = '';
      return;
    }

    // จัดกลุ่มตามหมวด เรียงตามลำดับหมวดในฟอร์ม แล้วเรียงตามเลขข้อ
    var order = CATEGORIES.map(function (c) { return c.name; });
    var groups = {};
    list.forEach(function (it) { (groups[it.cat] || (groups[it.cat] = [])).push(it); });
    var names = Object.keys(groups).sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var html = '', ret = 0, fix = 0, qty = 0;
    names.forEach(function (n) {
      var g = groups[n].sort(function (a, b) { return a.no - b.no; });
      html += '<div class="d-group"><h4>' + esc(catThOf(n)) + ' · ' + g.length + ' จุด</h4>';
      g.forEach(function (it) {
        var q = Math.max(1, it.qty || 1);
        if (it.result === 'return') { ret++; } else { fix++; }
        qty += q;
        html += '<div class="d-item r-' + it.result + '">' +
          '<span class="no">' + it.no + '</span>' +
          '<span class="body"><span class="txt">' + esc(itemText(n, it.no)) + '</span>' +
          '<span class="sub"><span class="tag">' +
            (it.result === 'return' ? '↩ ส่งคืน' : '🔧 แก้เอง') + '</span>' +
            ' · จำนวน ' + q + ' จุด</span>' +
          (it.note ? '<div class="note">' + esc(it.note) + '</div>' : '') +
          (it.photos && it.photos.length
            ? '<div class="pics">' + it.photos.map(function (u, i) {
                return '<a href="' + esc(u) + '" target="_blank" rel="noopener">📷 รูป ' + (i + 1) + '</a>';
              }).join('') + '</div>'
            : '') +
          '</span></div>';
      });
      html += '</div>';
    });

    $('dBody').innerHTML = html;
    $('dSum').textContent = 'ส่งคืน ' + ret + ' · แก้เอง ' + fix + ' · รวม ' + qty + ' จุด';
  }

  function bindDrill(root, list) {
    root.querySelectorAll('td.has').forEach(function (td) {
      td.addEventListener('click', function () {
        var insp = list[Number(td.dataset.i)];
        if (!insp) return;
        openDetail(insp, td.dataset.cn || '');
      });
    });
  }

  /* ═════════ tooltip ═════════ */
  function bindTips(root) {
    var tip = $('tip');
    root.querySelectorAll('td.cell').forEach(function (td) {
      td.addEventListener('pointerenter', function () {
        var ret = Number(td.dataset.ret), fix = Number(td.dataset.fix), qty = Number(td.dataset.qty);
        if (!ret && !fix) {
          tip.innerHTML = '<b>ห้อง ' + esc(td.dataset.room) + ' · ' + esc(td.dataset.cat) + '</b><br>ไม่พบ defect';
        } else {
          tip.innerHTML = '<b>ห้อง ' + esc(td.dataset.room) + ' · ' + esc(td.dataset.cat) + '</b><br>' +
            '<span class="r">ส่งคืน ' + ret + ' รายการ</span><br>' +
            '<span class="f">แก้เอง ' + fix + ' รายการ</span><br>' +
            'รวมจำนวนจุดที่พบ ' + qty;
        }
        tip.hidden = false;
        place(tip, td);
      });
      td.addEventListener('pointerleave', function () { tip.hidden = true; });
    });
  }

  function place(tip, el) {
    var r = el.getBoundingClientRect();
    var w = tip.offsetWidth, h = tip.offsetHeight;
    var x = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    var y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
  $('dClose').addEventListener('click', function () { $('dlgDetail').close(); });
  $('dOk').addEventListener('click', function () { $('dlgDetail').close(); });
  $('dPrint').addEventListener('click', function () { window.print(); });
  $('btnReload').addEventListener('click', load);
  checkForUpdate();
  $('btnPrint').addEventListener('click', function () { window.print(); });
  load();
})();
