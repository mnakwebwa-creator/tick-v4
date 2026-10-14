/**
 * Copy everything from an old Tick install (data/attend.db, SQLite) into the new database.
 *
 *   npm run import-sqlite -- "C:\path\to\old\data\attend.db"
 *
 * Target: DATABASE_URL if set (e.g. your Netlify Database connection string),
 * otherwise the built-in local database in ./data/pgdata.
 * Use the SAME TEMPLATE_KEY as the old install — face templates are copied still encrypted.
 * Stop the old app first (so the .db file is complete).
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: npm run import-sqlite -- "path/to/attend.db"');
  process.exit(1);
}
const force = process.argv.includes("--force");
const src = new DatabaseSync(file, { readOnly: true });
const schema = fs.readFileSync(path.resolve(import.meta.dirname, "../server/schema.sql"), "utf8");

// ---- target ----
let target;
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  target = { query: (s, p) => client.query(s, p).then((r) => r.rows), exec: (s) => client.query(s), close: async () => { client.release(); await pool.end(); } };
  console.log("Importing into Postgres at DATABASE_URL");
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.resolve(process.env.DATA_DIR || path.resolve(import.meta.dirname, "../data"), "pgdata");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const db = await PGlite.create(dir);
  target = { query: (s, p) => db.query(s, p).then((r) => r.rows), exec: (s) => db.exec(s), close: () => db.close() };
  console.log(`Importing into the built-in database at ${dir}`);
}

await target.exec(schema);
const [{ n }] = await target.query("SELECT count(*)::int AS n FROM users");
if (n > 0 && !force) {
  console.error("The new database already has accounts. Import into an empty database, or add --force to merge (ids may clash).");
  await target.close();
  process.exit(1);
}

// SQLite CURRENT_TIMESTAMP is UTC without a zone
const ts = (v) => (v ? `${String(v).replace(" ", "T")}Z` : null);
const has = (table) => src.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
const cols = (table) => src.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

const TABLES = [
  ["users", ["id", "username", "full_name", "password_hash", "role", "status"], (r) => ({ ...r, status: r.status ?? "active" })],
  ["classes", ["id", "name", "academic_year", "teacher_id", "status"]],
  ["learners", ["id", "student_number", "full_name", "class_id", "consent", "status"], (r) => ({ ...r, consent: !!r.consent })],
  ["face_templates", ["id", "learner_id", "template_data", "model_version", "created_at", "revoked_at"],
    (r) => ({ ...r, created_at: ts(r.created_at), revoked_at: ts(r.revoked_at) })],
  ["attendance_sessions", ["id", "class_id", "session_date", "session_type", "created_by"]],
  ["attendance_records", ["id", "session_id", "learner_id", "status", "method", "similarity", "confirmed_by", "recorded_at"],
    (r) => ({ ...r, recorded_at: ts(r.recorded_at) })],
  ["audit_log", ["id", "user_id", "action", "details", "created_at"],
    (r) => { let d = null; try { d = r.details ? JSON.parse(r.details) : null; } catch { d = { text: r.details }; } return { ...r, details: JSON.stringify(d), created_at: ts(r.created_at) }; }],
];

await target.exec("BEGIN");
try {
  for (const [table, wanted, fix = (r) => r] of TABLES) {
    if (!has(table)) continue;
    const available = cols(table);
    const rows = src.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    for (const raw of rows) {
      const r = fix(raw);
      const use = wanted.filter((c) => available.includes(c) || c in r);
      const ph = use.map((_, i) => `$${i + 1}`).join(",");
      await target.query(`INSERT INTO ${table} (${use.join(",")}) OVERRIDING SYSTEM VALUE VALUES (${ph}) ON CONFLICT DO NOTHING`,
        use.map((c) => r[c] ?? null));
    }
    // continue numbering after the imported ids
    await target.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), GREATEST((SELECT max(id) FROM ${table}), 1))`);
    console.log(`  ${table}: ${rows.length}`);
  }
  await target.exec("COMMIT");
} catch (e) {
  await target.exec("ROLLBACK");
  console.error("Import failed, nothing was changed:", e.message);
  await target.close();
  process.exit(1);
}
await target.close();
console.log("Done. Keep using the same TEMPLATE_KEY as the old install so faces keep working.");
