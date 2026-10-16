import { Camera, CircleCheck, EyeOff, Hand, KeyRound, Lock, PenLine, ScanFace, ShieldCheck, UserCheck, Users, WifiOff } from "lucide-react";
import { Logo, Tick } from "../ui";
import { InstallButton } from "../pwa";

/* A class photo drawn as simple figures: [x, y, head radius, skin, uniform] in a 300×400 frame */
const KIDS: [number, number, number, string, string][] = [
  [62, 128, 25, "#6b4430", "#e8eef8"],
  [150, 120, 25, "#8a5a3c", "#e8eef8"],
  [238, 128, 25, "#5a3a28", "#e8eef8"],
  [58, 246, 29, "#7a4e34", "#2f7d57"],
  [150, 238, 29, "#4e3224", "#2f7d57"],
  [242, 246, 29, "#93623f", "#2f7d57"],
];
const NAMES = ["Namakau Liswaniso", "Mwangala Sitali", "Chanda Mulenga", "Inonge Mubita", "Bupe Mwansa", "Mutinta Hamoonga"];
const CHECK = 4; // the one the teacher is asked to check
const t0 = 1.0; // seconds — after the shutter
const gap = 0.42;

function Scene() {
  return (
    <div className="scene" role="img" aria-label="A class photo where each face is recognised and ticked off on the register">
      <div className="photo-pane">
        <svg className="kids" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <rect x="0" y="300" width="300" height="100" fill="#1a2440" />
          <rect x="0" y="0" width="300" height="300" fill="url(#wall)" />
          <defs>
            <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#33467a" />
              <stop offset="1" stopColor="#25345c" />
            </linearGradient>
          </defs>
          <rect x="22" y="22" width="256" height="58" rx="4" fill="#24402f" opacity="0.9" />
          <path d="M40 46h70M40 60h110M180 46h70" stroke="#e8eef8" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
          {KIDS.map(([x, y, r, skin, shirt], i) => (
            <g key={i}>
              <path d={`M${x - r * 2.1} ${y + r * 4.6} Q${x - r * 2} ${y + r * 1.25} ${x} ${y + r * 1.2} Q${x + r * 2} ${y + r * 1.25} ${x + r * 2.1} ${y + r * 4.6} Z`} fill={shirt} />
              <path d={`M${x - r * 0.45} ${y + r * 1.15} L${x} ${y + r * 1.8} L${x + r * 0.45} ${y + r * 1.15}`} fill={skin} />
              <circle cx={x} cy={y} r={r} fill={skin} />
              <path d={`M${x - r * 0.95} ${y - r * 0.25} Q${x} ${y - r * 1.55} ${x + r * 0.95} ${y - r * 0.25} Q${x} ${y - r * 0.9} ${x - r * 0.95} ${y - r * 0.25} Z`} fill="#1b120c" />
            </g>
          ))}
        </svg>
        <div className="shutter" />
        {KIDS.map(([x, y, r], i) => {
          const pad = 7;
          return (
            <div key={i} className={`fbox${i === CHECK ? " check" : ""}`} style={{
              left: `${((x - r - pad) / 300) * 100}%`, top: `${((y - r - pad) / 400) * 100}%`,
              width: `${((2 * (r + pad)) / 300) * 100}%`, height: `${((2 * (r + pad)) / 400) * 100}%`,
              animationDelay: `${t0 + i * gap}s`,
            }}>
              <span>{i === CHECK ? "Check" : NAMES[i].split(" ")[0]}</span>
            </div>
          );
        })}
      </div>

      <div className="paper">
        <div className="head">
          <b>Form 2A</b>
          <small>Morning register, today</small>
        </div>
        {NAMES.map((n, i) => (
          <div className="prow" key={n}>
            <span className="n">{i + 1}</span>
            <span className="who">{n}</span>
            <span className="mark">
              {i === CHECK
                ? <span className="q" style={{ animationDelay: `${t0 + i * gap + 0.2}s` }}>?</span>
                : <Tick size={22} delay={t0 + i * gap + 0.2} />}
            </span>
          </div>
        ))}
      </div>
      <div className="confirm-chip"><CircleCheck /> 5 ready to confirm</div>
    </div>
  );
}

export function Landing() {
  return (
    <div className="land">
      <header className="wrap land-nav">
        <Logo />
        <nav aria-label="Page">
          <a href="#how">How it works</a>
          <a href="#care">Teachers decide</a>
          <a href="#privacy">Privacy</a>
        </nav>
        <a className="btn ghost hide-sm" href="#/signin">Sign in</a>
        <a className="btn primary" href="#/signup">Get started</a>
      </header>

      <main>
        <section className="wrap hero">
          <div>
            <h1>Take the register in the time it takes to take a photo.</h1>
            <p className="lead">
              Tick recognises your learners as they walk past the camera, or in one class photo, and fills in the register for you.
              You check the names, tap confirm, and the morning register is done.
            </p>
            <div className="ctas">
              <a className="btn go lg" href="#/signup">Set up your school</a>
              <a className="btn lg" href="#/signin">Sign in</a>
              <InstallButton className="btn lg ghost" label="Install the app" />
            </div>
            <p className="note">Recognises learners live through the camera — or from a photo. Install it on a phone like any app, or run it on your school's own computer with no internet needed.</p>
          </div>
          <Scene />
        </section>

        <section className="how" id="how">
          <div className="wrap">
            <h2>Three steps, and only the first one takes time.</h2>
            <p>Enrol each class once. After that, a register is one photo and one tap.</p>
            <div className="steps">
              <div className="step">
                <span className="k">1</span>
                <h3>Enrol your class</h3>
                <p>Add learners by name and student number, then take one clear photo of each learner whose guardian has agreed.</p>
                <div className="eg"><Users /> Form 2A — 42 learners, 38 with photos</div>
              </div>
              <div className="step">
                <span className="k">2</span>
                <h3>Take one photo</h3>
                <p>Photograph the class, or learners one at a time as they come in. Tick finds every face and suggests a name for each.</p>
                <div className="eg"><Camera /> 36 faces found, 34 matched</div>
              </div>
              <div className="step">
                <span className="k">3</span>
                <h3>Confirm and save</h3>
                <p>Clear matches are ticked for you. Anything uncertain waits for you to check. Mark anyone missing by hand.</p>
                <div className="eg"><CircleCheck /> Register saved at 07:42</div>
              </div>
            </div>
          </div>
        </section>

        <section className="care wrap" id="care">
          <div className="grid2">
            <div>
              <h2>The teacher always has the last word.</h2>
              <p className="intro">Tick suggests. You decide. Nothing goes into the register until a teacher says so.</p>
            </div>
            <ul className="rules">
              <li>
                <span className="ic"><UserCheck /></span>
                <div><b>Every name is confirmed by you</b><p>Suggestions sit on screen until you press confirm. Untick any you disagree with.</p></div>
              </li>
              <li>
                <span className="ic"><ScanFace /></span>
                <div><b>Uncertain matches are flagged</b><p>If Tick isn't sure, the face is marked "check" and left unticked for you to decide.</p></div>
              </li>
              <li>
                <span className="ic"><Hand /></span>
                <div><b>No one is marked absent by a machine</b><p>A face that isn't recognised stays unmarked. Absences are always a teacher's call.</p></div>
              </li>
              <li>
                <span className="ic"><PenLine /></span>
                <div><b>Marking by hand always works</b><p>Learners without photos, a camera that won't start, a power cut — the register works either way.</p></div>
              </li>
            </ul>
          </div>
        </section>

        <section className="safe" id="privacy">
          <div className="wrap">
            <h2>Built for children's information.</h2>
            <p className="intro">Faces are sensitive. Tick keeps as little as it can, and photos never leave the device that took them.</p>
            <div className="safe-grid">
              <div><EyeOff /><b>Photos are never uploaded</b><p>Faces are read on the phone or computer that took the photo. Only a set of numbers is sent. No picture of a learner is stored.</p></div>
              <div><KeyRound /><b>Guardian consent comes first</b><p>A face can't be added until consent is recorded. Withdrawing it deletes the learner's face data.</p></div>
              <div><Lock /><b>Encrypted face data</b><p>The numbers that describe a face are encrypted, so a copied database can't be read.</p></div>
              <div><ShieldCheck /><b>Each teacher sees their own classes</b><p>Administrators approve every new account and decide who sees which class.</p></div>
              <div><WifiOff /><b>Runs where you choose</b><p>Online, so teachers can sign in anywhere, or on one computer at your school with no internet needed.</p></div>
              <div><PenLine /><b>A full record of changes</b><p>Every enrolment, recognition and correction is logged with who did it and when.</p></div>
            </div>
          </div>
        </section>

        <section className="cta wrap">
          <h2>Ready for tomorrow morning's register?</h2>
          <p>The first account you create becomes your school's administrator. Then add your teachers and classes.</p>
          <div className="ctas">
            <a className="btn go lg" href="#/signup">Set up your school</a>
            <a className="btn lg" href="#/signin">I already have an account</a>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <Logo />
          <span>School attendance by photo, with teachers in charge.</span>
        </div>
      </footer>
    </div>
  );
}
