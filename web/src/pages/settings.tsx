import { LogOut } from "lucide-react";
import { api, session, type User } from "../api";
import { Alert, Avatar, PasswordInput, useAction, useToast } from "../ui";

export function SettingsPage({ user, onUser }: { user: User; onUser: (u: User) => void }) {
  const profile = useAction();
  const pw = useAction();
  const toast = useToast();

  const saveName = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    profile.run(async () => {
      const u = await api<User>("/me", { method: "PATCH", body: { full_name: f.get("name") } });
      onUser(u);
      toast("Name saved");
    });
  };

  const savePassword = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("new") !== f.get("confirm")) { pw.run(async () => { throw new Error("The new passwords don't match"); }); return; }
    pw.run(async () => {
      await api("/me", { method: "PATCH", body: { current_password: f.get("current"), new_password: f.get("new") } });
      form.reset();
      toast("Password changed");
    });
  };

  return (
    <>
      <div className="page-head">
        <div className="profile">
          <Avatar name={user.full_name} size="lg" />
          <div>
            <h1>{user.full_name}</h1>
            <div className="meta">
              <span className="badge plain">{user.username}</span>
              <span className="badge plain">{user.role === "admin" ? "Administrator" : "Teacher"}</span>
            </div>
          </div>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => { session.set(null); location.hash = "#/"; location.reload(); }}><LogOut /> Sign out</button>
        </div>
      </div>

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <div className="ph"><h2>Your name</h2></div>
            <form className="pb form" onSubmit={saveName}>
              <label className="field"><span>Full name</span><input className="input" name="name" defaultValue={user.full_name} required /><small>Shown on registers you confirm.</small></label>
              <Alert msg={profile.error} />
              <div><button className="btn primary" disabled={profile.busy}>Save name</button></div>
            </form>
          </section>

          <section className="panel">
            <div className="ph"><h2>Password</h2></div>
            <form className="pb form" onSubmit={savePassword}>
              <label className="field"><span>Current password</span><PasswordInput name="current" autoComplete="current-password" required /></label>
              <label className="field"><span>New password</span><PasswordInput name="new" autoComplete="new-password" minLength={8} required /><small>At least 8 characters.</small></label>
              <label className="field"><span>Confirm new password</span><PasswordInput name="confirm" autoComplete="new-password" minLength={8} required /></label>
              <Alert msg={pw.error} />
              <div><button className="btn primary" disabled={pw.busy}>Change password</button></div>
            </form>
          </section>
        </div>

        <section className="panel">
          <div className="ph"><h2>About Tick</h2></div>
          <div className="pb form">
            <p className="muted">Tick suggests who is in a photo. A teacher confirms every name before it reaches the register.</p>
            <dl className="kv">
              <dt>Photos</dt><dd>Never stored</dd>
              <dt>Face data</dt><dd>Encrypted on this computer</dd>
              <dt>Absences</dt><dd>Only ever marked by a teacher</dd>
              <dt>Access</dt><dd>Approved by an administrator</dd>
            </dl>
          </div>
        </section>
      </div>
    </>
  );
}
