# หมอมู AI 🔮 — คู่มือ Deploy (ทำจาก iPhone ได้ทั้งหมด)

เปิดไพ่ยิปซีวันละ 1 ใบ + AI ทำนาย + เคล็ดเสริมดวง/สีมงคล/เลขนำโชค + แชร์การ์ดลงสตอรี่
เทคโนโลยีเดียวกับ RUDY: PWA ไฟล์เดียวบน GitHub Pages, ต้นทุน 0 บาท

## ไฟล์ในชุดนี้

| ไฟล์ | ไปไหน |
|---|---|
| `index.html` | GitHub repo (Pages) |
| `sw.js` | GitHub repo |
| `manifest.json` | GitHub repo |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | GitHub repo |
| `worker.js` | Cloudflare Worker (ห้ามขึ้น GitHub — มีลิสต์ origin เฉยๆ แต่แยกไว้ชัดกว่า) |

## ขั้นตอน (ลำดับสำคัญ: Worker ก่อน → ค่อยขึ้นหน้าเว็บ)

### 1. สร้าง Cloudflare Worker (~5 นาที)
1. เข้า dash.cloudflare.com บน Safari → **Workers & Pages** → **Create** → **Create Worker**
2. ตั้งชื่อ `mormoo` → Deploy → กด **Edit code**
3. ลบโค้ดเดิม วาง `worker.js` ทั้งไฟล์ → **Deploy**
4. ไปที่ **Settings → Variables and Secrets → Add**
   - Type: **Secret** / Name: `GEMINI_API_KEY` / Value: คีย์ Gemini ของเรา → Save แล้ว Deploy ซ้ำ
5. จด URL เช่น `https://mormoo.xxxx.workers.dev`

### 2. แก้ config 2 จุด
- `index.html` บนสุดของ `<script>`:
  - `WORKER_URL` → URL จากข้อ 1
  - `APP_URL` → URL หน้าเว็บจริง (โชว์เป็นลายน้ำบนการ์ดแชร์)
- `worker.js` → `ALLOWED_ORIGINS` ให้ตรงกับ origin จริง (ค่า default ใส่ `https://chitipat-web.github.io` ไว้แล้ว — origin ไม่ต้องมี path ต่อท้าย)

### 3. ขึ้น GitHub Pages
1. สร้าง repo ใหม่ เช่น `mormoo-ai` (public)
2. Upload: `index.html`, `sw.js`, `manifest.json`, icon ทั้ง 3 ไฟล์
3. Settings → Pages → Deploy from branch → `main` / root
4. รอ 1-2 นาที เปิด `https://<user>.github.io/mormoo-ai/`

### 4. เช็คลิสต์ก่อนปล่อย
- [ ] จั่วไพ่ → ได้คำทำนาย + สี + เลข ครบ
- [ ] กดแชร์ → ได้การ์ด 1080x1920 (iOS ขึ้น share sheet / ถ้าไม่ขึ้นจะโชว์รูปให้กดค้างเซฟ)
- [ ] รีเฟรชหน้า → ยังเห็นไพ่เดิมของวันนี้ + ตัวนับถอยหลัง
- [ ] เปลี่ยนวัน (หรือลบ localStorage key `mm_daily`) → จั่วใหม่ได้
- [ ] Add to Home Screen → เปิดแบบ full screen ได้ (เทสบน URL จริง ไม่ใช่ preview — บทเรียน App-Bound Domains)

## กันพังตอนไวรัล (อ่านก่อนยิงคลิป)
- ลิมิตตอนนี้: 6 ครั้ง/นาที/IP, 15 ครั้ง/วัน/IP, รวมทั้งระบบ ~30/นาที (ปรับได้บนหัวไฟล์ worker.js)
- Gemini free tier มีเพดาน RPM/RPD ของตัวเอง — ถ้าคลิปติดจริง คนจะเจอข้อความ "ญาณหมอมูถูกใช้เยอะ" ช่วงพีค
- ทางอัพเกรดเมื่อถึงเวลา: (1) เปิด Gemini paid tier (ถูกมาก) (2) ย้าย rate limit ไป Cloudflare KV/Durable Objects (3) ต่อโดเมนจริงผ่าน Cloudflare เพื่อใช้ WAF rate limiting

## โน้ตสำหรับ Claude Code (สิ่งที่ทำแล้ว + งานต่อ)

**สถาปัตยกรรม:** vanilla JS ไฟล์เดียว, ไม่มี login/DB — สถานะทั้งหมดอยู่ localStorage (`mm_daily` = {date, current, result}) / Worker เป็น stateless proxy, rate limit แบบ in-memory ต่อ isolate

**กฎเหล็กที่ห้ามแตะ:**
1. `sw.js` — bypass `workers.dev` + `generativelanguage` ต้องอยู่ **บรรทัดแรก** ของ fetch handler ก่อนเช็ค method (บั๊ก Safari iOS PWA intercept CORS preflight)
2. Gemini config: `thinkingBudget: 0`, `responseMimeType: 'application/json'`, `maxOutputTokens: 2048` + parser ต้อง strip ``` fences เสมอ
3. ทุก path ใน index.html เป็น relative (`./`) เพราะอยู่ใต้ subpath ของ GitHub Pages
4. อัปเดตแอปทุกครั้งต้อง bump `CACHE = 'mormoo-vX'` ใน sw.js

**ไอเดียเฟสถัดไป (เรียงตามผลต่อการโต):**
1. สตรีค "เปิดไพ่ติดต่อกัน X วัน" บนการ์ดแชร์ → คนอวด = คนใหม่เข้า
2. ปุ่ม "ส่งไพ่ให้เพื่อน" — สุ่มไพ่ผูกชื่อเพื่อน แชร์เป็นลิงก์/การ์ด
3. เพิ่มโหมดถามได้อีกถ้าดูโฆษณา/แชร์ (viral loop ชั้นสอง)
4. ดวงรายสัปดาห์แบบละเอียด = ฟีเจอร์เก็บเงินในอนาคต
