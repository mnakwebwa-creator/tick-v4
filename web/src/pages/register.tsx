import { useEffect, useState } from "react";
import { ChevronLeft, ImageUp, Pencil, RotateCcw, ScanFace, Trash2, Video, X } from "lucide-react";
import { api, type MatchResult, type RegisterRow, type SessionDetail } from "../api";
import { readFaces, warmUp } from "../face";
import { LiveRegister } from "../face/live-ui";
import { Alert, ConfirmDelete, Dialog, PhotoPicker, Spinner, Tick, fmtDate, plural, today, useAction, useLoad, useToast } from "../ui";

type Status = "present" | "absent";
type Rec = { learner_id: number; status: Status; method: "face" | "manual"; similarity?: number | null };

export function RegisterPage({ id }: { id: string }) {
  const s = useLoad(() => api<SessionDetail>(`/attendance/sessions/${id}`), [id]);
  const mark = useAction();
  const toast = useToast();
  const [justTicked, setJustTicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = (records: Rec[], msg?: string) =>
    mark.run(async () => {
      await api("/attendance/records", { body: { session_id: Number(id), records } });
      setJustTicked(new Set(records.filter((r) => r.status === "present").map((r) => r.learner_id)));
      await s.reload();
      if (msg) toast(msg);
    });

  const clear = (learnerId: number) =>
    mark.run(async () => { await api(`/attendance/sessions/${id}/records/${learnerId}`, { method: "DELETE" }); await s.reload(); });

  const d = s.data;
  if (s.error) return <Alert msg={s.error} />;
  if (!d) return <Spinner />;

  const present = d.learners.filter((l) => l.status === "present").length;
  const absent = d.learners.filter((l) => l.status === "absent").length;
  const unmarked = d.learners.filter((l) => !l.status);
  const total = d.learners.length || 1;

  const restAbsent = () => {
    if (!confirm(`Mark ${plural(unmarked.length, "unmarked learner")} absent?`)) return;
    save(unmarked.map((l) => ({ learner_id: l.id, status: "absent", method: "manual" })), `${plural(unmarked.length, "learner")} marked absent`);
  };

  return (
    <>
      <a className="crumb" href={`#/classes/${d.class_id}`}><ChevronLeft /> {d.class.name}</a>
      <div className="page-head">
        <div>
          <h1>{d.session_type}</h1>
          <div className="meta">
            <span className="badge plain">{d.class.name}</span>
            <span className="badge plain">{fmtDate(d.session_date, { weekday: "long", day: "numeric", month: "long" })}</span>
            <button className="btn ghost sm icon" onClick={() => setEditing(true)} aria-label="Edit register" title="Change date or name"><Pencil /></button>
            <button className="btn ghost sm icon danger" onClick={() => setDeleting(true)} aria-label="Delete register" title="Delete register"><Trash2 /></button>
          </div>
        </div>
        <div style={{ minWidth: 260, flex: "0 1 320px" }}>
          <div className="bar" style={{ height: 10 }} role="img" aria-label={`${present} present, ${absent} absent, ${unmarked.length} unmarked`}>
            <i className="p" style={{ width: `${(present / total) * 100}%` }} />
            <i className="a" style={{ width: `${(absent / total) * 100}%` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 14 }} className="num">
            <span><b style={{ color: "var(--green-ink)" }}>{present}</b> present</span>
            <span><b style={{ color: "var(--margin-ink)" }}>{absent}</b> absent</span>
            <span><b>{unmarked.length}</b> unmarked</span>
          </div>
        </div>
      </div>

      <div className="cols">
        <section className="register" aria-label="Register">
          <div className="reg-head">
            <h2>Register</h2>
            {unmarked.length > 0 && d.learners.length > 0 && (
              <button className="btn sm" onClick={restAbsent} disabled={mark.busy}>Mark {unmarked.length} unmarked absent</button>
            )}
          </div>
          {mark.error && <div style={{ padding: "12px 20px 0 72px" }}><Alert msg={mark.error} /></div>}
          {d.learners.length === 0 && <p className="muted" style={{ padding: "24px 20px 24px 72px" }}>This class has no learners yet.</p>}
          {d.learners.map((l, i) => (
            <div className="reg-row" key={l.id}>
              <span className="n">{i + 1}</span>
              <div className="grow">
                <b>{l.full_name}</b>
                <small>
                  {l.status
                    ? `${l.method === "face" ? "Recognised, confirmed" : "Marked"} by ${l.confirmed_by}`
                    : l.template_count ? "Can be recognised" : l.consent ? "No face yet, mark by hand" : "Mark by hand"}
                </small>
              </div>
              <Marks row={l} busy={mark.busy} fresh={justTicked.has(l.id)}
                onSet={(st) => (st === l.status ? clear(l.id) : save([{ learner_id: l.id, status: st, method: "manual" }]))} />
            </div>
          ))}
        </section>

        <Scanner key={id} sessionId={id} learners={d.learners} busy={mark.busy}
          onConfirm={(rows, quiet) => save(rows.map((r) => ({ ...r, status: "present", method: "face" })), quiet ? undefined : `${plural(rows.length, "learner")} marked present`)} />
      </div>

      <EditRegister open={editing} detail={d} onClose={() => setEditing(false)} onSaved={() => s.reload()} />
      <ConfirmDelete open={deleting} onClose={() => setDeleting(false)} title="Delete this register?" action="Delete register"
        onConfirm={async () => {
          await api(`/attendance/sessions/${id}`, { method: "DELETE" });
          toast("Register deleted");
          location.hash = `#/classes/${d.class_id}`;
        }}>
        {d.session_type} for {d.class.name} on {fmtDate(d.session_date, { weekday: "long", day: "numeric", month: "long" })}
        {present + absent ? <>, with <b>{plural(present + absent, "mark")}</b>,</> : ""} is removed for good.
      </ConfirmDelete>
    </>
  );
}

function Marks({ row, onSet, busy, fresh }: { row: RegisterRow; onSet: (s: Status) => void; busy: boolean; fresh: boolean }) {
  const p = row.status === "present";
  const a = row.status === "absent";
  return (
    <div className="marks">
      <button className={`markbtn p${p ? " on" : ""}`} disabled={busy} onClick={() => onSet("present")}
        aria-pressed={p} aria-label={`${row.full_name} present`} title={p ? "Present (tap to clear)" : "Mark present"}>
        {p ? <Tick size={24} draw={fresh} /> : <Tick size={20} />}
      </button>
      <button className={`markbtn a${a ? " on" : ""}`} disabled={busy} onClick={() => onSet("absent")}
        aria-pressed={a} aria-label={`${row.full_name} absent`} title={a ? "Absent (tap to clear)" : "Mark absent"}>
        <X />
      </button>
    </div>
  );
}

type Confirm = (rows: { learner_id: number; similarity: number | null }[], quiet?: boolean) => Promise<boolean>;
const MODE = "tick.scanMode";

/** Recognise learners live from the camera (default), or from a photo. */
function Scanner(props: { sessionId: string; learners: RegisterRow[]; busy: boolean; onConfirm: Confirm }) {
  const [mode, setModeState] = useState<"live" | "photo">(() => {
    try { return localStorage.getItem(MODE) === "photo" ? "photo" : "live"; } catch { return "live"; }
  });
  const setMode = (m: "live" | "photo") => { setModeState(m); try { localStorage.setItem(MODE, m); } catch { /* ignore */ } };
  const canRecognise = props.learners.some((l) => l.template_count);
  useEffect(() => { if (canRecognise) warmUp(); }, [canRecognise]);
  return (
    <section className="panel scan">
      <div className="ph">
        <h2>Recognise</h2>
        <div className="seg" role="tablist" aria-label="How to recognise">
          <button role="tab" aria-selected={mode === "live"} className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}><Video size={15} /> Live</button>
          <button role="tab" aria-selected={mode === "photo"} className={mode === "photo" ? "on" : ""} onClick={() => setMode("photo")}><ImageUp size={15} /> Photo</button>
        </div>
      </div>
      {!canRecognise && <div className="pb" style={{ paddingBottom: 0 }}><Alert tone="info" msg="No learner in this class has a face added yet. Add faces from each learner's page, or mark the register by hand." /></div>}
      {mode === "live"
        ? <LiveRegister sessionId={Number(props.sessionId)} learners={props.learners} busy={props.busy} onConfirm={props.onConfirm} disabled={!canRecognise} />
        : <PhotoScanner {...props} />}
    </section>
  );
}

/** Take or upload a photo, review proposed matches, confirm. */
function PhotoScanner({ sessionId, learners, busy, onConfirm }: {
  sessionId: string; learners: RegisterRow[]; busy: boolean; onConfirm: Confirm;
}) {
  const scan = useAction();
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const byId = new Map(learners.map((l) => [l.id, l]));
  const [note, setNote] = useState("Looking for faces…");

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);

  const run = (file: File) => {
    setPhoto(URL.createObjectURL(file));
    setResult(null);
    scan.run(async () => {
      // Faces are found on this device; only their embeddings go to the server for matching.
      setNote("Looking for faces…");
      const found = await readFaces(file, { onProgress: setNote });
      const r = await api<MatchResult>("/recognition/match", {
        body: {
          session_id: Number(sessionId), width: found.width, height: found.height,
          faces: found.faces.map((f) => ({ box: f.box, embedding: f.embedding })),
        },
      });
      setResult(r);
      // Pre-tick confident matches only; uncertain ones wait for the teacher.
      setPicked(new Set(r.faces.filter((f) => f.verdict === "match" && f.learner_id && byId.get(f.learner_id)?.status !== "present").map((f) => f.learner_id!)));
    });
  };

  const reset = () => { setResult(null); setPhoto(null); scan.setError(""); };
  const toggle = (lid: number) => setPicked((p) => { const n = new Set(p); if (n.has(lid)) n.delete(lid); else n.add(lid); return n; });
  const confirmPicked = async () => {
    const rows = result!.faces.filter((f) => f.learner_id && picked.has(f.learner_id)).map((f) => ({ learner_id: f.learner_id!, similarity: f.similarity }));
    if (await onConfirm(rows)) reset();
  };

  const faces = result?.faces ?? [];
  const known = faces.filter((f) => f.learner_id);
  const unknown = faces.length - known.length;

  return (
      <div className="pb form">
        {(photo || result) && <div><button className="btn ghost sm" onClick={reset}><RotateCcw /> New photo</button></div>}

        {!photo && <PhotoPicker onPhoto={run} disabled={scan.busy || busy} hint="The whole class, a group, or one learner" />}

        {photo && (
          <div className="photo">
            <img src={photo} alt="The photo being checked" />
            {result && faces.map((f, i) => {
              const [x, y, w, h] = f.box;
              return (
                <div key={i} className={`box ${f.verdict}`} style={{
                  left: `${(x / result.width) * 100}%`, top: `${(y / result.height) * 100}%`,
                  width: `${(w / result.width) * 100}%`, height: `${(h / result.height) * 100}%`,
                }}><span>{i + 1}</span></div>
              );
            })}
          </div>
        )}

        {scan.busy && <p className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><ScanFace size={18} /> {note}</p>}
        <Alert msg={scan.error} />

        {result && faces.length === 0 && <Alert tone="warn" msg="No clear faces found. Move closer, face the light, and try again." />}

        {known.length > 0 && (
          <div className="form" style={{ gap: 8 }}>
            {faces.map((f, i) => {
              if (!f.learner_id) return null;
              const l = byId.get(f.learner_id);
              const already = l?.status === "present";
              return (
                <label key={i} className="proposal">
                  <input type="checkbox" disabled={already} checked={already || picked.has(f.learner_id)} onChange={() => toggle(f.learner_id!)} />
                  <span className={`k${f.verdict === "review" ? " review" : ""}`}>{i + 1}</span>
                  <span className="grow">
                    <b>{l?.full_name ?? "Learner"}</b>
                    <small>{already ? "Already marked present" : f.verdict === "match" ? "Clear match" : "Not certain — check before ticking"}</small>
                  </span>
                  {f.verdict === "review" && !already && <span className="badge amber">Check</span>}
                </label>
              );
            })}
          </div>
        )}
        {unknown > 0 && <p className="small muted">{plural(unknown, "face")} not recognised. Mark {unknown > 1 ? "them" : "it"} on the register by hand.</p>}
        {known.length > 0 && (
          <button className="btn go lg block" disabled={busy || !picked.size} onClick={confirmPicked}>
            Confirm {picked.size} present
          </button>
        )}
        <p className="faint small">Nothing is saved until you confirm. No one is marked absent from a photo.</p>
      </div>
  );
}

function EditRegister({ open, detail, onClose, onSaved }: { open: boolean; detail: SessionDetail; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run, setError } = useAction();
  const toast = useToast();
  const close = () => { setError(""); onClose(); };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      await api(`/attendance/sessions/${detail.id}`, { method: "PATCH", body: { session_date: f.get("date"), session_type: f.get("type") } });
      toast("Register updated");
      onSaved();
      close();
    });
  };
  return (
    <Dialog open={open} onClose={close} title="Edit register" intro="Fix the date or the name. The marks stay as they are.">
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Date</span><input className="input" type="date" name="date" defaultValue={detail.session_date} max={today()} required /></label>
        <label className="field"><span>Register</span><input className="input" name="type" defaultValue={detail.session_type} maxLength={60} required /></label>
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn primary" disabled={busy}>Save changes</button>
        </footer>
      </form>
    </Dialog>
  );
}
