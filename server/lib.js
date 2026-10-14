/**
 * Platform-neutral helpers: config, database access, template encryption, matching.
 * Uses only Web standard APIs (crypto.subtle, btoa/atob), so it runs on Node,
 * Netlify Functions, Vercel, Cloudflare Workers, Deno and Bun alike.
 */

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Read settings from an env object (process.env, Netlify.env, a Worker's env…). */
export function configFrom(env = {}) {
  return {
    jwtSecret: env.JWT_SECRET || "",
    templateKey: env.TEMPLATE_KEY || "",
    timeZone: env.SCHOOL_TZ || env.TZ_SCHOOL || "Africa/Lusaka",
    // SFace cosine similarity. 0.363 is the model's published cut-off; above MATCH we pre-tick.
    reviewAt: Number(env.REVIEW_THRESHOLD || 0.363),
    matchAt: Number(env.MATCH_THRESHOLD || 0.45),
  };
}

/* ---------- database ---------- */

/**
 * A database is { query(sql, params) → rows, tx(fn) }. Any Postgres works:
 * a pg.Pool (Netlify Database, Neon, Supabase, your own server) or embedded PGlite.
 */
export function poolDriver(pool) {
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(async (sql, params = []) => (await client.query(sql, params)).rows);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    exec: (sql) => pool.query(sql),
  };
}

/** Postgres error → friendly HTTP error. */
export function dbError(e, dupeMessage = "That already exists") {
  switch (e?.code) {
    case "23505": return new HttpError(409, dupeMessage);
    case "23503": return new HttpError(400, "That refers to something that doesn't exist");
    case "23514":
    case "22P02":
    case "22003": return new HttpError(400, "One of the values isn't valid");
    default: return e;
  }
}

/* ---------- dates in the school's time zone ---------- */

export const todayIn = (timeZone) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export const addDays = (isoDate, days) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/* ---------- face templates are encrypted at rest (AES-256-GCM) ----------
 * Stored as base64(iv).base64(tag).base64(ciphertext) — the same format the
 * original Node server wrote, so existing templates decrypt with the same TEMPLATE_KEY.
 */

const b64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const keys = new Map();
function aesKey(secret) {
  if (!keys.has(secret)) {
    keys.set(secret, (async () => {
      const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
      return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    })());
  }
  return keys.get(secret);
}

export async function encryptTemplate(secret, embedding) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new Uint8Array(new Float32Array(embedding).buffer);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), plain));
  const body = sealed.subarray(0, sealed.length - 16);
  const tag = sealed.subarray(sealed.length - 16);
  return [iv, tag, body].map(b64).join(".");
}

export async function decryptTemplate(secret, text) {
  const [iv, tag, body] = text.split(".").map(unb64);
  const sealed = new Uint8Array(body.length + tag.length);
  sealed.set(body);
  sealed.set(tag, body.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(secret), sealed);
  return new Float32Array(plain);
}

/* ---------- matching ---------- */

const cosine = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // both vectors are unit length
};

/**
 * Match each detected face to at most one learner, and each learner to at most one face.
 * faces: [{box, embedding}]; templates: [{learner_id, vector}]
 */
export function matchFaces(faces, templates, { reviewAt, matchAt }) {
  const pairs = [];
  faces.forEach((face, f) => {
    const best = new Map(); // learner_id -> best similarity for this face
    for (const t of templates) {
      const s = cosine(face.embedding, t.vector);
      if (s > (best.get(t.learner_id) ?? -1)) best.set(t.learner_id, s);
    }
    for (const [learnerId, s] of best) if (s >= reviewAt) pairs.push({ f, learnerId, s });
  });

  pairs.sort((a, b) => b.s - a.s);
  const usedFaces = new Set();
  const usedLearners = new Set();
  const results = faces.map((face) => ({ box: face.box, learner_id: null, similarity: null, verdict: "unknown" }));
  for (const p of pairs) {
    if (usedFaces.has(p.f) || usedLearners.has(p.learnerId)) continue;
    usedFaces.add(p.f);
    usedLearners.add(p.learnerId);
    results[p.f] = {
      ...results[p.f],
      learner_id: p.learnerId,
      similarity: Number(p.s.toFixed(3)),
      verdict: p.s >= matchAt ? "match" : "review",
    };
  }
  return results;
}

/** Check an embedding sent by the browser: 128 finite numbers of unit length. */
export function checkEmbedding(v) {
  if (!Array.isArray(v) || v.length !== 128 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) {
    throw new HttpError(400, "Invalid face data — reload the page and try again");
  }
  const n = Math.hypot(...v);
  if (n < 0.95 || n > 1.05) throw new HttpError(400, "Invalid face data — reload the page and try again");
  return v;
}
