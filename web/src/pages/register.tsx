import { useEffect, useState } from "react";
import { ChevronLeft, RotateCcw, ScanFace, X } from "lucide-react";
import { api, type MatchResult, type RegisterRow, type SessionDetail } from "../api";
import { readFaces, warmUp } from "../face";
import { Alert, PhotoPicker, Spinner, Tick, fmtDate, plural, useAction, useLoad, useToast } from "../ui";

type Status = "present" | "absent";
type Rec = { learner_id: number; status: Status; method: "face" | "manual"; similarity?: number | null };

export function RegisterPage({ id }: { id: string }) {
  const s = useLoad(() => api<SessionDetail>(`/attendance/sessions/${id}`), [id]);
  const mark = useAction();
  const toast = useToast();
  const [justTicked, setJustTicked] = useState<Set<number>>(new Set());

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

        <Scanner sessionId={id} learners={d.learners} busy={mark.busy}
          onConfirm={(rows) => save(rows.map((r) => ({ ...r, status: "present", method: "face" })), `${plural(rows.length, "learner")} marked present`)} />
      </div>
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

/** Take or upload a photo, review proposed matches, confirm. */
function Scanner({ sessionId, learners, busy, onConfirm }: {
  sessionId: string; learners: RegisterRow[]; busy: boolean;
  onConfirm: (rows: { learner_id: number; similarity: number | null }[]) => Promise<boolean>;
}) {
  const scan = useAction();
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const byId = new Map(learners.map((l) => [l.id, l]));
  const canRecognise = learners.some((l) => l.template_count);
  const [note, setNote] = useState("Looking for faces…");

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo); }, [photo]);
  // Fetch the face model in the background so the first scan is quick
  useEffect(() => { if (canRecognise) warmUp(); }, [canRecognise]);

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
    <section className="panel scan">
      <div className="ph">
        <h2>Scan a photo</h2>
        {(photo || result) && <button className="btn ghost sm" onClick={reset}><RotateCcw /> New photo</button>}
      </div>
      <div className="pb form">
        {!canRecognise && <Alert tone="info" msg="No learner in this class has a face added yet. Add faces from each learner's page, or mark the register by hand." />}

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
    </section>
  );
}
