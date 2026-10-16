/**
 * Run Tick on any computer with Node.js: a school PC, a Raspberry Pi, a VPS, or Docker.
 * Serves the web app and the API on one port.
 *
 *   Database: DATABASE_URL (any Postgres) if set; otherwise a built-in database
 *             stored in ./data/pgdata (PGlite — nothing to install).
 *   Secrets:  JWT_SECRET / TEMPLATE_KEY from the environment or .env; if missing,
 *             strong random ones are created once and kept in ./data/secrets.json.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { createApp } from "./app.js";
import { configFrom, poolDriver } from "./lib.js";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const port = Number(process.env.PORT || 4000);
fs.mkdirSync(dataDir, { recursive: true });

function secrets() {
  const file = path.join(dataDir, "secrets.json");
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* first run */ }
  const out = {
    JWT_SECRET: process.env.JWT_SECRET || saved.JWT_SECRET,
    TEMPLATE_KEY: process.env.TEMPLATE_KEY || saved.TEMPLATE_KEY,
  };
  if (!out.JWT_SECRET || !out.TEMPLATE_KEY) {
    out.JWT_SECRET ||= crypto.randomBytes(32).toString("hex");
    out.TEMPLATE_KEY ||= crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, JSON.stringify(out, null, 2), { mode: 0o600 });
    console.log(`Created new secrets in ${file} — back this file up with your data, and never change TEMPLATE_KEY.`);
  }
  return out;
}

async function database() {
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    console.log("Database: Postgres from DATABASE_URL");
    return poolDriver(new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 }));
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = path.join(dataDir, "pgdata");
  const db = await PGlite.create(dir);
  console.log(`Database: built-in, stored in ${dir}`);
  return {
    query: async (sql, params = []) => (await db.query(sql, params)).rows,
    tx: (fn) => db.transaction((tx) => fn(async (sql, params = []) => (await tx.query(sql, params)).rows)),
    exec: (sql) => db.exec(sql),
  };
}

const config = configFrom({ ...process.env, ...secrets() });
const db = await database();
const schema = fs.readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");
await db.exec(schema);

const site = new Hono();
site.route("/", createApp({ db, config }));
site.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

const web = path.relative(process.cwd(), path.join(root, "web", "dist")) || ".";
if (fs.existsSync(path.join(root, "web", "dist", "index.html"))) {
  site.use("/assets/*", async (c, next) => { await next(); c.header("Cache-Control", "public, max-age=31536000, immutable"); });
  site.use("/models/*", async (c, next) => { await next(); c.header("Cache-Control", "public, max-age=604800"); });
  site.use("/sw.js", async (c, next) => { await next(); c.header("Cache-Control", "no-cache"); });
  site.use("/*", serveStatic({ root: web }));
  site.get("*", serveStatic({ path: path.join(web, "index.html") }));
} else {
  console.warn("Web app not built yet — run `npm run build` (the API still works).");
}

serve({ fetch: site.fetch, port, hostname: "0.0.0.0" }, () => {
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => `http://${n.address}:${port}`);
  console.log(`\nTick is running:  http://localhost:${port}`);
  if (lan.length) console.log(`On the school network:  ${lan.join("  ")}`);
});
