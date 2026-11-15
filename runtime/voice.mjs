/**
 * 语音合成（TTS）—— 0.8.3 最小实现
 *
 * 定位：**只要一个能用的声音**。音色能力全部走 provider 接口，交给用户自己接。
 *   · sapi —— Windows 内置语音，离线、免 Key、默认（本机实测 zh-CN Huihui 可用，几十毫秒）
 *   · http —— 万能口子：POST {text,voice,speed,pitch,format} → 音频二进制
 *             用户的 GPT-SoVITS(api_v2) / CosyVoice / OpenAI 兼容 / 云厂商 TTS 都能接
 *   · edge —— 未实现（本机实测 WSS 握手上就 1006 连不通）；见 docs/VOICE-FEATURE-TASKS.md
 *
 * 配置：CONFIG.voice（全局）+ <dataRoot>/voice/characters/<角色Id>.json（每角色覆盖，接口保留）
 * 缓存：<dataRoot>/voice/audio/<hash>.<ext>；总大小/条数有上限，超了删最旧
 * 密钥：只接受引用 apiKeyRef = env:VAR / file:<路径>；明文 Key 不落 voice.json、不进日志
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const VOICE_PROVIDERS = [
  { id: 'sapi', name: 'Windows 内置语音（离线、免 Key）', needsEndpoint: false },
  { id: 'volc', name: '火山引擎 · 豆包语音（App ID + Access Token）', needsEndpoint: false },
  { id: 'openai', name: 'OpenAI 兼容 /audio/speech（OpenAI、SiliconFlow 等）', needsEndpoint: true },
  { id: 'http', name: '自建 TTS 服务（HTTP，自定义协议）', needsEndpoint: true },
];

export const VOICE_DEFAULTS = {
  enabled: false,          // 总开关：她的回复要不要生成语音
  provider: 'sapi',
  voice: '',               // sapi 留空=系统中文音色；volc=voice_type；openai=alloy 等
  speed: 1.0,              // 0.5 ~ 2.0
  pitch: 0,                // 透传给 provider（SAPI 不支持，忽略）
  format: 'wav',           // sapi 固定 wav；http 按响应头自动判断；volc/openai 固定 mp3
  maxChars: 300,           // 单条最多读多少个字
  endpoint: '',            // http / openai 的地址（openai 填 base URL）
  method: 'POST',
  headers: {},             // http provider 的自定义请求头
  apiKeyRef: '',           // env:VAR / file:<path>（只存引用）：http/openai 的 Key、volc 的 Access Token 或新版 API Key
  appId: '',               // volc：App ID（旧版应用 ID，或新版控制台「服务管理」页顶部的 APP ID）
  cluster: 'volcano_tts',  // volc 旧版 v1：集群（声音复刻是 volcano_icl）
  resourceId: 'seed-tts-2.0', // volc 新版 v3：资源 ID（seed-tts-2.0 / seed-tts-1.0 / volc.megatts.default）
  model: 'tts-1',          // openai：模型名
};

const AUDIO_EXT = ['wav', 'mp3', 'ogg', 'm4a', 'webm'];
const CACHE_MAX_BYTES = 200 * 1024 * 1024;
const CACHE_MAX_FILES = 2000;
const SAPI_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'env', 'tts-sapi.ps1');

function clamp(n, lo, hi, dflt) {
  const v = Number(n);
  if (!isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, v));
}

// P2-14：上游错误经常是半截 JSON。UI 只该看到人话 + 下一步，原始细节留在日志/详情里。
export function friendlyVoiceError(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s) return '语音通道没有返回可用音频';
  if (/45000030|resource[_ -]?id|资源.*(不匹配|未开通|不匹配)|speaker.*resource|音色.*(不匹配|未开通)/i.test(s)) {
    return '火山语音通道配置异常：资源 ID 与音色不匹配或未开通（45000030）。可以到「设置 → 角色 → 语音」改用 Windows 内置语音，或换一个和资源匹配的音色。';
  }
  if (/401|403|unauthorized|invalid.*(key|token)|鉴权|无权限/i.test(s)) {
    return '语音服务鉴权失败：检查 Key / Token 是否有权限；也可以先用 Windows 内置语音。';
  }
  if (/timeout|timed out|超时|连不上|ECONN|fetch failed|network/i.test(s)) {
    return '语音服务连接失败或超时；可以检查网络/服务地址，或先用 Windows 内置语音。';
  }
  // 如果还带着 JSON，尽量只取 code/message，不要把整段 body 塞进聊天。
  if (/^[\[{]/.test(s)) {
    try {
      const j = JSON.parse(s);
      const msg = j && (j.message || (j.header && j.header.message) || (j.error && j.error.message));
      const code = j && (j.code || (j.header && j.header.code));
      if (msg) return String(msg).slice(0, 120) + (code ? '（' + code + '）' : '');
    } catch (e) {}
    return '语音服务返回了无法解析的错误；可以切换到 Windows 内置语音。';
  }
  return s.slice(0, 140);
}

// 文本清洗：TTS 只该念人话
export function cleanTextForTts(input, maxChars) {
  let s = String(input == null ? '' : input);
  if (!s) return '';
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(/```[\s\S]*?```/g, ' ');            // 代码块整段丢掉
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');       // 图片
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');     // 链接留标题
  s = s.replace(/https?:\/\/\S+/gi, ' ');            // 裸链接
  s = s.replace(/(^|\s)#{1,6}\s*/g, ' ');            // 标题号
  s = s.replace(/[*_~`>|]/g, '');                    // markdown 记号
  // 动作旁白：(笑) （叹气） [停顿] —— 括号里的整段不念
  s = s.replace(/[（(][^）)]{0,40}[）)]/g, ' ');
  s = s.replace(/[\[【][^\]】]{0,40}[\]】]/g, ' ');
  // 引号只去壳留内容
  s = s.replace(/[「」『』“”"]/g, '');
  // 常见 emoji / 符号
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ');
  s = s.replace(/[ \t\u00a0]+/g, ' ');
  s = s.replace(/\n{2,}/g, '\n');
  s = s.trim();
  const max = clamp(maxChars, 20, 2000, 300);
  if (s.length > max) {
    const cut = s.slice(0, max);
    const at = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
    s = (at > max * 0.5 ? cut.slice(0, at + 1) : cut).trim();
  }
  return s;
}

// 只允许受控文件名（防目录穿越）
export function isSafeAudioName(name) {
  return /^[a-f0-9]{40}\.(wav|mp3|ogg|m4a|webm)$/i.test(String(name || ''));
}

function mimeOfExt(ext) {
  return ext === 'mp3' ? 'audio/mpeg'
    : ext === 'ogg' ? 'audio/ogg'
      : ext === 'm4a' ? 'audio/mp4'
        : ext === 'webm' ? 'audio/webm'
          : 'audio/wav';
}

function runSapi({ script, textFile, outFile, voice, rate, timeoutMs }) {
  return new Promise((resolve) => {
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Text', textFile, '-Out', outFile, '-Rate', String(rate)];
    if (voice) args.push('-Voice', voice);
    execFile('powershell.exe', args, { timeout: timeoutMs || 25000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, error: err ? String(stderr || err.message || '').trim().slice(0, 300) : '' });
    });
  });
}

// WAV 时长：data 字节 / byteRate（拿不准就返回 null，前端 <audio> 自己也能算）
function wavDuration(buf) {
  try {
    if (buf.length < 44 || buf.slice(0, 4).toString() !== 'RIFF') return null;
    const byteRate = buf.readUInt32LE(28);
    if (!byteRate) return null;
    return Math.round(((buf.length - 44) / byteRate) * 100) / 100;
  } catch (e) { return null; }
}

export function createVoice(deps) {
  const dataRoot = deps.dataRoot;
  const log = deps.log || (() => {});
  const configGet = deps.getConfig || (() => ({}));
  const configSave = deps.saveConfig || (() => {});
  const voiceRoot = path.join(dataRoot, 'voice');
  const audioDir = path.join(voiceRoot, 'audio');
  const charOverrideDir = path.join(voiceRoot, 'characters');
  const tmpDir = path.join(voiceRoot, 'tmp');
  for (const d of [audioDir, charOverrideDir, tmpDir]) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }

  let queue = Promise.resolve();   // 合成串行，别一次开一堆 powershell

  function sanitize(raw) {
    const v = Object.assign({}, VOICE_DEFAULTS);
    const src = raw && typeof raw === 'object' ? raw : {};
    if (src.enabled !== undefined) v.enabled = !!src.enabled;
    if (VOICE_PROVIDERS.some((p) => p.id === String(src.provider))) v.provider = String(src.provider);
    if (src.voice !== undefined) v.voice = String(src.voice || '').slice(0, 120);
    if (src.speed !== undefined) v.speed = clamp(src.speed, 0.5, 2, 1);
    if (src.pitch !== undefined) v.pitch = clamp(src.pitch, -50, 50, 0);
    if (src.format !== undefined) {
      const f = String(src.format || '').toLowerCase();
      if (AUDIO_EXT.includes(f)) v.format = f;
    }
    if (src.maxChars !== undefined) v.maxChars = clamp(src.maxChars, 20, 2000, 300);
    if (src.endpoint !== undefined) v.endpoint = String(src.endpoint || '').trim().slice(0, 500);
    if (src.appId !== undefined) v.appId = String(src.appId || '').trim().slice(0, 60);
    if (src.cluster !== undefined) v.cluster = String(src.cluster || 'volcano_tts').trim().slice(0, 40);
    if (src.resourceId !== undefined) v.resourceId = String(src.resourceId || 'seed-tts-2.0').trim().slice(0, 60);
    if (src.model !== undefined) v.model = String(src.model || 'tts-1').trim().slice(0, 80);
    if (src.method !== undefined) v.method = String(src.method || 'POST').toUpperCase() === 'PUT' ? 'PUT' : 'POST';
    if (src.headers && typeof src.headers === 'object') {
      const h = {};
      for (const k of Object.keys(src.headers).slice(0, 12)) {
        const key = String(k || '').trim();
        const val = String(src.headers[k] == null ? '' : src.headers[k]).slice(0, 500);
        if (key && !/[\r\n]/.test(key) && !/[\r\n]/.test(val)) h[key] = val;
      }
      v.headers = h;
    }
    if (src.apiKeyRef !== undefined) {
      const ref = String(src.apiKeyRef || '').trim().slice(0, 300);
      v.apiKeyRef = /^(env:|file:)/i.test(ref) ? ref : '';
    }
    return v;
  }

  function globalSettings() {
    const c = configGet() || {};
    return sanitize(c.voice);
  }

  // 每角色覆盖（接口保留；第一版 UI 只写全局）
  function charOverridePath(characterId) {
    const id = String(characterId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
    return id ? path.join(charOverrideDir, id + '.json') : '';
  }
  function settingsFor(characterId) {
    const base = globalSettings();
    const p = charOverridePath(characterId);
    if (!p || !fs.existsSync(p)) return base;
    try {
      const over = JSON.parse(fs.readFileSync(p, 'utf8'));
      return sanitize(Object.assign({}, base, over));
    } catch (e) { return base; }
  }
  function saveGlobalSettings(patch) {
    const next = sanitize(Object.assign({}, globalSettings(), patch || {}));
    const c = configGet();
    c.voice = next;
    configSave();
    return next;
  }
  function saveCharOverride(characterId, patch) {
    const p = charOverridePath(characterId);
    if (!p) throw new Error('角色 id 不合法');
    const cur = settingsFor(characterId);
    const next = sanitize(Object.assign({}, cur, patch || {}));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(next, null, 1), 'utf8');
    return next;
  }

  function resolveKey(ref) {
    const s = String(ref || '');
    if (!s) return '';
    if (/^env:/i.test(s)) return String(process.env[s.slice(4)] || '');
    if (/^file:/i.test(s)) {
      try { return fs.readFileSync(s.slice(5), 'utf8').trim(); } catch (e) { return ''; }
    }
    return '';
  }

  function cleanup() {
    try {
      const names = fs.readdirSync(audioDir);
      let total = 0;
      const items = [];
      for (const n of names) {
        const f = path.join(audioDir, n);
        let st;
        try { st = fs.statSync(f); } catch { continue; }
        if (!st.isFile()) continue;
        total += st.size;
        items.push({ f, size: st.size, at: st.mtimeMs });
      }
      let count = items.length;
      if (total <= CACHE_MAX_BYTES && count <= CACHE_MAX_FILES) return { removed: 0, total, count };
      items.sort((a, b) => a.at - b.at);
      let removed = 0;
      for (const it of items) {
        if (total <= CACHE_MAX_BYTES * 0.8 && count <= CACHE_MAX_FILES * 0.8) break;
        try { fs.unlinkSync(it.f); total -= it.size; count -= 1; removed += 1; } catch {}
      }
      return { removed, total, count };
    } catch (e) { return { removed: 0, total: 0, count: 0 }; }
  }

  function cleanupTmp() {
    try {
      const now = Date.now();
      for (const n of fs.readdirSync(tmpDir)) {
        const f = path.join(tmpDir, n);
        try { if (now - fs.statSync(f).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(f); } catch {}
      }
    } catch {}
  }

  async function synthWithSapi(text, cfg) {
    const id = crypto.randomUUID();
    const textFile = path.join(tmpDir, id + '.txt');
    const outFile = path.join(tmpDir, id + '.wav');
    fs.writeFileSync(textFile, text, 'utf8');
    // speed 1.0 → Rate 0；0.5 → -5；2.0 → +10 左右
    const rate = Math.round((clamp(cfg.speed, 0.5, 2, 1) - 1) * 10);
    try {
      const r = await runSapi({ script: SAPI_SCRIPT, textFile, outFile, voice: cfg.voice, rate });
      if (!r.ok) return { ok: false, error: 'Windows 语音合成失败：' + (r.error || '未知原因') };
      if (!fs.existsSync(outFile)) return { ok: false, error: 'Windows 语音没有产出音频文件' };
      const buf = fs.readFileSync(outFile);
      if (buf.length < 200) return { ok: false, error: 'Windows 语音产出的音频是空的' };
      return { ok: true, buf, ext: 'wav', provider: 'sapi' };
    } finally {
      try { fs.unlinkSync(textFile); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
    }
  }

  async function synthWithHttp(text, cfg) {
    if (!/^https?:\/\//i.test(cfg.endpoint)) return { ok: false, configError: true, error: '还没有填 TTS 服务地址（http provider）' };
    const headers = Object.assign({ 'content-type': 'application/json' }, cfg.headers || {});
    const key = resolveKey(cfg.apiKeyRef);
    if (key) {
      const hasAuth = Object.keys(headers).some((k) => k.toLowerCase() === 'authorization');
      if (!hasAuth) headers.authorization = 'Bearer ' + key;
    }
    const body = JSON.stringify({ text, voice: cfg.voice, speed: cfg.speed, pitch: cfg.pitch, format: cfg.format });
    let res;
    try {
      res = await fetch(cfg.endpoint, { method: cfg.method, headers, body, signal: AbortSignal.timeout(30000) });
    } catch (e) {
      return { ok: false, error: '连不上 TTS 服务：' + String((e && e.message) || e).slice(0, 160) };
    }
    if (!res.ok) return { ok: false, error: 'TTS 服务返回 HTTP ' + res.status };
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: 'TTS 服务返回了空音频' };
    if (ctype.includes('json') || (buf[0] === 0x7b && buf.length < 4096)) {
      return { ok: false, error: 'TTS 服务返回的是 JSON，不是音频（约定：直接回音频二进制）' };
    }
    let ext = 'wav';
    if (ctype.includes('mpeg') || ctype.includes('mp3')) ext = 'mp3';
    else if (ctype.includes('ogg')) ext = 'ogg';
    else if (ctype.includes('mp4') || ctype.includes('m4a')) ext = 'm4a';
    else if (ctype.includes('webm')) ext = 'webm';
    else if (buf.slice(0, 3).toString() === 'ID3') ext = 'mp3';
    else if (buf.slice(0, 4).toString() === 'OggS') ext = 'ogg';
    else if (buf.slice(0, 4).toString() === 'RIFF') ext = 'wav';
    return { ok: true, buf, ext, provider: 'http' };
  }

  // 火山引擎 · 豆包语音（新版控制台 v3：API Key + App ID + 资源 ID，返回 base64 音频）
  async function synthWithVolcV3(text, cfg, token) {
    const url = /^https?:\/\//i.test(cfg.endpoint) ? cfg.endpoint : 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
    const headers = {
      'content-type': 'application/json',
      'X-Api-Key': token,
      'X-Api-Resource-Id': cfg.resourceId || 'seed-tts-2.0',
    };
    if (cfg.appId) headers['X-Api-App-Id'] = String(cfg.appId);
    const speed = Math.max(0.2, Math.min(3, Number(cfg.speed) || 1));
    const body = {
      user: { uid: 'dsh-screen-beyond' },
      req_params: {
        text: text,
        speaker: cfg.voice || 'zh_female_gaolengyujie_uranus_bigtts',
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: Math.round((speed - 1) * 100) },
      },
    };
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
    } catch (e) {
      return { ok: false, error: '连不上火山语音：' + String((e && e.message) || e).slice(0, 160) };
    }
    const raw = await res.text();
    // 正常是若干行 JSON，每行可能带一段 base64；结束标记 code=20000000
    const parts = [];
    let failure = '';
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      let j = null;
      try { j = JSON.parse(s) } catch (e) { continue; }
      if (j.code === 0 && j.data) parts.push(j.data);
      else if (j.code && j.code !== 20000000) failure = j.message || ('code ' + j.code);
    }
    if (!parts.length) {
      let hint = failure;
      if (!hint) {
        try {
          const j = JSON.parse(raw);
          const h = j && (j.header || {});
          hint = h.message || j.message || ('code ' + (h.code || j.code || '?'));
        } catch (e) { hint = raw; }
      }
      return { ok: false, error: friendlyVoiceError('火山 v3 没返回音频：' + String(hint || '未知原因')), rawError: String(hint || '').slice(0, 300) };
    }
    let buf = null;
    try { buf = Buffer.from(parts.join(''), 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length < 100) return { ok: false, error: '火山返回的音频是空的' };
    return { ok: true, buf, ext: 'mp3', provider: 'volc' };
  }

  // 火山引擎 · 豆包语音（openspeech v1：App ID + Access Token，返回 JSON 里的 base64 音频）
  async function synthWithVolc(text, cfg) {
    const token = resolveKey(cfg.apiKeyRef);
    if (!token) return { ok: false, configError: true, error: '还没配 Key：apiKeyRef 填 env:变量名 或 file:密钥文件路径' };
    // 有 resourceId（默认有）→ 走新版 v3；没有 → 走旧版 v1
    if (cfg.resourceId) return await synthWithVolcV3(text, cfg, token);
    if (!cfg.appId) return { ok: false, configError: true, error: '旧版 v1 需要 App ID 和 Access Token' };
    const body = {
      app: { appid: String(cfg.appId), token: token, cluster: cfg.cluster || 'volcano_tts' },
      user: { uid: 'dsh-screen-beyond' },
      audio: {
        voice_type: cfg.voice || 'zh_female_shuangkuaisisi_moon_bigtts',
        encoding: 'mp3',
        speed_ratio: Math.max(0.2, Math.min(3, Number(cfg.speed) || 1)),
        volume_ratio: 1,
        pitch_ratio: 1,
      },
      request: { reqid: crypto.randomUUID(), text: text, text_type: 'plain', operation: 'query' },
    };
    let res;
    try {
      // endpoint 可覆盖（自建网关/测试用），默认官方地址
      const url = /^https?:\/\//i.test(cfg.endpoint) ? cfg.endpoint : 'https://openspeech.bytedance.com/api/v1/tts';
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer; ' + token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      return { ok: false, error: '连不上火山语音：' + String((e && e.message) || e).slice(0, 160) };
    }
    let j = null;
    try { j = await res.json(); } catch (e) { j = null; }
    if (!j) return { ok: false, error: '火山返回的不是 JSON（HTTP ' + res.status + '）' };
    if (Number(j.code) !== 3000) {
      return { ok: false, error: '火山语音报错：' + String(j.message || ('code ' + j.code)).slice(0, 160) };
    }
    let buf = null;
    try { buf = Buffer.from(String(j.data || ''), 'base64'); } catch (e) { buf = null; }
    if (!buf || buf.length < 100) return { ok: false, error: '火山返回的音频是空的' };
    return { ok: true, buf, ext: 'mp3', provider: 'volc' };
  }

  // OpenAI 兼容的 /audio/speech（OpenAI、SiliconFlow 等；火山方舟目前没有这个路由）
  async function synthWithOpenAI(text, cfg) {
    if (!/^https?:\/\//i.test(cfg.endpoint)) return { ok: false, configError: true, error: '还没填服务地址（openai provider 填 base URL，例如 https://api.openai.com/v1）' };
    const key = resolveKey(cfg.apiKeyRef);
    if (!key) return { ok: false, configError: true, error: '还没配密钥：apiKeyRef 填 env:变量名 或 file:路径' };
    const base = cfg.endpoint.replace(/\/+$/, '');
    const url = /\/audio\/speech$/i.test(base) ? base : base + '/audio/speech';
    const body = {
      model: cfg.model || 'tts-1',
      input: text,
      voice: cfg.voice || 'alloy',
      response_format: 'mp3',
      speed: Math.max(0.25, Math.min(4, Number(cfg.speed) || 1)),
    };
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000),
      });
    } catch (e) {
      return { ok: false, error: '连不上语音服务：' + String((e && e.message) || e).slice(0, 160) };
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200) } catch (e) {}
      return { ok: false, error: '语音服务返回 HTTP ' + res.status + (detail ? '：' + detail.replace(/\s+/g, ' ') : '') };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) return { ok: false, error: '语音服务返回了空音频' };
    let ext = 'mp3';
    if (buf.slice(0, 4).toString() === 'RIFF') ext = 'wav';
    else if (buf.slice(0, 4).toString() === 'OggS') ext = 'ogg';
    return { ok: true, buf, ext, provider: 'openai' };
  }

  // 合成一条；命中缓存直接返回
  async function synth(text, opts) {
    const characterId = (opts && opts.characterId) || '';
    const cfg = settingsFor(characterId);
    const clean = cleanTextForTts(text, cfg.maxChars);
    if (!clean) return { ok: false, error: '这段没有可读的文字' };
    const provider = ['http', 'volc', 'openai'].includes(cfg.provider) ? cfg.provider : 'sapi';
    const hash = crypto.createHash('sha1')
      .update([provider, cfg.voice, cfg.speed, cfg.pitch, cfg.format, clean].join('\u0001'))
      .digest('hex');
    const existing = AUDIO_EXT.map((e) => hash + '.' + e).find((n) => fs.existsSync(path.join(audioDir, n)));
    if (existing && !(opts && opts.noCache)) {
      return { ok: true, cached: true, provider, audio: '/voice/audio/' + existing, ext: path.extname(existing).slice(1), text: clean };
    }
    const run = queue.then(async () => {
      let r = provider === 'volc' ? await synthWithVolc(clean, cfg)
        : provider === 'openai' ? await synthWithOpenAI(clean, cfg)
          : provider === 'http' ? await synthWithHttp(clean, cfg)
            : await synthWithSapi(clean, cfg);
      // 云端 provider 失败时自动回退到 Windows 自带语音（P1-1）：
      // 火山资源/音色不匹配、网络抖动、Key 配错，都不该让每条回复挂红字；
      // 回退成功会带 fallbackFrom/fallbackReason，面板显示“已改用 Windows 语音”，
      // 用户可在设置里换回真正的云端通道。只有 SAPI 也失败才报错。
      let fallbackFrom = '';
      let fallbackReason = '';
      if (!r.ok && provider !== 'sapi') {
        fallbackReason = friendlyVoiceError(r.error);
        const alt = await synthWithSapi(clean, cfg);
        if (alt.ok) { fallbackFrom = provider; r = alt; }
      }
      if (!r.ok) return { ...r, error: friendlyVoiceError(r.error) };
      const name = hash + '.' + r.ext;
      const out = path.join(audioDir, name);
      try { fs.writeFileSync(out, r.buf); } catch (e) { return { ok: false, error: '写音频失败：' + String(e.message || e) }; }
      cleanup();
      cleanupTmp();
      return {
        ok: true, cached: false, provider: r.provider, audio: '/voice/audio/' + name,
        ext: r.ext, bytes: r.buf.length, duration: r.ext === 'wav' ? wavDuration(r.buf) : null, text: clean,
        ...(fallbackFrom ? { fallbackFrom, fallbackReason } : {}),
      };
    });
    queue = run.catch(() => {});
    return run;
  }

  // 给一条 her 消息挂音频（异步、失败只记日志，绝不影响文字）
  function attachAudio(msg, onUpdate) {
    if (!msg || msg.role !== 'her') return Promise.resolve(null);
    const cfg = settingsFor(deps.activeCharacter ? deps.activeCharacter() : '');
    if (!cfg.enabled) return Promise.resolve(null);
    const text = String(msg.text || '');
    if (!text.trim()) return Promise.resolve(null);
    return synth(text, { characterId: deps.activeCharacter ? deps.activeCharacter() : '' }).then((r) => {
      if (!r || !r.ok) {
        // P2-14：失败只留可读原因，不把上游半截 JSON 塞进聊天。
        msg.voiceError = friendlyVoiceError((r && r.error) || '语音生成失败');
        delete msg.voiceWarning;
        if (onUpdate) onUpdate({ id: msg.id, voiceError: msg.voiceError, voiceWarning: null });
        try { deps.persistMessage && deps.persistMessage(msg); } catch {}
        return null;
      }
      msg.audio = r.audio;
      msg.audioProvider = r.provider;
      msg.audioVoice = cfg.voice || 'default';
      if (r.duration) msg.audioDuration = r.duration;
      // P1-1：云端通道失败但已经自动用 Windows 内置语音补上 → 不挂红字，只留一条可读提示。
      if (r.fallbackFrom) {
        msg.voiceWarning = '语音通道 ' + r.fallbackFrom + ' 不可用，已自动改用 Windows 内置语音（' + (r.fallbackReason || '原因见设置') + '）';
        delete msg.voiceError;
      } else {
        delete msg.voiceWarning;
        delete msg.voiceError;
      }
      if (onUpdate) onUpdate({ id: msg.id, audio: msg.audio, audioProvider: msg.audioProvider, audioVoice: msg.audioVoice, audioDuration: msg.audioDuration || null, voiceWarning: msg.voiceWarning || null, voiceError: null });
      // 回写历史，让下次打开面板/换角色回来还能点播放
      try { deps.persistMessage && deps.persistMessage(msg); } catch {}
      return r;
    }).catch((e) => {
      log('挂语音失败：' + String(e && e.message ? e.message : e));
      return null;
    });
  }

  return {
    providers: () => VOICE_PROVIDERS,
    defaults: VOICE_DEFAULTS,
    settingsFor,
    saveGlobalSettings,
    saveCharOverride,
    synth,
    attachAudio,
    resolveFile: (name) => (isSafeAudioName(name) ? path.join(audioDir, name) : ''),
    mimeFor: (name) => mimeOfExt(String(name).split('.').pop()),
    audioDir,
    cacheStats: () => cleanup(),
    cleanText: cleanTextForTts,
  };
}
