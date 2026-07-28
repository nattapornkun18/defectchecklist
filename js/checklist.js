/*
 * checklist.js — ข้อมูลรายการตรวจ (แก้ไขไฟล์นี้ไฟล์เดียวเพื่อเปลี่ยนเนื้อหาฟอร์ม)
 *
 * โครงสร้าง:
 *   ROOM_TYPE  ชื่อ room type ที่แสดงบนหัวฟอร์ม
 *   ROOMS      รายชื่อห้องที่ใช้ฟอร์มนี้
 *   ROUNDS     รอบการตรวจ
 *   ZONES      โซนบนแปลนห้อง แต่ละโซนมีหมุด (pin) บนแปลน + รายการตรวจ (items)
 *
 * pin: {x, y} คือพิกัดหมุดบนแปลนห้อง อ้างอิงระบบพิกัด SVG viewBox "0 0 420 660"
 *      (x = 0 ซ้ายสุด → 420 ขวาสุด, y = 0 บนสุด → 660 ล่างสุด)
 *
 * items: แต่ละรายการเป็น { th: 'ภาษาไทย', en: 'English' }
 *        ลำดับในอาเรย์คือเลขข้อที่แสดงในฟอร์มและที่บันทึกลง Google Sheet
 */

const ROOM_TYPE = 'Deluxe King — Right';

// ห้องที่ลงท้ายด้วย 10 ตั้งแต่ชั้น 3 ถึงชั้น 20
const ROOMS = Array.from({ length: 18 }, (_, i) => String(i + 3) + '10');

const ROUNDS = [
  'Pre-inspection',
  'Snag list #1',
  'Snag list #2',
  'Re-check',
  'Final / Handover',
];

const ZONES = [
  {
    id: 'door',
    name: 'ประตูทางเข้า',
    en: 'Entrance Door',
    pin: { x: 78, y: 612 },
    items: [
      { th: 'บานประตู — รอยขีดข่วน / สีถลอก / บวมน้ำ', en: 'Door leaf — scratches / peeling / swelling' },
      { th: 'วงกบ & ซับวงกบ — ระยะห่างเท่ากัน ไม่บิดเบี้ยว', en: 'Door frame & architrave — even gap, not warped' },
      { th: 'มือจับ & ชุดล็อก — แน่น ไม่คลอน ล็อกได้สนิท', en: 'Handle & lockset — firm, locks properly' },
      { th: 'Key card reader — อ่านบัตรได้ ไฟสถานะปกติ', en: 'Key card reader — reads card, status light OK' },
      { th: 'Door closer — ปิดสนิท ไม่กระแทก ไม่มีน้ำมันรั่ว', en: 'Door closer — closes fully, no slam, no oil leak' },
      { th: 'กลอน / โซ่นิรภัย — ใช้งานได้', en: 'Deadbolt / safety latch — functional' },
      { th: 'ตาแมว — มองเห็นชัด ไม่ขุ่น', en: 'Peephole — clear view' },
      { th: 'ธรณีประตู & ยางกันเสียง — ติดแน่น ไม่มีช่องแสงลอด', en: 'Threshold & seal — fitted, no light gap' },
      { th: 'ป้ายหมายเลขห้อง & ป้ายผังหนีไฟ — ติดตรง ถูกต้อง', en: 'Room number & fire escape plan — aligned, correct' },
      { th: 'ที่แขวนป้าย DND — ครบและใช้งานได้', en: 'DND hanger — present and usable' },
    ],
  },
  {
    id: 'foyer',
    name: 'โถงทางเข้า & ตู้เสื้อผ้า',
    en: 'Foyer & Wardrobe',
    pin: { x: 96, y: 512 },
    items: [
      { th: 'ฝ้าเพดาน — รอยต่อเรียบ ไม่มีคราบน้ำ ไม่แตกร้าว', en: 'Ceiling — even joints, no water stain, no crack' },
      { th: 'ผนัง / วอลเปเปอร์ — ไม่มีรอยต่อโป่ง ฟองอากาศ หรือรอยเปื้อน', en: 'Wall / wallpaper — no bubbles, lifting seams or stains' },
      { th: 'พื้น — ระดับเรียบ ไม่มีเสียงดัง ยาแนวเต็มร่อง', en: 'Floor — level, no squeak, grout complete' },
      { th: 'บัวพื้น — ติดแนบผนัง ไม่มีช่องว่าง', en: 'Skirting — flush to wall, no gaps' },
      { th: 'ดาวน์ไลท์ — ติดทุกดวง สีไฟเท่ากัน ไม่กระพริบ', en: 'Downlights — all working, matching colour, no flicker' },
      { th: 'สวิตช์ไฟทางเข้า & ช่องเสียบบัตร — ทำงานถูกต้อง', en: 'Entry switch & key card holder — functions correctly' },
      { th: 'บานตู้เสื้อผ้า — เลื่อน/เปิดลื่น ระยะห่างเท่ากัน', en: 'Wardrobe doors — smooth, even gaps' },
      { th: 'ราวแขวน & ไม้แขวนเสื้อ — แน่น ครบจำนวน', en: 'Hanging rail & hangers — secure, correct quantity' },
      { th: 'ชั้นวางในตู้ & ไฟในตู้ — ติดแน่น ไฟติด', en: 'Wardrobe shelves & internal light — secure, light works' },
      { th: 'ตู้เซฟ — เปิด-ปิด ตั้งรหัส และรีเซ็ตได้', en: 'Safe box — opens, sets and resets code' },
      { th: 'มินิบาร์ / ตู้เย็น — ทำความเย็น ไม่มีเสียงดัง ยางขอบสนิท', en: 'Minibar / fridge — cools, quiet, gasket seals' },
      { th: 'ถาดกาแฟ / กาต้มน้ำ & ปลั๊ก — ครบและใช้งานได้', en: 'Coffee tray / kettle & socket — complete and working' },
    ],
  },
  {
    id: 'bath',
    name: 'ห้องน้ำ',
    en: 'Bathroom',
    pin: { x: 288, y: 528 },
    items: [
      { th: 'ประตูห้องน้ำ / บานกระจก — เปิดปิดลื่น ล็อกได้', en: 'Bathroom door / glass door — smooth, lockable' },
      { th: 'กระเบื้องผนัง — ไม่ร้าว ไม่กลวง แนวตรง', en: 'Wall tiles — no crack, no hollow sound, aligned' },
      { th: 'กระเบื้องพื้น — ลาดเอียงลงฟลอร์เดรน ไม่มีน้ำขัง', en: 'Floor tiles — sloped to drain, no ponding' },
      { th: 'ยาแนว & ซิลิโคน — เต็มร่อง สม่ำเสมอ ไม่มีเชื้อรา', en: 'Grout & silicone — complete, even, no mould' },
      { th: 'อ่างล้างหน้า & เคาน์เตอร์ — ยึดแน่น ไม่มีรอยร้าว', en: 'Basin & counter — secure, no cracks' },
      { th: 'ก๊อกอ่างล้างหน้า — น้ำแรงพอ ไม่รั่วซึม', en: 'Basin faucet — adequate pressure, no leak' },
      { th: 'สะดืออ่าง & ท่อน้ำทิ้ง — ระบายไว ไม่มีกลิ่นย้อน', en: 'Basin waste & trap — drains fast, no odour' },
      { th: 'กระจกเงา & ไฟส่องกระจก — ไม่มีรอย ไฟติด', en: 'Mirror & mirror light — unblemished, light works' },
      { th: 'ชักโครก — ติดตั้งได้ระดับ กดชำระได้ ไม่รั่วที่ฐาน', en: 'WC — level, flushes, no leak at base' },
      { th: 'ฝารองนั่ง & สายฉีดชำระ — แน่น ไม่หยด', en: 'Seat cover & bidet spray — secure, no drip' },
      { th: 'ฝักบัว / Rain shower — น้ำออกทุกรู แรงดันสม่ำเสมอ', en: 'Shower / rain head — all jets clear, steady pressure' },
      { th: 'วาล์วน้ำร้อน-น้ำเย็น — ตำแหน่งไม่สลับกัน ปรับอุณหภูมิได้', en: 'Hot-cold valve — not reversed, temperature adjustable' },
      { th: 'กระจกกั้นอาบน้ำ & ยางกันน้ำ — ไม่มีน้ำรั่วออกนอกโซนเปียก', en: 'Shower screen & seal — no water escaping wet zone' },
      { th: 'ฟลอร์เดรน — ตะแกรงแน่น ระบายไว ไม่มีกลิ่น', en: 'Floor drain — grate secure, drains fast, no odour' },
      { th: 'พัดลมดูดอากาศ — ดูดแรง ไม่มีเสียงผิดปกติ', en: 'Exhaust fan — good suction, no abnormal noise' },
      { th: 'ราวแขวนผ้า / ที่ใส่กระดาษชำระ / ตะขอ — ยึดแน่น ระดับตรง', en: 'Towel rail / paper holder / hooks — secure and level' },
      { th: 'ปลั๊กกันน้ำ & สวิตช์ — มีฝาปิด ต่อสายดินเรียบร้อย', en: 'Waterproof socket & switch — covered, earthed' },
      { th: 'ไฟส่องสว่างห้องน้ำ — ติดทุกดวง สีไฟเท่ากัน', en: 'Bathroom lighting — all on, matching colour' },
    ],
  },
  {
    id: 'bedroom',
    name: 'ห้องนอน',
    en: 'Bedroom',
    pin: { x: 204, y: 292 },
    items: [
      { th: 'ฝ้าเพดาน — เรียบ ไม่มีคราบน้ำ รอยต่อไม่แตก', en: 'Ceiling — flat, no water stain, joints intact' },
      { th: 'ผนัง / วอลเปเปอร์ — ไม่มีฟองอากาศ รอยต่อ หรือรอยเปื้อน', en: 'Wall / wallpaper — no bubbles, seams or stains' },
      { th: 'พื้น / พรม — เรียบสนิท ไม่มีรอยยับ ขอบเก็บเรียบร้อย', en: 'Floor / carpet — flat, no wrinkles, edges finished' },
      { th: 'บัวพื้น & บัวฝ้า — แนบสนิท ไม่มีช่องว่าง', en: 'Skirting & cornice — flush, no gaps' },
      { th: 'หัวเตียง — ยึดแน่นกับผนัง ผ้าหุ้มไม่มีตำหนิ', en: 'Headboard — wall-fixed, upholstery unblemished' },
      { th: 'ฐานเตียง & ที่นอน — ได้ระดับ ไม่มีเสียงดัง', en: 'Bed base & mattress — level, no noise' },
      { th: 'โต๊ะข้างเตียง — ลิ้นชักเลื่อนลื่น ผิวไม่มีรอย', en: 'Bedside table — drawers glide, surface unmarked' },
      { th: 'โคมไฟหัวเตียง & สวิตช์ 2 ทาง — ติดทั้งสองฝั่ง', en: 'Bedside lamps & 2-way switch — both sides work' },
      { th: 'โต๊ะทำงาน & เก้าอี้ — มั่นคง ผิวเรียบ ไม่โยก', en: 'Work desk & chair — stable, smooth, no wobble' },
      { th: 'โซฟา / อาร์มแชร์ — ผ้าหุ้มเรียบ ขาแน่น', en: 'Sofa / armchair — upholstery even, legs firm' },
      { th: 'ทีวี & ขายึดผนัง — แน่น ได้ระดับ เปิดติด สัญญาณครบ', en: 'TV & wall bracket — secure, level, powers on, signal OK' },
      { th: 'สวิตช์ & ปลั๊กไฟทุกจุด — มีไฟ ฝาครอบตรง ไม่หลวม', en: 'All switches & sockets — live, plates aligned, not loose' },
      { th: 'ช่อง USB / ปลั๊กหัวเตียง — จ่ายไฟได้', en: 'USB ports / bedside outlets — supply power' },
      { th: 'โทรศัพท์ในห้อง — มีสัญญาณ โทรออก-รับได้', en: 'Room telephone — line active, calls in and out' },
      { th: 'Smoke detector — ติดตั้งแน่น ไฟสถานะปกติ', en: 'Smoke detector — mounted firmly, status light normal' },
      { th: 'หัวสปริงเกลอร์ — ไม่ถูกทับ ไม่มีสีเปื้อน', en: 'Sprinkler head — unobstructed, no paint contamination' },
      { th: 'กระจกเงาบานเต็มตัว — ยึดแน่น ไม่มีรอย', en: 'Full-length mirror — secure, unblemished' },
      { th: 'ภาพตกแต่ง / ของประดับ — แขวนได้ระดับ แน่น', en: 'Artwork / decor — level and secure' },
    ],
  },
  {
    id: 'hvac',
    name: 'เครื่องปรับอากาศ',
    en: 'Air Conditioning',
    pin: { x: 112, y: 400 },
    items: [
      { th: 'แชมเบอร์แอร์ / หน้ากากจ่ายลม — สะอาด ไม่มีฝุ่น ไม่มีคราบ', en: 'A/C chamber / grille — clean, dust-free, no stains' },
      { th: 'ช่องลมกลับ & ฟิลเตอร์ — ถอดล้างได้ ไม่มีฝุ่นจับ', en: 'Return air & filter — removable, no dust build-up' },
      { th: 'อุณหภูมิลมออก — เย็นได้ตามค่าที่ตั้ง', en: 'Supply air temperature — reaches setpoint' },
      { th: 'Thermostat / รีโมท — ปรับได้ทุกโหมด แสดงผลถูกต้อง', en: 'Thermostat / remote — all modes work, display correct' },
      { th: 'ท่อน้ำทิ้งแอร์ — ไม่มีน้ำหยด ไม่มีคราบน้ำที่ฝ้า', en: 'Condensate drain — no dripping, no ceiling stains' },
      { th: 'เสียงขณะทำงาน — ไม่ดังผิดปกติ ไม่มีเสียงสั่น', en: 'Operating noise — no abnormal or rattling sound' },
      { th: 'ฉนวนท่อ & ช่องเซอร์วิส — ปิดเรียบร้อย เปิดเข้าซ่อมได้', en: 'Pipe insulation & access panel — sealed, serviceable' },
    ],
  },
  {
    id: 'window',
    name: 'หน้าต่าง & ระเบียง',
    en: 'Window & Balcony',
    pin: { x: 208, y: 74 },
    items: [
      { th: 'กระจก — ไม่มีรอยร้าว รอยขีดข่วน หรือฝ้าภายใน', en: 'Glazing — no cracks, scratches or internal fogging' },
      { th: 'ซิลิโคนรอบกรอบ — เต็มแนว ไม่มีรอยรั่ว', en: 'Perimeter silicone — continuous, no leaks' },
      { th: 'บานเลื่อน / บานเปิด — เลื่อนลื่น ล็อกได้สนิท', en: 'Sliding / casement panel — glides, locks fully' },
      { th: 'ยางกันน้ำ & รางระบายน้ำ — ครบ ไม่อุดตัน', en: 'Weather seal & drainage channel — complete, unblocked' },
      { th: 'ม่านโปร่ง & ม่านทึบ — ความยาวเท่ากัน ปิดสนิทไม่มีแสงลอด', en: 'Sheer & blackout curtains — even hem, full blackout' },
      { th: 'รางม่าน & มอเตอร์ — เลื่อนลื่น ไม่มีเสียงดัง', en: 'Curtain track & motor — smooth, quiet' },
      { th: 'สวิตช์ม่านไฟฟ้า — ทิศทางไม่สลับกัน หยุดตามตำแหน่ง', en: 'Curtain switch — directions not reversed, stops correctly' },
      { th: 'พื้นระเบียง — ลาดเอียงระบายน้ำ ไม่มีน้ำขัง', en: 'Balcony floor — sloped, no ponding' },
      { th: 'ราวกันตก — สูงได้มาตรฐาน ยึดแน่น ไม่โยก', en: 'Balustrade — code height, secure, no movement' },
      { th: 'ไฟระเบียง & ปลั๊กภายนอก — ใช้งานได้ กันน้ำ', en: 'Balcony light & outdoor socket — working, weatherproof' },
    ],
  },
  {
    id: 'mep',
    name: 'งานระบบรวม',
    en: 'MEP / Services',
    pin: { x: 332, y: 372 },
    items: [
      { th: 'แรงดันน้ำ — เพียงพอทุกจุดจ่ายน้ำ', en: 'Water pressure — adequate at all outlets' },
      { th: 'น้ำร้อน — ร้อนภายในเวลาที่กำหนด อุณหภูมิคงที่', en: 'Hot water — reaches temperature in time, stable' },
      { th: 'ไม่มีน้ำรั่ว-ซึมใต้อ่างและใต้ชักโครก', en: 'No leaks under basin or WC' },
      { th: 'ไม่มีกลิ่นย้อนจากท่อระบายน้ำทุกจุด', en: 'No sewer odour from any drain' },
      { th: 'ตู้ควบคุมไฟ / เบรกเกอร์ห้อง — ป้ายกำกับครบ ตัดต่อได้', en: 'Room DB / breakers — labelled, switching correctly' },
      { th: 'สัญญาณ Wi-Fi & ช่อง LAN — เชื่อมต่อได้ ความเร็วปกติ', en: 'Wi-Fi & LAN port — connects, normal speed' },
      { th: 'ความสะอาดขั้นสุดท้าย — ไม่มีเศษวัสดุ ฝุ่น หรือคราบสี', en: 'Final cleaning — no debris, dust or paint marks' },
    ],
  },
];

/* ---- ส่วนล่างนี้ไม่ต้องแก้ไข ---- */
ZONES.forEach((zone, zi) => {
  zone.no = zi + 1;
  zone.items.forEach((item, ii) => {
    item.no = ii + 1;
    item.key = zone.id + '-' + item.no;
  });
});

const TOTAL_ITEMS = ZONES.reduce((sum, z) => sum + z.items.length, 0);
