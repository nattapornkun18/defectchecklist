/*
 * lock.js — หน้าใส่รหัสก่อนเข้าใช้งาน
 *
 * รหัสไม่ได้เก็บอยู่ในไฟล์นี้ (ไฟล์นี้เป็น public) แต่เก็บไว้ที่ Apps Script
 * หน้าเว็บแค่ส่งรหัสไปให้ตรวจ ถ้าผิดจะไม่ได้ข้อมูลอะไรกลับมาเลย
 *
 * มี 2 ระดับ:
 *   inspector — กรอกผลตรวจและบันทึกได้อย่างเดียว
 *   admin     — ดูหน้าสรุป ดึงข้อมูลกลับ และสั่งสร้างชีทสรุปได้ด้วย
 *
 * ตั้งรหัสได้จากในชีท: เมนู Defect Checklist → ตั้งรหัสเข้าใช้งาน
 */
(function () {
  'use strict';

  var K_PIN = 'dc:pin';
  var K_ROLE = 'dc:role';

  var required = (typeof REQUIRE_PIN === 'boolean') ? REQUIRE_PIN : false;
  var len = (typeof PIN_LENGTH === 'number') ? PIN_LENGTH : 4;
  var waiting = [];
  var unlocked = false;

  function pin() { return localStorage.getItem(K_PIN) || ''; }
  function role() { return localStorage.getItem(K_ROLE) || ''; }

  function apiUrl() {
    var o = (localStorage.getItem('dc:apiUrl') || '').trim();
    return o || (typeof API_URL === 'string' ? API_URL.trim() : '');
  }

  function post(payload) {
    return fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
      redirect: 'follow',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* ═════════ หน้าจอใส่รหัส ═════════ */
  var el, dots, buf = '', busy = false;

  function build() {
    el = document.createElement('div');
    el.className = 'lock';
    el.innerHTML =
      '<div class="lock-box">' +
        '<div class="lock-bar"></div>' +
        '<div class="lock-title"></div>' +
        '<div class="lock-sub">ใส่รหัสเพื่อเข้าใช้งาน</div>' +
        '<div class="lock-dots"></div>' +
        '<div class="lock-pad"></div>' +
        '<div class="lock-msg" aria-live="polite"></div>' +
      '</div>';

    el.querySelector('.lock-title').textContent =
      (typeof ROOM_TYPE === 'string' ? ROOM_TYPE : 'Defect Checklist');

    dots = el.querySelector('.lock-dots');
    for (var i = 0; i < len; i++) dots.appendChild(document.createElement('span'));

    var pad = el.querySelector('.lock-pad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'lock-key' + (k === 'del' || k === 'ok' ? ' lock-key-alt' : '');
      b.textContent = k === 'del' ? 'ลบ' : k === 'ok' ? 'ตกลง' : k;
      b.addEventListener('click', function () { press(k); });
      pad.appendChild(b);
    });

    document.body.appendChild(el);
    document.addEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (!el || unlocked) return;
    if (e.key >= '0' && e.key <= '9') press(e.key);
    else if (e.key === 'Backspace') press('del');
    else if (e.key === 'Enter') press('ok');
  }

  function press(k) {
    if (busy) return;
    msg('');
    if (k === 'del') buf = buf.slice(0, -1);
    else if (k === 'ok') { submit(); return; }
    else if (buf.length < len) buf += k;
    paint();
    if (buf.length === len) submit();
  }

  function paint() {
    dots.querySelectorAll('span').forEach(function (s, i) {
      s.classList.toggle('on', i < buf.length);
    });
  }

  function msg(text, kind) {
    var m = el.querySelector('.lock-msg');
    m.textContent = text || '';
    m.className = 'lock-msg' + (kind ? ' ' + kind : '');
  }

  function submit() {
    if (busy || !buf) return;
    busy = true;
    msg('กำลังตรวจสอบ…');

    post({ action: 'auth', pin: buf, expectPin: true }).then(function (r) {
      if (!r || r.ok !== true) throw new Error((r && r.error) || 'รหัสไม่ถูกต้อง');
      localStorage.setItem(K_PIN, buf);
      localStorage.setItem(K_ROLE, r.role || 'inspector');
      open();
    }).catch(function (err) {
      busy = false;
      buf = '';
      paint();
      el.querySelector('.lock-box').classList.remove('shake');
      void el.offsetWidth;
      el.querySelector('.lock-box').classList.add('shake');
      msg(/HTTP|Failed|NetworkError/.test(err.message)
        ? 'ต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสัญญาณแล้วลองใหม่'
        : err.message || 'รหัสไม่ถูกต้อง', 'err');
    });
  }

  function open() {
    unlocked = true;
    document.body.classList.remove('locked');
    document.removeEventListener('keydown', onKey);
    if (el) { el.remove(); el = null; }
    document.body.classList.add('role-' + (role() || 'inspector'));
    waiting.splice(0).forEach(function (cb) { cb(role()); });
  }

  /* ═════════ API ═════════ */
  window.DCAuth = {
    pin: pin,
    role: role,
    isAdmin: function () { return role() === 'admin'; },

    /** เรียก cb เมื่อปลดล็อกแล้ว (ถ้าไม่ได้เปิดใช้รหัสจะเรียกทันที) */
    ready: function (cb) {
      if (unlocked) cb(role());
      else waiting.push(cb);
    },

    /** ใส่รหัสลงใน payload ทุกครั้งที่ยิงไป Apps Script */
    sign: function (payload) {
      var p = pin();
      if (p) payload.pin = p;
      return payload;
    },

    logout: function () {
      localStorage.removeItem(K_PIN);
      localStorage.removeItem(K_ROLE);
      location.reload();
    },
  };

  /* ═════════ เริ่มทำงาน ═════════ */
  if (!required) { unlocked = true; document.body.classList.add('role-admin'); return; }

  if (pin()) {
    // เคยใส่รหัสไว้แล้ว — ให้เข้าได้เลย (ออฟไลน์ก็ยังทำงานได้)
    // ฝั่ง Apps Script ตรวจรหัสทุกครั้งอยู่แล้ว รหัสเก่าที่ถูกยกเลิกจะใช้ไม่ได้เอง
    unlocked = true;
    document.body.classList.add('role-' + (role() || 'inspector'));
  } else {
    var lockBody = function () { document.body.classList.add('locked'); build(); };
    document.addEventListener('DOMContentLoaded', lockBody);
    if (document.readyState !== 'loading') lockBody();
  }
})();
