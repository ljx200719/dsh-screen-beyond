/**
 * OneBot 11 直连适配器（纯传输层）
 *
 * 这是什么：
 *  - 用户自己在电脑上跑一个 OneBot 11 实现（NapCat / Lagrange / go-cqhttp 等）并登录自己的 QQ；
 *    本插件只按 OneBot 11 的 HTTP API 和它说话，**不内置、不捆绑、不下载、不启动任何桥或第三方可执行文件**。
 *  - 这个模块只做传输：配置读写、连不上/超时的判断、发私聊文字和图片、解析私聊事件、拉一点历史消息。
 *    什么时候回、回什么、失败后要不要退回虚拟机通道，都由 server.mjs 决定（这里不做任何业务判断）。
 *
 * 接口（server.mjs 按这个签名调用）：
 *  createDirectChat({ getConfig, saveConfig, log }) -> {
 *    cfg(), setSettings(partial),
 *    status(), listFriends(), sendText(text), sendImage(filePathOrDataUrl, caption),
 *    parseEvent(body), probeHistory(sinceMessageId)
 *  }
 *
 * 配置放在 CONFIG.directChat，默认：
 *  { enabled:false, apiBase:'http://127.0.0.1:3000', token:'', userId:'', selfId:'',
 *    autoReply:true, sendImages:true, fallbackVm:true, replyPrefix:'', timeoutMs:8000 }
 *  - apiBase ：OneBot HTTP 服务的地址（末尾斜杠会被去掉）。
 *  - token   ：OneBot HTTP 服务的 access token；空表示不鉴权。
 *  - userId  ：要发消息给谁（对方 QQ 号，只允许数字或空）。
 *  - selfId  ：她自己登录的 QQ 号（可选，补事件里缺失的 self_id）。
 *  - autoReply / fallbackVm：业务开关，本模块只负责保存，由 server.mjs 读取使用。
 *  - sendImages：本模块的 sendImage 会检查它；false 时拒绝发图。
 *  - replyPrefix：回复前缀，本模块不自动拼接（留给 server.mjs 决定拼在哪）。
 *  - timeoutMs：单次 HTTP 请求超时，夹在 1000~30000 毫秒。
 *
 * 约定：
 *  - 纯 ESM，只用 Node 内置能力（全局 fetch），没有任何第三方依赖。
 *  - 所有方法都不向调用方抛异常；网络/协议失败一律转成中文 error。
 *  - 日志里不打印 token，最多显示 apiBase 和 token:'***'。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 配置默认值（与 task-8 契约一致）。 */
const DEFAULTS = {
  enabled: false,
  apiBase: 'http://127.0.0.1:3000',
  token: '',
  userId: '',
  selfId: '',
  autoReply: true,
  sendImages: true,
  fallbackVm: true,
  replyPrefix: '',
  timeoutMs: 8000,
};

const BOOLEAN_KEYS = ['enabled', 'autoReply', 'sendImages', 'fallbackVm'];
const TIMEOUT_MIN = 1000;
const TIMEOUT_MAX = 30000;

/** 布尔值解析：只有真正的 boolean 才覆盖默认值。 */
function boolOr(value, dflt) {
  return typeof value === 'boolean' ? value : dflt;
}

/** 超时时间夹紧到 1000~30000 毫秒。 */
function normTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULTS.timeoutMs;
  return Math.min(TIMEOUT_MAX, Math.max(TIMEOUT_MIN, Math.round(n)));
}

/** QQ 号：只接受 1~20 位数字字符串，其它一律当空。 */
function digitsOr(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  return /^\d{1,20}$/.test(s) ? s : '';
}

/**
 * 校验并规整 OneBot HTTP 地址：
 * 必须 http:// 或 https:// 开头、能被 URL 解析、有 host；末尾斜杠去掉（方便拼 /action）。
 * 无效返回 ''（调用方保留原值）。
 */
function normApiBase(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  if (!s || !/^https?:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (!u.host) return '';
    return s.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

/** 从响应体里取 message_id（不同实现字段名略有差异），没有就返回 ''。 */
function messageIdOf(data) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const v = d.message_id ?? d.messageId ?? d.msg_id ?? d.id;
  return v === undefined || v === null ? '' : String(v);
}

/** OneBot 事件里的 message 段：取图片段并收集到 out.images。 */
function pushImage(out, file, url, subType) {
  const f = String(file === undefined || file === null ? '' : file).trim();
  const u = String(url === undefined || url === null ? '' : url).trim();
  if (!f && !u) return;
  const img = { file: f || u };
  if (u) img.url = u;
  const st = subType === undefined || subType === null ? '' : String(subType).trim();
  if (st) img.subType = st;
  out.images.push(img);
}

/** 解析 CQ 码属性串：file=xxx,url=yyy，顺带还原常见的 HTML 实体转义。 */
function parseCqAttrs(raw) {
  const attrs = {};
  for (const part of String(raw || '').split(',')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1)
      .replace(/&#44;/g, ',')
      .replace(/&#91;/g, '[')
      .replace(/&#93;/g, ']')
      .replace(/&amp;/g, '&');
    if (k) attrs[k] = v;
  }
  return attrs;
}

/** 兼容少数用 CQ 码字符串而不是 message 数组的实现（把图片段挑出来，正文去掉 CQ 码）。 */
function collectCq(text, out) {
  const src = String(text || '');
  const re = /\[CQ:([a-zA-Z_]+)(?:,([^\]]*))?\]/g;
  let plain = '';
  let last = 0;
  let m = re.exec(src);
  while (m) {
    plain += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1].toLowerCase() === 'image') {
      const attrs = parseCqAttrs(m[2] || '');
      pushImage(out, attrs.file, attrs.url, attrs.sub_type ?? attrs.subType);
    }
    m = re.exec(src);
  }
  plain += src.slice(last);
  out.text += plain;
}

/**
 * 收集一条消息的正文与图片。
 * 返回 true 表示 message 字段本身可识别（数组/字符串/简单对象），false 表示需要回退到 raw_message。
 */
function collectMessageSegments(message, out) {
  if (Array.isArray(message)) {
    for (const seg of message) {
      if (!seg || typeof seg !== 'object') continue;
      const type = String(seg.type || '');
      const data = seg.data && typeof seg.data === 'object' ? seg.data : {};
      if (type === 'text') {
        out.text += String(data.text ?? '');
      } else if (type === 'image') {
        pushImage(out, data.file, data.url, data.sub_type ?? data.subType);
      }
      // 其它段（at/face/reply/...）对私聊文字回复没用，忽略即可
    }
    return true;
  }
  if (typeof message === 'string') {
    collectCq(message, out);
    return true;
  }
  if (message && typeof message === 'object' && typeof message.text === 'string') {
    // 极少数实现把 message 写成 {text:'...'}，兜一下
    out.text += message.text;
    return true;
  }
  return false;
}

export function createDirectChat(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const getConfig = typeof o.getConfig === 'function' ? o.getConfig : () => ({});
  const saveConfig = typeof o.saveConfig === 'function' ? o.saveConfig : null;
  const logImpl = typeof o.log === 'function' ? o.log : null;

  /** 统一日志出口：不抛异常、不打印 token。 */
  function logLine(msg) {
    const line = String(msg === undefined || msg === null ? '' : msg);
    try {
      if (logImpl) logImpl(line.startsWith('[direct-chat]') ? line : '[direct-chat] ' + line);
      else console.error('[direct-chat]', line);
    } catch {}
  }

  function shortErr(e) {
    const s = String((e && e.message) || e || '');
    return s.slice(0, 200);
  }

  /** 读 CONFIG.directChat 原始对象（读不到就给空对象，绝不抛）。 */
  function readRawSettings() {
    try {
      const all = getConfig();
      const d = all && typeof all === 'object' ? all.directChat : null;
      return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    } catch (e) {
      logLine('读取 OneBot 配置失败：' + shortErr(e));
      return {};
    }
  }

  /** 合并默认值后的配置副本（所有字段都补齐并做静默规整）。 */
  function cfg() {
    const raw = readRawSettings();
    return {
      enabled: raw.enabled === true,
      apiBase: normApiBase(raw.apiBase) || DEFAULTS.apiBase,
      token: String(raw.token === undefined || raw.token === null ? '' : raw.token).trim(),
      userId: digitsOr(raw.userId),
      selfId: digitsOr(raw.selfId),
      autoReply: boolOr(raw.autoReply, DEFAULTS.autoReply),
      sendImages: boolOr(raw.sendImages, DEFAULTS.sendImages),
      fallbackVm: boolOr(raw.fallbackVm, DEFAULTS.fallbackVm),
      replyPrefix: String(raw.replyPrefix === undefined || raw.replyPrefix === null ? '' : raw.replyPrefix).slice(0, 40),
      timeoutMs: normTimeout(raw.timeoutMs),
    };
  }

  /**
   * 应用一批设置：只接受契约里列出的字段，非法值忽略并记日志。
   * 写回 getConfig().directChat，调用 saveConfig()，返回 cfg()。永不抛异常。
   */
  function setSettings(partial) {
    try {
      const p = partial && typeof partial === 'object' && !Array.isArray(partial) ? partial : {};
      const all = getConfig();
      if (!all || typeof all !== 'object') {
        logLine('没有拿到 CONFIG，无法保存 OneBot 设置');
        return cfg();
      }
      const existing = all.directChat && typeof all.directChat === 'object' && !Array.isArray(all.directChat) ? all.directChat : {};
      const next = { ...DEFAULTS, ...existing };
      let changed = 0;

      for (const k of BOOLEAN_KEYS) {
        if (typeof p[k] === 'boolean') {
          next[k] = p[k];
          changed += 1;
        }
      }
      if (typeof p.apiBase === 'string') {
        const v = normApiBase(p.apiBase);
        if (v) {
          next.apiBase = v;
          changed += 1;
        } else {
          logLine('忽略无效的 OneBot 地址（要 http:// 或 https:// 开头且可解析）：' + String(p.apiBase).slice(0, 120));
        }
      }
      if (typeof p.token === 'string') {
        next.token = p.token.trim();
        changed += 1;
      }
      for (const k of ['userId', 'selfId']) {
        if (p[k] === undefined) continue;
        const v = typeof p[k] === 'number' && Number.isInteger(p[k]) ? String(p[k]) : String(p[k] === null ? '' : p[k]).trim();
        if (v === '' || /^\d{1,20}$/.test(v)) {
          next[k] = v;
          changed += 1;
        } else {
          logLine('忽略无效的 ' + k + '（只允许数字 QQ 号或空）：' + v.slice(0, 20));
        }
      }
      if (p.timeoutMs !== undefined) {
        const n = Number(p.timeoutMs);
        if (Number.isFinite(n)) {
          next.timeoutMs = normTimeout(n);
          changed += 1;
        } else {
          logLine('忽略无效的 timeoutMs：' + String(p.timeoutMs).slice(0, 40));
        }
      }
      if (typeof p.replyPrefix === 'string') {
        next.replyPrefix = p.replyPrefix.slice(0, 40);
        changed += 1;
      }

      all.directChat = next;
      if (saveConfig) {
        try {
          saveConfig();
        } catch (e) {
          logLine('保存 OneBot 设置失败：' + shortErr(e));
        }
      }
      if (changed) {
        logLine('OneBot 设置已更新：apiBase=' + next.apiBase + ' token=' + (next.token ? '***' : '（空）') + ' userId=' + (next.userId || '（空）'));
      }
      return cfg();
    } catch (e) {
      logLine('setSettings 失败：' + shortErr(e));
      return cfg();
    }
  }

  /** 超时信号：优先 AbortSignal.timeout，没有就自己 AbortController。 */
  function timeoutSignal(ms) {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
    const ctl = new AbortController();
    const timer = setTimeout(() => { try { ctl.abort(new Error('timeout')); } catch {} }, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
    return ctl.signal;
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch {
      return String(url || '');
    }
  }

  /** 把 fetch 的异常翻译成中文（不包含 token / 请求头）。 */
  function describeFetchError(e, url, timeoutMs) {
    const name = String((e && e.name) || '');
    const cause = e && typeof e.cause === 'object' && e.cause ? e.cause : {};
    const code = String(cause.code || (e && e.code) || '');
    const raw = String((e && e.message) || e || '');
    const causeMsg = String(cause.message || '');
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|timed out|abort/i.test(raw + ' ' + causeMsg)) {
      return '连 OneBot 超时（' + timeoutMs + 'ms 没响应）：检查 OneBot 实现是否在运行、apiBase 是否正确';
    }
    const where = originOf(url);
    if (code === 'ECONNREFUSED') return '连不上 OneBot（' + where + '）：连接被拒绝，OneBot 实现可能没启动或端口不对';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '连不上 OneBot（' + where + '）：地址解析失败，检查 apiBase 的域名/端口';
    if (code === 'ECONNRESET' || code === 'EPIPE') return '连 OneBot 失败（' + where + '）：连接被重置，OneBot 实现可能刚退出';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '连不上 OneBot（' + where + '）：网络不可达';
    if (/CERT|SSL|TLS/i.test(code) || /certificate|SSL|TLS/i.test(raw)) return '连 OneBot 失败（' + where + '）：HTTPS 证书有问题，检查 apiBase';
    return '连 OneBot 失败（' + where + '）：' + (code ? code + ' ' : '') + raw.slice(0, 160);
  }

  /** 把 HTTP 非 2xx 翻译成中文。 */
  function describeHttpError(status, action) {
    let hint = '';
    if (status === 401 || status === 403) hint = '：token 可能不对，或这个 HTTP 端口不允许访问';
    else if (status === 404) hint = '：这个 OneBot 实现没有 /' + action + ' 接口';
    else if (status === 429) hint = '：请求太频繁，被 OneBot 限流了';
    else if (status >= 500) hint = '：OneBot 实现内部出错';
    return 'OneBot 接口返回 HTTP ' + status + '（' + action + '）' + hint;
  }

  /**
   * 解开 OneBot 11 的统一响应格式：
   *  { status:'ok', retcode:0, data:... } 成功；status!=='ok' 或 retcode!==0 失败。
   * 也容忍没有 status/retcode 但直接给 data 的实现。
   */
  function unwrapOneBot(json, action) {
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, error: 'OneBot 返回的内容不是对象（' + action + '）' };
    }
    const status = String(json.status === undefined || json.status === null ? '' : json.status).toLowerCase();
    const hasRetcode = json.retcode !== undefined && json.retcode !== null;
    const retcode = hasRetcode ? Number(json.retcode) : null;
    const msg = String(json.message ?? json.msg ?? json.wording ?? '').trim().slice(0, 200);
    if (hasRetcode && Number.isFinite(retcode) && retcode !== 0) {
      return { ok: false, retcode, error: 'OneBot 调用失败（' + action + '，retcode=' + retcode + '）' + (msg ? '：' + msg : '') };
    }
    if (status && status !== 'ok' && status !== 'async') {
      return { ok: false, retcode: Number.isFinite(retcode) ? retcode : null, error: 'OneBot 调用失败（' + action + '，状态 ' + status + '）' + (msg ? '：' + msg : '') };
    }
    if (!status && !hasRetcode && !('data' in json)) {
      return { ok: false, error: 'OneBot 返回的响应缺少 status/retcode/data（' + action + '）：可能不是 OneBot 11 接口' };
    }
    return { ok: true, data: json.data };
  }

  /**
   * 调一次 OneBot HTTP API。
   * 返回 { ok, data?, latencyMs, error?, retcode? }；任何情况下不抛异常。
   */
  async function call(action, body) {
    const c = cfg();
    const started = Date.now();
    const url = c.apiBase + '/' + action;
    const timeoutMs = c.timeoutMs;
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (c.token) headers.Authorization = 'Bearer ' + c.token;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body || {}), signal: timeoutSignal(timeoutMs) });
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - started, error: describeFetchError(e, url, timeoutMs) };
    }
    const latencyMs = Date.now() - started;
    let text = '';
    try {
      text = await res.text();
    } catch (e) {
      // 响应头到了但读 body 时被超时中断，也按超时翻译
      const desc = describeFetchError(e, url, timeoutMs);
      return { ok: false, latencyMs, error: desc.startsWith('连 OneBot') ? desc : '读取 OneBot 响应失败（' + action + '）：' + shortErr(e) };
    }
    if (!res.ok) return { ok: false, latencyMs, error: describeHttpError(res.status, action) };
    let json = null;
    let badJson = false;
    if (text && text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        badJson = true;
      }
    }
    if (badJson) {
      return { ok: false, latencyMs, error: 'OneBot 返回的不是 JSON（' + action + '）：检查 apiBase 是否填成了 OneBot 的 HTTP 地址' };
    }
    const unwrapped = unwrapOneBot(json, action);
    if (!unwrapped.ok) return { ok: false, latencyMs, error: unwrapped.error, retcode: unwrapped.retcode };
    return { ok: true, latencyMs, data: unwrapped.data };
  }

  /** 当前配置下要发给谁（对方 QQ 号）。返回 { ok, userId, userIdText, error? }。 */
  function targetUserId() {
    const c = cfg();
    const text = c.userId;
    if (!text) return { ok: false, error: '还没填要发给谁（QQ 号）' };
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, error: '要发给谁（QQ 号）超出范围：' + text.slice(0, 20) };
    return { ok: true, userId: n, userIdText: text };
  }

  /** 把本地路径/dataURL/HTTP URL 规整成 OneBot image 段的 file 值。 */
  function imageFileOf(input) {
    const raw = String(input === undefined || input === null ? '' : input).trim();
    if (!raw) return { ok: false, error: '图片是空的（没给路径或 dataURL）' };
    if (/^data:/i.test(raw)) return { ok: true, file: raw };
    if (/^https?:\/\//i.test(raw)) return { ok: true, file: raw };
    let abs = '';
    if (/^file:\/\//i.test(raw)) {
      try {
        abs = fileURLToPath(raw);
      } catch {
        abs = raw.replace(/^file:\/\//i, '').replace(/^\/(?=[A-Za-z]:)/, '');
        try { abs = decodeURIComponent(abs); } catch {}
      }
    } else {
      try {
        abs = path.resolve(raw);
      } catch {
        return { ok: false, error: '图片路径不认识：' + raw.slice(0, 120) };
      }
    }
    let st = null;
    try {
      st = fs.statSync(abs);
    } catch {}
    if (!st || !st.isFile()) return { ok: false, error: '图片文件不存在：' + abs };
    // OneBot 11 的本地文件写法：file:/// + 绝对路径（正斜杠）
    return { ok: true, file: 'file:///' + abs.replace(/\\/g, '/') };
  }

  /**
   * 探一次连接：POST {apiBase}/get_login_info。
   * 返回 { ok, enabled, apiBase, latencyMs, login?, error?, checkedAt }。
   * 即使 enabled=false 也会真探一次（设置页要能「测试连接」）；永不抛异常。
   */
  async function status() {
    const c = cfg();
    const checkedAt = Date.now();
    const baseInfo = { enabled: c.enabled === true, apiBase: c.apiBase, latencyMs: null, checkedAt };
    if (!c.apiBase) return { ok: false, ...baseInfo, error: '还没填 OneBot HTTP 地址（apiBase）' };
    const r = await call('get_login_info', {});
    if (!r.ok) {
      logLine('检测 OneBot 连接失败：' + r.error);
      return { ok: false, ...baseInfo, latencyMs: r.latencyMs ?? null, error: r.error };
    }
    const d = r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : {};
    const userId = String(d.user_id ?? d.userId ?? '').trim();
    const nickname = String(d.nickname ?? d.nick ?? d.name ?? '').trim();
    return { ok: true, ...baseInfo, latencyMs: r.latencyMs, login: { userId, nickname } };
  }

  /** 好友列表（get_friend_list）。桥不支持时 ok:false，不致命。 */
  async function listFriends() {
    const r = await call('get_friend_list', {});
    if (!r.ok) {
      logLine('拉好友列表失败：' + r.error);
      return { ok: false, error: r.error };
    }
    const arr = Array.isArray(r.data) ? r.data : [];
    const friends = [];
    for (const f of arr) {
      if (!f || typeof f !== 'object') continue;
      const id = String(f.user_id ?? f.userId ?? '').trim();
      if (!id) continue;
      friends.push({ userId: id, remark: String(f.remark ?? ''), nickname: String(f.nickname ?? '') });
    }
    return { ok: true, friends };
  }

  /**
   * 发一条私聊文字。
   * 返回 { ok, messageId?, error?, latencyMs? }。
   * 目标 QQ = cfg().userId；为空时直接拒绝，不发任何请求。
   */
  async function sendText(text) {
    const bodyText = String(text === undefined || text === null ? '' : text);
    if (!bodyText.trim()) return { ok: false, error: '消息内容是空的' };
    const target = targetUserId();
    if (!target.ok) return { ok: false, error: target.error };
    const r = await call('send_private_msg', {
      user_id: target.userId,
      message: [{ type: 'text', data: { text: bodyText } }],
    });
    if (!r.ok) {
      logLine('发送文字给 ' + target.userIdText + ' 失败：' + r.error);
      return { ok: false, error: r.error, latencyMs: r.latencyMs };
    }
    const out = { ok: true, latencyMs: r.latencyMs };
    const mid = messageIdOf(r.data);
    if (mid) out.messageId = mid;
    return out;
  }

  /**
   * 发一张私聊图片。
   * filePathOrDataUrl：本地绝对路径 / file:// URL / dataURL / http(s) URL 都可以。
   * caption 非空时先发文字段再发图片段（同一个 message 数组）。
   * 返回 { ok, messageId?, error? }。
   */
  async function sendImage(filePathOrDataUrl, caption) {
    if (cfg().sendImages === false) return { ok: false, error: '图片发送已关闭（sendImages=false）' };
    const img = imageFileOf(filePathOrDataUrl);
    if (!img.ok) return { ok: false, error: img.error };
    const target = targetUserId();
    if (!target.ok) return { ok: false, error: target.error };
    const message = [];
    const cap = String(caption === undefined || caption === null ? '' : caption);
    if (cap.trim()) message.push({ type: 'text', data: { text: cap } });
    message.push({ type: 'image', data: { file: img.file } });
    const r = await call('send_private_msg', { user_id: target.userId, message });
    if (!r.ok) {
      logLine('发送图片给 ' + target.userIdText + ' 失败：' + r.error);
      return { ok: false, error: r.error };
    }
    const out = { ok: true };
    const mid = messageIdOf(r.data);
    if (mid) out.messageId = mid;
    return out;
  }

  /**
   * 把一条 OneBot 消息（事件或历史记录）转成统一形状。
   * strict=true 时只认 post_type==='message' && message_type==='private'（事件推送）；
   * strict=false 用于历史记录条目（很多实现的条目里没有 post_type/message_type）。
   * 返回 null 表示不是私聊消息。永不抛异常。
   */
  function extractMessage(body, strict) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const postType = String(body.post_type || '');
    const msgType = String(body.message_type || '');
    if (strict) {
      if (postType !== 'message' || msgType !== 'private') return null;
    } else {
      if (postType && postType !== 'message') return null;
      if (msgType && msgType !== 'private') return null;
      const looksLikeMessage = !!(body.message || body.raw_message || body.message_id !== undefined || body.messageId !== undefined);
      if (!looksLikeMessage) return null;
    }
    const sender = body.sender && typeof body.sender === 'object' ? body.sender : {};
    const userId = String(body.user_id ?? body.userId ?? sender.user_id ?? sender.userId ?? '').trim();
    const nickname = String(sender.nickname ?? sender.card ?? body.nickname ?? '').trim();
    // self_id 缺失时用配置里的 selfId 补（历史记录条目通常没有 self_id）
    const selfId = String(body.self_id ?? body.selfId ?? '').trim() || cfg().selfId;
    const messageId = String(body.message_id ?? body.messageId ?? body.message_seq ?? '').trim();
    const out = { text: '', images: [] };
    const handled = collectMessageSegments(body.message, out);
    if (!handled || (!out.text && !out.images.length)) {
      if (typeof body.raw_message === 'string' && body.raw_message && !out.text && !out.images.length) collectCq(body.raw_message, out);
    }
    return {
      kind: 'private_message',
      userId,
      nickname,
      selfId,
      messageId,
      text: out.text,
      images: out.images,
      raw: body,
    };
  }

  /**
   * 解析一条 OneBot 11 事件推送。
   * 只处理私聊消息，其它事件返回 null；字段缺失也尽量容错，永不抛异常。
   */
  function parseEvent(body) {
    try {
      let obj = body;
      if (typeof body === 'string') {
        try { obj = JSON.parse(body); } catch { return null; }
      }
      return extractMessage(obj, true);
    } catch (e) {
      logLine('解析 OneBot 事件失败：' + shortErr(e));
      return null;
    }
  }

  /** message_id 是否比 sinceMessageId 新（数值比较优先，非数字退化为字符串比较）。 */
  function isNewer(messageId, sinceMessageId) {
    const since = String(sinceMessageId === undefined || sinceMessageId === null ? '' : sinceMessageId).trim();
    if (!since) return true;
    const id = String(messageId === undefined || messageId === null ? '' : messageId).trim();
    if (!id) return true; // 拿不到 message_id 就全回，让调用方自己判断
    const a = Number(id);
    const b = Number(since);
    if (Number.isFinite(a) && Number.isFinite(b)) return a > b;
    return id > since;
  }

  /**
   * 拉最近 20 条与 cfg().userId 的私聊历史（get_friend_msg_history，NapCat/Lagrange 常见扩展）。
   * 返回 { ok, messages?:[同 parseEvent 形状], error? }。
   * 桥不支持时返回中文 error，不致命；只回比 sinceMessageId 新的（不传就全回）。
   */
  async function probeHistory(sinceMessageId) {
    const target = targetUserId();
    if (!target.ok) return { ok: false, error: target.error };
    const r = await call('get_friend_msg_history', { user_id: target.userId, count: 20 });
    if (!r.ok) {
      logLine('拉取历史消息失败：' + r.error);
      return { ok: false, error: r.error };
    }
    const d = r.data;
    let list = null;
    if (Array.isArray(d)) list = d;
    else if (d && typeof d === 'object' && Array.isArray(d.messages)) list = d.messages;
    else if (d && typeof d === 'object' && Array.isArray(d.message_list)) list = d.message_list;
    if (!list) {
      return { ok: false, error: '这个 OneBot 实现的 get_friend_msg_history 返回格式不认识（没有 messages 数组）' };
    }
    const since = sinceMessageId === undefined || sinceMessageId === null ? '' : String(sinceMessageId).trim();
    const messages = [];
    for (const item of list) {
      const m = extractMessage(item, false);
      if (!m) continue;
      if (since && !isNewer(m.messageId, since)) continue;
      messages.push(m);
    }
    return { ok: true, messages };
  }

  return {
    cfg,
    setSettings,
    status,
    listFriends,
    sendText,
    sendImage,
    parseEvent,
    probeHistory,
  };
}
