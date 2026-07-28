/*
 * config.js — ค่าตั้งต้นของระบบ (แก้ที่นี่ที่เดียว ใช้กับทุกเครื่อง)
 *
 * ตั้งค่าไว้ที่นี่แล้ว ผู้ตรวจ "ไม่ต้องกรอกอะไรเลย" แค่เปิดลิงก์ก็ใช้ได้ทันที
 * ไม่ต้องเข้าเมนู ⚙ ไม่ต้องวาง URL ซ้ำในมือถือแต่ละเครื่อง
 */

/**
 * Web App URL จาก Apps Script (ต้องลงท้ายด้วย /exec)
 *
 * วิธีได้มา: Google Sheet → Extensions → Apps Script → Deploy →
 *            New deployment → Web app (Execute as: Me, Who has access: Anyone)
 *
 * ⚠️ ทุกครั้งที่แก้ Code.gs ต้อง Deploy → Manage deployments → ✏️ →
 *    Version: New version → Deploy  ถึงจะมีผล และ URL จะ "ไม่เปลี่ยน"
 *    (ถ้ากด New deployment ใหม่ทั้งอัน URL จะเปลี่ยน ต้องมาแก้บรรทัดล่างนี้ด้วย)
 */
const API_URL = 'https://script.google.com/macros/s/AKfycbwetfvrw9drmuokkQvz5DQIQlmCmlq33uIv9xWSEfA3cymC37JuUcREdtgpWLb8SNQ/exec';

/** ส่งรูปถ่ายขึ้น Google Drive ด้วยหรือไม่ (ผู้ใช้เปลี่ยนเองรายเครื่องได้ในเมนู ⚙) */
const UPLOAD_PHOTOS_DEFAULT = true;

/**
 * เลขเวอร์ชันของไฟล์ static (รูป / css / js)
 *
 * ⚠️ ทุกครั้งที่เปลี่ยนรูปใน img/ หรือแก้ checklist.js ให้ +1 ที่นี่
 *    แล้วแก้เลข ?v= ใน index.html กับ tag.html ให้ตรงกันด้วย
 *
 * ถ้าไม่บวก เบราว์เซอร์ของผู้ตรวจจะยังใช้รูปเก่าที่ cache ไว้ มองไม่เห็นของใหม่
 * เลขนี้แสดงในเมนู ⚙ ด้วย จะได้เช็คได้ว่าเครื่องนั้นอัปเดตแล้วหรือยัง
 */
const ASSET_VERSION = '12';

/**
 * บังคับใส่รหัสก่อนเข้าใช้งานหรือไม่
 *
 * ต้องตั้งรหัสในชีทก่อน (เมนู Defect Checklist → 🔑 ตั้งรหัสเข้าใช้งาน)
 * แล้วค่อยเปลี่ยนค่านี้เป็น true — ถ้าเปิดก่อนตั้งรหัส จะใส่รหัสอะไรก็ผ่านหมด
 *
 * ตัวรหัสไม่ได้อยู่ในไฟล์นี้ (ไฟล์นี้เป็น public) แต่อยู่ที่ Apps Script
 */
const REQUIRE_PIN = true;

/** ความยาวรหัส (จำนวนวงกลมบนหน้าจอ) */
const PIN_LENGTH = 3;
