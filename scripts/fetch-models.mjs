/**
 * Make sure the face models are in web/public/models before building.
 * yunet.onnx (232 KB) is kept in the repo — it is OpenCV's YuNet with its input size
 * made flexible so the browser runtime accepts any photo size.
 * sface.onnx (38 MB) is downloaded from the OpenCV model zoo if it is missing.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "../web/public/models");
const MODELS = [
  {
    file: "sface.onnx",
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    url: "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
  },
  { file: "yunet.onnx", sha256: "57acd73224bfbe2a2d6d28431da2e7c5b1d643717407e7cf2cae3d4a07ce2c14" },
];

const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
fs.mkdirSync(dir, { recursive: true });

for (const m of MODELS) {
  const file = path.join(dir, m.file);
  if (fs.existsSync(file) && hash(fs.readFileSync(file)) === m.sha256) continue;
  // Reuse the copy from a version 3 install sitting next to this folder, if there is one
  const old = path.resolve(import.meta.dirname, "../../attend/face/models", m.file);
  if (fs.existsSync(old) && hash(fs.readFileSync(old)) === m.sha256) {
    fs.copyFileSync(old, file);
    console.log(`Copied ${m.file} from the version 3 folder.`);
    continue;
  }
  if (!m.url) throw new Error(`${m.file} is missing or changed — restore it from the repository.`);
  console.log(`Downloading ${m.file}…`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${m.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (hash(buf) !== m.sha256) throw new Error(`${m.file} did not match its expected checksum`);
  fs.writeFileSync(file, buf);
}
console.log("Face models ready.");
