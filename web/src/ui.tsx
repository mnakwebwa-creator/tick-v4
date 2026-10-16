import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Camera as CameraIcon, Check, Eye, EyeOff, ImageUp, Search, Trash2, X } from "lucide-react";

/* ---------- data hooks ---------- */

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(() => fn().then((d) => { setData(d); setError(""); }, (e: Error) => setError(e.message)), deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, reload: load };
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run, setError };
}

/* ---------- toasts ---------- */

type Toast = { id: number; text: string; bad?: boolean };
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, bad }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((t) => (
          <div key={t.id} className={`toast${t.bad ? " bad" : ""}`}>
            {t.bad ? <AlertCircle /> : <Check />} {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- small pieces ---------- */

export const Alert = ({ msg, tone = "bad" }: { msg?: string; tone?: "bad" | "info" | "warn" }) =>
  msg ? <div className={`alert ${tone}`} role={tone === "bad" ? "alert" : undefined}><AlertCircle />{msg}</div> : null;

export function Avatar({ name, size }: { name: string; size?: "lg" }) {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <span className={`avatar${size ? ` ${size}` : ""}`} data-tone={(h % 5) + 1} aria-hidden>{initials}</span>;
}

/** The hand-drawn tick used for "present" across the product. */
export function Tick({ size = 22, draw, delay }: { size?: number; draw?: boolean; delay?: number }) {
  return (
    <svg className={`tick${draw ? " draw" : ""}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 12.8 9.6 17.6 19.8 5.8" style={delay !== undefined ? { animationDelay: `${delay}s` } : undefined} />
    </svg>
  );
}

export function Logo({ href = "#/" }: { href?: string }) {
  return (
    <a className="logo" href={href} aria-label="Tick home">
      <span className="mark">
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
          <path d="M4.5 12.8 9.6 17.6 19.8 5.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      Tick
    </a>
  );
}

export function Empty({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw">
      <input {...props} className="input" type={show ? "text" : "password"} />
      <button type="button" className="btn ghost sm icon" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff /> : <Eye />}
      </button>
    </div>
  );
}

/* ---------- dialog ---------- */

export function Dialog({ open, onClose, title, intro, children }: {
  open: boolean; onClose: () => void; title: string; intro?: string; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <header>
            <div>
              <h2>{title}</h2>
              {intro && <p>{intro}</p>}
            </div>
            <button className="btn ghost sm icon" onClick={onClose} aria-label="Close"><X /></button>
          </header>
          <div className="body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/**
 * Confirm a destructive action. With `typeToConfirm`, the person must type that word
 * (e.g. the class name) first — used where a mistake would delete a lot.
 */
export function ConfirmDelete({ open, onClose, title, children, typeToConfirm, action = "Delete", onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; typeToConfirm?: string;
  action?: string; onConfirm: () => Promise<unknown>;
}) {
  const { busy, error, run, setError } = useAction();
  const [typed, setTyped] = useState("");
  const close = () => { setTyped(""); setError(""); onClose(); };
  const ready = !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();
  return (
    <Dialog open={open} onClose={close} title={title}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (ready) run(onConfirm).then((ok) => ok && close()); }}>
        <div className="muted">{children}</div>
        {typeToConfirm && (
          <label className="field">
            <span>Type <b>{typeToConfirm}</b> to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </label>
        )}
        <Alert msg={error} />
        <footer>
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button className="btn danger solid" disabled={busy || !ready}><Trash2 /> {action}</button>
        </footer>
      </form>
    </Dialog>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Search aria-hidden />
      <input className="input" type="search" value={value} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Case-insensitive "contains" across a few fields. */
export const matches = (term: string, ...fields: (string | null | undefined)[]) => {
  const t = term.trim().toLowerCase();
  return !t || fields.some((f) => f?.toLowerCase().includes(t));
};

/* ---------- photos ---------- */

/** Upload, drop, or take a photo. */
export function PhotoPicker({ onPhoto, disabled, hint, onCamera }: {
  onPhoto: (file: File) => void; disabled?: boolean; hint?: string;
  /** Replace the built-in snapshot camera (e.g. with live, automatic capture). */
  onCamera?: () => void;
}) {
  const [camera, setCamera] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (f?: File | null) => { if (f && f.type.startsWith("image/")) onPhoto(f); };

  if (camera) return <CameraView disabled={disabled} onPhoto={(f) => { onPhoto(f); }} onClose={() => setCamera(false)} />;

  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
    >
      <ImageUp />
      <div>
        <b>Drop a photo here</b>
        {hint && <p className="small muted">{hint}</p>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginTop: 4 }}>
        <button type="button" className="btn sm" disabled={disabled} onClick={() => input.current?.click()}>
          <ImageUp /> Choose photo
        </button>
        <button type="button" className="btn sm" disabled={disabled} onClick={() => (onCamera ? onCamera() : setCamera(true))}>
          <CameraIcon /> {onCamera ? "Live camera" : "Use camera"}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

function CameraView({ onPhoto, onClose, disabled }: { onPhoto: (file: File) => void; onClose: () => void; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stream: MediaStream | undefined;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here. On phones and tablets the camera needs a secure (https) address — choose a photo instead.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { width: 1280, facingMode: "environment" } })
      .then((s) => { stream = s; if (video.current) video.current.srcObject = s; })
      .catch(() => setError("The camera couldn't start. Allow camera access, or choose a photo instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);
  const snap = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    c.toBlob((b) => b && onPhoto(new File([b], "camera.jpg", { type: "image/jpeg" })), "image/jpeg", 0.92);
  };
  return (
    <div className="form">
      {error ? <Alert msg={error} /> : <div className="photo"><video ref={video} autoPlay playsInline muted /></div>}
      <div style={{ display: "flex", gap: 8 }}>
        {!error && <button type="button" className="btn go" disabled={disabled} onClick={snap}><CameraIcon /> Take photo</button>}
        <button type="button" className="btn" onClick={onClose}>Close camera</button>
      </div>
    </div>
  );
}

/* ---------- dates ---------- */

export const fmtDate = (d: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString(undefined, opts);

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
