# Tick — school attendance by face recognition (version 4: host it anywhere)

Teachers take the register **live through the camera** — names appear on learners' faces as they walk past, no photo to take — or from a photo of the whole class. A teacher confirms every match (or switches on auto-marking for clear matches). Marking by hand always works. Tick **installs on phones like a native app**.

This version runs **online on Netlify**, **on one school computer with no internet**, or **in Docker on any server**. It is the same app in every case.

```
Phone / laptop browser                                 Server (Netlify Function, or Node on a school PC)
┌──────────────────────────────────────┐              ┌───────────────────────────────────────┐
│ React app                            │   JSON only  │ API (Hono): login, permissions,       │
│ Face recognition (YuNet + SFace,     │ ───────────► │ consent, matching, audit log          │
│ WebAssembly) — the photo stays here  │  embeddings  │ Templates encrypted (AES-256-GCM)     │
└──────────────────────────────────────┘              └──────────────────┬────────────────────┘
                                                                         ▼
                                                      Postgres: Netlify Database · any Postgres ·
                                                      or the built-in database (PGlite, a folder)
```

## What changed from version 3

| Version 3 | Version 4 | Why |
|---|---|---|
| Python + OpenCV face service | Face recognition runs **in the browser** (onnxruntime-web, same two OpenCV models) | Netlify (and most hosts) can't run a Python server next to the app. Bonus: photos never leave the device — only 128 numbers per face are sent. |
| SQLite file (`data/attend.db`) | **Postgres** — Netlify Database online; a built-in Postgres (PGlite) on a school PC | Serverless hosts have no permanent disk. One SQL dialect everywhere. |
| Express + multer, Node-only crypto | **Hono** + Web Crypto | The same API code runs on Netlify, Node, Vercel, Cloudflare, Deno, Bun. |
| Node **and** Python to install | **Node only** | `start.bat` is simpler; Docker is one small container. |

Compatibility, checked: the browser pipeline gives the same faces, boxes and scores as the old OpenCV service, with embeddings at ≥ 0.9993 cosine similarity to the old ones. Face templates and passwords from version 3 carry over (see *Moving from version 3*).

## 1. Put it on Netlify

You need a Netlify account on a credit-based plan (Netlify Database is only on those plans) and this folder in a Git repository (GitHub, GitLab…).

1. **Push this folder to a new repository.** `sface.onnx` (38 MB) is git-ignored; the build downloads it from the OpenCV model zoo and checks its fingerprint.
2. In Netlify: **Add new project → Import an existing project**, and pick the repository. The settings come from `netlify.toml` (build `npm run build`, publish `web/dist`, function `netlify/functions/api.mjs`).
3. **Before the first deploy**, open **Project configuration → Environment variables** and add:
   - `JWT_SECRET`: a long random value
   - `TEMPLATE_KEY`: a long random value. Moving from version 3? Use the old value instead (see below).
   - `SCHOOL_TZ`: `Africa/Lusaka`. This is the default, so it's optional.

   To make a random value, run `openssl rand -hex 32`, or use any password generator with 40+ characters.
4. **Deploy.** Netlify sees `@netlify/database`, creates the database, and applies `netlify/database/migrations/0001_initial-schema.sql` before publishing.
5. Open the site and choose **Set up your school**. The first account becomes the administrator.

Notes
- The site is HTTPS automatically, so the **camera works on phones and tablets** (on a LAN it needs extra setup).
- The first time a device scans, it downloads the face model (about 38 MB plus 4 MB of runtime). The browser keeps it, so later scans start straight away and work on weak connections. On mobile data, do the first scan on Wi-Fi.
- Deploy previews get their own database branch, so testing a change never touches the real register.
- **Use your own Postgres instead** (Neon, Supabase, or Netlify Database on a non-credit plan): set `DATABASE_URL` in the environment variables, then run `DATABASE_URL=… npm run db:setup` once from your computer.
- Try it locally exactly as Netlify runs it: `npm i -g netlify-cli`, then `netlify dev`. That starts a local Postgres for you.

## 2. Run it on a school computer (no internet needed)

Needs **Node.js 22.13+** (nodejs.org). Python is no longer needed.

- **Windows:** double-click **`start.bat`**. The first run installs packages and builds the app (it downloads the face model unless `web\public\models\sface.onnx` is already there). Then it opens http://localhost:4000.
- **Linux / macOS / Raspberry Pi:** `./start.sh`

Data lives in `data/`. `data/pgdata` is the database. `data/secrets.json` holds auto-generated secrets if you didn't set your own in `.env`. **Back up the whole `data` folder**, with the app stopped.

Other devices on the school network can use `http://<this-computer's-ip>:4000`. The address is printed at start. Phones need HTTPS for the camera: put Caddy in front, or teachers can use **Choose photo** with the phone's camera app.

To use a real Postgres server instead of the built-in one, set `DATABASE_URL` in `.env`.

## 3. Run it with Docker (any VPS, Render, Railway, Fly.io…)

```bash
docker compose up -d --build        # http://localhost:4000
```

One container, no Python. Data stays in the `tickdata` volume. On hosts that give you a Postgres database (Render, Railway, Fly), set `DATABASE_URL` and the container uses it.

## Moving from version 3

1. Stop the old app (close both windows) so `data\attend.db` is complete.
2. Copy the old **`.env`** into this folder. The **`TEMPLATE_KEY` must stay the same**, or enrolled faces can't be read. If the old install never had a `.env`, the old key was `change-me-too`. Set `TEMPLATE_KEY=change-me-too` here, import, and keep it.
3. Import into the new database:
   - Local: `npm install`, then `npm run import-sqlite -- "..\attend\data\attend.db"`
   - Netlify: copy the database connection string from **Data & Storage → Database**, then run
     `set DATABASE_URL=<that string>` (Windows) or `export DATABASE_URL=…`, and then the same `npm run import-sqlite` command. Put the same `TEMPLATE_KEY` in Netlify's environment variables.
4. Everyone signs in with their old username and password.

The import refuses to run into a database that already has accounts (add `--force` only if you know why).

## Other platforms

The API is one Hono app (`server/app.js`) that takes a database and settings. Each host only needs a short entry file:

| Platform | How | Database |
|---|---|---|
| **Netlify** ✅ included | `netlify/functions/api.mjs` | Netlify Database, or `DATABASE_URL` |
| **Any computer / VPS / Raspberry Pi** ✅ included | `server/node.js` (`start.bat`, `start.sh`) | built-in PGlite, or `DATABASE_URL` |
| **Docker: Render, Railway, Fly.io, Koyeb, DigitalOcean** ✅ included | `Dockerfile` | volume, or the host's Postgres |
| Vercel | `api/[[...route]].js` exporting `handle(app)` from `hono/vercel`; set output dir `web/dist` | Neon / Supabase via `DATABASE_URL` |
| Cloudflare Pages + Workers | Worker exporting `app.fetch` (with `nodejs_compat`); static files from `web/dist` | Neon serverless driver or Hyperdrive |
| Split hosting (e.g. GitHub Pages for the app) | build with `VITE_API_URL=https://your-api…` | wherever the API runs |

For **phones**, Tick installs to the home screen as a PWA (see *Install it on a phone*). If you ever need a Play Store APK, the same site can be wrapped with Bubblewrap (Trusted Web Activity) or Capacitor.

## Live recognition (no photo needed)

On a register, **Recognise → Live → Start camera**. Tick reads the camera about 10 times a second on the device itself:

- Faces are found in every frame and followed as they move. Each new face is identified once (uncertain ones are re-checked every second or so), so the server gets a few small requests, not a video. The video never leaves the device.
- Green box = clear match, amber = check, red = not known. Seen learners collect in a list; **Confirm N present** saves them.
- **Auto-mark clear matches** saves clear matches the moment they're seen (good for a queue at the classroom door). Uncertain faces always wait for the teacher, and the camera never marks anyone absent.
- **Switch camera** (phones/tablets) flips between front and back.
- Enrolling a learner: **Live camera** captures the face by itself once exactly one face is close, clear and still — then *Add another angle* for a second or third.

The camera needs HTTPS (or `localhost`). **Photo** mode is still there for whole-class photos.

## Install it on a phone (PWA)

Open the HTTPS site (e.g. your Netlify address) on the phone:

- **Android (Chrome, Edge, Samsung Internet):** an *Install Tick on this phone* card appears — tap **Install**. Or menu ⋮ → *Install app*.
- **iPhone / iPad (Safari):** tap **Install** on the card for the steps: Share → *Add to Home Screen*.
- Also in **Settings → Tick app**, and on the landing page.

Installed, Tick opens full-screen from its own icon, starts straight at sign-in, keeps working on a weak connection (the app and face models are cached), and offers **Update** when a new version is deployed. Registers are always fetched live, never from a stale copy. On a school LAN over plain `http://`, phones can't install it or use the camera — use the Netlify site, or put Caddy in front for HTTPS.

## Managing records (CRUD)

| | Create | Read / find | Update | Delete |
|---|---|---|---|---|
| **Staff** (admin) | Add staff, or approve sign-ups | Staff list + search | Name, username, role, **reset password**, suspend/restore | Delete accounts that never took a register (others: suspend, so history keeps their name) |
| **Classes** (admin) | New class | List + search (also finds learners) | Name, year, teacher, archive/restore | **Delete class** — type its name to confirm; removes its learners, faces and registers |
| **Learners** | Enrol one, or **Import list** (paste "number, name" lines or two Excel columns) | Search in a class or across all classes | Details, **move to another class**, consent, active/inactive, faces | **Delete learner** — face data and attendance marks too |
| **Registers** | Take today's, or another date / sitting | Class → Registers | **Change date or name**; marks per learner | **Delete register** and its marks |

Every change is written to the audit log.

## Before going live — checklist

- [ ] Signed guardian consent forms on file, and school/DEBS approval
- [ ] Strong `JWT_SECRET`, `TEMPLATE_KEY` and admin password; `TEMPLATE_KEY` stored safely, separate from backups
- [ ] **Hosting online means learners' data leaves the school.** Check this against the Zambia Data Protection Act, 2021, note where the database is hosted (its region defaults to the site's functions region), and record it in your data-handling notes
- [ ] Backups: Netlify Database snapshots, or a copy of `data/` for local installs
- [ ] Accuracy tested in your classrooms' light, across all learner groups
- [ ] Retention rule agreed: when a learner leaves, withdraw consent (this deletes their face data) and mark them inactive

## Tuning recognition

Set these as environment variables.

| Setting | Default | Meaning |
|---|---|---|
| `REVIEW_THRESHOLD` | 0.363 | Below this → "not recognized" (SFace's published cut-off) |
| `MATCH_THRESHOLD` | 0.45 | At or above this → "likely", pre-ticked. Between the two → "check" |

Faces smaller than 60 px (after the photo is scaled to 1280 px) are ignored.

## Project layout

```
netlify.toml                    Netlify build, function and headers
netlify/functions/api.mjs       the API as a Netlify Function
netlify/database/migrations/    schema, applied by Netlify on deploy
server/app.js                   all routes and rules (platform-neutral)
server/lib.js                   config, Postgres driver, encryption, matching
server/node.js                  run on any computer: web app + API on port 4000
server/schema.sql               tables (Postgres)
web/src/face/core.ts            YuNet + SFace pipeline (port of the OpenCV code)
web/src/face/index.ts           model download/caching, photo decoding
web/src/face/live.ts            live camera: frame reader, face tracking, loop
web/src/face/live-ui.tsx        live register + auto-capture enrolment
web/src/pwa.tsx                 install prompt, service worker, update banner
web/public/manifest.webmanifest, sw.js, icons/   the installable app
web/src/pages/                  landing, auth, today, classes, learner, register, staff, settings
web/public/models/              yunet.onnx (in repo), sface.onnx (downloaded at build)
scripts/                        fetch-models, db-setup, import-sqlite
start.bat / start.sh / Dockerfile
```

## API

All routes need `Authorization: Bearer <token>` except `/api/auth/*`. Requests and responses are JSON. Photos are never sent.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/status` | Is this a new install? |
| POST | `/api/auth/signup` · `/api/auth/login` | Create account (first = admin) · sign in |
| GET/PATCH | `/api/me` | Own profile, name, password |
| GET/POST, PATCH/DELETE | `/api/users`, `/api/users/:id` | Staff (admin): edit, reset password, delete |
| GET | `/api/dashboard` | Today's registers, week, totals |
| GET/POST, GET/PATCH | `/api/classes`, `/api/classes/:id` | Classes |
| GET | `/api/classes/:id/learners` · `/sessions` | Learners · registers of a class |
| POST, GET/PATCH/DELETE | `/api/learners`, `/api/learners/:id` | Learners, consent, move class, delete |
| POST | `/api/learners/bulk` | `{ class_id, consent, learners:[{student_number, full_name}] }` |
| GET | `/api/learners?q=` | Search learners by name or number |
| DELETE | `/api/classes/:id` | Delete a class and everything in it (admin) |
| PATCH/DELETE | `/api/attendance/sessions/:id` | Change a register's date/name · delete it |
| POST | `/api/learners/:id/face-templates` | `{ embedding[128], model_version }` from the browser |
| DELETE | `/api/learners/:id/face-templates/:templateId` | Revoke a face |
| POST, GET | `/api/attendance/sessions`, `/:id` | Open / view a register |
| POST | `/api/recognition/match` | `{ session_id, width, height, faces:[{box, embedding}], live? }` → proposals; saves nothing |
| POST | `/api/attendance/records` | Save confirmed decisions |
| DELETE | `/api/attendance/sessions/:id/records/:learnerId` | Clear a mark |
