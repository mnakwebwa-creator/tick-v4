/**
 * Live camera screens: the register recognises learners as they come into view, and
 * enrolment captures a face by itself once it is clear and still. No button to press.
 */
import { useEffect, useRef, useState } from "react";
import { CameraOff, RefreshCw, ScanFace, SwitchCamera, Zap } from "lucide-react";
import { api, type FaceResult, type MatchResult, type RegisterRow } from "../api";
import { MODEL_VERSION } from "./core";
import { FrameReader, Tracker, runLoop, type Box, type Track } from "./live";
import { Alert, Tick, plural, useToast } from "../ui";

/* ---------- camera ---------- */

type Facing = "user" | "environment";
const FACING = "tick.facing";

function useCamera(on: boolean) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacingState] = useState<Facing>(() => {
    try { return (localStorage.getItem(FACING) as Facing) || "environment"; } catch { return "environment"; }
  });
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [canSwitch, setCanSwitch] = useState(false);
  const [actual, setActual] = useState<Facing>(facing);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | undefined;
    let cancelled = false;
    setReady(false);
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here. The camera needs a secure (https) address — use Photo instead.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then(async (s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        const settings = s.getVideoTracks()[0]?.getSettings();
        // Laptops report no facing mode: their webcam faces the user
        setActual(settings?.facingMode === "environment" ? "environment" : "user");
        const v = video.current;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
          setReady(true);
        }
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
        setCanSwitch(devices.filter((d) => d.kind === "videoinput").length > 1);
      })
      .catch((e: DOMException) => setError(
        e?.name === "NotAllowedError"
          ? "Camera access was blocked. Allow the camera for this site in the browser settings, or use Photo instead."
          : "The camera couldn't start. Close other apps using it, or use Photo instead.",
      ));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); setReady(false); };
  }, [on, facing]);

  const flip = () => {
    const next: Facing = facing === "user" ? "environment" : "user";
    try { localStorage.setItem(FACING, next); } catch { /* ignore */ }
    setFacingState(next);
  };
  return { video, error, ready, canSwitch, flip, mirror: actual === "user" };
}

/** The video with face boxes drawn on top. */
function Stage({ cam, boxes, width, height, children }: {
  cam: ReturnType<typeof useCamera>; boxes: { key: number; box: Box; tone: string; label: string }[];
  width: number; height: number; children?: React.ReactNode;
}) {
  return (
    <div className={`live-stage${cam.mirror ? " mirror" : ""}`} style={width && height ? { aspectRatio: `${width} / ${height}` } : undefined}>
      <video ref={cam.video} autoPlay playsInline muted />
      <div className="boxes" aria-hidden>
        {width > 0 && boxes.map((b) => (
          <div key={b.key} className={`box ${b.tone}`} style={{
            left: `${(b.box[0] / width) * 100}%`, top: `${(b.box[1] / height) * 100}%`,
            width: `${(b.box[2] / width) * 100}%`, height: `${(b.box[3] / height) * 100}%`,
          }}>{b.label && <span>{b.label}</span>}</div>
        ))}
      </div>
      {children}
      {cam.canSwitch && (
        <button type="button" className="btn sm icon cam-flip" onClick={cam.flip} aria-label="Switch camera" title="Switch camera"><SwitchCamera /></button>
      )}
    </div>
  );
}

const firstName = (n?: string) => (n ?? "").split(" ")[0];

/* ---------- live register ---------- */

type Seen = { learner_id: number; similarity: number | null; verdict: "match" | "review"; at: number };
const AUTO = "tick.autoMark";

export function LiveRegister({ sessionId, learners, busy, disabled, onConfirm }: {
  sessionId: number; learners: RegisterRow[]; busy: boolean; disabled?: boolean;
  onConfirm: (rows: { learner_id: number; similarity: number | null }[], quiet?: boolean) => Promise<boolean>;
}) {
  const [on, setOn] = useState(false);
  const cam = useCamera(on);
  const toast = useToast();
  const [note, setNote] = useState("");
  const [frame, setFrame] = useState<{ w: number; h: number; tracks: Track[] }>({ w: 0, h: 0, tracks: [] });
  const [seen, setSeen] = useState<Map<number, Seen>>(new Map());
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [auto, setAutoState] = useState(() => { try { return localStorage.getItem(AUTO) === "1"; } catch { return false; } });
  const [error, setError] = useState("");

  // Values the camera loop reads without restarting
  const byId = new Map(learners.map((l) => [l.id, l]));
  const live = useRef({ byId, auto, seen, onConfirm, saving: new Set<number>() });
  live.current.byId = byId;
  live.current.auto = auto;
  live.current.seen = seen;
  live.current.onConfirm = onConfirm;

  const setAuto = (v: boolean) => { setAutoState(v); try { localStorage.setItem(AUTO, v ? "1" : "0"); } catch { /* ignore */ } };

  useEffect(() => {
    if (!on || !cam.ready) return;
    const reader = new FrameReader();
    const tracker = new Tracker();
    let alive = true;
    let inflight = 0;
    let fails = 0;
    let stop = () => {};
    setNote("Getting face recognition ready…");

    const identify = async (tracks: Track[], embeddings: number[][], width: number, height: number) => {
      inflight++;
      tracks.forEach((t) => { t.pending = true; t.tries++; t.triedAt = performance.now(); });
      try {
        const r = await api<MatchResult>("/recognition/match", {
          body: { session_id: sessionId, live: true, width, height, faces: tracks.map((t, i) => ({ box: t.box, embedding: embeddings[i] })) },
        });
        fails = 0;
        r.faces.forEach((f: FaceResult, i) => {
          const t = tracks[i];
          if (!f.learner_id) { if (!t.learner_id) t.verdict = "unknown"; return; }
          // Keep the best answer this face has had
          if (t.verdict === "match" && t.learner_id !== f.learner_id && (t.similarity ?? 0) >= (f.similarity ?? 0)) return;
          t.learner_id = f.learner_id; t.similarity = f.similarity; t.verdict = f.verdict;
          note(f.learner_id, f.similarity, f.verdict === "match" ? "match" : "review");
        });
      } catch (e) {
        if (++fails >= 3) setError((e as Error).message);
      } finally {
        tracks.forEach((t) => { t.pending = false; });
        inflight--;
      }
    };

    const note = (learnerId: number, similarity: number | null, verdict: "match" | "review") => {
      const prev = live.current.seen.get(learnerId);
      if (prev && (prev.verdict === "match" || verdict === "review") && (prev.similarity ?? 0) >= (similarity ?? 0)) return;
      const entry: Seen = { learner_id: learnerId, similarity, verdict, at: Date.now() };
      setSeen((m) => new Map(m).set(learnerId, entry));
      const l = live.current.byId.get(learnerId);
      if (verdict !== "match" || l?.status === "present") return;
      if (live.current.auto) {
        if (live.current.saving.has(learnerId)) return;
        live.current.saving.add(learnerId);
        live.current.onConfirm([{ learner_id: learnerId, similarity }], true).then((ok) => {
          if (ok) toast(`${l?.full_name ?? "Learner"} marked present`);
          else live.current.saving.delete(learnerId);
        });
      } else {
        setPicked((p) => new Set(p).add(learnerId));
      }
    };

    reader.start(setNote).then(() => {
      if (!alive) return;
      setNote("");
      stop = runLoop(async () => {
        const v = cam.video.current;
        if (!v) return;
        const f = await reader.read(v);
        if (!f) return;
        const now = performance.now();
        tracker.update(f.faces, now);
        // Ask about new or uncertain faces; at most two requests on the way at once
        const ask = inflight < 2 ? tracker.needingId(now) : [];
        if (ask.length) {
          const emb = await reader.embed(ask.map((t) => t.face));
          identify(ask, emb, f.width, f.height);
        }
        setFrame({ w: f.width, h: f.height, tracks: tracker.tracks.filter((t) => t.seenAt === now).map((t) => ({ ...t })) });
      }, () => alive);
    }).catch((e: Error) => setError(e.message));

    return () => { alive = false; stop(); };
  }, [on, cam.ready, sessionId, cam.video, toast]);

  const toggle = (id: number) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = [...seen.values()].sort((a, b) => b.at - a.at);
  const toConfirm = list.filter((s) => picked.has(s.learner_id) && byId.get(s.learner_id)?.status !== "present");
  const confirmPicked = async () => {
    if (await onConfirm(toConfirm.map((s) => ({ learner_id: s.learner_id, similarity: s.similarity })))) {
      setPicked(new Set());
    }
  };

  const boxes = frame.tracks.map((t) => {
    const l = t.learner_id ? byId.get(t.learner_id) : undefined;
    const tone = t.verdict === "match" ? "match" : t.verdict === "review" ? "review" : t.verdict === "unknown" ? "unknown" : "looking";
    const label = l ? `${firstName(l.full_name)}${l.status === "present" ? " ✓" : t.verdict === "review" ? "?" : ""}` : t.verdict === "unknown" ? "Not known" : "";
    return { key: t.id, box: t.box, tone, label };
  });
  const presentCount = learners.filter((l) => l.status === "present").length;

  if (!on) {
    return (
      <div className="pb form">
        <div className="live-start">
          <ScanFace />
          <div>
            <b>Recognise as they walk past</b>
            <p className="small muted">Point the camera at learners. Names appear on their faces straight away — no photo to take.</p>
          </div>
          <button className="btn go" disabled={disabled} onClick={() => { setError(""); setOn(true); }}>Start camera</button>
        </div>
        <label className="check">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span><b>Mark clear matches present automatically</b><span className="small muted">Off: you confirm the list below. Uncertain faces always wait for you.</span></span>
        </label>
      </div>
    );
  }

  return (
    <div className="pb form">
      {cam.error ? <Alert msg={cam.error} /> : (
        <Stage cam={cam} boxes={boxes} width={frame.w} height={frame.h}>
          <div className="live-hud">
            <span className="rec" /> Live
            <span className="sep" />{plural(frame.tracks.length, "face")}
            {auto && <><span className="sep" /><Zap size={13} /> Auto</>}
          </div>
          {note && <div className="live-note"><ScanFace size={18} /> {note}</div>}
        </Stage>
      )}
      <Alert msg={error} />
      <div className="live-bar">
        <button className="btn sm" onClick={() => setOn(false)}><CameraOff /> Stop camera</button>
        <label className="switch">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Auto-mark clear matches</span>
        </label>
      </div>

      {list.length > 0 && (
        <div className="form" style={{ gap: 8 }}>
          <div className="small muted">Seen so far: {plural(list.length, "learner")}, {presentCount} present on the register</div>
          {list.map((s) => {
            const l = byId.get(s.learner_id);
            const already = l?.status === "present";
            return (
              <label key={s.learner_id} className="proposal">
                <input type="checkbox" disabled={already} checked={already || picked.has(s.learner_id)} onChange={() => toggle(s.learner_id)} />
                <span className="grow">
                  <b>{l?.full_name ?? "Learner"}</b>
                  <small>{already ? "Present" : s.verdict === "match" ? "Clear match" : "Not certain — check before ticking"}</small>
                </span>
                {already ? <Tick size={20} /> : s.verdict === "review" && <span className="badge amber">Check</span>}
              </label>
            );
          })}
        </div>
      )}
      {toConfirm.length > 0 && (
        <button className="btn go lg block" disabled={busy} onClick={confirmPicked}>Confirm {toConfirm.length} present</button>
      )}
      <p className="faint small">
        {auto ? "Clear matches are saved as they're seen; uncertain ones wait for you." : "Nothing is saved until you confirm."} The video stays on this device. No one is marked absent by the camera.
      </p>
    </div>
  );
}

/* ---------- live enrolment ---------- */

const ENROL_MIN_PX = 96; // a good template needs a reasonably large face
const HOLD_MS = 700;

export function LiveEnrol({ learnerId, existing, onAdded, onClose }: {
  learnerId: number; existing: number; onAdded: () => void; onClose: () => void;
}) {
  const cam = useCamera(true);
  const [state, setState] = useState<{ msg: string; tone: "info" | "hold" | "warn" | "done"; progress: number }>({ msg: "Getting ready…", tone: "info", progress: 0 });
  const [frame, setFrame] = useState<{ w: number; h: number; box: Box | null }>({ w: 0, h: 0, box: null });
  const [saved, setSaved] = useState(0);
  const [round, setRound] = useState(0);
  const [error, setError] = useState("");
  const total = existing; // refreshed from the server after each save
  const capturing = saved === round && total < 3;
  const added = useRef(onAdded);
  added.current = onAdded;

  useEffect(() => {
    if (!cam.ready || !capturing) return;
    const reader = new FrameReader();
    const tracker = new Tracker(400);
    let alive = true;
    let busy = false;
    let stop = () => {};
    reader.start((m) => setState({ msg: m, tone: "info", progress: 0 })).then(() => {
      stop = runLoop(async () => {
        const v = cam.video.current;
        if (!v || busy) return;
        const f = await reader.read(v);
        if (!f) return;
        const now = performance.now();
        tracker.update(f.faces, now);
        const face = f.faces[0];
        setFrame({ w: f.width, h: f.height, box: f.faces.length === 1 ? face.box : null });
        if (!f.faces.length) return setState({ msg: "Look at the camera", tone: "info", progress: 0 });
        if (f.faces.length > 1) return setState({ msg: "Only one face at a time, please", tone: "warn", progress: 0 });
        if (Math.min(face.box[2], face.box[3]) < ENROL_MIN_PX) return setState({ msg: "Move a little closer", tone: "warn", progress: 0 });
        if (face.score < 0.88) return setState({ msg: "Face the camera, in good light", tone: "warn", progress: 0 });
        const t = tracker.tracks.find((x) => x.seenAt === now)!;
        const held = now - t.stableSince;
        if (held < HOLD_MS) return setState({ msg: "Hold still…", tone: "hold", progress: held / HOLD_MS });
        busy = true;
        setState({ msg: "Saving…", tone: "hold", progress: 1 });
        try {
          const [embedding] = await reader.embed([face]);
          await api(`/learners/${learnerId}/face-templates`, { body: { embedding, model_version: MODEL_VERSION } });
          alive = false;
          setSaved((n) => n + 1);
          setState({ msg: "Face saved", tone: "done", progress: 1 });
          added.current();
        } catch (e) {
          setError((e as Error).message);
          busy = false;
          tracker.reset();
        }
      }, () => alive);
    }).catch((e: Error) => setError(e.message));
    return () => { alive = false; stop(); };
  }, [cam.ready, capturing, learnerId, cam.video]);

  const tone = state.tone === "done" ? "match" : state.tone === "hold" ? "match" : state.tone === "warn" ? "review" : "looking";
  return (
    <div className="form">
      {cam.error ? <Alert msg={cam.error} /> : (
        <Stage cam={cam} width={frame.w} height={frame.h}
          boxes={frame.box && capturing ? [{ key: 1, box: frame.box, tone, label: "" }] : []}>
          <div className="enrol-guide" aria-hidden><i /></div>
          <div className={`live-note ${state.tone}`} role="status">
            {state.tone === "done" ? <Tick size={18} /> : <ScanFace size={18} />} {state.msg}
            {state.tone === "hold" && <span className="hold"><i style={{ width: `${Math.round(state.progress * 100)}%` }} /></span>}
          </div>
        </Stage>
      )}
      <Alert msg={error} />
      <div className="live-bar">
        {!capturing && total < 3 && (
          <button className="btn sm go" onClick={() => { setError(""); setState({ msg: "Turn the head slightly", tone: "info", progress: 0 }); setRound(saved); }}>
            <RefreshCw /> Add another angle
          </button>
        )}
        <button className="btn sm" onClick={onClose}>{saved ? "Done" : "Close camera"}</button>
        <span className="faint small" style={{ marginLeft: "auto" }}>{total} of 3 photos</span>
      </div>
      {capturing && <p className="faint small">The face is captured by itself once it's clear and still. Nothing is uploaded except an encrypted description of the face.</p>}
    </div>
  );
}
