import { useEffect, useState } from "react";
import { api, session, type User } from "../api";
import { Alert, Logo, PasswordInput, Tick, useAction } from "../ui";

type Done = { token: string; user: User };

function Art() {
  const rows = ["Namakau Liswaniso", "Mwangala Sitali", "Chanda Mulenga", "Inonge Mubita"];
  return (
    <aside className="auth-art" aria-hidden>
      <div className="card-stack">
        <div className="paper">
          <div className="head"><b>Form 2A</b><small>Morning register</small></div>
          {rows.map((n, i) => (
            <div className="prow" key={n}>
              <span className="n">{i + 1}</span>
              <span className="who">{n}</span>
              <span className="mark"><Tick size={22} draw delay={0.3 + i * 0.25} /></span>
            </div>
          ))}
        </div>
      </div>
      <p className="statement">
        One photo. One tap. Register done.
        <small>Clear matches are ticked for you. Anything uncertain waits for a teacher to check.</small>
      </p>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-form">
        <Logo />
        <div className="inner">{children}</div>
      </div>
      <Art />
    </div>
  );
}

export function SignIn({ onDone }: { onDone: (d: Done) => void }) {
  const { busy, error, run } = useAction();
  const [setup, setSetup] = useState(false);
  useEffect(() => { api<{ needsSetup: boolean }>("/auth/status").then((s) => setSetup(s.needsSetup)).catch(() => {}); }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(async () => {
      const d = await api<Done>("/auth/login", { body: { username: f.get("username"), password: f.get("password") } });
      session.set(d.token);
      onDone(d);
    });
  };

  return (
    <Layout>
      <h1>Welcome back</h1>
      <p className="sub">Sign in to take today's registers.</p>
      {setup && <div style={{ marginBottom: 20 }}><Alert tone="info" msg="No accounts exist yet. Set up your school first to create the administrator account." /></div>}
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Username</span>
          <input className="input" name="username" autoComplete="username" autoCapitalize="none" autoFocus required />
        </label>
        <label className="field">
          <span>Password</span>
          <PasswordInput name="password" autoComplete="current-password" required />
        </label>
        <Alert msg={error} />
        <button className="btn primary lg block" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
      <p className="switch">
        {setup ? <>New here? <a href="#/signup">Set up your school</a></> : <>No account yet? <a href="#/signup">Request one</a></>}
      </p>
      <p className="switch small faint" style={{ marginTop: 8 }}>Forgot your password? Ask your school's administrator to reset it.</p>
    </Layout>
  );
}

export function SignUp({ onDone }: { onDone: (d: Done) => void }) {
  const { busy, error, run } = useAction();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);
  useEffect(() => { api<{ needsSetup: boolean }>("/auth/status").then((s) => setSetup(s.needsSetup)).catch(() => setSetup(false)); }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) {
      run(async () => { throw new Error("The two passwords don't match"); });
      return;
    }
    run(async () => {
      const d = await api<Done | { pending: true }>("/auth/signup", {
        body: { full_name: f.get("name"), username: f.get("username"), password: f.get("password") },
      });
      if ("token" in d) { session.set(d.token); onDone(d); } else setSent(true);
    });
  };

  if (sent) {
    return (
      <Layout>
        <div className="done-mark"><Tick size={34} draw /></div>
        <h1>Request sent</h1>
        <p className="sub">
          Your school's administrator needs to approve your account. Once they do, you can sign in with the username and password you just chose.
        </p>
        <a className="btn primary lg block" href="#/signin">Go to sign in</a>
      </Layout>
    );
  }

  return (
    <Layout>
      <h1>{setup ? "Set up your school" : "Create your account"}</h1>
      <p className="sub">
        {setup
          ? "You're the first person here, so this account will be the administrator. You'll add teachers and classes next."
          : "An administrator approves new accounts before they can sign in."}
      </p>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Full name</span>
          <input className="input" name="name" autoComplete="name" placeholder="e.g. Muhau Nakwebwa" autoFocus required />
        </label>
        <label className="field">
          <span>Username</span>
          <input className="input" name="username" autoComplete="username" autoCapitalize="none" placeholder="e.g. mnakwebwa" pattern="[A-Za-z0-9._\-]{3,30}" required />
          <small>What you'll type to sign in. Letters, numbers, dots or dashes.</small>
        </label>
        <label className="field">
          <span>Password</span>
          <PasswordInput name="password" autoComplete="new-password" minLength={8} required />
          <small>At least 8 characters.</small>
        </label>
        <label className="field">
          <span>Confirm password</span>
          <PasswordInput name="confirm" autoComplete="new-password" minLength={8} required />
        </label>
        <Alert msg={error} />
        <button className="btn go lg block" disabled={busy || setup === null}>
          {busy ? "Creating account…" : setup ? "Create administrator account" : "Request account"}
        </button>
      </form>
      <p className="switch">Already have an account? <a href="#/signin">Sign in</a></p>
    </Layout>
  );
}
