/**
 * Face detection + embeddings, done on the device that took the photo.
 *
 * A faithful port of what the old Python face service did with OpenCV:
 *   cv2.FaceDetectorYN  (YuNet 2023mar, score ≥ 0.8, NMS 0.3)
 *   cv2.FaceRecognizerSF.alignCrop + feature  (SFace 2021dec)
 * so templates enrolled with the old service keep matching.
 *
 * Runtime-agnostic: pass in onnxruntime-web (browser) or onnxruntime-node (tests).
 * Only erasable TypeScript is used so Node can run this file directly.
 */

export const MODEL_VERSION = "yunet-2023mar+sface-2021dec";
export const MIN_FACE_PX = 60; // faces smaller than this are too unreliable to use
const MAX_SIDE = 1280; // keep large phone photos fast
const SCORE_THRESHOLD = 0.8;
const NMS_THRESHOLD = 0.3;
const STRIDES = [8, 16, 32];

/** Minimal slice of the onnxruntime API we rely on (same in -web and -node). */
export type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
};
export type OrtSession = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: unknown }>>;
};

/** An RGBA image, as from canvas getImageData. */
export type Rgba = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

export type Face = { box: [number, number, number, number]; score: number; embedding: number[] };
export type Analysis = { model_version: string; width: number; height: number; faces: Face[] };

/* ---------- resize (cv2.resize, INTER_LINEAR) ---------- */

function axisTable(src: number, dst: number) {
  const scale = src / dst;
  const i0 = new Int32Array(dst);
  const a = new Float32Array(dst);
  for (let d = 0; d < dst; d++) {
    const s = (d + 0.5) * scale - 0.5;
    let i = Math.floor(s);
    let f = s - i;
    if (i < 0) { i = 0; f = 0; }
    if (i >= src - 1) { i = src - 1; f = 0; }
    i0[d] = i;
    a[d] = f;
  }
  return { i0, a };
}

export function resizeLinear(img: Rgba, nw: number, nh: number): Rgba {
  const { data, width: w, height: h } = img;
  const xs = axisTable(w, nw);
  const ys = axisTable(h, nh);
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const y0 = ys.i0[y];
    const y1 = Math.min(y0 + 1, h - 1);
    const fy = ys.a[y];
    for (let x = 0; x < nw; x++) {
      const x0 = xs.i0[x];
      const x1 = Math.min(x0 + 1, w - 1);
      const fx = xs.a[x];
      const p00 = (y0 * w + x0) * 4, p01 = (y0 * w + x1) * 4, p10 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      const o = (y * nw + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = data[p00 + c] * (1 - fx) + data[p01 + c] * fx;
        const bot = data[p10 + c] * (1 - fx) + data[p11 + c] * fx;
        out[o + c] = Math.round(top * (1 - fy) + bot * fy);
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: nw, height: nh };
}

/** Same rule as the Python service: shrink so the longest side is at most 1280 px. */
export function fitImage(img: Rgba): Rgba {
  const scale = MAX_SIDE / Math.max(img.width, img.height);
  if (scale >= 1) return img;
  return resizeLinear(img, Math.trunc(img.width * scale), Math.trunc(img.height * scale));
}

/* ---------- detection (cv2.FaceDetectorYN) ---------- */

type Raw = Float32Array; // [x, y, w, h, 5×(lx, ly), score]

export async function detect(ort: Ort, yunet: OrtSession, img: Rgba): Promise<Raw[]> {
  const { data, width: w, height: h } = img;
  const padW = (Math.trunc((w - 1) / 32) + 1) * 32;
  const padH = (Math.trunc((h - 1) / 32) + 1) * 32;
  const plane = padW * padH;
  const blob = new Float32Array(3 * plane); // BGR, 0–255, zero padded right/bottom
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const o = y * padW + x;
      blob[o] = data[p + 2];
      blob[plane + o] = data[p + 1];
      blob[2 * plane + o] = data[p];
    }
  }
  const out = await yunet.run({ input: new ort.Tensor("float32", blob, [1, 3, padH, padW]) });
  const get = (name: string) => out[name].data as Float32Array;

  const faces: Raw[] = [];
  STRIDES.forEach((stride) => {
    const cols = padW / stride, rows = padH / stride;
    const cls = get(`cls_${stride}`), obj = get(`obj_${stride}`);
    const bbox = get(`bbox_${stride}`), kps = get(`kps_${stride}`);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const clsS = Math.min(Math.max(cls[i], 0), 1);
        const objS = Math.min(Math.max(obj[i], 0), 1);
        const score = Math.fround(Math.sqrt(clsS * objS));
        if (score < SCORE_THRESHOLD) continue;
        const f = new Float32Array(15);
        const cx = (c + bbox[i * 4]) * stride;
        const cy = (r + bbox[i * 4 + 1]) * stride;
        const bw = Math.exp(bbox[i * 4 + 2]) * stride;
        const bh = Math.exp(bbox[i * 4 + 3]) * stride;
        f[0] = cx - bw / 2; f[1] = cy - bh / 2; f[2] = bw; f[3] = bh;
        for (let n = 0; n < 5; n++) {
          f[4 + 2 * n] = (kps[i * 10 + 2 * n] + c) * stride;
          f[5 + 2 * n] = (kps[i * 10 + 2 * n + 1] + r) * stride;
        }
        f[14] = score;
        faces.push(f);
      }
    }
  });
  return nms(faces);
}

/** cv::dnn::NMSBoxes on integer rectangles, as OpenCV does for YuNet. */
function nms(faces: Raw[]): Raw[] {
  if (faces.length <= 1) return faces;
  const rect = (f: Raw) => [Math.trunc(f[0]), Math.trunc(f[1]), Math.trunc(f[2]), Math.trunc(f[3])];
  const iou = (a: number[], b: number[]) => {
    const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
    const iw = Math.min(a[0] + a[2], b[0] + b[2]) - x1;
    const ih = Math.min(a[1] + a[3], b[1] + b[3]) - y1;
    const inter = iw > 0 && ih > 0 ? iw * ih : 0;
    const union = a[2] * a[3] + b[2] * b[3] - inter;
    return union > 0 ? inter / union : 0;
  };
  const order = faces.map((_, i) => i).filter((i) => faces[i][14] > SCORE_THRESHOLD);
  order.sort((a, b) => faces[b][14] - faces[a][14] || a - b);
  const kept: number[] = [];
  for (const i of order) {
    const ri = rect(faces[i]);
    if (kept.every((k) => iou(ri, rect(faces[k])) <= NMS_THRESHOLD)) kept.push(i);
  }
  return kept.map((i) => faces[i]);
}

/* ---------- alignment (FaceRecognizerSF.alignCrop) ---------- */

const DST = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
const DST_MEAN = [56.0262, 71.9008];

/** Similarity transform (Umeyama) from the 5 landmarks to SFace's 112×112 template. */
export function similarityTransform(face: Raw): number[] {
  const src = [0, 1, 2, 3, 4].map((n) => [face[4 + 2 * n], face[5 + 2 * n]]);
  const mean = [0, 1].map((k) => src.reduce((s, p) => s + p[k], 0) / 5);
  const sd = src.map((p) => [p[0] - mean[0], p[1] - mean[1]]);
  const dd = DST.map((p) => [p[0] - DST_MEAN[0], p[1] - DST_MEAN[1]]);
  let a00 = 0, a01 = 0, a10 = 0, a11 = 0, variance = 0;
  for (let i = 0; i < 5; i++) {
    a00 += dd[i][0] * sd[i][0]; a01 += dd[i][0] * sd[i][1];
    a10 += dd[i][1] * sd[i][0]; a11 += dd[i][1] * sd[i][1];
    variance += sd[i][0] ** 2 + sd[i][1] ** 2;
  }
  // For 2×2, Umeyama's R = U·D·Vᵀ is always the rotation that maximises trace(R·Aᵀ),
  // and trace(D·S) equals that maximum.
  const p = a00 + a11, q = a10 - a01;
  const norm = Math.hypot(p, q);
  const cos = p / norm, sin = q / norm;
  const scale = (norm / 5) / (variance / 5);
  const r = [[cos * scale, -sin * scale], [sin * scale, cos * scale]];
  return [
    r[0][0], r[0][1], DST_MEAN[0] - (r[0][0] * mean[0] + r[0][1] * mean[1]),
    r[1][0], r[1][1], DST_MEAN[1] - (r[1][0] * mean[0] + r[1][1] * mean[1]),
  ];
}

/** warpAffine to 112×112 (bilinear, black border) and pack as SFace's RGB blob. */
export function alignedBlob(img: Rgba, m: number[]): Float32Array {
  const { data, width: w, height: h } = img;
  // invert the 2×3 forward map
  const det = m[0] * m[4] - m[1] * m[3];
  const i0 = m[4] / det, i1 = -m[1] / det, i3 = -m[3] / det, i4 = m[0] / det;
  const i2 = -(i0 * m[2] + i1 * m[5]), i5 = -(i3 * m[2] + i4 * m[5]);
  const S = 112, plane = S * S;
  const blob = new Float32Array(3 * plane);
  const px = (x: number, y: number, c: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + c]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // OpenCV interpolates at 1/32-pixel precision
      const sx = Math.round((i0 * x + i1 * y + i2) * 32);
      const sy = Math.round((i3 * x + i4 * y + i5) * 32);
      const x0 = sx >> 5, y0 = sy >> 5;
      const fx = (sx & 31) / 32, fy = (sy & 31) / 32;
      for (let c = 0; c < 3; c++) {
        const v =
          px(x0, y0, c) * (1 - fx) * (1 - fy) + px(x0 + 1, y0, c) * fx * (1 - fy) +
          px(x0, y0 + 1, c) * (1 - fx) * fy + px(x0 + 1, y0 + 1, c) * fx * fy;
        blob[c * plane + y * S + x] = Math.round(v); // channel order R, G, B
      }
    }
  }
  return blob;
}

export async function embed(ort: Ort, sface: OrtSession, img: Rgba, face: Raw): Promise<number[]> {
  const blob = alignedBlob(img, similarityTransform(face));
  const out = await sface.run({ data: new ort.Tensor("float32", blob, [1, 3, 112, 112]) });
  const v = Array.from(out.fc1.data as Float32Array);
  const n = Math.hypot(...v);
  return v.map((x) => Math.fround(x / n));
}

/* ---------- the whole pipeline ---------- */

export class FaceError extends Error {}

/** Find faces and return one embedding each. With single, require exactly one clear face (enrolment). */
export async function analyse(ort: Ort, yunet: OrtSession, sface: OrtSession, input: Rgba, single = false): Promise<Analysis> {
  const img = fitImage(input);
  const found = await detect(ort, yunet, img);
  const faces: Face[] = [];
  for (const f of found) {
    const box = [Math.trunc(f[0]), Math.trunc(f[1]), Math.trunc(f[2]), Math.trunc(f[3])] as Face["box"];
    if (Math.min(box[2], box[3]) < MIN_FACE_PX) continue;
    faces.push({ box, score: Math.round(f[14] * 1000) / 1000, embedding: await embed(ort, sface, img, f) });
  }
  if (single && faces.length !== 1) {
    throw new FaceError(faces.length ? `${faces.length} faces found — use a photo of one learner` : "No clear face found");
  }
  return { model_version: MODEL_VERSION, width: img.width, height: img.height, faces };
}
