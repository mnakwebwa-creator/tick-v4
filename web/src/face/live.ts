/**
 * Real-time recognition from a camera stream: no photo needs to be taken.
 *
 * Each frame is read from the <video>, faces are found at a small size (fast), and
 * each face is followed from frame to frame (a "track"). Only new or still-unknown
 * tracks are turned into embeddings — from the full-size frame, so quality matches
 * photo mode — and sent to the server for matching. Frames never leave the device.
 */
import { MIN_FACE_PX, detect, embed, type Rgba } from "./core";
import { getEngine } from "./index";

const FULL_SIDE = 1280; // same limit as photo mode, so embeddings are comparable
const DETECT_SIDE = 640; // detection runs on a smaller copy: much faster, still finds faces ≥ 30 px

export type Box = [number, number, number, number];
export type LiveFace = { box: Box; raw: Float32Array; score: number };
export type Frame = { width: number; height: number; faces: LiveFace[] };

type Ctx = CanvasRenderingContext2D;
const canvas = (): [HTMLCanvasElement, Ctx] => {
  const c = document.createElement("canvas");
  return [c, c.getContext("2d", { willReadFrequently: true })!];
};

/** Reads frames from a video and finds faces in them. */
export class FrameReader {
  private full = canvas();
  private small = canvas();
  private ready = false;

  async start(onProgress?: (msg: string) => void) {
    await getEngine(onProgress);
    this.ready = true;
  }

  /** Grab the current video frame and find the faces in it (coordinates in full-frame pixels). */
  async read(video: HTMLVideoElement): Promise<Frame | null> {
    if (!this.ready || !video.videoWidth || video.readyState < 2) return null;
    const { ort, yunet } = await getEngine();
    const fs = Math.min(1, FULL_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const fw = Math.trunc(video.videoWidth * fs), fh = Math.trunc(video.videoHeight * fs);
    const [fc, fx] = this.full;
    if (fc.width !== fw || fc.height !== fh) { fc.width = fw; fc.height = fh; }
    fx.drawImage(video, 0, 0, fw, fh);

    const ds = Math.min(1, DETECT_SIDE / Math.max(fw, fh));
    const sw = Math.trunc(fw * ds), sh = Math.trunc(fh * ds);
    const [sc, sx] = this.small;
    if (sc.width !== sw || sc.height !== sh) { sc.width = sw; sc.height = sh; }
    sx.drawImage(fc, 0, 0, sw, sh);
    const img = sx.getImageData(0, 0, sw, sh);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raws = await detect(ort as any, yunet as any, { data: img.data, width: sw, height: sh });
    const kx = fw / sw, ky = fh / sh;
    const faces: LiveFace[] = [];
    for (const r of raws) {
      const raw = new Float32Array(r);
      for (let i = 0; i < 14; i++) raw[i] = r[i] * (i % 2 ? ky : kx);
      const box: Box = [Math.trunc(raw[0]), Math.trunc(raw[1]), Math.trunc(raw[2]), Math.trunc(raw[3])];
      if (Math.min(box[2], box[3]) < MIN_FACE_PX) continue;
      faces.push({ box, raw, score: raw[14] });
    }
    return { width: fw, height: fh, faces };
  }

  /** Embeddings for faces from the frame just read (call before the next read). */
  async embed(faces: LiveFace[]): Promise<number[][]> {
    const { ort, sface } = await getEngine();
    const [fc, fx] = this.full;
    const d = fx.getImageData(0, 0, fc.width, fc.height);
    const img: Rgba = { data: d.data, width: d.width, height: d.height };
    const out: number[][] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of faces) out.push(await embed(ort as any, sface as any, img, f.raw));
    return out;
  }
}

/* ---------- following faces between frames ---------- */

export type Verdict = "match" | "review" | "unknown";
export type Track = {
  id: number; box: Box; face: LiveFace; firstAt: number; seenAt: number; stableSince: number;
  tries: number; triedAt: number; pending: boolean;
  learner_id: number | null; similarity: number | null; verdict: Verdict | null;
};

const iou = (a: Box, b: Box) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
};

export class Tracker {
  tracks: Track[] = [];
  private next = 1;
  constructor(private keepMs = 900) {}

  update(faces: LiveFace[], now: number) {
    const free = new Set(this.tracks);
    const pairs: [number, Track, LiveFace][] = [];
    for (const f of faces) for (const t of this.tracks) { const o = iou(f.box, t.box); if (o > 0.25) pairs.push([o, t, f]); }
    pairs.sort((a, b) => b[0] - a[0]);
    const usedFaces = new Set<LiveFace>();
    for (const [o, t, f] of pairs) {
      if (!free.has(t) || usedFaces.has(f)) continue;
      free.delete(t); usedFaces.add(f);
      if (o < 0.6) t.stableSince = now; // moved a lot: not "holding still"
      t.box = f.box; t.face = f; t.seenAt = now;
    }
    for (const f of faces) {
      if (usedFaces.has(f)) continue;
      this.tracks.push({
        id: this.next++, box: f.box, face: f, firstAt: now, seenAt: now, stableSince: now,
        tries: 0, triedAt: 0, pending: false, learner_id: null, similarity: null, verdict: null,
      });
    }
    this.tracks = this.tracks.filter((t) => now - t.seenAt < this.keepMs);
  }

  /** Visible tracks — the ones on screen in this frame. */
  visible(now: number) { return this.tracks.filter((t) => now - t.seenAt < 50 || t.seenAt === now); }

  /** Tracks worth (re)identifying now: new faces quickly, uncertain ones now and then. */
  needingId(now: number, max = 3) {
    return this.tracks
      .filter((t) => t.seenAt === now && !t.pending && t.verdict !== "match" && t.tries < 12 && now - t.firstAt > 120
        && now - t.triedAt > (t.tries === 0 ? 0 : t.verdict === "review" ? 900 : 700))
      .sort((a, b) => a.tries - b.tries || b.box[2] - a.box[2])
      .slice(0, max);
  }

  reset() { this.tracks = []; }
}

/** Run `step` repeatedly (about 10 times a second at most) while `active()` is true. */
export function runLoop(step: () => Promise<void>, active: () => boolean, minGapMs = 90) {
  let stopped = false;
  (async () => {
    while (!stopped && active()) {
      const t0 = performance.now();
      if (document.visibilityState === "visible") {
        try { await step(); } catch (e) { console.error(e); }
      }
      const wait = Math.max(16, minGapMs - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, document.visibilityState === "visible" ? wait : 500));
    }
  })();
  return () => { stopped = true; };
}
