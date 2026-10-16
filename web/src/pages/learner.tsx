import { useState } from "react";
import { ChevronLeft, ScanFace, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { api, type Class, type Learner } from "../api";
import { readFaces } from "../face";
import { LiveEnrol } from "../face/live-ui";
import { Alert, Avatar, ConfirmDelete, PhotoPicker, Spinner, Tick, fmtDate, useAction, useLoad, useToast } from "../ui";

export function LearnerPage({ id }: { id: string }) {
  const learner = useLoad(() => api<Learner>(`/learners/${id}`), [id]);
  const classes = useLoad(() => api<Class[]>("/classes"), []);
  const [deleting, setDeleting] = useState(false);
  const [live, setLive] = useState(false);
  const save = useAction();
  const photo = useAction();
  const toast = useToast();
  const [note, setNote] = useState("Checking the photo…");

  const l = learner.data;
  if (learner.error) return <Alert msg={learner.error} />;
  if (!l) return <Spinner />;

  const update = (body: Partial<Learner>, done: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    save.run(async () => {
      await api(`/learners/${id}`, { method: "PATCH", body });
      toast(done);
      learner.reload();
    });
  };

  const saveDetails = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const classId = Number(f.get("class"));
    const moving = classId !== l.class_id;
    const to = classes.data?.find((c) => c.id === classId);
    update(
      { student_number: String(f.get("number")), full_name: String(f.get("name")), class_id: classId },
      moving ? `Moved to ${to?.name ?? "the new class"}` : "Details saved",
      moving ? `Move ${l.full_name} to ${to?.name}? Past registers stay with the old class.` : undefined,
    );
  };

  const addPhoto = (file: File) =>
    photo.run(async () => {
      // The photo is analysed here, on this device. Only the face embedding is sent.
      setNote("Checking the photo…");
      const r = await readFaces(file, { single: true, onProgress: setNote });
      await api(`/learners/${id}/face-templates`, { body: { embedding: r.faces[0].embedding, model_version: r.model_version } });
      toast("Face added");
      learner.reload();
    });

  const remove = (templateId: number) => {
    if (!confirm("Remove this face? Tick will no longer use it to recognise this learner.")) return;
    photo.run(async () => {
      await api(`/learners/${id}/face-templates/${templateId}`, { method: "DELETE" });
      toast("Face removed");
      learner.reload();
    });
  };

  const faces = l.templates ?? [];
  const active = l.status === "active";

  return (
    <>
      <a className="crumb" href={`#/classes/${l.class_id}`}><ChevronLeft /> Back to class</a>
      <div className="page-head">
        <div className="profile">
          <Avatar name={l.full_name} size="lg" />
          <div>
            <h1>{l.full_name}</h1>
            <div className="meta">
              <span className="badge plain">{l.student_number}</span>
              {!active && <span className="badge">Inactive</span>}
              {faces.length ? <span className="badge green">Face added</span> : l.consent ? <span className="badge amber">Needs a photo</span> : <span className="badge">No consent</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="cols">
        <section className="panel">
          <div className="ph"><h2>Face</h2><span className="faint small">{faces.length ? `${faces.length} of up to 3 photos` : "Not added"}</span></div>
          <div className="pb form">
            {!l.consent ? (
              <Alert tone="info" msg="A face can only be added once a guardian has agreed. Until then, mark this learner by hand on the register." />
            ) : !active ? (
              <Alert tone="info" msg="This learner is inactive. Make them active again to add a face." />
            ) : (
              <>
                {faces.length === 0 && <p className="muted">Add one or two clear photos of just this learner, facing the camera in good light. More angles help recognition.</p>}
                {faces.length > 0 && (
                  <div className="rows" style={{ border: "var(--line)", borderRadius: 10 }}>
                    {faces.map((t, i) => (
                      <div className="row" key={t.id} style={{ minHeight: 56 }}>
                        <span className="avatar" style={{ background: "var(--green-soft)" }}><Tick size={20} /></span>
                        <div className="grow"><b>Photo {i + 1}</b><small>Added {fmtDate(t.created_at, { day: "numeric", month: "long", year: "numeric" })}</small></div>
                        <button className="btn ghost sm icon danger" onClick={() => remove(t.id)} disabled={photo.busy} aria-label={`Remove photo ${i + 1}`}><Trash2 /></button>
                      </div>
                    ))}
                  </div>
                )}
                {faces.length < 3 && (live ? (
                  <LiveEnrol learnerId={l.id} existing={faces.length} onAdded={() => { toast("Face added"); learner.reload(); }} onClose={() => setLive(false)} />
                ) : (
                  <PhotoPicker onPhoto={addPhoto} disabled={photo.busy} onCamera={() => setLive(true)}
                    hint="With the camera, the face is captured by itself once it is clear" />
                ))}
                {photo.busy && <p className="muted small" style={{ display: "flex", gap: 8, alignItems: "center" }}><ScanFace size={18} /> {note}</p>}
                <Alert msg={photo.error} />
              </>
            )}
            <p className="faint small">The photo is read on this device and turned into an encrypted description of the face. The picture itself is never uploaded or stored.</p>
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <div className="ph"><h2>Guardian consent</h2></div>
            <div className="pb form">
              <p className="muted">{l.consent ? "A guardian has agreed to face recognition for this learner." : "No consent recorded. This learner is marked by hand."}</p>
              {l.consent ? (
                <button className="btn danger" disabled={save.busy} onClick={() => update({ consent: false }, "Consent withdrawn, face removed", "Withdraw consent? Every face added for this learner is deleted.")}>
                  <ShieldOff /> Withdraw consent
                </button>
              ) : (
                <button className="btn" disabled={save.busy} onClick={() => update({ consent: true }, "Consent recorded")}>
                  <ShieldCheck /> Record consent
                </button>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="ph"><h2>Details</h2></div>
            <form className="pb form" onSubmit={saveDetails} key={`${l.id}-${l.student_number}-${l.full_name}-${l.class_id}`}>
              <label className="field"><span>Student number</span><input className="input" name="number" defaultValue={l.student_number} required /></label>
              <label className="field"><span>Full name</span><input className="input" name="name" defaultValue={l.full_name} required /></label>
              <label className="field">
                <span>Class</span>
                <select className="input" name="class" defaultValue={l.class_id} key={`${l.class_id}-${classes.data?.length ?? 0}`}>
                  {(classes.data ?? []).filter((c) => c.status === "active" || c.id === l.class_id).map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.academic_year})</option>
                  ))}
                  {!classes.data && <option value={l.class_id}>Current class</option>}
                </select>
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary" disabled={save.busy}>Save details</button>
                <button type="button" className="btn ghost" disabled={save.busy}
                  onClick={() => update({ status: active ? "inactive" : "active" }, active ? "Marked inactive" : "Marked active", active ? "Mark this learner inactive? They'll no longer appear on new registers." : undefined)}>
                  {active ? "Mark inactive" : "Mark active"}
                </button>
              </div>
              <Alert msg={save.error} />
            </form>
          </section>

          <section className="panel">
            <div className="pb">
              <div className="danger-zone" style={{ marginTop: 0 }}>
                <div><b>Delete learner</b><small>Removes their face data and every attendance mark. To keep the history when a learner leaves, mark them inactive.</small></div>
                <button type="button" className="btn danger sm" onClick={() => setDeleting(true)}><Trash2 /> Delete</button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDelete open={deleting} onClose={() => setDeleting(false)} title={`Delete ${l.full_name}?`} action="Delete learner"
        onConfirm={async () => {
          await api(`/learners/${l.id}`, { method: "DELETE" });
          toast(`${l.full_name} deleted`);
          location.hash = `#/classes/${l.class_id}`;
        }}>
        Their face data and all their attendance marks are removed for good. This can't be undone.
      </ConfirmDelete>
    </>
  );
}
