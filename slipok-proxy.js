/**
 * SlipOK Proxy — Cloudflare Worker (ฟรี)
 * ──────────────────────────────────────────────────────────────
 * ทำไมต้องมีตัวนี้: เว็บ (เบราว์เซอร์) เรียก SlipOK ตรงๆ ไม่ได้
 * เพราะ SlipOK ใช้ header "x-authorization" ซึ่ง CORS ของ SlipOK ไม่อนุญาต
 * Worker นี้ทำหน้าที่เป็น "ตัวกลาง" รับคำขอจากเว็บเรา แล้วยิงต่อไป SlipOK
 *
 * วิธีติดตั้ง (ครั้งเดียว ~5 นาที):
 *  1) สมัคร SlipOK ที่ slipok.com → เอา API Key + Branch ID
 *  2) เข้า dash.cloudflare.com (สมัครฟรี) → Workers & Pages → Create → Worker
 *  3) กด Edit code → ลบของเดิม วางโค้ดนี้ทั้งหมด
 *  4) แก้ 2 บรรทัดด้านล่าง: ใส่ SLIPOK_API_KEY และ SLIPOK_BRANCH_ID ของคุณ
 *  5) Deploy → ก๊อป URL ของ Worker (เช่น https://xxx.workers.dev)
 *  6) เอา URL ไปวางในเว็บ: ⚙️ → SlipOK Proxy URL → บันทึก
 *
 * ความปลอดภัย: API key อยู่ใน Worker ไม่โผล่ในเบราว์เซอร์
 * (ถ้าอยากแน่นขึ้น เปลี่ยน ALLOW_ORIGIN เป็นโดเมนเว็บคุณแทน '*')
 */

const SLIPOK_API_KEY   = "ใส่_API_KEY_ของคุณ";     // ← แก้ตรงนี้
const SLIPOK_BRANCH_ID = "ใส่_BRANCH_ID_ของคุณ";   // ← แก้ตรงนี้
const ALLOW_ORIGIN     = "*";                       // หรือ "https://chitipat-web.github.io"

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST")
      return new Response("POST only", { status: 405, headers: cors });

    let body;
    try { body = await request.json(); } catch { body = {}; }

    const resp = await fetch(
      "https://api.slipok.com/api/line/apikey/" + SLIPOK_BRANCH_ID,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-authorization": SLIPOK_API_KEY,
        },
        body: JSON.stringify({
          data: body.data,        // payload ของ QR จากสลิป
          log: body.log === true, // ให้ SlipOK เก็บ log + เช็คสลิปซ้ำ
        }),
      }
    );

    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  },
};
