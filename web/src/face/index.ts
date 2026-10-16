/**
 * Browser side of face recognition. Photos are decoded and analysed here, on the
 * device that took them; only the resulting face embeddings are sent to the server.
 */
import { FaceError, analyse, type Analysis, type Rgba } from "./core";

export { FaceError, type Analysis };

const MODELS = `${import.meta.env.BASE_URL}models/`;
const CACHE = "tick-face-models-v1";

type Progress = (msg: string) => void;
type Engine = { ort: typeof import("onnxruntime-web/wasm"); yunet: unknown; sface: unknown };
let engine: Promise<Engine> | null = null;

/** Fetch a model once and keep it in the browser cache, so later visits work offline. */
async function model(name: string, onProgress?: Progress): Promise<Uint8Array> {
  const url = MODELS + name;
  let cache: Cache | undefined;
  try {
    cache = await caches.open(CACHE);
    const hit = await cache.match(url);
    if (hit) return new Uint8Array(await hit.arrayBuffer());
  } catch { /* no Cache API (http on a LAN address) — just download */ }

  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the face model (${name}). Check the connection and try again.`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total > 1e6 && onProgress) onProgress(`Getting the face model ready (first time only) — ${Math.round((got / total) * 100)}%`);
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  try { await cache?.put(url, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })); } catch { /* full or blocked */ }
  return bytes;
}

/** The loaded face models (downloaded once, then cached). */
export function getEngine(onProgress?: Progress): Promise<Engine> { return load(onProgress); }

function load(onProgress?: Progress): Promise<Engine> {
  engine ??= (async () => {
    const ort = await import("onnxruntime-web/wasm");
    ort.env.logLevel = "error";
    // Threads need cross-origin isolation; one thread is plenty for a register photo.
    ort.env.wasm.numThreads = 1;
    const [y, s] = await Promise.all([model("yunet.onnx", onProgress), model("sface.onnx", onProgress)]);
    onProgress?.("Starting face recognition…");
    const [yunet, sface] = await Promise.all([
      ort.InferenceSession.create(y, { executionProviders: ["wasm"], logSeverityLevel: 3 }),
      ort.InferenceSession.create(s, { executionProviders: ["wasm"], logSeverityLevel: 3 }),
    ]);
    return { ort, yunet, sface };
  })().catch((e) => { engine = null; throw e; });
  return engine;
}

/** Start downloading the models early (e.g. when a register page opens). */
export const warmUp = () => { load().catch(() => {}); };

/** Decode a photo to RGBA pixels, honouring EXIF rotation like OpenCV does. */
async function pixels(file: Blob): Promise<Rgba> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new FaceError("Could not read image");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}

/** Find faces in a photo. With single, exactly one clear face is required (enrolment). */
export async function readFaces(file: Blob, opts: { single?: boolean; onProgress?: Progress } = {}): Promise<Analysis> {
  const [{ ort, yunet, sface }, img] = await Promise.all([load(opts.onProgress), pixels(file)]);
  opts.onProgress?.(opts.single ? "Checking the photo…" : "Looking for faces…");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return analyse(ort as any, yunet as any, sface as any, img, opts.single);
}
