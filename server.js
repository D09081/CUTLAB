const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpeg = require("ffmpeg-static");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS = path.join(DATA, "uploads");
const EXPORTS = path.join(DATA, "exports");
const DB = path.join(DATA, "history.json");
for (const d of [DATA, UPLOADS, EXPORTS]) fs.mkdirSync(d, { recursive: true });

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/exports", express.static(EXPORTS));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, app: "CUTLAB" }));
app.get("/api", (_req, res) => res.status(200).json({ ok: true, app: "CUTLAB", version: "1.1.0" }));

function readHistory() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return []; }
}
function writeHistory(items) {
  const tmp = DB + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2));
  fs.renameSync(tmp, DB);
}
function addHistory(item) {
  const items = readHistory();
  items.unshift(item);
  writeHistory(items.slice(0, 200));
}
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (path.extname(file.originalname).slice(0, 10) || ".mp4"))
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => file.mimetype.startsWith("video/") ? cb(null, true) : cb(new Error("Можно загружать только видео"))
});
const jobs = new Map();
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args);
    let err = "";
    p.stderr.on("data", d => err += d.toString());
    p.on("error", reject);
    p.on("close", code => code === 0 ? resolve() : reject(new Error(err.slice(-1800) || `FFmpeg exit ${code}`)));
  });
}
app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не получен" });
    const id = crypto.randomUUID();
    const hash = await hashFile(req.file.path);
    const job = { id, filename: req.file.filename, original: req.file.originalname, size: req.file.size, hash, clips: [], createdAt: Date.now() };
    jobs.set(id, job);
    addHistory({ type: "upload", id, name: job.original, size: job.size, hash, createdAt: job.createdAt, status: "Загружено" });
    res.json({ ok: true, id, name: job.original, size: job.size, hash });
  } catch (e) { res.status(500).json({ error: e.message || "Не удалось загрузить видео" }); }
});
app.get("/api/history", (_req, res) => res.json({ ok: true, items: readHistory() }));
app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Проект не найден. После перезапуска сервера исходник нужно загрузить заново." });
  res.json({ ok: true, job: { id: job.id, name: job.original, size: job.size, hash: job.hash, clips: job.clips } });
});
app.post("/api/clips", async (req, res) => {
  try {
    const { id, clips, aspect = "9:16" } = req.body || {};
    const job = jobs.get(id);
    if (!job) return res.status(404).json({ error: "Сначала загрузите видео" });
    if (!Array.isArray(clips) || !clips.length || clips.length > 30) return res.status(400).json({ error: "Добавьте от 1 до 30 фрагментов" });
    if (!["9:16", "1:1", "16:9"].includes(aspect)) return res.status(400).json({ error: "Неизвестный формат кадра" });
    const input = path.join(UPLOADS, job.filename);
    const results = [];
    for (let i = 0; i < clips.length; i++) {
      const start = Math.max(0, Number(clips[i].start));
      const end = Number(clips[i].end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 600) throw new Error(`Проверьте границы фрагмента №${i+1}`);
      const outName = `${id}-${Date.now()}-${i+1}.mp4`;
      const out = path.join(EXPORTS, outName);
      const dims = aspect === "9:16" ? [1080,1920] : aspect === "1:1" ? [1080,1080] : [1920,1080];
      const vf = `scale=${dims[0]}:${dims[1]}:force_original_aspect_ratio=decrease,pad=${dims[0]}:${dims[1]}:(ow-iw)/2:(oh-ih)/2`;
      await runFFmpeg(["-y","-ss",String(start),"-i",input,"-t",String(end-start),"-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
      results.push({ name: outName, url: `/exports/${outName}`, start, end });
    }
    job.clips.push(...results);
    addHistory({ type: "export", id, name: job.original, createdAt: Date.now(), status: "Готово", aspect, exports: results });
    res.json({ ok: true, exports: results });
  } catch (e) { res.status(400).json({ error: e.message || "Не удалось обработать видео" }); }
});
app.use((err, _req, res, _next) => res.status(400).json({ error: err.message || "Ошибка запроса" }));
app.listen(PORT, "0.0.0.0", () => console.log(`CUTLAB listening on ${PORT}`));
