import { useState } from "react";
import { Check, Pencil, Plus, Trash2, UserRoundX, UsersRound } from "lucide-react";
import { api, type Staff, type User } from "../api";
import { Alert, Avatar, ConfirmDelete, Dialog, Empty, PasswordInput, SearchBox, Spinner, matches, plural, useAction, useLoad, useToast } from "../ui";

export function StaffPage({ user, onChange }: { user: User; onChange: (pending: number) => void }) {
  const staff = useLoad(() => api<Staff[]>("/users").then((s) => { onChange(s.filter((x) => x.status === "pending").length); return s; }), []);
  const act = useAction();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [deleting, setDeleting] = useState<Staff | null>(null);
  const [term, setTerm] = useState("");

  const patch = (s: Staff, body: Partial<Staff>, msg: string, ask?: string) => {
    if (ask && !confirm(ask)) return;
    act.run(async () => { await api(`/users/${s.id}`, { method: "PATCH", body }); toast(msg); staff.reload(); });
  };
  const decline = (s: Staff) => {
    if (!confirm(`Decline ${s.full_name}'s request? Their account is deleted.`)) return;
    act.run(async () => { await api(`/users/${s.id}`, { method: "DELETE" }); toast("Request declined"); staff.reload(); });
  };

  const pending = staff.data?.filter((s) => s.status === "pending") ?? [];
  const others = staff.data?.filter((s) => s.status !== "pending" && matches(term, s.full_name, s.username)) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Staff</h1>
          <p className="muted" style={{ marginTop: 6 }}>Everyone who can sign in, and what they can do.</p>
        </div>
        <div className="actions"><button className="btn primary" onClick={() => setAdding(true)}><Plus /> Add staff</button></div>
      </div>
      <Alert msg={staff.error || act.error} />
      {!staff.data && !staff.error && <Spinner />}

      {pending.length > 0 && (
        <section className="panel" style={{ marginBottom: 24, borderColor: "#f1d98a" }}>
          <div className="ph" style={{ background: "var(--amber-soft)", borderRadius: "12px 12px 0 0" }}>
            <h2>Waiting for approval</h2>
            <span className="badge amber">{plural(pending.length, "request")}</span>
          </div>
          <div className="rows">
            {pending.map((s) => (
              <div className="row" key={s.id}>
                <Avatar name={s.full_name} />
                <div className="grow"><b>{s.full_name}</b><small>Signed up as {s.username}</small></div>
                <button className="btn sm" disabled={act.busy} onClick={() => decline(s)}>Decline</button>
                <button className="btn sm go" disabled={act.busy} onClick={() => patch(s, { status: "active" }, `${s.full_name} can now sign in`)}><Check /> Approve</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {(staff.data?.length ?? 0) > 6 && (
        <div className="toolbar"><SearchBox value={term} onChange={setTerm} placeholder="Find staff by name or username" /></div>
      )}

      {staff.data && (
        <section className="panel">
          {others.length === 0 ? (
            <Empty icon={<UsersRound />} title="Just you so far">Add teachers here, or ask them to request an account from the sign-up page.</Empty>
          ) : (
            <div className="rows">
              {others.map((s) => {
                const me = s.id === user.id;
                return (
                  <div className="row" key={s.id} style={{ opacity: s.status === "suspended" ? 0.65 : 1 }}>
                    <Avatar name={s.full_name} />
                    <div className="grow">
                      <b>{s.full_name}{me && <span className="faint" style={{ fontWeight: 500 }}> (you)</span>}</b>
                      <small>{s.username}, {s.class_count ? plural(s.class_count, "class", "classes") : "no classes"}</small>
                    </div>
                    {s.status === "suspended" && <span className="badge red">Suspended</span>}
                    {me ? (
                      <span className="badge plain">{s.role === "admin" ? "Administrator" : "Teacher"}</span>
                    ) : (
                      <>
                        <select className="input" style={{ width: 160, height: 36 }} value={s.role} disabled={act.busy}
                          aria-label={`Role for ${s.full_name}`}
                          onChange={(e) => patch(s, { role: e.target.value as Staff["role"] }, `${s.full_name} is now ${e.target.value === "admin" ? "an administrator" : "a teacher"}`)}>
                          <option value="teacher">Teacher</option>
                          <option value="admin">Administrator</option>
                        </select>
                        <button className="btn ghost sm icon" title="Edit" aria-label={`Edit ${s.full_name}`} disabled={act.busy} onClick={() => setEditing(s)}>
                          <Pencil />
                        </button>
                        {s.status === "active" ? (
                          <button className="btn ghost sm icon danger" title="Suspend" aria-label={`Suspend ${s.full_name}`} disabled={act.busy}
                            onClick={() => patch(s, { status: "suspended" }, `${s.full_name} suspended`, `Suspend ${s.full_name}? They're signed out and can't sign in until restored.`)}>
                            <UserRoundX />
                          </button>
                        ) : (
                          <button className="btn sm" disabled={act.busy} onClick={() => patch(s, { status: "active" }, `${s.full_name} restored`)}>Restore</button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
      <p className="faint small" style={{ marginTop: 16 }}>Teachers see only the classes assigned to them. Administrators see every class and manage staff.</p>

      <AddStaff open={adding} onClose={() => setAdding(false)} onSaved={() => staff.reload()} />
      <EditStaff person={editing} onClose={() => setEditing(null)} onSaved={() => staff.reload()} onDelete={(s) => setDeleting(s)} />
      <ConfirmDelete open={!!deleting} onClose={() => setDeleting(null)} title={`Delete ${deleting?.full_name ?? ""}?`} action="Delete account"
        onConfirm={async () => {
          await api(`/users/${deleting!.id}`, { method: "DELETE" });
          toast(`${deleting!.full_name} deleted`);
          staff.reload();
        }}>
        Their account is removed and any classes they teach are left without a teacher. People who have taken registers can't be
        deleted, so their name stays on the history — suspend them instead.
      </ConfirmDelete>
    </>
  );
}

function AddStaff({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { busy, error, run } = useAction();
  const toast = useToast();
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      await api("/users", { body: { full_name: f.get("name"), username: f.get("username"), password: f.get("password"), role: f.get("role") } });
      toast(`${f.get("name")} added`);
      onSaved();
      onClose();
    });
  };
  return (
    <Dialog open={open} onClose={onClose} title="Add a staff member" intro="They can sign in straight away. Share the username and password with them in person.">
      <form className="form" onSubmit={submit}>
        <label className="field"><span>Full name</span><input className="input" name="name" required autoFocus /></label>
        <label className="field"><span>Username</span><input className="input" name="username" autoCapitalize="none" pattern="[A-Za-z0-9._\-]{3,30}" required autoComplete="off" /></label>
        <label className="field"><span>Starting password</span><PasswordInput name="password" minLength={8} required autoComplete="new-password" /><small>They can change it in Settings.</small></label>
        <label className="field">
          <span>Role</span>
          <select className="input" name="role" defaultValue="teacher">
            <option value="teacher">Teacher — sees their own classes</option>
            <option value="admin">Administrator — sees everything, manages staff</option>
          </select>
        </label>
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>Add staff member</button>
        </footer>
      </form>
    </Dialog>
  );
}

function EditStaff({ person, onClose, onSaved, onDelete }: {
  person: Staff | null; onClose: () => void; onSaved: () => void; onDelete: (s: Staff) => void;
}) {
  const { busy, error, run, setError } = useAction();
  const toast = useToast();
  const close = () => { setError(""); onClose(); };
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get("password") || "");
    run(async () => {
      await api(`/users/${person!.id}`, {
        method: "PATCH",
        body: { full_name: f.get("name"), username: f.get("username"), role: f.get("role"), ...(password ? { password } : {}) },
      });
      toast(password ? "Saved, and password reset" : "Changes saved");
      onSaved();
      close();
    });
  };
  return (
    <Dialog open={!!person} onClose={close} title="Edit staff member">
      {person && (
        <form className="form" onSubmit={submit}>
          <label className="field"><span>Full name</span><input className="input" name="name" defaultValue={person.full_name} required autoFocus /></label>
          <label className="field"><span>Username</span><input className="input" name="username" defaultValue={person.username} autoCapitalize="none" pattern="[A-Za-z0-9._\-]{3,30}" required autoComplete="off" /></label>
          <label className="field">
            <span>Role</span>
            <select className="input" name="role" defaultValue={person.role}>
              <option value="teacher">Teacher — sees their own classes</option>
              <option value="admin">Administrator — sees everything, manages staff</option>
            </select>
          </label>
          <label className="field"><span>Reset password</span><PasswordInput name="password" minLength={8} autoComplete="new-password" placeholder="Leave blank to keep theirs" /><small>If they've forgotten it, set a new one and tell them in person.</small></label>
          <Alert msg={error} />
          <footer>
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" disabled={busy}>Save changes</button>
          </footer>
          <div className="danger-zone">
            <div><b>Delete account</b><small>Only for people who have never taken a register.</small></div>
            <button type="button" className="btn danger sm" onClick={() => { const p = person; close(); onDelete(p); }}><Trash2 /> Delete</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
