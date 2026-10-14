import { ArrowRight, CalendarPlus, School, UserPlus } from "lucide-react";
import { api, openRegister, type Dashboard, type User } from "../api";
import { Alert, Empty, Spinner, fmtDate, plural, today, useAction, useLoad } from "../ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function TodayPage({ user }: { user: User }) {
  const d = useLoad(() => api<Dashboard>("/dashboard"), []);
  const start = useAction();
  const first = user.full_name.split(" ")[0];
  const dateText = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  const take = (classId: number) => start.run(async () => {
    const s = await openRegister(classId);
    location.hash = `#/registers/${s.id}`;
  });

  return (
    <>
      <div className="page-head hello">
        <div>
          <p className="muted" style={{ marginBottom: 6 }}>{dateText}</p>
          <h1>{greeting()}, {first}</h1>
        </div>
      </div>

      <Alert msg={d.error || start.error} />

      {!!d.data?.pending && (
        <a href="#/staff" className="alert warn" style={{ textDecoration: "none", marginBottom: 24, alignItems: "center" }}>
          <UserPlus />
          <span style={{ flex: 1 }}>{plural(d.data.pending, "person is", "people are")} waiting for you to approve their account.</span>
          <ArrowRight />
        </a>
      )}

      {!d.data && !d.error && <Spinner />}

      {d.data && (
        <div className="cols">
          <section className="panel">
            <div className="ph">
              <h2>Today's registers</h2>
              <span className="faint small">{fmtDate(today(), { day: "numeric", month: "long" })}</span>
            </div>
            {d.data.classes.length === 0 ? (
              <Empty
                icon={<School />}
                title={user.role === "admin" ? "Create your first class" : "No classes yet"}
                action={user.role === "admin" ? <a className="btn primary" href="#/classes/new">Create a class</a> : undefined}
              >
                {user.role === "admin"
                  ? "Classes hold your learners and their registers. Start with one, like Form 2A."
                  : "Ask your administrator to assign you a class. It will appear here."}
              </Empty>
            ) : (
              <div>
                {d.data.classes.map((c) => {
                  const marked = c.present + c.absent;
                  const pct = (n: number) => (c.learner_count ? (n / c.learner_count) * 100 : 0);
                  const done = c.session_id && marked >= c.learner_count && c.learner_count > 0;
                  return (
                    <div className="today-row" key={c.id}>
                      <div className="who">
                        <a href={`#/classes/${c.id}`}><b>{c.name}</b></a>
                        <small>{c.teacher_name ?? "No teacher assigned"}, {plural(c.learner_count, "learner")}</small>
                      </div>
                      <div className="prog">
                        <div className="bar" role="img" aria-label={`${c.present} present, ${c.absent} absent of ${c.learner_count}`}>
                          <i className="p" style={{ width: `${pct(c.present)}%` }} />
                          <i className="a" style={{ width: `${pct(c.absent)}%` }} />
                        </div>
                        <small>
                          <span>{c.session_id ? `${c.present} present` : "Not started"}</span>
                          {c.session_id && <span>{c.absent} absent</span>}
                        </small>
                      </div>
                      {c.session_id ? (
                        <a className={`btn sm${done ? "" : " primary"}`} href={`#/registers/${c.session_id}`}>{done ? "View" : "Continue"}</a>
                      ) : (
                        <button className="btn sm go" disabled={start.busy || !c.learner_count} onClick={() => take(c.id)}>
                          <CalendarPlus /> Take register
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <div className="stack">
            <section className="panel">
              <div className="ph"><h2>This week</h2><span className="faint small">Share of learners marked present</span></div>
              <div className="pb"><Week week={d.data.week} /></div>
            </section>

            <section className="panel">
              <div className="ph"><h2>Your learners</h2></div>
              <div className="facts">
                <div><b className="num">{d.data.totals.classes}</b><small>{d.data.totals.classes === 1 ? "class" : "classes"}</small></div>
                <div><b className="num">{d.data.totals.learners}</b><small>learners</small></div>
                <div><b className="num">{d.data.totals.with_face ?? 0}</b><small>with a face added</small></div>
                <div><b className="num">{d.data.totals.no_consent ?? 0}</b><small>without guardian consent</small></div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

/** Last 7 days, one bar per day: % of marked learners who were present. */
function Week({ week }: { week: Dashboard["week"] }) {
  const byDay = new Map(week.map((w) => [w.day, w]));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { key, label: d.toLocaleDateString(undefined, { weekday: "short" }), w: byDay.get(key) };
  });
  const latest = [...days].reverse().find((d) => d.w && d.w.marked)?.key;
  if (!week.length) return <p className="muted small">Once registers are saved, each day's attendance shows here.</p>;
  return (
    <>
      <div className="week">
        {days.map(({ key, label, w }) => {
          const pct = w && w.marked ? Math.round((w.present / w.marked) * 100) : null;
          return (
            <div className="col" key={key} tabIndex={0} aria-label={pct === null ? `${label}: no register` : `${label}: ${pct}% present`}>
              <div className="track">
                {pct === null ? <span className="none" /> : (
                  <span className="fill" style={{ height: `${Math.max(pct, 2)}%`, position: "relative" }}>
                    {key === latest && <span className="val">{pct}%</span>}
                  </span>
                )}
              </div>
              <span className="lbl">{label}</span>
              <span className="tip">{pct === null ? "No register" : `${pct}% present (${w!.present} of ${w!.marked})`}</span>
            </div>
          );
        })}
      </div>
      <table className="sr">
        <caption>Attendance this week</caption>
        <tbody>{days.map(({ key, label, w }) => <tr key={key}><th>{label}</th><td>{w ? `${w.present} of ${w.marked} present` : "No register"}</td></tr>)}</tbody>
      </table>
    </>
  );
}
