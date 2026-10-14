/**
 * Tick's API on Netlify, as a single function serving /api/*.
 *
 * Database: Netlify Database (provisioned automatically; schema applied from
 * netlify/database/migrations on deploy). To use another Postgres instead
 * (Neon, Supabase…), set DATABASE_URL in the site's environment variables and
 * create the tables once with `npm run db:setup` (see README).
 */
import { getDatabase } from "@netlify/database";
import pg from "pg";
import { createApp } from "../../server/app.js";
import { configFrom, poolDriver } from "../../server/lib.js";

let app;

function build() {
  const ownDb = process.env.DATABASE_URL;
  const pool = ownDb ? new pg.Pool({ connectionString: ownDb, max: 3 }) : getDatabase().pool;
  return createApp({ db: poolDriver(pool), config: configFrom(process.env) });
}

export default async (req) => {
  app ??= build();
  return app.fetch(req);
};

export const config = { path: "/api/*" };
