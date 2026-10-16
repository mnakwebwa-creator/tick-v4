import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, CalendarPlus, ChevronLeft, ChevronRight, ClipboardList, FileUp, Pencil, Plus, School, Trash2, UserPlus, Users } from "lucide-react";
import { api, openRegister, type Class, type Learner, type LearnerHit, type Session, type Staff, type User } from "../api";
import {
  Alert, Avatar, ConfirmDelete, Dialog, Empty, SearchBox, Spinner, fmtDate, matches, plural, today, useAction, useLoad, useToast,
} from "../ui";

/* ---------- list ---------- */

export function ClassesPage({ user, startNew }: { user: User; startNew?: boolean }) {
  const classes = useLoad(() => api<Class[]>("/classes"), []);
  const [show, setShow] = useState<"active" | "archived">("active");
  const [creating, setCreating] = useState(!!startNew && user.role === "admin");
  const [term, setTerm] = useState("");
  const hits = useLearnerSearch(term);
  const admin = user.role === "admin";
  const list = classes.data?.filter((c) => c.status === show && matches(term, c.name, c.teacher_name, String(c.academic_year))) ?? [];
  const archivedCount = classes.data?.filter((c) => c.status === "archived").length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Classes</h1>
          <p className="muted" style={{ marginTop: 6 }}>{admin ? "Every class in the school." : "The classes you teach."}</p>
        </div>
        <div className="actions">
          {archivedCount > 0 && (
            <div className="seg" role="tablist">
              <button className={show === "active" ? "on" : ""} onClick={() => setShow("active")}>Current</button>
              <button className={show === "archived" ? "on" : ""} onClick={() => setShow("archived")}>Archived</button>
            </div>
          )}
          {admin && <button className="btn primary" onClick={() => setCreating(true)}><Plus /> New class</button>}
        </div>
      </div>

      <Alert msg={classes.error} />
      {!classes.data && !classes.error && <Spinner />}

      {!!classes.data?.length && (
        <div className="toolbar"><SearchBox value={term} onChange={setTerm} placeholder="Search classes and learners" /></div>
      )}

      {hits.length > 0 && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="ph"><h2>Learners</h2><span className="faint small">{plural(hits.length, "match", "matches")}</span></div>
          <div className="rows">
            {hits.map((l) => (
              <a className="row" key={l.id} href={`#/learners/${l.id}`}>
                <Avatar name={l.full_name} />
                <div className="grow"><b>{l.full_name}</b><small>{l.student_number}, {l.class_name}</small></div>
                {l.status === "inactive" && <span className="badge">Inactive</span>}
                <ChevronRight className="chev" />
              </a>
            ))}
          </div>
        </section>
      )}

      {classes.data && (term && !list.length ? (
        !hits.length && <p className="muted">Nothing matches “{term}”.</p>
      ) : (
        <section className="panel">
          {list.length === 0 ? (
            <Empty
              icon={<School />}
              title={show === "archived" ? "No archived classes" : admin ? "Create your first class" : "No classes yet"}
              action={admin && show === "active" ? <button className="btn primary" onClick={() => setCreating(true)}><Plus /> New class</button> : undefined}
            >
              {show === "archived" ? "Classes you archive at the end of a year are kept here."
                : admin ? "A class holds learners and their daily registers. Give it a name and choose its teacher."
                : "Ask your administrator to assign you a class."}
            </Empty>
          ) : (
            <div className="rows">
              {list.map((c) => {
                const n = c.learner_count ?? 0;
                const f = c.face_count ?? 0;
                return (
                  <a className="row" key={c.id} href={`#/classes/${c.id}`}>
                    <span className="avatar" style={{ borderRadius: 12, width: 44, height: 44, fontSize: 14 }} aria-hidden>
                      {c.name.replace(/^form\s*/i, "F").slice(0, 3)}
                    </span>
                    <div className="grow">
                      <b>{c.name}</b>
                      <small>{c.teacher_name ?? "No teacher assigned"}, {c.academic_year}</small>
                    </div>
                    <div style={{ width: 160 }} className="hide-sm">
                      <div className="bar" role="img" aria-label={`${f} of ${n} learners have a face added`}>
                        <i className="f" style={{ width: `${n ? (f / n) * 100 : 0}%` }} />
                      </div>
                      <small className="faint" style={{ fontSize: 12.5 }}>{n ? `${f} of ${plural(n, "learner")} with faces` : "No learners yet"}</small>
                    </div>
                    <ChevronRight className="chev" />
                  </a>
                );
              })}
            </div>
          )}
        </section>
      ))}

      {admin && <ClassForm open={creating} onClose={() => setCreating(false)} onSaved={(c) => { location.hash = `#/classes/${c.id}`; }} />}
    </>
  );
}

/** Search learners across the classes this person can see (debounced). */
function useLearnerSearch(term: string) {
  const [hits, setHits] = useState<LearnerHit[]>([]);
  useEffect(() => {
    const t = term.trim();
    if (t.length < 2) { setHits([]); return; }
    const timer = setTimeout(() => api<LearnerHit[]>(`/learners?q=${encodeURIComponent(t)}`).then(setHits, () => setHits([])), 250);
    return () => clearTimeout(timer);
  }, [term]);
  return hits;
}

function ClassForm({ open, onClose, onSaved, cls, onDelete }: {
  open: boolean; onClose: () => void; onSaved: (c: Class) => void; cls?: Class; onDelete?: () => void;
}) {
  const staff = useLoad(() => (open ? api<Staff[]>("/users") : Promise.resolve([])), [open]);
  const { busy, error, run } = useAction();
  const toast = useToast();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get("name"), academic_year: Number(f.get("year")), teacher_id: Number(f.get("teacher")) || null };
    run(async () => {
      const c = await api<Class>(cls ? `/classes/${cls.id}` : "/classes", { method: cls ? "PATCH" : "POST", body });
      toast(cls ? "Class updated" : `${c.name} created`);
      onSaved(c);
      onClose();
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title={cls ? "Edit class" : "New class"} intro={cls ? undefined : "You can add learners straight after."}>
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Class name</span><input className="input" name="name" defaultValue={cls?.name} placeholder="e.g. Form 2A" required autoFocus /></label>
        <label className="field"><span>Academic year</span><input className="input" name="year" type="number" min={2000} max={2100} defaultValue={cls?.academic_year ?? new Date().getFullYear()} required /></label>
        <label className="field">
          <span>Class teacher</span>
          <select className="input" name="teacher" defaultValue={cls?.teacher_id ?? ""}>
            <option value="">No teacher yet</option>
            {staff.data?.filter((s) => s.status === "active").map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </select>
          <small>The teacher sees this class and takes its register. Administrators see every class.</small>
        </label>
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{cls ? "Save changes" : "Create class"}</button>
        </footer>
        {cls && onDelete && (
          <div className="danger-zone">
            <div><b>Delete this class</b><small>Removes its learners, their face data and every register. Archive it instead to keep the history.</small></div>
            <button type="button" className="btn danger sm" onClick={() => { onClose(); onDelete(); }}><Trash2 /> Delete</button>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/* ---------- one class ---------- */

export function ClassPage({ id, user }: { id: string; user: User }) {
  const cls = useLoad(() => api<Class>(`/classes/${id}`), [id]);
  const learners = useLoad(() => api<Learner[]>(`/classes/${id}/learners`), [id]);
  const sessions = useLoad(() => api<Session[]>(`/classes/${id}/sessions`), [id]);
  const [tab, setTab] = useState<"learners" | "registers">("learners");
  const [enrolling, setEnrolling] = useState(false);
  const [editing, setEditing] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [term, setTerm] = useState("");
  const act = useAction();
  const toast = useToast();
  const admin = user.role === "admin";

  const c = cls.data;
  if (cls.error) return <Alert msg={cls.error} />;
  if (!c) return <Spinner />;

  const active = c.status === "active";
  const current = learners.data?.filter((l) => l.status === "active") ?? [];
  const withFace = current.filter((l) => l.template_count).length;

  const takeToday = () => act.run(async () => {
    const s = await openRegister(c.id);
    location.hash = `#/registers/${s.id}`;
  });

  const toggleArchive = () => {
    if (active && !confirm(`Archive ${c.name}? Its registers are kept, but no new registers can be taken.`)) return;
    act.run(async () => {
      await api(`/classes/${id}`, { method: "PATCH", body: { status: active ? "archived" : "active" } });
      toast(active ? `${c.name} archived` : `${c.name} restored`);
      cls.reload();
    });
  };

  return (
    <>
      <a className="crumb" href="#/classes"><ChevronLeft /> Classes</a>
      <div className="page-head">
        <div>
          <h1>{c.name}</h1>
          <div className="meta">
            <span className="badge plain">{c.academic_year}</span>
            <span className="badge plain">{c.teacher_name ?? "No teacher assigned"}</span>
            <span className="badge plain">{plural(current.length, "learner")}</span>
            <span className={`badge ${withFace === current.length && current.length ? "green" : "amber"}`}>{withFace} with faces</span>
            {!active && <span className="badge">Archived</span>}
          </div>
        </div>
        <div className="actions">
          {admin && <button className="btn icon" onClick={() => setEditing(true)} aria-label="Edit class" title="Edit class"><Pencil /></button>}
          {admin && (
            <button className="btn icon" onClick={toggleArchive} disabled={act.busy} aria-label={active ? "Archive class" : "Restore class"} title={active ? "Archive class" : "Restore class"}>
              {active ? <Archive /> : <ArchiveRestore />}
            </button>
          )}
          {active && <button className="btn" onClick={() => setImporting(true)}><FileUp /> Import list</button>}
          {active && <button className="btn" onClick={() => setEnrolling(true)}><UserPlus /> Enrol learner</button>}
          {active && <button className="btn go" onClick={takeToday} disabled={act.busy || !current.length}><CalendarPlus /> Take today's register</button>}
        </div>
      </div>
      <Alert msg={act.error} />

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "learners"} className={tab === "learners" ? "on" : ""} onClick={() => setTab("learners")}>
          Learners<span className="c">{current.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "registers"} className={tab === "registers" ? "on" : ""} onClick={() => setTab("registers")}>
          Registers<span className="c">{sessions.data?.length ?? 0}</span>
        </button>
      </div>

      {tab === "learners" && (learners.data?.length ?? 0) > 6 && (
        <div className="toolbar"><SearchBox value={term} onChange={setTerm} placeholder="Find a learner by name or number" /></div>
      )}

      {tab === "learners" && (
        <section className="panel">
          {learners.data?.length === 0 ? (
            <Empty icon={<Users />} title="No learners yet" action={active ? <button className="btn primary" onClick={() => setEnrolling(true)}><UserPlus /> Enrol learner</button> : undefined}>
              Enrol each learner with their student number. You can add their face afterwards.
            </Empty>
          ) : (
            <div className="rows">
              {learners.data?.filter((l) => matches(term, l.full_name, l.student_number)).map((l) => (
                <a className="row" key={l.id} href={`#/learners/${l.id}`}>
                  <Avatar name={l.full_name} />
                  <div className="grow">
                    <b>{l.full_name}</b>
                    <small>{l.student_number}</small>
                  </div>
                  {l.status === "inactive" ? <span className="badge">Inactive</span>
                    : l.template_count ? <span className="badge green">Face added</span>
                    : !l.consent ? <span className="badge">No consent</span>
                    : <span className="badge amber">Needs a photo</span>}
                  <ChevronRight className="chev" />
                </a>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "registers" && (
        <section className="panel">
          <div className="ph">
            <span className="muted small">Each register is one class, one day, one sitting.</span>
            {active && <button className="btn sm" onClick={() => setRegisterOpen(true)}><Plus /> Other date</button>}
          </div>
          {sessions.data?.length === 0 ? (
            <Empty icon={<ClipboardList />} title="No registers yet">Take today's register and it will appear here.</Empty>
          ) : (
            <div className="rows">
              {sessions.data?.map((s) => {
                const total = current.length || 1;
                return (
                  <a className="row" key={s.id} href={`#/registers/${s.id}`}>
                    <div className="grow">
                      <b>{fmtDate(s.session_date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b>
                      <small>{s.session_type}</small>
                    </div>
                    <div style={{ width: 140 }}>
                      <div className="bar"><i className="p" style={{ width: `${((s.present ?? 0) / total) * 100}%` }} /><i className="a" style={{ width: `${((s.absent ?? 0) / total) * 100}%` }} /></div>
                      <small className="faint" style={{ fontSize: 12.5 }}>{s.present} present, {s.absent} absent</small>
                    </div>
                    <ChevronRight className="chev" />
                  </a>
                );
              })}
            </div>
          )}
        </section>
      )}

      <EnrolForm open={enrolling} classId={c.id} onClose={() => setEnrolling(false)} onSaved={() => learners.reload()} />
      <BulkEnrol open={importing} classId={c.id} onClose={() => setImporting(false)} onSaved={() => learners.reload()} />
      {admin && <ClassForm open={editing} cls={c} onClose={() => setEditing(false)} onSaved={() => cls.reload()} onDelete={() => setDeleting(true)} />}
      {admin && (
        <ConfirmDelete open={deleting} onClose={() => setDeleting(false)} title={`Delete ${c.name}?`} typeToConfirm={c.name} action="Delete class"
          onConfirm={async () => {
            await api(`/classes/${c.id}`, { method: "DELETE" });
            toast(`${c.name} deleted`);
            location.hash = "#/classes";
          }}>
          This permanently removes <b>{plural(learners.data?.length ?? 0, "learner")}</b>, their face data, and{" "}
          <b>{plural(sessions.data?.length ?? 0, "register")}</b>. It can't be undone. To keep the history, archive the class instead.
        </ConfirmDelete>
      )}
      <OtherDate open={registerOpen} classId={c.id} onClose={() => setRegisterOpen(false)} />
    </>
  );
}

function EnrolForm({ open, classId, onClose, onSaved }: { open: boolean; classId: number; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run, setError } = useAction();
  const toast = useToast();
  const submit = (e: React.FormEvent<HTMLFormElement>, again: boolean) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    run(async () => {
      const l = await api<Learner>("/learners", {
        body: { class_id: classId, student_number: f.get("number"), full_name: f.get("name"), consent: f.get("consent") === "on" },
      });
      toast(`${l.full_name} enrolled`);
      onSaved();
      if (again) { form.reset(); (form.elements.namedItem("number") as HTMLInputElement).focus(); } else onClose();
    });
  };
  let again = false;
  return (
    <Dialog open={open} onClose={() => { setError(""); onClose(); }} title="Enrol a learner" intro="Add the face from the learner's page afterwards.">
      <form className="form" onSubmit={(e) => submit(e, again)}>
        <label className="field"><span>Student number</span><input className="input" name="number" placeholder="e.g. KBS2026-014" required autoFocus /></label>
        <label className="field"><span>Full name</span><input className="input" name="name" placeholder="e.g. Namakau Liswaniso" required /></label>
        <label className="check">
          <input type="checkbox" name="consent" />
          <span><b>Guardian has agreed to face recognition</b><span className="small muted">Only tick this if you hold signed consent. Without it, this learner is marked by hand.</span></span>
        </label>
        <Alert msg={error} />
        <footer>
          <button className="btn" disabled={busy} onClick={() => { again = true; }}>Save and add another</button>
          <button className="btn primary" disabled={busy} onClick={() => { again = false; }}>Enrol learner</button>
        </footer>
      </form>
    </Dialog>
  );
}

function OtherDate({ open, classId, onClose }: { open: boolean; classId: number; onClose: () => void }) {
  const { busy, error, run } = useAction();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      const s = await openRegister(classId, String(f.get("date")), String(f.get("type")));
      location.hash = `#/registers/${s.id}`;
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="Open a register" intro="For a different day, or a second sitting such as an afternoon register.">
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Date</span><input className="input" type="date" name="date" defaultValue={today()} max={today()} required /></label>
        <label className="field"><span>Register</span><input className="input" name="type" defaultValue="Morning register" required /></label>
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Open register</button>
        </footer>
      </form>
    </Dialog>
  );
}

/** Paste a list (from Excel, a class list, or typed) — one learner per line: number, then name. */
function BulkEnrol({ open, classId, onClose, onSaved }: { open: boolean; classId: number; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run, setError } = useAction();
  const toast = useToast();
  const [textValue, setText] = useState("");
  const [consent, setConsent] = useState(false);
  const rows = parseList(textValue);
  const bad = rows.filter((r) => !r.ok);
  const close = () => { setText(""); setError(""); setConsent(false); onClose(); };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api<{ created: number }>("/learners/bulk", {
        body: { class_id: classId, consent, learners: rows.map((x) => ({ student_number: x.number, full_name: x.name })) },
      });
      toast(`${plural(r.created, "learner")} enrolled`);
      onSaved();
      close();
    });
  };
  return (
    <Dialog open={open} onClose={close} title="Import a class list" intro="Paste one learner per line: student number, then full name. Copying two columns from Excel works too.">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Learners</span>
          <textarea className="input" rows={8} value={textValue} onChange={(e) => setText(e.target.value)} autoFocus
            placeholder={"KBS2026-001, Namakau Liswaniso\nKBS2026-002, Mwangala Sitali"} style={{ height: "auto", padding: 12, fontFamily: "inherit" }} />
          <small>{rows.length ? `${plural(rows.length, "learner")} found${bad.length ? `, ${bad.length} need fixing (line ${bad.map((b) => b.line).slice(0, 4).join(", ")})` : ""}` : "Commas, tabs or semicolons all work."}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span><b>Guardians of everyone listed have agreed to face recognition</b><span className="small muted">Leave unticked if unsure. You can record consent per learner later.</span></span>
        </label>
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={busy || !rows.length || bad.length > 0}>Enrol {rows.length || ""} learners</button>
        </footer>
      </form>
    </Dialog>
  );
}

function parseList(text: string) {
  return text.split(/\r?\n/).map((raw, i) => ({ raw: raw.trim(), line: i + 1 })).filter((x) => x.raw).map(({ raw, line }) => {
    const parts = raw.split(/\t|;|,/).map((p) => p.trim()).filter(Boolean);
    const [number, ...rest] = parts;
    const name = rest.join(" ").replace(/\s+/g, " ");
    return { line, number: number ?? "", name, ok: !!number && !!name };
  });
}
