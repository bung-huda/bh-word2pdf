"use strict";
// BungHuda Word -> PDF backend (LibreOffice headless). Node 18+
const express = require("express"), multer = require("multer"), cors = require("cors");
const rateLimit = require("express-rate-limit");
const { execFile } = require("child_process"), fs = require("fs/promises"), os = require("os"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 3000;
const MAX_MB = +process.env.MAX_MB || 50;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean); // contoh: https://www.bunghuda.id
const TIMEOUT = +process.env.CONVERT_TIMEOUT_MS || 180000;
const MAX_PARALLEL = +process.env.MAX_PARALLEL || 2;

const app = express(); app.set("trust proxy", 1);
app.use(cors({ origin: ORIGINS.length ? ORIGINS : false, exposedHeaders: ["X-BH-Pages", "X-BH-Warnings"] }));
app.use("/api/", rateLimit({ windowMs: 60000, max: +process.env.RATE_PER_MIN || 20 }));
const upload = multer({ dest: path.join(os.tmpdir(), "bh-up"), limits: { fileSize: MAX_MB * 1048576, files: 1 } });

const run = (cmd, args, ms) => new Promise((res, rej) =>
  execFile(cmd, args, { timeout: ms || 30000, maxBuffer: 1 << 24 }, (e, so, se) => e ? rej(Object.assign(e, { se })) : res(so)));

let active = 0; const waiters = [];
const acquire = () => active < MAX_PARALLEL ? (active++, Promise.resolve()) : new Promise(r => waiters.push(r));
const release = () => { const n = waiters.shift(); if (n) n(); else active--; };

async function sniff(file) { // cek magic bytes, jangan percaya ekstensi/mimetype
  const fh = await fs.open(file, "r"), b = Buffer.alloc(8); await fh.read(b, 0, 8, 0); await fh.close();
  if (b.slice(0, 4).toString("hex") === "504b0304") return "docx";
  if (b.slice(0, 4).toString("hex") === "d0cf11e0") return "doc";
  return null;
}
async function dangerous(file, kind) { // tolak makro/OLE embedding pada docx
  if (kind !== "docx") return false;
  const list = await run("unzip", ["-Z1", file]);
  return /vbaProject\.bin|\.exe$|\/activeX\//im.test(list);
}
async function fontWarnings(file, kind) { // font di dokumen yang tidak ada di server
  if (kind !== "docx") return [];
  try {
    const xml = await run("unzip", ["-p", file, "word/fontTable.xml"]);
    const names = [...new Set([...xml.matchAll(/w:font w:name="([^"]+)"/g)].map(m => m[1]))].slice(0, 30);
    const bad = [];
    for (const n of names) {
      const got = (await run("fc-match", ["-f", "%{family}", n]).catch(() => "")).split(",")[0].toLowerCase();
      if (got && !got.includes(n.toLowerCase().split(" ")[0])) bad.push(`${n} -> ${got}`);
    }
    return bad;
  } catch { return []; }
}

app.get("/api/health", (_q, r) => r.json({ ok: true }));

app.post("/api/convert/word-to-pdf", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "File tidak ditemukan." });
  const job = await fs.mkdtemp(path.join(os.tmpdir(), "bh-job-"));
  const cleanup = () => Promise.allSettled([fs.rm(job, { recursive: true, force: true }), fs.rm(req.file.path, { force: true })]);
  let held = false;
  try {
    const kind = await sniff(req.file.path);
    if (!kind) return res.status(415).json({ error: "File rusak atau bukan dokumen Word (DOC/DOCX)." });
    if (await dangerous(req.file.path, kind)) return res.status(422).json({ error: "Dokumen berisi makro/objek aktif dan ditolak demi keamanan." });
    const src = path.join(job, `${crypto.randomUUID()}.${kind}`);
    await fs.rename(req.file.path, src).catch(() => fs.copyFile(req.file.path, src));
    await acquire(); held = true;
    await run("soffice", ["--headless", "--norestore", "--nolockcheck", "--nodefault", "--nologo",
      `-env:UserInstallation=file://${job}/profile`, "--convert-to", "pdf:writer_pdf_Export", "--outdir", job, src], TIMEOUT);
    const pdf = src.replace(/\.(docx|doc)$/, ".pdf");
    await fs.access(pdf);
    let pages = ""; try { pages = (await run("pdfinfo", [pdf])).match(/Pages:\s+(\d+)/)[1]; } catch {}
    const warn = await fontWarnings(src, kind);
    res.set("X-BH-Pages", pages);
    if (warn.length) res.set("X-BH-Warnings", encodeURIComponent("Font tidak tersedia, diganti: " + warn.join("; ")));
    res.type("application/pdf").sendFile(pdf, async err => { await cleanup(); if (err && !res.headersSent) res.status(500).end(); });
    return;
  } catch (e) {
    console.error("convert error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.killed ? "Waktu konversi habis." : "Konversi gagal. File mungkin rusak atau dilindungi sandi." });
  } finally { if (held) release(); if (!res.headersSent || res.statusCode !== 200) await cleanup(); }
});
app.use((e, _q, res, _n) => res.status(e.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: e.code === "LIMIT_FILE_SIZE" ? `Ukuran file melebihi ${MAX_MB} MB.` : "Permintaan tidak valid." }));
// sapu file sisa tiap 10 menit (job > 15 menit)
setInterval(async () => { for (const d of await fs.readdir(os.tmpdir()).catch(() => [])) if (d.startsWith("bh-job-")) { const p = path.join(os.tmpdir(), d); const s = await fs.stat(p).catch(() => null); if (s && Date.now() - s.mtimeMs > 900000) fs.rm(p, { recursive: true, force: true }); } }, 600000).unref();
app.listen(PORT, () => console.log("BungHuda Word->PDF API on :" + PORT));
