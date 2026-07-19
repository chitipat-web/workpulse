/**
 * Claude AI Proxy Worker — Cloudflare (สำหรับ "น้องเฮิร์ต" ผู้ช่วย HURT SHOP)
 * ──────────────────────────────────────────────────────────────
 * ตัวกลางที่เชื่อถือได้: รับคำถาม + ข้อมูลสรุปจาก assistant.html
 * → ตรวจตัวตนด้วย Firebase ID token (แบบเดียวกับ slipok-proxy)
 * → เรียก Claude API แล้วส่งคำตอบกลับ
 * API key อยู่ใน Worker เท่านั้น ไม่หลุดไปหน้าเว็บ
 *
 * วิธีติดตั้ง (Cloudflare Dashboard):
 *  1. Workers & Pages → Create Worker → วางโค้ดนี้ทั้งไฟล์ → Deploy
 *  2. Settings → Variables → Add secret: ANTHROPIC_API_KEY = sk-ant-xxx
 *     (สมัคร/สร้าง key ได้ที่ console.anthropic.com → API Keys)
 *  3. คัดลอก URL ของ Worker (เช่น https://hurt-ai.xxx.workers.dev)
 *     ไปวางในตัวแปร AI_PROXY ใน assistant.html
 */

const FB_APIKEY = "AIzaSyA68TcgHOPQb8FwiOZYD36gkBJNLl3juEg"; // public web api key (ใช้ตรวจ idToken)
const ALLOWED = ["chitipat.kao@gmail.com", "dynosgaming01@gmail.com", "chitipat.kee@gmail.com"];
const ALLOW_ORIGIN = "https://chitipat-web.github.io"; // ล็อกเฉพาะโดเมนเว็บเรา (กันเว็บอื่นเรียก)
const MODEL = "claude-haiku-4-5"; // เร็ว+ถูก เหมาะกับงานตอบแชท (เปลี่ยนเป็นรุ่นอื่นได้)

const SYSTEM_PROMPT = `คุณคือ "น้องเฮิร์ต" ผู้ช่วย AI ของร้าน HURT SHOP พูดไทย สุภาพ ลงท้าย "ค่ะ" กระชับ ตรงประเด็น
หน้าที่: ช่วยเจ้าของร้านและพนักงานดูข้อมูลยอดโอนเงินของลูกค้า

กติกาสำคัญ:
- ตอบจากข้อมูลใน <data> เท่านั้น ห้ามเดาหรือแต่งตัวเลขเอง
- ถ้าข้อมูลไม่พอที่จะตอบ ให้บอกตรง ๆ ว่าไม่มีข้อมูล
- ยอดเงินใส่ตัวคั่นหลักพันและลงท้าย ฿ เช่น 1,200 ฿
- วันที่ใช้แบบไทย เช่น 19 ก.ค. 69
- สถานะสลิป: verified=true คือตรวจกับธนาคารแล้ว ✅, มี slipRef แต่ verified=false คือรอยืนยัน ⏳, ไม่มี slipRef คือกรอกเอง 📝
- คำนวณเลขให้ถูกต้องเสมอ ถ้ารายการเยอะให้สรุปเป็นภาพรวม + ตัวอย่างไม่เกิน 8 รายการ
- ไม่ต้องใช้ markdown ตอบเป็นข้อความธรรมดา (ใช้ • และขึ้นบรรทัดใหม่ได้)`;

export default {
  async fetch(req, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

    let body;
    try { body = await req.json(); } catch { return J({ ok: false, error: "bad request" }, 400); }

    // ── 1) ตรวจตัวตน (Firebase ID token) ──
    if (!body.idToken || typeof body.idToken !== "string" || body.idToken.trim().length < 20) {
      return J({ ok: false, error: "unauthorized" }, 401);
    }
    let email = "";
    try {
      const lk = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FB_APIKEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: body.idToken }),
      });
      const lj = await lk.json();
      const u = lj.users && lj.users[0];
      if (u && u.emailVerified) email = (u.email || "").toLowerCase();
    } catch (e) {}
    if (!email || !ALLOWED.map(e => e.toLowerCase()).includes(email)) return J({ ok: false, error: "unauthorized" }, 401);

    // ── 2) เตรียมข้อความ ──
    const question = (body.question || "").toString().slice(0, 2000);
    if (!question.trim()) return J({ ok: false, error: "no question" }, 400);
    const context = (body.context || "").toString().slice(0, 60000);

    // ประวัติแชทล่าสุด (ไม่เกิน 8 ข้อความ) เพื่อให้คุยต่อเนื่องได้
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];
    const messages = [];
    for (const h of history) {
      if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim()) {
        messages.push({ role: h.role, content: h.content.slice(0, 2000) });
      }
    }
    if (messages.length && messages[0].role === "assistant") messages.shift(); // ต้องเริ่มด้วย user
    messages.push({ role: "user", content: "<data>\n" + context + "\n</data>\n\nคำถาม: " + question });

    // ── 3) เรียก Claude API ──
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) return J({ ok: false, error: "ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ใน Worker" }, 500);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages,
        }),
      });
      const jr = await r.json();
      if (!r.ok) {
        const msg = (jr.error && jr.error.message) || ("HTTP " + r.status);
        return J({ ok: false, error: "Claude API: " + msg }, 502);
      }
      const reply = (jr.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
      return J({ ok: true, reply: reply || "(ไม่มีคำตอบ)" });
    } catch (e) {
      return J({ ok: false, error: "เรียก Claude API ไม่สำเร็จ" }, 502);
    }
  },
};
