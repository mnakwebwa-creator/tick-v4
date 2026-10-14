/** Create Tick's tables in the Postgres at DATABASE_URL (safe to run again). */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL first, e.g.  DATABASE_URL=postgres://… npm run db:setup");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync(path.resolve(import.meta.dirname, "../server/schema.sql"), "utf8"));
await pool.end();
console.log("Tables are ready.");
