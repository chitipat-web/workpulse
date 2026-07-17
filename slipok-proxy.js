/**
 * SlipOK Verify+Write Worker — Cloudflare (ฟรี)
 * ──────────────────────────────────────────────────────────────
 * เซิร์ฟเวอร์ที่เชื่อถือได้: ตรวจสลิปกับ SlipOK แล้ว "เขียนรายการเข้า Firebase เอง"
 * โดยใช้ยอดจากธนาคาร (กันพนักงานใส่เงินปลอม) + ตรวจตัวตนผู้เรียกด้วย Firebase ID token
 *
 * มี 2 โหมด:
 *  - ไม่มี idToken  → โหมดเก่า (แค่ตรวจ ส่งข้อมูลกลับ ไม่เขียน) เผื่อ backward-compat
 *  - มี idToken     → โหมดปลอดภัย: auth → ตรวจ SlipOK → เขียน DB (ยอดจากธนาคาร)
 *
 * วิธีติดตั้ง: ใส่ค่า 6 ตัวด้านล่าง แล้ว Deploy บน Cloudflare Workers
 * ⚠️ ค่าความลับ (SLIPOK_API_KEY, FB_SECRET) อยู่ใน Worker เท่านั้น — ห้าม commit ค่าจริงลงสาธารณะ
 */

const SLIPOK_API_KEY = "ใส่_SLIPOK_API_KEY";
const SLIPOK_BRANCH  = "ใส่_BRANCH_ID";
const FB_DB     = "https://xxx-default-rtdb.asia-southeast1.firebasedatabase.app";
const FB_SECRET = "ใส่_FIREBASE_DATABASE_SECRET";   // กุญแจ admin (Project settings → Service accounts → Database secrets)
const FB_APIKEY = "ใส่_FIREBASE_WEB_APIKEY";        // public web api key (ใช้ตรวจ idToken)
const ROOM = "main";
const ALLOWED = ["owner@gmail.com", "staff@gmail.com"]; // อีเมลที่อนุญาต
const ALLOW_ORIGIN = "https://chitipat-web.github.io"; // จำกัดเฉพาะโดเมนเว็บเรา (กันเว็บอื่นเรียก)

// แปลงวันที่จาก SlipOK (มักเป็น YYYYMMDD ไม่มีขีด) ให้เป็น YYYY-MM-DD
function toYMD(s) {
  s = (s || "").toString().trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) { let y = +m[1]; if (y > 2200) y -= 543; return `${String(y).padStart(4,"0")}-${String(+m[2]).padStart(2,"0")}-${String(+m[3]).padStart(2,"0")}`; }
  const d = new Date(s); return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
// แปลงรหัสธนาคาร (เช่น 014) เป็นชื่อไทย
const BANK_CODE = { "002":"กรุงเทพ","004":"กสิกรไทย","006":"กรุงไทย","011":"ทหารไทยธนชาต","014":"ไทยพาณิชย์","025":"กรุงศรีอยุธยา","030":"ออมสิน","065":"ธนชาต","067":"ทิสโก้","069":"เกียรตินาคินภัทร","071":"ไทยเครดิต","073":"แลนด์แอนด์เฮ้าส์","034":"ธ.ก.ส.","033":"ธอส." };
function bankName(b) { b = (b || "").toString().trim(); const c = b.replace(/\D/g, ""); if (/^\d{2,3}$/.test(c)) return BANK_CODE[c.padStart(3,"0")] || ("ธนาคาร " + c); return b; }

export default {
  async fetch(req) {
    const cors = { "Access-Control-Allow-Origin": ALLOW_ORIGIN, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response("POST only", { status: 405, headers: cors });
    const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
    let body; try { body = await req.json(); } catch { return J({ ok: false, error: "bad request" }, 400); }

    const verify = async (data, log) => {
      try {
        const r = await fetch("https://api.slipok.com/api/line/apikey/" + SLIPOK_BRANCH,
          { method: "POST", headers: { "Content-Type": "application/json", "x-authorization": SLIPOK_API_KEY }, body: JSON.stringify({ data, log }) });
        const j = await r.json().catch(() => ({})); const d = (j && j.data) ? j.data : j;
        if (r.ok && j && j.success !== false && d && (d.amount != null || d.transRef)) {
          const sName = d.sender && (d.sender.displayName || d.sender.name || (d.sender.account && d.sender.account.name));
          const sBank = d.sendingBank || (d.sender && d.sender.bank);
          const dt = toYMD(d.transDate || d.transTimestamp || "");
          return { ok: true, transRef: d.transRef || "", amount: d.amount != null ? Number(d.amount) : null, sender: sName || "", senderBank: bankName(sBank) || "", date: dt };
        }
        const code = j && (j.code || (j.data && j.data.code));
        if (code === 1012) return { dup: true };
        if (code === 1011 || code === 1008 || code === 1013) return { ok: false, notFound: true, reason: j && j.message };
        return { ok: false, error: (j && j.message) || ("code " + (code || r.status)) };
      } catch (e) { return { ok: false, error: "slipok unreachable" }; }
    };

    // ต้องมี idToken เสมอ — กันคนภายนอกยิง Worker เผาโควต้า SlipOK (ไม่มี token = ไม่เรียก SlipOK)
    if (!body.idToken || typeof body.idToken !== "string" || body.idToken.trim().length < 20) {
      return J({ ok: false, error: "unauthorized" }, 401);
    }

    // ตรวจตัวตน → ตรวจสลิป → เขียนเอง
    let email = "";
    try {
      const lk = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + FB_APIKEY,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: body.idToken }) });
      const lj = await lk.json(); const u = lj.users && lj.users[0];
      if (u && u.emailVerified) email = (u.email || "").toLowerCase();
    } catch (e) {}
    if (!email || !ALLOWED.map(e => e.toLowerCase()).includes(email)) return J({ ok: false, error: "unauthorized" }, 401);

    let v = await verify(body.data, true);
    if (v.dup) { const r = await verify(body.data, false); if (r.ok) r.sokDup = true; v = r; }
    if (!v.ok) return J({ ok: false, error: v.error || "", notFound: !!v.notFound, reason: v.reason || "" });

    const id = (v.transRef || "").toString().replace(/[.#$\[\]\/]/g, "_").slice(0, 120);
    if (!id) return J({ ok: false, error: "no transRef" });
    const g = await fetch(FB_DB + "/rooms/" + ROOM + "/transfers/" + id + ".json?auth=" + FB_SECRET);
    const exist = await g.json().catch(() => null);
    if (exist && exist.id) return J({ ok: false, alreadyExists: true, record: exist });

    // เก็บรูปสลิป (ถ้าส่งมา) — บีบอัดแล้วจากฝั่งเว็บ, จำกัดขนาดกันสแปม
    const hasImg = typeof body.img === "string" && body.img.indexOf("data:image") === 0 && body.img.length < 400000;
    const rec = { id, amount: v.amount, name: v.sender || "ไม่ระบุชื่อ", bank: v.senderBank || "", date: (v.date || "").slice(0, 10), note: (body.note || "").toString().slice(0, 200), slipRef: v.transRef, slipVerified: true, createdBy: email, hasImg };
    await fetch(FB_DB + "/rooms/" + ROOM + "/transfers/" + id + ".json?auth=" + FB_SECRET, { method: "PUT", body: JSON.stringify(rec) });
    if (hasImg) await fetch(FB_DB + "/rooms/" + ROOM + "/slips/" + id + ".json?auth=" + FB_SECRET, { method: "PUT", body: JSON.stringify(body.img) });
    return J({ ok: true, record: rec });
  }
};
