const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ffmpeg = require("ffmpeg-static");

let youtubedl;
try { youtubedl = require("youtube-dl-exec"); } catch {}
const app = express();
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOADS = path.join(DATA, "uploads");
const EXPORTS = path.join(DATA, "exports");
const CAPTIONS = path.join(DATA, "captions");
const DB = path.join(DATA, "history.json");
for (const d of [DATA, UPLOADS, EXPORTS, CAPTIONS]) fs.mkdirSync(d, { recursive: true });
app.use(express.json({ limit: "12mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/exports", express.static(EXPORTS));
app.use("/captions", express.static(CAPTIONS));
app.get("/health", (_req, res) => res.status(200).json({ ok: true, app: "CUTLAB" }));
app.get("/api", (_req, res) => res.status(200).json({ ok: true, app: "CUTLAB", version: "2.0.0", features: ["scene-analysis", "whisper-transcription", "srt-captions", "multi-format-export"] }));

function readHistory() { try { return JSON.parse(fs.readFileSync(DB, "utf8")); } catch { return []; } }
function writeHistory(items) { const tmp = DB + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(items, null, 2)); fs.renameSync(tmp, DB); }
function addHistory(item) { const items = readHistory(); items.unshift(item); writeHistory(items.slice(0, 200)); }
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256"), stream = fs.createReadStream(file);
    stream.on("data", chunk => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex")));
  });
}
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + (path.extname(file.originalname).slice(0, 10) || ".mp4"))
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 }, fileFilter: (_req, file, cb) => file.mimetype.startsWith("video/") ? cb(null, true) : cb(new Error("Можно загружать только видео")) });
const jobs = new Map();
function getJob(id) {
  const job = jobs.get(id);
  if (!job) throw new Error("Проект не найден. После перезапуска сервера загрузите исходник заново.");
  const input = path.join(UPLOADS, job.filename);
  if (!fs.existsSync(input)) throw new Error("Исходный файл больше недоступен");
  return { job, input };
}
app.get("/api/source/:id", (req, res) => {
  try { const { job, input } = getJob(req.params.id); res.sendFile(input); }
  catch (e) { res.status(404).json({ error: e.message }); }
});
function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpeg, args); let err = "";
    p.stderr.on("data", d => err += d.toString()); p.on("error", reject);
    p.on("close", code => code === 0 ? resolve(err) : reject(new Error(err.slice(-1800) || `FFmpeg exit ${code}`)));
  });
}
async function mediaDuration(file) {
  const log = await runFFmpeg(["-i", file, "-f", "null", "-"]);
  const m = log.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) throw new Error("Не удалось определить длительность видео");
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000), milli = ms % 1000;
  return [h,m,s].map(v => String(v).padStart(2,"0")).join(":") + "," + String(milli).padStart(3,"0");
}
function makeSrt(segments, offset = 0, limit = Infinity) {
  return segments.filter(x => Number(x.end) > offset && Number(x.start) < limit).map((x,i) => {
    const start = Math.max(0, Number(x.start) - offset), end = Math.max(start + .15, Math.min(Number(x.end), limit) - offset);
    return `${i+1}\n${srtTime(start)} --> ${srtTime(end)}\n${String(x.text || "").trim()}\n`;
  }).join("\n");
}
function parseSrt(srt) {
  const blocks = String(srt).replace(/\r/g,"").trim().split(/\n\s*\n/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split("\n"), ix = lines.findIndex(x => x.includes("-->"));
    if (ix < 0) continue;
    const parse = t => { const m=t.trim().match(/(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})/); return m ? Number(m[1]||0)*3600+Number(m[2])*60+Number(m[3])+Number(String(m[4]).padEnd(3,"0"))/1000 : NaN; };
    const [a,b] = lines[ix].split("-->").map(parse), text = lines.slice(ix+1).join(" ").replace(/<[^>]*>/g,"").trim();
    if (Number.isFinite(a) && Number.isFinite(b) && b>a && text) segments.push({start:a,end:b,text});
  }
  return segments;
}
app.post("/api/upload", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Файл не получен" });
    const id = crypto.randomUUID(), hash = await hashFile(req.file.path);
    const job = { id, filename:req.file.filename, original:req.file.originalname, size:req.file.size, hash, clips:[], captions:null, createdAt:Date.now() };
    jobs.set(id, job); addHistory({type:"upload",id,name:job.original,size:job.size,hash,createdAt:job.createdAt,status:"Загружено"});
    res.json({ok:true,id,name:job.original,size:job.size,hash});
  } catch(e) { res.status(500).json({error:e.message || "Не удалось загрузить видео"}); }
});
const ALLOWED_HOSTS = ["youtube.com","youtu.be","tiktok.com","twitch.tv","clips.twitch.tv","vimeo.com","instagram.com","facebook.com","fb.watch","x.com","twitter.com"];
function validateSourceUrl(raw) {
  let u; try { u=new URL(raw); } catch { throw new Error("Вставьте корректную ссылку"); }
  if(u.protocol!=="https:"||u.username||u.password) throw new Error("Нужна обычная HTTPS-ссылка");
  const host=u.hostname.toLowerCase().replace(/^www\./,"");
  if(!ALLOWED_HOSTS.some(d=>host===d||host.endsWith("."+d))) throw new Error("Поддерживаются YouTube, TikTok, Twitch, Vimeo, Instagram, Facebook и X");
  return u.toString();
}
app.post("/api/import-url", async (req,res) => {
  try {
    if (!youtubedl) throw new Error("Импорт по ссылке временно недоступен на сервере");
    const url=validateSourceUrl(String(req.body?.url||"").trim()), id=crypto.randomUUID();
    await youtubedl(url,{output:path.join(UPLOADS,id+".%(ext)s"),format:"bv*+ba/b",mergeOutputFormat:"mp4",remuxVideo:"mp4",noPlaylist:true,noWarnings:true,noProgress:true,socketTimeout:30,maxFilesize:"500M",restrictFilenames:true});
    const candidates=fs.readdirSync(UPLOADS).filter(n=>n.startsWith(id+".")&&/\.(mp4|mov|mkv|webm)$/i.test(n));
    if(!candidates.length) throw new Error("Платформа не вернула доступный видеофайл");
    const filename=candidates[0],full=path.join(UPLOADS,filename),stat=fs.statSync(full),hash=await hashFile(full),source=new URL(url).hostname;
    const job={id,filename,original:"Импорт по ссылке",size:stat.size,hash,clips:[],captions:null,createdAt:Date.now(),source};
    jobs.set(id,job);addHistory({type:"import",id,name:job.original,source,size:job.size,hash,createdAt:job.createdAt,status:"Импортировано"});
    res.json({ok:true,id,name:job.original,size:job.size,hash,source});
  } catch(e) { res.status(400).json({error:String(e.message||"Не удалось импортировать видео").slice(0,700)}); }
});
app.post("/api/analyze/:id", async (req,res) => {
  try {
    const {job,input}=getJob(req.params.id), duration=await mediaDuration(input);
    const log=await runFFmpeg(["-i",input,"-vf","select='gt(scene,0.22)',showinfo","-an","-f","null","-"]);
    const times=[...log.matchAll(/pts_time:([0-9.]+)/g)].map(m=>Number(m[1])).filter(t=>t>3&&t<duration-3);
    const candidates=[];
    for(const t of times) {
      const start=Math.max(0,Math.min(t-11,duration-24)),end=Math.min(duration,start+35);
      if(end-start<8) continue;
      if(candidates.every(c=>Math.abs(c.start-start)>16)) candidates.push({start:Number(start.toFixed(1)),end:Number(end.toFixed(1)),reason:"Смена сцены"});
    }
    if(!candidates.length) {
      const step=Math.min(60,Math.max(20,duration/4));
      for(let t=0;t<duration;t+=step) if(Math.min(duration,t+step)-t>=8) candidates.push({start:Number(t.toFixed(1)),end:Number(Math.min(duration,t+step).toFixed(1)),reason:"Фрагмент по таймлайну"});
    }
    const suggestions=candidates.slice(0,12);
    job.duration=duration;
    res.json({ok:true,duration,suggestions,analysis:"Предварительный анализ по сменам сцен. Это монтажные подсказки, не оценка смысла или вирусности."});
  } catch(e) { res.status(400).json({error:e.message||"Не удалось проанализировать видео"}); }
});
app.post("/api/captions/:id", async (req,res) => {
  try {
    const {job}=getJob(req.params.id), segments=parseSrt(req.body?.srt||"");
    if(!segments.length) throw new Error("Не найдено субтитров SRT. Проверь формат файла.");
    const filename=job.id+".srt";fs.writeFileSync(path.join(CAPTIONS,filename),makeSrt(segments));
    job.captions={filename,segments};
    addHistory({type:"captions",id:job.id,name:job.original,createdAt:Date.now(),status:"Субтитры добавлены",count:segments.length});
    res.json({ok:true,count:segments.length,url:"/captions/"+filename});
  } catch(e) { res.status(400).json({error:e.message}); }
});
app.post("/api/transcribe/:id", async (req,res) => {
  let audioPath;
  try {
    const {job,input}=getJob(req.params.id);
    const provider = process.env.GROQ_API_KEY ? { key: process.env.GROQ_API_KEY, endpoint: "https://api.groq.com/openai/v1/audio/transcriptions", model: "whisper-large-v3-turbo" } : process.env.OPENAI_API_KEY ? { key: process.env.OPENAI_API_KEY, endpoint: "https://api.openai.com/v1/audio/transcriptions", model: "whisper-1" } : null;\n    if(!provider) return res.status(503).json({error:"Автораспознавание не подключено. Добавьте GROQ_API_KEY (есть бесплатный лимит) или OPENAI_API_KEY в переменные Render. Можно загрузить готовый .srt."});
    audioPath=path.join(DATA,job.id+"-audio.mp3");
    await runFFmpeg(["-y","-i",input,"-vn","-ac","1","-ar","16000","-b:a","48k",audioPath]);
    const audio=fs.readFileSync(audioPath);
    if(audio.length>24*1024*1024) throw new Error("Аудиодорожка больше 24 МБ. Для длинного видео сначала нарежьте исходник на части.");
    const form=new FormData();form.append("file",new Blob([audio],{type:"audio/mpeg"}), "audio.mp3");form.append("model",provider.model);form.append("response_format","verbose_json");
    const response=await fetch(provider.endpoint,{method:"POST",headers:{Authorization:"Bearer "+provider.key},body:form});
    const data=await response.json();if(!response.ok) throw new Error(data.error?.message||"Сервис распознавания не ответил");
    const segments=(data.segments||[]).map(s=>({start:s.start,end:s.end,text:s.text}));
    if(!segments.length&&data.text) segments.push({start:0,end:Math.max(2,job.duration||10),text:data.text});
    if(!segments.length) throw new Error("Речь не распознана");
    const filename=job.id+".srt";fs.writeFileSync(path.join(CAPTIONS,filename),makeSrt(segments));job.captions={filename,segments};
    res.json({ok:true,count:segments.length,text:data.text||"",url:"/captions/"+filename});
  } catch(e) { res.status(400).json({error:e.message||"Ошибка распознавания"}); }
  finally { if(audioPath&&fs.existsSync(audioPath)) fs.unlinkSync(audioPath); }
});
app.get("/api/history",(_req,res)=>res.json({ok:true,items:readHistory()}));
app.get("/api/jobs/:id",(req,res)=>{
  try { const {job}=getJob(req.params.id);res.json({ok:true,job:{id:job.id,name:job.original,size:job.size,hash:job.hash,clips:job.clips,duration:job.duration,captions:job.captions?{count:job.captions.segments.length,url:"/captions/"+job.captions.filename}:null}}); }
  catch(e){res.status(404).json({error:e.message});}
});
app.post("/api/clips",async(req,res)=>{
  try {
    const {id,clips,aspect="9:16",burnSubtitles=false}=req.body||{}, {job,input}=getJob(id);
    if(!Array.isArray(clips)||!clips.length||clips.length>30) throw new Error("Добавьте от 1 до 30 фрагментов");
    if(!["9:16","1:1","16:9"].includes(aspect)) throw new Error("Неизвестный формат кадра");
    const results=[];
    for(let i=0;i<clips.length;i++){
      const start=Math.max(0,Number(clips[i].start)),end=Number(clips[i].end);
      if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>600) throw new Error("Проверьте границы фрагмента №"+(i+1));
      const outName=`${id}-${Date.now()}-${i+1}.mp4`,out=path.join(EXPORTS,outName),dims=aspect==="9:16"?[1080,1920]:aspect==="1:1"?[1080,1080]:[1920,1080];
      const vf=`scale=${dims[0]}:${dims[1]}:force_original_aspect_ratio=decrease,pad=${dims[0]}:${dims[1]}:(ow-iw)/2:(oh-ih)/2`;
      let burned=false,base=["-y","-ss",String(start),"-i",input,"-t",String(end-start)];
      if(burnSubtitles&&job.captions?.segments?.length){
        const srt=makeSrt(job.captions.segments,start,end),srtName=outName+".srt";
        fs.writeFileSync(path.join(CAPTIONS,srtName),srt);
        const srtPath=path.join(CAPTIONS,srtName).replace(/\\/g,"/").replace(/:/g,"\\:");
        try { await runFFmpeg([...base,"-vf",vf+`,subtitles='${srtPath}'`,"-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart",out]); burned=true; }
        catch { await runFFmpeg([...base,"-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart",out]); }
      } else await runFFmpeg([...base,"-vf",vf,"-c:v","libx264","-preset","veryfast","-crf","23","-c:a","aac","-b:a","128k","-movflags","+faststart",out]);
      const subtitleUrl=job.captions?"/captions/"+outName+".srt":null;
      if(job.captions&&!fs.existsSync(path.join(CAPTIONS,outName+".srt"))) fs.writeFileSync(path.join(CAPTIONS,outName+".srt"),makeSrt(job.captions.segments,start,end));
      results.push({name:outName,url:"/exports/"+outName,start,end,subtitleUrl,burned});
    }
    job.clips.push(...results);addHistory({type:"export",id,name:job.original,createdAt:Date.now(),status:"Готово",aspect,exports:results});
    res.json({ok:true,exports:results});
  } catch(e){res.status(400).json({error:e.message||"Не удалось обработать видео"});}
});
app.use((err,_req,res,_next)=>res.status(400).json({error:err.message||"Ошибка запроса"}));
app.listen(PORT,"0.0.0.0",()=>console.log("CUTLAB listening on "+PORT));