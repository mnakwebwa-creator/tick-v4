import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { CalendarCheck, LogOut, School, Settings, UsersRound } from "lucide-react";
import { api, session, type User } from "./api";
import { Landing } from "./pages/landing";
import { SignIn, SignUp } from "./pages/auth";
import { TodayPage } from "./pages/today";
import { ClassesPage, ClassPage } from "./pages/classes";
import { LearnerPage } from "./pages/learner";
import { RegisterPage } from "./pages/register";
import { StaffPage } from "./pages/staff";
import { SettingsPage } from "./pages/settings";
import { Avatar, Logo, ToastProvider } from "./ui";
import "./styles.css";

/** Hash router: #/classes/3 → ["classes", "3"] */
function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, "").split(/[/?]/).filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      // In-page anchors on the landing page (#how) aren't routes
      if (!location.hash.startsWith("#/") && location.hash.length > 1) return;
      setRoute(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

const go = (path: string) => { location.hash = path; };

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!session.token);
  const [pending, setPending] = useState(0);
  const route = useRoute();
  const [page = "", id] = route;

  useEffect(() => {
    if (!session.token) return;
    api<User>("/me").then(setUser).catch(() => session.set(null)).finally(() => setReady(true));
  }, []);

  // Keep the "staff waiting for approval" badge fresh for admins
  useEffect(() => {
    if (user?.role !== "admin") return;
    const check = () => api<{ id: number; status: string }[]>("/users").then((u) => setPending(u.filter((x) => x.status === "pending").length)).catch(() => {});
    check();
    const t = setInterval(check, 60_000);
    return () => clearInterval(t);
  }, [user, page]);

  if (!ready) return null;

  const signedIn = (d: { user: User }) => { setUser(d.user); go("#/today"); };

  if (!user) {
    if (page === "signin") return <SignIn onDone={signedIn} />;
    if (page === "signup") return <SignUp onDone={signedIn} />;
    if (page && page !== "") { go("#/signin"); return null; }
    return <Landing />;
  }

  if (page === "" || page === "signin" || page === "signup") { go("#/today"); return null; }

  const admin = user.role === "admin";
  const view =
    page === "classes" && id && id !== "new" ? <ClassPage id={id} user={user} /> :
    page === "classes" ? <ClassesPage user={user} startNew={id === "new"} /> :
    page === "learners" && id ? <LearnerPage id={id} /> :
    page === "registers" && id ? <RegisterPage id={id} /> :
    page === "staff" && admin ? <StaffPage user={user} onChange={setPending} /> :
    page === "settings" ? <SettingsPage user={user} onUser={setUser} /> :
    <TodayPage user={user} />;

  const section = ["classes", "learners"].includes(page) ? "classes" : page === "registers" ? "today" : page;

  const signOut = () => { session.set(null); setUser(null); go("#/"); };

  return (
    <Shell user={user} section={section} pending={pending} onSignOut={signOut}>
      {view}
    </Shell>
  );
}

function Shell({ user, section, pending, onSignOut, children }: {
  user: User; section: string; pending: number; onSignOut: () => void; children: ReactNode;
}) {
  const items = [
    { key: "today", label: "Today", icon: <CalendarCheck /> },
    { key: "classes", label: "Classes", icon: <School /> },
    ...(user.role === "admin" ? [{ key: "staff", label: "Staff", icon: <UsersRound />, count: pending }] : []),
    { key: "settings", label: "Settings", icon: <Settings /> },
  ];
  return (
    <div className="shell">
      <aside className="side" aria-label="Main">
        <Logo href="#/today" />
        {items.map((i) => (
          <a key={i.key} href={`#/${i.key}`} className={`nav-item${section === i.key ? " on" : ""}`} aria-current={section === i.key ? "page" : undefined}>
            {i.icon} {i.label}
            {!!("count" in i && i.count) && <span className="count" aria-label={`${i.count} waiting`}>{i.count}</span>}
          </a>
        ))}
        <div className="me">
          <Avatar name={user.full_name} />
          <div>
            <b>{user.full_name}</b>
            <small>{user.role === "admin" ? "Administrator" : "Teacher"}</small>
          </div>
          <button className="btn ghost sm icon" onClick={onSignOut} aria-label="Sign out" title="Sign out"><LogOut /></button>
        </div>
      </aside>

      <header className="topbar">
        <Logo href="#/today" />
        <a href="#/settings" aria-label="Your account"><Avatar name={user.full_name} /></a>
      </header>

      <main className="main">{children}</main>

      <nav className="tabbar" aria-label="Main" style={{ ["--n" as string]: items.length }}>
        {items.map((i) => (
          <a key={i.key} href={`#/${i.key}`} className={section === i.key ? "on" : ""} aria-current={section === i.key ? "page" : undefined}>
            {i.icon}
            {i.label}
            {!!("count" in i && i.count) && <span className="dot" />}
          </a>
        ))}
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider><App /></ToastProvider>
  </StrictMode>,
);
