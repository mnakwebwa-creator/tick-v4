export type Role = "admin" | "teacher";
export type User = { id: number; username: string; full_name: string; role: Role };
export type Staff = User & { status: "active" | "pending" | "suspended"; class_count: number };
export type Class = {
  id: number; name: string; academic_year: number; teacher_id: number | null;
  teacher_name?: string; status: "active" | "archived"; learner_count?: number; face_count?: number;
};
export type Learner = {
  id: number; student_number: string; full_name: string; class_id: number;
  consent: boolean; status: "active" | "inactive"; template_count?: number;
  templates?: { id: number; model_version: string; created_at: string }[];
};
export type LearnerHit = Learner & { class_name: string };
export type Session = {
  id: number; class_id: number; session_date: string; session_type: string; present?: number; absent?: number;
};
export type RegisterRow = {
  id: number; student_number: string; full_name: string; consent: boolean; template_count: number;
  status: "present" | "absent" | null; method: "face" | "manual" | null; similarity: number | null;
  confirmed_by: string | null;
};
export type SessionDetail = Session & { class: Class; learners: RegisterRow[] };
export type FaceResult = {
  box: [number, number, number, number];
  learner_id: number | null; similarity: number | null; verdict: "match" | "review" | "unknown";
};
export type MatchResult = { width: number; height: number; faces: FaceResult[] };
export type Dashboard = {
  totals: { classes: number; learners: number; with_face: number | null; no_consent: number | null };
  classes: {
    id: number; name: string; academic_year: number; teacher_name: string | null; learner_count: number;
    session_id: number | null; session_type: string | null; present: number; absent: number;
  }[];
  week: { day: string; present: number; marked: number }[];
  pending: number;
};

const TOKEN = "tick.token";
export const session = {
  get token() { try { return localStorage.getItem(TOKEN); } catch { return null; } },
  set(token: string | null) {
    try { if (token) localStorage.setItem(TOKEN, token); else localStorage.removeItem(TOKEN); } catch { /* private mode */ }
  },
};

/** API address. Empty = same site (Netlify, the local server). Set VITE_API_URL when the API lives elsewhere. */
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method || (opts.body ? "POST" : "GET"),
      headers: {
        ...(session.token ? { Authorization: `Bearer ${session.token}` } : {}),
        ...(opts.body && !isForm ? { "Content-Type": "application/json" } : {}),
      },
      body: isForm ? (opts.body as FormData) : opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new Error("Can't reach Tick. Check your connection, or that the school computer running Tick is on.");
  }
  if (res.status === 401 && session.token && !path.startsWith("/auth")) {
    session.set(null);
    location.hash = "#/signin";
    location.reload();
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
  return data as T;
}

/** Open (or re-open) today's register for a class. */
export const openRegister = (classId: number, date?: string, type?: string) =>
  api<Session>("/attendance/sessions", { body: { class_id: classId, session_date: date || null, session_type: type } });
