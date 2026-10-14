/**
 * Tick API — routes and rules. Platform-neutral (Hono): the same app runs as a
 * Netlify Function, on a plain Node server, or on any other Web-standard runtime.
 *
 * createApp({ db, config }) → Hono app. The database schema is applied by the host
 * (Netlify migrations, `npm run db:setup`, or server/node.js on start).
 */
import bcrypt from "bcryptjs";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { sign, verify } from "hono/jwt";
import {
  HttpError, addDays, checkEmbedding, dbError, decryptTemplate, encryptTemplate, matchFaces, todayIn,
} from "./lib.js";

export const MODEL_VERSION = "yunet-2023mar+sface-2021dec";

export function createApp({ db, config }) {
  const app = new Hono().basePath("/api");
  const q = db.query;

  // ---------- helpers ----------
  const need = (cond, status, msg) => { if (!cond) throw new HttpError(status, msg); };
  const text = (v, name) => {
    need(typeof v === "string" && v.trim(), 400, `${name} is required`);
    return v.trim();
  };
  const id = (v, what = "Record") => {
    const n = Number(v);
    need(Number.isInteger(n) && n > 0 && n < 2 ** 31, 404, `${what} not found`);
    return n;
  };
  const isoDate = (v) => {
    if (v == null || v === "") return todayIn(config.timeZone);
    need(typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)), 400, "Invalid date");
    return v;
  };
  const body = async (c) => { try { return (await c.req.json()) ?? {}; } catch { return {}; } };
  const audit = (userId, action, details) =>
    q("INSERT INTO audit_log (user_id, action, details) VALUES ($1, $2, $3)", [userId, action, JSON.stringify(details)]);
  const insert = (sql, params, dupe) => q(sql, params).catch((e) => { throw dbError(e, dupe); });

  // ---------- setup, errors ----------
  app.use("*", async (c, next) => {
    need(config.jwtSecret && config.templateKey, 503, "Tick isn't configured yet: set JWT_SECRET and TEMPLATE_KEY on the server");
    await next();
  });
  app.use("*", bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: "Request too large" }, 413) }));

  app.onError((err, c) => {
    const e = dbError(err);
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(err);
    return c.json({ error: status === 500 ? "Something went wrong" : e.message }, status);
  });
  app.notFound((c) => c.json({ error: "Not found" }, 404));

  // ---------- auth ----------
  const publicUser = (u) => ({ id: u.id, username: u.username, full_name: u.full_name, role: u.role });
  const signIn = async (u) => ({
    token: await sign({ ...publicUser(u), exp: Math.floor(Date.now() / 1000) + 12 * 3600 }, config.jwtSecret, "HS256"),
    user: publicUser(u),
  });
  const userCount = async () => (await q("SELECT count(*)::int AS n FROM users"))[0].n;

  const checkPassword = (pw) => {
    need(typeof pw === "string" && pw.length >= 8, 400, "Use a password of at least 8 characters");
    return pw;
  };
  const checkUsername = (v) => {
    const u = text(v, "Username").toLowerCase();
    need(/^[a-z0-9._-]{3,30}$/.test(u), 400, "Usernames use 3–30 letters, numbers, dots or dashes");
    return u;
  };

  const auth = async (c, next) => {
    const token = (c.req.header("authorization") || "").replace(/^Bearer /, "");
    let claims;
    try {
      claims = await verify(token, config.jwtSecret, "HS256");
    } catch {
      throw new HttpError(401, "Please sign in");
    }
    // Re-check the account on every request so removed or suspended staff lose access at once
    const [u] = await q("SELECT id, username, full_name, role, status FROM users WHERE id = $1", [Number(claims.id) || 0]);
    if (!u || u.status !== "active") throw new HttpError(401, "Please sign in");
    c.set("user", publicUser(u));
    await next();
  };
  const adminOnly = async (c, next) => { need(c.get("user").role === "admin", 403, "Admins only"); await next(); };

  /** Teachers may only work with their own classes. */
  async function loadClass(user, classId) {
    const [cls] = await q("SELECT * FROM classes WHERE id = $1", [id(classId, "Class")]);
    need(cls, 404, "Class not found");
    need(user.role === "admin" || cls.teacher_id === user.id, 403, "Not your class");
    return cls;
  }
  async function loadLearner(user, learnerId) {
    const [learner] = await q("SELECT * FROM learners WHERE id = $1", [id(learnerId, "Learner")]);
    need(learner, 404, "Learner not found");
    await loadClass(user, learner.class_id);
    return learner;
  }
  async function loadSession(user, sessionId) {
    const [s] = await q("SELECT * FROM attendance_sessions WHERE id = $1", [id(sessionId, "Session")]);
    need(s, 404, "Session not found");
    await loadClass(user, s.class_id);
    return s;
  }

  /** Tells the sign-up page whether this is a brand-new install. */
  app.get("/auth/status", async (c) => c.json({ needsSetup: (await userCount()) === 0 }));

  app.post("/auth/login", async (c) => {
    const b = await body(c);
    const [u] = await q("SELECT * FROM users WHERE lower(username) = lower($1)", [String(b.username || "").trim()]);
    need(u && (await bcrypt.compare(String(b.password || ""), u.password_hash)), 401, "That username and password don't match");
    need(u.status !== "pending", 403, "Your account is waiting for an administrator to approve it");
    need(u.status === "active", 403, "Your account has been suspended. Ask an administrator to restore it");
    return c.json(await signIn(u));
  });

  /** First account becomes the administrator; later accounts wait for approval. */
  app.post("/auth/signup", async (c) => {
    const b = await body(c);
    const fullName = text(b.full_name, "Full name");
    const username = checkUsername(b.username);
    const hash = await bcrypt.hash(checkPassword(b.password), 10);
    const first = (await userCount()) === 0;
    const [u] = await insert(
      "INSERT INTO users (username, full_name, password_hash, role, status) VALUES ($1,$2,$3,$4,$5) RETURNING *",
      [username, fullName, hash, first ? "admin" : "teacher", first ? "active" : "pending"],
      "That username is already taken",
    );
    await audit(u.id, "user.signup", { user_id: u.id, role: u.role, status: u.status });
    if (first) return c.json(await signIn(u), 201);
    return c.json({ pending: true }, 201);
  });

  // Everything below needs a signed-in user
  app.use("*", async (c, next) => (c.req.path.startsWith("/api/auth/") ? next() : auth(c, next)));

  app.get("/me", (c) => c.json(c.get("user")));

  app.patch("/me", async (c) => {
    const b = await body(c);
    const [u] = await q("SELECT * FROM users WHERE id = $1", [c.get("user").id]);
    const fullName = b.full_name !== undefined ? text(b.full_name, "Full name") : u.full_name;
    let hash = u.password_hash;
    if (b.new_password) {
      need(await bcrypt.compare(String(b.current_password || ""), u.password_hash), 400, "Your current password is wrong");
      hash = await bcrypt.hash(checkPassword(b.new_password), 10);
    }
    await q("UPDATE users SET full_name = $1, password_hash = $2 WHERE id = $3", [fullName, hash, u.id]);
    await audit(u.id, "user.update_self", { password_changed: !!b.new_password });
    return c.json({ ...c.get("user"), full_name: fullName });
  });

  // ---------- staff ----------
  app.get("/users", async (c) => {
    const admin = c.get("user").role === "admin";
    return c.json(await q(
      `SELECT u.id, u.username, u.full_name, u.role, u.status,
              (SELECT count(*)::int FROM classes c WHERE c.teacher_id = u.id AND c.status = 'active') AS class_count
         FROM users u ${admin ? "" : "WHERE u.status = 'active'"}
        ORDER BY u.status DESC, u.full_name`,
    ));
  });

  app.post("/users", adminOnly, async (c) => {
    const b = await body(c);
    const role = b.role === "admin" ? "admin" : "teacher";
    const [u] = await insert(
      "INSERT INTO users (username, full_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, username, full_name, role, status",
      [checkUsername(b.username), text(b.full_name, "Full name"), await bcrypt.hash(checkPassword(b.password), 10), role],
      "That username is already taken",
    );
    await audit(c.get("user").id, "user.create", { user_id: u.id });
    return c.json(u, 201);
  });

  /** Approve, suspend, or change the role of a staff member. */
  app.patch("/users/:id", adminOnly, async (c) => {
    const b = await body(c);
    const me = c.get("user");
    const [u] = await q("SELECT * FROM users WHERE id = $1", [id(c.req.param("id"), "Staff member")]);
    need(u, 404, "Staff member not found");
    need(u.id !== me.id, 400, "You can't change your own access");
    const status = b.status ?? u.status;
    const role = b.role ?? u.role;
    need(["active", "pending", "suspended"].includes(status), 400, "Invalid status");
    need(["admin", "teacher"].includes(role), 400, "Invalid role");
    const [out] = await q(
      "UPDATE users SET status = $1, role = $2 WHERE id = $3 RETURNING id, username, full_name, role, status",
      [status, role, u.id],
    );
    await audit(me.id, "user.update", { user_id: u.id, status, role });
    return c.json(out);
  });

  /** Decline a sign-up request (only pending accounts can be removed). */
  app.delete("/users/:id", adminOnly, async (c) => {
    const userId = id(c.req.param("id"), "Staff member");
    const rows = await q("DELETE FROM users WHERE id = $1 AND status = 'pending' RETURNING id", [userId]);
    need(rows.length, 400, "Only pending sign-up requests can be declined");
    await audit(c.get("user").id, "user.decline", { user_id: userId });
    return c.body(null, 204);
  });

  // ---------- today ----------
  app.get("/dashboard", async (c) => {
    const user = c.get("user");
    const admin = user.role === "admin";
    const today = todayIn(config.timeZone);
    // Teachers see their own classes; `at` is the placeholder number for the teacher id
    const scope = (at) => (admin ? "TRUE" : `c.teacher_id = $${at}`);
    const mine = admin ? [] : [user.id];
    const [totals] = await q(
      `SELECT count(DISTINCT c.id)::int AS classes,
              count(l.id)::int AS learners,
              sum(CASE WHEN EXISTS (SELECT 1 FROM face_templates t WHERE t.learner_id = l.id AND t.revoked_at IS NULL) THEN 1 ELSE 0 END)::int AS with_face,
              sum(CASE WHEN NOT l.consent THEN 1 ELSE 0 END)::int AS no_consent
         FROM classes c LEFT JOIN learners l ON l.class_id = c.id AND l.status = 'active'
        WHERE c.status = 'active' AND ${scope(1)}`,
      mine,
    );
    const classes = await q(
      `SELECT c.id, c.name, c.academic_year, u.full_name AS teacher_name,
              (SELECT count(*)::int FROM learners l WHERE l.class_id = c.id AND l.status = 'active') AS learner_count,
              s.id AS session_id, s.session_type,
              (SELECT count(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'present') AS present,
              (SELECT count(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'absent') AS absent
         FROM classes c
         LEFT JOIN users u ON u.id = c.teacher_id
         LEFT JOIN attendance_sessions s ON s.id = (
           SELECT id FROM attendance_sessions x WHERE x.class_id = c.id AND x.session_date = $1
            ORDER BY x.id DESC LIMIT 1)
        WHERE c.status = 'active' AND ${scope(2)}
        ORDER BY c.name`,
      [today, ...mine],
    );
    // Present share for each of the last 7 school days that had a register
    const week = await q(
      `SELECT s.session_date AS day,
              sum(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END)::int AS present,
              count(r.id)::int AS marked
         FROM attendance_sessions s
         JOIN classes c ON c.id = s.class_id
         JOIN attendance_records r ON r.session_id = s.id
        WHERE s.session_date >= $1 AND ${scope(2)}
        GROUP BY s.session_date ORDER BY s.session_date`,
      [addDays(today, -6), ...mine],
    );
    const pending = admin ? (await q("SELECT count(*)::int AS n FROM users WHERE status = 'pending'"))[0].n : 0;
    return c.json({ totals, classes, week, pending });
  });

  // ---------- classes ----------
  app.get("/classes", async (c) => {
    const user = c.get("user");
    return c.json(await q(
      `SELECT c.*, u.full_name AS teacher_name,
              (SELECT count(*)::int FROM learners l WHERE l.class_id = c.id AND l.status = 'active') AS learner_count,
              (SELECT count(*)::int FROM learners l WHERE l.class_id = c.id AND l.status = 'active'
                  AND EXISTS (SELECT 1 FROM face_templates t WHERE t.learner_id = l.id AND t.revoked_at IS NULL)) AS face_count
         FROM classes c LEFT JOIN users u ON u.id = c.teacher_id
        WHERE ($1::text = 'admin' OR c.teacher_id = $2)
        ORDER BY c.status, c.academic_year DESC, c.name`,
      [user.role, user.id],
    ));
  });

  const teacherOrNull = (v) => (v === null || v === undefined || v === "" ? null : id(v, "Teacher"));
  const year = (v) => {
    const n = Number(v) || new Date().getFullYear();
    need(Number.isInteger(n) && n >= 2000 && n <= 2100, 400, "Invalid year");
    return n;
  };

  app.post("/classes", adminOnly, async (c) => {
    const b = await body(c);
    const [cls] = await insert(
      "INSERT INTO classes (name, academic_year, teacher_id) VALUES ($1,$2,$3) RETURNING *",
      [text(b.name, "Class name"), year(b.academic_year), teacherOrNull(b.teacher_id)],
      "An active class with that name already exists this year",
    );
    await audit(c.get("user").id, "class.create", { class_id: cls.id });
    return c.json(cls, 201);
  });

  app.patch("/classes/:id", adminOnly, async (c) => {
    const cls = await loadClass(c.get("user"), c.req.param("id"));
    const b = { ...cls, ...(await body(c)) };
    need(["active", "archived"].includes(b.status), 400, "Invalid status");
    const [out] = await insert(
      "UPDATE classes SET name=$1, academic_year=$2, teacher_id=$3, status=$4 WHERE id=$5 RETURNING *",
      [text(b.name, "Class name"), year(b.academic_year), teacherOrNull(b.teacher_id), b.status, cls.id],
      "An active class with that name already exists this year",
    );
    await audit(c.get("user").id, "class.update", { class_id: out.id, status: out.status });
    return c.json(out);
  });

  app.get("/classes/:id", async (c) => {
    const cls = await loadClass(c.get("user"), c.req.param("id"));
    const [t] = cls.teacher_id ? await q("SELECT full_name FROM users WHERE id = $1", [cls.teacher_id]) : [];
    return c.json({ ...cls, teacher_name: t?.full_name ?? null });
  });

  app.get("/classes/:id/learners", async (c) => {
    const cls = await loadClass(c.get("user"), c.req.param("id"));
    return c.json(await q(
      `SELECT l.*, (SELECT count(*)::int FROM face_templates t WHERE t.learner_id = l.id AND t.revoked_at IS NULL) AS template_count
         FROM learners l WHERE l.class_id = $1 ORDER BY l.status, l.full_name`,
      [cls.id],
    ));
  });

  app.get("/classes/:id/sessions", async (c) => {
    const cls = await loadClass(c.get("user"), c.req.param("id"));
    return c.json(await q(
      `SELECT s.*,
              (SELECT count(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'present') AS present,
              (SELECT count(*)::int FROM attendance_records r WHERE r.session_id = s.id AND r.status = 'absent') AS absent
         FROM attendance_sessions s WHERE s.class_id = $1 ORDER BY s.session_date DESC, s.id DESC LIMIT 60`,
      [cls.id],
    ));
  });

  // ---------- learners ----------
  app.post("/learners", async (c) => {
    const b = await body(c);
    const cls = await loadClass(c.get("user"), b.class_id);
    need(cls.status === "active", 400, "That class is archived");
    const [l] = await insert(
      "INSERT INTO learners (student_number, full_name, class_id, consent) VALUES ($1,$2,$3,$4) RETURNING *",
      [text(b.student_number, "Student number"), text(b.full_name, "Full name"), cls.id, !!b.consent],
      "That student number is already enrolled",
    );
    await audit(c.get("user").id, "learner.create", { learner_id: l.id });
    return c.json(l, 201);
  });

  app.get("/learners/:id", async (c) => {
    const learner = await loadLearner(c.get("user"), c.req.param("id"));
    const templates = await q(
      "SELECT id, model_version, created_at FROM face_templates WHERE learner_id = $1 AND revoked_at IS NULL ORDER BY id",
      [learner.id],
    );
    return c.json({ ...learner, templates });
  });

  app.patch("/learners/:id", async (c) => {
    const user = c.get("user");
    const learner = await loadLearner(user, c.req.param("id"));
    const b = { ...learner, ...(await body(c)) };
    need(["active", "inactive"].includes(b.status), 400, "Invalid status");
    if (Number(b.class_id) !== learner.class_id) await loadClass(user, b.class_id);
    const l = await db.tx(async (tq) => {
      const [row] = await tq(
        "UPDATE learners SET student_number=$1, full_name=$2, class_id=$3, status=$4, consent=$5 WHERE id=$6 RETURNING *",
        [text(b.student_number, "Student number"), text(b.full_name, "Full name"), Number(b.class_id), b.status, !!b.consent, learner.id],
      );
      // Withdrawing consent removes the learner's face data
      if (learner.consent && !row.consent) {
        await tq("UPDATE face_templates SET revoked_at = now() WHERE learner_id = $1 AND revoked_at IS NULL", [row.id]);
      }
      return row;
    }).catch((e) => { throw dbError(e, "That student number is already enrolled"); });
    await audit(user.id, "learner.update", { learner_id: l.id, status: l.status, consent: l.consent });
    return c.json(l);
  });

  // ---------- face templates (the browser sends an embedding; photos never reach the server) ----------
  app.post("/learners/:id/face-templates", async (c) => {
    const learner = await loadLearner(c.get("user"), c.req.param("id"));
    need(learner.consent, 400, "Record guardian consent before adding a face");
    need(learner.status === "active", 400, "Learner is inactive");
    const b = await body(c);
    need(b.model_version === MODEL_VERSION, 400, "This page is out of date — reload it and try again");
    const embedding = checkEmbedding(b.embedding);
    const [{ n }] = await q("SELECT count(*)::int AS n FROM face_templates WHERE learner_id = $1 AND revoked_at IS NULL", [learner.id]);
    need(n < 3, 400, "A learner can have up to 3 face photos. Remove one first");
    const [t] = await q(
      "INSERT INTO face_templates (learner_id, template_data, model_version) VALUES ($1,$2,$3) RETURNING id, model_version, created_at",
      [learner.id, await encryptTemplate(config.templateKey, embedding), MODEL_VERSION],
    );
    await audit(c.get("user").id, "template.create", { learner_id: learner.id, template_id: t.id });
    return c.json(t, 201);
  });

  app.delete("/learners/:id/face-templates/:templateId", async (c) => {
    const learner = await loadLearner(c.get("user"), c.req.param("id"));
    const rows = await q(
      "UPDATE face_templates SET revoked_at = now() WHERE id = $1 AND learner_id = $2 AND revoked_at IS NULL RETURNING id",
      [id(c.req.param("templateId"), "Template"), learner.id],
    );
    need(rows.length, 404, "Template not found");
    await audit(c.get("user").id, "template.revoke", { learner_id: learner.id, template_id: rows[0].id });
    return c.body(null, 204);
  });

  // ---------- attendance ----------
  app.post("/attendance/sessions", async (c) => {
    const b = await body(c);
    const cls = await loadClass(c.get("user"), b.class_id);
    need(cls.status === "active", 400, "That class is archived");
    const type = String(b.session_type || "Morning register").trim().slice(0, 60) || "Morning register";
    // Re-opening the same register returns the existing session
    const [s] = await q(
      `INSERT INTO attendance_sessions (class_id, session_date, session_type, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (class_id, session_date, session_type) DO UPDATE SET session_type = EXCLUDED.session_type
       RETURNING *`,
      [cls.id, isoDate(b.session_date), type, c.get("user").id],
    );
    return c.json(s, 201);
  });

  app.get("/attendance/sessions/:id", async (c) => {
    const s = await loadSession(c.get("user"), c.req.param("id"));
    const [cls] = await q("SELECT id, name, academic_year FROM classes WHERE id = $1", [s.class_id]);
    const learners = await q(
      `SELECT l.id, l.student_number, l.full_name, l.consent,
              (SELECT count(*)::int FROM face_templates t WHERE t.learner_id = l.id AND t.revoked_at IS NULL) AS template_count,
              r.status, r.method, r.similarity, r.recorded_at, u.full_name AS confirmed_by
         FROM learners l
         LEFT JOIN attendance_records r ON r.learner_id = l.id AND r.session_id = $1
         LEFT JOIN users u ON u.id = r.confirmed_by
        WHERE l.class_id = $2 AND (l.status = 'active' OR r.id IS NOT NULL)
        ORDER BY l.full_name`,
      [s.id, s.class_id],
    );
    return c.json({ ...s, class: cls, learners });
  });

  /** Proposes matches only — nothing is saved until the teacher confirms. */
  app.post("/recognition/match", async (c) => {
    const b = await body(c);
    const s = await loadSession(c.get("user"), b.session_id);
    need(Array.isArray(b.faces) && b.faces.length <= 300, 400, "Invalid face data");
    const faces = b.faces.map((f) => {
      need(Array.isArray(f?.box) && f.box.length === 4 && f.box.every(Number.isFinite), 400, "Invalid face data");
      return { box: f.box.map(Math.round), embedding: checkEmbedding(f.embedding) };
    });
    const rows = await q(
      `SELECT t.learner_id, t.template_data FROM face_templates t JOIN learners l ON l.id = t.learner_id
        WHERE l.class_id = $1 AND l.status = 'active' AND l.consent AND t.revoked_at IS NULL`,
      [s.class_id],
    );
    const templates = await Promise.all(rows.map(async (r) => ({
      learner_id: r.learner_id, vector: await decryptTemplate(config.templateKey, r.template_data),
    })));
    const results = matchFaces(faces, templates, config);
    await audit(c.get("user").id, "recognition.run", {
      session_id: s.id,
      faces: results.length,
      proposed: results.filter((r) => r.learner_id).map((r) => ({ learner_id: r.learner_id, similarity: r.similarity })),
    });
    return c.json({ width: Number(b.width) || 0, height: Number(b.height) || 0, faces: results });
  });

  /** Save teacher-confirmed decisions. Re-saving a learner updates their record (one per session). */
  app.post("/attendance/records", async (c) => {
    const b = await body(c);
    const user = c.get("user");
    const s = await loadSession(user, b.session_id);
    const records = Array.isArray(b.records) ? b.records : [];
    need(records.length && records.length <= 500, 400, "Nothing to save");
    const valid = new Set((await q("SELECT id FROM learners WHERE class_id = $1", [s.class_id])).map((r) => r.id));
    for (const r of records) {
      need(valid.has(r.learner_id), 400, "Learner is not in this class");
      need(["present", "absent"].includes(r.status), 400, "Invalid status");
    }
    await db.tx(async (tq) => {
      for (const r of records) {
        const method = r.method === "face" ? "face" : "manual";
        const sim = method === "face" && Number.isFinite(r.similarity) ? r.similarity : null;
        await tq(
          `INSERT INTO attendance_records (session_id, learner_id, status, method, similarity, confirmed_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (session_id, learner_id) DO UPDATE
             SET status = EXCLUDED.status, method = EXCLUDED.method, similarity = EXCLUDED.similarity,
                 confirmed_by = EXCLUDED.confirmed_by, recorded_at = now()`,
          [s.id, r.learner_id, r.status, method, sim, user.id],
        );
      }
    });
    await audit(user.id, "attendance.save", {
      session_id: s.id, records: records.map((r) => ({ learner_id: r.learner_id, status: r.status, method: r.method })),
    });
    return c.json({ saved: records.length });
  });

  app.delete("/attendance/sessions/:id/records/:learnerId", async (c) => {
    const s = await loadSession(c.get("user"), c.req.param("id"));
    const learnerId = id(c.req.param("learnerId"), "Learner");
    await q("DELETE FROM attendance_records WHERE session_id = $1 AND learner_id = $2", [s.id, learnerId]);
    await audit(c.get("user").id, "attendance.clear", { session_id: s.id, learner_id: learnerId });
    return c.body(null, 204);
  });

  return app;
}
