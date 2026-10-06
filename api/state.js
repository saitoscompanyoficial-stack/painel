// Vercel Serverless Function: /api/state
// Guarda os dados do painel num Redis (Upstash) para que toda a equipe veja a mesma coisa.
const crypto = require("crypto");

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const COLS = ["meetings", "prospects", "clients"];

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

function samePassword(a, b) {
  const ha = crypto.createHash("sha256").update(String(a || "")).digest();
  const hb = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function validItem(it) {
  return it && typeof it === "object" && typeof it.id === "string" && it.id.length > 0 && it.id.length < 80 &&
    JSON.stringify(it).length < 20000;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!REDIS_URL || !REDIS_TOKEN || !process.env.TEAM_PASSWORD) {
    return res.status(500).json({ error: "Servidor não configurado: faltam variáveis de ambiente (veja o LEIA-ME)." });
  }
  if (!samePassword(req.headers["x-team-password"], process.env.TEAM_PASSWORD)) {
    return res.status(401).json({ error: "Senha incorreta" });
  }

  try {
    if (req.method === "GET") {
      const out = {};
      for (const col of COLS) {
        const flat = (await redis(["HGETALL", "painel:" + col])) || [];
        const items = [];
        for (let i = 1; i < flat.length; i += 2) {
          try { items.push(typeof flat[i] === "string" ? JSON.parse(flat[i]) : flat[i]); } catch (e) {}
        }
        out[col] = items;
      }
      return res.status(200).json(out);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};

      if (body.op === "set" && COLS.includes(body.col) && validItem(body.item)) {
        await redis(["HSET", "painel:" + body.col, body.item.id, JSON.stringify(body.item)]);
        return res.status(200).json({ ok: true });
      }
      if (body.op === "del" && COLS.includes(body.col) && typeof body.id === "string") {
        await redis(["HDEL", "painel:" + body.col, body.id]);
        return res.status(200).json({ ok: true });
      }
      if (body.op === "import" && body.data && typeof body.data === "object") {
        for (const col of COLS) {
          const list = Array.isArray(body.data[col]) ? body.data[col].filter(validItem) : [];
          for (const it of list) await redis(["HSET", "painel:" + col, it.id, JSON.stringify(it)]);
        }
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Requisição inválida" });
    }

    return res.status(405).json({ error: "Método não permitido" });
  } catch (e) {
    return res.status(500).json({ error: "Erro no servidor: " + e.message });
  }
};
