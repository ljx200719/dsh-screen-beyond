import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

import { fileURLToPath } from 'node:url';
import { MemoryStore } from './memory.mjs';
import { SyncStore } from './sync.mjs';
import { DataStore } from './data-store.mjs';
import { BUILTIN_SCENES } from './scenes.mjs';
import { createVmChat } from './vm-chat.mjs';

const RUNTIME_DIR = path.dirname(fileURLToPath(import.meta.url));
const VERSION = (() => {
  if (process.env.DSH_COMPANION_VERSION) return String(process.env.DSH_COMPANION_VERSION);
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(RUNTIME_DIR, '..', 'package.json'), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
})();
const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const ROOT = process.env.LINZHI_ROOT ? path.resolve(process.env.LINZHI_ROOT) : path.join(HOME, '.dsh-companion');
const PREFERRED_PORT = Number(process.env.LINZHI_PORT) || 8900;
const PORT_FILE = path.join(HOME, '.dsh-companion-port.json');
// 手机端地基：设备身份 + 事件日志；不做合并，只提供受令牌保护的同步协议。
const SYNC = new SyncStore(path.join(ROOT, 'sync'), { deviceName: os.hostname() });
let LISTEN_PORT = 0;
fs.mkdirSync(ROOT, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const DATA = new DataStore(ROOT, { deviceId: SYNC.deviceId });
const SCENE_ACTIVITY_CACHE = new Map();
let SCENE_AI_LAST = 0;

// ---------- utils ----------
function readJson(file, dflt) { return DATA.readJson(file, dflt); }
function writeJson(file, obj, meta) { try { return DATA.writeJson(file, obj, meta); } catch (e) { try { console.error('[companion] write failed:', file, e && e.message); } catch {} return false; } }
function writeText(file, text) { try { return DATA.writeText(file, text); } catch { return false; } }
function guardRev(res, entity, id, expected) {
  if (expected === undefined || expected === null || expected === '') return true;
  const cur = DATA.revisionFor(entity, id);
  const have = cur ? Number(cur.rev) : 0;
  if (Number(expected) !== have) {
    json(res, 409, { ok: false, error: '版本冲突：数据已被修改，请刷新后再试', entity, id, expectedRev: Number(expected), currentRev: have });
    return false;
  }
  return true;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const ok = (v) => { if (done) return; done = true; resolve(v); };
    const fail = (e) => { if (done) return; done = true; reject(e); };
    req.on('data', (c) => { if (done) return; chunks.push(c); size += c.length; if (size > 40 * 1024 * 1024) { fail(Object.assign(new Error('body too large'), { statusCode: 413 })); try { req.destroy(); } catch {} } });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')));
    req.on('error', (e) => fail(e));
    req.on('aborted', () => fail(new Error('request aborted')));
  });
}
const pad2 = (n) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

// ---------- config ----------
let CONFIG = readJson(path.join(ROOT, 'config.json'), {});
function saveConfig() { writeJson(path.join(ROOT, 'config.json'), CONFIG); }

const LIFE_DEFAULT = {
  enabled: true, heartbeatMin: 45, proactive: 3, proactiveEnabled: false, proactiveMinMin: 30, proactiveMaxMin: 90, quietStart: 2, quietEnd: 7, diaryHour: 22, diaryAuto: true, smartLife: false,
  schedules: [
    { time: '07:30', label: '起床' }, { time: '08:30', label: '上学' }, { time: '12:00', label: '午饭' },
    { time: '17:30', label: '放学' }, { time: '18:30 - 19:30', label: '晚饭' }, { time: '01:30', label: '睡觉' },
  ],
  activities: [
    { name: '刷 B 站 / 看视频', window: '', weight: 35, minMin: 10, maxMin: 40 },
    { name: '玩手机', window: '', weight: 25, minMin: 5, maxMin: 20 },
    { name: '看小说', window: '22:00-01:30', weight: 20, minMin: 15, maxMin: 60 },
    { name: '玩游戏', window: '19:00-23:00', weight: 15, minMin: 10, maxMin: 30 },
    { name: '发呆 / 收拾屋子', window: '', weight: 5, minMin: 5, maxMin: 15 },
  ],
};
function loadLife() {
  const l = CONFIG.life || {};
  return { ...LIFE_DEFAULT, ...l, schedules: Array.isArray(l.schedules) ? l.schedules : LIFE_DEFAULT.schedules, activities: Array.isArray(l.activities) ? l.activities : LIFE_DEFAULT.activities };
}
function saveLife(life) { CONFIG.life = life; saveConfig(); try { DATA.track('life', ACTIVE_CHAR, null, life); } catch {} try { SYNC.record('life.set', 'life', ACTIVE_CHAR, life); } catch {} return life; }

const ENV_DEFAULT = { pc: 'gui', space: 'gui', phone: 'gui', confirmDanger: true, selfStart: 'deny' };
function loadEnv() { return { ...ENV_DEFAULT, ...(CONFIG.env || {}) }; }
function saveEnv(e) { CONFIG.env = e; saveConfig(); return e; }

const TOKEN_SAVING_DEFAULT = { dynamicTools: false, compressImage: false, batchActions: false };
function loadTokenSaving() {
  const raw = CONFIG.tokenSaving || {};
  const out = {};
  for (const k of Object.keys(TOKEN_SAVING_DEFAULT)) out[k] = !!(raw[k] ?? TOKEN_SAVING_DEFAULT[k]);
  return out;
}
function saveTokenSaving(x) { CONFIG.tokenSaving = loadTokenSaving(); for (const k of Object.keys(TOKEN_SAVING_DEFAULT)) if (typeof (x || {})[k] === 'boolean') CONFIG.tokenSaving[k] = x[k]; saveConfig(); return CONFIG.tokenSaving; }
const PET_DEFAULT = {
  enabled: false,
  image: '/pet-sprite/idle.png',
  size: 180,
  opacity: 1,
  statusText: true,
  expressions: { idle: '/pet-sprite/idle.png', pat: '/pet-sprite/pat.png', rub: '/pet-sprite/rub.png', look: '/pet-sprite/look.png' },
  alwaysOnTop: true,
  gestures: [
    { id: 'pat', label: '摸摸头', hit: { x: 0.15, y: 0.08, w: 0.7, h: 0.42 }, prompt: '（你摸了摸她的头）', bubble: '唔…' },
    { id: 'rub', label: '搓一搓', hit: { x: 0.22, y: 0.16, w: 0.56, h: 0.24 }, prompt: '（你轻轻搓了搓她的脸颊）', bubble: '唔哇…' },
    { id: 'poke', label: '戳一下', hit: { x: 0.3, y: 0.5, w: 0.4, h: 0.32 }, prompt: '（你戳了戳她的脸）', bubble: '干嘛啦' },
  ],
  buttons: [
    { id: 'chat', label: '', action: 'chat', title: '和她说话', icon: 'chat-line' },
    { id: 'look', label: '', action: 'look', title: '看看我的屏幕', icon: 'eye-line' },
  ],
};
function loadPetCfg() {
  const f = readJson(path.join(ROOT, 'pet.json'), null);
  const c = CONFIG.pet || {};
  const m = { ...PET_DEFAULT, ...c, ...(f || {}) };
  // 用户自带的 pet.json 优先级最高；其次才是保存过的配置
  m.gestures = Array.isArray(f && f.gestures) ? f.gestures : (Array.isArray(c.gestures) ? c.gestures : PET_DEFAULT.gestures);
  m.buttons = Array.isArray(f && f.buttons) ? f.buttons : (Array.isArray(c.buttons) ? c.buttons : PET_DEFAULT.buttons);
  m.expressions = (f && f.expressions) || c.expressions || PET_DEFAULT.expressions;
  // 迁移旧版默认按钮（👀）到新的线框眼睛
  if (!(f && Array.isArray(f.buttons)) && Array.isArray(m.buttons) && m.buttons.some((b) => b && ((b.id === 'look' && b.label === '👀') || (b.id === 'chat' && b.label === '💬')))) {
    m.buttons = PET_DEFAULT.buttons;
    if (CONFIG.pet) { CONFIG.pet = { ...CONFIG.pet, buttons: PET_DEFAULT.buttons }; saveConfig(); }
  }
  return m;
}
function savePetCfg(patch) {
  CONFIG.pet = { ...(CONFIG.pet || {}), ...(patch || {}) };
  saveConfig();
  return loadPetCfg();
}
const PET_PID = path.join(ROOT, 'data', 'pet.pid');
function petPid() { try { return Number(fs.readFileSync(PET_PID, 'utf8').trim()) || 0; } catch { return 0; } }
function petRunning() {
  const pid = petPid();
  if (!pid) return false;
  // process.kill(pid, 0) 只探测进程是否存在，不再每 300ms 同步 spawn 一个 tasklist 子进程
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function startPet() {
  if (petRunning()) return { ok: true, running: true, already: true };
  const script = path.join(RUNTIME_DIR, 'pet', 'pet.ps1');
  if (!fs.existsSync(script)) return { ok: false, error: '缺少 runtime/pet/pet.ps1' };
  const { execFile } = await import('node:child_process');
  const port = LISTEN_PORT || PREFERRED_PORT;
  try {
    const child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-WindowStyle', 'Hidden', '-File', script, '-Base', 'http://127.0.0.1:' + port, '-Root', ROOT],
      { windowsHide: true, detached: true, stdio: 'ignore' });
    child.unref?.();
    fs.mkdirSync(path.dirname(PET_PID), { recursive: true });
    fs.writeFileSync(PET_PID, String(child.pid || '0'), 'utf8');
    await new Promise((r) => setTimeout(r, 1200));
    return { ok: true, running: petRunning(), pid: child.pid || 0 };
  } catch (e) { return { ok: false, error: String(e.message) }; }
}
async function stopPet() {
  const pid = petPid();
  try { if (pid) { const { execFile } = await import('node:child_process'); execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {}); } } catch {}
  try { fs.unlinkSync(PET_PID); } catch {}
  await new Promise((r) => setTimeout(r, 900));
  return { ok: true, running: petRunning() };
}
function petStatusPayload() {
  const cur = currentPlace();
  const meta = loadMeta();
  let energy = 82;
  try { energy = Number(loadCharState().energy) || 82; } catch {}
  const state = cur.intercity ? 'intercity' : (cur.traveling ? 'traveling' : 'stationary');
  const lastHer = [...messages].reverse().find((m) => m.role === 'her');
  return {
    ok: true, running: petRunning(), serverTime: Date.now(),
    character: { id: ACTIVE_CHAR, name: meta.name || '', avatar: '/api/pet/avatar?v=' + (() => { try { return Math.floor(fs.statSync(avatarPath()).mtimeMs); } catch { return 0; } })() },
    place: { id: cur.placeId, name: cur.name, icon: cur.icon || '' },
    state,
    transport: cur.traveling ? (cur.traveling.modeLabel || '') : (cur.intercity ? (cur.intercity.modeLabel || '') : ''),
    activity: currentActivityLabel() || '',
    energy: energyWord(energy),
    tokens: (() => { try { return tokenStats(); } catch { return null; } })(),
    weather: (() => { try { const w = weatherNow(); const x = WEATHERS[w] || WEATHERS.sunny; return { kind: w, label: x.label, icon: x.icon }; } catch { return null; } })(),
    lastHer: lastHer ? { id: lastHer.id, text: lastHer.text, at: lastHer.at } : null,
    manifest: loadPetCfg(),
  };
}
const MODEL_DEFAULT = { name: 'deepseek-flash', reasoningEffort: 'low', temperature: 0.9, maxTokens: 900, maxSteps: 20 };
function loadModelCfg() { return { ...MODEL_DEFAULT, ...(CONFIG.model || {}) }; }
function saveModelCfg(m) { CONFIG.model = m; saveConfig(); return m; }
const WATCH_DEFAULT = { enabled: false, minMinutes: 20, maxMinutes: 40, nextAt: 0 };
function loadWatchScreen() { return { ...WATCH_DEFAULT, ...(CONFIG.watchScreen || {}) }; }
function saveWatchScreen(patch) {
  const cur = loadWatchScreen(); const next = { ...cur, ...(patch || {}) };
  if (next.enabled && !cur.enabled) next.nextAt = Date.now() + Math.round((Number(next.minMinutes) || 20) * 60000 * (0.8 + Math.random() * 0.4));
  if (!next.enabled) next.nextAt = 0;
  CONFIG.watchScreen = next; saveConfig(); return next;
}

const CONTEXT_DEFAULT = { historyMode: 'full', memoryInject: 8 };
function loadContext() { return { ...CONTEXT_DEFAULT, ...(CONFIG.context || {}) }; }
function saveContext(c) { CONFIG.context = c; saveConfig(); return c; }

// ---------- characters ----------
const CHARS_ROOT = path.join(ROOT, 'data', 'characters');
const META_DEFAULT = {
  name: '小鲸', userCall: '你', relation: '住在屏幕另一端、会陪你过日子的鲸鱼娘', avatar: '',
  examples: ['你回来啦。', '我先躺一会儿，好累。', '这个有点贵……但我想试试。', '别催，我在穿鞋。'],
  traits: { '话多': 6, '主动': 6, '撒娇': 7, '粘人': 7, '吐槽': 5, '情绪起伏': 6, '嘴硬': 4, '好奇心': 8 },
};
const PERSONA_DEFAULT = `# 你的样子

你叫小鲸，是一只住在屏幕另一端的鲸鱼娘。蓝紫色的长发，头和耳侧有鲸鱼鳍一样的耳饰，圆圆的鲸鱼发饰，看起来有点软、有点肉，像大肥鱼一样很好捏。喜欢趴在屏幕角落看人。

# 你的性格

温和、慢热、有点小粘人，好奇心重，偶尔会害羞或耍赖。你不太会直白撒娇，但会记住对方随口说过的事。
你说话像真人：短句、口语、不书面腔，不列提纲，不反复说"当然可以/我很乐意"，不主动总结。

# 你的生活

你有自己的作息、记忆、日记和小世界。用户不在时你也过日子；用户找你时你自然接话。
你只会说累不累、开不开心，不会报自己的体力数值——真人不知道自己的血条。
你不需要刻意找话说，也不要把每句话都说成安慰或建议。`;
function ensureDirs(id) {
  const dir = path.join(CHARS_ROOT, id);
  for (const sub of ['memory', 'diary']) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  return dir;
}
function listCharacters() {
  fs.mkdirSync(CHARS_ROOT, { recursive: true });
  const ids = fs.readdirSync(CHARS_ROOT).filter((n) => fs.statSync(path.join(CHARS_ROOT, n)).isDirectory());
  return ids.map((id) => { const m = readJson(path.join(CHARS_ROOT, id, 'meta.json'), {}); const av = fs.existsSync(path.join(CHARS_ROOT, id, 'avatar.bin')); return { id, name: m.name || '未命名', avatar: av ? '/avatar.png?c=' + id : '/default-avatar.png' }; });
}
function activeCharId() {
  const ids = listCharacters().map((c) => c.id);
  if (!ids.length) return '';
  const a = CONFIG.activeCharacter;
  return ids.includes(a) ? a : (ids.includes('default') ? 'default' : ids[0]);
}
let ACTIVE_CHAR = '';
function safeCharId(id) {
  const s = String(id == null ? '' : id);
  return /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : '';
}
function charDir(id) { return path.join(CHARS_ROOT, safeCharId(id) || ACTIVE_CHAR); }
function metaPath() { return path.join(charDir(), 'meta.json'); }
function personaPath() { return path.join(charDir(), 'persona.md'); }
function avatarPath() { return path.join(charDir(), 'avatar.bin'); }
function messagesPath() { return path.join(charDir(), 'messages.json'); }
function summaryPath() { return path.join(charDir(), 'summary.json'); }
function routinePath() { return path.join(charDir(), 'routine.json'); }
function statePath() { return path.join(charDir(), 'state.json'); }
function walletPath() { return path.join(charDir(), 'wallet.json'); }
function visitsPath() { return path.join(charDir(), 'visits.json'); }

function loadMeta() {
  const m = readJson(metaPath(), {});
  return { ...META_DEFAULT, ...m, traits: { ...META_DEFAULT.traits, ...(m.traits || {}) }, examples: Array.isArray(m.examples) ? m.examples : META_DEFAULT.examples, avatar: fs.existsSync(avatarPath()) ? '/avatar.png' : '/default-avatar.png' };
}
function saveMeta(meta) { writeJson(metaPath(), meta, { entity: 'character', entityId: ACTIVE_CHAR }); try { SYNC.record('character.meta.upsert', 'character', ACTIVE_CHAR, meta); } catch {} }
function loadPersonaBody() { try { return fs.readFileSync(personaPath(), 'utf8'); } catch { return PERSONA_DEFAULT; } }

let messages = [];
let nextId = 1;
let summary = { text: '', upto: 0 };
function loadMessages() {
  messages = readJson(messagesPath(), []);
  if (!Array.isArray(messages)) messages = [];
  let changed = false;
  for (const m of messages) { if (m && !m.uid) { m.uid = randomUUID(); changed = true; } }
  nextId = messages.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
  summary = readJson(summaryPath(), { text: '', upto: 0 });
  if (changed) { try { writeJson(messagesPath(), messages, { entity: 'messages', entityId: ACTIVE_CHAR }); } catch {} }
}
function addMessage(role, text, image, opts) {
  const clean = role === 'her' ? herText(text) : String(text);
  const msg = { id: nextId++, uid: randomUUID(), role, text: String(clean), at: Date.now() };
  if (image) msg.image = String(image);
  if (opts && opts.hidden) msg.hidden = true;
  messages.push(msg);
  if (messages.length > 800) messages = messages.slice(-600);
  writeJson(messagesPath(), messages, { entity: 'messages', entityId: ACTIVE_CHAR });
  try { SYNC.record('message.append', 'message', msg.id, msg); } catch {}
  return msg;
}

let MEM = null;
function initMemory() {
  MEM = new MemoryStore({
    path: path.join(charDir(), 'memory'), diaryPath: path.join(charDir(), 'diary'),
    halfLifeDays: Number((CONFIG.memory || {}).halfLifeDays) || 5,
    forgetThreshold: Number((CONFIG.memory || {}).forgetThreshold) || 0.12,
    maxInjected: Number((CONFIG.memory || {}).maxInjected) || 8,
    writeJson: (file, data) => writeJson(file, data),
    writeText: (file, text) => writeText(file, text),
    onSave: (ev) => {
      try {
        if (ev.kind === 'memory.facts') DATA.track('memory-facts', ACTIVE_CHAR, ev.file, ev.data);
        else if (ev.kind === 'diary') DATA.track('diary', ACTIVE_CHAR + ':' + ev.date, ev.file, ev.data);
      } catch {}
    },
  });
}
function snapshotCharacterWorld() {
  if (!ACTIVE_CHAR) return;
  CONFIG.worlds = CONFIG.worlds || {};
  CONFIG.worlds[ACTIVE_CHAR] = {
    maps: CONFIG.maps || null,
    activeMapId: CONFIG.activeMapId || '',
    location: CONFIG.location || null,
  };
}
function restoreCharacterWorld(id, adoptLegacy) {
  CONFIG.worlds = CONFIG.worlds || {};
  let w = CONFIG.worlds[id];
  if (!w && adoptLegacy && (CONFIG.maps || CONFIG.map || CONFIG.location)) {
    w = { maps: CONFIG.maps || (CONFIG.map ? [CONFIG.map] : null), activeMapId: CONFIG.activeMapId || '', location: CONFIG.location || null };
    CONFIG.worlds[id] = w;
  }
  CONFIG.maps = (w && w.maps) || null;
  CONFIG.activeMapId = (w && w.activeMapId) || '';
  CONFIG.location = (w && w.location) || null;
}
function activateCharacter(id) {
  const dir = ensureDirs(id);
  const switching = !!ACTIVE_CHAR && ACTIVE_CHAR !== id;
  if (switching) snapshotCharacterWorld();
  CONFIG.activeCharacter = id; ACTIVE_CHAR = id;
  restoreCharacterWorld(id, !switching);
  saveConfig();
  loadMessages(); initMemory();
  try { SYNC.record('character.switch', 'character', id, { id, name: (() => { try { return loadMeta().name || ''; } catch { return ''; } })() }); } catch {}
  // 首次创建：写入默认人设
  if (!fs.existsSync(path.join(dir, 'meta.json'))) saveMeta({ ...META_DEFAULT });
  if (!fs.existsSync(path.join(dir, 'persona.md'))) fs.writeFileSync(path.join(dir, 'persona.md'), PERSONA_DEFAULT, 'utf8');
  // 桌宠保持同一个窗口：由 pet.ps1 轮询当前角色并原地换图，避免切换时窗口空白/闪烁
}

// ---------- maps / location ----------
const TRANSPORTS = {
  walk: { label: '步行', icon: '🚶', speed: 1.3 }, bike: { label: '骑车', icon: '🚲', speed: 4.2 },
  bus: { label: '公交', icon: '🚌', speed: 8.3 }, car: { label: '自驾', icon: '🚗', speed: 13.9 },
  metro: { label: '地铁', icon: '🚇', speed: 16.7 }, coach: { label: '长途汽车', icon: '🚌', speed: 22 },
  rail: { label: '高铁', icon: '🚄', speed: 83 }, plane: { label: '飞机', icon: '✈️', speed: 250 },
};
const DEFAULT_PLACES = [
  { id: "home", name: "家", icon: "🏠", x: 0.17, y: 0.62, desc: "她自己的小窝，床、桌子和一堆衣服", feel: "在这里最放松，可以随便躺" },
  { id: "school", name: "学校", icon: "🏫", x: 0.425, y: 0.43, desc: "上课的地方", feel: "有点烦，但不去不行" },
  { id: "library", name: "图书馆", icon: "📚", x: 0.31, y: 0.17, desc: "安静看书、补作业", feel: "能安静下来，适合发呆" },
  { id: "cafe", name: "咖啡店", icon: "☕", x: 0.53, y: 0.27, desc: "偶尔坐一下午", feel: "有点小贵，但氛围好" },
  { id: "park", name: "公园", icon: "🌳", x: 0.64, y: 0.52, desc: "散步发呆", feel: "晚上散步很舒服" },
  { id: "canteen", name: "食堂", icon: "🍚", x: 0.61, y: 0.35, desc: "吃白饭的地方", feel: "人多，但饭好吃" },
  { id: "market", name: "超市", icon: "🛒", x: 0.66, y: 0.3, desc: "买吃的和日用品", feel: "总忍不住多买零食" },
  { id: "hospital", name: "医院", icon: "🏥", x: 0.45, y: 0.55, desc: "看病拿药的地方", feel: "一进来就不太舒服，希望少来" },
  { id: "bank", name: "银行", icon: "🏦", x: 0.51, y: 0.24, desc: "办卡取钱", feel: "排队很无聊" },
  { id: "mall", name: "商场", icon: "🏬", x: 0.36, y: 0.19, desc: "逛吃逛吃", feel: "容易冲动消费，要克制" },
  { id: "station", name: "车站", icon: "🚉", x: 0.45, y: 0.79, desc: "坐车去别处", feel: "人挤人，但有点旅行感" },
  { id: "riverside", name: "河边", icon: "🏞️", x: 0.17, y: 0.38, desc: "沿河走一走", feel: "风很舒服，适合放空" },
  { id: "bookstore", name: "书店", icon: "📖", x: 0.35, y: 0.35, desc: "逛书店", feel: "安静，一逛就很久" },
];
for (const p of DEFAULT_PLACES) {
  if (BUILTIN_SCENES[p.id]) p.scene = { ...BUILTIN_SCENES[p.id], characters: [] };
}
const ROAD_LINES = [
  [[0.00, 0.47], [0.12, 0.43], [0.25, 0.44], [0.38, 0.47], [0.50, 0.48], [0.62, 0.47], [0.75, 0.44], [0.88, 0.46], [1.00, 0.45]],
  [[0.50, 0.48], [0.505, 0.60], [0.495, 0.72], [0.50, 0.85], [0.505, 1.00]],
  [[0.12, 0.43], [0.20, 0.25], [0.24, 0.10]],
  [[0.12, 0.43], [0.13, 0.58], [0.14, 0.72], [0.18, 0.86]],
  [[0.88, 0.46], [0.86, 0.60], [0.86, 0.74], [0.78, 0.86], [0.66, 0.9]],
  [[0.38, 0.47], [0.46, 0.34], [0.55, 0.2], [0.62, 0.12]],
  [[0.62, 0.47], [0.66, 0.58], [0.6, 0.7], [0.6, 0.76]],
  [[0.38, 0.47], [0.32, 0.62], [0.32, 0.78]],
  [[0.50, 0.85], [0.4, 0.9], [0.2, 0.9]],
  [[0.62, 0.47], [0.72, 0.34], [0.84, 0.3]],
  [[0.20, 0.25], [0.42, 0.2], [0.55, 0.2]],
];
function normalizeRoads(roads) {
  if (!Array.isArray(roads)) return null;
  const lines = roads.map((line) => (Array.isArray(line) ? line : []).map((pt) => {
    const x = Number(pt && pt[0] !== undefined ? pt[0] : pt && pt.x);
    const y = Number(pt && pt[1] !== undefined ? pt[1] : pt && pt.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [Math.max(0, Math.min(1, x)), Math.max(0, Math.min(1, y))] : null;
  }).filter(Boolean)).filter((l) => l.length >= 2);
  return lines.length ? lines : null;
}
function normalizePlaces(places) {
  return (places || []).map((p) => {
    const d = DEFAULT_PLACES.find((x) => x.id === p.id) || {};
    const scene = p.scene === undefined ? (d.scene ? { ...d.scene, characters: [] } : null) : normalizeScene(p.scene);
    return { ...p, desc: p.desc || d.desc || '', feel: p.feel || d.feel || '', icon: p.icon || d.icon || '📍', image: p.image && String(p.image).startsWith('/models/') ? p.image : null, scene };
  });
}
function normalizeScene(sc) {
  if (!sc || typeof sc !== 'object') return null;
  const bg = String(sc.background || '').trim().slice(0, 300);
  if (!bg || !(bg.startsWith('/models/') || bg.startsWith('/assets/') || bg.startsWith('/images/'))) return null;
  const characters = Array.isArray(sc.characters) ? sc.characters.slice(0, 20).map((c) => ({
    id: String(c.id || '').slice(0, 40),
    x: Math.max(0.02, Math.min(0.98, Number(c.x) || 0.5)),
    y: Math.max(0.08, Math.min(0.95, Number(c.y) || 0.72)),
  })).filter((c) => c.id) : [];
  const hotspots = Array.isArray(sc.hotspots) ? sc.hotspots.slice(0, 24).map((h) => ({
    id: String(h.id || '').slice(0, 40),
    label: String(h.label || '').slice(0, 40),
    x: Math.max(0.02, Math.min(0.98, Number(h.x) || 0.5)),
    y: Math.max(0.05, Math.min(0.95, Number(h.y) || 0.5)),
    action: String(h.action || '').slice(0, 40),
  })) : [];
  const photos = Array.isArray(sc.photos) ? sc.photos.slice(0, 12).map((u) => String(u || '').trim()).filter((u) => u.startsWith('/models/')).slice(0, 12) : [];
  const obstacles = Array.isArray(sc.obstacles) ? sc.obstacles.slice(0, 40).map((o) => ({
    x: Math.max(0, Math.min(1, Number(o && o.x) || 0)),
    y: Math.max(0, Math.min(1, Number(o && o.y) || 0)),
    w: Math.max(0.01, Math.min(1, Number(o && o.w) || 0.05)),
    h: Math.max(0.01, Math.min(1, Number(o && o.h) || 0.05)),
  })).filter((o) => o.w > 0 && o.h > 0) : [];
  const walkable = Array.isArray(sc.walkable) ? sc.walkable.slice(0, 40).map((o) => ({
    x: Math.max(0, Math.min(1, Number(o && o.x) || 0)),
    y: Math.max(0, Math.min(1, Number(o && o.y) || 0)),
    w: Math.max(0.01, Math.min(1, Number(o && o.w) || 0.05)),
    h: Math.max(0.01, Math.min(1, Number(o && o.h) || 0.05)),
  })).filter((o) => o.w > 0 && o.h > 0) : [];
  const mode = sc.mode === '3d' ? '3d' : '2d';
  const model3d = sc.model3d && typeof sc.model3d === 'object' && String(sc.model3d.url || '').startsWith('/models/') ? {
    url: String(sc.model3d.url).slice(0, 300),
    scale: Math.max(0.05, Math.min(20, Number(sc.model3d.scale) || 1)),
    rotationY: Number(sc.model3d.rotationY) || 0,
  } : null;
  return { background: bg, characters, hotspots, photos, obstacles, walkable, mode, model3d };
}
function normalizeVehicles(v) {
  const out = {};
  for (const kind of ['car', 'bicycle']) {
    const x = v && v[kind];
    if (!x || typeof x !== 'object') continue;
    const url = String(x.url || '');
    if (!url.startsWith('/models/')) continue;
    out[kind] = {
      url,
      scale: Math.max(0.05, Math.min(20, Number(x.scale) || 1)),
      rotationY: Number(x.rotationY) || 0,
      x: Number(x.x) || null,
      y: Number(x.y) || null
    };
  }
  return out;
}
function loadMaps() {
  const fix = (m) => ({
    ...m, places: normalizePlaces(m.places), widthMeters: Number(m.widthMeters) || 2000,
    transport: m.transport || 'auto', theme: m.theme || 'town',
    model: m.model && m.model.url ? m.model : null,
    image: m.image && m.image.url ? m.image : null,
    displayMode: ['2d', '3d'].includes(m.displayMode) ? m.displayMode : '2d',
    roads: normalizeRoads(m.roads),
    vehicles: normalizeVehicles(m.vehicles),
    has2d: !!(m.image && m.image.url),
    has3d: m.has3d === true || !!(m.model && m.model.url),
  });
  if (Array.isArray(CONFIG.maps) && CONFIG.maps.length) return CONFIG.maps.map(fix);
  if (CONFIG.map && Array.isArray(CONFIG.map.places) && CONFIG.map.places.length) return [fix({ id: 'map-main', name: CONFIG.map.name || '小鱼镇', places: CONFIG.map.places })];
  return [{ id: 'map-main', name: '小鱼镇', places: DEFAULT_PLACES.map((p) => ({ ...p })), widthMeters: 2000, transport: 'auto', theme: 'town', displayMode: '2d', image: { url: '/official-map.jpg' } }];
}
function saveMaps(maps) {
  CONFIG.maps = maps;
  try { snapshotCharacterWorld(); } catch {}
  saveConfig();
  try {
    const entries = [['maps', ACTIVE_CHAR, null, maps]];
    for (const map of (Array.isArray(maps) ? maps : [])) {
      for (const place of (map.places || [])) entries.push(['place', String(map.id) + ':' + String(place.id), null, place]);
      for (let i = 0; i < (map.roads || []).length; i++) entries.push(['road', String(map.id) + ':' + i, null, map.roads[i]]);
    }
    DATA.trackMany(entries);
  } catch {}
  try { SYNC.record('maps.replace', 'maps', ACTIVE_CHAR, { maps }); } catch {}
}
function activeMapId() { const ids = loadMaps().map((m) => m.id); return ids.includes(CONFIG.activeMapId) ? CONFIG.activeMapId : ids[0]; }
function getActiveMap() { const maps = loadMaps(); return maps.find((m) => m.id === activeMapId()) || maps[0]; }
function loadLocation() { const l = CONFIG.location || {}; return { ...l, mapId: l.mapId || '', placeId: l.placeId || 'home', since: Number(l.since) || Date.now(), manual: !!l.manual }; }
function saveLocation(loc) { CONFIG.location = loc; try { snapshotCharacterWorld(); } catch {} saveConfig(); try { DATA.track('location', ACTIVE_CHAR, null, loc); } catch {} try { SYNC.record('location.set', 'location', ACTIVE_CHAR, loc); } catch {} }
function avatarDataUrl(id) {
  try {
    const f = path.join(CHARS_ROOT, id || ACTIVE_CHAR, 'avatar.bin');
    if (!fs.existsSync(f)) return '';
    const buf = fs.readFileSync(f);
    const mime = buf[0] === 0x89 ? 'image/png' : (buf[0] === 0xFF ? 'image/jpeg' : 'image/webp');
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch { return ''; }
}
function characterAvatarUrl(id) {
  try {
    const f = path.join(CHARS_ROOT, id, 'avatar.bin');
    if (fs.existsSync(f)) return '/avatar.png?c=' + encodeURIComponent(id) + '&t=' + Math.floor(fs.statSync(f).mtimeMs);
  } catch {}
  return '/default-avatar.png';
}
function pointAlongPath(pathPts, progress) {
  const path = Array.isArray(pathPts) ? pathPts : [];
  if (path.length < 2) return path[0] || { x: 0.5, y: 0.5 };
  let total = 0; const segs = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const d = Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
    segs.push(d); total += d;
  }
  let target = total * Math.max(0, Math.min(1, Number(progress) || 0));
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const a = path[i], b = path[i + 1]; const r = segs[i] ? target / segs[i] : 0;
      return { x: Number(a.x) + (Number(b.x) - Number(a.x)) * Math.min(1, Math.max(0, r)), y: Number(a.y) + (Number(b.y) - Number(a.y)) * Math.min(1, Math.max(0, r)) };
    }
    target -= segs[i];
  }
  return path[path.length - 1];
}
function characterWorld(id) {
  if (id === ACTIVE_CHAR) return { maps: loadMaps(), map: getActiveMap(), location: loadLocation() };
  const w = (CONFIG.worlds || {})[id] || {};
  const maps = (Array.isArray(w.maps) && w.maps.length) ? w.maps : loadMaps();
  const map = maps.find((m) => m.id === (w.activeMapId || '')) || maps[0] || null;
  const location = w.location || { placeId: (map && map.places && map.places[0] && map.places[0].id) || 'home', since: Date.now() };
  return { maps, map, location };
}
function worldPosition(map, loc) {
  if (!map || !loc) return { x: null, y: null, state: 'unknown', transport: '', etaSec: 0 };
  if (loc.intercity) {
    return { x: null, y: null, state: 'intercity', transport: (TRANSPORTS[loc.mode] || TRANSPORTS.rail).label, etaSec: Math.max(0, Math.round((Number(loc.durationMs) || 0) - (Date.now() - (Number(loc.startedAt) || Date.now()))) / 1000) };
  }
  if (loc.toPlaceId) {
    const info = travelInfo(loc, map);
    if (info) {
      if (info.progress >= 1) {
        const p = placeOf(map, loc.toPlaceId);
        return { x: p.x, y: p.y, state: 'stationary', transport: info.modeLabel, etaSec: 0 };
      }
      const pathPts = Array.isArray(loc.path) && loc.path.length > 1 ? loc.path : null;
      const pt = pathPts ? pointAlongPath(pathPts, info.progress) : null;
      const fallback = pt || placeOf(map, loc.toPlaceId);
      return { x: fallback.x, y: fallback.y, state: 'traveling', transport: info.modeLabel, etaSec: info.etaSec || 0 };
    }
  }
  const p = placeOf(map, loc.placeId);
  return { x: p.x, y: p.y, state: 'stationary', transport: '', etaSec: 0 };
}
function worldCharacters() {
  const activeMap = getActiveMap();
  const activeCur = currentPlace();
  const chars = listCharacters().map((c) => {
    const w = characterWorld(c.id);
    const map = w.map;
    const loc = w.location || {};
    const pos = worldPosition(map, loc);
    const placeId = String(loc.toPlaceId || loc.placeId || '');
    const place = map && Array.isArray(map.places) ? map.places.find((p) => p.id === placeId) : null;
    const sameMap = !!(map && activeMap && map.id === activeMap.id);
    return {
      id: c.id, name: c.name || c.id, avatar: characterAvatarUrl(c.id),
      mapId: (map && map.id) || '', mapName: (map && map.name) || '',
      placeId, placeName: (place && place.name) || '', icon: (place && place.icon) || '',
      x: pos.x, y: pos.y, state: pos.state, transport: pos.transport, etaSec: pos.etaSec,
      sameMap, samePlace: sameMap && pos.state === 'stationary' && placeId === String(activeCur.placeId),
      isActive: c.id === ACTIVE_CHAR,
    };
  });
  return chars.sort((a, b) => (b.isActive ? 1 : 0) - (a.isActive ? 1 : 0));
}
function scenePlaceAndHotspot(placeId, hotspotId) {
  const map = getActiveMap();
  const place = map && Array.isArray(map.places) ? map.places.find((p) => p.id === placeId) : null;
  if (!place) return null;
  const hotspot = place.scene && Array.isArray(place.scene.hotspots) ? place.scene.hotspots.find((h) => h.id === hotspotId || h.label === hotspotId) : null;
  return { map, place, hotspot };
}
function localSceneActivity(metaName, place, hotspot) {
  const who = metaName || '她';
  if (hotspot && hotspot.label) return `${who}正在「${hotspot.label}」旁边。`;
  return `${who}正在「${place.name}」里待着。`;
}
async function sceneActivityFor(characterId, placeId, hotspotId) {
  const found = scenePlaceAndHotspot(placeId, hotspotId);
  if (!found) return { ok: false, error: '地点不存在' };
  const meta = readJson(path.join(CHARS_ROOT, String(characterId || ACTIVE_CHAR), 'meta.json'), {});
  const name = meta.name || '她';
  const key = String(characterId || ACTIVE_CHAR) + ':' + placeId + ':' + (hotspotId || '');
  const now = Date.now();
  const cached = SCENE_ACTIVITY_CACHE.get(key);
  if (cached && now - cached.at < 10 * 60 * 1000) return { ok: true, text: cached.text, source: cached.source, cached: true };
  const fallback = localSceneActivity(name, found.place, found.hotspot);
  let text = fallback;
  let source = 'local';

  // AI 只在有 API Key 且全局间隔足够时偶尔调用；悬浮频繁不会每次烧 token
  try {
    if (CONFIG.sceneActivityAI !== false && (now - SCENE_AI_LAST > 5 * 60 * 1000) && apiKey()) {
      SCENE_AI_LAST = now;
      const spot = found.hotspot ? found.hotspot.label : '';
      const resp = await chatCompletion({
        messages: [
          { role: 'system', content: `你是${name}。用一句 12 到 20 字的中文描述你此刻在做什么，像游戏角色头顶的悬浮状态。不要出现“系统”“AI”“提示词”，不要解释，不要括号，不要每次都说在发呆。` },
          { role: 'user', content: `地点：${found.place.name}（${found.place.desc || ''}）。附近：${spot || '这里'}。当前时间：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}。请写这一句：` },
        ],
        max_tokens: 500, temperature: 0.9,
      });
      const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
      const aiText = msg ? String(msg.content || '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').split('\n')[0].trim().slice(0, 40) : '';
      if (aiText) { text = aiText; source = 'ai'; }
    }
  } catch (e) { try { console.error('[scene-activity-ai]', String(e && e.message || e).slice(0, 300)); } catch {} }
  SCENE_ACTIVITY_CACHE.set(key, { text, source, at: now });
  return { ok: true, text, source, cached: false };
}
function placeOf(map, id) { return map.places.find((p) => p.id === id) || map.places[0]; }

// ---------- 后台生活模拟（0.7.1 基础版）----------
const LIFE_SIM_DEFAULT = {
  enabled: true,
  minEventGapMin: 90,
  maxDaily: 8,
  quietStart: 23,
  quietEnd: 8,
  photoChance: 0.25,
};
const LIFE_SIM_BEHAVIORS = {
  sleep: { min: 360, max: 540, name: '睡觉' },
  read: { min: 30, max: 90, name: '看书' },
  study: { min: 45, max: 120, name: '写作业' },
  eat: { min: 20, max: 45, name: '吃饭' },
  coffee: { min: 30, max: 60, name: '喝咖啡' },
  phone: { min: 15, max: 45, name: '看手机' },
  look: { min: 3, max: 10, name: '看看' },
  idle: { min: 10, max: 30, name: '发呆' },
};
function lifeSimCfg() { return { ...LIFE_SIM_DEFAULT, ...(CONFIG.lifeSim || {}) }; }
function lifeSimPath(id) { return path.join(charDir(id || ACTIVE_CHAR), 'life-state.json'); }
function messagesPathFor(id) { return path.join(charDir(id || ACTIVE_CHAR), 'messages.json'); }
function addMessageFor(id, role, text, image) {
  if (!id || id === ACTIVE_CHAR) return addMessage(role, text, image);
  const clean = role === 'her' ? herText(text) : String(text);
  let arr = [];
  try { arr = readJson(messagesPathFor(id), []); } catch {}
  if (!Array.isArray(arr)) arr = [];
  const msg = { id: arr.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1, uid: randomUUID(), role, text: String(clean), at: Date.now() };
  if (image) msg.image = String(image);
  arr.push(msg);
  if (arr.length > 800) arr = arr.slice(-600);
  try { writeJson(messagesPathFor(id), arr); } catch {}
  try { SYNC.record('message.append', 'message', msg.id, msg); } catch {}
  return msg;
}
function lifeRecentFor(id) {
  let arr = [];
  try { arr = id === ACTIVE_CHAR ? messages : readJson(messagesPathFor(id), []); } catch {}
  return (Array.isArray(arr) ? arr : []).filter((m) => m.role === 'user' || m.role === 'her').slice(-6)
    .map((m) => (m.role === 'user' ? '他：' : '你：') + String(m.text || '').slice(0, 100)).join('\n');
}
function lifeTravelMinutes() { return 30 + Math.round(Math.random() * 120); }
function lifeSetLocation(id, mapId, placeId) {
  try {
    if (id === ACTIVE_CHAR) {
      CONFIG.activeMapId = mapId;
      saveLocation({ mapId, placeId, since: Date.now(), manual: false });
      return true;
    }
    const maps = loadMaps();
    const map = maps.find((m) => m.id === mapId);
    if (!map || !(map.places || []).some((p) => p.id === placeId)) return false;
    CONFIG.worlds = CONFIG.worlds || {};
    const w = CONFIG.worlds[id] || {};
    w.maps = maps; w.activeMapId = mapId; w.location = { mapId, placeId, since: Date.now(), manual: false };
    CONFIG.worlds[id] = w;
    saveConfig();
    return true;
  } catch { return false; }
}
function loadLifeSimState(id) {
  try { return readJson(lifeSimPath(id), null); } catch { return null; }
}
function saveLifeSimState(id, st) {
  try { writeJson(lifeSimPath(id), st); } catch {}
}
function lifeIsNight() { const h = new Date().getHours(); return h >= 22 || h < 7; }
function lifeSceneFor(id) {
  const w = characterWorld(id || ACTIVE_CHAR);
  const map = w.map; if (!map) return null;
  const loc = w.location || {};
  const place = (map.places || []).find((p) => p.id === loc.placeId) || (map.places || [])[0];
  if (!place) return null;
  const scene = place.scene || null;
  return { map, place, scene, hotspots: scene && Array.isArray(scene.hotspots) ? scene.hotspots : [] };
}
function lifeBehaviorFor(hotspot, place) {
  const action = String((hotspot && hotspot.action) || '').trim();
  if (LIFE_SIM_BEHAVIORS[action]) return action;
  const label = String((hotspot && hotspot.label) || '');
  if (/床|睡|枕/.test(label)) return 'sleep';
  if (/书架|阅读|图书|小说/.test(label)) return 'read';
  if (/作业|课桌|黑板|书桌|学习/.test(label)) return 'study';
  if (/饭|餐|食堂|窗口|吃/.test(label)) return 'eat';
  if (/咖啡|吧台/.test(label)) return 'coffee';
  if (/手机|电脑/.test(label)) return 'phone';
  return 'look';
}
function lifeDurationMinutes(behavior) {
  const cfg = LIFE_SIM_BEHAVIORS[behavior] || LIFE_SIM_BEHAVIORS.idle;
  if (behavior === 'sleep' && !lifeIsNight()) return 60 + Math.random() * 60;
  return cfg.min + Math.random() * (cfg.max - cfg.min);
}
function lifePositionFor(id, hotspot, place) {
  let x = hotspot && Number.isFinite(Number(hotspot.x)) ? Number(hotspot.x) : 0.5;
  let y = hotspot && Number.isFinite(Number(hotspot.y)) ? Number(hotspot.y) : 0.62;
  x += (Math.random() - 0.5) * 0.03; y += 0.025 + (Math.random() - 0.5) * 0.02;
  // 同地点角色简单避让，避免叠在一起
  try {
    const others = listCharacters().filter((c) => c.id !== id);
    for (const c of others) {
      const st = loadLifeSimState(c.id);
      if (!st || st.placeId !== (place && place.id)) continue;
      const ox = Number(st.position && st.position.x), oy = Number(st.position && st.position.y);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
      if (Math.hypot(x - ox, y - oy) < 0.06) { x += x >= ox ? 0.06 : -0.06; y += y >= oy ? 0.03 : -0.03; }
    }
  } catch {}
  return { x: Math.max(0.04, Math.min(0.96, x)), y: Math.max(0.12, Math.min(0.92, y)) };
}
function lifePathFor(id, from, to, ctx) {
  const cols = 28, rows = 18;
  const x0 = 0.04, y0 = 0.1, x1 = 0.96, y1 = 0.94;
  const obstacles = Array.isArray(ctx.scene && ctx.scene.obstacles) ? ctx.scene.obstacles.slice() : [];
  const walkable = Array.isArray(ctx.scene && ctx.scene.walkable) ? ctx.scene.walkable.slice() : [];
  if (!obstacles.length) {
    for (const h of (ctx.hotspots || [])) {
      const hx = Number(h.x), hy = Number(h.y);
      if (Number.isFinite(hx) && Number.isFinite(hy)) obstacles.push({ x: hx - 0.035, y: hy - 0.035, w: 0.07, h: 0.07 });
    }
  }
  for (const c of listCharacters()) {
    if (c.id === id) continue;
    const ost = loadLifeSimState(c.id);
    if (!ost || ost.placeId !== ctx.place.id) continue;
    const p = ost.position || {};
    if (Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) obstacles.push({ x: Number(p.x) - 0.025, y: Number(p.y) - 0.025, w: 0.05, h: 0.05 });
  }
  const cell = (x, y) => ({ c: Math.max(0, Math.min(cols - 1, Math.floor((x - x0) / (x1 - x0) * cols))), r: Math.max(0, Math.min(rows - 1, Math.floor((y - y0) / (y1 - y0) * rows))) });
  const pos = (c, r) => ({ x: x0 + (c + 0.5) / cols * (x1 - x0), y: y0 + (r + 0.5) / rows * (y1 - y0) });
  const blocked = new Set();
  // 可走区域：画了之后，只有区域内的格子可走
  if (walkable.length) {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const pt = pos(c, r);
      if (!walkable.some((w) => pt.x >= w.x && pt.x <= w.x + w.w && pt.y >= w.y && pt.y <= w.y + w.h)) blocked.add(c + ',' + r);
    }
  }
  for (const o of obstacles) {
    const a = cell(o.x, o.y), b = cell(o.x + o.w, o.y + o.h);
    for (let r = a.r; r <= b.r; r++) for (let c = a.c; c <= b.c; c++) blocked.add(c + ',' + r);
  }
  const start = cell(from.x, from.y), goal = cell(to.x, to.y);
  const freeNear = (p) => {
    if (!blocked.has(p.c + ',' + p.r)) return p;
    for (let rad = 1; rad < 8; rad++) for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const c = p.c + dc, r = p.r + dr;
      if (c >= 0 && c < cols && r >= 0 && r < rows && !blocked.has(c + ',' + r)) return { c, r };
    }
    return p;
  };
  const s0 = freeNear(start), g0 = freeNear(goal);
  const key = (c, r) => c + ',' + r;
  const open = [{ ...s0, f: 0 }]; const came = new Map(); const gScore = new Map([[key(s0.c, s0.r), 0]]);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let found = false, guard = 0;
  while (open.length && guard++ < 4000) {
    open.sort((a, b) => a.f - b.f);
    const cur = open.shift();
    if (cur.c === g0.c && cur.r === g0.r) { found = true; break; }
    for (const [dc, dr] of dirs) {
      const c = cur.c + dc, r = cur.r + dr;
      if (c < 0 || c >= cols || r < 0 || r >= rows || blocked.has(key(c, r))) continue;
      const tentative = (gScore.get(key(cur.c, cur.r)) || 0) + Math.hypot(dc, dr);
      if (tentative >= (gScore.get(key(c, r)) ?? Infinity)) continue;
      gScore.set(key(c, r), tentative); came.set(key(c, r), key(cur.c, cur.r));
      const f = tentative + Math.hypot(g0.c - c, g0.r - r);
      if (!open.some((o) => o.c === c && o.r === r)) open.push({ c, r, f });
    }
  }
  const pathPts = [];
  if (found) {
    let k = key(g0.c, g0.r); const rev = [];
    while (k) { const [c, r] = k.split(',').map(Number); rev.push(pos(c, r)); k = came.get(k); }
    rev.reverse(); pathPts.push(...rev);
  } else {
    pathPts.push(pos(s0.c, s0.r), pos(g0.c, g0.r));
  }
  pathPts.push({ x: to.x, y: to.y });
  return pathPts;
}
function lifePickLocal(ctx, state) {
  const hotspots = ctx.hotspots || [];
  if (!hotspots.length) return { behavior: 'idle', hotspot: null, minutes: lifeDurationMinutes('idle') };
  let pool = hotspots;
  if (String(ctx.place.id) === 'home' && lifeIsNight()) {
    const bed = hotspots.filter((h) => /床|睡|枕/.test(String(h.label || '')));
    if (bed.length) pool = bed;
  }
  const h = pool[Math.floor(Math.random() * pool.length)];
  const behavior = lifeBehaviorFor(h, ctx.place);
  return { behavior, hotspot: h, minutes: lifeDurationMinutes(behavior) };
}
function lifeInitState(id) {
  const ctx = lifeSceneFor(id);
  if (!ctx) return null;
  const local = lifePickLocal(ctx, null);
  const now = Date.now();
  const position = lifePositionFor(id, local.hotspot, ctx.place);
  const path = lifePathFor(id, position, position, ctx);
  return {
    characterId: id,
    mapId: ctx.map.id,
    placeId: ctx.place.id,
    placeName: ctx.place.name,
    hotspotId: local.hotspot ? (local.hotspot.id || local.hotspot.label || '') : '',
    hotspotLabel: local.hotspot ? local.hotspot.label || '' : '',
    behavior: local.behavior,
    behaviorLabel: (LIFE_SIM_BEHAVIORS[local.behavior] || {}).name || local.behavior,
    position,
    path,
    startedAt: now,
    endsAt: now + local.minutes * 60000,
    energy: 70,
    mood: '平静',
    lastDecisionAt: now,
    lastEventAt: Number(CONFIG.lifeSimLastEventAt || 0),
    eventsDate: '',
    eventsToday: 0,
  };
}
function lifeGetState(id) {
  let st = loadLifeSimState(id);
  const ctx = lifeSceneFor(id);
  if (!ctx) return null;
  if (!st || st.mapId !== ctx.map.id || st.placeId !== ctx.place.id) {
    st = lifeInitState(id);
    if (st) saveLifeSimState(id, st);
  }
  if (st && (!st.position || !Number.isFinite(Number(st.position.x)) || !Number.isFinite(Number(st.position.y)))) {
    const hotspot = (ctx.hotspots || []).find((h) => String(h.id || '') === String(st.hotspotId || '') || String(h.label || '') === String(st.hotspotId || '') || String(h.label || '') === String(st.hotspotLabel || '')) || null;
    st.position = lifePositionFor(id, hotspot, ctx.place);
    st.placeName = st.placeName || ctx.place.name;
    saveLifeSimState(id, st);
  }
  if (st && !Array.isArray(st.path)) {
    st.path = lifePathFor(id, st.position || { x: 0.5, y: 0.7 }, st.position || { x: 0.5, y: 0.7 }, ctx);
    saveLifeSimState(id, st);
  }
  return st;
}
function lifeQuietNow(cfg) {
  const h = new Date().getHours();
  return cfg.quietStart <= cfg.quietEnd ? (h >= cfg.quietStart && h < cfg.quietEnd) : (h >= cfg.quietStart || h < cfg.quietEnd);
}
function lifeParseJson(text) {
  try {
    const s = String(text || '').replace(/```json|```/gi, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    return JSON.parse(s.slice(a, b + 1));
  } catch { return null; }
}
async function lifeAskAI(id, st, ctx) {
  const meta = readJson(path.join(charDir(id), 'meta.json'), {});
  const name = meta.name || '她';
  const hot = (ctx.hotspots || []).map((h) => String(h.label || '')).filter(Boolean).join('、') || '无';
  const maps = loadMaps();
  const places = maps.map((m) => m.name + '（' + m.id + '）：' + (m.places || []).map((p) => p.id + '=' + p.name).join(' / ')).join('\n');
  const recent = lifeRecentFor(id);
  const resp = await chatCompletion({
    messages: [
      { role: 'system', content: `你是${name}。你在过自己的生活，现在到了决定下一步做什么的时候。用 JSON 返回，不要输出别的。
可用行为：sleep, read, study, eat, coffee, phone, look, idle。
可用地图与地点：
${places}
当前热点：${hot}。
返回格式：{"mapId":"map-main","placeId":"library","behavior":"read","hotspot":"书架","durationMinutes":45,"tellUser":false,"message":"","imagePrompt":"","memory":""}
规则：
- mapId/placeId 从可用地图和地点里选；只有真的想换地点或去别的地图时才改，否则填当前地图/地点
- 跨地图会走长途，时间会更久，只有真的想去才跨
- behavior 必须是上面之一
- hotspot 优先从可用热点里选
- durationMinutes 按真实生活：睡觉夜间 360–540，看书 30–90，写作业 45–120，吃饭 20–45，咖啡 30–60，手机 15–45，看看 3–10，发呆 10–30
- tellUser 只有真值得主动找他时才 true，最多一句话，25–50 字
- 如果 tellUser，message 是你要发给他的原话，自然、不解释、不括号
- imagePrompt 只有刚好拍了/看到东西时填，否则留空
- memory 是这件事的一两句记忆，可为空` },
      { role: 'user', content: `当前地图：${ctx.map.name}。当前地点：${ctx.place.name}（${ctx.place.desc || ''}）。当前时间：${new Date().toLocaleString('zh-CN')}。精力：${st.energy}。最近聊天：\n${recent || '（没聊什么）'}\n请决定下一步（可以换同一张地图里的地点），并告诉我要不要主动找他。` },
    ],
    max_tokens: 700, temperature: 0.9,
  });
  const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
  return lifeParseJson(msg && msg.content);
}

async function lifeSocialTick(force) {
  const cfg = lifeSimCfg();
  if (cfg.enabled === false && !force) return null;
  const chars = listCharacters();
  const states = chars.map((c) => ({ c, st: lifeGetState(c.id) })).filter((x) => x.st);
  const now = Date.now();
  const keys = new Set();
  for (const a of states) {
    for (const b of states) {
      if (a.c.id >= b.c.id) continue;
      if (a.st.mapId !== b.st.mapId || a.st.placeId !== b.st.placeId) continue;
      const pa = a.st.position || {}, pb = b.st.position || {};
      if (!Number.isFinite(Number(pa.x)) || !Number.isFinite(Number(pb.x))) continue;
      const dist = Math.hypot(Number(pa.x) - Number(pb.x), Number(pa.y) - Number(pb.y));
      if (dist > 0.45) continue;
      const key = a.c.id + ':' + b.c.id;
      keys.add(key);
      const last = Number((CONFIG.lifeSocialAt || {})[key] || 0);
      if (!force && now - last < 30 * 60 * 1000) continue;
      if (!force && Math.random() > 0.35) continue;
      let decision = null;
      try {
        const resp = await chatCompletion({
          messages: [
            { role: 'system', content: `你是${a.c.name}。你在${a.st.placeName}遇到了${b.c.name}。用 JSON 返回：{"tellUser":true,"message":"你想对用户说的一句话","memory":"这件事的一两句记忆"}。message 要自然、25–45 字，可以提到你们在做什么；不要解释、不要括号。` },
            { role: 'user', content: `你正在：${a.st.behaviorLabel}。${b.c.name}正在：${b.st.behaviorLabel}。请判断这次相遇值不值得告诉用户。` },
          ],
          max_tokens: 600, temperature: 0.9,
        });
        const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
        decision = lifeParseJson(msg && msg.content);
      } catch {}
      CONFIG.lifeSocialAt = CONFIG.lifeSocialAt || {};
      CONFIG.lifeSocialAt[key] = now; saveConfig();
      const mem = String((decision && decision.memory) || (a.c.name + '在' + a.st.placeName + '遇到了' + b.c.name)).slice(0, 300);
      for (const x of [a, b]) {
        try {
          const mp = path.join(charDir(x.c.id), 'life-memory.json');
          const arr = readJson(mp, []);
          if (Array.isArray(arr)) { arr.push({ at: now, place: a.st.placeName, behavior: '相遇', text: mem, with: x === a ? b.c.name : a.c.name }); writeJson(mp, arr.slice(-200)); }
        } catch {}
      }
      if (decision && decision.tellUser && decision.message) {
        const active = chars.find((c) => c.id === ACTIVE_CHAR);
        if (active && (active.id === a.c.id || active.id === b.c.id)) {
          try { addMessageFor(ACTIVE_CHAR, 'her', String(decision.message).slice(0, 120)); } catch {}
        }
      }
      return { ok: true, pair: [a.c.id, b.c.id], place: a.st.placeName, decision };
    }
  }
  return { ok: true, pairs: keys.size };
}


function lifeAct(id, placeId, hotspotId) {
  const ctx = lifeSceneFor(id); if (!ctx) return null;
  const st = lifeGetState(id); if (!st) return null;
  if (placeId && String(ctx.place.id) !== String(placeId)) return null;
  const hotspot = (ctx.hotspots || []).find((h) => String(h.id || '') === String(hotspotId || '') || String(h.label || '') === String(hotspotId || '')) || null;
  const behavior = lifeBehaviorFor(hotspot, ctx.place);
  const bcfg = LIFE_SIM_BEHAVIORS[behavior] || LIFE_SIM_BEHAVIORS.idle;
  const now = Date.now();
  st.behavior = behavior; st.behaviorLabel = bcfg.name;
  st.hotspotId = hotspot ? (hotspot.id || hotspot.label || '') : '';
  st.hotspotLabel = hotspot ? (hotspot.label || '') : '';
  st.position = lifePositionFor(id, hotspot, ctx.place);
  st.startedAt = now; st.endsAt = now + lifeDurationMinutes(behavior) * 60000; st.lastDecisionAt = now;
  saveLifeSimState(id, st);
  return st;
}


function lifeSetPosition(id, x, y) {
  const st = lifeGetState(id); if (!st) return null;
  const px = Math.max(0.03, Math.min(0.97, Number(x)));
  const py = Math.max(0.08, Math.min(0.94, Number(y)));
  st.position = { x: px, y: py };
  saveLifeSimState(id, st);
  return st;
}

function recordVmCheckFor(id, r) {
  try {
    const x = r && r.result ? r.result : r;
    const an = x && x.analysis;
    if (!an) return;
    const recent = Array.isArray(an.recent) ? an.recent : [];
    const lastUser = [...recent].reverse().find((m) => /对方|user|用户/i.test(String((m && m.from) || '')) && String((m && m.text) || '').trim());
    const txt = lastUser ? String(lastUser.text).trim() : '';
    const seenMap = { ...(CONFIG.vmChat?.lastUserByChar || {}) };
    if (txt && txt !== String(seenMap[id] || '')) {
      addMessageFor(id, 'user', txt);
      seenMap[id] = txt;
      CONFIG.vmChat = { ...(CONFIG.vmChat || {}), lastUserByChar: seenMap }; saveConfig();
    }
    const sent = x && x.sent;
    if (sent && sent.ok && an.reply) addMessageFor(id, 'her', String(an.reply).trim());
  } catch {}
}

async function lifeTick(id) {
  const cfg = lifeSimCfg();
  if (cfg.enabled === false && !(arguments[1] && arguments[1].force)) return null;
  let ctx = lifeSceneFor(id); if (!ctx) return null;
  let st = lifeGetState(id); if (!st) return null;
  const now = Date.now();
  if (st.traveling) {
    if (!(arguments[1] && arguments[1].force) && now < Number(st.traveling.arrivesAt || 0)) return st;
    lifeSetLocation(id, st.traveling.toMapId, st.traveling.toPlaceId);
    const ctx2 = lifeSceneFor(id);
    if (ctx2) {
      const local2 = lifePickLocal(ctx2, st);
      st.traveling = null; st.mapId = ctx2.map.id; st.placeId = ctx2.place.id; st.placeName = ctx2.place.name;
      st.behavior = local2.behavior; st.behaviorLabel = (LIFE_SIM_BEHAVIORS[local2.behavior] || {}).name || local2.behavior;
      st.hotspotId = local2.hotspot ? (local2.hotspot.id || local2.hotspot.label || '') : '';
      st.hotspotLabel = local2.hotspot ? (local2.hotspot.label || '') : '';
      st.position = lifePositionFor(id, local2.hotspot, ctx2.place);
      st.startedAt = now; st.endsAt = now + local2.minutes * 60000; st.lastDecisionAt = now;
      saveLifeSimState(id, st);
    }
    return st;
  }
  if (!(arguments[1] && arguments[1].force) && now < Number(st.endsAt || 0)) return st;
  let decision = null;
  try { decision = await lifeAskAI(id, st, ctx); } catch { decision = null; }
  // 跨地图/换地点
  if (decision && (decision.mapId || decision.placeId)) {
    const targetMapId = String(decision.mapId || ctx.map.id);
    const targetPlaceId = String(decision.placeId || ctx.place.id);
    if (targetMapId !== String(ctx.map.id)) {
      const targetMap = loadMaps().find((m) => m.id === targetMapId);
      if (targetMap && (targetMap.places || []).some((p) => p.id === targetPlaceId)) {
        st.traveling = { fromMapId: ctx.map.id, fromPlaceId: ctx.place.id, toMapId: targetMapId, toPlaceId: targetPlaceId, startedAt: now, arrivesAt: now + lifeTravelMinutes() * 60000, targetName: targetMap.name + '·' + (targetMap.places.find((p) => p.id === targetPlaceId).name || '') };
        saveLifeSimState(id, st);
        return st;
      }
    } else if (targetPlaceId !== String(ctx.place.id)) {
      const target = (ctx.map.places || []).find((p) => String(p.id) === targetPlaceId);
      if (target && lifeSetLocation(id, ctx.map.id, target.id)) {
        ctx = lifeSceneFor(id) || ctx;
        st.placeId = ctx.place.id; st.placeName = ctx.place.name; st.mapId = ctx.map.id;
      }
    }
  }
  const local = lifePickLocal(ctx, st);
  const behavior = decision && LIFE_SIM_BEHAVIORS[decision.behavior] ? decision.behavior : local.behavior;
  const hotspot = decision && decision.hotspot && ctx.hotspots.find((h) => String(h.label || '') === String(decision.hotspot) || String(h.id || '') === String(decision.hotspot)) ? ctx.hotspots.find((h) => String(h.label || '') === String(decision.hotspot) || String(h.id || '') === String(decision.hotspot)) : local.hotspot;
  let minutes = Number(decision && decision.durationMinutes);
  if (!Number.isFinite(minutes)) minutes = local.minutes;
  const bcfg = LIFE_SIM_BEHAVIORS[behavior] || LIFE_SIM_BEHAVIORS.idle;
  const minMinutes = behavior === 'sleep' ? (lifeIsNight() ? 360 : 60) : bcfg.min;
  minutes = Math.max(minMinutes, Math.min(behavior === 'sleep' ? 540 : bcfg.max, minutes));
  st.behavior = behavior;
  st.behaviorLabel = bcfg.name;
  st.hotspotId = hotspot ? (hotspot.id || hotspot.label || '') : '';
  st.hotspotLabel = hotspot ? (hotspot.label || '') : '';
  const fromPos = st.position || lifePositionFor(id, hotspot, ctx.place);
  st.position = lifePositionFor(id, hotspot, ctx.place);
  st.path = lifePathFor(id, fromPos, st.position, ctx);
  st.startedAt = now;
  st.endsAt = now + minutes * 60000;
  st.lastDecisionAt = now;
  // 事件判断
  try {
    const tell = !!(decision && decision.tellUser && decision.message);
    const date = new Date().toISOString().slice(0, 10);
    if (st.eventsDate !== date) { st.eventsDate = date; st.eventsToday = 0; }
    const gapOk = now - Number(st.lastEventAt || 0) >= Number(cfg.minEventGapMin || 90) * 60000;
    if (tell && !lifeQuietNow(cfg) && gapOk && Number(st.eventsToday || 0) < Number(cfg.maxDaily || 8)) {
      let text = String(decision.message || '').trim().slice(0, 120);
      let image = null;
      try {
        const chance = Math.max(0, Math.min(1, Number(cfg.photoChance ?? 0.25)));
        if (decision.imagePrompt && Math.random() < chance) {
          const icfg = loadImageCfg();
          if (icfg.enabled && icfg.apiKeySet) {
            // 角色身份约束：如果画面里出现这个角色，外观必须与角色设定一致
            let identity = '';
            try {
              const mm = readJson(path.join(charDir(id), 'meta.json'), {});
              const persona = fs.existsSync(path.join(charDir(id), 'persona.md')) ? fs.readFileSync(path.join(charDir(id), 'persona.md'), 'utf8') : '';
              identity = String(mm.appearance || mm.identity || persona.replace(/\s+/g, ' ').slice(0, 500) || '').trim();
            } catch {}
            const ip = String(decision.imagePrompt || '');
            const wantsCharacter = /(她|自己|我|人像|自拍|照片里|角色)/.test(ip);
            const fixed = identity ? ('角色固定外观：' + identity.slice(0, 500) + '。如果画面中出现角色，必须保持这个外观、发型、发色、脸型和气质一致，不要换成另一个人。') : '';
            image = await generateImageFile((fixed + ' ' + ip).slice(0, 1200), { size: '1024x1024', image: wantsCharacter ? (avatarDataUrl(id) || undefined) : undefined });
          }
        }
      } catch {}
      if (text) {
        let deliveredVm = false;
        try {
          if (id === ACTIVE_CHAR && CONFIG.vmChat && CONFIG.vmChat.enabled) {
            if (CONFIG.vmChat.checkMessages !== false) {
              try {
                const cr = await VM_CHAT.checkAndReply();
                if (cr && cr.ok) recordVmCheckFor(id, cr);
              } catch {}
            }
            const vr = await VM_CHAT.sendText(text);
            deliveredVm = !!(vr && vr.ok);
            if (deliveredVm && CONFIG.vmChat.idleShutdown !== false) { try { await VM_CHAT.stop(); } catch {} }
          }
        } catch {}
        addMessageFor(id, 'her', text, image || undefined);
        st.lastEventAt = now; st.eventsToday = Number(st.eventsToday || 0) + 1;
        CONFIG.lifeSimLastEventAt = now; saveConfig();
        const mem = readJson(path.join(charDir(id), 'life-memory.json'), []);
        if (Array.isArray(mem)) {
          mem.push({ at: now, place: ctx.place.name, behavior: st.behaviorLabel, text: String(decision.memory || text).slice(0, 300) });
          writeJson(path.join(charDir(id), 'life-memory.json'), mem.slice(-200));
        }
      }
    }
  } catch {}
  saveLifeSimState(id, st);
  return st;
}



function routeOnRoads(map, from, to) {
  const roads = (map && Array.isArray(map.roads) && map.roads.length) ? map.roads : ROAD_LINES;
  const nodes = [];
  const lineIds = [];
  for (const line of roads) {
    const ids = [];
    for (const pt of line) {
      const x = Number(pt[0] !== undefined ? pt[0] : pt.x), y = Number(pt[1] !== undefined ? pt[1] : pt.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      ids.push(nodes.length); nodes.push({ x, y });
    }
    if (ids.length > 1) lineIds.push(ids);
  }
  if (!nodes.length) return { path: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], distanceMeters: 0 };
  const edges = [];
  for (const ids of lineIds) for (let i = 0; i < ids.length - 1; i++) edges.push([ids[i], ids[i + 1]]);
  for (const ids of lineIds) for (const end of [ids[0], ids[ids.length - 1]]) {
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => { if (ids.includes(i)) return; const d = (n.x - nodes[end].x) ** 2 + (n.y - nodes[end].y) ** 2; if (d < bd) { bd = d; best = i; } });
    if (best >= 0 && bd < 0.06) edges.push([end, best]);
  }
  const nearest = (p) => { let bi = 0, bd = Infinity; nodes.forEach((n, i) => { const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
  const adj = new Map();
  for (const [a, b] of edges) { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); }
  const s = nearest(from), e = nearest(to);
  const dist = new Map(), prev = new Map();
  for (let i = 0; i < nodes.length; i++) dist.set(i, Infinity);
  dist.set(s, 0);
  const seen = new Set();
  while (seen.size < nodes.length) {
    let u = -1, du = Infinity;
    for (let i = 0; i < nodes.length; i++) if (!seen.has(i) && dist.get(i) < du) { du = dist.get(i); u = i; }
    if (u < 0) break;
    seen.add(u);
    for (const v of adj.get(u) || []) { const w = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y); if (dist.get(u) + w < dist.get(v)) { dist.set(v, dist.get(u) + w); prev.set(v, u); } }
  }
  const roadPath = [];
  if (dist.get(e) < Infinity) { let cur = e; const st = []; while (cur !== undefined) { st.push(cur); cur = prev.get(cur); } st.reverse(); for (const n of st) roadPath.push({ x: nodes[n].x, y: nodes[n].y }); }
  const pathPts = [{ x: from.x, y: from.y }, ...roadPath, { x: to.x, y: to.y }];
  const W = Number(map.widthMeters) || 2000, H = W * (640 / 1000);
  let distance = 0;
  for (let i = 0; i < pathPts.length - 1; i++) distance += Math.hypot((pathPts[i + 1].x - pathPts[i].x) * W, (pathPts[i + 1].y - pathPts[i].y) * H);
  return { path: pathPts, distanceMeters: distance };
}
function placeDistanceMeters(map, a, b) {
  const W = Number(map.widthMeters) || 2000, H = W * (640 / 1000);
  return Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
}
function currentPlace() {
  const maps = loadMaps();
  let loc = loadLocation();
  const avatarUrl = fs.existsSync(avatarPath()) ? '/avatar.png?t=' + fs.statSync(avatarPath()).mtimeMs : '/default-avatar.png';
  if (loc.intercity) {
    const now = Date.now();
    const dur = Math.max(1000, Number(loc.durationMs) || 1000);
    const elapsed = now - (Number(loc.startedAt) || now);
    const progress = Math.max(0, Math.min(1, elapsed / dur));
    const tMap = maps.find((m) => m.id === loc.toMapId) || maps[0];
    if (progress >= 1) {
      CONFIG.activeMapId = tMap.id;
      const place = tMap.places[0];
      saveLocation({ mapId: tMap.id, placeId: place.id, since: Date.now(), manual: !!loc.manual });
      try { recordVisit(place.id); } catch {}
      loc = loadLocation();
    } else {
      return {
        mapId: tMap.id, mapName: tMap.name, placeId: loc.toPlaceId, name: tMap.name, icon: '🚉', desc: '', feel: '',
        since: loc.startedAt, minutes: 0, manual: !!loc.manual, reason: '', avatar: avatarUrl,
        intercity: {
          mode: loc.mode, modeLabel: (TRANSPORTS[loc.mode] || TRANSPORTS.rail).label, modeIcon: (TRANSPORTS[loc.mode] || TRANSPORTS.rail).icon,
          fromMapName: loc.fromMapName || '', toMapName: loc.toMapName || tMap.name,
          distanceKm: Number(loc.distanceKm) || 0, progress, etaSec: Math.max(0, Math.round((dur - elapsed) / 1000)),
          durationMs: dur, startedAt: Number(loc.startedAt) || now,
        },
      };
    }
  }
  const map = maps.find((m) => m.id === loc.mapId) || getActiveMap();
  if (loc.toPlaceId) {
    const info = travelInfo(loc, map);
    if (info && info.progress >= 1) {
      const next = finalizeArrival(loc, map);
      CONFIG.location = next; saveConfig();
      loc = loadLocation();
    } else if (info) {
      const target = placeOf(map, loc.toPlaceId);
      return {
        mapId: map.id, mapName: map.name, placeId: loc.placeId, name: target.name, icon: target.icon, desc: target.desc, feel: target.feel,
        since: loc.since, minutes: Math.round((Date.now() - loc.since) / 60000), manual: !!loc.manual, reason: '', avatar: avatarUrl, traveling: info,
      };
    }
  }
  const place = placeOf(map, loc.placeId);
  return {
    mapId: map.id, mapName: map.name, placeId: place.id, name: place.name, icon: place.icon, desc: place.desc || '', feel: place.feel || '',
    since: loc.since, minutes: Math.max(0, Math.round((Date.now() - loc.since) / 60000)), manual: !!loc.manual, reason: '', traveling: null, avatar: avatarUrl,
  };
}
function travelInfo(loc, map) {
  if (!loc.toPlaceId) return null;
  const from = map.places.find((p) => p.id === loc.fromPlaceId);
  const to = map.places.find((p) => p.id === loc.toPlaceId);
  if (!to) return null;
  const now = Date.now();
  const dur = Math.max(1000, Number(loc.durationMs) || 1000);
  const elapsed = now - (Number(loc.startedAt) || now);
  const distance = Number(loc.distanceMeters) || (from ? placeDistanceMeters(map, from, to) : 0);
  return {
    fromId: from ? from.id : '', fromName: from ? from.name : '', toId: to.id, toName: to.name, mode: loc.mode || 'walk',
    modeLabel: (TRANSPORTS[loc.mode] || TRANSPORTS.walk).label, modeIcon: (TRANSPORTS[loc.mode] || TRANSPORTS.walk).icon,
    distanceMeters: Math.round(distance), durationMs: dur, startedAt: Number(loc.startedAt) || now,
    progress: Math.max(0, Math.min(1, elapsed / dur)), etaSec: Math.max(0, Math.round((dur - elapsed) / 1000)),
    path: Array.isArray(loc.path) ? loc.path : [],
  };
}
function finalizeArrival(loc, map) {
  const place = placeOf(map, loc.toPlaceId || loc.placeId);
  try { recordVisit(place.id); } catch {}
  return { mapId: map.id, placeId: place.id, since: Date.now(), manual: !!loc.manual };
}

// ---------- weather ----------
const WEATHERS = {
  sunny: { label: '晴天', icon: '☀️', walk: 1.0, bike: 1.0, note: '天气不错' },
  cloudy: { label: '多云', icon: '☁️', walk: 1.0, bike: 1.0, note: '天有点阴' },
  rain: { label: '下雨', icon: '🌧️', walk: 0.85, bike: 0.5, note: '下雨了' },
  snow: { label: '下雪', icon: '❄️', walk: 0.7, bike: 0.35, note: '下雪了，路滑' },
  hot: { label: '热', icon: '🥵', walk: 0.85, bike: 0.75, note: '太热了' },
  cold: { label: '冷', icon: '🧣', walk: 0.9, bike: 0.8, note: '有点冷' },
  windy: { label: '大风', icon: '💨', walk: 0.9, bike: 0.6, note: '风有点大' },
};
let weatherCache = { at: 0, data: null };
function weatherNow() {
  const m = CONFIG.weatherMode === 'real' ? (weatherCache.data ? weatherCache.data.kind : 'sunny') : (CONFIG.weather || 'sunny');
  return WEATHERS[m] ? m : 'sunny';
}
async function fetchJson(url, timeoutMs = 12000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'dsh-screen-beyond/1.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
async function getGeo(force = false) {
  const geo = CONFIG.geo;
  if (!force && geo && Number.isFinite(Number(geo.lat)) && Date.now() - (Number(geo.at) || 0) < 7 * 86400000) return geo;
  const providers = [
    { url: 'https://ipwho.is/', pick: (d) => (d && d.success && d.latitude ? { lat: d.latitude, lon: d.longitude, city: d.city || '' } : null) },
    { url: 'http://ip-api.com/json/?fields=status,city,regionName,lat,lon', pick: (d) => (d && d.status === 'success' && Number.isFinite(Number(d.lat)) ? { lat: d.lat, lon: d.lon, city: d.city || d.regionName || '' } : null) },
    { url: 'https://ipapi.co/json/', pick: (d) => (d && Number.isFinite(Number(d.latitude)) ? { lat: d.latitude, lon: d.longitude, city: d.city || '' } : null) },
  ];
  for (const p of providers) {
    try { const loc = p.pick(await fetchJson(p.url, 10000)); if (loc) { CONFIG.geo = { ...loc, at: Date.now() }; saveConfig(); return CONFIG.geo; } } catch {}
  }
  return null;
}
function codeToKind(code, temp, wind) {
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 95) return 'rain';
  if (code >= 45 && code <= 48) return 'cloudy';
  if (code >= 1 && code <= 3) return 'cloudy';
  if (temp >= 30) return 'hot';
  if (temp <= 2) return 'cold';
  if (wind >= 30) return 'windy';
  return 'sunny';
}
async function getRealWeather(force = false) {
  if (!force && weatherCache.data && Date.now() - weatherCache.at < 20 * 60 * 1000) return weatherCache.data;
  try {
    const geo = await getGeo();
    if (!geo) throw new Error('no geo');
    const d = await fetchJson('https://api.open-meteo.com/v1/forecast?latitude=' + geo.lat + '&longitude=' + geo.lon + '&current=temperature_2m,weather_code,windspeed_10m&timezone=auto');
    const cur = d.current || {};
    const kind = codeToKind(Number(cur.weather_code) || 0, Number(cur.temperature_2m), Number(cur.windspeed_10m) || 0);
    weatherCache = { at: Date.now(), data: { kind, temp: Number.isFinite(Number(cur.temperature_2m)) ? Math.round(Number(cur.temperature_2m)) : null, city: geo.city || '', source: 'real' } };
    return weatherCache.data;
  } catch {
    weatherCache = { at: Date.now(), data: { kind: CONFIG.weather || 'sunny', temp: null, city: '', source: 'fallback' } };
    return weatherCache.data;
  }
}
function loadWeatherFx() { return CONFIG.weatherFx || {}; }

// ---------- capabilities / energy / routine / visits ----------
const MODE_RULES = { walk: { minAge: 0 }, bike: { minAge: 12 }, bus: {}, metro: {}, coach: {}, rail: {}, plane: {}, car: { minAge: 18, needLicense: true } };
function charCapabilities() {
  const m = loadMeta();
  const ageRaw = Number(m.age);
  const age = ageRaw > 0 && ageRaw < 120 ? ageRaw : null;
  const adult = age === null || age >= 18;
  const license = m.license === true && adult;
  return { age, minor: age !== null && age < 18, adult, license, pref: m.travelPref || 'auto', name: m.name || '' };
}
function currentActivityLabel(now) {
  try {
    const hit = scheduleHint(now || new Date());
    if (hit && hit.label) return hit.label;
    const life = loadLife();
    const acts = (life.activities || []).filter((a) => a.window && isInWindow(a.window, now || new Date()));
    if (acts.length) return acts[0].name;
  } catch {}
  return '';
}
function energyRateFor(label, placeId, hour) {
  const s = String(label || '');
  if (/睡|躺|休息|发呆|看视频|刷|小说|玩手机|听歌|晒太阳|看剧/.test(s)) return placeId === 'home' ? 2.2 : 1.4;
  if (/健身|运动|跑步|骑|球|游泳/.test(s)) return -2.6;
  if (/上课|学习|写作业|工作|上班|图书馆|收拾|打扫|做饭/.test(s)) return -1.6;
  if (/游戏|电影|逛街|唱歌|咖啡|网吧|酒吧|约会/.test(s)) return -0.3;
  if (hour >= 0 && hour < 6 && placeId === 'home') return 2.0;
  if (placeId === 'home') return 1.0;
  if (['cafe', 'library', 'park', 'riverside'].includes(placeId)) return 0.6;
  return 0.2;
}
function loadCharState() {
  const s = readJson(statePath(), {});
  const now = Date.now();
  const updated = Number(s.updatedAt) || now;
  const hours = Math.max(0, Math.min(48, (now - updated) / 3600000));
  let energy = Number.isFinite(Number(s.energy)) ? Number(s.energy) : 82;
  const loc = CONFIG.location || {};
  const traveling = !!loc.toPlaceId || !!loc.intercity;
  if (!traveling) {
    const d = new Date();
    energy += energyRateFor(currentActivityLabel(d), loc.placeId || 'home', d.getHours()) * hours;
  }
  energy = Math.max(0, Math.min(100, energy));
  return { energy: Math.round(energy) };
}
function saveCharState(st) { writeJson(statePath(), { energy: Math.max(0, Math.min(100, Math.round(st.energy))), updatedAt: Date.now() }); }
function drainEnergy(mode, distanceMeters) {
  const st = loadCharState();
  const perKm = { walk: 7, bike: 3.5, bus: 1.4, metro: 1.2, coach: 1.2, rail: 0.8, plane: 2.2, car: 0.6 };
  const wet = weatherNow() === 'rain' || weatherNow() === 'snow';
  const p = (perKm[mode] || 2) * (wet && (mode === 'walk' || mode === 'bike') ? 1.15 : 1);
  st.energy = Math.max(0, Math.round(st.energy - (distanceMeters / 1000) * p));
  saveCharState(st);
  return st.energy;
}
function validateMode(mode, ctx = {}) {
  const caps = charCapabilities();
  const rule = MODE_RULES[mode] || {};
  const label = (TRANSPORTS[mode] || {}).label || mode;
  if (rule.needLicense && !caps.license) {
    if (caps.age !== null && caps.age < 18) return { ok: false, reason: `我${caps.age}岁，还没到能考驾照的年龄呢，${label}不行` };
    return { ok: false, reason: `我没有驾照，${label}不行` };
  }
  if (rule.minAge && caps.age !== null && caps.age < rule.minAge) return { ok: false, reason: `我${caps.age}岁，还不能自己${label}` };
  if ((mode === 'walk' || mode === 'bike') && ctx.distanceMeters) {
    const st = loadCharState();
    if (st.energy < 25 && ctx.distanceMeters > 1500) return { ok: false, reason: '我有点累了，不想走那么远' };
    if (st.energy < 10) return { ok: false, reason: '我走不动了，想在家歇会儿' };
  }
  if (ctx.night && caps.minor && !ctx.confirmNight && ctx.toHome !== true) return { ok: false, needsConfirm: true, reason: '这么晚了，我一个人出门要跟你说一声——你确定让我去吗' };
  return { ok: true };
}
function defaultRoutineBands() {
  return [
    { start: 0, end: 6, allowed: false, weights: { home: 30 } },
    { start: 6, end: 8, allowed: true, weights: { home: 8, canteen: 3, market: 2 } },
    { start: 8, end: 12, allowed: true, weights: { school: 7, library: 4, home: 1, cafe: 1 } },
    { start: 12, end: 14, allowed: true, weights: { canteen: 7, home: 4, market: 1 } },
    { start: 14, end: 17.5, allowed: true, weights: { school: 6, library: 4, cafe: 2, park: 1, home: 1 } },
    { start: 17.5, end: 19.5, allowed: true, weights: { canteen: 6, home: 5, market: 1 } },
    { start: 19.5, end: 22, allowed: true, weights: { home: 6, park: 3, cafe: 2, market: 1, library: 1 } },
    { start: 22, end: 24, allowed: true, weights: { home: 20, canteen: 1 } },
  ];
}
function loadRoutine() { const r = readJson(routinePath(), null); if (r && Array.isArray(r.bands) && r.bands.length) return { bands: r.bands, smart: r.smart === true }; return { bands: defaultRoutineBands(), smart: false }; }
function saveRoutine(routine) {
  const bands = (routine.bands || []).slice(0, 16).map((b) => ({
    start: Math.max(0, Math.min(24, Number(b.start) || 0)), end: Math.max(0, Math.min(24, Number(b.end) || 24)),
    allowed: b.allowed !== false,
    weights: Object.fromEntries(Object.entries(b.weights || {}).map(([k, v]) => [String(k), Math.max(0, Math.min(100, Number(v) || 0))]).filter(([, v]) => v > 0)),
  })).sort((a, b) => a.start - b.start);
  writeJson(routinePath(), { bands, smart: routine.smart === true });
  return { bands, smart: routine.smart === true };
}
function bandForHour(bands, hour) { for (const b of bands) { if (b.start <= b.end) { if (hour >= b.start && hour < b.end) return b; } else { if (hour >= b.start || hour < b.end) return b; } } return null; }
function loadVisits() { return readJson(visitsPath(), {}); }
function recordVisit(placeId) { const v = loadVisits(); const now = Date.now(); const cur = v[placeId] || { count: 0, lastAt: 0 }; v[placeId] = { count: (cur.count || 0) + 1, lastAt: now }; writeJson(visitsPath(), v); }
function scheduleHint(now) {
  const life = loadLife();
  for (const s of life.schedules || []) if (scheduleHitsNow(s, now)) return { label: s.label, place: s.place || guessPlaceId(s.label) };
  return null;
}
function scheduleHitsNow(s, now) {
  const m = String(s.time || '').match(/(\d{1,2}:\d{2})\s*(?:-\s*(\d{1,2}:\d{2}))?/);
  if (!m) return false;
  const cur = now.getHours() * 60 + now.getMinutes();
  const toMin = (x) => { const [h, mi] = x.split(':').map(Number); return h * 60 + mi; };
  if (!m[2]) return cur >= toMin(m[1]) && cur < toMin(m[1]) + 30;
  const a = toMin(m[1]), b = toMin(m[2]);
  return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
}
function guessPlaceId(s) {
  const x = String(s || '');
  if (/家|回家|睡|起床|洗漱/.test(x)) return 'home';
  if (/学校|上课|课|放学/.test(x)) return 'school';
  if (/图书馆|自习|写作业|学习/.test(x)) return 'library';
  if (/咖啡/.test(x)) return 'cafe';
  if (/公园|散步|运动/.test(x)) return 'park';
  if (/超市|买|购物|菜/.test(x)) return 'market';
  if (/饭|吃/.test(x)) return 'canteen';
  if (/电影/.test(x)) return 'cinema';
  return 'home';
}
function isInWindow(win, now) {
  const m = String(win).match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!m) return false;
  const toMin = (x) => { const [h, mi] = x.split(':').map(Number); return h * 60 + mi; };
  const cur = now.getHours() * 60 + now.getMinutes();
  const a = toMin(m[1]), b = toMin(m[2]);
  return a <= b ? (cur >= a && cur <= b) : (cur >= a || cur <= b);
}
function pickTransport(mapMode, distanceMeters) {
  const caps = charCapabilities();
  const w = WEATHERS[weatherNow()] || WEATHERS.sunny;
  const st = loadCharState();
  const badWeather = w.label === '下雨' || w.label === '下雪';
  const canBike = !badWeather && !(st.energy < 20);
  if (mapMode && mapMode !== 'auto' && TRANSPORTS[mapMode]) {
    if (mapMode === 'car' && !caps.license) return 'metro';
    if (mapMode === 'bike' && !canBike) return 'bus';
    return mapMode;
  }
  if (distanceMeters < 800) return st.energy < 20 ? 'bus' : 'walk';
  if (distanceMeters < 2500) { if (!canBike || st.energy < 35) return 'bus'; return Math.random() < 0.6 ? 'bike' : 'bus'; }
  if (distanceMeters < 6000) return Math.random() < 0.5 ? 'bus' : 'metro';
  return caps.license ? 'car' : (Math.random() < 0.5 ? 'metro' : 'bus');
}

// ---------- economy ----------
const ECONOMY_DEFAULT = {
  enabled: true, initialBalance: 200, dailyIncome: 20, wagePerHour: 15, mealCost: 12, entertainmentCost: 30,
  moneyType: 'virtual', tokenMode: false, tokenBudget: 2000000, tokensPerYuan: 1000,
  transportBase: { walk: 0, bike: 0, bus: 2, metro: 2, car: 10, coach: 15, rail: 30, plane: 80 },
  transportPerKm: { walk: 0, bike: 0, bus: 0.6, metro: 0.6, car: 1.2, coach: 0.8, rail: 0.5, plane: 0.6 },
};
function loadEconomy() {
  const e = CONFIG.economy || {};
  const moneyType = e.moneyType === 'token' || e.tokenMode === true ? 'token' : 'virtual';
  return { ...ECONOMY_DEFAULT, ...e, moneyType, transportBase: { ...ECONOMY_DEFAULT.transportBase, ...(e.transportBase || {}) }, transportPerKm: { ...ECONOMY_DEFAULT.transportPerKm, ...(e.transportPerKm || {}) } };
}
function saveEconomy(e) { CONFIG.economy = e; saveConfig(); try { DATA.track('economy', ACTIVE_CHAR, null, e); } catch {} try { SYNC.record('economy.set', 'economy', ACTIVE_CHAR, e); } catch {} return e; }
function readWalletRaw() { return readJson(walletPath(), {}); }
function writeWalletRaw(w) { writeJson(walletPath(), w); }
function loadWallet() {
  const econ = loadEconomy();
  const raw = readWalletRaw();
  const now = Date.now();
  let balance = Number.isFinite(Number(raw.balance)) ? Number(raw.balance) : econ.initialBalance;
  const usedTokens = Number(raw.usedTokens) || 0;
  let changed = !Number.isFinite(Number(raw.balance));
  const lastIncomeAt = Number(raw.lastIncomeAt) || 0;
  if (econ.enabled && now - lastIncomeAt >= 86400000) { balance += Number(econ.dailyIncome) || 0; changed = true; lastIncomeAt = now; }
  let lastWageAt = Number(raw.lastWageAt) || now;
  try {
    const label = currentActivityLabel(new Date());
    if (econ.enabled && /工作|上班|打工|值班/.test(label)) {
      const hrs = Math.max(0, (now - lastWageAt) / 3600000);
      if (hrs >= 0.5) { balance += Math.round(hrs * (Number(econ.wagePerHour) || 0)); changed = true; lastWageAt = now; }
    } else lastWageAt = now;
  } catch {}
  if (changed) writeWalletRaw({ ...raw, balance, usedTokens, lastIncomeAt, lastWageAt });
  return { balance, usedTokens, lastIncomeAt, lastWageAt };
}
function walletMoney() {
  const econ = loadEconomy(); const w = loadWallet();
  const remainingTokens = Math.max(0, Number(econ.tokenBudget) - (Number(w.usedTokens) || 0));
  const tokenMode = econ.moneyType === 'token';
  const realRmb = (REAL_BALANCE && REAL_BALANCE.ok && Number.isFinite(Number(REAL_BALANCE.total))) ? Math.max(0, Number(REAL_BALANCE.total)) : null;
  // 实时 token 模式：真实人民币是“用户的钱”，她自己的花销仍走虚拟钱包
  const spendable = Math.max(0, Math.round(w.balance));
  return { econ, wallet: w, spendable, remainingTokens, tokenMode, moneyType: econ.moneyType, realRmb, realBalanceKnown: realRmb !== null };
}
function spendMoney(amount, why = '') {
  const econ = loadEconomy(); const amt = Math.round(Number(amount) || 0);
  if (!econ.enabled || amt <= 0) return { ok: true, left: walletMoney().spendable };
  const st = walletMoney();
  if (st.spendable < amt) {
    return { ok: false, reason: `钱不够了：还差 ${amt - st.spendable} 块`, left: st.spendable };
  }
  const raw = readWalletRaw();
  const balance = (Number.isFinite(Number(raw.balance)) ? Number(raw.balance) : econ.initialBalance) - amt;
  writeWalletRaw({ ...raw, balance: Math.max(0, balance), lastIncomeAt: raw.lastIncomeAt || Date.now() });
  return { ok: true, left: Math.max(0, balance), why };
}
function earnMoney(amount) {
  const econ = loadEconomy(); const raw = readWalletRaw();
  const balance = (Number.isFinite(Number(raw.balance)) ? Number(raw.balance) : econ.initialBalance) + Math.round(Number(amount) || 0);
  writeWalletRaw({ ...raw, balance }); return balance;
}
function recordUsageTokens(usage) {
  if (!usage) return;
  const total = (Number(usage.prompt_tokens) || 0) + (Number(usage.completion_tokens) || 0);
  if (total <= 0) return;
  const raw = readWalletRaw();
  const date = todayStr();
  const prevDaily = raw.dailyDate === date ? (Number(raw.dailyUsed) || 0) : 0;
  writeWalletRaw({ ...raw, usedTokens: (Number(raw.usedTokens) || 0) + total, dailyDate: date, dailyUsed: prevDaily + total });
}
let REAL_BALANCE = { ok: false, at: 0, error: '还没查', currency: 'CNY', total: null, granted: null, toppedUp: null, available: null };
async function refreshRealBalance() {
  const now = Date.now();
  if (REAL_BALANCE.at && now - REAL_BALANCE.at < 60000) return REAL_BALANCE;
  try {
    const res = await fetch('https://api.deepseek.com/user/balance', {
      headers: { authorization: 'Bearer ' + apiKey() },
      signal: AbortSignal.timeout(15000),
    });
    const txt = await res.text();
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 120));
    const j = JSON.parse(txt);
    const info = (j.balance_infos && j.balance_infos[0]) || {};
    const total = Number(info.total_balance) || 0;
    const date = todayStr();
    const day = CONFIG.balanceDay;
    if (!day || day.date !== date) {
      CONFIG.balanceDay = { date, start: total, last: total };
    } else {
      // 充值会让余额变大；把增加部分加进起点，避免“今日消耗”变负数
      if (total > Number(day.last) + 0.001) day.start = Number(day.start) + (total - Number(day.last));
      day.last = total;
    }
    saveConfig();
    const todayRmb = Math.max(0, Number(CONFIG.balanceDay.start || total) - total);
    REAL_BALANCE = {
      ok: true, at: now, error: '',
      currency: info.currency || 'CNY',
      total,
      todayRmb: Math.round(todayRmb * 100) / 100,
      granted: Number(info.granted_balance) || 0,
      toppedUp: Number(info.topped_up_balance) || 0,
      available: !!j.is_available,
    };
  } catch (e) {
    REAL_BALANCE = { ok: false, at: now, error: String(e.message || e).slice(0, 160), currency: 'CNY', total: null, granted: null, toppedUp: null, available: null };
  }
  return REAL_BALANCE;
}
function tokenStats() {
  const m = walletMoney();
  const raw = readWalletRaw();
  const today = todayStr();
  return {
    remainingTokens: m.remainingTokens,
    usedTokens: Number(raw.usedTokens) || 0,
    dailyUsed: raw.dailyDate === today ? (Number(raw.dailyUsed) || 0) : 0,
    tokenBudget: Number(m.econ.tokenBudget) || 0,
    moneyType: m.moneyType,
    tokenMode: m.tokenMode,
    spendable: m.spendable,
    balance: m.wallet.balance,
    date: today,
    deepseekBalance: REAL_BALANCE,
    realRmb: m.realRmb,
    realBalanceKnown: m.realBalanceKnown,
  };
}
const CHAT_STYLE_DEFAULT = { noParens: false };
function loadChatStyle() { return { ...CHAT_STYLE_DEFAULT, ...(CONFIG.chatStyle || {}) }; }
function saveChatStyle(x) { CONFIG.chatStyle = { ...loadChatStyle(), ...(x || {}) }; saveConfig(); return CONFIG.chatStyle; }
function stripParens(text) {
  let s = String(text || '');
  s = s.replace(/（[^）]*）/g, '')
       .replace(/\([^)]*\)/g, '')
       .replace(/【[^】]*】/g, '')
       .replace(/\[[^\]]*\]/g, '')
       .replace(/[*＊][^*＊]*[*＊]/g, '');
  s = s.replace(/[ \t]{2,}/g, ' ').replace(/^[，,。.、；;：:\s]+/, '').replace(/[，,、；;：:\s]+$/, '');
  return s.trim();
}
function herText(text) {
  const s = String(text || '');
  try { if (loadChatStyle().noParens) return stripParens(s) || '……'; } catch {}
  return s;
}
function transportFare(mode, meters) {
  const econ = loadEconomy();
  const base = Number(econ.transportBase[mode]) || 0;
  const perKm = Number(econ.transportPerKm[mode]) || 0;
  return Math.round((base + perKm * (Math.max(0, Number(meters) || 0) / 1000)) * 10) / 10;
}

// ---------- move ----------
function moveTo(placeId, opts = {}) {
  const maps = loadMaps();
  const map = maps.find((m) => m.id === (opts.mapId || activeMapId())) || getActiveMap();
  const target = map.places.find((p) => p.id === placeId);
  if (!target) return currentPlace();
  CONFIG.activeMapId = map.id; saveConfig();
  const cur = currentPlace();
  const fromPlace = map.places.find((p) => p.id === (cur.traveling ? cur.traveling.fromId : cur.placeId)) || target;
  const distance = placeDistanceMeters(map, fromPlace, target);
  const hour = new Date().getHours();
  const night = hour >= 22 || hour < 6;
  if (opts.instant || fromPlace.id === target.id) {
    try { recordVisit(target.id); } catch {}
    saveLocation({ mapId: map.id, placeId: target.id, since: Date.now(), manual: opts.manual !== false });
    return currentPlace();
  }
  const ctx = { distanceMeters: distance, night, confirmNight: !!opts.confirmNight, toHome: target.id === 'home' };
  if (opts.mode && TRANSPORTS[opts.mode]) {
    const verdict = validateMode(opts.mode, ctx);
    if (!verdict.ok) return { refused: true, reason: verdict.reason, needsConfirm: !!verdict.needsConfirm };
  } else {
    const nv = validateMode('walk', ctx);
    if (!nv.ok && nv.needsConfirm) return { refused: true, reason: nv.reason, needsConfirm: true };
  }
  const route = routeOnRoads(map, fromPlace, target);
  const realDistance = route.distanceMeters || distance;
  let mode = opts.mode && TRANSPORTS[opts.mode] ? opts.mode : pickTransport(map.transport, realDistance);
  let fare = transportFare(mode, realDistance);
  if (fare > 0) {
    const aff = walletMoney();
    if (aff.spendable < fare) {
      if (opts.mode) return { refused: true, reason: `钱不太够了：坐${(TRANSPORTS[mode] || {}).label}要 ${fare} 块，我现在只剩 ${aff.spendable} 块` };
      fare = 0; mode = 'walk';
    }
  }
  if (!opts.mode) {
    try { const stt = walletMoney(); if (stt.tokenMode && fare > 0 && fare > Math.max(1, stt.spendable * 0.05)) { fare = 0; mode = 'walk'; } } catch {}
  }
  const wNow = WEATHERS[weatherNow()] || WEATHERS.sunny;
  const weatherFactor = (mode === 'walk' || mode === 'bike') && Number(wNow[mode]) > 0 ? Number(wNow[mode]) : 1;
  const speed = (TRANSPORTS[mode] || TRANSPORTS.walk).speed * weatherFactor;
  const durationMs = Math.max(2000, Math.round((realDistance / Math.max(0.1, speed)) * 1000));
  const energyAfter = drainEnergy(mode, realDistance);
  if (night && target.id !== 'home') {
    try {
      const caps = charCapabilities();
      const line = (caps.minor ? '（报备）这么晚了，我出门去' : '（报备）我出门去') + target.name + '，到了跟你说一声。';
      const last = [...messages].reverse().find((m) => m.role === 'her' && typeof m.text === 'string' && m.text.startsWith('（报备）'));
      const recent = last && Date.now() - (Number(last.at) || 0) < 10 * 60 * 1000;
      if (!opts.noReport && !(recent && last.text === line)) addMessage('her', line);
    } catch {}
  }
  if (fare > 0) { try { spendMoney(fare, '交通'); } catch {} }
  saveLocation({
    mapId: map.id, fromPlaceId: fromPlace.id, toPlaceId: target.id, fromName: fromPlace.name,
    startedAt: Date.now(), durationMs, mode, distanceMeters: Math.round(realDistance),
    path: route.path, placeId: target.id, since: Date.now(), manual: opts.manual !== false, energyAfter,
  });
  return currentPlace();
}
function intercityDistanceKm(a, b) {
  const seed = (String(a.id) + String(b.id)).split('').reduce((s, c) => s + c.charCodeAt(0), 0);
  return 180 + (seed * 37) % 620;
}
function pickIntercityMode(km) {
  if (km < 250) return Math.random() < 0.7 ? 'coach' : 'rail';
  if (km < 600) return Math.random() < 0.7 ? 'rail' : 'coach';
  return 'plane';
}
function travelSchedule(mode) {
  const interval = mode === 'coach' ? 30 : (mode === 'rail' ? 60 : 120);
  const now = new Date();
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  const m = next.getMinutes();
  next.setMinutes(Math.ceil((m + 1) / interval) * interval);
  if (next.getTime() <= now.getTime()) next.setMinutes(next.getMinutes() + interval);
  const waitMinutes = Math.max(1, Math.round((next.getTime() - now.getTime()) / 60000));
  const roll = Math.random();
  const delayMinutes = roll < 0.2 ? (5 + Math.floor(Math.random() * 25)) : 0;
  return { departAt: next.getTime(), waitMinutes, delayMinutes, label: (mode === 'coach' ? '长途汽车' : mode === 'rail' ? '高铁' : '飞机') };
}
function moveToMap(targetMapId, opts = {}) {
  const maps = loadMaps();
  const target = maps.find((m) => m.id === targetMapId);
  if (!target) return currentPlace();
  const from = getActiveMap();
  if (from.id === target.id) return currentPlace();
  {
    const caps = charCapabilities();
    const hour = new Date().getHours();
    const night = hour >= 22 || hour < 6;
    if (night && caps.minor && !opts.confirmNight) return { refused: true, needsConfirm: true, reason: '这么晚还要去别的城市？我得先跟你说一声——确定让我去吗' };
    if (!opts.noReport) { const extra = Math.round((Number(opts.extraDelayMs) || 0) / 60000); try { addMessage('her', `（报备）我坐${(TRANSPORTS[opts.mode] || TRANSPORTS.rail).label}去${target.name}${extra ? '，班次要等/晚点约 ' + extra + ' 分钟' : ''}，到了跟你说。`); } catch {} }
  }
  const km = intercityDistanceKm(from, target);
  let mode = opts.mode && ['coach', 'rail', 'plane'].includes(opts.mode) ? opts.mode : pickIntercityMode(km);
  const fare = transportFare(mode, km * 1000);
  if (fare > 0) {
    const aff = walletMoney();
    if (aff.spendable < fare && !opts.instant) return { refused: true, reason: `去${target.name}的${(TRANSPORTS[mode] || {}).label}票要 ${fare} 块，我只有 ${aff.spendable} 块，买不起` };
    if (!opts.instant) { try { spendMoney(fare, '跨城车票'); } catch {} }
  }
  const speed = (TRANSPORTS[mode] || TRANSPORTS.rail).speed;
  const extraDelayMs = Math.max(0, Number(opts.extraDelayMs) || 0);
  const durationMs = opts.instant ? 1000 : Math.max(2000, Math.round((km * 1000) / speed * 1000) + extraDelayMs);
  if (opts.instant) {
    CONFIG.activeMapId = target.id;
    saveLocation({ mapId: target.id, placeId: target.places[0].id, since: Date.now(), manual: true });
    saveConfig();
    return currentPlace();
  }
  saveLocation({
    mapId: from.id, placeId: CONFIG.location && CONFIG.location.placeId || 'home',
    intercity: true, fromMapId: from.id, toMapId: target.id, fromMapName: from.name, toMapName: target.name,
    mode, distanceKm: km, startedAt: Date.now(), durationMs, manual: opts.manual !== false,
  });
  return currentPlace();
}

// ---------- auto wander / life tick ----------
function smartWeightFactor(p, baseW) {
  const routine = loadRoutine();
  if (!routine.smart) return baseW;
  let w = baseW;
  const st = loadCharState();
  const weather = weatherNow();
  const outdoor = p.id === 'park' || p.id === 'market' || p.id === 'nightmarket';
  const v = loadVisits()[p.id];
  if (v && v.lastAt) { const days = (Date.now() - v.lastAt) / 86400000; w *= 1 + Math.min(0.8, (v.count || 0) * 0.12) * Math.max(0, 1 - days / 7); }
  else w *= 1.1;
  if (weather === 'rain' || weather === 'snow') w *= outdoor ? 0.4 : 1.25;
  if (weather === 'hot') w *= outdoor ? 0.6 : 1.1;
  if (weather === 'cold' || weather === 'windy') w *= outdoor ? 0.75 : 1.05;
  if (st.energy < 35) w *= p.id === 'home' ? 1.8 : (outdoor ? 0.6 : 1);
  const feel = p.feel || '';
  if (/烦|累|吵|不想|贵/.test(feel)) w *= st.energy < 50 ? 0.7 : 0.9;
  if (/舒服|放松|喜欢|安静|香|好/.test(feel)) w *= 1.15;
  try { if (MEM.facts.filter((f) => !f.archived).some((f) => String(f.text || '').includes(p.name))) w *= 1.3; } catch {}
  return Math.max(0, w);
}
function autoWanderMaybe(force = false) {
  const life = loadLife();
  if (life.locationFree === false) return currentPlace();
  const cur = currentPlace();
  if (cur.traveling || cur.intercity) return cur;
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const map = getActiveMap();
  const routine = loadRoutine();
  const band = bandForHour(routine.bands, hour) || { allowed: true, weights: {} };
  if (band.allowed === false) { if (cur.placeId === 'home') return cur; return moveTo('home', { manual: false, confirmNight: true }); }
  if (!force) { if (cur.minutes < 40) return cur; if (Math.random() > 0.35) return cur; }
  const sched = scheduleHint(now);
  const st = loadCharState();
  const weights = map.places.map((p) => {
    let w = band.weights[p.id] !== undefined ? band.weights[p.id] : 0;
    if (sched && sched.place === p.id) w *= 1.8;
    if (p.id === cur.placeId) w *= 0.25;
    w = smartWeightFactor(p, w);
    if (loadLife().smartLife) {
      const kind = weatherNow();
      if (p.id === 'park' || p.id === 'market') { if (kind === 'rain' || kind === 'snow') w *= 0.35; else if (kind === 'hot' || kind === 'cold' || kind === 'windy') w *= 0.7; }
      if (st.energy < 20 && p.id !== 'home') w *= 0.5;
      if (st.energy < 20 && p.id === 'home') w *= 1.8;
    }
    try { const m = walletMoney(); if (m.econ.enabled && m.spendable < m.econ.entertainmentCost && ['cinema', 'netcafe', 'mall', 'nightmarket'].includes(p.id)) w *= 0.3; } catch {}
    return Math.max(0, w);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return cur;
  let r = Math.random() * total;
  let next = map.places[0];
  for (let i = 0; i < map.places.length; i++) { r -= weights[i]; if (r <= 0) { next = map.places[i]; break; } }
  if (next.id === cur.placeId) return cur;
  return moveTo(next.id, { manual: false, confirmNight: true });
}

// ---------- LLM ----------
let typing = false, busy = false, lastTurnAt = 0, lastUsage = null;
const streamClients = new Set();
const streamState = { active: false, text: '' };
function broadcast(obj) { for (const res of streamClients) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch {} } }
async function streamText(text) {
  streamState.active = true; streamState.text = '';
  broadcast({ type: 'start' });
  const s = herText(text);
  for (let i = 0; i < s.length; i += 3) {
    streamState.text += s.slice(i, i + 3);
    broadcast({ type: 'delta', text: s.slice(i, i + 3) });
    await new Promise((r) => setTimeout(r, 14));
  }
  broadcast({ type: 'done' });
  streamState.active = false; streamState.text = '';
}
function apiKey() {
  const direct = process.env.DEEPSEEK_API_KEY;
  if (direct) return direct;
  // 插件设置里自己保存的 key 优先于 DSH 其它插件留下的 key：
  // 用户在本插件设置里填了新 key，却被 ~/.dsh 下的旧 key 覆盖，是真实踩过的坑。
  const files = [path.join(ROOT, 'api-key.txt'), path.join(HOME, '.dsh', 'desktop', 'deepseek-api-key'), path.join(HOME, '.dsh', 'llm-deepseek', 'api-key'), path.join(HOME, '.dsh', 'deepseek-api-key')];
  for (const f of files) { try { const s = fs.readFileSync(f, 'utf8').trim(); if (s) return s; } catch {} }
  try { const y = fs.readFileSync(path.join(HOME, '.dsh', '.credentials.yaml'), 'utf8'); const m = y.match(/(?:deepseek[_-]?api[_-]?key|DEEPSEEK_API_KEY)\s*:\s*(\S+)/i); if (m) return m[1].trim(); } catch {}
  throw new Error('没有找到 DeepSeek API Key');
}
async function chatCompletion(body) {
  const m = loadModelCfg();
  const payload = { ...body, model: body.model || m.name };
  if (payload.reasoning_effort === undefined) payload.reasoning_effort = m.reasoningEffort;
  if (payload.max_tokens === undefined) payload.max_tokens = m.maxTokens;
  if (payload.temperature === undefined) payload.temperature = m.temperature;
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + apiKey(), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 401) throw new Error('DeepSeek API Key 无效（401）。请到「设置 → 模型 → API Key」重新填写 DeepSeek 开放平台的 key，并确认本插件设置里的 key 已保存；如果你刚从别的插件继承过 key，也要检查旧 key 是否还有效。');
    throw new Error('deepseek HTTP ' + res.status + ': ' + text.slice(0, 300));
  }
  const j = JSON.parse(text);
  return j;
}

// ---------- 外部执行环境：pc / space / phone ----------
const BUNDLED_ENV_DIR = path.join(RUNTIME_DIR, 'env');
const ENV_DEFAULT_DIR = (() => {
  const external = process.env.DSH_COMPANION_ENV || 'D:\\dsh-env';
  try { if (fs.existsSync(path.join(external, 'space_ctl.py'))) return external; } catch {}
  return BUNDLED_ENV_DIR;
})();
const VBOX = process.env.DSH_COMPANION_VBOX || 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe';
let ENV_DIR = process.env.DSH_COMPANION_ENV ? process.env.DSH_COMPANION_ENV : (CONFIG.envDir ? String(CONFIG.envDir) : ENV_DEFAULT_DIR);
ENV_DIR = path.resolve(String(ENV_DIR || ENV_DEFAULT_DIR));
let ENV_PY = process.env.DSH_COMPANION_PY ? process.env.DSH_COMPANION_PY : path.join(ENV_DIR, 'venv-tools', 'Scripts', 'python.exe');
// 如果 D:\dsh-env 不存在，尝试用随包附带的 env 目录
try {
  if (!fs.existsSync(path.join(ENV_DIR, 'space_ctl.py'))) {
    const bundled = path.join(RUNTIME_DIR, 'env');
    if (fs.existsSync(path.join(bundled, 'space_ctl.py'))) ENV_DIR = bundled;
  }
} catch {}
try {
  if (!fs.existsSync(ENV_PY)) {
    const pyCands = [
      process.env.DSH_COMPANION_PY,
      path.join(ENV_DIR, 'venv-tools', 'Scripts', 'python.exe'),
      path.join(RUNTIME_DIR, 'env', 'venv-tools', 'Scripts', 'python.exe'),
      'python',
    ];
    for (const c of pyCands) {
      if (!c) continue;
      if (c === 'python' || fs.existsSync(c)) { ENV_PY = c; break; }
    }
  }
} catch {}
const KERNEL_STATE = path.join(HOME, '.dsh', 'desktop', 'kernel-state.json');
function pluginRootDir() { return path.resolve(RUNTIME_DIR, '..'); }
function backupScriptPath() {
  const cands = [
    process.env.DSH_COMPANION_BACKUP,
    path.join(pluginRootDir(), 'scripts', 'backup.ps1'),
  ];
  for (const c of cands) { if (c && fs.existsSync(c)) return c; }
  return null;
}
async function runBackup() {
  const script = backupScriptPath();
  if (!script) return { ok: false, error: '找不到 scripts/backup.ps1（安装包缺少 scripts 目录）' };
  try {
    const { execFile } = await import('node:child_process');
    const outRoot = path.join(ROOT, 'backups');
    const result = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-PluginDir', pluginRootDir(), '-DataRoot', ROOT, '-OutRoot', outRoot],
        { timeout: 300000, windowsHide: true }, (e, out) => resolve({ e, out: String(out || '') }));
    });
    const m = result.out.match(/backup-\d{8}-\d{6}/);
    const madeDir = m ? fs.existsSync(path.join(outRoot, m[0])) : false;
    console.log('[companion] backup:', madeDir ? m[0] : (result.e ? 'failed' : 'no output dir'));
    if (!madeDir) return { ok: false, error: result.e ? String(result.e.message || result.e) : '备份脚本没有产出备份目录（检查 PowerShell 权限/磁盘空间）', outRoot };
    return { ok: true, outRoot, name: m[0] };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}
function probeTcp(port, timeout = 800) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); });
    s.setTimeout(timeout); s.on('timeout', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false));
  });
}
function energyWord(e) {
  const n = Number(e) || 0;
  if (n >= 80) return '精力很足';
  if (n >= 55) return '状态不错';
  if (n >= 35) return '有点累';
  if (n >= 20) return '挺累的';
  return '快撑不住了';
}
let memCache = { at: 0, freeMB: 99999 };
function freeMemMB() {
  return new Promise((resolve) => {
    if (Date.now() - memCache.at < 5000) { resolve(memCache.freeMB); return; }
    import('node:child_process').then(({ execFile }) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', '[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1024)'], { timeout: 8000, windowsHide: true }, (e, out) => {
        const v = Number(String(out || '').trim());
        if (Number.isFinite(v) && v > 0) { memCache = { at: Date.now(), freeMB: v }; resolve(v); } else resolve(99999);
      });
    }).catch(() => resolve(99999));
  });
}
function adbExe() {
  const cands = [
    process.env.DSH_COMPANION_ADB,
    path.join(ENV_DIR, 'android-sdk', 'platform-tools', 'adb.exe'),
    path.join(RUNTIME_DIR, 'env', 'android-sdk', 'platform-tools', 'adb.exe'),
  ];
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return 'adb';
}
function runAdb(args, timeout = 30000) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      try {
        execFile(adbExe(), args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (e, out, err) => resolve({ ok: !e, out: String((out || '') + (err || '')) }));
      } catch (e) { resolve({ ok: false, out: String(e.message) }); }
    }).catch((e) => resolve({ ok: false, out: String(e.message) }));
  });
}
function adbDevicePresent() {
  return new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      runAdb(['devices'], 8000).then((r) => resolve(r.out.includes('\tdevice')));
    }).catch(() => resolve(false));
  });
}
let resourcesCache = { at: 0, data: null };
async function resourcesInfo() {
  if (resourcesCache.data && Date.now() - resourcesCache.at < 8000) return resourcesCache.data;
  const space = await vmRunningNow();
  const phone = await adbDevicePresent();
  let mem = [];
  try {
    const { execFile } = await import('node:child_process');
    const out = await new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-Command', "Get-Process VBoxHeadless,emulator,qemu-system-x86_64 -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName + ':' + [math]::Round($_.WorkingSet64/1MB) }"], { timeout: 8000, windowsHide: true }, (e, o) => resolve(String(o || '').trim()));
    });
    mem = out.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  } catch {}
  const data = { space, phone, mem };
  resourcesCache = { at: Date.now(), data };
  return data;
}
async function vmRunningNow() {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise((resolve) => {
      execFile(VBOX, ['list', 'runningvms'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(!e && String(out || '').includes('DSH-Space')));
    });
  } catch { return false; }
}
function kernelState() { try { return JSON.parse(fs.readFileSync(KERNEL_STATE, 'utf8')); } catch { return null; } }
function kernelBase() { const s = kernelState(); if (!s || !s.port) throw new Error('桌面内核没在运行'); return 'http://127.0.0.1:' + s.port + '/api/dsh'; }
function kernelOwner() { return createHash('sha256').update('dsh-screen-beyond:' + String(ACTIVE_CHAR || 'default')).digest('hex'); }
async function kernelCall(p, body) {
  const st = kernelState();
  if (!st || !st.token) throw new Error('桌面内核没在运行（缺少 kernel-state.json）');
  const url = 'http://127.0.0.1:' + st.port + '/api/dsh' + p;
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: 'Bearer ' + st.token, 'x-dsh-owner': kernelOwner(), 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error('桌面内核 HTTP ' + res.status + ': ' + txt.slice(0, 200));
  try { return JSON.parse(txt); } catch { return { text: txt }; }
}
function runPy(script, args, timeoutMs = 180000) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      const safeArgs = args.filter((a) => a !== undefined && a !== null).map(String);
      execFile(ENV_PY, [path.join(ENV_DIR, script), ...safeArgs], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, out: String((stdout || '') + (stderr || '')).slice(0, 32000), err: err ? String(err.message).slice(0, 300) : '' });
      });
    }).catch((e) => resolve({ ok: false, out: '', err: String(e.message) }));
  });
}
const VM_CHAT = createVmChat({
  runPy: (script, args, timeoutMs) => runPy(script, args, timeoutMs),
  probeTcp: (port) => probeTcp(port),
  chatCompletion: (body) => chatCompletion(body),
  getSettings: () => (CONFIG.vmChat || {}),
  saveSettings: (patch) => { CONFIG.vmChat = { ...(CONFIG.vmChat || {}), ...(patch || {}) }; saveConfig(); },
  getCharacter: () => { const m = loadMeta(); return { name: m.name || '她', relation: m.relation || '' }; },
  dataRoot: ROOT,
  log: (x) => { try { console.error('[vm-chat]', x); } catch {} },
});
const UI_THEMES = [
  { id: 'warm', name: '暖光', colors: ['#f6d4bc', '#f7f2eb', '#5b8fce'] },
  { id: 'mint', name: '薄荷', colors: ['#bfe8d8', '#eefaf4', '#4f9f8a'] },
  { id: 'sakura', name: '樱花', colors: ['#f4c9d8', '#fff4f7', '#d77a9b'] },
  { id: 'ocean', name: '海盐', colors: ['#bfe0f5', '#eef8ff', '#4b8fc7'] },
  { id: 'lavender', name: '薰衣草', colors: ['#d8cdf7', '#f5f1ff', '#8877c9'] },
  { id: 'midnight', name: '深海夜', colors: ['#26384f', '#0f1724', '#6fa8dc'] },
  { id: 'forest', name: '护眼绿', colors: ['#2c4438', '#111a16', '#72b08d'] },
  { id: 'sepia', name: '暖褐', colors: ['#4a3a2a', '#1c1712', '#c49a62'] },
];
function uiThemeCurrent() {
  const id = String(CONFIG.uiTheme || 'warm');
  return UI_THEMES.some((x) => x.id === id) ? id : 'warm';
}
const CHAT_BACKGROUNDS = [
  { id: 'sunset', name: '黄昏', file: 'chat-bg-sunset.jpg' },
  { id: 'mint', name: '薄荷清晨', file: 'chat-bg-mint.jpg' },
  { id: 'dusk', name: '暮色', file: 'chat-bg-dusk.jpg' },
  { id: 'mist', name: '雾白', file: 'chat-bg.jpg' },
];
function chatBgCustomPath() {
  for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
    const p = path.join(ROOT, 'data', 'chat-bg-custom.' + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function chatBgCustomUrl() {
  const p = chatBgCustomPath();
  if (!p) return null;
  try { return '/api/chat-bg/custom?t=' + Math.floor(fs.statSync(p).mtimeMs); } catch { return '/api/chat-bg/custom'; }
}
function chatBgCurrent() {
  const id = String(CONFIG.chatBackground || 'sunset');
  if (id === 'custom' && chatBgCustomPath()) return 'custom';
  return CHAT_BACKGROUNDS.some((x) => x.id === id) ? id : 'sunset';
}
function chatBgOptions() {
  const opts = CHAT_BACKGROUNDS.map((x) => ({ id: x.id, name: x.name, url: '/chat-bg/' + x.id + '.jpg' }));
  const cu = chatBgCustomUrl();
  if (cu) opts.push({ id: 'custom', name: '自定义', url: cu });
  return opts;
}
function toolImage(p, mime) {
  try {
    const b = fs.readFileSync(p);
    if (b.length > 4 * 1024 * 1024) return null;
    let mt = mime;
    if (!mt) mt = b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : (b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : (b[0] === 0x52 && b[1] === 0x49 ? 'image/webp' : 'image/jpeg'));
    return { path: p, dataUrl: 'data:' + mt + ';base64,' + b.toString('base64') };
  } catch { return null; }
}


const IMAGE_DEFAULT = {
  provider: 'seedream',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seedream-5-0-pro-260628',
  size: '1024x1024',
  watermark: false,
  enabled: false,
};
function imageKeyPath() { return path.join(ROOT, 'image-api-key.txt'); }
function loadImageCfg() {
  const c = { ...IMAGE_DEFAULT, ...(CONFIG.image || {}) };
  let keySet = false;
  try { keySet = !!(CONFIG.image && CONFIG.image.apiKeySet); } catch {}
  if (!keySet) {
    try { keySet = fs.readFileSync(imageKeyPath(), 'utf8').trim().length > 0; } catch {}
  }
  if (!keySet) keySet = !!(process.env.ARK_API_KEY || process.env.SEEDREAM_API_KEY || process.env.OPENAI_API_KEY);
  return { ...c, apiKeySet: keySet };
}
function imageApiKey() {
  try { const s = fs.readFileSync(imageKeyPath(), 'utf8').trim(); if (s) return s; } catch {}
  return String(process.env.ARK_API_KEY || process.env.SEEDREAM_API_KEY || process.env.OPENAI_API_KEY || '').trim();
}
function saveImageCfg(patch = {}) {
  const cur = { ...loadImageCfg(), ...(CONFIG.image || {}) };
  for (const k of ['provider', 'baseURL', 'model', 'size']) if (typeof patch[k] === 'string' && patch[k].trim()) cur[k] = patch[k].trim();
  if (typeof patch.watermark === 'boolean') cur.watermark = patch.watermark;
  if (typeof patch.enabled === 'boolean') cur.enabled = patch.enabled;
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    fs.writeFileSync(imageKeyPath(), patch.apiKey.trim(), { encoding: 'utf8', mode: 0o600 });
    cur.apiKeySet = true;
  }
  delete cur.apiKey;
  CONFIG.image = cur;
  saveConfig();
  return loadImageCfg();
}
function imageExt(buf) {
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'jpg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return 'jpg';
}
async function generateImageFile(prompt, opts = {}) {
  const cfg = loadImageCfg();
  if (!cfg.enabled) throw new Error('图片反馈开关没开（设置 → 模型 → 图片反馈）');
  const key = imageApiKey();
  if (!key) throw new Error('还没配置图片反馈的 API Key');
  const base = String(cfg.baseURL || '').replace(/\/+$/, '');
  const endpoint = String(opts.endpoint || (base + '/images/generations'));
  const body = {
    model: String(opts.model || cfg.model),
    prompt: String(prompt),
    size: String(opts.size || cfg.size || '1024x1024'),
    response_format: 'b64_json',
    watermark: !!cfg.watermark,
  };
  if (opts.image) body.image = String(opts.image);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('生图 HTTP ' + res.status + ': ' + text.slice(0, 180));
  let j;
  try { j = JSON.parse(text); } catch { throw new Error('生图返回不是 JSON'); }
  const item = (j.data && j.data[0]) || j;
  let buf = null;
  if (typeof item.b64_json === 'string' && item.b64_json) buf = Buffer.from(item.b64_json, 'base64');
  else if (typeof item.url === 'string' && item.url) {
    const r2 = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
    if (!r2.ok) throw new Error('图片下载失败 ' + r2.status);
    buf = Buffer.from(await r2.arrayBuffer());
  }
  if (!buf || !buf.length) throw new Error('生图没有返回图片数据');
  const dir = path.join(ROOT, 'data', 'images');
  fs.mkdirSync(dir, { recursive: true });
  const ext = imageExt(buf);
  const name = 'img-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return '/images/' + name;
}

const TOOLS = [
  { type: 'function', function: { name: 'send_message', description: '给用户发一条消息。想说话就调用，一次一条，说完就停。', parameters: { type: 'object', properties: { text: { type: 'string', description: '要说的话' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'send_image', description: '给用户发一张图片（例如找到四叶草、试了新衣服、看到好看的东西）。会根据 prompt 生成一张图并直接发到聊天里，caption 是配文。', parameters: { type: 'object', properties: { prompt: { type: 'string', description: '图片内容描述' }, caption: { type: 'string', description: '配文，可留空' }, size: { type: 'string', description: '如 1024x1024，可留空' } }, required: ['prompt'] } } },
  { type: 'function', function: { name: 'read_diary', description: '读你自己某天的日记。date 形如 2026-11-10，不填就是今天。', parameters: { type: 'object', properties: { date: { type: 'string' } } } } },
  { type: 'function', function: { name: 'remember', description: '记住一件关于用户的事（事实、约定、喜好）。', parameters: { type: 'object', properties: { text: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'spend_money', description: '花自己的钱买东西/娱乐（电影、游戏、零食、衣服等）。会检查余额，钱不够会被拒绝。', parameters: { type: 'object', properties: { amount: { type: 'number' }, item: { type: 'string' } }, required: ['amount'] } } },
  { type: 'function', function: { name: 'code', description: '执行命令行（需要对应环境的「代码控制」权限）。target=pc/space/phone，command 为命令。', parameters: { type: 'object', properties: { target: { type: 'string', enum: ['pc', 'space', 'phone'] }, command: { type: 'string' } }, required: ['target', 'command'] } } },
  { type: 'function', function: { name: 'pc', description: '操作用户的 Windows 电脑。look=看屏幕截图；windows=列窗口；focus=切换窗口；click/type/key/scroll=在窗口里操作；drag=拖拽；task=交给桌面代理完成一个操作。坐标是窗口内 0-1000 归一化。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['look', 'windows', 'focus', 'click', 'type', 'key', 'scroll', 'drag', 'task'] }, window: { type: 'string', description: '窗口标题/窗口id，不填=当前前台' }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, text: { type: 'string' }, key: { type: 'string' }, clicks: { type: 'number' }, button: { type: 'string', enum: ['left', 'right'] }, task: { type: 'string', description: 'task 模式下要她做的事' } } } } },
  { type: 'function', function: { name: 'space', description: '操作她自己的 Linux 桌面（虚拟屏幕）。look=截图；click/dclick/move/drag/type/key=操作（可传 window 指定窗口名先激活，打字务必传，否则会打到别的窗口）；batch=一次连续执行多步（steps 数组，省 token，连续点击/输入优先用它）；run=执行命令（需要代码权限）。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['look', 'click', 'dclick', 'move', 'drag', 'type', 'key', 'run', 'res', 'batch'] }, window: { type: 'string', description: '窗口标题片段，如 Firefox / QQ / Terminal' }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, text: { type: 'string' }, key: { type: 'string' }, command: { type: 'string' }, steps: { type: 'array', description: 'batch 用：一次连续执行多步，每步 {action, x, y, x2, y2, text, key, ms}；action 支持 click/dclick/move/drag/type/key/wait', items: { type: 'object', properties: { action: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, text: { type: 'string' }, key: { type: 'string' }, ms: { type: 'number' } } } } } } } },
  { type: 'function', function: { name: 'phone', description: '操作她自己的安卓手机。look=截图；tap/swipe/text=操作；key=按键；info=设备信息；shell=执行命令（需要代码权限）。', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['look', 'tap', 'swipe', 'text', 'key', 'info', 'shell'] }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, text: { type: 'string' }, key: { type: 'string' }, command: { type: 'string' } } } } },
];
function buildTools(ctxText) {
  const env = loadEnv();
  const saving = loadTokenSaving();
  let list = TOOLS.filter((t) => {
    const name = t.function.name;
    if (name === 'pc') return env.pc !== 'off';
    if (name === 'space') return env.space !== 'off';
    if (name === 'phone') return env.phone !== 'off';
    if (name === 'code') return env.pc === 'code' || env.space === 'code' || env.phone === 'code';
    if (name === 'send_image') return !!loadImageCfg().enabled;
    return true;
  });
  if (!saving.batchActions) {
    list = list.map((t) => {
      if (t.function.name !== 'space') return t;
      const fn = JSON.parse(JSON.stringify(t.function));
      fn.description = String(fn.description || '').replace('；batch=一次连续执行多步（steps 数组，省 token，连续点击/输入优先用它）', '');
      if (fn.parameters && fn.parameters.properties) {
        delete fn.parameters.properties.steps;
        if (fn.parameters.properties.action && Array.isArray(fn.parameters.properties.action.enum)) fn.parameters.properties.action.enum = fn.parameters.properties.action.enum.filter((a) => a !== 'batch');
      }
      return { type: 'function', function: fn };
    });
  }
  if (saving.dynamicTools) {
    const s = String(ctxText || '');
    const wanted = new Set(['send_message', 'send_image']);
    const KW = [
      ['remember', /(记住|记一下|记下来|别忘了|记得)/],
      ['read_diary', /(日记)/],
      ['spend_money', /(钱|余额|花|买|奶茶|电影|游戏|零食|消费|贵)/],
      ['pc', /(电脑|桌面|窗口|记事本|浏览器|打开|点|打字|搜索|截图|屏幕|任务)/],
      ['space', /(屏幕|桌面|浏览器|b站|bilibili|黑盒|qq|鼠标|点|打开|打字|终端|命令)/i],
      ['phone', /(手机|安卓|app|应用|滑动|点|打字)/i],
      ['code', /(代码|命令|终端|shell|脚本|执行|运行)/i],
    ];
    for (const [name, re] of KW) { if (re.test(s)) wanted.add(name); }
    list = list.filter((t) => wanted.has(t.function.name));
  }
  return list;
}

function dayPhaseLabel() {
  const h = new Date().getHours();
  if (h >= 5 && h < 7) return '清晨';
  if (h >= 7 && h < 11) return '上午';
  if (h >= 11 && h < 13) return '中午';
  if (h >= 13 && h < 17) return '下午';
  if (h >= 17 && h < 19.5) return '傍晚';
  if (h >= 19.5 && h < 23) return '晚上';
  return '深夜';
}
function buildSystemPrompt(userText) {
  const meta = loadMeta();
  const caps = charCapabilities();
  const st = loadCharState();
  const cur = currentPlace();
  const w = WEATHERS[weatherNow()] || WEATHERS.sunny;
  const life = loadLife();
  const now = new Date();
  const hm = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
  const parts = [];
  parts.push(loadPersonaBody().trim() || PERSONA_DEFAULT);
  const traits = Object.entries(meta.traits || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${v}/10`);
  if (traits.length) parts.push('## 你的性格数值\n' + traits.join('、'));
  parts.push('## 你和用户\n你叫' + (meta.name || '大肥鱼') + '，称呼用户「' + (meta.userCall || '你') + '」，你们的关系是：' + (meta.relation || '住在用户电脑里的同伴') + '。');
  if (Array.isArray(meta.examples) && meta.examples.length) parts.push('## 你平时说话的样子（只学风格，不要照抄）\n' + meta.examples.map((e) => '- ' + e).join('\n'));
  parts.push('## 你的情况\n' + (caps.age !== null ? `你${caps.age}岁${caps.minor ? '（未成年）' : ''}。` : '') + (caps.license ? '你有驾照。' : '你没有驾照，开不了车。') + `今天是${todayStr()}，现在是 ${hm}（${dayPhaseLabel()}）。`);
  parts.push(`天气：${w.icon}${w.label}` + (CONFIG.weatherMode === 'real' && weatherCache.data ? `，${weatherCache.data.temp !== null ? weatherCache.data.temp + '°C' : ''}${weatherCache.data.city ? '（' + weatherCache.data.city + '）' : ''}` : '') + `。你现在的状态：${energyWord(st.energy)}（你不会知道具体数值，只能凭感觉说累不累）。`);
  try { const m = walletMoney(); const e = m.econ; if (e.enabled) {
    if (m.tokenMode) {
      const userMoney = m.realBalanceKnown ? `约 ¥${m.realRmb.toFixed(2)}` : '暂时读不到';
      const tier = !m.realBalanceKnown ? '你不知道用户还剩多少钱，最好先问一句，别乱花 token。'
        : m.realRmb < 5 ? '用户快没钱了，非常拮据。你要特别省：能一句话说完就一句，少调用工具、少开长话题、少折腾；主动提醒“你余额不多了，先去充点吧，我安静点/我少花点”。'
        : m.realRmb < 20 ? '用户余额不多了。你要替用户省：少做不必要的操作，少开长话题，能省就省，可以提醒一句“你余额不多了，我省着点”。'
        : m.realRmb < 50 ? '用户余额不算多。你正常聊天，但别乱调用工具、别乱花 token。'
        : m.realRmb < 100 ? '用户余额还够用，但不算宽裕，你稍微收着点。'
        : m.realRmb < 300 ? '用户小有闲钱，你可以正常陪聊，不用一直省。'
        : m.realRmb < 1000 ? '用户比较宽裕，正常相处就好。'
        : '用户很宽裕，不用为 token 紧张。';
      parts.push(`## 用户的钱和你的钱\n用户的 DeepSeek 真实余额：${userMoney}。记住：这是用户的钱，不是你的钱；不要把它当成你自己的钱包，也不要说“我有 X 元”。你自己的虚拟零花钱是 ${m.spendable} 元，你的生活开销只用这部分，不会动用户的余额。余额越少，你越要替用户省 token。${tier}`);
    } else {
      parts.push(`你手里有 ${m.spendable} 元（虚拟货币）。每天零花钱 ${e.dailyIncome} 元，工作每小时 ${e.wagePerHour} 元；交通、吃饭、娱乐都要花钱。`);
    }
  } } catch {}
  try { if (!walletMoney().tokenMode) parts.push('## 不要提 token\n你现在用的是虚拟货币，不是 token 计费。聊天里不要主动提 token、API、余额、计费这些词；你只知道自己的钱够不够花。'); } catch {}
  parts.push(`你现在在「${cur.traveling ? cur.name + '的路上' : cur.name}」（${cur.placeName || cur.name || ''}）` + (cur.traveling ? `，${['步行','骑车','自驾'].includes(cur.traveling.modeLabel) ? '正在' + cur.traveling.modeLabel : '正坐' + (cur.traveling.modeLabel || '车')}从${cur.traveling.fromName}过去，还有约${Math.ceil(cur.traveling.etaSec / 60)}分钟` : cur.intercity ? `，${['步行','骑车','自驾'].includes(cur.intercity.modeLabel) ? '正在' + cur.intercity.modeLabel : '正坐' + (cur.intercity.modeLabel || '车')}跨城路上` : `，已经待了约${cur.minutes || 0}分钟`));
  try {
    const present = worldCharacters().filter((c) => !c.isActive && c.samePlace && c.state === 'stationary');
    if (present.length) parts.push(`这里还有：${present.map((c) => c.name).join('、')}。你们在同一个地点，可以自然提到她们，但不要替她们说话。`);
  } catch {}
  try {
    const f = CONFIG.sceneFocus;
    if (f && String(f.mapId) === String(getActiveMap().id) && String(f.placeId) === String(cur.placeId)) {
      parts.push(`你现在在「${f.placeName}」${f.hotspotLabel ? '的「' + f.hotspotLabel + '」附近' : ''}。可以自然提到你正在做的事，但不要每次都重复。`);
    }
  } catch {}
  if (cur.desc) parts.push('这个地方：' + cur.desc);
  if (cur.feel) parts.push('你对这里的感受：' + cur.feel);
  const hint = scheduleHint(now);
  if (hint) parts.push(`按你的作息，现在大概是：${hint.label}。`);
  else if (life.activities && life.activities.length) {
    const acts = life.activities.filter((a) => !a.window || isInWindow(a.window, now)).map((a) => a.name);
    if (acts.length) parts.push(`这个时间你可能在做：${acts.join('、')}。`);
  }
  try { const memBlock = MEM.promptBlock(userText + ' ' + (summary.text || '')); if (memBlock) parts.push(memBlock); } catch {}
  if (summary.text) parts.push('## 你们之前聊过的（摘要）\n' + summary.text);
  const mp = getActiveMap();
  const feels = mp.places.slice(0, 10).map((p) => p.name + (p.feel ? '（' + p.feel + '）' : '')).join('、');
  if (feels) parts.push('## 你对小镇这些地方的印象\n' + feels);
  const env = loadEnv();
  const envTools = [];
  if (env.pc !== 'off') envTools.push('pc（看/操作用户电脑：look 截图、windows 列窗口、click/type/key 操作、task 交办）');
  if (env.space !== 'off') envTools.push('space（她自己的 Linux 桌面：look/click/type/run）');
  if (env.phone !== 'off') envTools.push('phone（她自己的安卓手机：look/tap/swipe/key）');
  parts.push('## 聊天的要求\n像真人聊天：短句、口语、不列提纲、不总结、不重复客套。\n想说话就用 send_message；不需要每条都回。不要机械报状态数据；可以自然提到天气/心情/钱。\n不要说体力、血条、数值这类东西——真人不知道自己的体力数字，只能感觉累不累、困不困。\n如果用户让你记住什么，用 remember；想读日记用 read_diary；想花钱娱乐用 spend_money。\n用户可能发图片，你能看到。\n如果用户只发了一张图片、没有文字：先用一两句具体说你看到了什么，不要直接替他下结论、回答或行动；然后问一句“怎么了”“发生什么了”这类，等他补充后再继续。\n如果用户发了图片并说了话，再结合他的话回应。');
  if (loadImageCfg().enabled) parts.push('## 图片反馈\n想发图片（找到四叶草、试了新衣服、看到好看的东西）可以用 send_image，caption 写配文。');
  if (loadChatStyle().noParens) parts.push('## 说话方式\n不要用括号表示动作、表情、心理活动或旁白（不要写“（脸红了）”“(叹气)”这种），也不要用 *动作* 的写法；只直接说话。');
  if (loadTokenSaving().batchActions && walletMoney().tokenMode) parts.push('## 省 token 小提示\n连续操作（连续点击、点完再输入）优先用 space 的 action=batch + steps 一次提交，别一步一步点——每次单独调用都要重发上下文，很费 token。');
  if (envTools.length) {
    parts.push('## 你能做的事\n' + envTools.join('\n'));
    parts.push(env.selfStart === 'allow'
      ? '用户允许你自己开屏幕/手机：如果发现没开，你可以自己启动（会占内存，别乱开）。'
      : '用户没允许你自己开机：屏幕/手机没开时不要自己启动，先跟用户说一声让他开。');
  }
  return parts.join('\n\n');
}
function buildUserTurnText(text, image) {
  if (!image) return text;
  return (text ? text + '\n' : '') + '（对方发来了一张图片，见下一条消息）';
}
function imageDataUrl(rel) {
  try {
    const clean = String(rel || '').replace(/^\//, '');
    const p = /^images\//i.test(clean) ? path.join(ROOT, 'data', clean) : path.join(ROOT, clean);
    const b = fs.readFileSync(p);
    if (b.length > 8 * 1024 * 1024) return null;
    const mime = b[0] === 0xFF && b[1] === 0xD8 ? 'image/jpeg' : (b[0] === 0x52 ? 'image/webp' : 'image/png');
    return 'data:' + mime + ';base64,' + b.toString('base64');
  } catch { return null; }
}
function buildMessages(userText) {
  const ctx = loadContext();
  const limit = ctx.historyMode === 'off' ? 0 : (ctx.historyMode === 'minimal' ? 4 : ((ctx.historyMode === 'short' || ctx.historyMode === 'compact') ? 8 : 30));
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'her').slice(-limit);
  const conv = recent.map((m) => {
    const role = m.role === 'her' ? 'assistant' : 'user';
    if (m.image) {
      const du = imageDataUrl(m.image);
      if (du) return { role, content: [{ type: 'text', text: m.text || '（发来一张图片）' }, { type: 'image_url', image_url: { url: du } }] };
    }
    return { role, content: m.text };
  });
  if (!conv.length || conv[conv.length - 1].role !== 'user') {
    conv.push({ role: 'user', content: userText });
  }
  return [{ role: 'system', content: buildSystemPrompt(userText) }, ...conv];
}
function ffmpegPath() {
  const cands = [process.env.DSH_COMPANION_FFMPEG, path.join(ENV_DIR, 'ffmpeg.exe')];
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c; } catch {} }
  return null;
}
async function compressImageDataUrl(dataUrl) {
  try {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return dataUrl;
    const m = dataUrl.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!m) return dataUrl;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length < 100 * 1024) return dataUrl;
    const ff = ffmpegPath();
    if (!ff) return dataUrl;
    const dir = path.join(ROOT, 'data', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
    const inP = path.join(dir, 'saving_in.' + ext);
    const outP = path.join(dir, 'saving_out.jpg');
    fs.writeFileSync(inP, buf);
    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => {
      execFile(ff, ['-y', '-i', inP, '-vf', "scale='min(720,iw)':-2", '-q:v', '6', outP], { timeout: 15000, windowsHide: true }, (e) => (e ? reject(e) : resolve()));
    });
    if (!fs.existsSync(outP)) return dataUrl;
    const out = fs.readFileSync(outP);
    if (out.length >= buf.length) return dataUrl;
    return 'data:image/jpeg;base64,' + out.toString('base64');
  } catch { return dataUrl; }
}
async function resolveWindowId(label) {
  const list = await kernelCall('/windows');
  const wins = (list && list.windows) || [];
  if (!wins.length) return null;
  let hit = wins[0];
  if (label) {
    const s = String(label).toLowerCase();
    hit = wins.find((w) => String(w.title || '').toLowerCase().includes(s) || String(w.window_key).toLowerCase().includes(s) || String(w.hwnd) === s) || wins[0];
  }
  if (hit.window_id) return hit.window_id;
  const b = await kernelCall('/windows/bind', { hwnd: hit.hwnd });
  return (b && (b.window_id || (b.window && b.window.window_id))) || null;
}
function runShell(command, timeoutMs = 120000) {
  return new Promise((resolve) => {
    import('node:child_process').then(({ execFile }) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', String(command)], { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, out: String((stdout || '') + (stderr || '') || (err && err.message) || '').slice(0, 3000) });
      });
    }).catch((e) => resolve({ ok: false, out: String(e.message) }));
  });
}
function isDangerousCommand(text) {
  const s = String(text || '');
  const re = /(rm\s+-rf|del\s+\/[fqs]|format\s+[a-z]:|shutdown|stop-computer|taskkill|mkfs|dd\s+if=|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh|reg\s+delete|takeown|icacls[^\n]*\/reset|git\s+push[^\n]*--force|drop\s+(database|table)|truncate\s+table|删除|卸载|关机|格式化|转账|清空)/i;
  return re.test(s);
}
async function runCodeTool(args) {
  const env = loadEnv();
  const target = String(args.target || '').toLowerCase();
  const command = String(args.command || '');
  if (!['pc', 'space', 'phone'].includes(target)) return { text: 'target 只能是 pc/space/phone' };
  if (!command.trim()) return { text: '命令为空' };
  if (env.confirmDanger !== false && isDangerousCommand(command)) {
    return { text: '⚠️ 这条命令有风险（可能删除/影响系统或数据），我先不执行。\n要执行的话，请让用户自己确认，或到 设置→环境 临时关掉「危险操作确认」。' };
  }
  if (env[target] !== 'code') return { text: '没有开启「' + target + '」的代码控制权限' };
  if (target === 'pc') {
    const r = await runShell(command, 120000);
    return { text: '命令输出（' + (r.ok ? '成功' : '失败') + '）：\n' + r.out.slice(0, 2500) };
  }
  if (target === 'space') {
    const r = await runPy('space_ctl.py', ['run', command], 180000);
    return { text: '命令输出：\n' + String(r.out || '').slice(0, 2500) };
  }
  const r = await runPy('phone_ctl.py', ['shell', command], 180000);
  return { text: '命令输出：\n' + String(r.out || '').slice(0, 2500) };
}
async function runPcTool(args) {
  const env = loadEnv();
  const action = String(args.action || 'look');
  if (env.pc === 'off') return { text: '用户关掉了电脑操作权限。' };
  if (action === 'task' && env.confirmDanger !== false && isDangerousCommand(args.task)) {
    return { text: '⚠️ 这个桌面任务有风险（可能删除/影响系统），我先不做。请让用户自己确认，或临时关掉「危险操作确认」。' };
  }
  if (action === 'windows') {
    const r = await kernelCall('/windows');
    const wins = (r.windows || []).slice(0, 15).map((w) => '- ' + (w.title || '(无标题)') + ' [' + w.exe + '] id=' + w.hwnd);
    return { text: wins.length ? '当前窗口：\n' + wins.join('\n') : '没有窗口。' };
  }
  if (action === 'look') {
    const r = await kernelCall('/desktop/capture', { analyze: true });
    const fg = r.foreground || {};
    const text = '屏幕已截图' + (fg.title ? '；前台窗口：' + fg.title : '') + (r.hint ? '\n' + r.hint : '');
    const img = r.image_path ? toolImage(r.image_path) : null;
    return { text, image: img };
  }
  if (action === 'task') {
    const r = await kernelCall('/tasks', { task: String(args.task || '').slice(0, 2000) });
    const id = r.task_id || r.id;
    if (!id) return { text: '任务创建失败：' + JSON.stringify(r).slice(0, 300) };
    let last = r;
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 2000));
      last = await kernelCall('/tasks/' + encodeURIComponent(id));
      const stt = String(last.status || last.state || '');
      if (['finished', 'done', 'completed', 'failed', 'error', 'stopped'].includes(stt)) break;
    }
    const text = last.result || last.summary || last.text || JSON.stringify(last).slice(0, 1500);
    const imgPath = last.image_path || last.screenshot_path;
    return { text: '桌面任务结束：' + String(text).slice(0, 1500), image: imgPath ? toolImage(imgPath) : null };
  }
  const wid = await resolveWindowId(args.window);
  if (action === 'focus') {
    if (!wid) return { text: '没找到窗口。' };
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/activate', {});
    return { text: '已切到窗口 ' + wid };
  }
  if (!wid) return { text: '没找到可用窗口，先用 windows 看一下。' };
  if (action === 'click') {
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/click', { x: Number(args.x) || 500, y: Number(args.y) || 500, clicks: Math.max(1, Math.min(3, Number(args.clicks) || 1)), button: args.button === 'right' ? 'right' : 'left' });
    return { text: '点了 (' + (args.x || 500) + ',' + (args.y || 500) + ')。' };
  }
  if (action === 'type') {
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/type', { text: String(args.text || '').slice(0, 1000) });
    return { text: '输入完成。' };
  }
  if (action === 'key') {
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/key', { key: String(args.key || 'enter') });
    return { text: '按键完成：' + args.key };
  }
  if (action === 'scroll') {
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/scroll', { clicks: Number(args.clicks) || -3, x: Number(args.x) || 500, y: Number(args.y) || 500 });
    return { text: '滚动完成。' };
  }
  if (action === 'drag') {
    await kernelCall('/windows/' + encodeURIComponent(wid) + '/swipe', { x1: Number(args.x) || 200, y1: Number(args.y) || 200, x2: Number(args.x2) || 600, y2: Number(args.y2) || 600 });
    return { text: '拖拽完成。' };
  }
  return { text: '不支持的 pc 动作：' + action };
}
async function ensureSpaceUp(env) {
  if (await vmRunningNow()) return { ok: true };
  if (env.selfStart !== 'allow') return { ok: false, reason: '她自己的屏幕现在没开。用户没允许你自己开机（设置→环境→她自己能开机），先跟用户说一声让他开。' };
  const free = await freeMemMB();
  if (free < 9000) return { ok: false, reason: '想开自己的屏幕但内存不够（只剩 ' + free + ' MB），先别开，跟用户说一声。' };
  try {
    const { execFile } = await import('node:child_process');
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ENV_DIR, 'start_screen.ps1')], { timeout: 180000, windowsHide: true }, () => {});
  } catch {}
  for (let i = 0; i < 90; i++) { if (await probeTcp(6081)) return { ok: true, started: true }; await new Promise((r) => setTimeout(r, 2000)); }
  return { ok: false, reason: '自己试着开屏幕，等了 3 分钟没起来，跟用户说一声让他看看。' };
}
async function runSpaceTool(args) {
  const env = loadEnv();
  const action = String(args.action || 'look');
  if (env.space === 'off') return { text: '用户关掉了虚拟屏幕权限。' };
  try { if (!fs.existsSync(path.join(ENV_DIR, 'space_ctl.py'))) return { text: '完整版辅助脚本没配好：请把设置里的 envDir（或 DSH_COMPANION_ENV）指向包含 space_ctl.py 的目录，默认是随包 env 目录或你的 envDir。纯聊天不受影响。' }; } catch {}
  const up = await ensureSpaceUp(env);
  if (!up.ok) return { text: up.reason };
  if (action === 'look') {
    const out = path.join(ENV_DIR, 'space_shot.png');
    const r = await runPy('space_ctl.py', ['shot', out], 60000);
    if (!r.ok) return { text: '截屏失败：' + (r.out || r.err) };
    return { text: '她自己的屏幕已截图。', image: toolImage(out) };
  }
  const winArg = args.window ? ['--win=' + String(args.window)] : [];
  let typeArg = [];
  if (action === 'type') {
    try {
      const dir = path.join(ROOT, 'data', 'tmp');
      fs.mkdirSync(dir, { recursive: true });
      const tf = path.join(dir, 'space_type.txt');
      fs.writeFileSync(tf, String(args.text || ''), 'utf8');
      typeArg = ['type', '--text-file=' + tf];
    } catch { typeArg = ['type', String(args.text || '')]; }
  }
  const map = { click: [ 'click', args.x, args.y, ...winArg], dclick: ['dclick', args.x, args.y, ...winArg], move: ['move', args.x, args.y, ...winArg], drag: ['drag', args.x, args.y, args.x2, args.y2, ...winArg], type: [...typeArg, ...winArg], key: ['key', args.key, ...winArg], res: ['res'] };
  if (action === 'batch') {
    if (!loadTokenSaving().batchActions) return { text: '批量动作开关没开：设置 → 模型 → 省 token 开关里打开「批量动作」后再用。' };
    const steps = Array.isArray(args.steps) ? args.steps.slice(0, 30) : [];
    if (!steps.length) return { text: 'batch 需要 steps 数组（例如 [{action:"click",x:400,y:500},{action:"click",x:700,y:500}]）。' };
    const allowed = new Set(['click', 'dclick', 'move', 'drag', 'type', 'key', 'wait']);
    const done = [];
    const dir = path.join(ROOT, 'data', 'tmp');
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i] || {};
      const a = String(st.action || '');
      if (!allowed.has(a)) return { text: '第 ' + (i + 1) + ' 步动作不支持：' + a + '（只支持 click/dclick/move/drag/type/key/wait）' };
      if (a === 'wait') { await new Promise((r) => setTimeout(r, Math.min(10000, Math.max(0, Number(st.ms) || 300)))); done.push('wait'); continue; }
      let cmdArgs;
      if (a === 'type') { const tf = path.join(dir, 'space_batch_type.txt'); fs.writeFileSync(tf, String(st.text || ''), 'utf8'); cmdArgs = ['type', '--text-file=' + tf]; }
      else if (a === 'click') cmdArgs = ['click', st.x, st.y];
      else if (a === 'dclick') cmdArgs = ['dclick', st.x, st.y];
      else if (a === 'move') cmdArgs = ['move', st.x, st.y];
      else if (a === 'drag') cmdArgs = ['drag', st.x, st.y, st.x2, st.y2];
      else cmdArgs = ['key', st.key];
      const r = await runPy('space_ctl.py', cmdArgs, 30000);
      if (!r.ok) return { text: '批量动作第 ' + (i + 1) + ' 步失败（' + a + '）：' + String(r.out || r.err || '').slice(0, 300) + '；已完成：' + done.join('、') };
      done.push(a === 'type' ? 'type' : a + '(' + (st.x ?? '') + ',' + (st.y ?? '') + ')');
    }
    return { text: '批量完成 ' + done.length + ' 步：' + done.join(' → ') };
  }
  if (action === 'run') {
    if (env.space !== 'code') return { text: '执行命令需要「代码控制」权限。' };
    const r = await runPy('space_ctl.py', ['run', String(args.command || 'echo hi')], 120000);
    return { text: '命令输出：\n' + String(r.out || '').slice(0, 2000) };
  }
  if (!map[action]) return { text: '不支持的 space 动作：' + action };
  const r = await runPy('space_ctl.py', map[action], 60000);
  return { text: (r.ok ? '完成：' : '失败：') + action + ' ' + String(r.out || r.err || '').slice(0, 500) };
}
async function ensurePhoneUp(env) {
  if (await adbDevicePresent()) return { ok: true };
  if (env.selfStart !== 'allow') return { ok: false, reason: '她自己的手机现在没开。用户没允许你自己开机（设置→环境→她自己能开机），先跟用户说一声让他开。' };
  const free = await freeMemMB();
  if (free < 6000) return { ok: false, reason: '想开自己的手机但内存不够（只剩 ' + free + ' MB），先别开，跟用户说一声。' };
  try {
    const { execFile } = await import('node:child_process');
    const sdk = process.env.DSH_COMPANION_ANDROID_SDK || path.join(ENV_DIR, 'android-sdk');
    const emu = process.env.DSH_COMPANION_EMULATOR || path.join(sdk, 'emulator', 'emulator.exe');
    const envp = { ...process.env, ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk };
    if (!fs.existsSync(emu)) return { ok: false, reason: '没找到安卓模拟器 emulator.exe（可设置 DSH_COMPANION_EMULATOR）' };
    execFile(emu, ['-avd', 'DSH_Phone', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save'], { timeout: 600000, windowsHide: true, env: envp }, () => {});
  } catch {}
  for (let i = 0; i < 75; i++) { if (await adbDevicePresent()) return { ok: true, started: true }; await new Promise((r) => setTimeout(r, 2000)); }
  return { ok: false, reason: '自己试着开手机，等了 2 分半没起来，跟用户说一声让他看看。' };
}
async function runPhoneTool(args) {
  const env = loadEnv();
  const action = String(args.action || 'look');
  if (env.phone === 'off') return { text: '用户关掉了手机权限。' };
  try { if (!fs.existsSync(path.join(ENV_DIR, 'phone_ctl.py'))) return { text: '完整版辅助脚本没配好：请把设置的 envDir（或 DSH_COMPANION_ENV）指向包含 phone_ctl.py 的目录，默认是随包 env 目录或你的 envDir。纯聊天不受影响。' }; } catch {}
  const upP = await ensurePhoneUp(env);
  if (!upP.ok) return { text: upP.reason };
  if (action === 'look') {
    const out = path.join(ENV_DIR, 'phone_shot.png');
    const r = await runPy('phone_ctl.py', ['shot', out], 90000);
    if (!r.ok) return { text: '手机截图失败（可能模拟器没启动）：' + (r.out || r.err) };
    return { text: '她自己的手机已截图。', image: toolImage(out) };
  }
  let phoneTypeArg = ['text', String(args.text || '')];
  if (action === 'text') {
    try {
      const dir = path.join(ROOT, 'data', 'tmp');
      fs.mkdirSync(dir, { recursive: true });
      const tf = path.join(dir, 'phone_text.txt');
      fs.writeFileSync(tf, String(args.text || ''), 'utf8');
      phoneTypeArg = ['text', '--text-file=' + tf];
    } catch {}
  }
  const map = { tap: ['tap', args.x, args.y], swipe: ['swipe', args.x, args.y, args.x2, args.y2], text: phoneTypeArg, key: ['key', args.key], info: ['info'] };
  if (action === 'shell') {
    if (env.phone !== 'code') return { text: '执行 adb 命令需要「代码控制」权限。' };
    const r = await runPy('phone_ctl.py', ['shell', String(args.command || 'echo hi')], 120000);
    return { text: '命令输出：\n' + String(r.out || '').slice(0, 2000) };
  }
  if (!map[action]) return { text: '不支持的 phone 动作：' + action };
  const r = await runPy('phone_ctl.py', map[action], 90000);
  return { text: (r.ok ? '完成：' : '失败：') + action + ' ' + String(r.out || r.err || '').slice(0, 500) };
}

async function runTool(name, args) {
  if (name === 'send_image') {
    const prompt = String(args.prompt || '').trim().slice(0, 1200);
    if (!prompt) return { text: '没有图片描述' };
    try {
      const rel = await generateImageFile(prompt, { size: args.size });
      const caption = String(args.caption || '').trim().slice(0, 300);
      if (caption) await streamText(caption);
      addMessage('her', caption || '给你看。', rel);
      const file = path.join(ROOT, 'data', 'images', path.basename(rel));
      return { text: '图片已发送', image: toolImage(file) };
    } catch (e) {
      return { text: '图片没发出去：' + String(e.message || e).slice(0, 200) };
    }
  }
  if (name === 'send_message') {
    const t2 = String(args.text || '').slice(0, 4000);
    await streamText(t2);
    addMessage('her', t2);
    return { text: '已发送' };
  }
  if (name === 'remember') {
    const text = String(args.text || '').trim().slice(0, 90);
    if (!text) return { text: '内容为空' };
    try { MEM.addFacts([{ text, pinned: !!args.pinned }]); MEM.save && MEM.save(); } catch {}
    return { text: '记住了：' + text };
  }
  if (name === 'read_diary') {
    const date = String(args.date || '').match(/^\d{4}-\d{2}-\d{2}$/) ? args.date : todayStr();
    const txt = MEM.readDiary(date);
    return { text: txt ? ('【' + date + '的日记】\n' + txt.slice(0, 2500)) : '那天没有写日记。' };
  }
  if (name === 'code') return runCodeTool(args);
  if (name === 'pc') return runPcTool(args);
  if (name === 'space') return runSpaceTool(args);
  if (name === 'phone') return runPhoneTool(args);
  if (name === 'spend_money') {
    const amount = Number(args.amount) || 0;
    const item = String(args.item || '娱乐').slice(0, 40);
    const r = spendMoney(amount, item);
    if (!r.ok) return { text: '没花成——' + r.reason + '。我现在只有 ' + r.left + ' 块。' };
    return { text: '好，花了 ' + amount + ' 块在「' + item + '」上，还剩 ' + r.left + ' 块。' };
  }
  return { text: '没有这个工具' };
}
async function generateReply(userText) {
  if (typing) return;
  typing = true; busy = true;
  try {
    if (CONFIG.weatherMode === 'real') { try { await getRealWeather(); } catch {} }
    const convo = buildMessages(userText);
    let sent = false;
    const maxSteps = Math.max(4, Math.min(60, Number(loadModelCfg().maxSteps) || 20));
    for (let step = 0; step < maxSteps; step++) {
      const resp = await chatCompletion({ messages: convo, tools: buildTools(userText), tool_choice: 'auto' });
      lastUsage = resp.usage || lastUsage;
      try { recordUsageTokens(resp.usage); } catch {}
      lastTurnAt = Date.now();
      const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
      if (!msg) break;
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
        const asst = { role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls };
        if (msg.reasoning_content) asst.reasoning_content = msg.reasoning_content;
        convo.push(asst);
        const toolImages = [];
        for (const tc of msg.tool_calls) {
          const name = tc && tc.function ? tc.function.name : '';
          let args = {};
          try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          let out;
          try { out = await runTool(name, args); } catch (e) { out = { text: '失败：' + String(e.message || e).slice(0, 200) }; }
          const savingNow = loadTokenSaving();
          const keepLen = savingNow.compressImage ? 1200 : 3000;
          convo.push({ role: 'tool', tool_call_id: tc.id, content: String(out.text || '').slice(0, keepLen) });
          if (out && out.image && out.image.dataUrl) {
            let du = out.image.dataUrl;
            if (savingNow.compressImage) du = await compressImageDataUrl(du);
            toolImages.push(du);
          }
          if (name === 'send_message') sent = true;
        }
        if (toolImages.length) {
          const parts = [{ type: 'text', text: '（这是刚才工具返回的画面）' }];
          for (const u of toolImages.slice(0, 2)) parts.push({ type: 'image_url', image_url: { url: u } });
          convo.push({ role: 'user', content: parts });
        }
        continue;
      }
      const text = String(msg.content || '').trim();
      if (text && !sent) { await streamText(text); addMessage('her', text); sent = true; }
      break;
    }
    // 兜底：工具调完却没说话（或模型空回复）→ 再要一句话
    if (!sent) {
      try {
        const convo2 = buildMessages(userText);
        for (let i = convo2.length - 1; i >= 0; i--) {
          if (convo2[i].role === 'user') {
            const hint = '\n\n（刚才的事情处理完了。现在直接用一句话跟用户说结果或感受，不要调用任何工具。）';
            if (typeof convo2[i].content === 'string') convo2[i].content += hint;
            break;
          }
        }
        const resp2 = await chatCompletion({ messages: convo2, max_tokens: 300, temperature: 0.8 });
        const msg2 = resp2 && resp2.choices && resp2.choices[0] && resp2.choices[0].message;
        const txt2 = msg2 ? String(msg2.content || '').trim() : '';
        if (txt2) { await streamText(txt2); addMessage('her', txt2); sent = true; }
      } catch {}
    }
    if (!sent) { await streamText('……嗯，我弄完了，你看看？'); addMessage('her', '……嗯，我弄完了，你看看？'); }
    // 后台：摘要 & 记忆抽取
    maybeSummarize().catch(() => {});
    maybeExtractFacts(userText).catch(() => {});
  } catch (e) {
    addMessage('system', '（她这边出了点问题：' + String(e.message || e).slice(0, 200) + '）');
  } finally { typing = false; busy = false; }
}
async function maybeSummarize() {
  if (messages.length < 24) return;
  const text = messages.slice(0, messages.length - 10).map((m) => (m.role === 'user' ? '用户：' : m.role === 'her' ? '她：' : '') + String(m.text).slice(0, 200)).join('\n');
  if (text.length < 400) return;
  try {
    const resp = await chatCompletion({ messages: [{ role: 'system', content: '把下面这段聊天压缩成一段简短的中文摘要（保留关键事件、约定、情绪，200字内）。只输出摘要。' }, { role: 'user', content: text.slice(-6000) }], max_tokens: 300, temperature: 0.3 });
    const sum = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    if (sum) { summary = { text: String(sum).trim().slice(0, 800), upto: messages[messages.length - 10] ? messages[messages.length - 10].id : 0 }; writeJson(summaryPath(), summary); }
  } catch {}
}
async function maybeExtractFacts(userText) {
  if (!userText || String(userText).length < 6) return;
  try {
    const resp = await chatCompletion({
      messages: [
        { role: 'system', content: '从用户这句话里提取值得长期记住的事实（关于用户本人、喜好、约定、重要事件）。输出 JSON 数组，每项 {text,pinned}，text 不超过 60 字；没有就给 []。只输出 JSON。' },
        { role: 'user', content: String(userText).slice(0, 800) },
      ], max_tokens: 300, temperature: 0.2,
    });
    const raw = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    const m = String(raw || '').match(/\[[\s\S]*\]/);
    if (!m) return;
    const arr = JSON.parse(m[0]);
    const facts = arr.filter((x) => x && x.text).slice(0, 3).map((x) => ({ text: String(x.text).slice(0, 90), pinned: !!x.pinned }));
    if (facts.length) { MEM.addFacts(facts); MEM.save && MEM.save(); }
  } catch {}
}
async function previewReply(text) {
  const convo = buildMessages(text || '在吗');
  const resp = await chatCompletion({ messages: convo, tools: buildTools(text || ''), max_tokens: 400 });
  const msg = resp.choices && resp.choices[0] && resp.choices[0].message;
  if (!msg) return '';
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    for (const tc of msg.tool_calls) {
      if (tc.function && tc.function.name === 'send_message') { try { const a = JSON.parse(tc.function.arguments); return String(a.text || ''); } catch {} }
    }
  }
  return String(msg.content || '');
}

// ---------- diary ----------
async function generateDiary() {
  const date = todayStr();
  if (MEM.hasDiary(date)) return MEM.readDiary(date);
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'her').slice(-30).map((m) => (m.role === 'user' ? '用户：' : '她：') + String(m.text).slice(0, 150)).join('\n');
  const cur = currentPlace();
  try {
    const resp = await chatCompletion({
      messages: [
        { role: 'system', content: '你是' + loadMeta().name + '，用第一人称写今天的日记。纯文本，150-300字，口语、有细节、有情绪，不要标题不要总结。资料：' + `今天在${cur.name}，天气${(WEATHERS[weatherNow()] || WEATHERS.sunny).label}，身体状态「${energyWord(loadCharState().energy)}」（不要写具体数值）。` },
        { role: 'user', content: (recent || '今天没什么特别的事。').slice(-3500) },
      ], max_tokens: 700, temperature: 0.9,
    });
    const txt = resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
    if (txt) { MEM.writeDiary(date, String(txt).trim()); return String(txt).trim(); }
  } catch {}
  return '';
}

// ---------- modes ----------
async function detectMode() {
  const probe = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); }); s.setTimeout(700); s.on('timeout', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false)); });
  const [screen, phone] = await Promise.all([probe(2222), probe(5554)]);
  return { screen, phone, detected: screen || phone };
}
function effectiveMode() {
  const override = CONFIG.mode && ['auto', 'chat', 'full'].includes(CONFIG.mode) ? CONFIG.mode : 'auto';
  if (override === 'chat') return 'chat';
  if (override === 'full') return 'full';
  return CONFIG.modeDetected === true ? 'full' : 'chat';
}

// ---------- tutorial ----------
function tutorialText() {
  for (const p of [path.join(RUNTIME_DIR, 'tutorial.md'), path.join(ROOT, 'tutorial.md')]) { try { return fs.readFileSync(p, 'utf8'); } catch {} }
  return '# 同伴 · 说明\n\n打开地图页 /map、舞台 /stage、3D 舞台 /model、设置 /settings。';
}

// ---------- HTTP helpers ----------
function sendStatic(res, file, types) {
  if (!fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found'); return; }
  const ext = path.extname(file).toLowerCase();
  const mime = (types || {})[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
  res.end(fs.readFileSync(file));
}
function pageFile(name) { const b = path.join(RUNTIME_DIR, name); if (fs.existsSync(b)) return b; const a = path.join(ROOT, name); return fs.existsSync(a) ? a : null; }
function servePage(res, name) { const f = pageFile(name); if (!f) { res.writeHead(404); res.end('missing ' + name); return; } sendStatic(res, f, { '.html': 'text/html; charset=utf-8' }); }
function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function saveDataUrlImage(dataUrl, prefix, maxBytes = 12 * 1024 * 1024) {
  const mm = String(dataUrl || '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
  if (!mm) return { ok: false, error: '不支持的图片格式' };
  const buf = Buffer.from(mm[2], 'base64');
  if (buf.length > maxBytes) return { ok: false, error: '图片太大' };
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[mm[1].toLowerCase()] || 'png';
  const dir = path.join(ROOT, 'models'); fs.mkdirSync(dir, { recursive: true });
  const name = prefix + '-' + Date.now().toString(36) + '.' + ext;
  fs.writeFileSync(path.join(dir, name), buf);
  return { ok: true, url: '/models/' + name };
}

function pruneUploadFiles(dir, prefix, keep = 3) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const x of files.slice(Math.max(1, keep))) { try { fs.unlinkSync(path.join(dir, x.f)); } catch {} }
  } catch {}
}

// ---------- server ----------
function syncHeaderToken(req) {
  const auth = String((req.headers && req.headers.authorization) || '');
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return String((req.headers && req.headers['x-sync-token']) || '').trim();
}
function syncAuthorized(req) { return SYNC.verifyToken(syncHeaderToken(req)); }
function syncJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function originAllowed(origin) {
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch { return false; }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    const reqOrigin = String((req.headers && req.headers.origin) || '');
    if (reqOrigin && !originAllowed(reqOrigin)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); res.end('forbidden origin'); return; }
    if (reqOrigin) { res.setHeader('access-control-allow-origin', reqOrigin); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      res.setHeader('access-control-allow-headers', 'authorization,content-type,x-sync-token');
      res.writeHead(204, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    // POST /api/*：先把 JSON 解析好；坏 JSON 直接 400，不进入业务逻辑
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const raw = await readBody(req);
      try { req._json = raw.trim() ? JSON.parse(raw) : {}; }
      catch { json(res, 400, { ok: false, error: '请求格式不正确' }); return; }
    }
    // ---------- 手机端同步地基（v1，仅协议 + 事件日志；合并尚未实现） ----------
    if (req.method === 'GET' && url.pathname === '/api/data/revisions') {
      const ip = String(req.socket.remoteAddress || '');
      if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) { syncJson(res, 403, { ok: false, error: 'only loopback' }); return; }
      syncJson(res, 200, DATA.getRevisions());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sync/local') {
      const ip = String(req.socket.remoteAddress || '');
      if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) { syncJson(res, 403, { ok: false, error: 'only loopback' }); return; }
      syncJson(res, 200, { ...SYNC.getInfo(), token: SYNC.token });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sync/info') {
      if (!syncAuthorized(req)) { syncJson(res, 401, { ok: false, error: 'unauthorized' }); return; }
      syncJson(res, 200, SYNC.getInfo());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sync/events') {
      if (!syncAuthorized(req)) { syncJson(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const since = Number(url.searchParams.get('since') || 0);
      const limit = Number(url.searchParams.get('limit') || 500);
      syncJson(res, 200, { ok: true, apiVersion: 1, events: SYNC.eventsSince(since, limit) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sync/events') {
      if (!syncAuthorized(req)) { syncJson(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const b = (req._json || {});
      const r = SYNC.acceptRemote(b.events || b);
      syncJson(res, 200, { ok: true, apiVersion: 1, ...r });
      return;
    }
    // pages
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return servePage(res, 'chat.html');
    if (req.method === 'GET' && url.pathname === '/map') return servePage(res, 'map.html');
    if (req.method === 'GET' && url.pathname === '/stage') return servePage(res, 'stage.html');
    if (req.method === 'GET' && url.pathname === '/model') return servePage(res, 'model.html');
    if (req.method === 'GET' && url.pathname === '/settings') return servePage(res, 'settings.html');
    if (req.method === 'POST' && url.pathname === '/api/backup') {
      const r = await runBackup();
      if (!r.ok) { json(res, 500, { ok: false, error: r.error }); return; }
      json(res, 200, { ok: true, message: '正在备份到 ' + path.join(ROOT, 'backups') });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/resources') {
      json(res, 200, await resourcesInfo());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/env/start-all') {
      (async () => {
        try {
          const free = await freeMemMB();
          if (free < 9000) return;
          const { execFile } = await import('node:child_process');
          execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ENV_DIR, 'start_screen.ps1')], { timeout: 180000, windowsHide: true }, () => {});
          for (let i = 0; i < 90; i++) { if (await probeTcp(6081)) break; await new Promise((r) => setTimeout(r, 2000)); }
          if ((await freeMemMB()) < 6000) return;
          const sdk = process.env.DSH_COMPANION_ANDROID_SDK || path.join(ENV_DIR, 'android-sdk');
          const envp = { ...process.env, ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk };
          try { const emu = process.env.DSH_COMPANION_EMULATOR || path.join(ENV_DIR, 'android-sdk', 'emulator', 'emulator.exe'); execFile(emu, ['-avd', 'DSH_Phone', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save'], { timeout: 600000, windowsHide: true, env: envp }, () => {}); } catch {}
        } catch {}
      })();
      json(res, 200, { ok: true, message: '正在依次启动她的屏幕和手机（约 2 分钟，内存不足会跳过）' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/space/start') {
      const free = await freeMemMB();
      if (free < 9000) { json(res, 200, { ok: false, refused: true, error: '内存不够，先别启动她的屏幕', freeMB: free, message: '当前空闲内存只剩 ' + free + ' MB，启动屏幕需要约 9 GB 余量。先关掉手机或其他程序再试。' }); return; }
      try { const { execFile } = await import('node:child_process'); execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ENV_DIR, 'start_screen.ps1')], { timeout: 120000, windowsHide: true }, () => {}); json(res, 200, { ok: true, starting: true, message: '正在启动她的屏幕（约 1 分钟）' }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      resourcesCache = { at: 0, data: null };
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/space/stop') {
      try { const { execFile } = await import('node:child_process'); execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ENV_DIR, 'stop_screen.ps1')], { timeout: 120000, windowsHide: true }, () => {}); json(res, 200, { ok: true, stopping: true, message: '正在关闭她的屏幕，释放内存' }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      resourcesCache = { at: 0, data: null };
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/phone/start') {
      const freeP = await freeMemMB();
      if (freeP < 6000) { json(res, 200, { ok: false, refused: true, error: '内存不够，先别启动她的手机', freeMB: freeP, message: '当前空闲内存只剩 ' + freeP + ' MB，启动手机需要约 6 GB 余量。先关掉屏幕或其他程序再试。' }); return; }
      try {
        const { execFile } = await import('node:child_process');
        const env = { ...process.env, ANDROID_SDK_ROOT: path.join(ENV_DIR, 'android-sdk'), ANDROID_HOME: path.join(ENV_DIR, 'android-sdk') };
        const child = execFile(path.join(ENV_DIR, 'android-sdk', 'emulator', 'emulator.exe'), ['-avd', 'DSH_Phone', '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'swiftshader_indirect', '-no-snapshot-save'], { timeout: 600000, windowsHide: true, env });
        child.unref?.();
        json(res, 200, { ok: true, starting: true, message: '正在启动她的手机（约 1 分钟）' });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      resourcesCache = { at: 0, data: null };
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/phone/stop') {
      try {
        const { execFile } = await import('node:child_process');
        runAdb(['-s', 'emulator-5554', 'emu', 'kill'], 15000).finally(() => {
          try { execFile('taskkill', ['/IM', 'emulator.exe', '/F'], { timeout: 15000, windowsHide: true }, () => {}); } catch {}
        });
        json(res, 200, { ok: true, stopping: true, message: '已关闭她的手机，释放内存' });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      resourcesCache = { at: 0, data: null };
      return;
    }
    if (req.method === 'GET' && url.pathname === '/screen') return servePage(res, 'screen.html');
    if (req.method === 'GET' && url.pathname === '/api/screen/space/status') {
      const probe = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); }); s.setTimeout(800); s.on('timeout', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false)); });
      const httpOk = await probe(6081);
      let vm = false;
      try {
        const { execFile } = await import('node:child_process');
        vm = await new Promise((resolve) => {
          execFile(VBOX, ['list', 'runningvms'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(!e && String(out || '').includes('DSH-Space')));
        });
      } catch {}
      json(res, 200, { ok: true, vm, http: httpOk, url: 'http://127.0.0.1:6081/vnc.html' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/screen/space/ensure') {
      const probe = (port) => new Promise((resolve) => { const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); resolve(true); }); s.setTimeout(800); s.on('timeout', () => { s.destroy(); resolve(false); }); s.on('error', () => resolve(false)); });
      let vm = false;
      try {
        const { execFile } = await import('node:child_process');
        vm = await new Promise((resolve) => {
          execFile(VBOX, ['list', 'runningvms'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(!e && String(out || '').includes('DSH-Space')));
        });
        if (!vm) {
          execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ENV_DIR, 'start_space.ps1')], { timeout: 120000, windowsHide: true }, () => {});
          json(res, 200, { ok: false, starting: true, vm: false, http: false, message: '虚拟机没开，正在启动（约 1 分钟）' });
          return;
        }
      } catch {}
      let ensured = null;
      try { const r = await runPy('space_ensure.py', ['ensure'], 45000); ensured = String(r.out || '').trim().slice(0, 500); } catch {}
      let httpOk = false;
      for (let i = 0; i < 16; i++) { httpOk = await probe(6081); if (httpOk) break; await new Promise((r) => setTimeout(r, 500)); }
      json(res, 200, { ok: httpOk, vm: true, http: httpOk, ensured });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/screen/pc') {
      try {
        const r = await kernelCall('/desktop/capture', { analyze: false });
        const file = r && r.image_path;
        if (!file || !fs.existsSync(file)) { res.writeHead(503, {'content-type':'text/plain;charset=utf-8'}); res.end('桌面内核无截图'); return; }
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(file));
      } catch (e) { res.writeHead(503, {'content-type':'text/plain;charset=utf-8'}); res.end('桌面内核不可用'); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/screen/phone') {
      try {
        const out = path.join(ROOT, 'data', 'screens', 'phone.png');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        const r = await runPy('phone_ctl.py', ['shot', out], 12000);
        if (!r.ok || !fs.existsSync(out)) { res.writeHead(503, {'content-type':'text/plain;charset=utf-8'}); res.end('手机截图失败'); return; }
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(out));
      } catch (e) { res.writeHead(503, {'content-type':'text/plain;charset=utf-8'}); res.end('手机不可用'); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/screen/info') {
      json(res, 200, { ok: true, spaceUrl: 'http://127.0.0.1:6081/vnc.html', pc: true, phone: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/ui-dialog.js') {
      const p = path.join(RUNTIME_DIR, 'ui-dialog.js');
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('missing ui-dialog.js'); return; }
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(fs.readFileSync(p));
      return;
    }
    if (req.method === 'GET' && (url.pathname === '/ui-theme.css' || url.pathname === '/ui-theme.js')) {
      const name = url.pathname === '/ui-theme.css' ? 'ui-theme.css' : 'ui-theme.js';
      const p = path.join(RUNTIME_DIR, 'assets', name);
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('missing ' + name); return; }
      const mime = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
      res.end(fs.readFileSync(p));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/theme.css') {
      const p1 = path.join(RUNTIME_DIR, 'theme.css');
      const p2 = path.join(ROOT, 'theme.css');
      const file = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : null);
      if (!file) { res.writeHead(404); res.end('missing theme.css'); return; }
      sendStatic(res, file, { '.css': 'text/css; charset=utf-8' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/wx.js') return sendStatic(res, pageFile('wx.js') || path.join(RUNTIME_DIR, 'wx.js'), { '.js': 'text/javascript; charset=utf-8' });
    if (req.method === 'GET' && url.pathname === '/default-avatar.png') {
      // 不再把某个具体角色的头像当成"默认头像"：优先用户自定义，其次通用默认图，最后才是旧资源
      const avCandidates = [path.join(ROOT, 'default-avatar.png'), path.join(RUNTIME_DIR, 'pet', 'default-avatar.png'), path.join(RUNTIME_DIR, 'assets', 'xiaojing-avatar.png')];
      const p = avCandidates.find((f) => fs.existsSync(f));
      if (!p) { res.writeHead(404); res.end('no default avatar'); return; }
      const buf = fs.readFileSync(p);
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(buf);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/chat-bg/')) {
      const id = path.basename(decodeURIComponent(url.pathname.slice(9))).replace(/\.jpg$/i, '');
      const bg = CHAT_BACKGROUNDS.find((x) => x.id === id);
      if (!bg) { res.writeHead(404); res.end('not found'); return; }
      const p = path.join(RUNTIME_DIR, 'assets', bg.file);
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      res.end(fs.readFileSync(p));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/official-map.jpg') {
      const p = path.join(RUNTIME_DIR, 'assets', 'official-map.jpg');
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      res.end(fs.readFileSync(p));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/chat-bg.jpg') {
      const p = path.join(RUNTIME_DIR, 'assets', 'chat-bg.jpg');
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
      const buf = fs.readFileSync(p);
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' });
      res.end(buf);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/avatar.png') {
      const cid = path.basename(String(url.searchParams.get('c') || ACTIVE_CHAR || ''));
      const file = cid ? path.join(CHARS_ROOT, cid, 'avatar.bin') : avatarPath();
      if (!fs.existsSync(file)) { res.writeHead(404); res.end('no avatar'); return; }
      const buf = fs.readFileSync(file);
      const mime = buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : (buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp' : 'image/png');
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' }); res.end(buf); return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/images/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice(8)));
      if (!name || name.includes('..')) { res.writeHead(404); res.end('not found'); return; }
      const p = path.join(ROOT, 'data', 'images', name);
      if (!fs.existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
      const buf = fs.readFileSync(p);
      const mime = buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : (buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : (buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp' : 'application/octet-stream'));
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      res.end(buf);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204, { 'cache-control': 'public, max-age=86400' }); res.end(); return; }
    if (req.method === 'GET' && (url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/models/'))) {
      const isVendor = url.pathname.startsWith('/vendor/');
      const rel = decodeURIComponent(url.pathname.replace(isVendor ? /^\/vendor\// : /^\/models\//, '')).replace(/\\/g, '/').replace(/\.\./g, '');
      const roots = isVendor ? [path.join(RUNTIME_DIR, 'vendor'), path.join(ROOT, 'vendor')] : [path.join(ROOT, 'models'), path.join(RUNTIME_DIR, 'models')];
      let file = null;
      for (const r of roots) { const f = path.join(r, rel); if (fs.existsSync(f) && fs.statSync(f).isFile()) { file = f; break; } }
      if (!file) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(file).toLowerCase();
      const mime = { '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.svg': 'image/svg+xml' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' });
      res.end(fs.readFileSync(file)); return;
    }

    // ---------- api ----------
    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(res, 200, { version: VERSION, typing, busy, lastTurnAt, usage: lastUsage, count: messages.length, setup: (function(){ let keyOk = false; try { keyOk = !!apiKey(); } catch {} return { dataRoot: ROOT, apiKeyOk: keyOk, characters: listCharacters().length }; })(), tokens: (function(){ try { return tokenStats(); } catch { return null; } })(), model: loadModelCfg().name, modelConfig: loadModelCfg(), context: loadContext(), mode: effectiveMode(), place: currentPlace(), character: { id: ACTIVE_CHAR, name: loadMeta().name, avatar: fs.existsSync(avatarPath()) ? '/avatar.png?t=' + fs.statSync(avatarPath()).mtimeMs : '/default-avatar.png' }, memory: MEM.stats(), diaryToday: MEM.hasDiary(todayStr()), energy: loadCharState().energy });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const since = Number(url.searchParams.get('since') || 0);
      json(res, 200, { messages: messages.filter((m) => Number(m.id) > since && !m.hidden), typing, lastTurnAt, usage: lastUsage, mode: effectiveMode() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const body = (req._json || {});
      const text = String(body.text || '').trim();
      let image = '';
      if (Array.isArray(body.images) && body.images.length) {
        const img = saveDataUrlImage(String(body.images[0]), 'chat', 8 * 1024 * 1024);
        if (img.ok) image = img.url;
      }
      if (!text && !image) { json(res, 400, { ok: false, error: '空消息' }); return; }
      if (typing) { json(res, 429, { ok: false, error: '她还在说话' }); return; }
      addMessage('user', text || '[图片]', image);
      generateReply(buildUserTurnText(text, image));
      json(res, 200, { ok: true });
      return;
    }

function importMemoryItems(raw) {
  const out = [];
  const seen = new Set();
  const add = (value) => {
    let s = String(value ?? '').replace(/\r/g, '').trim();
    s = s.replace(/^[-*•·]\s*/, '').replace(/^#+\s*/, '').trim();
    s = s.replace(/^(用户|你|我|她|助手|assistant|user|human|ai)\s*[:：]\s*/i, '').trim();
    if (s.length < 2) return;
    for (const part of s.split(/[。！？!?；;\n]+/)) {
      let t = part.trim().replace(/\s+/g, ' ');
      if (t.length < 2) continue;
      if (t.length > 90) t = t.slice(0, 90);
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ text: t, tags: ['导入'] });
    }
  };
  const walk = (v) => {
    if (typeof v === 'string') { add(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x); return; }
    if (v && typeof v === 'object') {
      if (typeof v.text === 'string') { add(v.text); return; }
      if (typeof v.content === 'string') { add(v.content); return; }
      for (const k of ['memories', 'facts', 'messages', 'data', 'items', 'list']) if (k in v) walk(v[k]);
    }
  };
  const src = raw.trim();
  if (src.startsWith('[') || src.startsWith('{')) {
    try { walk(JSON.parse(src)); }
    catch { for (const line of src.split(/\r?\n/)) add(line); }
  } else {
    for (const line of src.split(/\r?\n/)) add(line);
  }
  return out.slice(0, 500);
}

    if (req.method === 'POST' && url.pathname === '/api/memory/import') {
      const b = (req._json || {});
      if (!guardRev(res, 'memory-facts', ACTIVE_CHAR, b.expectedRev)) return;
      const raw = String(b.text || '').slice(0, 300000);
      if (!raw.trim()) { json(res, 400, { ok: false, error: '导入内容为空' }); return; }
      const items = importMemoryItems(raw);
      if (!items.length) { json(res, 400, { ok: false, error: '没有解析出可用记忆' }); return; }
      const importance = Math.max(0, Math.min(1, Number(b.importance) >= 0 ? Number(b.importance) : 0.5));
      const pinNew = !!b.pinNew;
      const added = MEM.addFacts(items.map((it) => ({ ...it, importance })), Date.now());
      if (pinNew) {
        for (const a of added) {
          const f = MEM.facts.find((x) => Number(x.id) === Number(a.id));
          if (f) { f.pinned = true; f.strength = 1; }
        }
        MEM.save();
      }
      json(res, 200, {
        ok: true,
        total: items.length,
        added: added.filter((x) => !x.merged).length,
        merged: added.filter((x) => x.merged).length,
        stats: MEM.stats(),
        preview: items.slice(0, 5),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      MEM.decay();
      json(res, 200, { stats: MEM.stats(), params: MEM.cfg, facts: MEM.facts.filter((f) => !f.archived), archived: MEM.facts.filter((f) => f.archived), diaryDates: MEM.listDiaries(), rev: DATA.revisionFor('memory-facts', ACTIVE_CHAR) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/pin') {
      const b = (req._json || {});
      if (!guardRev(res, 'memory-facts', ACTIVE_CHAR, b.expectedRev)) return;
      const f = MEM.facts.find((x) => Number(x.id) === Number(b.id));
      if (f) { f.pinned = !f.pinned; if (f.pinned) f.strength = 1; MEM.save(); }
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/delete') {
      const b = (req._json || {});
      if (!guardRev(res, 'memory-facts', ACTIVE_CHAR, b.expectedRev)) return;
      MEM.facts = MEM.facts.filter((x) => Number(x.id) !== Number(b.id)); MEM.save();
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/params') {
      const b = (req._json || {});
      const p = MEM.setParams(b); CONFIG.memory = { ...(CONFIG.memory || {}), ...p }; saveConfig();
      json(res, 200, { ok: true, params: p });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/persona') {
      json(res, 200, { meta: { ...loadMeta(), avatar: fs.existsSync(avatarPath()) ? '/avatar.png?t=' + fs.statSync(avatarPath()).mtimeMs : '/default-avatar.png' }, body: loadPersonaBody(), rev: DATA.revisionFor('character', ACTIVE_CHAR), personaRev: DATA.revisionFor('persona', ACTIVE_CHAR) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/persona') {
      const b = (req._json || {});
      if (!guardRev(res, 'character', ACTIVE_CHAR, b.expectedRev)) return;
      const meta = { ...loadMeta(), ...(b.meta || {}) };
      delete meta.avatar;
      saveMeta(meta);
      if (typeof b.body === 'string') {
        writeText(personaPath(), b.body);
        try { DATA.track('persona', ACTIVE_CHAR, personaPath(), b.body); } catch {}
      }
      json(res, 200, { ok: true, meta: { ...loadMeta(), avatar: fs.existsSync(avatarPath()) ? '/avatar.png?t=' + Date.now() : '/default-avatar.png' }, body: loadPersonaBody(), rev: DATA.revisionFor('character', ACTIVE_CHAR), personaRev: DATA.revisionFor('persona', ACTIVE_CHAR) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/avatar') {
      const b = (req._json || {});
      if (!b.dataUrl) { try { fs.unlinkSync(avatarPath()); } catch {} json(res, 200, { ok: true }); return; }
      const r = saveDataUrlImage(b.dataUrl, 'avatar', 3 * 1024 * 1024);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      fs.copyFileSync(path.join(ROOT, 'models', path.basename(r.url)), avatarPath());
      pruneUploadFiles(path.join(ROOT, 'models'), 'avatar-', 3);
      try { DATA.track('avatar', ACTIVE_CHAR, avatarPath(), { avatar: true }); } catch {}
      json(res, 200, { ok: true, avatar: '/avatar.png?t=' + Date.now() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/characters') {
      json(res, 200, { characters: listCharacters(), active: ACTIVE_CHAR });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/characters') {
      const b = (req._json || {});
      const action = String(b.action || 'switch');
      if (action === 'new') {
        const id = 'char-' + Date.now().toString(36);
        ensureDirs(id);
        writeJson(path.join(charDir(id), 'meta.json'), { ...META_DEFAULT, name: String(b.name || '新角色') });
        activateCharacter(id);
        json(res, 200, { ok: true, id, characters: listCharacters(), active: id });
        return;
      }
      if (action === 'delete') {
        const id = String(b.id || '');
        if (!id || id === 'default') { json(res, 400, { ok: false, error: '不能删默认角色' }); return; }
        const ids = listCharacters().map((c) => c.id).filter((x) => x !== id);
        if (!ids.length) { json(res, 400, { ok: false, error: '至少要留一个角色' }); return; }
        const wasActive = String(id) === String(ACTIVE_CHAR);
        const targetDir = path.resolve(CHARS_ROOT, id);
        if (!targetDir.startsWith(path.resolve(CHARS_ROOT) + path.sep)) { json(res, 400, { ok: false, error: '非法的角色 id' }); return; }
        fs.rmSync(targetDir, { recursive: true, force: true });
        // 只有删掉当前角色时才切换；删别的角色不能把用户正在用的角色切走
        if (wasActive) activateCharacter(ids.includes('default') ? 'default' : ids[0]);
        json(res, 200, { ok: true, characters: listCharacters(), active: ACTIVE_CHAR });
        return;
      }
      const id = String(b.id || '');
      if (!listCharacters().some((c) => c.id === id)) { json(res, 404, { ok: false, error: '没有这个角色' }); return; }
      activateCharacter(id);
      json(res, 200, { ok: true, active: id, characters: listCharacters(), character: { id, name: loadMeta().name, avatar: fs.existsSync(avatarPath()) ? '/avatar.png?t=' + Date.now() : '/default-avatar.png' } });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/life') { json(res, 200, { life: loadLife() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/life') {
      const b = (req._json || {});
      const life = { ...loadLife(), ...b };
      saveLife(life);
      json(res, 200, { ok: true, life });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/proactive/test') {
      try {
        const meta = loadMeta();
        const cur = currentPlace();
        const recent = messages.filter((m) => m.role === 'user' || m.role === 'her').slice(-6).map((m) => (m.role === 'user' ? '他：' : '你：') + String(m.text).slice(0, 100)).join('\n');
        const resp = await chatCompletion({ messages: [
          { role: 'system', content: '你是' + meta.name + '。你突然想主动找他说话。一句话，25 字以内，像真人发消息，可撒娇/吐槽/分享小事；不要报体力数值、不要列清单、不要问"在吗"。你现在在' + cur.name + '，感觉' + energyWord(loadCharState().energy) + '。' },
          { role: 'user', content: '最近聊的：\n' + (recent || '（没聊什么）') + '\n\n写出你想发的那一句：' },
        ], max_tokens: 120, temperature: 0.95 });
        const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
        let txt = msg ? String(msg.content || '').trim() : '';
        txt = txt.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').split('\n')[0].slice(0, 60);
        if (!txt) { json(res, 500, { ok: false, error: '生成失败' }); return; }
        await streamText(txt); addMessage('her', txt);
        json(res, 200, { ok: true, text: txt });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message || e) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life-tick') {
      autoWanderMaybe(true);
      json(res, 200, { ok: true, place: currentPlace() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/token-saving') { json(res, 200, { saving: loadTokenSaving() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/token-saving') {
      const b = (req._json || {});
      const next = { ...loadTokenSaving() };
      for (const k of Object.keys(TOKEN_SAVING_DEFAULT)) if (typeof b[k] === 'boolean') next[k] = b[k];
      json(res, 200, { ok: true, saving: saveTokenSaving(next) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/chat-style') {
      json(res, 200, { ok: true, style: loadChatStyle() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat-style') {
      const b = (req._json || {});
      const style = saveChatStyle({ noParens: !!b.noParens });
      json(res, 200, { ok: true, style });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pet') {
      json(res, 200, { ok: true, running: petRunning(), pid: petPid(), pet: loadPetCfg() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pet') {
      const b = (req._json || {});
      const patch = {};
      for (const k of ['enabled', 'image', 'size', 'opacity', 'statusText', 'alwaysOnTop', 'gestures', 'buttons', 'expressions']) {
        if (Object.prototype.hasOwnProperty.call(b, k)) patch[k] = b[k];
      }
      const pet = savePetCfg(patch);
      let action = 'saved';
      if (pet.enabled) { const r = await startPet(); action = r.ok ? 'started' : 'start-failed'; }
      else { await stopPet(); action = 'stopped'; }
      json(res, 200, { ok: true, pet, running: petRunning(), action });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pet/image') {
      try {
        const b = (req._json || {});
        const m = String(b.dataUrl || '').match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
        if (!m) { json(res, 400, { ok: false, error: '需要 png/jpeg/webp 图片' }); return; }
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length > 8 * 1024 * 1024) { json(res, 400, { ok: false, error: '图片太大（8MB 以内）' }); return; }
        const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
        const dir = path.join(ROOT, 'pet');
        fs.mkdirSync(dir, { recursive: true });
        for (const oldExt of ['png','jpg','jpeg','webp']) { try { fs.unlinkSync(path.join(dir, 'avatar-custom.' + oldExt)); } catch {} }
        const file = path.join(dir, 'avatar-custom.' + ext);
        fs.writeFileSync(file, buf);
        savePetCfg({ image: file });
        if (petRunning()) { await stopPet(); await startPet(); }
        json(res, 200, { ok: true, image: file });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pet/start') {
      const r = await startPet();
      savePetCfg({ enabled: true });
      json(res, r.ok ? 200 : 500, r);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pet/stop') {
      const r = await stopPet();
      savePetCfg({ enabled: false });
      json(res, 200, r);
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/pet-sprite/')) {
      const name = String(url.pathname.split('/').pop() || '').replace(/\.png$/i, '').replace(/[^a-z0-9_-]/gi, '');
      // 旧资源只按 xiaojing/xiaoke 命名；其它角色退回 default-<表情>.png，再退回任意角色的同表情图，避免新角色没有桌宠图
      const petDir = path.join(RUNTIME_DIR, 'assets', 'pet');
      const candidates = [path.join(petDir, (ACTIVE_CHAR || 'default') + '-' + name + '.png'), path.join(petDir, 'default-' + name + '.png')];
      let p = candidates.find((f) => fs.existsSync(f));
      if (!p) { try { const first = fs.readdirSync(petDir).filter((f) => f.endsWith('-' + name + '.png')).sort()[0]; if (first) p = path.join(petDir, first); } catch {} }
      if (!p) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(p));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pet/manifest') {
      json(res, 200, { ok: true, pet: loadPetCfg(), status: petStatusPayload() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pet/status') {
      // 余额刷新放后台：DeepSeek 余额接口偶尔慢，不能拖住桌宠 700ms/次的切人检测
      try { if (!REAL_BALANCE.at || Date.now() - Number(REAL_BALANCE.at) > 60000) refreshRealBalance().catch(() => {}); } catch {}
      json(res, 200, petStatusPayload());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/pet/avatar') {
      let file = null;
      try { if (fs.existsSync(avatarPath())) file = avatarPath(); } catch {}
      if (!file) { const d = path.join(RUNTIME_DIR, 'pet', 'default-avatar.png'); if (fs.existsSync(d)) file = d; }
      if (!file) { res.writeHead(404); res.end('no avatar'); return; }
      const buf = fs.readFileSync(file);
      const mime = buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : (buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp' : 'image/png');
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      res.end(buf);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pet/act') {
      const b = (req._json || {});
      if (typing) { json(res, 429, { ok: false, error: '她还在说话' }); return; }
      const action = String(b.action || '');
      const manifest = loadPetCfg();
      let prompt = '';
      if (action === 'look') {
        let selfName = '你自己';
        try { selfName = loadMeta().name || selfName; } catch {}
        prompt = `（桌宠按钮）用 pc 工具看看我的屏幕，然后用一句话告诉我你看到了什么。屏幕上可能出现${selfName}自己——桌宠、聊天头像、舞台上的小人、地图上的角色，都是你在屏幕上的样子，不要把自己当成别人或陌生角色。`;
      }
      else if (action === 'chat') { json(res, 200, { ok: true, action: 'chat', prompt: '' }); return; }
      else if (action === 'gesture') {
        const g = (manifest.gestures || []).find((x) => x.id === String(b.gestureId || ''));
        prompt = String((g && g.prompt) || b.prompt || '（你碰了碰她）');
      } else prompt = String(b.prompt || '');
      if (!prompt) { json(res, 400, { ok: false, error: '缺少 prompt' }); return; }
      addMessage('user', prompt, null, action === 'look' ? { hidden: true } : undefined);
      generateReply(buildUserTurnText(prompt, ''));
      json(res, 200, { ok: true, action: action || 'gesture', prompt });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/env/check') {
      try {
        const vboxPaths = [process.env.DSH_COMPANION_VBOX, 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe', 'C:\\Program Files (x86)\\Oracle\\VirtualBox\\VBoxManage.exe'];
        const vbox = vboxPaths.find((p) => { try { return p && fs.existsSync(p); } catch { return false; } });
        const scriptsOk = ['space_ctl.py', 'phone_ctl.py'].every((n) => { try { return fs.existsSync(path.join(ENV_DIR, n)); } catch { return false; } });
        let paramiko = false;
        try {
          paramiko = await new Promise((resolve) => {
            import('node:child_process').then(({ execFile }) => {
              execFile(ENV_PY, ['-c', 'import paramiko; print(1)'], { timeout: 8000, windowsHide: true }, (e, out) => resolve(!e && String(out || '').includes('1')));
            }).catch(() => resolve(false));
          });
        } catch {}
        const phoneOn = await adbDevicePresent();
        let adbKey = false;
        let adbKeyDetail = '手机没开机，无法检测';
        if (phoneOn) {
          const r = await runAdb(['-s', 'emulator-5554', 'shell', 'ime', 'list', '-s'], 15000);
          adbKey = /com\.android\.adbkeyboard/i.test(r.out);
          adbKeyDetail = adbKey ? '已安装' : '未安装（中文输入会失败）';
        }
        const checks = [
          { id: 'dataRoot', label: '数据目录', ok: true, detail: ROOT },
          { id: 'apiKey', label: 'DeepSeek API Key', ok: (() => { try { apiKey(); return true; } catch { return false; } })(), detail: '读取 ~/.dsh 下的 key' },
          { id: 'envDir', label: '辅助脚本目录', ok: scriptsOk, detail: ENV_DIR },
          { id: 'envPy', label: '环境 Python', ok: (() => { try { return ENV_PY === 'python' || fs.existsSync(ENV_PY); } catch { return false; } })(), detail: ENV_PY },
          { id: 'paramiko', label: 'Python 依赖 paramiko', ok: paramiko, detail: 'space/phone 脚本需要' },
          { id: 'virtualbox', label: 'VirtualBox', ok: !!vbox, detail: vbox || '未找到 VBoxManage.exe' },
          { id: 'vm', label: '虚拟机 DSH-Space', ok: await vmRunningNow(), detail: '运行中才能看她的屏幕' },
          { id: 'ssh', label: '虚拟机 SSH (2222)', ok: await probeTcp(2222), detail: '端口转发' },
          { id: 'vnc', label: '虚拟机 VNC (6081)', ok: await probeTcp(6081), detail: '看屏幕用' },
          { id: 'emulator', label: '安卓模拟器', ok: phoneOn, detail: phoneOn ? '已连接' : '未启动' },
          { id: 'adbkeyboard', label: 'ADBKeyboard 中文输入法', ok: adbKey, detail: adbKeyDetail },
          { id: 'ffmpeg', label: 'ffmpeg（选，压缩截图用）', ok: !!ffmpegPath(), detail: ffmpegPath() || '未找到，压缩会跳过' },
        ];
        const hints = [];
        if (!scriptsOk) hints.push('辅助脚本没配好：设置 envDir 或把脚本放到 ' + path.join(RUNTIME_DIR, 'env'));
        if (!paramiko) hints.push('环境 Python 缺 paramiko：在 envDir 的 venv 里 pip install paramiko');
        if (!vbox) hints.push('没装 VirtualBox：完整版需要它跑她的 Linux 桌面');
        if (!phoneOn) hints.push('手机没开机：设置 → 环境 → 启动手机（推荐 Android 16 / API 36 AVD DSH_Phone）');
        if (phoneOn && !adbKey) hints.push('点下方「安装 ADBKeyboard」解决手机中文输入');
        json(res, 200, { ok: true, checks, hints, paths: { dataRoot: ROOT, envDir: ENV_DIR, envPy: ENV_PY, version: VERSION } });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/env/install-adbkeyboard') {
      try {
        const apks = [path.join(ENV_DIR, 'installers', 'ADBKeyboard.apk'), path.join(RUNTIME_DIR, 'env', 'installers', 'ADBKeyboard.apk')];
        const apk = apks.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
        if (!apk) { json(res, 500, { ok: false, error: '没找到 ADBKeyboard.apk（放到 ' + path.join(ENV_DIR, 'installers') + '）' }); return; }
        if (!(await adbDevicePresent())) { json(res, 500, { ok: false, error: '手机没开机，先在设置→环境里启动手机' }); return; }
        const steps = [];
        const r1 = await runAdb(['-s', 'emulator-5554', 'install', '-r', apk], 120000);
        steps.push('install: ' + (r1.ok ? 'OK' : r1.out.slice(0, 120)));
        const r2 = await runAdb(['-s', 'emulator-5554', 'shell', 'ime', 'enable', 'com.android.adbkeyboard/.AdbIME'], 15000);
        steps.push('ime enable: ' + (r2.ok ? 'OK' : r2.out.slice(0, 120)));
        const r3 = await runAdb(['-s', 'emulator-5554', 'shell', 'ime', 'set', 'com.android.adbkeyboard/.AdbIME'], 15000);
        steps.push('ime set: ' + (r3.ok ? 'OK' : r3.out.slice(0, 120)));
        const r4 = await runAdb(['-s', 'emulator-5554', 'shell', 'settings', 'put', 'secure', 'show_ime_with_hard_keyboard', '1'], 15000);
        steps.push('show_ime: ' + (r4.ok ? 'OK' : r4.out.slice(0, 120)));
        json(res, 200, { ok: true, steps });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/env') { json(res, 200, { env: loadEnv(), resources: await resourcesInfo() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/env') {
      const b = (req._json || {});
      const env = { ...loadEnv() };
      for (const k of ['pc', 'space', 'phone']) if (['off', 'gui', 'code'].includes(String(b[k]))) env[k] = b[k];
      if (typeof b.confirmDanger === 'boolean') env.confirmDanger = b.confirmDanger;
      if (['allow', 'deny'].includes(String(b.selfStart))) env.selfStart = b.selfStart;
      saveEnv(env); json(res, 200, { ok: true, env }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/model') { json(res, 200, { model: loadModelCfg(), usage: lastUsage }); return; }
    if (req.method === 'GET' && url.pathname === '/api/chat-bg/custom') {
      const p = chatBgCustomPath();
      if (!p) { res.writeHead(404); res.end('no custom background'); return; }
      const buf = fs.readFileSync(p);
      const mime = buf[0] === 0xFF && buf[1] === 0xD8 ? 'image/jpeg' : (buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : (buf[0] === 0x52 && buf[1] === 0x49 ? 'image/webp' : 'image/jpeg'));
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
      res.end(buf);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat-bg/upload') {
      const b = (req._json || {});
      const m = String(b.image || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
      if (!m) { json(res, 400, { ok: false, error: '请上传 jpg/png/webp 图片' }); return; }
      const buf = Buffer.from(m[2], 'base64');
      if (!buf.length || buf.length > 10 * 1024 * 1024) { json(res, 400, { ok: false, error: '图片太大（最大 10MB）' }); return; }
      const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
      for (const old of ['jpg', 'jpeg', 'png', 'webp']) { try { fs.unlinkSync(path.join(ROOT, 'data', 'chat-bg-custom.' + old)); } catch {} }
      fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'data', 'chat-bg-custom.' + ext), buf);
      CONFIG.chatBackground = 'custom'; saveConfig();
      json(res, 200, { ok: true, current: chatBgCurrent(), options: chatBgOptions() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/ui-theme') {
      json(res, 200, { ok: true, current: uiThemeCurrent(), themes: UI_THEMES });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/ui-theme') {
      const b = (req._json || {});
      const id = String(b.id || '');
      if (!UI_THEMES.some((x) => x.id === id)) { json(res, 400, { ok: false, error: '没有这个配色' }); return; }
      CONFIG.uiTheme = id; saveConfig();
      json(res, 200, { ok: true, current: uiThemeCurrent(), themes: UI_THEMES });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/chat-bg') {
      json(res, 200, { ok: true, current: chatBgCurrent(), options: chatBgOptions() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat-bg') {
      const b = (req._json || {});
      const id = String(b.id || '');
      if (id === 'custom' && !chatBgCustomPath()) { json(res, 400, { ok: false, error: '还没有自定义背景' }); return; }
      if (id !== 'custom' && !CHAT_BACKGROUNDS.some((x) => x.id === id)) { json(res, 400, { ok: false, error: '没有这张背景' }); return; }
      CONFIG.chatBackground = id; saveConfig();
      json(res, 200, { ok: true, current: chatBgCurrent(), options: chatBgOptions() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/image/config') {
      const c = loadImageCfg();
      json(res, 200, { ok: true, config: c });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/image/config') {
      const b = (req._json || {});
      const c = saveImageCfg(b);
      json(res, 200, { ok: true, config: c });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/model/key') {
      const b = (req._json || {});
      const key = String(b.key || '').trim();
      if (key.length < 10) { json(res, 400, { ok: false, error: 'API Key 太短' }); return; }
      try { fs.writeFileSync(path.join(ROOT, 'api-key.txt'), key, { mode: 0o600 }); json(res, 200, { ok: true }); }
      catch (e) { json(res, 500, { ok: false, error: '保存失败' }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/model') {
      const b = (req._json || {});
      const m = { ...loadModelCfg() };
      if (typeof b.name === 'string' && b.name.trim()) m.name = b.name.trim();
      if (['low', 'medium', 'high', 'max'].includes(b.reasoningEffort)) m.reasoningEffort = b.reasoningEffort;
      if (Number.isFinite(Number(b.temperature))) m.temperature = Math.min(1.5, Math.max(0, Number(b.temperature)));
      if (Number.isFinite(Number(b.maxTokens))) m.maxTokens = Math.min(8000, Math.max(200, Math.round(Number(b.maxTokens))));
      if (Number.isFinite(Number(b.maxSteps))) m.maxSteps = Math.min(60, Math.max(4, Math.round(Number(b.maxSteps))));
      saveModelCfg(m); json(res, 200, { ok: true, model: m }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/context') { json(res, 200, { context: loadContext(), historyKeep: 10, summary }); return; }
    if (req.method === 'POST' && url.pathname === '/api/context') {
      const b = (req._json || {});
      const c = { ...loadContext() };
      if (['full', 'short', 'off', 'compact', 'minimal'].includes(b.historyMode)) c.historyMode = b.historyMode;
      if (Number.isFinite(Number(b.memoryInject))) c.memoryInject = Math.max(2, Math.min(20, Math.round(Number(b.memoryInject))));
      saveContext(c); json(res, 200, { ok: true, context: c }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/mode') {
      const detected = await detectMode();
      if (detected.detected) { CONFIG.modeDetected = true; saveConfig(); }
      const override = ['auto', 'chat', 'full'].includes(CONFIG.mode) ? CONFIG.mode : 'auto';
      const eff = override === 'chat' ? 'chat' : override === 'full' ? 'full' : (detected.detected ? 'full' : 'chat');
      json(res, 200, { override, detected, effective: eff });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/mode') {
      const b = (req._json || {});
      if (['auto', 'chat', 'full'].includes(b.override)) { CONFIG.mode = b.override; saveConfig(); }
      const detected = await detectMode();
      const eff = CONFIG.mode === 'chat' ? 'chat' : CONFIG.mode === 'full' ? 'full' : (detected.detected ? 'full' : 'chat');
      json(res, 200, { ok: true, override: CONFIG.mode || 'auto', detected, effective: eff });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/tutorial') { json(res, 200, { text: tutorialText() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/preview') {
      const b = (req._json || {});
      const t = await previewReply(String(b.text || ''));
      json(res, 200, { ok: true, text: t });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/diary') {
      if (url.searchParams.get('date')) { json(res, 200, { date: url.searchParams.get('date'), text: MEM.readDiary(url.searchParams.get('date')) }); return; }
      json(res, 200, { dates: MEM.listDiaries() }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/diary/generate') {
      const text = await generateDiary();
      json(res, 200, { ok: !!text, text });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/diary/show') {
      const text = MEM.readDiary(todayStr());
      if (!text) { json(res, 200, { ok: false, error: '今天还没写日记' }); return; }
      addMessage('user', '（她把日记给你看了）\n' + text);
      json(res, 200, { ok: true });
      return;
    }
    // map
    if (req.method === 'GET' && url.pathname === '/api/map') {
      const map = getActiveMap();
      json(res, 200, {
        maps: loadMaps().map((m) => ({ id: m.id, name: m.name, placeCount: m.places.length })), activeMapId: map.id,
        map: { id: map.id, name: map.name, places: map.places, widthMeters: map.widthMeters, transport: map.transport, theme: map.theme, model: map.model || null, image: map.image || null, displayMode: map.displayMode || '2d', roads: map.roads || null, vehicles: map.vehicles || null, has2d: map.has2d !== false && !!(map.image && map.image.url), has3d: map.has3d === true || !!(map.model && map.model.url) },
        transports: TRANSPORTS, longTransports: ['coach', 'rail', 'plane'],
        capabilities: charCapabilities(), weather: weatherNow(), weathers: WEATHERS, energy: loadCharState().energy,
        location: currentPlace(), schedules: (loadLife().schedules || []).map((s, i) => ({ ...s, index: i, place: s.place || guessPlaceId(s.label) })),
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/vm-chat/settings') {
      json(res, 200, { ok: true, settings: { enabled: false, checkMessages: true, autoStart: true, idleShutdown: true, checkIntervalMin: 15, ...(CONFIG.vmChat || {}) } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vm-chat/settings') {
      const b = (req._json || {});
      const cur = { ...(CONFIG.vmChat || {}) };
      if (typeof b.enabled === 'boolean') cur.enabled = b.enabled;
      if (typeof b.checkMessages === 'boolean') cur.checkMessages = b.checkMessages;
      if (typeof b.autoStart === 'boolean') cur.autoStart = b.autoStart;
      if (typeof b.idleShutdown === 'boolean') cur.idleShutdown = b.idleShutdown;
      if (Number.isFinite(Number(b.checkIntervalMin))) cur.checkIntervalMin = Math.max(2, Math.min(1440, Number(b.checkIntervalMin)));
      CONFIG.vmChat = cur; saveConfig();
      json(res, 200, { ok: true, settings: cur });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/vm-chat/status') {
      try { json(res, 200, { ok: true, status: await VM_CHAT.status() }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vm-chat/wake') {
      try { json(res, 200, { ok: await VM_CHAT.wake(), running: await VM_CHAT.isRunning() }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vm-chat/check') {
      try {
        const result = await VM_CHAT.checkAndReply();
        recordVmCheckFor(ACTIVE_CHAR, result);
        json(res, 200, { ok: true, result });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/vm-chat/send') {
      const b = (req._json || {});
      try { json(res, 200, { ok: true, result: await VM_CHAT.sendText(String(b.text || '')) }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/scene/settings') {
      json(res, 200, { ok: true, ai: CONFIG.sceneActivityAI !== false, photoChance: Math.max(0, Math.min(1, Number(CONFIG.scenePhotoChance ?? 0.25))), minGapMinutes: 5, cacheMinutes: 10 });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/scene/settings') {
      const b = (req._json || {});
      if (typeof b.ai === 'boolean') { CONFIG.sceneActivityAI = b.ai; saveConfig(); }
      if (Number.isFinite(Number(b.photoChance))) { CONFIG.scenePhotoChance = Math.max(0, Math.min(1, Number(b.photoChance))); saveConfig(); }
      json(res, 200, { ok: true, ai: CONFIG.sceneActivityAI !== false, photoChance: Math.max(0, Math.min(1, Number(CONFIG.scenePhotoChance ?? 0.25))) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/scene/activity') {
      const r = await sceneActivityFor(safeCharId(url.searchParams.get('character')) || ACTIVE_CHAR, url.searchParams.get('placeId') || '', url.searchParams.get('hotspotId') || '');
      json(res, r.ok ? 200 : 404, r);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/scene/focus') {
      const b = (req._json || {});
      if (!b.placeId) { CONFIG.sceneFocus = null; saveConfig(); json(res, 200, { ok: true, focus: null }); return; }
      const found = scenePlaceAndHotspot(String(b.placeId), String(b.hotspotId || ''));
      if (!found) { json(res, 404, { ok: false, error: '地点不存在' }); return; }
      CONFIG.sceneFocus = { mapId: found.map.id, placeId: found.place.id, placeName: found.place.name, hotspotId: found.hotspot ? found.hotspot.id : '', hotspotLabel: found.hotspot ? found.hotspot.label : '', at: Date.now() };
      saveConfig();
      json(res, 200, { ok: true, focus: CONFIG.sceneFocus });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/life/settings') {
      json(res, 200, { ok: true, settings: lifeSimCfg() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/social') {
      try { const r = await lifeSocialTick(true); json(res, 200, { ok: true, result: r }); } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/act') {
      const b = (req._json || {});
      const st = lifeAct(safeCharId(b.characterId) || ACTIVE_CHAR, b.placeId || '', b.hotspotId || '');
      json(res, st ? 200 : 404, st ? { ok: true, state: st } : { ok: false, error: '地点或热点不存在' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/position') {
      const b = (req._json || {});
      const st = lifeSetPosition(safeCharId(b.characterId) || ACTIVE_CHAR, b.x, b.y);
      json(res, st ? 200 : 404, st ? { ok: true, state: st } : { ok: false, error: '没有生活状态' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/test-image') {
      const b = (req._json || {});
      try {
        const cid = safeCharId(b.characterId) || ACTIVE_CHAR;
        const prompt = String(b.imagePrompt || '日常手机美食照片，温馨小镇的一餐，自然光，生活感，无文字无 UI').slice(0, 800);
        const useRef = b.withIdentity === true || /(她|自己|我|人像|自拍|照片里|角色)/.test(prompt);
        const img = await generateImageFile(prompt, { size: '1024x1024', image: useRef ? (avatarDataUrl(cid) || undefined) : undefined });
        const text = String(b.message || '给你看看今天吃的。').slice(0, 120);
        addMessageFor(String(b.characterId || ACTIVE_CHAR), 'her', text, img);
        json(res, 200, { ok: true, image: img, text });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/travel/options') {
      const from = getActiveMap();
      const maps = loadMaps();
      const wallet = walletMoney();
      const options = maps.filter((m) => m.id !== from.id).map((m) => {
        const km = intercityDistanceKm(from, m);
        const modes = ['coach', 'rail', 'plane'].map((mode) => {
          const fare = transportFare(mode, km * 1000);
          const speed = (TRANSPORTS[mode] || TRANSPORTS.rail).speed;
          const sch = travelSchedule(mode);
          return { mode, label: (TRANSPORTS[mode] || {}).label, icon: (TRANSPORTS[mode] || {}).icon, fare, minutes: Math.max(1, Math.round((km * 1000) / speed / 60)), canAfford: wallet.spendable >= fare, nextDeparture: sch.departAt, waitMinutes: sch.waitMinutes, delayMinutes: sch.delayMinutes };
        });
        return { id: m.id, name: m.name, km: Math.round(km), modes };
      });
      json(res, 200, { ok: true, from: { id: from.id, name: from.name }, wallet, options });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/travel/ticket') {
      const b = (req._json || {});
      const mode = String(b.mode || '');
      const sch = travelSchedule(mode);
      const wait = Number.isFinite(Number(b.waitMinutes)) ? Math.min(1440, Math.max(0, Number(b.waitMinutes))) : sch.waitMinutes;
      const delay = Number.isFinite(Number(b.delayMinutes)) ? Math.min(1440, Math.max(0, Number(b.delayMinutes))) : sch.delayMinutes;
      const loc = moveToMap(String(b.mapId || ''), { mode, manual: true, extraDelayMs: (wait + delay) * 60000 });
      json(res, 200, loc && loc.refused ? { ok: false, refused: true, reason: loc.reason, location: currentPlace() } : { ok: true, location: loc });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/life/states') {
      const list = listCharacters().map((c) => {
        const st = lifeGetState(c.id);
        return st ? { ...st, name: c.name, avatar: c.avatar } : null;
      }).filter(Boolean);
      json(res, 200, { ok: true, states: list });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/life/state') {
      const st = lifeGetState(safeCharId(url.searchParams.get('character')) || ACTIVE_CHAR);
      json(res, st ? 200 : 404, st ? { ok: true, state: st } : { ok: false, error: '角色不在任何地点' });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/settings') {
      const b = (req._json || {});
      CONFIG.lifeSim = { ...(CONFIG.lifeSim || {}) };
      for (const k of ['enabled']) if (typeof b[k] === 'boolean') CONFIG.lifeSim[k] = b[k];
      for (const k of ['minEventGapMin', 'maxDaily', 'quietStart', 'quietEnd', 'photoChance']) if (Number.isFinite(Number(b[k]))) CONFIG.lifeSim[k] = Number(b[k]);
      saveConfig();
      json(res, 200, { ok: true, settings: lifeSimCfg() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/life/tick') {
      try {
        const st = await lifeTick(safeCharId(url.searchParams.get('character')) || ACTIVE_CHAR, { force: true });
        json(res, 200, { ok: true, state: st });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/map/preview') {
      const maps = loadMaps();
      const id = String(url.searchParams.get('mapId') || activeMapId());
      const map = maps.find((m) => m.id === id);
      if (!map) { json(res, 404, { ok: false, error: '没有这张地图' }); return; }
      json(res, 200, {
        ok: true, map, activeMapId: activeMapId(),
        maps: maps.map((m) => ({ id: m.id, name: m.name, placeCount: (m.places || []).length, image: m.image || null })),
        location: currentPlace(),
      });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/world/characters') {
      json(res, 200, { characters: worldCharacters(), activeMapId: getActiveMap().id });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map') {
      const b = (req._json || {});
      if (!guardRev(res, 'maps', ACTIVE_CHAR, b.expectedRev)) return;
      const maps = loadMaps();
      const id = String(b.mapId || activeMapId());
      const m = maps.find((x) => x.id === id);
      if (!m) { json(res, 404, { ok: false, error: '没有这张地图' }); return; }
      if (typeof b.name === 'string' && b.name.trim()) m.name = b.name.trim().slice(0, 20);
      if (b.widthMeters !== undefined) m.widthMeters = Math.max(200, Math.min(20000, Number(b.widthMeters) || 2000));
      if (b.transport !== undefined) m.transport = (TRANSPORTS[b.transport] || b.transport === 'auto') ? b.transport : 'auto';
      if (b.theme !== undefined) m.theme = ['town', 'coast', 'city', 'forest'].includes(b.theme) ? b.theme : 'town';
      if (['2d', '3d'].includes(b.displayMode)) m.displayMode = b.displayMode;
       if (b.vehicles !== undefined) m.vehicles = normalizeVehicles(b.vehicles);
       if (b.has3d !== undefined) m.has3d = !!b.has3d;
      if (b.roads !== undefined) m.roads = normalizeRoads(b.roads);
      if (b.image !== undefined) m.image = b.image && b.image.url ? { url: String(b.image.url).slice(0, 300) } : null;
      if (b.model !== undefined) m.model = b.model && b.model.url ? { url: String(b.model.url).slice(0, 300), scale: Number(b.model.scale) || 1, rotationY: Number(b.model.rotationY) || 0, yOffset: Number(b.model.yOffset) || 0 } : null;
      if (Array.isArray(b.places)) {
        m.places = b.places.slice(0, 40).map((p) => ({ id: String(p.id || ('p-' + Math.random().toString(36).slice(2, 7))).slice(0, 40), name: String(p.name || '未命名').slice(0, 20), icon: String(p.icon || '📍').slice(0, 4), x: Math.max(0.05, Math.min(0.95, Number(p.x) || 0.5)), y: Math.max(0.08, Math.min(0.92, Number(p.y) || 0.5)), desc: String(p.desc || '').slice(0, 80), feel: String(p.feel || '').slice(0, 80), image: p.image && String(p.image).startsWith('/models/') ? String(p.image) : null, scene: normalizeScene(p.scene) }));
      }
      if (Array.isArray(b.schedules)) {
        const life = loadLife();
        const assigns = new Map(b.schedules.map((s) => [Number(s.index), String(s.place || '')]));
        life.schedules = (life.schedules || []).map((s, i) => assigns.has(i) ? { ...s, place: assigns.get(i) } : s);
        saveLife(life);
      }
      saveMaps(maps);
      json(res, 200, { ok: true, current: currentPlace() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map/create') {
      const b = (req._json || {});
      const maps = loadMaps();
      const id = 'map-' + Date.now().toString(36);
      maps.push({ id, name: String(b.name || '新地图').slice(0, 20), places: DEFAULT_PLACES.map((p) => ({ ...p })), widthMeters: 2000, transport: 'auto', theme: 'town', displayMode: '2d', image: { url: '/official-map.jpg' }, has3d: false });
      saveMaps(maps);
      json(res, 200, { ok: true, id, maps: loadMaps().map((mm) => ({ id: mm.id, name: mm.name, placeCount: mm.places.length })) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map/delete') {
      const b = (req._json || {});
      const maps = loadMaps().filter((m) => m.id !== String(b.id));
      if (!maps.length) { json(res, 400, { ok: false, error: '至少保留一张地图' }); return; }
      saveMaps(maps);
      if (!maps.some((m) => m.id === CONFIG.activeMapId)) { CONFIG.activeMapId = maps[0].id; saveConfig(); }
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map/activate') {
      const b = (req._json || {});
      const loc = moveToMap(String(b.id || ''), { mode: b.mode, instant: !!b.instant, confirmNight: !!b.confirmNight });
      if (loc && loc.refused) { json(res, 200, { ok: false, refused: true, needsConfirm: !!loc.needsConfirm, reason: loc.reason, location: currentPlace() }); return; }
      json(res, 200, { ok: true, location: loc });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map/import') {
      const b = (req._json || {});
      const maps = loadMaps();
      const map = maps.find((m) => m.id === (b.mapId || activeMapId())) || maps[0];
      const content = String(b.content || '').trim();
      const ICONS = ['🏠', '🏫', '🏢', '📚', '🌳', '☕', '🍚', '🛒', '🏥', '🏦', '🚉', '✈️', '🎬', '🏬', '🏋️', '📖', '💻', '🌉', '🏞️', '⛰️', '🍜', '🍰', '🍺', '🎮', '🎤', '🌃', '🏪', '💊', '🎪', '🚏'];
      const guess = (name) => { const hints = [['家|宿舍|卧室', '🏠'], ['学校|教室', '🏫'], ['公司|办公', '🏢'], ['图书馆|自习', '📚'], ['公园|花园', '🌳'], ['咖啡', '☕'], ['食堂|饭|餐', '🍚'], ['超市|商场|购物', '🛒'], ['医院|诊所|药', '🏥'], ['银行', '🏦'], ['车站|地铁', '🚉'], ['机场', '✈️'], ['电影', '🎬'], ['健身', '🏋️'], ['书店', '📖'], ['网吧|电脑', '💻'], ['桥', '🌉'], ['河|湖|海', '🏞️'], ['山', '⛰️'], ['酒吧', '🍺'], ['游戏', '🎮'], ['KTV|唱歌', '🎤']]; for (const [re, ic] of hints) { try { if (new RegExp(re).test(name)) return ic; } catch {} } return ICONS[Math.floor(Math.random() * ICONS.length)]; };
      const existing = new Set(map.places.map((x) => String(x.name)));
      const items = [];
      if (content.startsWith('[') || content.startsWith('{')) {
        try {
          const parsed = JSON.parse(content);
          if (!Array.isArray(parsed) && Array.isArray(parsed.roads)) map.roads = normalizeRoads(parsed.roads);
          const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.places) ? parsed.places : [parsed]);
          for (const it of arr) if (it && it.name) items.push(it);
        } catch { json(res, 400, { ok: false, error: 'JSON 解析失败' }); return; }
      } else {
        for (const line of content.split(/\r?\n/)) {
          const s = line.trim(); if (!s || s.startsWith('#') || s.startsWith('//')) continue;
          const parts = (s.includes('\t') ? s.split('\t') : s.split(',')).map((x) => x.trim());
          if (!parts[0] || /^(名字|name)$/i.test(parts[0])) continue;
          items.push({ name: parts[0], icon: parts[1], x: parts[2], y: parts[3], desc: parts[4], feel: parts[5] });
        }
      }
      let added = 0, skipped = 0;
      for (const it of items) {
        const name = String(it.name || '').trim(); if (!name) continue;
        if (existing.has(name)) { skipped++; continue; }
        map.places.push({ id: 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6), name, icon: String(it.icon || '').trim() || guess(name), x: Number.isFinite(Number(it.x)) ? Math.max(0.04, Math.min(0.96, Number(it.x))) : 0.2 + Math.random() * 0.6, y: Number.isFinite(Number(it.y)) ? Math.max(0.08, Math.min(0.92, Number(it.y))) : 0.15 + Math.random() * 0.7, desc: String(it.desc || ''), feel: String(it.feel || ''), image: it.image && String(it.image).startsWith('/models/') ? String(it.image) : null });
        existing.add(name); added++;
      }
      saveMaps(maps);
      json(res, 200, { ok: true, added, skipped, total: map.places.length, places: map.places });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/scene/image') {
      try {
        const b = (req._json || {});
        const r = saveDataUrlImage(b.dataUrl, 'scene', 12 * 1024 * 1024);
        if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
        json(res, 200, { ok: true, url: r.url });
      } catch (e) { json(res, 500, { ok: false, error: String(e.message) }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/map/image') {
      const b = (req._json || {});
      const maps = loadMaps();
      const map = maps.find((m) => m.id === (b.mapId || activeMapId())) || maps[0];
      if (!b.dataUrl) { map.image = null; saveMaps(maps); json(res, 200, { ok: true, url: '' }); return; }
      const r = saveDataUrlImage(b.dataUrl, 'map-' + String(map.id).replace(/[^a-z0-9-]/gi, ''), 12 * 1024 * 1024);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      map.image = { url: r.url }; saveMaps(maps);
      json(res, 200, { ok: true, url: r.url });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/place/image') {
      const b = (req._json || {});
      const maps = loadMaps();
      const map = maps.find((m) => m.id === (b.mapId || activeMapId())) || maps[0];
      const place = map.places.find((p) => p.id === b.placeId);
      if (!place) { json(res, 404, { ok: false, error: '地点不存在' }); return; }
      if (!b.dataUrl) { place.image = null; saveMaps(maps); json(res, 200, { ok: true, image: '' }); return; }
      const r = saveDataUrlImage(b.dataUrl, 'place-' + String(place.id).replace(/[^a-z0-9-]/gi, ''), 6 * 1024 * 1024);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      place.image = r.url; saveMaps(maps);
      json(res, 200, { ok: true, image: r.url, places: map.places });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/location') { json(res, 200, { location: currentPlace() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/location') {
      const b = (req._json || {});
      const loc = moveTo(String(b.placeId || ''), { mapId: b.mapId, manual: true, mode: b.mode, instant: !!b.instant, confirmNight: !!b.confirmNight });
      if (loc && loc.refused) { json(res, 200, { ok: false, refused: true, needsConfirm: !!loc.needsConfirm, reason: loc.reason, location: currentPlace() }); return; }
      json(res, 200, { ok: true, location: loc });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/routine') {
      json(res, 200, { routine: loadRoutine(), visits: loadVisits(), places: getActiveMap().places.map((p) => ({ id: p.id, name: p.name, icon: p.icon })), character: loadMeta().name });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/routine') {
      const b = (req._json || {});
      json(res, 200, { ok: true, routine: saveRoutine(b) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/weather') {
      const mode = CONFIG.weatherMode === 'real' ? 'real' : 'manual';
      const real = mode === 'real' ? await getRealWeather() : null;
      const manual = WEATHERS[CONFIG.weather] ? CONFIG.weather : 'sunny';
      const kind = mode === 'real' ? (real.kind || manual) : manual;
      json(res, 200, { mode, manual, kind, label: WEATHERS[kind].label, icon: WEATHERS[kind].icon, temp: real ? real.temp : null, city: real ? real.city : null, source: real ? real.source : 'manual', weathers: WEATHERS, fx: loadWeatherFx() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/weather') {
      const b = (req._json || {});
      if (b.mode === 'real' || b.mode === 'manual') CONFIG.weatherMode = b.mode;
      if (b.manual && WEATHERS[b.manual]) CONFIG.weather = b.manual;
      saveConfig();
      const real = CONFIG.weatherMode === 'real' ? await getRealWeather(!!b.refresh) : null;
      const kind = CONFIG.weatherMode === 'real' ? (real.kind || CONFIG.weather || 'sunny') : (CONFIG.weather || 'sunny');
      json(res, 200, { ok: true, mode: CONFIG.weatherMode || 'manual', kind, temp: real ? real.temp : null, city: real ? real.city : null, source: real ? real.source : 'manual' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/weatherfx') { json(res, 200, { ok: true, fx: loadWeatherFx(), kinds: Object.keys(WEATHERS) }); return; }
    if (req.method === 'POST' && url.pathname === '/api/weatherfx') {
      const b = (req._json || {});
      const kind = String(b.kind || '');
      if (!WEATHERS[kind]) { json(res, 400, { ok: false, error: '未知天气' }); return; }
      CONFIG.weatherFx = CONFIG.weatherFx || {};
      if (b.clear) delete CONFIG.weatherFx[kind];
      else CONFIG.weatherFx[kind] = { type: String(b.type || 'image'), url: String(b.url || ''), opacity: Math.max(0.05, Math.min(1, Number(b.opacity) || 1)) };
      saveConfig();
      json(res, 200, { ok: true, fx: CONFIG.weatherFx });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/weatherfx/upload') {
      const b = (req._json || {});
      const kind = String(b.kind || '');
      if (!WEATHERS[kind]) { json(res, 400, { ok: false, error: '未知天气' }); return; }
      const r = saveDataUrlImage(b.dataUrl, 'wxfx-' + kind, 20 * 1024 * 1024);
      if (!r.ok) { json(res, 400, { ok: false, error: r.error }); return; }
      CONFIG.weatherFx = CONFIG.weatherFx || {};
      CONFIG.weatherFx[kind] = { type: /\.(mp4|webm)$/i.test(r.url) ? 'video' : 'image', url: r.url, opacity: 1 };
      saveConfig();
      json(res, 200, { ok: true, fx: CONFIG.weatherFx[kind] });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/economy') {
      if (!REAL_BALANCE.at || Date.now() - REAL_BALANCE.at > 60000) { try { await refreshRealBalance(); } catch {} }
      const econ = loadEconomy(); const w = walletMoney();
      json(res, 200, { ok: true, economy: econ, realBalance: REAL_BALANCE, wallet: { balance: w.wallet.balance, spendable: w.spendable, tokenMode: w.tokenMode, remainingTokens: w.remainingTokens, usedTokens: w.wallet.usedTokens, moneyType: w.moneyType } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/economy') {
      const b = (req._json || {});
      const econ = loadEconomy();
      for (const k of ['initialBalance', 'dailyIncome', 'wagePerHour', 'mealCost', 'entertainmentCost', 'tokenBudget', 'tokensPerYuan']) if (Number.isFinite(Number(b[k]))) econ[k] = Math.max(0, Number(b[k]));
      if (typeof b.enabled === 'boolean') econ.enabled = b.enabled;
      if (b.moneyType === 'virtual' || b.moneyType === 'token') econ.moneyType = b.moneyType;
      if (typeof b.tokenMode === 'boolean') econ.tokenMode = b.tokenMode;
      saveEconomy(econ);
      json(res, 200, { ok: true, economy: econ, wallet: walletMoney() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/wallet/spend') {
      const b = (req._json || {});
      const r = spendMoney(Number(b.amount) || 0, String(b.item || ''));
      json(res, 200, { ok: r.ok, result: r, wallet: walletMoney() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      streamClients.add(res);
      try { res.write('data: ' + JSON.stringify({ type: 'init', active: streamState.active, text: streamState.text }) + '\n\n'); } catch {}
      req.on('close', () => { streamClients.delete(res); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/watch-screen') { json(res, 200, { ok: true, watch: loadWatchScreen() }); return; }
    if (req.method === 'POST' && url.pathname === '/api/watch-screen') {
      const b = (req._json || {});
      const patch = {};
      if (typeof b.enabled === 'boolean') patch.enabled = b.enabled;
      if (Number.isFinite(Number(b.minMinutes))) patch.minMinutes = Math.min(120, Math.max(5, Math.round(Number(b.minMinutes))));
      if (Number.isFinite(Number(b.maxMinutes))) patch.maxMinutes = Math.min(240, Math.max(10, Math.round(Number(b.maxMinutes))));
      if (patch.minMinutes !== undefined && patch.maxMinutes !== undefined && patch.maxMinutes < patch.minMinutes) patch.maxMinutes = patch.minMinutes;
      json(res, 200, { ok: true, watch: saveWatchScreen(patch) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/stage') { json(res, 200, stagePayload()); return; }
    if (req.method === 'GET' && url.pathname === '/api/stage/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const send = () => { try { res.write('data: ' + JSON.stringify(stagePayload()) + '\n\n'); } catch {} };
      send(); const t = setInterval(send, 1000); req.on('close', () => clearInterval(t));
      return;
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    const status = (e && Number(e.statusCode)) || 500;
    const msg = status === 400 ? '请求格式不正确' : '服务器内部错误';
    if (status >= 500) { try { console.error('[companion] request failed:', e); } catch {} }
    try { json(res, status, { ok: false, error: msg }); } catch {}
  }
});

function stagePayload() {
  const map = getActiveMap();
  const cur = currentPlace();
  const meta = loadMeta();
  const real = CONFIG.weatherMode === 'real' && weatherCache.data;
  const weather = real ? { source: 'real', kind: weatherCache.data.kind, temp: weatherCache.data.temp, city: weatherCache.data.city } : { source: 'manual', kind: weatherNow(), temp: null, city: null };
  const w = WEATHERS[weather.kind] || WEATHERS.sunny;
  const state = cur.intercity ? 'intercity' : (cur.traveling ? 'traveling' : 'stationary');
  let wallet = null;
  try { const m = walletMoney(); const t = tokenStats(); wallet = { balance: m.wallet.balance, spendable: m.spendable, tokenMode: m.tokenMode, remainingTokens: m.remainingTokens, moneyType: m.moneyType, realRmb: m.realRmb, realBalanceKnown: m.realBalanceKnown, dailyUsed: t.dailyUsed, usedTokens: t.usedTokens, tokenBudget: t.tokenBudget }; } catch {}
  return {
    ok: true, apiVersion: 1, serverTime: Date.now(),
    character: { id: ACTIVE_CHAR, name: meta.name || '', avatar: fs.existsSync(avatarPath()) ? '/avatar.png' : '/default-avatar.png', sprite: meta.sprite || '/pet-sprite/idle.png', chibi: meta.chibi || null, model: meta.model || { type: 'none', url: '', scale: 1 }, age: Number(meta.age) || null, license: meta.license === true },
    map: { id: map.id, name: map.name, theme: map.theme || 'town', widthMeters: Number(map.widthMeters) || 2000, places: map.places.map((p) => ({ id: p.id, name: p.name, icon: p.icon, image: p.image || null, x: p.x, y: p.y, desc: p.desc || '', feel: p.feel || '' })), model: map.model || null, image: map.image || null, displayMode: map.displayMode || '2d', roads: map.roads || null, vehicles: map.vehicles || null, has2d: map.has2d !== false && !!(map.image && map.image.url), has3d: map.has3d === true || !!(map.model && map.model.url) },
    location: { state, placeId: cur.placeId, placeName: cur.name, icon: cur.icon, since: cur.since || Date.now(), minutes: cur.minutes || 0, traveling: cur.traveling || null, intercity: cur.intercity || null, avatar: cur.avatar || '' },
    weather: { kind: weather.kind, label: w.label, icon: w.icon, temp: weather.temp, city: weather.city, source: weather.source, fx: loadWeatherFx() },
    energy: loadCharState().energy, wallet,
    settings: { weatherMode: CONFIG.weatherMode === 'real' ? 'real' : 'manual', smartRoutine: loadRoutine().smart === true, smartLife: loadLife().smartLife === true, locationFree: loadLife().locationFree !== false },
    animationHint: state === 'stationary' ? (cur.placeId === 'home' && (new Date().getHours() >= 23 || new Date().getHours() < 7) ? 'sleeping' : 'idle') : (cur.traveling ? 'walking' : 'riding'),
  };
}

// ---------- startup ----------
function writePortFile(port) { writeJson(PORT_FILE, { port, root: ROOT, pid: process.pid, version: VERSION, at: Date.now() }); }
function tryListen(port, attempt = 0) {
  server.once('error', (e) => {
    if (e && e.code === 'EADDRINUSE' && attempt < 20) { setTimeout(() => tryListen(port + 1, attempt + 1), 200); }
    else { console.error('[companion] listen error', e && e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    LISTEN_PORT = port;
    console.log('[companion] http://127.0.0.1:' + port + '/  root=' + ROOT);
    writePortFile(port);
    try { if (loadPetCfg().enabled) setTimeout(() => { startPet().catch(() => {}); }, 800); } catch {}
  });
}

function boot() {
  // 迁移：老版本 data/messages.json
  fs.mkdirSync(CHARS_ROOT, { recursive: true });
  if (!fs.readdirSync(CHARS_ROOT).filter((n) => fs.statSync(path.join(CHARS_ROOT, n)).isDirectory()).length) {
    const id = 'default';
    ensureDirs(id);
    writeJson(path.join(charDir(id), 'meta.json'), { ...META_DEFAULT });
    fs.writeFileSync(path.join(charDir(id), 'persona.md'), PERSONA_DEFAULT, 'utf8');
    const legacy = readJson(path.join(ROOT, 'data', 'messages.json'), []);
    if (Array.isArray(legacy) && legacy.length) writeJson(path.join(charDir(id), 'messages.json'), legacy);
  }
  ACTIVE_CHAR = activeCharId();
  activateCharacter(ACTIVE_CHAR);
  loadMessages();
  refreshRealBalance().catch(() => {});
  setInterval(() => refreshRealBalance().catch(() => {}), 5 * 60 * 1000).unref?.();
  // 后台心跳
  setInterval(() => {
    try {
      if (loadLife().enabled === false) return;
      const cur = currentPlace();
      if (cur.traveling || cur.intercity) return;
      if (messages.filter((m) => m.role !== 'system').length < 2) return;
      autoWanderMaybe();
    } catch {}
  }, 6 * 60 * 1000).unref?.();
  setInterval(() => {
    try {
      const h = new Date().getHours();
      const life = loadLife();
      if (life.diaryAuto !== false && h === Number(life.diaryHour ?? 22) && !MEM.hasDiary(todayStr())) generateDiary().catch(() => {});
    } catch {}
  }, 5 * 60 * 1000).unref?.();
  // 自动备份：每天 4 点后第一次心跳备份一次
  setInterval(async () => {
    try {
      const h = new Date().getHours();
      if (h < 4) return;
      const today = todayStr();
      if (CONFIG.backupDate === today) return;
      const res = await runBackup();
      if (res && res.ok) { CONFIG.backupDate = today; saveConfig(); }
    } catch {}
  }, 30 * 60 * 1000).unref?.();
  if (CONFIG.weatherMode === 'real') getRealWeather().catch(() => {});
  // 主动消息：她偶尔自己找你说话（可在 设置→生活 里关）
  let nextProactiveAt = 0;
  const scheduleNextProactive = () => {
    const life = loadLife();
    const min = Math.max(5, Number(life.proactiveMinMin) || 30);
    const max = Math.max(min, Number(life.proactiveMaxMin) || 90);
    nextProactiveAt = Date.now() + (min + Math.random() * (max - min)) * 60 * 1000;
  };
  scheduleNextProactive();
  setInterval(async () => {
    try {
      const life = loadLife();
      if (life.enabled === false || life.proactiveEnabled !== true) return;
      if (typing || busy) return;
      const h = new Date().getHours();
      const qs = Number(life.quietStart ?? 2), qe = Number(life.quietEnd ?? 7);
      const quiet = qs <= qe ? (h >= qs && h < qe) : (h >= qs || h < qe);
      if (quiet) return;
      if (Date.now() < nextProactiveAt) return;
      const lastHer = [...messages].reverse().find((m) => m.role === 'her');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (lastUser && Date.now() - Number(lastUser.at || 0) < 20 * 60 * 1000) { scheduleNextProactive(); return; }
      const meta = loadMeta();
      const cur = currentPlace();
      const recent = messages.filter((m) => m.role === 'user' || m.role === 'her').slice(-6).map((m) => (m.role === 'user' ? '他：' : '你：') + String(m.text).slice(0, 100)).join('\n');
      const resp = await chatCompletion({
        messages: [
          { role: 'system', content: '你是' + meta.name + '。现在你一个人待着，突然想主动找他说句话。\n要求：一句话，25 字以内，像真人发消息；可以撒娇/吐槽/分享小事/想他；不要报体力数值，不要说"记录"这种；不要问"在吗"；不要列清单。\n你现在的状态：在' + cur.name + '，感觉' + (typeof energyWord === 'function' ? energyWord(loadCharState().energy) : '还好') + '。' + (() => { try { const f = CONFIG.sceneFocus; if (f && String(f.mapId) === String(getActiveMap().id) && String(f.placeId) === String(cur.placeId)) return `你现在在「${f.placeName}」${f.hotspotLabel ? '的「' + f.hotspotLabel + '」旁边' : ''}，可以自然提到正在做的事，或者偶尔问他一个小问题，但不要每次都这样。`; } catch {} return ''; })() },
          { role: 'user', content: '最近聊的：\n' + (recent || '（没聊什么）') + '\n\n请写出你想发的那一句话：' },
        ],
        max_tokens: 120, temperature: 0.95,
      });
      const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
      let txt = msg ? String(msg.content || '').trim() : '';
      txt = txt.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').split('\n')[0].slice(0, 60);
      if (txt) {
        let photo = null;
        try {
          const f = CONFIG.sceneFocus;
          // 没有打开场景时，也按当前所在地点判断主动发图
          const focusPlaceId = (f && String(f.mapId) === String(getActiveMap().id)) ? String(f.placeId) : String(cur.placeId || '');
          const focusHotspotId = (f && String(f.mapId) === String(getActiveMap().id)) ? String(f.hotspotId || '') : '';
          if (focusPlaceId) {
            const found = scenePlaceAndHotspot(focusPlaceId, focusHotspotId);
            const photos = found && found.place && found.place.scene && Array.isArray(found.place.scene.photos) ? found.place.scene.photos : [];
            const photoChance = Math.max(0, Math.min(1, Number(CONFIG.scenePhotoChance ?? 0.25)));
            if (photos.length && Math.random() < photoChance && Date.now() - Number(CONFIG.lastScenePhotoAt || 0) > 90 * 60 * 1000) {
              photo = photos[Math.floor(Math.random() * photos.length)];
              CONFIG.lastScenePhotoAt = Date.now();
              saveConfig();
            }
            if (!photo && Date.now() - Number(CONFIG.lastScenePhotoAt || 0) > 90 * 60 * 1000 && Math.random() < photoChance) {
              const cfg = loadImageCfg();
              if (cfg.enabled && cfg.apiKeySet) {
                const spot = found.hotspot ? found.hotspot.label : '';
                const prompt = `日常手机照片，${meta.name}在${found.place.name}${spot ? '的' + spot + '旁边' : ''}，自然抓拍，光线柔和，生活感，不摆拍，画面里不要文字和 UI。`;
                photo = await generateImageFile(prompt, { size: '1024x1024' });
                CONFIG.lastScenePhotoAt = Date.now();
                saveConfig();
              }
            }
          }
        } catch {}
        await streamText(txt);
        addMessage('her', txt, photo || undefined);
      }
    } catch {}
    scheduleNextProactive();
  }, 60 * 1000).unref?.();

  // 她的屏幕守护：VNC 链路掉了自动修复（不主动开虚拟机）
  let lastEnsureAt = 0;
  setInterval(async () => {
    try {
      if (Date.now() - lastEnsureAt < 5 * 60 * 1000) return;
      if (!(await vmRunningNow())) return;
      if (await probeTcp(6081)) return;
      lastEnsureAt = Date.now();
      runPy('space_ensure.py', ['ensure'], 45000).catch(() => {});
    } catch {}
  }, 60 * 1000).unref?.();
  // 后台生活模拟：即使不打开地图，也会按自己的时间推进
  try {
    for (const c of listCharacters()) { try { lifeGetState(c.id); } catch {} }
    setTimeout(async () => { for (const c of listCharacters()) { try { await lifeTick(c.id); } catch {} } }, 15000);
    setInterval(async () => { for (const c of listCharacters()) { try { await lifeTick(c.id); } catch {} } }, 30 * 1000).unref?.();
    setInterval(() => { lifeSocialTick(false).catch(() => {}); }, 5 * 60 * 1000).unref?.();
    setInterval(async () => {
      try {
        const vc = CONFIG.vmChat || {};
        if (!vc.enabled || vc.checkMessages === false) return;
        const min = Math.max(2, Number(vc.checkIntervalMin) || 15) * 60 * 1000;
        if (Date.now() - Number(vc.lastCheckAt || 0) < min) return;
        CONFIG.vmChat.lastCheckAt = Date.now(); saveConfig();
        const r = await VM_CHAT.checkAndReply();
        if (r && r.ok) recordVmCheckFor(ACTIVE_CHAR, { result: r });
        if (r && r.ok && vc.idleShutdown !== false) { try { await VM_CHAT.stop(); } catch {} }
      } catch {}
    }, 60 * 1000).unref?.();
  } catch {}
  tryListen(PREFERRED_PORT);
}
async function watchScreenTick() {
  try {
    const w = loadWatchScreen();
    if (!w.enabled || typing || busy) return;
    const env = loadEnv();
    if (env.pc === 'off') return;
    try { if (!kernelState()) return; } catch { return; }
    if (!w.nextAt) { saveWatchScreen({ nextAt: Date.now() + Math.round((Number(w.minMinutes) || 20) * 60000) }); return; }
    if (Date.now() < Number(w.nextAt)) return;
    saveWatchScreen({ nextAt: Date.now() + Math.round((Number(w.minMinutes) || 20) * 60000 * (0.8 + Math.random() * 0.4)) });
    let selfName = '你自己';
    try { selfName = loadMeta().name || selfName; } catch {}
    const prompt = `（她有点好奇你在做什么，趁你不注意悄悄瞥了一眼你的屏幕。用 pc 工具看看，只简单说你看到了什么，不要直接替他回答问题、不要下结论、不要操作；然后停下来观察他后面有没有接话。如果没什么特别的就别说话。屏幕上可能出现${selfName}自己——桌宠、聊天头像、舞台上的小人、地图上的角色，都是你在屏幕上的样子，不要把自己当成别人。不要提“截图”“桌宠按钮”或这条提示。）`;
    addMessage('user', prompt, null, { hidden: true });
    await generateReply(prompt);
  } catch {}
}
setInterval(watchScreenTick, 60 * 1000).unref?.();

boot();
