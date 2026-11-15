// ⚠️ 自动生成，不要直接改这个文件：
//    源码在 src/client/**，改完运行 `npm run build:client` 重新生成。
//    （DSH 客户端半只有一个入口，所以多文件源码在构建时拼成单文件工厂）
//
// 屏幕彼端 · DSH 客户端半（原生 React 面板，v0.7.26）
//   · 左侧栏「屏幕彼端」入口 → 主区域原生面板：聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于
//   · 直接 fetch 本机运行时 127.0.0.1:<端口> 的 /api/*、/models/* 和图片；
//     **不请求任何 HTML 页面，也没有 iframe**
//   · 她的屏幕：只把 noVNC 地址交给系统浏览器（window.open），面板里不嵌网页
window.__ModuleLoader__.load({
  id: 'dsh-screen-beyond',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const h = React.createElement
    const inject = ['slots']
    const CLIENT_BUILD = { pluginVersion: "0.7.26", native: true }
    /* ===== src/client/00-core/const.js ===== */
// 00-core/const.js —— 常量与主题 token
//
// 只允许用这里的 T.*（映射到 DSH 主题变量）写颜色，面板才能跟着 DSH 亮/暗主题走。
// 业务文案生成器（energyLabel 等）也放这里，避免每个模块各写一份。

const DEFAULT_BASE = 'http://127.0.0.1:8900'
const PORT_SCAN_FROM = 8900
const PORT_SCAN_TO = 8912
const STATUS_POLL_MS = 4000
const EVENTS_POLL_MS = 1200
const STAGE_POLL_MS = 2500
const TABS = [
  { key: 'chat', label: '聊天' },
  { key: 'stage', label: '舞台' },
  { key: 'map', label: '地图' },
  { key: 'settings', label: '设置' },
  { key: 'screen', label: '屏幕' },
  { key: 'about', label: '关于' },
]

const T = {
  radius: 10,
  radiusLg: 14,
  font: 'inherit',
  mono: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
  bg: 'var(--dsw-alias-bg-base, #0b0f14)',
  bg1: 'var(--dsw-alias-bg-layer-1, #11161d)',
  bg2: 'var(--dsw-alias-bg-layer-2, #16202b)',
  overlay: 'var(--dsw-alias-bg-overlay, #141c26)',
  border: 'var(--dsw-alias-border-l1, rgba(255,255,255,.12))',
  border2: 'var(--dsw-alias-border-l2, rgba(255,255,255,.22))',
  text: 'var(--dsw-alias-label-primary, #d7dee8)',
  text2: 'var(--dsw-alias-label-secondary, #9fb0c4)',
  text3: 'var(--dsw-alias-label-tertiary, #6f849b)',
  // ⚠️ 强调色不能用 --dsw-alias-brand-primary：当前 DSH 版本把它别名成 label-primary
  //（深色主题接近纯白），拿它当填充色会出现「白底白字」（用户气泡、主按钮都不可见，实测踩过）。
  // 所以填充/描边强调色统一用固定的品牌蓝，保证亮/暗主题都读得清。
  accent: '#3b82f6',
  accentInk: '#ffffff',
  accentSoft: 'rgba(59,130,246,.18)',
  brand: '#3b82f6',
  danger: 'var(--dsw-alias-state-error-primary, #ef5350)',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  ok: 'var(--dsw-alias-state-success-primary, #22c55e)',
  idle: 'var(--dsw-alias-state-idle-primary, #64748b)',
}

// 角色精力 → 文案（0~100）
function energyLabel(n) {
  const v = Number(n) || 0
  if (v >= 80) return '精力很足'
  if (v >= 55) return '状态不错'
  if (v >= 35) return '有点累'
  if (v >= 20) return '挺累的'
  return '快撑不住了'
}

// 运行时模式 → 文案
function modeLabel(mode) {
  return mode === 'chat' ? '聊天模式' : '完整版'
}

// 舞台/地图里状态点颜色
function stateTone(running) {
  return running ? T.ok : T.idle
}

    /* ===== src/client/00-core/api.js ===== */
// 00-core/api.js —— 运行时发现 + API 客户端 + 图片/SSE
//
// 设计要点（对应 D02 A / D11 C / N03）：
//   · 运行时地址不写死：宿主路由 /dsh-screen-beyond/info → localStorage → 端口扫描兜底；
//   · 可选 API token（DSH_COMPANION_API_TOKEN）：所有请求都带 x-companion-token，
//     token 模式下图片和 SSE 也走带 header 的 fetch，不再依赖 cookie；
//   · 所有 Api.* 都不抛异常，失败返回 { ok:false, error }，调用方必须处理错误态；
//   · 服务器连续失败时自动重新发现地址（端口避让/运行时重启后能自愈）。

// 带超时的 AbortSignal（factory 顶层：Runtime 和 Api 两个 IIFE 都要用）
function sbcTimeoutSignal(ms) {
  try { if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) return AbortSignal.timeout(ms) } catch (e) {}
  try {
    const ctl = new AbortController()
    setTimeout(() => { try { ctl.abort() } catch (e) {} }, ms)
    return ctl.signal
  } catch (e) { return undefined }
}

const Runtime = (() => {
  const LS_BASE = 'companionBase'
  let base = ''
  let baseAt = 0
  let discoverPromise = null
  let token = ''
  let tokenPromise = null
  const listeners = new Set()

  function readCache() {
    try { return localStorage.getItem(LS_BASE) || '' } catch (e) { return '' }
  }
  function writeCache(v) {
    try { if (v) localStorage.setItem(LS_BASE, v); else localStorage.removeItem(LS_BASE) } catch (e) {}
  }
  function emit() {
    listeners.forEach((fn) => { try { fn(base) } catch (e) {} })
  }
  function subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  function reset() {
    base = ''
    baseAt = 0
    token = ''
    tokenPromise = null
    discoverPromise = null
  }

  // 判断某个地址上是不是我们的运行时
  async function probe(candidate, timeoutMs) {
    if (!candidate) return null
    try {
      const r = await fetch(candidate + '/api/status', { cache: 'no-store', signal: sbcTimeoutSignal(timeoutMs || 2500) })
      if (!r.ok) return null
      const j = await r.json()
      return j && typeof j === 'object' ? j : null
    } catch (e) { return null }
  }

  async function discover(force) {
    if (force) reset()
    if (base && Date.now() - baseAt < 30000) return base
    if (discoverPromise) return discoverPromise
    discoverPromise = (async () => {
      // 1) 宿主路由（正常情况；端口自动避让由宿主半负责）
      try {
        const r = await fetch('/dsh-screen-beyond/info', { cache: 'no-store', signal: sbcTimeoutSignal(2500) })
        if (r.ok) {
          const j = await r.json()
          if (j && j.url && await probe(j.url)) {
            base = String(j.url).replace(/\/$/, '')
            baseAt = Date.now()
            writeCache(base)
            emit()
            return base
          }
        }
      } catch (e) {}
      // 2) 本机缓存
      const cached = readCache()
      if (cached && await probe(cached)) {
        base = cached; baseAt = Date.now(); emit(); return base
      }
      // 3) 端口扫描兜底（运行时被手动启动/宿主半没起来时）
      for (let port = PORT_SCAN_FROM; port <= PORT_SCAN_TO; port++) {
        const candidate = 'http://127.0.0.1:' + port
        if (candidate === base) continue
        if (await probe(candidate, 700)) {
          base = candidate; baseAt = Date.now(); writeCache(base); emit(); return base
        }
      }
      base = DEFAULT_BASE
      baseAt = Date.now()
      emit()
      return base
    })().finally(() => { discoverPromise = null })
    return discoverPromise
  }

  function baseSync() {
    if (base) return base
    const cached = readCache()
    return cached || ''
  }

  // 运行时开了 token 时，取一次缓存住；401 时清空重取
  async function tokenValue() {
    if (token) return token
    if (tokenPromise) return tokenPromise
    tokenPromise = (async () => {
      try {
        const b = await discover()
        const r = await fetch(b + '/api/token', { cache: 'no-store', signal: sbcTimeoutSignal(2500) })
        if (r.ok) {
          const j = await r.json()
          token = String((j && j.token) || '')
        }
      } catch (e) {}
      tokenPromise = null
      return token
    })()
    return tokenPromise
  }

  function url(pathname) {
    const b = baseSync() || DEFAULT_BASE
    if (/^https?:/i.test(String(pathname))) return String(pathname)
    return b + (String(pathname || '').startsWith('/') ? pathname : '/' + pathname)
  }

  // 401 后清掉缓存的 token 再取一次（运行时可能换了 token）
  async function refreshToken() {
    token = ''
    tokenPromise = null
    return tokenValue()
  }

  return {
    discover,
    reset,
    subscribe,
    baseSync,
    url,
    token: tokenValue,
    refreshToken,
    async base() { return discover() },
    get cachedBase() { return base },
  }
})()

const Api = (() => {
  // blob 图片缓存（token 模式下 <img src> 不能带 header，只能先 fetch 成 blob）
  const imageCache = new Map()
  const IMAGE_CACHE_MAX = 24

  function normalizeError(r, json, text) {
    if (json && (json.error || json.message)) return String(json.error || json.message)
    const t = String(text || '').trim()
    if (t && t.length < 200 && !t.startsWith('<')) return t
    return 'HTTP ' + r.status
  }

  async function request(pathname, opts) {
    const o = opts || {}
    let b = ''
    try { b = await Runtime.base() } catch (e) {}
    if (!b) return { ok: false, status: 0, data: null, error: '运行时地址未发现' }
    const headers = Object.assign({}, o.headers || {})
    let body
    if (o.body !== undefined && o.body !== null) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(o.body)
    }
    try {
      const t = await Runtime.token()
      if (t) headers['x-companion-token'] = t
    } catch (e) {}
    let r
    try {
      r = await fetch(b + pathname, {
        method: o.method || 'GET',
        headers,
        body,
        cache: 'no-store',
        signal: sbcTimeoutSignal(o.timeoutMs || 20000),
      })
    } catch (e) {
      return { ok: false, status: 0, data: null, error: '连不上运行时（' + ((e && e.message) || '网络错误') + '）', network: true }
    }
    if (r.status === 401) { try { await Runtime.refreshToken() } catch (e) {} }
    let text = ''
    let data = null
    try { text = await r.text() } catch (e) {}
    if (text) { try { data = JSON.parse(text) } catch (e) {} }
    return {
      ok: r.ok,
      status: r.status,
      data,
      error: r.ok ? '' : normalizeError(r, data, text),
    }
  }

  function get(pathname, opts) { return request(pathname, Object.assign({ method: 'GET' }, opts || {})) }
  function post(pathname, body, opts) { return request(pathname, Object.assign({ method: 'POST', body: body || {} }, opts || {})) }

  // 图片地址：统一走 fetch → blob URL（带缓存 + 同 key 去重），两个原因：
  //   1) token 模式下 <img src> 不能带 header，只能带 header 取；
  //   2) DSH 面板里同一张头像会在几十条消息里重复出现，直接 <img> 会给运行时打几十个请求，
  //      实测会出现部分图片加载失败（头像显示「重试」）。统一缓存一份就只请求一次。
  // 取不到 blob（跨域限制等）时退回绝对地址，保证不会比原来更差。
  const imagePending = new Map()
  async function imgUrl(pathname, opts) {
    const p = String(pathname || '')
    if (!p) return ''
    if (/^blob:|^data:/i.test(p)) return p
    const b = await Runtime.base()
    const full = /^https?:/i.test(p) ? p : b + (p.startsWith('/') ? p : '/' + p)
    let t = ''
    try { t = await Runtime.token() } catch (e) {}
    const key = p + '|' + (opts && opts.bust ? String(opts.bust) : '')
    const hit = imageCache.get(key)
    if (hit) { hit.at = Date.now(); return hit.url }
    const pending = imagePending.get(key)
    if (pending) return pending
    const task = (async () => {
      const headers = {}
      if (t) headers['x-companion-token'] = t
      try {
        const r = await fetch(full, { headers, cache: 'default', signal: sbcTimeoutSignal(20000) })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const blob = await r.blob()
        const objectUrl = URL.createObjectURL(blob)
        imageCache.set(key, { url: objectUrl, at: Date.now() })
        while (imageCache.size > IMAGE_CACHE_MAX) {
          let oldestKey = ''
          let oldestAt = Infinity
          imageCache.forEach((v, k) => { if (v.at < oldestAt) { oldestAt = v.at; oldestKey = k } })
          if (!oldestKey) break
          const old = imageCache.get(oldestKey)
          imageCache.delete(oldestKey)
          try { URL.revokeObjectURL(old.url) } catch (e) {}
        }
        return objectUrl
      } catch (e) {
        return full
      } finally {
        imagePending.delete(key)
      }
    })()
    imagePending.set(key, task)
    return task
  }

  // 上传文件 → dataURL（服务端所有图片上传接口都用 dataUrl）
  function readFileAsDataUrl(file, maxBytes) {
    return new Promise((resolve) => {
      const f = file
      if (!f) { resolve({ ok: false, error: '没有选择文件' }); return }
      const limit = Number(maxBytes) || 6 * 1024 * 1024
      if (f.size > limit) {
        resolve({ ok: false, error: '图片太大（上限 ' + Math.round(limit / 1024 / 1024) + 'MB）' })
        return
      }
      try {
        const reader = new FileReader()
        reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result || '') })
        reader.onerror = () => resolve({ ok: false, error: '读取图片失败' })
        reader.readAsDataURL(f)
      } catch (e) {
        resolve({ ok: false, error: '读取图片失败：' + ((e && e.message) || '') })
      }
    })
  }

  // 用系统浏览器新窗口打开（她的屏幕 noVNC / 调试页面）
  function openExternal(target) {
    const href = /^https?:/i.test(String(target)) ? String(target) : (Runtime.baseSync() || DEFAULT_BASE) + String(target || '')
    try {
      const w = window.open(href, '_blank', 'noopener,noreferrer')
      return { ok: !!w || true, url: href }
    } catch (e) {
      return { ok: false, url: href, error: (e && e.message) || '浏览器拦截了弹窗' }
    }
  }

  // fetch 流式 SSE：EventSource 不能带 header（token 模式会挂），所以自己解析 data: 帧
  async function stream(onEvent, opts) {
    const o = opts || {}
    const b = await Runtime.base()
    const headers = { accept: 'text/event-stream' }
    try { const t = await Runtime.token(); if (t) headers['x-companion-token'] = t } catch (e) {}
    let r
    try {
      r = await fetch(b + (o.path || '/api/stream'), { headers, cache: 'no-store', signal: o.signal })
    } catch (e) {
      throw new Error('流式连接失败：' + ((e && e.message) || '网络错误'))
    }
    if (!r.ok || !r.body) throw new Error('流式连接失败：HTTP ' + r.status)
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    while (true) {
      let chunk
      try { chunk = await reader.read() } catch (e) { break }
      if (chunk.done) break
      buf += decoder.decode(chunk.value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const dataLine = frame.split('\n').find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        const raw = dataLine.slice(5).trim()
        if (!raw) continue
        let payload = null
        try { payload = JSON.parse(raw) } catch (e) { continue }
        try { onEvent(payload) } catch (e) {}
      }
    }
  }

  return { request, get, post, upload: post, imgUrl, readFileAsDataUrl, openExternal, stream }
})()

    /* ===== src/client/00-core/format.js ===== */
// 00-core/format.js —— 纯函数小工具（不依赖 React）

function clampNum(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback === undefined ? lo : fallback
  return Math.min(hi, Math.max(lo, n))
}

function fmtTime(ts) {
  const d = new Date(Number(ts) || Date.now())
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function fmtDateTime(ts) {
  const d = new Date(Number(ts) || Date.now())
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return mo + '-' + da + ' ' + fmtTime(ts)
}

// 头像地址白名单：只允许服务端头像路径，其余返回 ''（调用方走首字兜底），避免 url() 注入
function safeAvatarUrl(u) {
  const s = String(u || '')
  if (!/^\/(avatar\.png|default-avatar\.png)(\?[A-Za-z0-9_=.\-&%]*)?$/.test(s)) return ''
  return s
}

function fmtMoney(v, digits) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '…'
  return n.toFixed(digits === undefined ? 2 : digits)
}

function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

// 分钟数 → “x 小时 y 分”
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? h + ' 小时 ' + rest + ' 分' : h + ' 小时'
}

// 角色名首字兜底（不写死任何角色名，N02）
function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.slice(0, 1) : '她'
}

// 稳定的列表 key（没有 id 时用索引）
function keyOf(item, i) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id)
  if (item && item.uid) return String(item.uid)
  return 'i' + i
}

function joinClass() {
  const out = []
  for (let i = 0; i < arguments.length; i++) { const v = arguments[i]; if (v) out.push(v) }
  return out.join(' ')
}

// 从地图坐标（0~1）换算 px
function pct(v) {
  return (clampNum(v, 0, 1, 0.5) * 100).toFixed(2) + '%'
}

    /* ===== src/client/00-core/store.js ===== */
// 00-core/store.js —— 极简全局状态 + Toast / 对话框（原生面板里没有 UI 库，全部自己做）

function createStore(initial) {
  let state = initial
  const subs = new Set()
  return {
    get() { return state },
    set(next) {
      state = typeof next === 'function' ? next(state) : next
      subs.forEach((fn) => { try { fn(state) } catch (e) {} })
      return state
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}

function useStore(store) {
  const [snap, setSnap] = React.useState(store.get)
  React.useEffect(() => store.subscribe(setSnap), [store])
  return snap
}

// ── Toast ───────────────────────────────────────────────────────────
const ToastStore = createStore([])
let toastSeq = 0

function toast(text, kind) {
  const id = ++toastSeq
  const item = { id, text: String(text || ''), kind: kind || 'info' }
  ToastStore.set((list) => list.concat(item).slice(-4))
  setTimeout(() => {
    ToastStore.set((list) => list.filter((x) => x.id !== id))
  }, kind === 'error' ? 4200 : 2400)
  return id
}

// ── 对话框（危险操作必须二次确认，M05 验收要求）────────────────────
// DialogStore 存的是一个队列：每个对话框是 Promise 的 resolve 载体。
const DialogStore = createStore([])
let dialogSeq = 0

function pushDialog(spec) {
  return new Promise((resolve) => {
    const id = ++dialogSeq
    const entry = Object.assign({ id }, spec, {
      resolve(value) {
        DialogStore.set((list) => list.filter((x) => x.id !== id))
        resolve(value)
      },
    })
    DialogStore.set((list) => list.concat(entry))
  })
}

// await confirmDialog('关掉她的屏幕？', { detail:'…', danger:true, okText:'关掉' }) → true/false
function confirmDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'confirm',
    title: o.title || '请确认',
    text: String(text || ''),
    detail: o.detail || '',
    danger: !!o.danger,
    okText: o.okText || '确定',
    cancelText: o.cancelText || '取消',
  }).then((v) => v === true)
}

// await alertDialog('已保存')  /  alertDialog('失败了', { danger:true })
function alertDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'alert',
    title: o.title || '提示',
    text: String(text || ''),
    detail: o.detail || '',
    danger: !!o.danger,
    okText: o.okText || '知道了',
  }).then(() => true)
}

// 输入框对话框（少数场景用，比如新建地图/导入名字）
function promptDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'prompt',
    title: o.title || '请输入',
    text: String(text || ''),
    detail: o.detail || '',
    value: o.value === undefined ? '' : String(o.value),
    placeholder: o.placeholder || '',
    okText: o.okText || '确定',
    cancelText: o.cancelText || '取消',
  })
}

    /* ===== src/client/00-core/ui.js ===== */
// 00-core/ui.js —— 原生 UI 原语（没有 UI 库，全部自己写；颜色只走 T.* 主题 token）

const SBC_CSS = [
  '.sbc-scroll::-webkit-scrollbar{width:9px;height:9px}',
  '.sbc-scroll::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(255,255,255,.22));border-radius:8px}',
  '.sbc-scroll::-webkit-scrollbar-track{background:transparent}',
  '.sbc-btn{transition:filter .12s ease,background .16s ease,border-color .16s ease}',
  '.sbc-btn:not(:disabled):hover{filter:brightness(1.08)}',
  '.sbc-btn:not(:disabled):active{transform:translateY(1px)}',
  '.sbc-input{outline:none;transition:border-color .15s ease,box-shadow .15s ease}',
  '.sbc-input:focus{border-color:var(--dsw-alias-brand-primary,#2f6bd8)!important;box-shadow:0 0 0 3px rgba(47,107,216,.16)}',
  '.sbc-fade{animation:sbcFade .16s ease-out}',
  '@keyframes sbcFade{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}',
  '.sbc-blink{animation:sbcBlink 1.1s ease-in-out infinite}',
  '@keyframes sbcBlink{0%,100%{opacity:.35}50%{opacity:1}}',
  '.sbc-range{-webkit-appearance:none;appearance:none;height:4px;border-radius:3px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.2));outline:none}',
  '.sbc-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-brand-primary,#2f6bd8);cursor:pointer;border:2px solid var(--dsw-alias-bg-base,#0b0f14)}',
].join('\n')

let sbcStyleReady = false
function ensureUiStyle() {
  if (sbcStyleReady || typeof document === 'undefined') return
  sbcStyleReady = true
  try {
    if (document.getElementById('sbc-native-ui-style')) return
    const el = document.createElement('style')
    el.id = 'sbc-native-ui-style'
    el.textContent = SBC_CSS
    document.head.appendChild(el)
  } catch (e) {}
}

// ── 基础块 ─────────────────────────────────────────────────────────
function Btn(props) {
  const p = props || {}
  const kind = p.kind || 'ghost'
  const size = p.size || 'md'
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    border: '1px solid ' + T.border,
    borderRadius: size === 'sm' ? 7 : 9,
    background: 'transparent',
    color: T.text,
    fontSize: size === 'sm' ? 12 : 13,
    lineHeight: '18px',
    padding: size === 'sm' ? '3px 9px' : '6px 14px',
    cursor: p.disabled ? 'default' : 'pointer',
    opacity: p.disabled ? 0.45 : 1,
    whiteSpace: 'nowrap',
    fontFamily: T.font,
    flexShrink: 0,
  }
  if (kind === 'primary') Object.assign(base, { background: T.brand, borderColor: T.brand, color: '#fff' })
  else if (kind === 'danger') Object.assign(base, { background: 'transparent', borderColor: T.danger, color: T.danger })
  else if (kind === 'soft') Object.assign(base, { background: 'rgba(127,127,127,.10)' })
  else if (kind === 'chip') Object.assign(base, { borderRadius: 999, fontSize: 11, padding: '2px 9px', background: 'rgba(127,127,127,.10)' })
  return h('button', {
    className: 'sbc-btn',
    type: 'button',
    title: p.title || undefined,
    disabled: p.disabled || undefined,
    onClick: p.disabled ? undefined : p.onClick,
    style: Object.assign(base, p.style || {}),
  }, p.children)
}

function Chip(props) {
  const p = props || {}
  const active = !!p.active
  const tone = p.tone === 'ok' ? T.ok : p.tone === 'warn' ? T.warn : p.tone === 'danger' ? T.danger : T.brand
  return h('button', {
    className: 'sbc-btn',
    type: 'button',
    title: p.title || undefined,
    onClick: p.onClick,
    style: Object.assign({
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 9px', borderRadius: 999,
      border: '1px solid ' + (active ? tone : T.border),
      background: active ? 'rgba(47,107,216,.16)' : 'rgba(127,127,127,.08)',
      color: active ? tone : T.text2,
      fontSize: 11, lineHeight: '16px', cursor: p.onClick ? 'pointer' : 'default',
      whiteSpace: 'nowrap', fontFamily: T.font,
    }, p.style || {}),
  }, p.children)
}

function Dot(props) {
  const p = props || {}
  const color = p.tone || (p.on ? T.ok : T.idle)
  return h('span', {
    title: p.title || undefined,
    style: Object.assign({
      display: 'inline-block', width: p.size || 7, height: p.size || 7, borderRadius: '50%',
      background: color, flexShrink: 0, verticalAlign: 'middle',
    }, p.style || {}),
  })
}

function Badge(props) {
  const p = props || {}
  const tone = p.tone === 'ok' ? T.ok : p.tone === 'warn' ? T.warn : p.tone === 'danger' ? T.danger : T.text2
  return h('span', {
    title: p.title || undefined,
    style: Object.assign({
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '0 7px', borderRadius: 999, border: '1px solid ' + T.border,
      background: 'rgba(127,127,127,.10)', color: tone,
      fontSize: 10.5, lineHeight: '16px', whiteSpace: 'nowrap',
    }, p.style || {}),
  }, p.children)
}

function Divider(props) {
  const p = props || {}
  return h('div', { style: Object.assign({ height: 0, borderTop: '1px solid ' + T.border, margin: '8px 0' }, p.style || {}) })
}

function Row(props) {
  const p = props || {}
  return h('div', {
    style: Object.assign({
      display: 'flex', alignItems: p.align || 'center', gap: p.gap === undefined ? 8 : p.gap,
      flexWrap: p.wrap === false ? 'nowrap' : 'wrap',
      justifyContent: p.justify || 'flex-start', minWidth: 0,
    }, p.style || {}),
  }, p.children)
}

function Col(props) {
  const p = props || {}
  return h('div', {
    style: Object.assign({
      display: 'flex', flexDirection: 'column', gap: p.gap === undefined ? 8 : p.gap, minWidth: 0,
    }, p.style || {}),
  }, p.children)
}

// ── 卡片 ───────────────────────────────────────────────────────────
function Card(props) {
  const p = props || {}
  return h('section', {
    style: Object.assign({
      border: '1px solid ' + T.border,
      borderRadius: T.radiusLg,
      background: T.bg1,
      padding: p.padded === false ? 0 : '12px 14px',
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }, p.style || {}),
  },
    (p.title || p.sub || p.tag || p.actions)
      ? h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
          h('div', { style: { fontSize: 13.5, fontWeight: 600, color: T.text, letterSpacing: 0.2 } }, p.title || ''),
          p.tag ? h('span', { style: { fontSize: 10.5, color: T.text3 } }, p.tag) : null,
          p.sub ? h('span', { style: { fontSize: 11.5, color: T.text2 } }, p.sub) : null,
          p.actions ? h('span', { style: { marginLeft: 'auto' } }, p.actions) : null,
        )
      : null,
    p.children,
  )
}

// ── 表单 ───────────────────────────────────────────────────────────
function Field(props) {
  const p = props || {}
  if (p.inline) {
    return h('label', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }, p.style || {}) },
      h('span', { style: { fontSize: 12.5, color: T.text2, flex: '0 0 auto', minWidth: 72 } }, p.label),
      h('span', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 } }, p.children),
    )
  }
  return h('label', { style: Object.assign({ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }, p.style || {}) },
    p.label ? h('span', { style: { fontSize: 12, color: T.text2 } }, p.label) : null,
    p.children,
    p.hint ? h('span', { style: { fontSize: 10.5, color: T.text3, lineHeight: 1.5 } }, p.hint) : null,
  )
}

function inputStyle(p) {
  return Object.assign({
    width: '100%', minWidth: 0,
    background: T.bg2,
    border: '1px solid ' + T.border,
    borderRadius: 9,
    color: T.text,
    fontSize: 13,
    lineHeight: '18px',
    padding: '7px 10px',
    fontFamily: p.mono ? T.mono : T.font,
    boxSizing: 'border-box',
  }, p.style || {})
}

function TextInput(props) {
  const p = props || {}
  return h('input', {
    className: 'sbc-input',
    type: p.password ? 'password' : (p.type || 'text'),
    value: p.value === undefined || p.value === null ? '' : String(p.value),
    placeholder: p.placeholder || '',
    disabled: p.disabled || undefined,
    autoFocus: p.autoFocus || undefined,
    onChange: (e) => { if (p.onChange) p.onChange(e.target.value) },
    onKeyDown: p.onEnter ? (e) => { if (e.key === 'Enter' && !e.isComposing) p.onEnter(e) } : undefined,
    style: inputStyle(p),
  })
}

function TextArea(props) {
  const p = props || {}
  return h('textarea', {
    className: 'sbc-input',
    value: p.value === undefined || p.value === null ? '' : String(p.value),
    rows: p.rows || 3,
    placeholder: p.placeholder || '',
    disabled: p.disabled || undefined,
    onChange: (e) => { if (p.onChange) p.onChange(e.target.value) },
    onKeyDown: p.onKeyDown || undefined,
    style: Object.assign(inputStyle(p), { resize: p.resize || 'vertical', lineHeight: 1.6 }, p.style || {}),
  })
}

// 数字输入：内部保持字符串以便输入中间态，失焦时按 min/max 夹紧并回写数字
function NumInput(props) {
  const p = props || {}
  const [text, setText] = React.useState(() => (p.value === undefined || p.value === null ? '' : String(p.value)))
  const [focused, setFocused] = React.useState(false)
  React.useEffect(() => {
    if (!focused) setText(p.value === undefined || p.value === null ? '' : String(p.value))
  }, [p.value, focused])
  const commit = () => {
    setFocused(false)
    const n = Number(text)
    const hasMin = typeof p.min === 'number'
    const hasMax = typeof p.max === 'number'
    let v = Number.isFinite(n) ? n : (p.min !== undefined ? p.min : 0)
    if (hasMin) v = Math.max(p.min, v)
    if (hasMax) v = Math.min(p.max, v)
    setText(String(v))
    if (p.onChange) p.onChange(v)
  }
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, flex: p.flex ? 1 : '0 0 auto' } },
    h('input', {
      className: 'sbc-input',
      type: 'number',
      value: text,
      min: p.min,
      max: p.max,
      step: p.step,
      disabled: p.disabled || undefined,
      onFocus: () => setFocused(true),
      onChange: (e) => setText(e.target.value),
      onBlur: commit,
      onKeyDown: (e) => { if (e.key === 'Enter') { e.currentTarget.blur() } },
      style: Object.assign(inputStyle(p), { width: p.width || 88, textAlign: 'right', padding: '5px 8px' }, p.style || {}),
    }),
    p.suffix ? h('span', { style: { fontSize: 11.5, color: T.text3, whiteSpace: 'nowrap' } }, p.suffix) : null,
  )
}

function Select(props) {
  const p = props || {}
  const options = p.options || []
  return h('select', {
    className: 'sbc-input',
    value: p.value === undefined || p.value === null ? '' : String(p.value),
    disabled: p.disabled || undefined,
    onChange: (e) => { if (p.onChange) p.onChange(e.target.value) },
    style: Object.assign(inputStyle(p), { cursor: 'pointer', padding: '6px 8px' }, p.style || {}),
  }, options.map((o) => h('option', { key: String(o.value), value: String(o.value) }, o.label === undefined ? String(o.value) : o.label)))
}

function Toggle(props) {
  const p = props || {}
  const on = !!p.checked
  const disabled = !!p.disabled
  return h('label', {
    style: { display: 'inline-flex', alignItems: 'center', gap: 8, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1, minWidth: 0 },
  },
    h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': on,
      disabled: disabled || undefined,
      onClick: () => { if (!disabled && p.onChange) p.onChange(!on) },
      style: {
        width: 36, height: 20, borderRadius: 999, border: '1px solid ' + (on ? T.brand : T.border),
        background: on ? T.brand : 'rgba(127,127,127,.18)', position: 'relative', cursor: disabled ? 'default' : 'pointer',
        padding: 0, flexShrink: 0, transition: 'background .16s ease',
      },
    }, h('span', {
      style: {
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, borderRadius: '50%',
        background: '#fff', transition: 'left .16s ease', display: 'block',
      },
    })),
    p.label ? h('span', { style: { fontSize: 12.5, color: T.text2 } }, p.label) : null,
  )
}

function Slider(props) {
  const p = props || {}
  return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 120 } },
    h('input', {
      className: 'sbc-range',
      type: 'range',
      value: p.value === undefined ? 0 : p.value,
      min: p.min === undefined ? 0 : p.min,
      max: p.max === undefined ? 100 : p.max,
      step: p.step === undefined ? 1 : p.step,
      onChange: (e) => { if (p.onChange) p.onChange(Number(e.target.value)) },
      style: { flex: 1, minWidth: 80 },
    }),
    h('span', { style: { fontSize: 11.5, color: T.text2, minWidth: 34, textAlign: 'right' } }, String(p.value === undefined ? '' : p.value)),
  )
}

function Tabs(props) {
  const p = props || {}
  const items = p.items || []
  return h('div', { style: Object.assign({ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }, p.style || {}) },
    items.map((it) => {
      const active = String(it.key) === String(p.value)
      return h('button', {
        key: String(it.key),
        type: 'button',
        className: 'sbc-btn',
        onClick: () => { if (p.onChange) p.onChange(it.key) },
        style: {
          padding: p.dense ? '3px 10px' : '5px 13px',
          borderRadius: p.pill === false ? 8 : 999,
          border: '1px solid ' + (active ? T.brand : T.border),
          background: active ? 'rgba(47,107,216,.16)' : 'transparent',
          color: active ? T.text : T.text2,
          fontSize: p.dense ? 11.5 : 12.5,
          cursor: 'pointer',
          fontFamily: T.font,
          whiteSpace: 'nowrap',
        },
      }, it.icon ? h('span', { style: { marginRight: 4 } }, it.icon) : null, it.label)
    }),
  )
}

// ── 弹层 ───────────────────────────────────────────────────────────
function Modal(props) {
  const p = props || {}
  React.useEffect(() => {
    if (!p.open) return undefined
    const fn = (e) => { if (e.key === 'Escape' && p.onClose) p.onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [p.open, p.onClose])
  if (!p.open) return null
  return h('div', {
    style: {
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(4,8,14,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    },
    onMouseDown: (e) => { if (e.target === e.currentTarget && p.onClose) p.onClose() },
  },
    h('div', {
      className: 'sbc-fade',
      style: {
        width: p.width || 520, maxWidth: '100%', maxHeight: '88vh', overflow: 'auto',
        background: T.overlay, border: '1px solid ' + T.border2, borderRadius: T.radiusLg,
        boxShadow: '0 24px 60px rgba(0,0,0,.42)', display: 'flex', flexDirection: 'column',
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid ' + T.border } },
        h('div', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, p.title || ''),
        h('span', { style: { marginLeft: 'auto' } }, h(Btn, { size: 'sm', kind: 'ghost', onClick: p.onClose, title: '关闭' }, '✕')),
      ),
      h('div', { className: 'sbc-scroll', style: { padding: '12px 14px', minWidth: 0 } }, p.children),
      p.footer ? h('div', { style: { padding: '10px 14px', borderTop: '1px solid ' + T.border, display: 'flex', gap: 8, justifyContent: 'flex-end' } }, p.footer) : null,
    ),
  )
}

function ToastHost() {
  const list = useStore(ToastStore)
  if (!list.length) return null
  return h('div', {
    style: { position: 'fixed', right: 18, bottom: 20, zIndex: 4000, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end', pointerEvents: 'none' },
  }, list.map((t) => h('div', {
    key: t.id,
    className: 'sbc-fade',
    style: {
      background: t.kind === 'error' ? T.danger : t.kind === 'ok' ? T.ok : T.overlay,
      color: t.kind === 'error' || t.kind === 'ok' ? '#fff' : T.text,
      border: '1px solid ' + (t.kind === 'error' || t.kind === 'ok' ? 'transparent' : T.border2),
      borderRadius: 10, padding: '7px 13px', fontSize: 12.5, maxWidth: 420,
      boxShadow: '0 10px 26px rgba(0,0,0,.32)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    },
  }, t.text)))
}

// 确认/提示/输入对话框的宿主组件（挂在 AppShell 最外层一次即可）
function DialogHost() {
  const list = useStore(DialogStore)
  const entry = list[0] || null
  const [text, setText] = React.useState('')
  const entryId = entry ? entry.id : 0
  React.useEffect(() => { setText(entry && entry.kind === 'prompt' ? String(entry.value || '') : '') }, [entryId])
  if (!entry) return null
  const close = (value) => { try { entry.resolve(value) } catch (e) {} }
  const ok = () => close(entry.kind === 'prompt' ? String(text || '') : true)
  return h('div', {
    style: { position: 'fixed', inset: 0, zIndex: 3200, background: 'rgba(4,8,14,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
    onMouseDown: (e) => { if (e.target === e.currentTarget) close(entry.kind === 'prompt' ? null : false) },
  },
    h('div', {
      className: 'sbc-fade',
      style: {
        width: entry.kind === 'prompt' ? 420 : 400, maxWidth: '100%',
        background: T.overlay, border: '1px solid ' + T.border2, borderRadius: T.radiusLg,
        boxShadow: '0 24px 60px rgba(0,0,0,.45)', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
      },
    },
      h('div', { style: { fontSize: 14, fontWeight: 600, color: entry.danger ? T.danger : T.text } }, entry.title),
      h('div', { style: { fontSize: 13, color: T.text2, lineHeight: 1.65, whiteSpace: 'pre-wrap' } }, entry.text),
      entry.detail ? h('div', { style: { fontSize: 11.5, color: T.text3, lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, entry.detail) : null,
      entry.kind === 'prompt'
        ? h(TextInput, { value: text, onChange: setText, placeholder: entry.placeholder, autoFocus: true, onEnter: ok })
        : null,
      h('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 } },
        entry.kind === 'alert' ? null : h(Btn, { kind: 'ghost', onClick: () => close(entry.kind === 'prompt' ? null : false) }, entry.cancelText || '取消'),
        h(Btn, { kind: entry.danger ? 'danger' : 'primary', onClick: ok }, entry.okText || '确定'),
      ),
    ),
  )
}

// ── 状态块 ─────────────────────────────────────────────────────────
function Loading(props) {
  const p = props || {}
  return h('div', { style: Object.assign({ display: 'flex', alignItems: 'center', gap: 8, color: T.text2, fontSize: 12.5, padding: '14px 4px' }, p.style || {}) },
    h('span', { className: 'sbc-blink', style: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: T.brand } }),
    p.text || '加载中…',
  )
}

function Empty(props) {
  const p = props || {}
  return h('div', {
    style: Object.assign({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', color: T.text3, fontSize: 12.5, padding: '22px 12px', lineHeight: 1.7 }, p.style || {}),
  }, p.icon ? h('div', { style: { fontSize: 22, opacity: 0.7 } }, p.icon) : null, p.children)
}

function ErrorBox(props) {
  const p = props || {}
  const [retrying, setRetrying] = React.useState(false)
  const doRetry = async () => {
    if (!p.onRetry || retrying) return
    setRetrying(true)
    try { await p.onRetry() }
    catch (e) { try { toast('重试失败：' + String((e && e.message) || e), 'error') } catch (err) {} }
    finally { setRetrying(false) }
  }
  return h('div', {
    style: Object.assign({
      border: '1px solid ' + T.danger, borderRadius: T.radius, background: 'rgba(239,83,80,.08)',
      color: T.text, padding: '10px 12px', fontSize: 12.5, lineHeight: 1.7,
      display: 'flex', alignItems: 'center', gap: 10,
    }, p.style || {}),
  },
    h('span', { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
      (p.title ? p.title + '：' : '') + String(p.error || '出错了'),
    ),
    p.onRetry ? h(Btn, { size: 'sm', kind: 'ghost', onClick: doRetry, disabled: retrying }, retrying ? '重试中…' : '重试') : null,
  )
}

function Note(props) {
  const p = props || {}
  return h('div', { style: Object.assign({ fontSize: 11, color: T.text3, lineHeight: 1.6 }, p.style || {}) }, p.children)
}

function KV(props) {
  const p = props || {}
  return h('div', { style: { display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0, fontSize: 12.5, lineHeight: 1.7 } },
    h('span', { style: { color: T.text3, flexShrink: 0, minWidth: 68 } }, p.k),
    h('span', { style: { color: T.text, minWidth: 0, wordBreak: 'break-word', fontFamily: p.mono ? T.mono : T.font } }, p.v),
  )
}

// 图片：token 模式下后端要用带 header 的 fetch（见 Api.imgUrl）。
// 加载失败不自动重试（避免坏图无限重试打后端），给占位 + 手动「重试」。
function Img(props) {
  const p = props || {}
  const img = useImage(p.path, { bust: p.bust })
  const [broken, setBroken] = React.useState(false)
  React.useEffect(() => { setBroken(false) }, [img.src, p.path])
  const box = Object.assign({
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(127,127,127,.10)', borderRadius: p.round ? '50%' : 8,
    overflow: 'hidden', minWidth: 0, minHeight: 0,
    width: p.width || '100%', height: p.height || 'auto',
  }, p.style || {})
  if (!p.path) return h('span', { style: Object.assign({}, box, { fontSize: 11, color: T.text3 }) }, p.fallback || '')
  if (img.error || broken) {
    return h('span', { style: Object.assign({}, box, { flexDirection: 'column', gap: 4, fontSize: 10.5, color: T.text3, padding: 4, textAlign: 'center' }) },
      p.fallback || '图片加载失败',
      h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { setBroken(false); img.retry() } }, '重试'),
    )
  }
  if (!img.src) return h('span', { style: Object.assign({}, box, { fontSize: 10.5, color: T.text3 }) }, '加载中…')
  return h('img', {
    src: img.src,
    alt: p.alt || '',
    title: p.title || undefined,
    draggable: false,
    onClick: p.onClick,
    onError: () => setBroken(true),
    style: Object.assign({
      width: '100%', height: '100%', objectFit: p.fit || 'cover', display: 'block',
      borderRadius: p.round ? '50%' : 8, cursor: p.onClick ? 'pointer' : 'default',
    }, p.imgStyle || {}),
  })
}

function Avatar(props) {
  const p = props || {}
  const size = p.size || 34
  const safe = safeAvatarUrl(p.path)
  return h('span', {
    style: {
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      border: '1px solid ' + T.border, background: T.bg2,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', fontSize: Math.round(size * 0.42), color: T.text2,
    },
    title: p.title || p.name || undefined,
  }, safe
    ? h(Img, { path: safe, round: true, width: size, height: size, alt: p.name || '', fallback: initialOf(p.name) })
    : initialOf(p.name),
  )
}

ensureUiStyle()

    /* ===== src/client/00-core/hooks.js ===== */
// 00-core/hooks.js —— 数据 hooks（全部共享同一份轮询，避免每个组件各拉一遍）

// 运行时地址：发现完成后更新；外部（如断线重连）也会通知
function useRuntimeBase() {
  const [base, setBase] = React.useState(() => Runtime.baseSync() || DEFAULT_BASE)
  React.useEffect(() => {
    let alive = true
    const off = Runtime.subscribe((b) => { if (alive && b) setBase(b) })
    Runtime.discover().then((b) => { if (alive && b) setBase(b) }).catch(() => {})
    return () => { alive = false; off() }
  }, [])
  return base
}

// 页面是否可见（不可见时暂停轮询，省 CPU，N04）
function usePageVisible() {
  const [visible, setVisible] = React.useState(() => {
    try { return typeof document === 'undefined' ? true : document.visibilityState !== 'hidden' } catch (e) { return true }
  })
  React.useEffect(() => {
    if (typeof document === 'undefined') return undefined
    const fn = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', fn)
    return () => document.removeEventListener('visibilitychange', fn)
  }, [])
  return visible
}

// 定时器：enabled=false 或页面不可见时自动停
function useInterval(fn, ms, enabled) {
  const saved = React.useRef(fn)
  saved.current = fn
  const visible = usePageVisible()
  const on = enabled === undefined ? true : !!enabled
  React.useEffect(() => {
    if (!on || !visible || !ms) return undefined
    const t = setInterval(() => { try { saved.current() } catch (e) {} }, ms)
    return () => clearInterval(t)
  }, [ms, on, visible])
}

// 通用资源拉取：{ data, error, loading, reload }
// opts.refreshMs 轮询；opts.enabled=false 暂停；opts.deps 变化时重拉
function useApi(path, opts) {
  const o = opts || {}
  const [state, setState] = React.useState({ data: o.initial === undefined ? null : o.initial, error: '', loading: true, at: 0 })
  const seq = React.useRef(0)
  const pathRef = React.useRef(path)
  pathRef.current = path

  const load = React.useCallback(async () => {
    const my = ++seq.current
    try {
      const r = await Api.get(pathRef.current)
      if (my !== seq.current) return
      if (!r.ok) {
        setState((s) => ({ data: s.data, error: r.error || '请求失败', loading: false, at: Date.now() }))
        return
      }
      setState({ data: r.data, error: '', loading: false, at: Date.now() })
    } catch (e) {
      if (my !== seq.current) return
      setState((s) => ({ data: s.data, error: (e && e.message) || '请求失败', loading: false, at: Date.now() }))
    }
  }, [])

  const enabled = o.enabled === undefined ? true : !!o.enabled
  React.useEffect(() => {
    if (!enabled) { setState((s) => (s.loading ? Object.assign({}, s, { loading: false }) : s)); return }
    load()
  }, [path, enabled].concat(o.deps || []))

  useInterval(load, enabled ? (o.refreshMs || 0) : 0, enabled)

  const setData = React.useCallback((next) => {
    setState((s) => ({ data: typeof next === 'function' ? next(s.data) : next, error: '', loading: false, at: Date.now() }))
  }, [])

  return { data: state.data, error: state.error, loading: state.loading, reload: load, setData, at: state.at }
}

// ── 全局 /api/status（单例）────────────────────────────────────────────
const StatusStore = createStore({ data: null, error: '', at: 0 })
let statusTimer = 0
let statusFetching = false
let statusFails = 0
let statusVisibleBound = false
const statusSubs = new Set()

let statusFetchingAt = 0
async function pollStatusOnce() {
  if (statusFetching) {
    // 卡住超过 20 秒就当没在请求，否则一次挂起的请求会让以后所有轮询都 return（表现为「重试没反应」）
    if (Date.now() - statusFetchingAt > 20000) statusFetching = false
    else return
  }
  try { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return } catch (e) {}
  statusFetching = true
  statusFetchingAt = Date.now()
  try {
    const r = await Api.get('/api/status')
    if (!r.ok) throw new Error(r.error || 'HTTP ' + r.status)
    statusFails = 0
    StatusStore.set({ data: r.data, error: '', at: Date.now() })
  } catch (e) {
    statusFails += 1
    if (statusFails >= 2) {
      StatusStore.set((s) => ({ data: s.data, error: '运行时无响应', at: Date.now() }))
      // 运行时可能换了端口/重启了：重新发现一次
      Runtime.discover(true).catch(() => {})
    }
  } finally {
    statusFetching = false
  }
}

function syncStatusTimer() {
  const need = statusSubs.size > 0
  if (need && !statusTimer) {
    statusTimer = setInterval(() => { void pollStatusOnce() }, STATUS_POLL_MS)
    void pollStatusOnce()
  } else if (!need && statusTimer) {
    clearInterval(statusTimer)
    statusTimer = 0
  }
}

function useStatus() {
  const snap = useStore(StatusStore)
  React.useEffect(() => {
    const fn = () => {}
    statusSubs.add(fn)
    if (!statusVisibleBound && typeof document !== 'undefined') {
      statusVisibleBound = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncStatusTimer()
      })
    }
    syncStatusTimer()
    return () => { statusSubs.delete(fn); syncStatusTimer() }
  }, [])
  return snap
}

// localStorage 持久化状态
function useLocal(key, initial) {
  const [value, setValue] = React.useState(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return initial
      try { return JSON.parse(raw) } catch (e) { return raw }
    } catch (e) { return initial }
  })
  const set = React.useCallback((next) => {
    setValue((prev) => {
      const v = typeof next === 'function' ? next(prev) : next
      try { localStorage.setItem(key, JSON.stringify(v)) } catch (e) {}
      return v
    })
  }, [key])
  return [value, set]
}

// 图片：token 模式下后端要走带 header 的 fetch，所以统一从 Api.imgUrl 拿地址
function useImage(path, opts) {
  const o = opts || {}
  const item = path && typeof path === 'object' ? path : null
  const p = item ? (item.url || '') : (path || '')
  const bust = o.bust || (item && item.t) || 0
  const [state, setState] = React.useState({ src: '', error: '', loading: !!p, tick: 0 })
  React.useEffect(() => {
    let alive = true
    if (!p) { setState({ src: '', error: '', loading: false, tick: 0 }); return undefined }
    setState((s) => ({ src: s.src, error: '', loading: true, tick: s.tick }))
    Api.imgUrl(p, { bust }).then((src) => {
      if (!alive) return
      setState({ src: src || '', error: '', loading: false, tick: 0 })
    }).catch((e) => {
      if (!alive) return
      setState({ src: '', error: (e && e.message) || '图片加载失败', loading: false, tick: 0 })
    })
    return () => { alive = false }
  }, [p, bust, state.tick])
  const retry = React.useCallback(() => { setState((s) => ({ src: s.src, error: '', loading: true, tick: s.tick + 1 })) }, [])
  return { src: state.src, error: state.error, loading: state.loading, retry }
}

    /* ===== src/client/10-chat/chat.js ===== */
// 10-chat/chat.js —— 原生聊天（M02 聊天 / M05 停止 / M09 图片）
//
// 契约：function ChatView(props)；props.stageOpen（分屏 2D 舞台是否打开）、
//       props.onToggleStage（外壳联动开关舞台）。
//
// 数据流（全部走 00-core 的 Api，不请求任何 HTML 页面、没有 iframe）：
//   · 首屏 GET /api/events?since=0 拉历史；之后 useInterval 每 EVENTS_POLL_MS 用
//     since=lastId 增量轮询（页面隐藏时 useInterval 自动暂停）
//   · 轮询结果按 id 去重 + 排序后合并，没有新消息就返回原数组，不触发重渲染（N04）
//   · 打字态：/api/events 的 typing；停止：POST /api/chat/cancel
//   · 实时流：Api.stream()（不要 EventSource，token 模式下要带 header），事件
//     init/start/delta/done；done 后清掉流式气泡、由轮询补上正式消息，不重复不残留
//   · 切角色：/api/status.character.id 变化时作废在途请求、清空列表、从 since=0 重拉
//     （不同角色的消息 id 各自从 1 开始，游标不重置就会串数据/丢消息）

const CHAT_IMAGE_MAX_BYTES = 6 * 1024 * 1024
const CHAT_STREAM_RETRY_MS = 3000
const CHAT_LIVE_CLEAR_MS = 900
const CHAT_NEAR_BOTTOM_PX = 120

// ── 纯函数 ─────────────────────────────────────────────────────────

function chatMsgId(m) {
  const n = Number(m && m.id)
  return Number.isFinite(n) ? n : 0
}

// 消息唯一键：优先 id，其次 uid（服务端两条都有）
function chatMsgKey(m) {
  const id = chatMsgId(m)
  if (id) return 'id:' + id
  const uid = m && m.uid
  return uid ? 'uid:' + String(uid) : ''
}

function chatNormalizeMessages(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = Object.create(null)
  for (let i = 0; i < list.length; i++) {
    const m = list[i]
    if (!m || typeof m !== 'object') continue
    const key = chatMsgKey(m)
    if (!key || seen[key]) continue
    seen[key] = true
    out.push(m)
  }
  out.sort((a, b) => chatMsgId(a) - chatMsgId(b))
  return out
}

// 增量合并：只追加没见过的新消息；没有新消息时返回原数组（同引用 → React 不重渲染）
function chatMergeMessages(prev, incoming) {
  const fresh = chatNormalizeMessages(incoming)
  if (!fresh.length) return prev
  const seen = Object.create(null)
  for (let i = 0; i < prev.length; i++) {
    const k = chatMsgKey(prev[i])
    if (k) seen[k] = true
  }
  const add = []
  for (let i = 0; i < fresh.length; i++) {
    const k = chatMsgKey(fresh[i])
    if (!k || seen[k]) continue
    seen[k] = true
    add.push(fresh[i])
  }
  if (!add.length) return prev
  return chatNormalizeMessages(prev.concat(add))
}

// 当天的只显示时分，跨天的带上日期
function chatFmtAt(ts) {
  const n = Number(ts) || 0
  if (!n) return ''
  const d = new Date(n)
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? fmtTime(n) : fmtDateTime(n)
}

function chatFmtCount(n) {
  const v = Number(n) || 0
  if (v < 1000) return String(v)
  return (v / 1000).toFixed(1) + 'k'
}

// /api/events 的 usage 是 DeepSeek 返回的 token 用量（可能为 null）
function chatUsageText(u) {
  if (!u || typeof u !== 'object') return ''
  const p = Number(u.prompt_tokens) || 0
  const c = Number(u.completion_tokens) || 0
  if (!p && !c) return ''
  return '↑' + chatFmtCount(p) + ' ↓' + chatFmtCount(c) + ' tokens'
}

function chatSameUsage(a, b) {
  if (!a && !b) return true
  if (!a || !b) return false
  return Number(a.prompt_tokens) === Number(b.prompt_tokens) &&
    Number(a.completion_tokens) === Number(b.completion_tokens) &&
    Number(a.total_tokens) === Number(b.total_tokens)
}

function chatHerBubbleStyle() {
  return {
    background: T.bg1,
    border: '1px solid ' + T.border,
    borderRadius: '13px 13px 13px 5px',
    padding: '8px 12px',
    color: T.text,
    fontSize: 13,
    lineHeight: 1.66,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    minWidth: 0,
  }
}

function chatUserBubbleStyle() {
  return {
    background: T.brand,
    border: '1px solid ' + T.brand,
    borderRadius: '13px 13px 5px 13px',
    padding: '8px 12px',
    color: '#fff',
    fontSize: 13,
    lineHeight: 1.66,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    minWidth: 0,
  }
}

// ── 图片（消息图片 / 大图预览）──────────────────────────────────────

// 消息里的图片：加载失败有占位 + 重试，不阻塞文字（M09）
function ChatImage(props) {
  const p = props || {}
  const img = useImage(p.path)
  if (img.error) {
    return h('div', {
      style: {
        marginTop: 6, display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 11.5, color: T.text2, background: 'rgba(127,127,127,.10)',
        border: '1px dashed ' + T.border, borderRadius: 8, padding: '7px 10px',
      },
    },
      h('span', null, '图片加载失败'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: img.retry }, '重试'),
    )
  }
  if (!img.src) {
    return h('div', {
      style: {
        marginTop: 6, width: 160, height: 96, borderRadius: 8,
        background: 'rgba(127,127,127,.10)', border: '1px solid ' + T.border,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: T.text3,
      },
    }, '图片加载中…')
  }
  return h('img', {
    src: img.src,
    alt: p.alt || '图片',
    title: p.onOpen ? '点击看大图' : undefined,
    draggable: false,
    onClick: p.onOpen ? () => p.onOpen(p.path) : undefined,
    onError: img.retry,
    style: {
      display: 'block', marginTop: 6, maxWidth: 260, maxHeight: 260,
      borderRadius: 8, background: 'rgba(127,127,127,.08)',
      cursor: p.onOpen ? 'zoom-in' : 'default',
    },
  })
}

// 弹窗里的大图：独立用 useImage，失败可重试
function ChatBigImage(props) {
  const p = props || {}
  const img = useImage(p.path)
  if (!p.path) return null
  if (img.error) return h(ErrorBox, { title: '图片加载失败', error: img.error, onRetry: img.retry })
  if (!img.src) return h(Loading, { text: '图片加载中…' })
  return h('img', {
    src: img.src,
    alt: p.alt || '图片',
    draggable: false,
    onError: img.retry,
    style: { display: 'block', margin: '0 auto', maxWidth: '100%', maxHeight: '74vh', objectFit: 'contain', borderRadius: 10 },
  })
}

// ── 消息行（React.memo：新消息追加时不重建已有行，N04）────────────────

const ChatMessageRow = React.memo(function ChatMessageRowInner(props) {
  const p = props || {}
  const m = p.m || {}
  const role = m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'her')
  const text = m.text === undefined || m.text === null ? '' : String(m.text)
  const image = m.image ? String(m.image) : ''
  const at = chatFmtAt(m.at)

  if (role === 'system') {
    return h('div', {
      style: {
        alignSelf: 'center', maxWidth: '92%', textAlign: 'center',
        fontSize: 11.5, color: T.text3, background: 'rgba(127,127,127,.08)',
        border: '1px dashed ' + T.border, borderRadius: 10, padding: '5px 11px',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      },
    }, text)
  }

  const isUser = role === 'user'
  const who = isUser ? '你' : (p.charName || '她')
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      gap: 7,
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      maxWidth: '86%',
      minWidth: 0,
    },
  },
    isUser ? null : h(Avatar, { path: p.charAvatar, name: p.charName, size: 26 }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, alignItems: isUser ? 'flex-end' : 'flex-start' } },
      h('div', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap' } }, who + (at ? ' · ' + at : '')),
      h('div', { className: 'sbc-fade', style: isUser ? chatUserBubbleStyle() : chatHerBubbleStyle() },
        text ? h('div', null, text) : null,
        image ? h(ChatImage, { path: image, onOpen: p.onOpenImage }) : null,
        (!text && !image) ? h('div', { style: { fontSize: 12, color: T.text3 } }, '（这条消息没有内容）') : null,
      ),
    ),
  )
})

// 流式气泡：文本边收边显示；done 之后由 ChatView 清掉
function ChatLiveBubble(props) {
  const p = props || {}
  const text = p.text || ''
  return h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 7, alignSelf: 'flex-start', maxWidth: '86%', minWidth: 0 } },
    h(Avatar, { path: p.charAvatar, name: p.charName, size: 26 }),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 } },
      h('div', { style: { fontSize: 10, color: T.text3 } }, (p.charName || '她') + ' · 正在输入…'),
      h('div', { style: chatHerBubbleStyle() },
        h('span', null, text || '……'),
        h('span', {
          className: 'sbc-blink',
          style: { display: 'inline-block', width: 2, height: 13, marginLeft: 2, verticalAlign: '-2px', background: T.text2 },
        }),
      ),
    ),
  )
}

// 只表示「对方正在输入」，还没有任何流式文本时显示
function ChatTypingDots(props) {
  const p = props || {}
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, alignSelf: 'flex-start', padding: '2px 0' } },
    h(Avatar, { path: p.charAvatar, name: p.charName, size: 26 }),
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 3,
        background: T.bg1, border: '1px solid ' + T.border, borderRadius: 12, padding: '8px 11px',
      },
    }, [0, 1, 2].map((i) => h('span', {
      key: i,
      className: 'sbc-blink',
      style: {
        display: 'inline-block', width: 5, height: 5, borderRadius: '50%',
        background: T.text2, animationDelay: (i * 0.16) + 's',
      },
    }))),
    h('span', { style: { fontSize: 11, color: T.text3 } }, (p.charName || '她') + ' 正在输入…'),
  )
}

// ── ChatView ───────────────────────────────────────────────────────

function ChatView(props) {
  const p = props || {}
  const stageOpen = !!p.stageOpen
  const onToggleStage = typeof p.onToggleStage === 'function' ? p.onToggleStage : null

  // 角色信息只从 /api/status 取（不写死角色名/头像，N02）；useStatus 是全局单例轮询
  const status = useStatus()
  const st = (status && status.data) || null
  const char = (st && st.character) || null
  const charId = char && char.id !== undefined && char.id !== null ? String(char.id) : ''
  const charName = char && char.name ? String(char.name) : '她'
  const charAvatar = char && char.avatar ? String(char.avatar) : ''

  const [msgs, setMsgs] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [bootError, setBootError] = React.useState('')
  const [pollError, setPollError] = React.useState('')
  const [typing, setTyping] = React.useState(false)
  const [liveText, setLiveText] = React.useState(null)
  const [usage, setUsage] = React.useState(null)
  const [input, setInput] = React.useState('')
  const [outImage, setOutImage] = React.useState(null)
  const [sending, setSending] = React.useState(false)
  const [stopping, setStopping] = React.useState(false)
  const [sendError, setSendError] = React.useState('')
  const [bigImage, setBigImage] = React.useState('')
  const [atBottom, setAtBottom] = React.useState(true)

  const listRef = React.useRef(null)
  const fileRef = React.useRef(null)
  const mountedRef = React.useRef(true)
  const lastIdRef = React.useRef(0)
  const genRef = React.useRef(0)            // 作废在途请求（切角色/重新拉历史时 ++）
  const pollingRef = React.useRef(false)
  const failsRef = React.useRef(0)
  const atBottomRef = React.useRef(true)
  const atBottomUiRef = React.useRef(true)
  const pendingBottomRef = React.useRef(true)
  const liveRef = React.useRef(null)
  const liveDoneAtRef = React.useRef(0)
  const sendingRef = React.useRef(false)
  const stoppingRef = React.useRef(false)
  const charIdRef = React.useRef('')
  const pollRef = React.useRef(null)

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  React.useEffect(() => { liveRef.current = liveText }, [liveText])

  // ── 历史加载 ────────────────────────────────────────────────────
  // silent=true 用于后台自动重试：不清空已有消息、不闪「加载中」，只把结果写回
  const loadInitial = React.useCallback(async (silent) => {
    const gen = ++genRef.current
    if (!silent) {
      pendingBottomRef.current = true
      setLoading(true)
      setBootError('')
    }
    const r = await Api.get('/api/events?since=0')
    if (gen !== genRef.current || !mountedRef.current) return
    if (!r.ok) {
      setLoading(false)
      setBootError(r.error || '读取聊天记录失败')
      return
    }
    const data = r.data || {}
    const list = chatNormalizeMessages(data.messages)
    lastIdRef.current = list.length ? chatMsgId(list[list.length - 1]) : 0
    failsRef.current = 0
    pendingBottomRef.current = true
    setMsgs(list)
    setTyping(!!data.typing)
    setUsage(data.usage || null)
    setPollError('')
    setBootError('')
    setLoading(false)
  }, [])

  // ── 增量轮询 ────────────────────────────────────────────────────
  const poll = React.useCallback(async () => {
    if (pollingRef.current) return
    const gen = genRef.current
    pollingRef.current = true
    let r
    try {
      r = await Api.get('/api/events?since=' + lastIdRef.current)
    } catch (e) {
      r = { ok: false, error: (e && e.message) || '网络错误' }
    }
    pollingRef.current = false
    if (gen !== genRef.current || !mountedRef.current) return
    if (!r || !r.ok) {
      failsRef.current += 1
      // 单次抖动不打扰；连续失败才在输入区上方提示（已有消息不清空）
      if (failsRef.current >= 2) setPollError((r && r.error) || '运行时无响应')
      return
    }
    failsRef.current = 0
    setPollError('')
    const data = r.data || {}
    setTyping(!!data.typing)
    // usage 是同一份对象内容，内容没变就不换 state，避免每次轮询都重渲染
    setUsage((prev) => (chatSameUsage(prev, data.usage) ? prev : (data.usage || null)))
    const list = chatNormalizeMessages(data.messages)
    if (list.length) {
      const maxId = chatMsgId(list[list.length - 1])
      if (maxId > lastIdRef.current) lastIdRef.current = maxId
      setMsgs((prev) => chatMergeMessages(prev, list))
      // 正式消息已落库：流式气泡让位，同一句话不能出现两遍
      if (liveRef.current !== null && !data.typing) setLiveText(null)
    } else if (!data.typing && liveRef.current !== null && Date.now() - liveDoneAtRef.current > CHAT_LIVE_CLEAR_MS) {
      setLiveText(null)
    }
    if (!data.typing && stoppingRef.current) {
      stoppingRef.current = false
      setStopping(false)
    }
  }, [])

  React.useEffect(() => { pollRef.current = poll }, [poll])
  React.useEffect(() => { void loadInitial() }, [loadInitial])

  // 页面隐藏时 useInterval 自动暂停（EVENTS_POLL_MS 来自 const.js）
  useInterval(() => { void poll() }, EVENTS_POLL_MS, !loading && !bootError)
  // 首屏失败后自动重试：面板可能比运行时先起来，运行时恢复后不用用户手动点
  useInterval(() => { void loadInitial(true) }, STATUS_POLL_MS, !!bootError)

  // ── 实时流（Api.stream，不是 EventSource）────────────────────────
  const handleStreamEvent = React.useCallback((ev) => {
    if (!ev || typeof ev !== 'object') return
    const type = String(ev.type || '')
    if (type === 'start') {
      liveDoneAtRef.current = 0
      setLiveText('')
      return
    }
    if (type === 'delta') {
      const piece = String(ev.text || '')
      if (!piece) return
      liveDoneAtRef.current = 0
      setLiveText((prev) => (prev === null ? piece : prev + piece))
      return
    }
    if (type === 'init') {
      // 中途接上：active 时把已经生成的部分补出来，否则清掉上一段残留
      setLiveText(ev.active ? String(ev.text || '') : null)
      return
    }
    if (type === 'done') {
      const at = Date.now()
      liveDoneAtRef.current = at
      // 兜底：万一轮询没及时补上正式消息，也不能留一个假气泡
      setTimeout(() => {
        if (liveDoneAtRef.current === at) setLiveText(null)
      }, CHAT_LIVE_CLEAR_MS)
      // 立刻拉一次，让正式消息尽快替换掉流式气泡
      setTimeout(() => { if (pollRef.current) void pollRef.current() }, 120)
    }
  }, [])

  React.useEffect(() => {
    let alive = true
    let ctrl = null
    let timer = 0
    const connect = () => {
      if (!alive) return
      ctrl = new AbortController()
      Api.stream(handleStreamEvent, { signal: ctrl.signal })
        .catch(() => {})
        .then(() => {
          if (!alive) return
          timer = setTimeout(connect, CHAT_STREAM_RETRY_MS)
        })
    }
    connect()
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      try { if (ctrl) ctrl.abort() } catch (e) {}
    }
  }, [handleStreamEvent])

  // ── 切角色：作废在途请求 + 清空列表 + 从 since=0 重拉（不串数据）─────
  React.useEffect(() => {
    if (!charId) return
    if (!charIdRef.current) { charIdRef.current = charId; return }
    if (charIdRef.current === charId) return
    charIdRef.current = charId
    genRef.current++
    lastIdRef.current = 0
    failsRef.current = 0
    pollingRef.current = false
    liveDoneAtRef.current = 0
    setMsgs([])
    setTyping(false)
    setLiveText(null)
    setUsage(null)
    setPollError('')
    setSendError('')
    setBigImage('')
    pendingBottomRef.current = true
    void loadInitial()
  }, [charId, loadInitial])

  // ── 滚动：本来就在底部才跟随；不打断用户回看历史 ──────────────────
  React.useEffect(() => {
    const el = listRef.current
    if (!el) return
    if (!pendingBottomRef.current && !atBottomRef.current) return
    pendingBottomRef.current = false
    el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    if (!atBottomUiRef.current) { atBottomUiRef.current = true; setAtBottom(true) }
  }, [msgs, liveText, loading])

  const onListScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < CHAT_NEAR_BOTTOM_PX
    atBottomRef.current = near
    if (near !== atBottomUiRef.current) {
      atBottomUiRef.current = near
      setAtBottom(near)
    }
  }

  const jumpToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    atBottomRef.current = true
    if (!atBottomUiRef.current) { atBottomUiRef.current = true; setAtBottom(true) }
  }

  // ── 发送 ───────────────────────────────────────────────────────
  const sendNow = async () => {
    if (sendingRef.current) return
    const text = String(input || '').trim()
    const image = outImage && outImage.dataUrl ? outImage.dataUrl : ''
    if (!text && !image) return
    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      const body = { text }
      if (image) body.images = [image]
      const r = await Api.post('/api/chat', body)
      if (!r.ok) {
        // 失败时不清空输入/图片，原文留着可直接重试
        const msg = r.error || ('发送失败（HTTP ' + r.status + '）')
        setSendError(msg)
        toast(msg, 'error')
        return
      }
      setInput('')
      setOutImage(null)
      pendingBottomRef.current = true
      void poll()
    } catch (e) {
      const msg = '发送失败：' + ((e && e.message) || '网络错误')
      setSendError(msg)
      toast(msg, 'error')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  // ── 停止（typing 时才显示按钮，M05）─────────────────────────────
  const stopReply = async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    setStopping(true)
    try {
      const r = await Api.post('/api/chat/cancel', {})
      if (!r.ok) {
        stoppingRef.current = false
        setStopping(false)
        toast('停止失败：' + (r.error || '运行时无响应'), 'error')
        return
      }
      setTimeout(() => { void poll() }, 300)
      // 中止是异步的：稍后再拉一次，等 typing 变 false 再恢复按钮
      setTimeout(() => { if (stoppingRef.current) void poll() }, 1000)
      // 兜底：轮询一直拿不到结果（运行时失联）也不能让按钮永远卡在「停止中…」
      setTimeout(() => {
        if (!stoppingRef.current) return
        stoppingRef.current = false
        setStopping(false)
      }, 4000)
    } catch (e) {
      stoppingRef.current = false
      setStopping(false)
      toast('停止失败：' + ((e && e.message) || '网络错误'), 'error')
    }
  }

  // ── 选图片（上限 6MB：base64 膨胀 1.33 倍后仍在服务端 8MB 上限内）────
  const onPickFile = async (e) => {
    const el = e && e.target
    const file = el && el.files && el.files[0]
    if (el) { try { el.value = '' } catch (err) {} }
    if (!file) return
    // 00-core 里它在 Api 上（不在顶层作用域）
    const rd = await Api.readFileAsDataUrl(file, CHAT_IMAGE_MAX_BYTES)
    if (!rd.ok) { toast(rd.error || '读取图片失败', 'error'); return }
    setOutImage({ dataUrl: rd.dataUrl, name: String(file.name || '图片'), size: Number(file.size) || 0 })
  }

  // ── 渲染 ───────────────────────────────────────────────────────

  const live = liveText !== null
  const busy = typing || live
  const canSend = !sending && (String(input || '').trim().length > 0 || !!outImage)
  const usageText = chatUsageText(usage)
  // 列表元素只随消息/角色变化重建；流式 delta 不会重算整个列表（N04）
  const rows = React.useMemo(
    () => msgs.map((m, i) => h(ChatMessageRow, {
      key: keyOf(m, i),
      m,
      charName,
      charAvatar,
      onOpenImage: setBigImage,
    })),
    [msgs, charName, charAvatar],
  )

  return h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 } },
    // 消息区
    h('div', { style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' } },
      h('div', {
        ref: listRef,
        className: 'sbc-scroll',
        onScroll: onListScroll,
        style: {
          flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden',
          padding: '12px 14px 6px', display: 'flex', flexDirection: 'column', gap: 10,
        },
      },
        loading ? h(Loading, { text: '正在读取聊天记录…' }) : null,
        (!loading && bootError)
          ? h('div', { style: { padding: '6px 0' } },
              h(ErrorBox, { title: '聊天记录读取失败', error: bootError, onRetry: () => { void loadInitial() } }),
              h(Note, { style: { marginTop: 6 } }, '检查一下运行时（本机 8900 起）是否还在，再点「重试」。'),
            )
          : null,
        (!loading && !bootError && !msgs.length && !busy) ? h(Empty, { icon: '💬', style: { marginTop: 28 } }, '还没有聊天记录，先跟她说句话吧。') : null,
        rows,
        live
          ? h(ChatLiveBubble, { text: liveText, charName, charAvatar })
          : (busy ? h(ChatTypingDots, { charName, charAvatar }) : null),
      ),
      (!atBottom && msgs.length)
        ? h('div', { style: { position: 'absolute', right: 14, bottom: 10, zIndex: 5 } },
            h(Btn, { size: 'sm', kind: 'soft', title: '回到最新消息', onClick: jumpToBottom }, '回到底部 ↓'))
        : null,
    ),
    // 输入区
    h('div', {
      style: {
        flexShrink: 0, borderTop: '1px solid ' + T.border, background: T.bg1,
        padding: '7px 12px 10px', display: 'flex', flexDirection: 'column', gap: 6,
      },
    },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 } },
        onToggleStage
          ? h(Btn, {
              size: 'sm', kind: 'ghost',
              title: stageOpen ? '隐藏右侧 2D 舞台，给聊天多留点空间' : '在右侧显示 2D 舞台',
              onClick: onToggleStage,
            }, stageOpen ? '隐藏舞台' : '显示舞台')
          : null,
        h('span', { style: { fontSize: 10.5, color: T.text3, minWidth: 0 } }, 'Enter 发送 · Shift+Enter 换行 · 📎 发图片'),
        h('span', { style: { flex: 1 } }),
        usageText ? h(Badge, { title: '最近一次模型用量（tokens）' }, usageText) : null,
      ),
      pollError ? h(ErrorBox, { error: '聊天更新失败：' + pollError, onRetry: () => { void poll() }, style: { padding: '6px 10px', fontSize: 11.5 } }) : null,
      sendError ? h(ErrorBox, { error: sendError, onRetry: () => { void sendNow() }, style: { padding: '6px 10px', fontSize: 11.5 } }) : null,
      outImage
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 } },
            h('span', {
              style: {
                width: 40, height: 40, borderRadius: 8, overflow: 'hidden',
                border: '1px solid ' + T.border, flexShrink: 0, background: 'rgba(127,127,127,.10)',
              },
            }, h('img', {
              src: outImage.dataUrl,
              alt: '待发送图片',
              draggable: false,
              style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
            })),
            h('span', { style: { fontSize: 11.5, color: T.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              '图片已就绪 · ' + fmtBytes(outImage.size)),
            h(Btn, { size: 'sm', kind: 'ghost', title: '移除这张图片', onClick: () => setOutImage(null) }, '移除'),
          )
        : null,
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'flex-end', minWidth: 0 } },
        h(Btn, {
          size: 'md', kind: 'ghost', title: '发一张图片（上限 6MB）',
          disabled: sending,
          onClick: () => { if (fileRef.current) fileRef.current.click() },
        }, '📎'),
        h(TextArea, {
          value: input,
          onChange: setInput,
          rows: 2,
          placeholder: '跟她说点什么…',
          style: { flex: 1, minWidth: 0, minHeight: 44, maxHeight: 150, resize: 'none' },
          onKeyDown: (e) => {
            const composing = !!(e.nativeEvent && e.nativeEvent.isComposing)
            if (e.key === 'Enter' && !e.shiftKey && !composing) {
              e.preventDefault()
              void sendNow()
            }
          },
        }),
        busy ? h(Btn, { kind: 'danger', title: '打断她这一轮回复', disabled: stopping, onClick: () => { void stopReply() } }, stopping ? '停止中…' : '停止') : null,
        h(Btn, { kind: 'primary', title: '发送（Enter）', disabled: !canSend, onClick: () => { void sendNow() } }, sending ? '发送中…' : '发送'),
      ),
      h('input', {
        ref: fileRef,
        type: 'file',
        accept: 'image/*',
        style: { display: 'none' },
        onChange: (e) => { void onPickFile(e) },
      }),
    ),
    h(Modal, { open: !!bigImage, title: '图片预览', onClose: () => setBigImage(''), width: 900 },
      h(ChatBigImage, { path: bigImage })),
  )
}

    /* ===== src/client/20-stage/skeleton.js ===== */
// 20-stage/skeleton.js —— 2D 角色「姿态帧 + 变换」动画（按角色分素材，绝不串角色）
//
// 为什么不用骨骼：我们只有 AI 生成的单张立绘，没有按关节画好的分层零件。硬切图拼骨骼
// 在旋转时会错位/露缝/散架（多轮实测失败）。DSH 生态里成熟插件（dsh-dfy 等）用的是
// 「多姿态素材 + CSS 变换 + 预渲染动作」，本文件采用同样思路。
//
// 素材解析顺序（关键：不会拿别的角色的图）：
//   1) 当前角色 id（/api/status → character.id），取 /skeleton-assets/<id>/poses/
//   2) 该角色没有姿态素材 → 直接用它自己的立绘（Avatar 组件，path 由调用方传入）
//   —— 始终不用别的角色的姿态图兜底，所以导入新角色不会「串成小鲸」。
//
// 「2D 表现」开关：localStorage sbc-2d-skeleton = '0' 关闭，回退到立绘。

const SKELETON_SWITCH_KEY = 'sbc-2d-skeleton'
const SKELETON_POSES = ['idle', 'walkA', 'walkB', 'wave', 'stretch', 'sleepy', 'happy']

let skeletonBaseCache = ''
let skeletonCharIdCache = { id: '', at: 0 }
const skeletonRigCache = {}
const skeletonPoseCache = {}

function skeletonBaseSync() {
  try { if (Runtime && Runtime.cachedBase) skeletonBaseCache = String(Runtime.cachedBase) } catch (e) {}
  return skeletonBaseCache
}
function skeletonEnabled() {
  try { return localStorage.getItem(SKELETON_SWITCH_KEY) !== '0' } catch (e) { return true }
}
function setSkeletonEnabled(on) {
  try { localStorage.setItem(SKELETON_SWITCH_KEY, on ? '1' : '0') } catch (e) {}
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('sbc-skeleton-changed')) } catch (e) {}
}
function skeletonAssetUrl(charId, rel) {
  const base = skeletonBaseSync()
  const prefix = '/skeleton-assets/' + encodeURIComponent(String(charId || 'xiaojing')) + '/'
  return base ? String(base).replace(/\/$/, '') + prefix + rel : prefix + rel
}
// 当前角色 id（/api/status.character.id），20 秒缓存；拿不到就空
function skeletonCharId() {
  const now = Date.now()
  if (skeletonCharIdCache.id && now - skeletonCharIdCache.at < 20000) return Promise.resolve(skeletonCharIdCache.id)
  return Promise.resolve()
    .then(() => Api.get('/api/status'))
    .then((r) => {
      const j = r && r.json
      const id = j && j.character && j.character.id ? String(j.character.id) : ''
      skeletonCharIdCache = { id, at: Date.now() }
      return id
    })
    .catch(() => skeletonCharIdCache.id || '')
}
// 某角色的姿态描述（poses.json）；没有返回 null（调用方回退立绘）
function skeletonRig(charId) {
  const key = String(charId || '')
  if (!key) return Promise.resolve(null)
  if (skeletonRigCache[key]) return skeletonRigCache[key]
  const base = skeletonBaseSync()
  const dir = (base ? String(base).replace(/\/$/, '') : '') + '/skeleton-assets/' + encodeURIComponent(key) + '/poses/'
  skeletonRigCache[key] = fetch(dir + 'poses.json', { cache: 'no-store' })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((j) => (j && j.poses && Object.keys(j.poses).length ? j : null))
    .catch(() => null)
  return skeletonRigCache[key]
}
function skeletonPoseUrl(charId, name) {
  const key = String(charId || '') + '/' + name
  if (!skeletonPoseCache[key]) {
    skeletonPoseCache[key] = Api.imgUrl('/skeleton-assets/' + encodeURIComponent(String(charId)) + '/poses/' + name + '.png')
      .catch(() => '')
  }
  return skeletonPoseCache[key]
}

function PoseAvatar(props) {
  const p = props || {}
  const height = Math.max(24, Number(p.size) || 96)
  const [charId, setCharId] = React.useState('')
  const [rig, setRig] = React.useState(null)
  const [enabled, setEnabled] = React.useState(skeletonEnabled())
  const [urls, setUrls] = React.useState({})
  const imgRef = React.useRef(null)
  const anim = React.useRef({ t: Math.random() * 6, phase: 0, movingUntil: 0, dir: 1, lastX: null })

  React.useEffect(() => {
    let alive = true
    skeletonCharId()
      .then((id) => { if (!alive) return null; setCharId(id); return id ? skeletonRig(id) : null })
      .then((r) => { if (alive) setRig(r || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  React.useEffect(() => {
    const onChange = () => setEnabled(skeletonEnabled())
    try { window.addEventListener('sbc-skeleton-changed', onChange) } catch (e) {}
    return () => { try { window.removeEventListener('sbc-skeleton-changed', onChange) } catch (e) {} }
  }, [])
  React.useEffect(() => {
    if (!charId || !rig) { setUrls({}); return }
    let alive = true
    const out = {}
    const names = Object.keys(rig.poses || {}).filter((n) => SKELETON_POSES.indexOf(n) >= 0)
    Promise.all(names.map((n) => skeletonPoseUrl(charId, n).then((u) => { if (u) out[n] = u }).catch(() => {})))
      .then(() => { if (alive) setUrls(Object.assign({}, out)) })
    return () => { alive = false }
  }, [charId, rig])
  React.useEffect(() => {
    const a = anim.current
    if (typeof p.moving === 'boolean') a.movingUntil = p.moving ? Date.now() + 600000 : 0
    const x = Number(p.x)
    if (p.x != null && Number.isFinite(x)) {
      if (a.lastX == null) a.lastX = x
      else if (Math.abs(x - a.lastX) > 0.0004) {
        a.dir = x > a.lastX ? 1 : -1
        a.lastX = x
        if (typeof p.moving !== 'boolean') a.movingUntil = Date.now() + 1400
      }
    }
  }, [p.moving, p.x])

  const ratio = rig && rig.canvas ? rig.canvas[0] / rig.canvas[1] : 1200 / 1800
  const cssW = height * ratio
  const idleUrl = urls['idle'] || ''

  React.useEffect(() => {
    if (!enabled || !idleUrl) return
    const rafFn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    if (!rafFn) return
    const cancelFn = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : function () {}
    let raf = 0, last = 0
    const frame = (now) => {
      if (!last) last = now
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      const a = anim.current
      const el = imgRef.current
      if (el) {
        el.style.transformOrigin = '50% 92%'
        const moving = a.movingUntil && Date.now() < a.movingUntil
        if (moving && urls['walkA'] && urls['walkB']) {
          a.phase += dt
          const pose = Math.floor(a.phase * 6) % 2 === 0 ? 'walkA' : 'walkB'
          if (el.dataset.pose !== pose) {
            el.dataset.pose = pose
            el.src = urls[pose] || idleUrl
          }
          const bob = -2.0 * Math.abs(Math.sin(a.phase * Math.PI * 6))
          const tilt = 1.1 * Math.sin(a.phase * Math.PI * 6)
          el.style.transform = 'translateY(' + bob.toFixed(2) + 'px) rotate(' + (a.dir > 0 ? tilt : -tilt).toFixed(2) + 'deg)'
        } else {
          a.t += dt
          if (el.dataset.pose !== 'idle') {
            el.dataset.pose = 'idle'
            el.src = idleUrl
          }
          const b = Math.sin(a.t * 1.6)
          el.style.transform = 'translateY(' + (-0.5 * b).toFixed(2) + 'px) scaleY(' + (1 + 0.006 * b).toFixed(4) + ') rotate(' + (0.35 * Math.sin(a.t * 0.8)).toFixed(2) + 'deg)'
        }
      }
      raf = rafFn(frame)
    }
    raf = rafFn(frame)
    return () => cancelFn(raf)
  }, [enabled, idleUrl, urls])

  const hasPose = !!(enabled && idleUrl)
  return h('span', {
    title: p.title || p.name || undefined,
    style: {
      position: 'relative', display: 'inline-block', width: hasPose ? cssW : height,
      height: height, flexShrink: 0, verticalAlign: 'bottom', pointerEvents: 'none', overflow: 'visible',
    },
  },
    hasPose
      ? h('img', {
          ref: imgRef, src: idleUrl, alt: p.name || '', draggable: false,
          style: { width: '100%', height: '100%', display: 'block', objectFit: 'contain', willChange: 'transform' },
        })
      : h(Avatar, { path: p.path, name: p.name, size: p.fallbackSize || 30 }),
  )
}

const SkeletonAvatar = PoseAvatar

    /* ===== src/client/20-stage/three3d.js ===== */
// 20-stage/three3d.js —— 3D 舞台（把 runtime/model.html 的 three.js 场景搬进原生面板）
//
// 契约：function ThreeStage(props)
//   props.data        GET /api/stage 的载荷（stage.js 的 useApi 每 2.5s 轮询一次）
//   props.compact     聊天分屏里的小尺寸（阴影分辨率 / 像素比降一档）
//   props.onPickPlace (place) => void，点击地点标记/建筑时调用，由 stage.js 发 POST /api/location
//   props.onFail      (reason: string) => void，WebGL/three 不可用时调用；stage.js 收到后切回 2D 并 toast
//
// 为什么不能直接 import：
//   · 源文件是「单文件工厂的片段」（scripts/build-client.mjs 拼成 lib/client.js），禁止 import/export；
//   · DSH 面板里注入 importmap 不可靠，所以 three 用运行时绝对地址动态 import；
//   · GLTFLoader / BufferGeometryUtils 里有裸导入（'three'、'../utils/BufferGeometryUtils.js'），
//     桌面端页面里没有 importmap 可解析，因此：fetch 源码 → 把每个 import 说明符改写成运行时绝对地址
//     （GLTFLoader 依赖的 BufferGeometryUtils 也走同一套，递归生成 blob URL） → blob: import。
//     只有「真的要加载某个 GLB」时才去取 GLTFLoader（真实数据里没有 GLB 时不产生额外请求）。
//   · 失败一律不抛到 React 外面：ThreeStage 统一 catch → props.onFail(中文原因)，绝不白屏。
//
// 卸载清理（M08「切换不泄漏」）：cancelAnimationFrame、renderer.dispose()/forceContextLoss()、
// 遍历 scene 释放 geometry/material/texture、移除 pointer/wheel/resize/contextlost 监听、断开 ResizeObserver。

// ─────────────────────────── A. vendor ESM 加载 ───────────────────────────

const SBC3D_VENDOR_THREE = 'three.module.min.js'
const SBC3D_VENDOR_GLTF = 'addons/loaders/GLTFLoader.js'

let sbc3dThreePromise = null
let sbc3dGltfPromise = null
const sbc3dBlobUrls = new Map() // vendor 源码绝对地址 → Promise<blob: URL>
const sbc3dModules = new Map() // vendor 源码绝对地址 → Promise<module>

// 运行时地址：面板刚挂载时 Runtime.baseSync() 可能还是 ''（还没发现端口），
// 这里统一用「先 await Runtime.base()，再落盘到绝对地址」。
function sbc3dVendorBase() {
  const b = Runtime.baseSync() || DEFAULT_BASE
  return String(b).replace(/\/+$/, '')
}

function sbc3dVendorUrl(rel) {
  return sbc3dVendorBase() + '/vendor/' + String(rel || '').replace(/^\/+/, '')
}

// import 说明符 → 运行时绝对地址；认不出来的（第三方裸包名）返回 ''，原样保留由浏览器报错。
function sbc3dResolveImport(spec, importerUrl) {
  const s = String(spec || '')
  if (!s) return ''
  if (s === 'three') return sbc3dVendorUrl(SBC3D_VENDOR_THREE)
  if (s.indexOf('three/') === 0) return sbc3dVendorUrl(s.slice(6))
  if (s.charAt(0) === '.') {
    try { return new URL(s, importerUrl).href } catch (e) { return '' }
  }
  return ''
}

async function sbc3dFetchText(url) {
  const r = await fetch(url, { cache: 'default' })
  if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status))
  return await r.text()
}

// 把源码里每个 import 说明符换成运行时绝对地址 / 依赖模块的 blob URL。
// 只处理「from 'x'」「import('x')」「import 'x'」三种形态，不认识的说明符原样保留。
async function sbc3dRewriteImports(code, importerUrl) {
  const re = /\b(?:from\s*|import\s*\(\s*|import\s+)(['"])([^'"\r\n]+)\1/g
  const jobs = []
  let m = re.exec(code)
  while (m) {
    jobs.push({ start: m.index, end: re.lastIndex, quote: m[1], spec: m[2] })
    m = re.exec(code)
  }
  if (!jobs.length) return code
  let out = ''
  let last = 0
  for (const job of jobs) {
    const abs = sbc3dResolveImport(job.spec, importerUrl)
    if (!abs) continue
    // three 自身是完整模块（没有 import），直接给地址；其它 addon 递归处理成 blob URL。
    const depUrl = abs === sbc3dVendorUrl(SBC3D_VENDOR_THREE) ? abs : await sbc3dBlobUrlFor(abs)
    const head = code.slice(job.start, job.end - job.spec.length - 2) // 去掉引号和 spec，保留 "from " / "import(" 等
    out += code.slice(last, job.start) + head + job.quote + depUrl + job.quote
    last = job.end
  }
  out += code.slice(last)
  return out
}

// vendor 源码 → 依赖改写后的 blob: URL（同一地址只做一次，失败不缓存，允许重试）
async function sbc3dBlobUrlFor(url) {
  const hit = sbc3dBlobUrls.get(url)
  if (hit) return hit
  const task = (async () => {
    const src = await sbc3dFetchText(url)
    const rewritten = await sbc3dRewriteImports(src, url)
    return URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }))
  })()
  sbc3dBlobUrls.set(url, task)
  try {
    return await task
  } catch (e) {
    sbc3dBlobUrls.delete(url)
    throw e
  }
}

async function sbc3dImportVendor(rel) {
  const url = sbc3dVendorUrl(rel)
  const hit = sbc3dModules.get(url)
  if (hit) return hit
  const task = (async () => {
    if (rel === SBC3D_VENDOR_THREE) return await import(url)
    const blobUrl = await sbc3dBlobUrlFor(url)
    return await import(blobUrl)
  })()
  sbc3dModules.set(url, task)
  try {
    return await task
  } catch (e) {
    sbc3dModules.delete(url)
    throw e
  }
}

// three 主模块（Promise 缓存；失败清缓存，下次挂载可重试）
function sbc3dLoadThree() {
  if (sbc3dThreePromise) return sbc3dThreePromise
  sbc3dThreePromise = (async () => {
    try { await Runtime.base() } catch (e) {}
    const mod = await sbc3dImportVendor(SBC3D_VENDOR_THREE)
    if (!mod || !mod.WebGLRenderer || !mod.Scene || !mod.PerspectiveCamera) throw new Error('模块内容不完整')
    return mod
  })()
  sbc3dThreePromise.catch(() => { sbc3dThreePromise = null })
  return sbc3dThreePromise
}

// GLTFLoader 按需加载（只有 map.model / 角色模型 / 载具模型是 GLB 时才需要）
function sbc3dLoadGltfLoader() {
  if (sbc3dGltfPromise) return sbc3dGltfPromise
  sbc3dGltfPromise = (async () => {
    const mod = await sbc3dImportVendor(SBC3D_VENDOR_GLTF)
    if (!mod || typeof mod.GLTFLoader !== 'function') throw new Error('模块内容不完整')
    return mod.GLTFLoader
  })()
  sbc3dGltfPromise.catch(() => { sbc3dGltfPromise = null })
  return sbc3dGltfPromise
}

// ─────────────────────────── B. 小工具 ───────────────────────────

const sbc3dAspectCache = new Map() // 图片地址 → 宽高比（0 = 认识这个地址但还没量出来）

function sbc3dImageAspect(url) {
  const v = Number(sbc3dAspectCache.get(String(url || '')))
  return v > 0.05 ? v : 0
}

// 量一次底图真实宽高比（世界高 = 世界宽 / 宽高比；官方地图是 2496x1664）
function sbc3dMeasureImage(url, onReady) {
  const key = String(url || '')
  if (!key || sbc3dAspectCache.has(key)) return
  sbc3dAspectCache.set(key, 0)
  try {
    Api.imgUrl(key).then((src) => {
      if (!src) return
      const img = new Image()
      img.onload = () => {
        const ar = (Number(img.naturalWidth) || 0) / (Number(img.naturalHeight) || 1)
        if (ar > 0.05) sbc3dAspectCache.set(key, ar)
        try { if (typeof onReady === 'function') onReady() } catch (e) {}
      }
      img.onerror = () => {}
      img.src = src
    }).catch(() => {})
  } catch (e) {}
}

// 面板主题里的品牌蓝（T.accent 是固定色值，可以直接给 canvas / WebGL 用）
function sbc3dAccent() {
  const v = String((T && T.accent) || '')
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '#3b82f6'
}

// 世界尺寸：model.html 用固定 120x77；这里按 map.widthMeters 等比换算（2000m ≈ 120 世界单位），
// 高度按底图宽高比推（没有底图时用 1000/640 兜底），保证 3D 里的方位和 2D 底图一致。
const SBC3D_WORLD_BASE = 120
const SBC3D_ASPECT_FALLBACK = 1000 / 640
function sbc3dWorldWidth(widthMeters) {
  const m = Number(widthMeters)
  const w = (SBC3D_WORLD_BASE * (Number.isFinite(m) && m > 0 ? m : 2000)) / 2000
  return clampNum(w, 80, 240, SBC3D_WORLD_BASE)
}

// ─────────────────────────── C. 场景（一个世界一个实例）───────────────────────────

// 创建整个 3D 世界。同步完成 renderer/scene/相机/灯光/交互/渲染循环的搭建；
// WebGL 不可用会抛带中文原因的 Error（由 sbc3dBoot 捕获 → onFail）。
// 返回：{ update(data), dispose(), canvas }
function sbc3dCreateWorld(host, opts, THREE) {
  const o = opts || {}
  if (!host || typeof host.appendChild !== 'function') throw new Error('3D 容器不存在')
  const compact = !!o.compact
  const doc = host.ownerDocument || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('当前环境没有 DOM')
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null)

  // ── renderer（WebGL 不可用 → 中文原因）──
  let renderer = null
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (e) {
    throw new Error('当前环境不支持 WebGL（显卡/浏览器限制），3D 舞台不可用')
  }
  if (!renderer || !renderer.domElement) throw new Error('WebGL 初始化失败，3D 舞台不可用')
  const canvas = renderer.domElement
  const dprCap = compact ? 1.5 : 2
  try { renderer.setPixelRatio(Math.min(Number(win && win.devicePixelRatio) || 1, dprCap)) } catch (e) {}
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  host.appendChild(canvas)

  const state = {
    data: null,
    worldKey: '',
    townKey: '',
    placesKey: '',
    terrainKey: '',
    envKey: '',
    vehiclesKey: '',
    charKey: '',
    pathKey: '',
    groundKey: '',
    groundToken: 0,
    official: false,
    showTown: false,
    envToken: 0,
    vehiclesToken: 0,
    charToken: 0,
    worldW: 0,
    worldH: 0,
    running: true,
    raf: 0,
    camReady: false,
    pointers: new Map(),
    dragging: false,
    lastX: 0,
    lastY: 0,
    pinch: 0,
    pinching: false,
    pressX: 0,
    pressY: 0,
    pressAt: 0,
    hoverDirty: false,
    hoverAt: 0,
    pointerInside: false,
    yaw: 0.9,
    pitch: 0.72,
    dist: 100,
    zoomTouched: false,
    maxDist: 320,
    envRadius: 0,
    charRadius: 0,
    fitApplied: 0,
    clock: null,
    mixer: null,
    charActions: [],
    activeCharAction: null,
    desiredCharClip: 'Idle',
    carMode: false,
    bikeMode: false,
  }

  // ── 场景 / 相机 / 灯光（色调与 model.html 一致）──
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x1a2c3a, 140, 320)
  scene.background = new THREE.Color(0x0d1a24)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
  camera.position.set(0, 90, 100)

  const hemi = new THREE.HemisphereLight(0xdceeff, 0x2a3a2a, 1.0)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xfff4e0, 2.3)
  dir.position.set(40, 70, 25)
  dir.castShadow = true
  dir.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048)
  dir.shadow.camera.left = -90
  dir.shadow.camera.right = 90
  dir.shadow.camera.top = 90
  dir.shadow.camera.bottom = -90
  dir.shadow.camera.near = 1
  dir.shadow.camera.far = 220
  dir.shadow.bias = -0.0005
  scene.add(dir)
  const ambient = new THREE.AmbientLight(0x445566, 0.65)
  scene.add(ambient)

  // ── 资源释放（材质缓存：程序化小镇共用材质，重建分组时只释放 geometry）──
  const matCache = new Map()
  const sharedMats = new Set()

  function disposeMaterial(m, keep) {
    if (!m || (keep && keep.has(m))) return
    for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) {
      try { if (m[k]) m[k].dispose() } catch (e) {}
    }
    try { m.dispose() } catch (e) {}
  }

  function disposeObject(obj, keep) {
    if (!obj || typeof obj.traverse !== 'function') return
    obj.traverse((node) => {
      try { if (node.geometry) node.geometry.dispose() } catch (e) {}
      const ms = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
      for (const m of ms) disposeMaterial(m, keep)
    })
  }

  function disposeChildren(group, keep) {
    if (!group) return
    for (const child of group.children.slice()) disposeObject(child, keep)
    try { group.clear() } catch (e) {}
  }

  function mat(color, rough, metal) {
    const key = String(color) + '|' + (rough === undefined ? 0.86 : rough) + '|' + (metal === undefined ? 0.02 : metal)
    if (!matCache.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: rough === undefined ? 0.86 : rough,
        metalness: metal === undefined ? 0.02 : metal,
      })
      matCache.set(key, m)
      sharedMats.add(m)
    }
    return matCache.get(key)
  }

  // ── 场景分组（和 model.html 一一对应）──
  const basePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 130),
    new THREE.MeshStandardMaterial({ color: 0x163447, roughness: 1, metalness: 0.02 })
  )
  basePlane.rotation.x = -Math.PI / 2
  basePlane.position.y = -0.55
  basePlane.receiveShadow = true
  scene.add(basePlane)

  const townGroup = new THREE.Group()
  scene.add(townGroup)
  const terrainGroup = new THREE.Group()
  scene.add(terrainGroup)
  const markerGroup = new THREE.Group()
  scene.add(markerGroup)
  const envGroup = new THREE.Group()
  scene.add(envGroup)
  const vehicleGroup = new THREE.Group()
  vehicleGroup.visible = false
  scene.add(vehicleGroup)
  const charGroup = new THREE.Group()
  scene.add(charGroup)

  let ground = null
  let grid = null
  let roadMeshes = []
  let carGroup = null
  let bikeGroup = null
  let routeLine = null
  let charModel = null
  let fallbackBody = null
  let spritePlane = null

  // 地点拾取：markerGroup / townGroup / envGroup 里挂了 userData.sbc3dPlaceId 的对象可点
  const placesById = new Map()
  const markerById = new Map()

  // ── 坐标换算：地图归一化 0~1 → 世界坐标 ──
  function toWorld(x, y, out) {
    const v = out || new THREE.Vector3()
    const px = Number(x)
    const py = Number(y)
    return v.set(
      ((Number.isFinite(px) ? px : 0.5) - 0.5) * state.worldW,
      0,
      ((Number.isFinite(py) ? py : 0.5) - 0.5) * state.worldH
    )
  }

  // ── 文字名牌（canvas 生成，不额外请求图片）──
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function labelSprite(text, icon) {
    const cw = 256
    const chh = 128
    const c = doc.createElement('canvas')
    c.width = cw
    c.height = chh
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(10,17,24,0.82)'
      roundRect(ctx, 12, 30, 232, 68, 16)
      ctx.fill()
      ctx.strokeStyle = sbc3dAccent()
      ctx.lineWidth = 4
      roundRect(ctx, 12, 30, 232, 68, 16)
      ctx.stroke()
      ctx.fillStyle = '#e3ecf5'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let size = 40
      const label = String(icon || '') + (icon ? ' ' : '') + String(text || '')
      for (; size > 18; size -= 2) {
        ctx.font = 'bold ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif'
        if (ctx.measureText(label).width <= 210) break
      }
      ctx.fillText(label, cw / 2, 64)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.needsUpdate = true
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false })
    const sp = new THREE.Sprite(m)
    sp.scale.set(8.5, 4.2, 1)
    return sp
  }

  // ── 地面 / 网格 / 程序化十字路 ──
  const themeColors = { town: 0x1d3a33, coast: 0x14425c, city: 0x22303c, forest: 0x1b3325 }

  function buildGround(theme, imageUrl) {
    const key = String(theme) + '|' + String(imageUrl || '')
    if (key === state.groundKey) return
    state.groundKey = key
    // 换地面就作废上一张底图的异步加载（避免旧图挂到新地面材质上）
    const token = ++state.groundToken
    if (ground) {
      scene.remove(ground)
      disposeObject(ground)
      ground = null
    }
    const geo = new THREE.PlaneGeometry(state.worldW, state.worldH)
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    if (!imageUrl) material.color.set(themeColors[theme] || themeColors.town)
    ground = new THREE.Mesh(geo, material)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    ground.receiveShadow = true
    scene.add(ground)
    if (imageUrl) {
      // token 模式下底图必须走 Api.imgUrl（blob），不能直接拼字符串
      Api.imgUrl(imageUrl).then((src) => {
        if (!src || token !== state.groundToken || !ground) return
        const loader = new THREE.TextureLoader()
        loader.load(src, (tex) => {
          if (token !== state.groundToken || !ground) { try { tex.dispose() } catch (e) {} return }
          try {
            tex.colorSpace = THREE.SRGBColorSpace
            material.map = tex
            material.color.set(0xffffff)
            material.needsUpdate = true
          } catch (err) {
            try { tex.dispose() } catch (e2) {}
          }
        }, undefined, () => {})
      }).catch(() => {})
    }
    if (!grid) {
      grid = new THREE.GridHelper(state.worldW, 24, 0x2a3a44, 0x22303a)
      grid.position.y = 0
      scene.add(grid)
    }
    for (const r of roadMeshes) { scene.remove(r); disposeObject(r) }
    roadMeshes = []
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a3a44, roughness: 0.9 })
    const road1 = new THREE.Mesh(new THREE.PlaneGeometry(state.worldW, 7), roadMat)
    road1.rotation.x = -Math.PI / 2
    road1.rotation.z = 0.05
    road1.position.set(0, 0.01, 0)
    scene.add(road1)
    const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, state.worldH), roadMat)
    road2.rotation.x = -Math.PI / 2
    road2.position.set(0, 0.01, 6)
    scene.add(road2)
    roadMeshes = [road1, road2]
  }

  // ── 低模小镇：每个地点一栋按 id 变化的建筑（移植 model.html 的 13 种）──
  function box(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  function roof(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4), mat(color, 0.78))
    m.rotation.y = Math.PI / 4
    m.position.set(x, y, z)
    m.castShadow = true
    return m
  }

  function tree(x, z, s) {
    const scale = s === undefined ? 1 : s
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.22 * scale, 1.2 * scale, 6), mat(0x86613e, 1))
    trunk.position.y = 0.6 * scale
    g.add(trunk)
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.95 * scale, 2.2 * scale, 7), mat(0x6f9f63, 0.95))
    crown.position.y = 2.1 * scale
    crown.castShadow = true
    g.add(crown)
    g.position.set(x, 0.08, z)
    return g
  }

  function addWindow(g, x, y, z, w, h, c) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w === undefined ? 0.55 : w, h === undefined ? 0.7 : h, 0.1), mat(c === undefined ? 0x35566f : c, 0.35, 0.08))
    m.position.set(x, y, z)
    g.add(m)
  }

  function door(g, x, z, c) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.25, 0.12), mat(c === undefined ? 0x75543b : c))
    m.position.set(x, 0.68, z)
    g.add(m)
  }

  function bench(g, x, z, ry) {
    const b = new THREE.Group()
    b.add(box(1.8, 0.12, 0.55, 0x9a744a, 0, 0.42, 0))
    b.add(box(1.8, 0.45, 0.12, 0x9a744a, 0, 0.68, -0.24))
    for (const dx of [-0.65, 0.65]) b.add(box(0.12, 0.45, 0.12, 0x6f5942, dx, 0.22, 0))
    b.position.set(x, 0, z)
    b.rotation.y = ry || 0
    g.add(b)
  }

  function buildTown(places) {
    const key = JSON.stringify((places || []).map((p) => [p.id, p.x, p.y]))
    if (key === state.townKey) return
    state.townKey = key
    disposeChildren(townGroup, sharedMats)
    for (const p of places || []) {
      const v = toWorld(p.x, p.y)
      const g = new THREE.Group()
      g.position.set(v.x, 0.02, v.z)
      g.userData.sbc3dPlaceId = String(p.id)
      g.add(box(4.6, 0.16, 4.0, 0xcab693, 0, 0.08, 0))
      const id = String(p.id)
      if (id === 'home') {
        g.add(box(4.2, 2.2, 3.6, 0xe5d3b5, 0, 1.1, 0))
        g.add(roof(4.2, 1.8, 3.6, 0x8e5d4b, 0, 3.0, 0))
        g.add(box(0.28, 1.7, 0.28, 0x9a7a58, 1.15, 3.2, -0.5))
        door(g, -0.65, 1.84)
        addWindow(g, 1.1, 1.5, 1.86)
        addWindow(g, -0.9, 1.5, -1.86)
        for (let i = 0; i < 2; i++) g.add(tree(-2.5 + i * 5.2, 2.2 + i, 0.8))
      } else if (id === 'school') {
        g.add(box(7.4, 4.2, 5.4, 0xe6d9c0, 0, 2.1, 0))
        g.add(roof(7.4, 2.0, 5.4, 0x587b99, 0, 5.3, 0))
        g.add(box(3.8, 1.8, 1.8, 0xdfd2b8, -4.8, 1.0, 0.8))
        g.add(box(1.6, 5.6, 1.6, 0xf2e8d5, 0, 2.8, 2.6))
        const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), mat(0x465e74, 0.4))
        clock.position.set(0, 4.6, 3.42)
        g.add(clock)
        for (let i = 0; i < 6; i++) addWindow(g, -2.5 + (i % 3) * 2.5, 1.8 + Math.floor(i / 3) * 1.5, 2.72, 0.8, 0.8, 0x507693)
        g.add(tree(-4.5, -3.2, 1))
        g.add(tree(4.5, -3.2, 1))
      } else if (id === 'library') {
        g.add(box(5.2, 3.4, 4.2, 0xe3dbc9, 0, 1.7, 0))
        g.add(roof(5.2, 1.6, 4.2, 0x70859e, 0, 4.1, 0))
        for (const x of [-1.8, 1.8]) g.add(box(0.45, 2.4, 0.45, 0xd8c7a5, x, 1.2, 2.05))
        door(g, 0, 2.12)
        g.add(tree(-3.2, 1.5, 0.85))
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7d8da0, 0.8))
        dome.position.y = 4.8
        g.add(dome)
      } else if (id === 'cafe') {
        g.add(box(3.9, 2.6, 3.4, 0xe6cfb2, 0, 1.3, 0))
        g.add(roof(3.9, 1.4, 3.4, 0xa55e4f, 0, 3.1, 0))
        g.add(box(3.0, 0.18, 0.95, 0xc98d72, 0, 2.0, 2.15))
        door(g, -0.8, 1.92)
        for (const x of [1.3, -1.4]) {
          const table = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 16), mat(0xf2e8d8))
          table.position.set(x, 0.78, 2.8)
          g.add(table)
          const umb = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.55, 10), mat(0xe0a45f, 0.8))
          umb.position.set(x, 1.55, 2.8)
          g.add(umb)
        }
      } else if (id === 'park') {
        const fountain = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.35, 24), mat(0x9ec8d8, 0.5))
        fountain.position.y = 0.22
        g.add(fountain)
        const water = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 24), mat(0x72b6cf, 0.3))
        water.position.y = 0.42
        g.add(water)
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          g.add(tree(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0.9 + (i % 2) * 0.2))
        }
        bench(g, -4.2, 0.5, Math.PI / 2)
        bench(g, 4.2, 0.5, -Math.PI / 2)
      } else if (id === 'canteen') {
        for (let i = 0; i < 3; i++) {
          const x = -2.5 + i * 2.5
          g.add(box(2.2, 1.4, 1.8, 0xe6d0aa, x, 0.7, 0))
          g.add(roof(2.2, 0.9, 1.8, i === 1 ? 0xd27e5e : 0x90a56d, x, 1.9, 0))
          door(g, x, 0.94)
        }
        g.add(box(3.2, 0.18, 1.2, 0xc49a68, 0, 0.7, 2.0))
      } else if (id === 'market') {
        for (let i = 0; i < 2; i++) {
          const x = -2.2 + i * 4.4
          g.add(box(3.2, 1.2, 2.1, 0xe0c49d, x, 0.6, 0))
          g.add(roof(3.2, 1.0, 2.1, i ? 0x8c9f75 : 0xc37c63, x, 1.8, 0))
          g.add(box(3.4, 0.18, 1.0, 0xf0e3cb, x, 1.45, 1.35))
        }
        g.add(box(1.2, 0.7, 1.2, 0xa7754f, 2.9, 0.35, 0.2))
        g.add(box(1.2, 0.7, 1.2, 0x9b805b, -2.9, 0.35, 0.2))
      } else if (id === 'hospital') {
        g.add(box(5.8, 3.4, 4.6, 0xf0ebe2, 0, 1.7, 0))
        g.add(box(6.2, 0.22, 5.0, 0xb8ccd4, 0, 3.5, 0))
        g.add(box(1.0, 0.24, 0.1, 0xc25552, 0, 2.5, 2.36))
        g.add(box(0.24, 1.0, 0.1, 0xc25552, 0, 2.5, 2.36))
        door(g, 0, 2.34, 0x59727d)
        for (const x of [-1.8, 1.8]) addWindow(g, x, 2.0, 2.33, 0.7, 0.8)
      } else if (id === 'bank') {
        g.add(box(4.8, 4.0, 4.2, 0xe9dfd0, 0, 2.0, 0))
        g.add(box(5.3, 0.28, 4.6, 0xb69b6d, 0, 4.15, 0))
        g.add(box(4.8, 0.4, 0.5, 0xd8bd91, 0, 4.5, 2.2))
        for (const x of [-2.4, 2.4]) g.add(box(0.35, 3.0, 0.35, 0xd8c4a2, x, 1.5, 2.2))
        door(g, 0, 2.42, 0x786044)
      } else if (id === 'mall') {
        g.add(box(7.0, 5.0, 5.4, 0xc8d1c7, 0, 2.5, 0))
        g.add(box(7.4, 0.24, 5.8, 0x7f9394, 0, 5.1, 0))
        g.add(box(4.4, 0.9, 0.15, 0x557d8a, 0, 3.8, 2.73))
        for (let i = 0; i < 4; i++) addWindow(g, -2.4 + i * 1.6, 2.0, 2.72, 0.9, 1.0, 0x7095a1)
        door(g, 0, 2.76, 0x4f6670)
      } else if (id === 'station') {
        g.add(box(8.4, 0.3, 5.2, 0xc7b89d, 0, 0.15, 0))
        g.add(box(8.8, 0.25, 5.6, 0x4f7d93, 0, 3.1, -1.0))
        for (const x of [-3.6, 3.6]) g.add(box(0.16, 3.0, 0.16, 0x50606a, x, 1.55, -1.0))
        for (const z of [-2.8, 2.8]) g.add(box(8.2, 0.16, 0.18, 0x9d8c72, 0, 0.32, z))
        for (const z of [-2.9, 2.9]) g.add(box(10.5, 0.16, 0.34, 0x4e5556, 0, 0.36, z))
        bench(g, -2.5, 1.5)
        bench(g, 2.5, 1.5)
      } else if (id === 'riverside') {
        for (let i = 0; i < 6; i++) g.add(tree(-3 + i * 1.2, -2 + (i % 3) * 2.2, 0.8 + (i % 2) * 0.25))
        bench(g, -2, 0.2, 0.4)
        bench(g, 2.2, -0.2, -0.4)
      } else if (id === 'bookstore') {
        g.add(box(4.4, 2.8, 3.8, 0xd9d0bc, 0, 1.4, 0))
        g.add(roof(4.4, 1.4, 3.8, 0x7b8c9b, 0, 3.2, 0))
        g.add(box(2.8, 0.28, 0.15, 0x8d6a45, 0, 2.4, 2.12))
        door(g, 0, 2.02)
        addWindow(g, 1.2, 1.6, 1.96, 0.6, 0.7)
      } else {
        g.add(box(4.2, 2.4, 3.8, 0xe2d2b8, 0, 1.2, 0))
        g.add(roof(4.2, 1.9, 3.8, 0x9a5d4d, 0, 2.95, 0))
      }
      const signColors = {
        bank: 0xd4b26a, cafe: 0xc97a5d, market: 0x9cb07b, mall: 0x6e8e9c, bookstore: 0x8b7ac4,
        hospital: 0xe4e0d7, school: 0x5d7fa8, library: 0x7d8da0, station: 0x4f7d93, canteen: 0xd27e5e, home: 0x9a5d4d,
      }
      if (signColors[id]) g.add(box(1.9, 0.36, 0.12, signColors[id], 0, 3.35, 2.17))
      townGroup.add(g)
    }
    townGroup.visible = true
  }

  // ── 官方 3D 地形：海岛 + 沙滩边 + 河 + 用户画的道路 + 桥 + 装饰（移植 model.html）──
  function worldP(u, v) {
    return new THREE.Vector3((u - 0.5) * state.worldW, 0, (v - 0.5) * state.worldH)
  }

  function ribbon(points, width, color, y, rough, opacity) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, y, p.z)))
    const segs = Math.max(10, Math.floor(curve.getLength() / 3))
    const pos = []
    const idx = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const p = curve.getPoint(t)
      const tan = curve.getTangent(t)
      const nx = -tan.z
      const nz = tan.x
      const len = Math.hypot(nx, nz) || 1
      pos.push(p.x + (nx * width) / 2, y, p.z + (nz * width) / 2)
      pos.push(p.x - (nx * width) / 2, y, p.z - (nz * width) / 2)
      if (i < segs) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const op = opacity === undefined ? 1 : opacity
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough === undefined ? 0.9 : rough,
      side: THREE.DoubleSide,
      transparent: op < 1,
      opacity: op,
    })
    const mesh = new THREE.Mesh(geo, m)
    mesh.receiveShadow = true
    return mesh
  }

  function buildOfficialTerrain(map) {
    const places = map.places || []
    const key = JSON.stringify(places.map((p) => [p.id, p.x, p.y])) + JSON.stringify(map.vehicles || {}) + JSON.stringify(map.roads || [])
    if (key === state.terrainKey) return
    state.terrainKey = key
    disposeChildren(terrainGroup, sharedMats)

    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(state.worldW * 2, state.worldH * 2.4),
      new THREE.MeshStandardMaterial({ color: 0x4f9fb8, roughness: 0.32, metalness: 0.04 })
    )
    sea.rotation.x = -Math.PI / 2
    sea.position.y = -1.0
    sea.receiveShadow = true
    terrainGroup.add(sea)

    const boundary = [
      [0.015, 0.16], [0.08, 0.045], [0.24, 0.02], [0.42, 0.035], [0.58, 0.05], [0.72, 0.1],
      [0.84, 0.2], [0.91, 0.36], [0.87, 0.55], [0.78, 0.72], [0.66, 0.86], [0.5, 0.93],
      [0.32, 0.9], [0.16, 0.8], [0.05, 0.64], [0.01, 0.42],
    ]
    const landShape = new THREE.Shape()
    boundary.forEach((uv, i) => {
      const w = worldP(uv[0], uv[1])
      if (i === 0) landShape.moveTo(w.x, w.z)
      else landShape.lineTo(w.x, w.z)
    })
    landShape.closePath()
    const sandShape = new THREE.Shape()
    boundary.forEach((uv, i) => {
      const w = worldP(0.5 + (uv[0] - 0.5) * 1.035, 0.5 + (uv[1] - 0.5) * 1.035)
      if (i === 0) sandShape.moveTo(w.x, w.z)
      else sandShape.lineTo(w.x, w.z)
    })
    sandShape.closePath()
    const sand = new THREE.Mesh(new THREE.ExtrudeGeometry(sandShape, { depth: 0.85, bevelEnabled: false }), mat(0xe5d2a5, 0.95))
    sand.rotation.x = Math.PI / 2
    sand.position.y = -0.06
    sand.receiveShadow = true
    terrainGroup.add(sand)
    const land = new THREE.Mesh(new THREE.ExtrudeGeometry(landShape, { depth: 0.8, bevelEnabled: false }), mat(0x9cbd7e, 0.98))
    land.rotation.x = Math.PI / 2
    land.position.y = 0.02
    land.receiveShadow = true
    terrainGroup.add(land)

    const riverU = [
      [0.02, 0.2], [0.1, 0.27], [0.18, 0.32], [0.25, 0.4], [0.26, 0.5],
      [0.31, 0.59], [0.39, 0.66], [0.47, 0.71], [0.56, 0.75], [0.68, 0.79],
    ]
    const riverPts = riverU.map((uv) => worldP(uv[0], uv[1]))
    terrainGroup.add(ribbon(riverPts, 3.8, 0xd5c39b, 0.12))
    terrainGroup.add(ribbon(riverPts, 2.5, 0x69b6cb, 0.15, 0.28))
    const riverSamples = []
    {
      const rc = new THREE.CatmullRomCurve3(riverPts)
      for (let i = 0; i <= 48; i++) riverSamples.push(rc.getPoint(i / 48))
    }

    // 道路：用户在 2D 地图上画好的折线（map.roads），3D 里铺成带边的土路
    const userRoads = Array.isArray(map.roads) ? map.roads : []
    const userRoadPaths = []
    function drawUserRoad(points) {
      if (!points || points.length < 2) return
      terrainGroup.add(ribbon(points, 2.35, 0xb99c71, 0.185, 0.9))
      terrainGroup.add(ribbon(points, 1.55, 0xe0cfa9, 0.2, 0.95))
      terrainGroup.add(ribbon(points, 0.1, 0xf1e5ce, 0.205, 0.8))
    }
    for (const line of userRoads) {
      if (!Array.isArray(line) || line.length < 2) continue
      const pts = line
        .map((pt) => worldP(Number(pt[0]), Number(pt[1])))
        .filter((p) => !isNaN(p.x) && !isNaN(p.z))
      if (pts.length < 2) continue
      drawUserRoad(pts)
      userRoadPaths.push(pts)
    }
    // 跨河的路自动补桥
    function segInter(a, b, c, d) {
      const r = { x: b.x - a.x, z: b.z - a.z }
      const s = { x: d.x - c.x, z: d.z - c.z }
      const den = r.x * s.z - r.z * s.x
      if (Math.abs(den) < 1e-6) return null
      const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den
      const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den
      if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null
      return { x: a.x + r.x * t, z: a.z + r.z * t }
    }
    const bridgePts = []
    for (const path of userRoadPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        for (let j = 0; j < riverSamples.length - 1; j++) {
          const hit = segInter(path[i], path[i + 1], riverSamples[j], riverSamples[j + 1])
          if (!hit || bridgePts.some((q) => Math.hypot(q.x - hit.x, q.z - hit.z) < 9)) continue
          bridgePts.push(hit)
          const dx = path[i + 1].x - path[i].x
          const dz = path[i + 1].z - path[i].z
          const br = new THREE.Group()
          br.position.set(hit.x, 0.34, hit.z)
          br.rotation.y = -Math.atan2(dz, dx)
          br.add(box(5.2, 0.18, 3.2, 0x9a744a, 0, 0, 0))
          for (const z of [-1.45, 1.45]) br.add(box(5.5, 0.1, 0.14, 0x7c5a3d, 0, 0.65, z))
          for (const x of [-2.3, 2.3]) br.add(box(0.14, 0.8, 3.2, 0x6f5238, x, 0.2, 0))
          terrainGroup.add(br)
        }
      }
    }

    // 不妨碍道路/建筑的空地装饰：树、灌木、花、石头（确定性散布，不用随机数，重建也不闪）
    function landAt(x, z) {
      const u = 0.5 + x / state.worldW
      const v = 0.5 + z / state.worldH
      let inside = false
      for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
        const xi = boundary[i][0]
        const yi = boundary[i][1]
        const xj = boundary[j][0]
        const yj = boundary[j][1]
        if (((yi > v) !== (yj > v)) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }
    const decorFoot = {
      home: [5.2, 4.8], school: [10, 7.6], library: [7, 6.2], cafe: [6.2, 5.2], canteen: [9, 4.2],
      market: [9, 5.2], hospital: [7.6, 6.4], bank: [6.8, 6.2], mall: [9, 7.4], station: [11, 7.2], bookstore: [6.2, 5.4],
    }
    function nearPlace(x, z, pad) {
      for (const p of places) {
        const foot = decorFoot[p.id]
        if (!foot) continue
        const w = worldP(p.x, p.y)
        if (Math.abs(x - w.x) < foot[0] / 2 + pad && Math.abs(z - w.z) < foot[1] / 2 + pad) return true
      }
      return false
    }
    function nearPolyline(x, z, path, pad) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]
        const b = path[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
        if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < pad) return true
      }
      return false
    }
    function nearAnyRoad(x, z, pad) {
      for (const path of userRoadPaths) {
        if (path.length > 1 && nearPolyline(x, z, path, pad)) return true
      }
      return false
    }
    const decorSpots = []
    for (let gx = -state.worldW / 2.5; gx <= state.worldW / 2.5; gx += 7) {
      for (let gz = -state.worldH / 2.5; gz <= state.worldH / 2.5; gz += 6) {
        const jx = ((gx * 13 + gz * 7) % 5) - 2
        const jz = ((gx * 5 + gz * 11) % 5) - 2
        const x = gx + jx
        const z = gz + jz
        if (!landAt(x, z)) continue
        if (nearPlace(x, z, 4.5) || nearAnyRoad(x, z, 3.8)) continue
        if (nearPolyline(x, z, riverPts, 3.2)) continue
        decorSpots.push({ x, z })
      }
    }
    let di = 0
    for (const s of decorSpots) {
      if (di % 3 === 0) terrainGroup.add(tree(s.x, s.z, 0.62 + (di % 4) * 0.08))
      else if (di % 3 === 1) {
        const bush = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 6), mat(0x5f8f5a, 0.95))
        bush.position.set(s.x, 0.38, s.z)
        terrainGroup.add(bush)
      } else {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), mat([0xe6a3b6, 0xf1d17a, 0xd98776][di % 3], 0.85))
        fl.position.set(s.x, 0.26, s.z)
        terrainGroup.add(fl)
      }
      di++
      if (di > 60) break
    }
    for (let i = 0; i < 5; i++) {
      const s = decorSpots[(i + 9) % Math.max(1, decorSpots.length)]
      if (!s) break
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x8d8b80, 0.95))
      rock.position.set(s.x, 0.3, s.z)
      rock.scale.setScalar(0.7 + i * 0.05)
      terrainGroup.add(rock)
    }
    terrainGroup.visible = true
  }

  // ── 地点名牌（都挂在 markerGroup；点击/悬浮走 raycast）──
  function buildPlaces(places) {
    const key = JSON.stringify((places || []).map((p) => [p.id, p.x, p.y, p.name, p.icon]))
    if (key === state.placesKey) return
    state.placesKey = key
    disposeChildren(markerGroup)
    placesById.clear()
    markerById.clear()
    for (const p of places || []) {
      const v = toWorld(p.x, p.y)
      const sp = labelSprite(p.name, p.icon ? String(p.icon) : '')
      sp.position.set(v.x, 8.8, v.z)
      sp.userData.sbc3dPlaceId = String(p.id)
      markerGroup.add(sp)
      placesById.set(String(p.id), p)
      markerById.set(String(p.id), sp)
    }
    markerGroup.visible = true
  }

  // ── 地图模型（map.model.url 是用户导入的 GLB；失败就退回程序化地形）──
  function buildEnv(map) {
    const model = map.model || null
    const key = model && model.url ? 'glb|' + model.url + '|' + (model.scale || 1) + '|' + (model.rotationY || 0) + '|' + (model.yOffset || 0) : 'proc'
    if (key === state.envKey) return
    state.envKey = key
    const token = ++state.envToken
    disposeChildren(envGroup, sharedMats)
    if (!model || !model.url) {
      envGroup.visible = false
      state.envRadius = 0
      return
    }
    sbc3dLoadGltfLoader().then((GLTFLoader) => {
      if (token !== state.envToken) return
      return new GLTFLoader().loadAsync(String(model.url)).then((gltf) => {
        if (token !== state.envToken) { disposeObject(gltf.scene); return }
        const obj = gltf.scene
        obj.scale.setScalar(Number(model.scale) || 1)
        obj.rotation.y = ((Number(model.rotationY) || 0) * Math.PI) / 180
        obj.position.y = Number(model.yOffset) || 0
        obj.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        envGroup.add(obj)
        envGroup.visible = true
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())
        state.envRadius = Math.max(size.x, size.z) / 2
        updateSceneFit()
      })
    }).catch((e) => {
      if (token !== state.envToken) return
      state.envRadius = 0
      updateSceneFit()
      // 模型没加载出来：把程序化地面/网格放回来，至少不是一片空
      if (ground) ground.visible = true
      if (grid) grid.visible = true
      if (basePlane) basePlane.visible = true
      for (const r of roadMeshes) r.visible = true
      notice('地图模型加载失败，已用程序化地形：' + ((e && e.message) || e))
    })
  }

  // ── 相机/阴影自适应（用户导入大模型时把可视范围放大）──
  function updateSceneFit() {
    const r = Math.max(state.envRadius, state.charRadius)
    if (!(r > 0.001)) {
      if (state.fitApplied !== 0) {
        state.fitApplied = 0
        state.maxDist = 320
        if (!state.zoomTouched) state.dist = 100
        camera.far = 500
        camera.updateProjectionMatrix()
        const sr0 = 90
        dir.shadow.camera.left = -sr0
        dir.shadow.camera.right = sr0
        dir.shadow.camera.top = sr0
        dir.shadow.camera.bottom = -sr0
        dir.shadow.camera.far = 220
        dir.shadow.camera.updateProjectionMatrix()
        dir.position.set(40, 70, 25)
        scene.fog.near = 140
        scene.fog.far = 320
      }
      return
    }
    if (Math.abs(r - state.fitApplied) < 0.01) return
    state.fitApplied = r
    state.maxDist = Math.max(320, Math.min(3000, r * 2.2))
    if (!state.zoomTouched) state.dist = Math.min(state.maxDist, Math.max(100, r * 1.6))
    camera.far = Math.max(500, state.dist * 3)
    camera.updateProjectionMatrix()
    const sr = Math.min(240, Math.max(90, r * 1.2))
    dir.shadow.camera.left = -sr
    dir.shadow.camera.right = sr
    dir.shadow.camera.top = sr
    dir.shadow.camera.bottom = -sr
    dir.shadow.camera.far = Math.max(220, sr * 3)
    dir.shadow.camera.updateProjectionMatrix()
    dir.position.set(sr * 0.44, sr * 0.78, sr * 0.28)
    scene.fog.near = Math.max(140, r * 1.4)
    scene.fog.far = Math.max(320, r * 3.2)
  }

  // ── 载具：默认低模汽车/自行车；map.vehicles 配了 GLB 就换成用户的模型 ──
  function vehicleCar() {
    const g = new THREE.Group()
    g.add(box(3.4, 0.7, 1.7, 0xc96f5b, 0, 0.65, 0))
    g.add(box(1.75, 0.55, 1.4, 0xe6d7bd, -0.15, 1.2, 0))
    g.add(box(3.0, 0.16, 1.55, 0x7c3e35, 0, 0.98, 0))
    for (const x of [-1.05, 1.05]) {
      for (const z of [-0.72, 0.72]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), mat(0x30383b, 0.75))
        wh.rotation.z = Math.PI / 2
        wh.position.set(x, 0.34, z)
        g.add(wh)
      }
    }
    for (const z of [-0.6, 0.6]) g.add(box(0.14, 0.16, 0.28, 0xffe2a8, 1.6, 0.75, z))
    return g
  }

  function vehicleBike() {
    const g = new THREE.Group()
    const dark = mat(0x3b4148, 0.65)
    const metal = mat(0x9da7aa, 0.4, 0.4)
    const seat = mat(0x6a4b38, 0.9)
    for (const z of [-0.72, 0.72]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 6, 16), metal)
      wheel.rotation.y = Math.PI / 2
      wheel.position.set(0, 0.5, z)
      g.add(wheel)
    }
    function tube(a, b, r, material) {
      const av = new THREE.Vector3(a[0], a[1], a[2])
      const bv = new THREE.Vector3(b[0], b[1], b[2])
      const d = bv.clone().sub(av)
      const len = d.length()
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), material || dark)
      m.position.copy(av.clone().add(bv).multiplyScalar(0.5))
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
      g.add(m)
    }
    tube([0, 0.5, -0.72], [0, 0.62, 0.25], 0.045)
    tube([0, 0.62, 0.25], [0, 0.5, 0.72], 0.045)
    tube([0, 0.5, 0.72], [0, 0.5, 0.15], 0.045)
    tube([0, 0.62, 0.25], [0, 0.95, 0.12], 0.04)
    tube([-0.25, 0.95, 0.12], [0.25, 0.95, 0.12], 0.035)
    g.add(box(0.28, 0.06, 0.38, seat, 0, 0.98, -0.08))
    return g
  }

  function ensureVehicles(map) {
    const key = JSON.stringify(map.vehicles || {})
    if (key === state.vehiclesKey) return
    state.vehiclesKey = key
    const token = ++state.vehiclesToken
    disposeChildren(vehicleGroup, sharedMats)
    const cfg = map.vehicles || {}
    function makeGroup(kind) {
      const g = new THREE.Group()
      g.visible = false
      const c = cfg[kind]
      const tag = labelSprite(kind === 'car' ? '汽车' : '自行车', '')
      tag.scale.set(3.4, 1.7, 1)
      tag.position.set(0, kind === 'car' ? 3.3 : 2.6, 0)
      if (c && c.url) {
        sbc3dLoadGltfLoader().then((GLTFLoader) => {
          if (token !== state.vehiclesToken) return
          return new GLTFLoader().loadAsync(String(c.url)).then((gltf) => {
            if (token !== state.vehiclesToken) { disposeObject(gltf.scene); return }
            const obj = gltf.scene
            obj.scale.setScalar(Number(c.scale) || 1)
            obj.rotation.y = Number(c.rotationY) || 0
            obj.position.y = 0.12
            g.add(obj)
          })
        }).catch((e) => {
          notice('载具模型加载失败，已用默认模型：' + ((e && e.message) || e))
          g.add(kind === 'car' ? vehicleCar() : vehicleBike())
        })
      } else {
        g.add(kind === 'car' ? vehicleCar() : vehicleBike())
      }
      g.add(tag)
      vehicleGroup.add(g)
      return g
    }
    carGroup = makeGroup('car')
    bikeGroup = makeGroup('bicycle')
    vehicleGroup.visible = false
  }

  // ── 角色：GLB → sprite/live2d 立绘 → 程序化小鲸（model.html 同款）──
  function clearChar() {
    disposeChildren(charGroup, sharedMats)
    state.charRadius = 0
    if (state.mixer) {
      try { state.mixer.stopAllAction() } catch (e) {}
      state.mixer = null
    }
    charModel = null
    fallbackBody = null
    spritePlane = null
    state.charActions = []
    state.activeCharAction = null
    updateSceneFit()
  }

  function buildChibi(character) {
    const g = new THREE.Group()
    const cp = (character && character.chibi) || {}
    const dressCol = Number(cp.dress) || 0x7fa9df
    const hairCol = Number(cp.hair) || 0x5d7fc4
    const skinCol = Number(cp.skin) || 0xffe4cf
    const accentCol = Number(cp.accent) || 0x4f72b8
    const blue = mat(dressCol, 0.8)
    const hair = mat(hairCol, 0.85)
    const skin = mat(skinCol, 0.9)
    const dress = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.8, 12), blue)
    dress.position.y = 1.0
    dress.castShadow = true
    g.add(dress)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 12), skin)
    head.position.y = 2.35
    head.castShadow = true
    g.add(head)
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.86, 16, 12), hair)
    hairCap.position.y = 2.58
    hairCap.scale.y = 0.82
    g.add(hairCap)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), mat(accentCol, 0.8))
      ear.position.set(s * 0.9, 2.25, -0.05)
      ear.rotation.z = s * 0.55
      g.add(ear)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0x273a5a, 0.4))
      eye.position.set(s * 0.28, 2.38, 0.72)
      g.add(eye)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.85, 8), skin)
      arm.position.set(s * 0.72, 1.55, 0.1)
      arm.rotation.z = s * 0.35
      g.add(arm)
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.1, 8), mat(hairCol, 0.75))
    tail.position.set(0, 0.95, -1.0)
    tail.rotation.x = 1.0
    g.add(tail)
    const tag = labelSprite((character && character.name) || '她', '')
    tag.scale.set(5.5, 2.75, 1)
    tag.position.set(0, 4.6, 0)
    g.add(tag)
    g.scale.setScalar(1.25)
    return g
  }

  function buildChar(character) {
    const model = (character && character.model) || { type: 'none', url: '', scale: 1 }
    const key = [
      model.type, model.url || '', model.scale || 1, model.rotationY || 0,
      (character && character.id) || '', JSON.stringify((character && character.chibi) || {}),
      (character && character.name) || '',
    ].join('|')
    if (key === state.charKey) return
    state.charKey = key
    const token = ++state.charToken
    clearChar()
    const scale = Number(model.scale) || 1
    const type = String(model.type || 'none')

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    )
    blob.rotation.x = -Math.PI / 2
    blob.position.y = 0.02
    charGroup.add(blob)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 4.2, 32),
      new THREE.MeshBasicMaterial({ color: sbc3dAccent(), transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    charGroup.add(ring)

    const makeFallback = () => {
      fallbackBody = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 4, 6, 12), new THREE.MeshStandardMaterial({ color: 0x5f8fe8, roughness: 0.5 }))
      body.position.y = 3.4
      fallbackBody.add(body)
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), new THREE.MeshStandardMaterial({ color: 0xffe9dc, roughness: 0.6 }))
      head.position.y = 7.2
      fallbackBody.add(head)
      charGroup.add(fallbackBody)
    }
    const addSprite = (url, height) => {
      const t = new THREE.TextureLoader()
      Api.imgUrl(String(url)).then((src) => {
        if (!src || token !== state.charToken) return
        t.load(src, (tex) => {
          if (token !== state.charToken) { try { tex.dispose() } catch (e) {} return }
          try {
            tex.colorSpace = THREE.SRGBColorSpace
            const m = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false })
            const sp = new THREE.Sprite(m)
            const aspect = tex.image && tex.image.width && tex.image.height ? tex.image.width / tex.image.height : 1
            sp.scale.set(height * aspect, height, 1)
            sp.position.y = height * 0.55
            charGroup.add(sp)
            spritePlane = sp
          } catch (e) { makeFallback() }
        }, undefined, () => { if (token === state.charToken && !spritePlane) makeFallback() })
      }).catch(() => { if (token === state.charToken && !spritePlane) makeFallback() })
    }

    if (type === '3d' && model.url) {
      sbc3dLoadGltfLoader().then((GLTFLoader) => {
        if (token !== state.charToken) return
        return new GLTFLoader().loadAsync(String(model.url)).then((gltf) => {
          if (token !== state.charToken) { disposeObject(gltf.scene); return }
          gltf.scene.traverse((node) => { if (node.isMesh) node.castShadow = true })
          charModel = gltf.scene
          charModel.scale.setScalar(scale)
          charModel.rotation.y = Number(model.rotationY) || 0
          const box3 = new THREE.Box3().setFromObject(charModel)
          charModel.position.y = -box3.min.y
          charGroup.add(charModel)
          const size = box3.getSize(new THREE.Vector3())
          state.charRadius = Math.max(size.x, size.y, size.z) * 1.2
          updateSceneFit()
          const clips = gltf.animations || []
          if (clips.length) {
            state.mixer = new THREE.AnimationMixer(charModel)
            state.charActions = clips.map((clip) => state.mixer.clipAction(clip))
            playCharClip(state.desiredCharClip || 'Idle')
          }
        })
      }).catch((e) => {
        if (token !== state.charToken) return
        makeFallback()
        notice('角色模型加载失败，已用兜底形象：' + ((e && e.message) || e))
      })
      return
    }
    if ((type === 'sprite' || type === 'live2d') && model.url) {
      addSprite(model.url, 9 * scale)
      return
    }
    // 无 3D 模型：用原 3D 舞台的程序化小鲸（比头像白板好看）；造不出来时用胶囊兜底
    try {
      charGroup.add(buildChibi(character))
      updateSceneFit()
    } catch (e) {
      makeFallback()
    }
  }

  function playCharClip(name, manual) {
    if (manual) state.desiredCharClip = String(name || 'Idle')
    const want = String(name || state.desiredCharClip || 'Idle').toLowerCase()
    if (!state.charActions || !state.charActions.length) return
    let action = state.charActions.find((a) => String((a.getClip && a.getClip().name) || '').toLowerCase() === want)
    if (!action) action = state.charActions.find((a) => String((a.getClip && a.getClip().name) || '').toLowerCase() === 'idle') || state.charActions[0]
    if (!action || action === state.activeCharAction) return
    if (state.activeCharAction) state.activeCharAction.fadeOut(0.18)
    action.reset().fadeIn(0.18).play()
    state.activeCharAction = action
  }

  // ── 行程路径线 ──
  function drawPath(path) {
    const key = path && path.length > 1 ? path.length + '|' + JSON.stringify(path[0]) + '|' + JSON.stringify(path[path.length - 1]) : ''
    if (key === state.pathKey) return
    state.pathKey = key
    if (routeLine) {
      scene.remove(routeLine)
      disposeObject(routeLine)
      routeLine = null
    }
    if (!path || path.length < 2) return
    const pts = path.map((p) => {
      const v = toWorld(p.x, p.y)
      v.y = 0.3
      return v
    })
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const m = new THREE.LineDashedMaterial({ color: 0x7db7ff, dashSize: 2.4, gapSize: 1.2 })
    routeLine = new THREE.Line(geo, m)
    routeLine.computeLineDistances()
    scene.add(routeLine)
  }

  // ── 角色世界坐标（行程中按时间插值，和 2D 舞台的 stageTravelProgress 同一套算法）──
  const charPosTmp = new THREE.Vector3()
  function characterWorldPos(out) {
    const v = out || new THREE.Vector3()
    const data = state.data
    if (!data || !data.location) return v.set(0, 0, 0)
    const loc = data.location
    const places = (data.map && data.map.places) || []
    if (loc.state === 'stationary') {
      const at = places.find((x) => String(x.id) === String(loc.placeId)) || { x: 0.5, y: 0.5 }
      return toWorld(at.x, at.y, v)
    }
    if (loc.state === 'intercity') return toWorld(0.5, 0.2, v)
    const t = loc.traveling
    if (loc.state === 'traveling' && t && t.path && t.path.length > 1) {
      const path = t.path
      const prog = clampNum((Date.now() - Number(t.startedAt || 0)) / Math.max(1, Number(t.durationMs) || 1), 0, 1)
      let total = 0
      const segs = []
      for (let i = 0; i < path.length - 1; i++) {
        const d = Math.hypot(Number(path[i].x) - Number(path[i + 1].x), Number(path[i].y) - Number(path[i + 1].y))
        segs.push(d)
        total += d
      }
      let target = total * prog
      for (let i = 0; i < segs.length; i++) {
        if (target <= segs[i] || i === segs.length - 1) {
          const r = segs[i] ? clampNum(target / segs[i], 0, 1) : 1
          const nx = Number(path[i].x) + (Number(path[i + 1].x) - Number(path[i].x)) * r
          const ny = Number(path[i].y) + (Number(path[i + 1].y) - Number(path[i].y)) * r
          return toWorld(nx, ny, v)
        }
        target -= segs[i]
      }
    }
    return toWorld(0.5, 0.2, v)
  }

  // ── 昼夜 / 天气色调（复用 model.html 的思路）──
  function applyDaylight(data) {
    const h = new Date().getHours() + new Date().getMinutes() / 60
    const phase = h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 17 ? 'day' : h >= 17 && h < 19.5 ? 'dusk' : 'night'
    const wxKind = String((data.weather && data.weather.kind) || 'sunny')
    const skies = { rain: 0x1a2531, snow: 0x2a3640, sunny: 0x0d1a24, hot: 0x2a1a12, cold: 0x16222e, windy: 0x19232c, cloudy: 0x141d26 }
    const todSkies = { dawn: 0x3a2a3a, day: 0x0d1a24, dusk: 0x2a1a24, night: 0x05070f }
    let sky = skies[wxKind] === undefined ? 0x0d1a24 : skies[wxKind]
    if (phase === 'night') sky = 0x05070f
    else if (phase === 'dawn' || phase === 'dusk') {
      try {
        sky = new THREE.Color(sky).lerp(new THREE.Color(todSkies[phase]), 0.45).getHex()
      } catch (e) { sky = todSkies[phase] }
    }
    scene.background = new THREE.Color(sky)
    if (scene.fog) scene.fog.color.set(sky)
    const dayFactor = phase === 'day' ? 1 : phase === 'dawn' || phase === 'dusk' ? 0.7 : 0.35
    hemi.intensity = phase === 'day' ? 1.0 : phase === 'night' ? 0.35 : 0.68
    ambient.intensity = phase === 'day' ? 0.65 : phase === 'night' ? 0.22 : 0.45
    const wet = wxKind === 'rain' || wxKind === 'snow'
    dir.intensity = (wet ? 1.5 : wxKind === 'sunny' ? 2.4 : 2.0) * dayFactor
  }

  // ── 按地图重建底座（地面 + 各分支的可见性），世界尺寸/底图变了才跑 ──
  //   地形/建筑/名牌/地图模型不在这里建：它们每次轮询都按自己的 key 去重（见 apply），
  //   这样在地图编辑器里拖动地点、加地点、画道路时 3D 也会跟着变。
  function rebuildBase(map, env, aspect) {
    state.worldW = sbc3dWorldWidth(map.widthMeters)
    state.worldH = state.worldW / (aspect > 0.05 ? aspect : SBC3D_ASPECT_FALLBACK)
    state.groundKey = ''
    state.townKey = ''
    state.placesKey = ''
    state.terrainKey = ''
    state.envKey = ''
    state.pathKey = ''
    state.vehiclesKey = ''
    state.charKey = ''
    state.official = !!map.official3d
    state.showTown = false
    if (grid) { scene.remove(grid); disposeObject(grid); grid = null }

    if (env) {
      // 用户导入的 3D 地图模型：程序化地面/道路全部让位
      buildGround(map.theme, '')
      if (ground) ground.visible = false
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = false
      terrainGroup.visible = false
      townGroup.visible = false
    } else if (map.official3d) {
      buildGround(map.theme, '')
      if (ground) ground.visible = false
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = false
      terrainGroup.visible = true
      state.showTown = true
    } else if (map.imageUrl) {
      // 普通 2D 底图：铺成地面贴图（建筑会跟画好的底图重复，所以不建程序化小镇）
      buildGround(map.theme, map.imageUrl)
      if (ground) ground.visible = true
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = true
      terrainGroup.visible = false
      townGroup.visible = false
    } else {
      buildGround(map.theme, '')
      if (ground) ground.visible = true
      if (grid) grid.visible = true
      for (const r of roadMeshes) r.visible = true
      basePlane.visible = true
      terrainGroup.visible = false
      townGroup.visible = true
      state.showTown = true
    }
  }

  // ── 主更新：/api/stage 每次轮询都会调；只有变化的部分重建 ──
  function apply(data) {
    if (!state.running) return
    if (!data || !data.map) return
    state.data = data
    const map = data.map || {}
    const loc = data.location || {}
    const imageUrl = map.image && map.image.url ? String(map.image.url) : ''
    const official3d = imageUrl.indexOf('official-map') >= 0
    const envModel = map.model && map.model.url ? map.model : null
    const aspect = official3d ? 1.5 : sbc3dImageAspect(imageUrl)
    if (!official3d && imageUrl && !sbc3dAspectCache.has(imageUrl)) {
      // 第一次见到这张底图：先量宽高比，量出来后再重建一次（只多一次）
      sbc3dMeasureImage(imageUrl, () => { if (state.data) apply(state.data) })
    }
    const worldKey = [
      map.id, map.name, map.theme, map.widthMeters, imageUrl,
      official3d ? 'official' : 'plain', envModel ? 'env' : 'noenv', aspect,
    ].join('|')
    const normMap = {
      places: Array.isArray(map.places) ? map.places : [],
      roads: Array.isArray(map.roads) ? map.roads : [],
      vehicles: map.vehicles || {},
      theme: map.theme,
      widthMeters: map.widthMeters,
      official3d,
      imageUrl,
      model: envModel,
    }
    if (worldKey !== state.worldKey) {
      state.worldKey = worldKey
      rebuildBase(normMap, !!envModel, aspect)
    }
    // 这些函数内部都有 key 去重：数据没变就是空操作；地点/道路被编辑过就会重建
    if (state.official) buildOfficialTerrain(normMap)
    if (state.showTown) buildTown(normMap.places)
    buildPlaces(normMap.places)
    buildEnv(normMap)
    applyDaylight(data)
    ensureVehicles(map)
    buildChar(data.character || {})

    // 载具：只有出行方式是 car/bike 时显示
    const mode = String((loc.traveling && loc.traveling.mode) || '')
    state.carMode = loc.state === 'traveling' && /car|taxi|drive|auto/.test(mode)
    state.bikeMode = loc.state === 'traveling' && /bike|bicycle|cycle/.test(mode)
    if (carGroup) carGroup.visible = state.carMode
    if (bikeGroup) bikeGroup.visible = state.bikeMode
    vehicleGroup.visible = state.carMode || state.bikeMode
    charGroup.visible = !(state.carMode || state.bikeMode)

    drawPath(loc.state === 'traveling' && loc.traveling ? loc.traveling.path : null)
    state.desiredCharClip = loc.state === 'traveling' ? 'Walk' : 'Idle'
    playCharClip(state.desiredCharClip)
    if (!state.camReady) resetCameraToChar()
  }

  // ── 相机：跟随 + 拖动旋转 + 滚轮/双指缩放 ──
  const camTarget = new THREE.Vector3()
  const camPosTmp = new THREE.Vector3()
  const focusTmp = new THREE.Vector3()
  const prevTmp = new THREE.Vector3()

  function clampDist(d) {
    return Math.min(state.maxDist, Math.max(30, d))
  }

  function cameraPositionFor(target, out) {
    const cp = Math.cos(state.pitch)
    return out.set(
      target.x + Math.sin(state.yaw) * cp * state.dist,
      target.y + 6 + Math.sin(state.pitch) * state.dist,
      target.z + Math.cos(state.yaw) * cp * state.dist
    )
  }

  function resetCameraToChar() {
    const p = characterWorldPos(charPosTmp)
    p.x += 1.6
    p.z += 2.6
    camTarget.copy(p)
    charGroup.position.copy(p)
    cameraPositionFor(camTarget, camera.position)
    camera.lookAt(camTarget.x, camTarget.y + 5, camTarget.z)
    state.camReady = true
  }

  function pointerNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, rect.width)
    const h = Math.max(1, rect.height)
    return {
      x: ((clientX - rect.left) / w) * 2 - 1,
      y: -(((clientY - rect.top) / h) * 2 - 1),
    }
  }

  const raycaster = new THREE.Raycaster()

  function placeIdOf(object) {
    let node = object
    while (node) {
      if (node.userData && node.userData.sbc3dPlaceId) return String(node.userData.sbc3dPlaceId)
      node = node.parent
    }
    return ''
  }

  // 点击/悬浮命中的地点：先 raycast（名牌 + 建筑），没中就按屏幕距离找最近名牌（更好点）
  function pickPlaceAt(clientX, clientY) {
    const ndc = pointerNdc(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    const roots = []
    if (markerGroup.visible) roots.push(markerGroup)
    if (townGroup.visible) roots.push(townGroup)
    if (envGroup.visible) roots.push(envGroup)
    let hits = []
    try { hits = raycaster.intersectObjects(roots, true) } catch (e) { hits = [] }
    for (const hit of hits) {
      const id = placeIdOf(hit.object)
      if (id && placesById.has(id)) return placesById.get(id)
    }
    // 兜底：名牌投影到屏幕，60px 内算点中（名牌是 sprite，raycast 已经能中，这里给更宽容的手感）
    const rect = canvas.getBoundingClientRect()
    let best = null
    let bestD = 60
    markerById.forEach((sp, id) => {
      if (!sp) return
      const v = sp.position.clone().project(camera)
      if (v.z > 1) return
      const sx = rect.left + ((v.x + 1) / 2) * rect.width
      const sy = rect.top + ((1 - v.y) / 2) * rect.height
      const d = Math.hypot(sx - clientX, sy - clientY)
      if (d < bestD) { bestD = d; best = id }
    })
    if (best && placesById.has(best)) return placesById.get(best)
    return null
  }

  function updateHover(clientX, clientY) {
    if (!state.pointerInside || state.dragging) return
    let hit = null
    try { hit = pickPlaceAt(clientX, clientY) } catch (e) { hit = null }
    canvas.style.cursor = hit ? 'pointer' : 'grab'
  }

  // 指针交互。双击缩放不处理（和 model.html 一致：拖动旋转、滚轮缩放）。
  const pointerState = { x: 0, y: 0 }

  function onPointerDown(e) {
    try { canvas.setPointerCapture(e.pointerId) } catch (err) {}
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (state.pointers.size === 1) {
      state.dragging = true
      state.pinching = false
      state.lastX = e.clientX
      state.lastY = e.clientY
      state.pressX = e.clientX
      state.pressY = e.clientY
      state.pressAt = Date.now()
      canvas.style.cursor = 'grabbing'
    } else {
      state.dragging = false
      state.pinching = true
      state.pinch = pinchDistance()
    }
  }

  function pinchDistance() {
    const it = state.pointers.values()
    const a = it.next().value
    const b = it.next().value
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerMove(e) {
    if (!state.pointers.has(e.pointerId)) {
      // 没按着：只更新 hover（限制在 canvas 区域里，避免鼠标在别处也做射线检测）
      let inside = false
      try {
        const rect = canvas.getBoundingClientRect()
        inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      } catch (err) { inside = false }
      state.pointerInside = inside
      pointerState.x = e.clientX
      pointerState.y = e.clientY
      if (inside) state.hoverDirty = true
      return
    }
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pointerState.x = e.clientX
    pointerState.y = e.clientY
    if (state.pointers.size >= 2) {
      const d = pinchDistance()
      if (state.pinch > 0 && d > 0) {
        state.dist = clampDist(state.dist * (state.pinch / d))
        state.zoomTouched = true
      }
      state.pinch = d
      return
    }
    if (!state.dragging) return
    state.yaw -= (e.clientX - state.lastX) * 0.005
    state.pitch = Math.min(1.35, Math.max(0.18, state.pitch - (e.clientY - state.lastY) * 0.004))
    state.lastX = e.clientX
    state.lastY = e.clientY
    canvas.style.cursor = 'grabbing'
  }

  function onPointerUp(e) {
    const wasDragging = state.dragging
    const moved = Math.hypot(e.clientX - state.pressX, e.clientY - state.pressY)
    const quick = Date.now() - state.pressAt < 700
    state.pointers.delete(e.pointerId)
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    } catch (err) {}
    if (state.pointers.size === 1) {
      const next = state.pointers.values().next().value
      state.dragging = true
      state.lastX = next.x
      state.lastY = next.y
      state.pinch = 0
      return
    }
    state.dragging = false
    state.pinching = false
    state.pinch = 0
    canvas.style.cursor = 'grab'
    // 轻点（不是拖拽）→ 点地点
    if (wasDragging && quick && moved < 6 && typeof o.onPick === 'function') {
      let place = null
      try { place = pickPlaceAt(e.clientX, e.clientY) } catch (err) { place = null }
      if (place) {
        try { o.onPick(place) } catch (err) {}
      }
    }
  }

  function onPointerLeave() {
    state.pointerInside = false
    canvas.style.cursor = 'grab'
  }

  function onWheel(e) {
    if (e.preventDefault) e.preventDefault()
    state.dist = clampDist(state.dist + (e.deltaY > 0 ? 8 : -8))
    state.zoomTouched = true
  }

  // 上下文丢失：6 秒还没恢复就认输，交给 stage.js 切回 2D（不留下一个黑画布）
  let contextLostTimer = 0
  function onContextLost(e) {
    if (e && e.preventDefault) e.preventDefault()
    notice('3D 上下文丢失，正在尝试恢复…')
    try { win.clearTimeout(contextLostTimer) } catch (err) {}
    contextLostTimer = win.setTimeout(() => {
      let lost = false
      try {
        const ctx = renderer.getContext && renderer.getContext()
        lost = !!(ctx && ctx.isContextLost && ctx.isContextLost())
      } catch (err) { lost = true }
      if (!lost) return
      if (typeof o.onFail === 'function') {
        try { o.onFail('WebGL 上下文丢失且恢复失败') } catch (err) {}
      }
    }, 6000)
  }

  function onContextRestored() {
    try { win.clearTimeout(contextLostTimer) } catch (e) {}
    contextLostTimer = 0
    notice('')
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  // 指针跑到 canvas 外面再松开也要收尾（否则会一直处于拖拽态）
  const winTarget = win || canvas
  winTarget.addEventListener('pointerup', onPointerUp)
  winTarget.addEventListener('pointercancel', onPointerUp)
  winTarget.addEventListener('pointermove', onPointerMove)

  // rAF 兜底（极端环境下 win 上没有这两个方法时也不至于抛）
  const requestFrame = win && typeof win.requestAnimationFrame === 'function'
    ? (fn) => win.requestAnimationFrame(fn)
    : (typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16))
  const cancelFrame = win && typeof win.cancelAnimationFrame === 'function'
    ? (id) => win.cancelAnimationFrame(id)
    : (typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id))

  // ── 尺寸自适应 ──
  let ro = null
  function resize() {
    const w = Math.max(1, Math.round(Number(host.clientWidth) || 0))
    const h = Math.max(1, Math.round(Number(host.clientHeight) || 0))
    try {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    } catch (e) {}
  }
  resize()
  try {
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(resize)
      ro.observe(host)
    } else if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(resize)
      ro.observe(host)
    }
  } catch (e) { ro = null }
  const resizeFallback = !ro
  if (resizeFallback) winTarget.addEventListener('resize', resize)
  // host 尺寸可能首帧是 0（还没 layout 完），下一帧再量一次
  try { requestFrame(() => resize()) } catch (e) {}

  // ── 动画循环 ──
  const clock = new THREE.Clock()
  state.clock = clock
  const charFollowTmp = new THREE.Vector3()

  function frame() {
    if (!state.running) return
    state.raf = requestFrame(frame)
    const hidden = typeof doc.hidden === 'boolean' && doc.hidden
    let delta = 0
    try { delta = Math.min(Number(clock.getDelta()) || 0, 0.1) } catch (e) { delta = 0.016 }
    if (hidden) return
    const data = state.data
    if (data) {
      // 相机跟着她；站到建筑前侧，避免小鲸被建筑盖住
      const p = characterWorldPos(charFollowTmp)
      p.x += 1.6
      p.z += 2.6
      focusTmp.copy(p)
      camTarget.lerp(focusTmp, 0.08)
      cameraPositionFor(camTarget, camPosTmp)
      camera.position.lerp(camPosTmp, 0.1)
      camera.lookAt(camTarget.x, camTarget.y + 5, camTarget.z)

      const charTarget = characterWorldPos(charPosTmp)
      charTarget.x += 1.6
      charTarget.z += 2.6
      prevTmp.copy(charGroup.position)
      charGroup.position.lerp(charTarget, 0.12)
      vehicleGroup.position.copy(charGroup.position)

      const traveling = !!(data.location && data.location.state === 'traveling')
      if (traveling) {
        const dx = charGroup.position.x - prevTmp.x
        const dz = charGroup.position.z - prevTmp.z
        if (Math.abs(dx) + Math.abs(dz) > 0.0005) {
          const targetYaw = Math.atan2(dx, dz)
          let cur = charGroup.rotation.y
          let d = targetYaw - cur
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          charGroup.rotation.y = cur + d * 0.15
        }
        charGroup.position.y = Math.abs(Math.sin(Date.now() / 160)) * 0.35
      } else {
        charGroup.position.y *= 0.9
      }
    }
    if (state.mixer) {
      try { state.mixer.update(delta) } catch (e) {}
    }
    try { renderer.render(scene, camera) } catch (e) {}
    const now = Date.now()
    if (state.hoverDirty && now - state.hoverAt > 110) {
      state.hoverDirty = false
      state.hoverAt = now
      updateHover(pointerState.x, pointerState.y)
    }
  }
  state.raf = requestFrame(frame)

  // ── 提示信息（不致命：模型加载失败之类）──
  let lastNotice = ''
  function notice(msg) {
    const text = String(msg || '')
    if (text === lastNotice) return
    lastNotice = text
    if (typeof o.onNotice === 'function') {
      try { o.onNotice(text) } catch (e) {}
    }
  }

  // ── 卸载：把所有监听/GPU 资源都清掉（M08 切换不泄漏）──
  function dispose() {
    if (!state.running) return
    state.running = false
    try { win.clearTimeout(contextLostTimer) } catch (e) {}
    try { if (state.raf) cancelFrame(state.raf) } catch (e) {}
    state.raf = 0
    if (ro) {
      try { ro.disconnect() } catch (e) {}
      ro = null
    }
    if (resizeFallback) {
      try { winTarget.removeEventListener('resize', resize) } catch (e) {}
    }
    try {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      winTarget.removeEventListener('pointerup', onPointerUp)
      winTarget.removeEventListener('pointercancel', onPointerUp)
      winTarget.removeEventListener('pointermove', onPointerMove)
    } catch (e) {}
    state.pointers.clear()
    if (state.mixer) {
      try { state.mixer.stopAllAction() } catch (e) {}
      state.mixer = null
    }
    // 遍历整个 scene，几何/材质/贴图一次性释放（用 Set 去重，共享材质只释放一次）
    const geos = new Set()
    const mats = new Set()
    const texs = new Set()
    try {
      scene.traverse((node) => {
        if (node.geometry) geos.add(node.geometry)
        const ms = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
        for (const m of ms) {
          if (!m) continue
          mats.add(m)
          for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) {
            if (m[k]) texs.add(m[k])
          }
        }
      })
    } catch (e) {}
    geos.forEach((g) => { try { g.dispose() } catch (e) {} })
    texs.forEach((t) => { try { t.dispose() } catch (e) {} })
    mats.forEach((m) => { try { m.dispose() } catch (e) {} })
    matCache.clear()
    sharedMats.clear()
    try { renderer.setAnimationLoop && renderer.setAnimationLoop(null) } catch (e) {}
    try { renderer.dispose() } catch (e) {}
    // 主动丢上下文：面板里反复切 2D/3D 时，靠这个避免浏览器 WebGL 上下文数量上限
    try { if (renderer.forceContextLoss) renderer.forceContextLoss() } catch (e) {}
    try { if (canvas.parentNode) canvas.parentNode.removeChild(canvas) } catch (e) {}
  }

  return {
    update: apply,
    dispose,
    canvas,
    // 供自测/排查用：世界尺寸（真实数据下可核对换算）
    size: () => ({ w: state.worldW, h: state.worldH }),
  }
}

// ─────────────────────────── D. 引导 + React 组件 ───────────────────────────

// 加载 three → 建世界。任何一步失败都 reject 一个带中文原因的 Error（ThreeStage 统一转 onFail）。
async function sbc3dBoot(host, opts) {
  const THREE = await sbc3dLoadThree()
    .catch((e) => { throw new Error('3D 引擎加载失败：' + ((e && e.message) || e)) })
  if (!THREE) throw new Error('3D 引擎加载失败')
  return sbc3dCreateWorld(host, opts, THREE)
}

function ThreeStage(props) {
  const p = props || {}
  const compact = !!p.compact
  const hostRef = React.useRef(null)
  const worldRef = React.useRef(null)
  const propsRef = React.useRef(p)
  propsRef.current = p
  const dataRef = React.useRef(p.data || null)
  dataRef.current = p.data || null
  const [phase, setPhase] = React.useState('boot') // boot | ready | failed
  const [notice, setNotice] = React.useState('')

  React.useEffect(() => {
    let alive = true
    let world = null
    const host = hostRef.current
    const fail = (e) => {
      if (!alive) return
      setPhase('failed')
      const reason = (e && e.message) || String(e || '') || '3D 舞台初始化失败'
      const cb = propsRef.current.onFail
      if (typeof cb === 'function') {
        try { cb(reason) } catch (err) {}
      }
    }
    const boot = async () => {
      try {
        if (!host) throw new Error('3D 容器还没挂上')
        const w = await sbc3dBoot(host, {
          compact,
          onPick: (place) => {
            const cb = propsRef.current.onPickPlace
            if (typeof cb === 'function' && place) {
              try { cb(place) } catch (e) {}
            }
          },
          onNotice: (msg) => { if (alive) setNotice(String(msg || '')) },
        })
        if (!alive) {
          try { w.dispose() } catch (e) {}
          return
        }
        world = w
        worldRef.current = w
        try { w.update(dataRef.current) } catch (e) {}
        setPhase('ready')
      } catch (e) {
        fail(e)
      }
    }
    boot()
    return () => {
      alive = false
      worldRef.current = null
      if (world) {
        try { world.dispose() } catch (e) {}
        world = null
      }
    }
  }, [])

  // 数据轮询：/api/stage 每 2.5s 换一个新对象，update 内部按 key 去重，只重建变化的部分
  React.useEffect(() => {
    const w = worldRef.current
    if (!w) return
    try { w.update(p.data || null) } catch (e) {}
  }, [p.data])

  const overlayText = phase === 'boot' ? '3D 舞台加载中…' : ''

  return h('div', {
    style: {
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: '#0b141d',
      borderRadius: compact ? 8 : 12,
    },
  },
    h('div', {
      ref: hostRef,
      style: { position: 'absolute', inset: 0 },
    }),
    overlayText
      ? h('div', {
          style: {
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', background: 'rgba(8,13,20,.72)', color: 'rgba(215,222,232,.82)',
            fontSize: compact ? 11 : 12.5, lineHeight: 1.7, textAlign: 'center', padding: 12,
          },
        }, overlayText)
      : null,
    notice
      ? h('div', {
          style: {
            position: 'absolute', left: 8, right: 8, bottom: 8, pointerEvents: 'none',
            background: 'rgba(8,13,20,.78)', border: '1px solid rgba(245,158,11,.55)',
            borderRadius: 8, padding: '3px 8px', fontSize: 10.5, lineHeight: 1.5,
            color: '#f2d7a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
          title: notice,
        }, notice)
      : null,
    !compact && !notice
      ? h('div', {
          style: {
            position: 'absolute', right: 8, bottom: 8, pointerEvents: 'none',
            fontSize: 10, color: 'rgba(215,222,232,.55)', textShadow: '0 1px 3px rgba(0,0,0,.8)',
            whiteSpace: 'nowrap',
          },
        }, '拖动旋转 · 滚轮缩放 · 点地点让她去')
      : null,
  )
}

    /* ===== src/client/20-stage/stage.js ===== */
// 20-stage/stage.js —— 舞台（2D 底图 + 3D 舞台；原生实现，替代 runtime/stage.html 与 model.html）
//
// 契约：function StageView(props)；props.compact=true 表示聊天分屏里的小尺寸。
// 数据：GET /api/stage（useApi 轮询 STAGE_POLL_MS；不再自己 setInterval + 每秒重建 DOM）
//      点击地点：POST /api/location { placeId, instant:true }；被拒绝（refused）时显示 reason。
// 范围：2D（底图/地点钉/角色）+ 3D（ThreeStage，见 20-stage/three3d.js）。
//      3D 需要 WebGL；不可用时自动回退 2D 并留下说明，不白屏、不崩（M06/M07）。
//
// 静态部分（底图/地点钉）只在数据变化时重建；角色位置沿用旧网页的 left/top 百分比 + CSS
// transition，行程中平滑移动，不逐帧改写 DOM（N04）。3D 分支由 ThreeStage 自己全权接管渲染与清理。

const STAGE_MAP_ASPECT_FALLBACK = 1000 / 640

// ── 通用小工具（map.js 也复用；名字带前缀避免和别的模块撞）─────────────────
// 容器尺寸：用 callback ref 拿元素（元素可能在首帧之后才挂上，比如先加载态再有数据），
// ResizeObserver 优先、window.resize 兜底；测不到时是 0（首帧不渲染地图框）。
// 用法：const fit = sbcFitUseSize(可选的外部 refObject)；渲染时 ref: fit.ref；读 fit.size。
function sbcFitUseSize(extraRef) {
  const [el, setEl] = React.useState(null)
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const ref = React.useCallback((node) => {
    if (extraRef) extraRef.current = node || null
    setEl(node || null)
  }, [extraRef])
  // 优先 layout effect：量完再画，避免地图框先按 0 尺寸闪一帧
  const useIso = React.useLayoutEffect || React.useEffect
  useIso(() => {
    if (!el) return undefined
    const read = () => {
      const w = Math.max(0, Math.round(Number(el.clientWidth) || 0))
      const h = Math.max(0, Math.round(Number(el.clientHeight) || 0))
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    read()
    let ro = null
    try {
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(read); ro.observe(el) }
    } catch (e) { ro = null }
    window.addEventListener('resize', read)
    return () => {
      try { if (ro) ro.disconnect() } catch (e) {}
      window.removeEventListener('resize', read)
    }
  }, [el])
  return { ref, size, el }
}

// 在容器里按宽高比居中铺满（和旧 stage.html 的 fitMapView 同一套算法，底图不变形）
function sbcFitRect(size, aspect) {
  const cw = Math.max(0, Number(size && size.w) || 0)
  const ch = Math.max(0, Number(size && size.h) || 0)
  const ar = Number(aspect) > 0.05 ? Number(aspect) : STAGE_MAP_ASPECT_FALLBACK
  if (!cw || !ch) return { w: 0, h: 0, left: 0, top: 0 }
  let w = cw
  let h = w / ar
  if (h > ch) { h = ch; w = h * ar }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), left: Math.round((cw - w) / 2), top: Math.round((ch - h) / 2) }
}

// 行程进度：用 startedAt/durationMs 现算（轮询间隔里也能走），服务端 progress 兜底
function stageTravelProgress(traveling) {
  if (!traveling) return 0
  const dur = Math.max(1, Number(traveling.durationMs) || 0)
  const started = Number(traveling.startedAt) || 0
  if (started > 0 && dur > 1) return clampNum((Date.now() - started) / dur, 0, 1)
  return clampNum(traveling.progress, 0, 1)
}

// 路径上第 progress（0~1）处的点；没有路径时返回 null
function sbcPointOnPath(path, progress) {
  const pts = Array.isArray(path) ? path : []
  if (pts.length < 2) return null
  const prog = clampNum(progress, 0, 1)
  let total = 0
  const segs = []
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(Number(pts[i].x) - Number(pts[i + 1].x), Number(pts[i].y) - Number(pts[i + 1].y))
    segs.push(d)
    total += d
  }
  if (!(total > 0)) return { x: Number(pts[0].x) || 0, y: Number(pts[0].y) || 0 }
  let target = total * prog
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const r = segs[i] ? clampNum(target / segs[i], 0, 1) : 1
      return {
        x: Number(pts[i].x) + (Number(pts[i + 1].x) - Number(pts[i].x)) * r,
        y: Number(pts[i].y) + (Number(pts[i + 1].y) - Number(pts[i].y)) * r,
      }
    }
    target -= segs[i]
  }
  return null
}

// 她此刻在画布上的位置（0~1）和头顶标签；任何异常都回退到安全坐标，避免 NaN%
function stageMarkerPos(data) {
  const loc = (data && data.location) || {}
  const map = (data && data.map) || {}
  const places = Array.isArray(map.places) ? map.places : []
  if (loc.state === 'traveling' && loc.traveling) {
    const t = loc.traveling
    const pt = sbcPointOnPath(t.path, stageTravelProgress(t)) || { x: 0.5, y: 0.5 }
    return { x: pt.x, y: pt.y, tag: String(t.modeIcon || '') + String(t.modeLabel || '') + '中', tone: T.warn }
  }
  if (loc.state === 'intercity' && loc.intercity) {
    const t = loc.intercity
    // 跨城时她"在路上"：画在地图上方（0.2 让她的头/脚不被地图框裁掉）
    return { x: 0.5, y: 0.2, tag: String(t.modeIcon || '') + String(t.modeLabel || '') + '中', tone: T.warn }
  }
  const here = loc.placeId ? places.find((p) => String(p.id) === String(loc.placeId)) : null
  if (here && Number.isFinite(Number(here.x)) && Number.isFinite(Number(here.y))) {
    return { x: Number(here.x), y: Number(here.y), tag: '在这里', tone: T.ok }
  }
  return { x: 0.5, y: 0.62, tag: '', tone: T.idle }
}

// 一天里的时间色（黄昏/夜晚给一点色调，纯 CSS 渐变，不做动画）
function stageDayTint(hour) {
  const h = Number(hour)
  if (h >= 5 && h < 7) return 'linear-gradient(180deg, rgba(255,170,120,.16), rgba(120,90,160,.08))'
  if (h >= 7 && h < 17) return ''
  if (h >= 17 && h < 19.5) return 'linear-gradient(180deg, rgba(255,120,60,.15), rgba(20,10,40,.16))'
  return 'rgba(4,8,26,.30)'
}

// 「打开地图页」：外壳没给回调时降级成提示，不请求任何 HTML 页面（M01/N01）
function stageOpenMapPage(props) {
  try {
    if (props && typeof props.onOpenMap === 'function') { props.onOpenMap(); return true }
    if (typeof window !== 'undefined') {
      if (typeof window.__sbcOpenTab === 'function') { window.__sbcOpenTab('map'); return true }
      try { window.dispatchEvent(new CustomEvent('sbc:open-tab', { detail: { tab: 'map' } })) } catch (e) {}
    }
  } catch (e) {}
  return false
}

function StageView(props) {
  const p = props || {}
  const compact = !!p.compact
  const stage = useApi('/api/stage', { refreshMs: STAGE_POLL_MS })
  const data = stage.data
  const map = (data && data.map) || {}
  const loc = (data && data.location) || {}
  const character = (data && data.character) || {}
  const places = Array.isArray(map.places) ? map.places : []
  const mapImgPath = map.image && map.image.url ? String(map.image.url) : ''
  const expect2d = map.has2d !== false && !!mapImgPath
  const spritePath = character.sprite || (character.model && character.model.type === 'sprite' ? String(character.model.url || '') : '')
  const avatarPath = loc.avatar || character.avatar || ''

  const mapImg = useImage(mapImgPath)
  const spriteImg = useImage(spritePath)
  const fit = sbcFitUseSize()
  const size = fit.size

  const [aspect, setAspect] = React.useState(STAGE_MAP_ASPECT_FALLBACK)
  const [bgFailed, setBgFailed] = React.useState(false)
  const [spriteFailed, setSpriteFailed] = React.useState(false)
  const [moving, setMoving] = React.useState('')
  const [notice, setNotice] = React.useState('')
  // 2D / 3D：localStorage `companionStage3D` 是用户的显式选择（null = 没选过，按地图 displayMode 决定）
  const [mode3dPref, setMode3dPref] = useLocal('companionStage3D', null)
  // 3D 启动失败的原因（WebGL/three 不可用）：非空就强制走 2D，并在底部留一行说明
  const [fail3d, setFail3d] = React.useState('')

  // 换地图/换底图：重置比例与失败标记，按新图重新适配
  React.useEffect(() => {
    setAspect(STAGE_MAP_ASPECT_FALLBACK)
    setBgFailed(false)
  }, [mapImgPath])
  React.useEffect(() => { setSpriteFailed(false) }, [spritePath])
  // 换地图：上一次的 3D 失败结论不能带到新地图上（换张图可能就能 3D）
  React.useEffect(() => { setFail3d('') }, [map.id])

  // 这张地图有没有 3D 资源：map.has3d=true 或配了 3D 模型；其余情况 3D 开关禁用
  const can3d = !!(map.has3d === true || (map.model && map.model.url))
  const want3d = can3d && !fail3d && (mode3dPref === null ? map.displayMode === '3d' : !!mode3dPref)
  // 3D 组件由 20-stage/three3d.js 提供（同一次构建的片段）；用 typeof 兜一层：
  // 万一构建清单里漏了这个片段，面板也只是没有 3D，不会因为 ReferenceError 整页白掉。
  const has3dModule = typeof ThreeStage === 'function'
  const use3d = !!data && want3d && has3dModule

  const toggle3d = (next) => {
    if (next && !can3d) {
      toast('这张地图没有 3D 资源', 'error')
      return
    }
    if (next && !has3dModule) {
      toast('3D 模块没有打进这次构建（缺少 20-stage/three3d.js）', 'error')
      return
    }
    setFail3d('')
    setMode3dPref(!!next)
  }

  // 3D 挂了：toast 中文原因 + 自动切回 2D（不写 localStorage，保留用户偏好，方便修好后重试）
  const on3dFail = (reason) => {
    const msg = String(reason || '3D 舞台不可用')
    setFail3d(msg)
    toast('3D 舞台不可用：' + msg + '，已切回 2D', 'error')
  }

  const rect = sbcFitRect(size, aspect)
  const marker = stageMarkerPos(data)
  const traveling = (loc.state === 'traveling' && loc.traveling) || null
  const intercity = (loc.state === 'intercity' && loc.intercity) || null
  const progress = loc.state === 'traveling' && traveling ? stageTravelProgress(traveling) : (loc.state === 'intercity' && intercity ? stageTravelProgress(intercity) : 0)
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60

  // 点击地点：instant 直达；被拒绝时把 reason 显示出来（refused 是 HTTP 200，必须看 data.ok）
  const goPlace = async (place) => {
    if (!place || moving) return
    if (loc.state === 'stationary' && String(loc.placeId) === String(place.id)) {
      setNotice('')
      toast('她已经在这儿了')
      return
    }
    setMoving(String(place.id))
    setNotice('')
    try {
      const r = await Api.post('/api/location', { placeId: place.id, instant: true })
      const d = r && r.ok ? (r.data || {}) : null
      if (r && r.ok && d && d.ok !== false) {
        toast('她已经到「' + (place.name || '那里') + '」了', 'ok')
        stage.reload()
        return
      }
      const reason = (d && (d.reason || d.error)) || (r && r.error) || '移动失败'
      setNotice(String(reason))
      toast(String(reason), 'error')
    } catch (e) {
      const reason = (e && e.message) || '移动失败'
      setNotice(reason)
      toast(reason, 'error')
    } finally {
      setMoving('')
    }
  }

  const openMapPage = () => {
    if (!stageOpenMapPage(p)) toast('点顶部「地图」标签，在那里可以给地图加底图')
  }

  const weatherText = data && data.weather
    ? (String(data.weather.icon || '') + ' ' + String(data.weather.label || '') +
      (data.weather.temp !== null && data.weather.temp !== undefined ? ' ' + data.weather.temp + '°C' : '')).trim()
    : ''
  const wallet = (data && data.wallet) || null
  const moneyText = wallet
    ? (wallet.tokenMode
      ? ('零花 ' + fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元')
      : (fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元'))
    : ''
  const energy = data && data.energy !== undefined && data.energy !== null ? Number(data.energy) : null
  const whereText = loc.state === 'intercity' && intercity
    ? ('前往 ' + (intercity.toMapName || '别的城市'))
    : loc.state === 'traveling' && traveling
      ? ('去 ' + (traveling.toName || '路上') + ' 的路上')
      : ((loc.icon || '') + ' ' + (loc.placeName || '不知道在哪')).trim()

  const mapViewStyle = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    overflow: 'hidden',
    borderRadius: compact ? 8 : 12,
    border: '1px solid ' + T.border,
    background: T.bg2,
  }

  const renderPlaceholder = () => {
    const noBg = !expect2d
    return h('div', {
      style: {
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 7, padding: 16, textAlign: 'center',
      },
    },
      h('div', { style: { fontSize: compact ? 22 : 30, opacity: 0.72 } }, '🗺️'),
      h('div', { style: { fontSize: compact ? 11.5 : 13, fontWeight: 600, color: T.text2 } },
        noBg ? '当前地图没有 2D 底图' : '底图加载失败'),
      h('div', { style: { fontSize: compact ? 10 : 11.5, color: T.text3, lineHeight: 1.65, maxWidth: 330 } },
        noBg
          ? ('「' + (map.name || '这张地图') + '」还没有 2D 底图。加一张底图后她就会出现在地图上' + (can3d ? '；也可以直接切 3D 舞台看三维小镇。' : '。'))
          : '底图文件没能加载出来，可以重试一次；地点和位置数据本身是好的。'),
      h(Row, { gap: 6, style: { justifyContent: 'center' } },
        noBg ? h(Btn, { size: 'sm', kind: 'primary', onClick: openMapPage }, '去地图页加底图') : null,
        noBg ? null : h(Btn, { size: 'sm', onClick: () => { setBgFailed(false); mapImg.retry() } }, '重试加载底图'),
      ),
    )
  }

  const renderMap = () => {
    if (!expect2d || bgFailed) return renderPlaceholder()
    return [
      // 只在拿到图片地址后才渲染 <img>：src="" 的 img 会触发一次 error，
      // 那样会在首帧就被误判成「底图加载失败」（离线预览实测踩到过）。
      mapImg.src
        ? h('img', {
            key: 'bg',
            src: mapImg.src,
            alt: '',
            draggable: false,
            onLoad: (e) => {
              const el = e.currentTarget
              const nw = Number(el.naturalWidth) || 0
              const nh = Number(el.naturalHeight) || 0
              if (nw > 0 && nh > 0) setAspect(nw / nh)
            },
            onError: () => setBgFailed(true),
            style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' },
          })
        : null,
      h('div', {
        key: 'tint',
        style: { position: 'absolute', inset: 0, background: stageDayTint(nowHour), pointerEvents: 'none' },
      }),
      places.map((place) => {
        const here = loc.state === 'stationary' && String(place.id) === String(loc.placeId)
        const isMoving = moving === String(place.id)
        return h('button', {
          key: String(place.id),
          type: 'button',
          title: here ? ('她就在「' + String(place.name || '') + '」') : ('让' + (character.name || '她') + '去「' + String(place.name || '') + '」'),
          disabled: !!moving,
          onClick: () => goPlace(place),
          style: {
            position: 'absolute',
            left: pct(place.x),
            top: pct(place.y),
            transform: 'translate(-50%,-100%)',
            zIndex: here ? 4 : 3,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            border: 'none', background: 'transparent', padding: 0,
            cursor: moving ? 'progress' : 'pointer',
            opacity: isMoving ? 0.45 : 1,
            fontFamily: T.font,
            maxWidth: compact ? 76 : 104,
            appearance: 'none',
          },
        },
          h('span', {
            style: {
              width: compact ? 19 : 23, height: compact ? 19 : 23, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: here ? 'rgba(47,107,216,.30)' : 'rgba(8,13,20,.74)',
              border: '1px solid ' + (here ? T.brand : T.border2),
              fontSize: compact ? 10 : 12, lineHeight: 1,
              boxShadow: '0 2px 8px rgba(0,0,0,.32)',
            },
          }, place.icon || '📍'),
          h('span', {
            style: {
              fontSize: compact ? 8.5 : 10, lineHeight: '13px',
              color: here ? T.text : T.text2,
              background: 'rgba(8,13,20,.70)', border: '1px solid ' + T.border,
              borderRadius: 999, padding: '0 5px', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
            },
          }, String(place.name || '')),
        )
      }),
      h('div', {
        key: 'me',
        style: {
          position: 'absolute', left: pct(marker.x), top: pct(marker.y),
          transform: 'translate(-50%,-100%)', zIndex: 6,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          pointerEvents: 'none',
          transition: 'left .9s linear, top .9s linear',
        },
      },
        h(SkeletonAvatar, {
          path: avatarPath, name: character.name,
          moving: marker && marker.tag ? !!marker.tag : false,
          size: compact ? 64 : 118,
          fallbackSize: compact ? 30 : 44,
        }),
        marker.tag
          ? h('span', {
              style: {
                fontSize: compact ? 8.5 : 10, lineHeight: '13px', whiteSpace: 'nowrap',
                color: marker.tone,
                background: 'rgba(8,13,20,.82)',
                border: '1px solid ' + marker.tone,
                borderRadius: 6, padding: '0 5px',
              },
            }, marker.tag)
          : null,
      ),
    ]
  }

  const rootStyle = {
    flex: 1, minHeight: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
    background: T.bg, color: T.text, fontFamily: T.font,
    fontSize: compact ? 11.5 : 13,
  }

  // 首屏：没有数据时给加载/错误态，不白屏
  if (!data) {
    return h('div', { style: rootStyle },
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: compact ? 10 : 16 } },
        stage.loading
          ? h(Loading, { text: '舞台加载中…' })
          : h(ErrorBox, { title: '舞台加载失败', error: stage.error || '没有拿到舞台数据', onRetry: stage.reload }),
      ),
    )
  }

  const headerChips = [
    h(Chip, { key: 'place', active: true, title: '她当前的地点' }, whereText),
    weatherText ? h(Chip, { key: 'wx', title: '天气' }, weatherText) : null,
    h(Chip, { key: 'time', title: '现在时间' }, fmtTime(Date.now())),
    !compact && energy !== null ? h(Chip, { key: 'energy', title: '她的精力' }, energyLabel(energy)) : null,
    !compact && moneyText ? h(Chip, { key: 'money', title: '她的零花（不是 DeepSeek 余额）' }, '💰 ' + moneyText) : null,
    // 2D / 3D 切换（viewMode）：3D 需要地图有 3D 资源且 WebGL 可用
    h(Chip, {
      key: 'mode2d',
      active: !use3d,
      onClick: () => toggle3d(false),
      title: '2D 舞台（底图 + 地点）',
    }, '2D'),
    h(Chip, {
      key: 'mode3d',
      active: use3d,
      onClick: () => toggle3d(true),
      title: can3d
        ? (fail3d ? '3D 上次没起来（' + fail3d + '），点这里重试' : '3D 舞台：拖动旋转 · 滚轮缩放 · 点地点让她去')
        : '这张地图没有 3D 资源',
      style: can3d ? undefined : { opacity: 0.45, cursor: 'not-allowed' },
    }, '3D'),
    fail3d ? h(Chip, { key: 'fail3d', tone: 'warn', title: '3D 失败原因：' + fail3d }, '3D 不可用') : null,
  ].filter(Boolean)

  const statusLine = () => {
    if (loc.state === 'traveling' && traveling) {
      return ('正在从 ' + (traveling.fromName || '上一个地点') + ' 去 ' + (traveling.toName || '目的地') +
        ' · ' + (traveling.modeIcon || '') + (traveling.modeLabel || '') +
        ' · ' + Math.round(Number(traveling.distanceMeters) || 0) + ' m' +
        ' · 剩 ' + fmtDuration(Math.max(1, Math.ceil((Number(traveling.etaSec) || 0) / 60))))
    }
    if (loc.state === 'intercity' && intercity) {
      return ('跨城：' + (intercity.fromMapName || '这里') + ' → ' + (intercity.toMapName || '目的地') +
        ' · ' + (intercity.modeIcon || '') + (intercity.modeLabel || '') +
        ' · 约 ' + fmtDuration(Math.max(1, Math.ceil((Number(intercity.etaSec) || 0) / 60))))
    }
    const mins = Number(loc.minutes) || 0
    return ('她现在在「' + (loc.placeName || '不知道在哪') + '」' + (mins > 0 ? '（已待 ' + fmtDuration(mins) + '）' : '') +
      ' · 地图：' + (map.name || '未知') + (data.animationHint === 'sleeping' ? ' · 这个点她大概在睡觉' : ''))
  }

  return h('div', { style: rootStyle },
    // 顶部 HUD：compact 只保留最必要的一行，不和外层聊天条抢位置
    compact
      ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 5, padding: '2px 2px 3px',
            flexShrink: 0, fontSize: 10.5, color: T.text2, whiteSpace: 'nowrap', overflow: 'hidden',
          },
        },
          h('span', { style: { color: T.text, fontWeight: 600 } }, character.name || '她'),
          h('span', { style: { color: T.text3 } }, '·'),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, whereText),
          h('span', { style: { flex: 1 } }),
          weatherText ? h('span', { title: '天气' }, weatherText) : null,
          h('span', { title: '现在时间' }, fmtTime(Date.now())),
          // 分屏里用一个小胶囊切换 2D/3D（占位小，不挤掉地点）
          h(Chip, {
            key: 'mode',
            active: use3d,
            onClick: () => toggle3d(!use3d),
            title: can3d
              ? (use3d ? '切到 2D 舞台' : (fail3d ? '3D 上次没起来：' + fail3d + '，点这里重试' : '切到 3D 舞台'))
              : '这张地图没有 3D 资源',
            style: { padding: '1px 7px', fontSize: 10, lineHeight: '14px', opacity: can3d ? 1 : 0.5 },
          }, use3d ? '3D' : '2D'),
        )
      : h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '3px 2px 7px', flexShrink: 0,
          },
        },
          h(Avatar, { path: avatarPath, name: character.name, size: 24 }),
          h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, character.name || '她'),
          headerChips,
          h('span', { style: { flex: 1 } }),
          h(Btn, {
            size: 'sm',
            kind: 'ghost',
            title: '刷新舞台数据（自动每 ' + Math.round(STAGE_POLL_MS / 1000) + ' 秒刷新一次）',
            disabled: stage.loading,
            onClick: () => stage.reload(),
          }, stage.loading ? '刷新中…' : '刷新'),
        ),
    // 舞台画布（测量不到尺寸时也把内容挂上：真实浏览器用 layout effect 量完再画，
    // 非浏览器/首帧下 rect 是 0，但 React 树里有内容，不会出现"空白一片"）
    h('div', {
      ref: fit.ref,
      style: { position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', background: T.bg2, borderRadius: compact ? 8 : 12 },
    },
      // 3D：ThreeStage 自己铺满容器（WebGL 画布）；失败回调在这里切回 2D
      use3d
        ? h(ThreeStage, { data, compact, onPickPlace: goPlace, onFail: on3dFail })
        : h('div', { style: mapViewStyle }, renderMap()),
      // 断线但还有旧数据：顶部细提示条，不清空舞台（不抖）
      stage.error
        ? h('div', {
            style: {
              position: 'absolute', left: 8, right: 8, top: 8, zIndex: 8,
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,83,80,.16)', border: '1px solid ' + T.danger,
              borderRadius: 8, padding: '3px 8px', fontSize: 10.5, color: T.text,
            },
          },
            h(Dot, { on: false, tone: T.danger }),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              '运行时无响应：' + stage.error + '（显示最后一次数据）'),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: () => stage.reload() }, '重试'),
          )
        : null,
    ),
    // 底部状态 / 行程进度 / 拒绝原因
    h('div', { style: { flexShrink: 0, paddingTop: compact ? 3 : 6, display: 'flex', flexDirection: 'column', gap: 3 } },
      h('div', {
        style: {
          fontSize: compact ? 10 : 11.5, color: T.text2, lineHeight: 1.5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
        title: statusLine(),
      }, statusLine()),
      (traveling || intercity)
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('div', { style: { flex: 1, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
              h('div', { style: { width: Math.round(progress * 100) + '%', height: '100%', background: T.brand } }),
            ),
            h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap' } }, Math.round(progress * 100) + '%'),
          )
        : null,
      notice
        ? h('div', { style: { fontSize: 10.5, color: T.danger, lineHeight: 1.5 } }, '她没去：' + notice)
        : null,
      // 3D 失败：留一行说明（toast 会消失，这行一直在；点 HUD 的「3D」可重试）
      fail3d
        ? h('div', {
            title: '3D 失败原因：' + fail3d,
            style: {
              fontSize: 10.5, color: T.warn, lineHeight: 1.5,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, '3D 舞台不可用：' + fail3d + '（已切回 2D，点上方「3D」可重试）')
        : null,
      want3d && !has3dModule
        ? h('div', { style: { fontSize: 10.5, color: T.warn, lineHeight: 1.5 } },
            '3D 模块没进这次构建：把 src/client/20-stage/three3d.js 加进构建清单后重新构建')
        : null,
    ),
  )
}

    /* ===== src/client/20-stage/map.js ===== */
// 20-stage/map.js —— 地图查看 + 基础编辑（原生实现，替代 runtime/map.html 的核心部分）
//
// 契约：function MapView(props)
// 数据（全部直连 127.0.0.1 运行时的 /api/*，不请求任何 HTML 页面、无 iframe）：
//   GET  /api/map                         地图列表 / 当前地图 / 地点 / 交通 / 天气 / 精力 / 位置 / 作息
//   GET  /api/world/characters            各角色在这张图上的位置（x/y 0~1，轮询）
//   POST /api/map { mapId, places, expectedRev? }   保存地点（D04 B 基础编辑）
//   POST /api/map/activate                切地图（跨城，会真的移动她，可能被拒绝）
//   POST /api/map/create | /api/map/delete       新建 / 删除地图
//   POST /api/map/image | /api/scene/image       底图 / 内部场景背景图上传（dataUrl）
//   GET  /api/travel/options + POST /api/travel/ticket   跨城买票
//   GET  /api/data/revisions              保存前的版本号（expectedRev 冲突检测，409 不覆盖）
//   POST /api/location                    让她在同一张图里移动（可能被拒绝，要显示 reason）
//
// 坐标一律 0~1 归一化（地点钉、热点、障碍/可走都相对各自底图宽高），绝不把 px 当百分比（M04）。
// 地点 id 保持稳定：拖动只改 x/y，不重新生成 id；保存只提交 places，不整体覆盖地图其它字段。
// 读失败（/api/map 或 /api/data/revisions 都没拿到）时禁止保存（M05 同款要求）。

// ── 小工具（都带 map 前缀，避免和别的模块的工厂作用域撞名）──────────────
function mapCloneJson(value) {
  try { return value === undefined ? value : JSON.parse(JSON.stringify(value)) } catch (e) { return value }
}

// 把 Api.* 的返回 + 业务层 refused 统一成好判断的结构
function mapResultOf(r) {
  if (!r || !r.ok) return { ok: false, refused: false, needsConfirm: false, reason: '', error: (r && r.error) || '请求失败', status: (r && r.status) || 0 }
  const d = r.data || {}
  if (d.ok === false) {
    return {
      ok: false,
      refused: !!d.refused,
      needsConfirm: !!d.needsConfirm,
      reason: String(d.reason || d.error || '她拒绝了'),
      error: String(d.error || d.reason || '请求失败'),
      location: d.location || null,
    }
  }
  return { ok: true, refused: false, needsConfirm: false, reason: '', error: '', location: d.location || null, data: d }
}

// 保存后回读比对：确认真的落盘、且旧字段没被削掉（「刷新不丢」的自检）
function mapPlacesDiff(sent, back) {
  const list = Array.isArray(sent) ? sent : []
  const got = Array.isArray(back) ? back : []
  const problems = []
  if (got.length !== list.length) problems.push('地点数量 ' + list.length + ' → 回读 ' + got.length)
  for (const p of list) {
    const b = got.find((x) => String(x.id) === String(p.id))
    if (!b) { problems.push('回读缺少地点「' + String(p.name || p.id) + '」'); continue }
    if (String(b.name || '') !== String(p.name || '')) problems.push('「' + String(p.name || p.id) + '」名字没保存上')
    if (Number.isFinite(Number(p.x)) && Math.abs(Number(b.x) - Number(p.x)) > 1e-6) problems.push('「' + String(p.name || p.id) + '」x 坐标没按提交保存')
    if (Number.isFinite(Number(p.y)) && Math.abs(Number(b.y) - Number(p.y)) > 1e-6) problems.push('「' + String(p.name || p.id) + '」y 坐标没按提交保存')
    if (String(b.icon || '') !== String(p.icon || '')) problems.push('「' + String(p.name || p.id) + '」图标没保存上')
    const pBg = String((p.scene && p.scene.background) || '')
    const bBg = String((b.scene && b.scene.background) || '')
    if (pBg !== bBg) problems.push('「' + String(p.name || p.id) + '」内部场景背景没保存上')
    const pHot = (p.scene && Array.isArray(p.scene.hotspots)) ? p.scene.hotspots.length : 0
    const bHot = (b.scene && Array.isArray(b.scene.hotspots)) ? b.scene.hotspots.length : 0
    if (pHot !== bHot) problems.push('「' + String(p.name || p.id) + '」热点数量 ' + pHot + ' → 回读 ' + bHot)
    const pObs = (p.scene && Array.isArray(p.scene.obstacles)) ? p.scene.obstacles.length : 0
    const bObs = (b.scene && Array.isArray(b.scene.obstacles)) ? b.scene.obstacles.length : 0
    if (pObs !== bObs) problems.push('「' + String(p.name || p.id) + '」障碍数量 ' + pObs + ' → 回读 ' + bObs)
    const pWalk = (p.scene && Array.isArray(p.scene.walkable)) ? p.scene.walkable.length : 0
    const bWalk = (b.scene && Array.isArray(b.scene.walkable)) ? b.scene.walkable.length : 0
    if (pWalk !== bWalk) problems.push('「' + String(p.name || p.id) + '」可走区域数量 ' + pWalk + ' → 回读 ' + bWalk)
    const pPhotos = (p.scene && Array.isArray(p.scene.photos)) ? p.scene.photos.length : 0
    const bPhotos = (b.scene && Array.isArray(b.scene.photos)) ? b.scene.photos.length : 0
    if (pPhotos !== bPhotos) problems.push('「' + String(p.name || p.id) + '」场景照片数量 ' + pPhotos + ' → 回读 ' + bPhotos)
    const pChars = (p.scene && Array.isArray(p.scene.characters)) ? p.scene.characters.length : 0
    const bChars = (b.scene && Array.isArray(b.scene.characters)) ? b.scene.characters.length : 0
    if (pChars !== bChars) problems.push('「' + String(p.name || p.id) + '」场景角色位置数量 ' + pChars + ' → 回读 ' + bChars)
    const pMode = (p.scene && p.scene.mode === '3d') ? '3d' : '2d'
    const bMode = (b.scene && b.scene.mode === '3d') ? '3d' : '2d'
    if (pMode !== bMode) problems.push('「' + String(p.name || p.id) + '」场景视图模式 ' + pMode + ' → 回读 ' + bMode)
  }
  return problems.slice(0, 6)
}

// 地图实体的版本号（服务端 guardRev 用）；拿不到就返回 null（保存时不带 expectedRev）
async function mapReadBaseRev() {
  try {
    const r = await Api.get('/api/data/revisions')
    if (!r.ok || !r.data || !r.data.entities) return null
    const keys = Object.keys(r.data.entities).filter((k) => k.indexOf('maps:') === 0)
    if (!keys.length) return null
    const rev = Number(r.data.entities[keys[0]].rev)
    return Number.isFinite(rev) ? rev : null
  } catch (e) { return null }
}

// 角色状态文案（地图上的小人悬浮/列表用）
function mapCharStatus(c) {
  if (!c) return ''
  if (c.state === 'intercity') return '跨城旅行中' + (c.etaSec ? ' · 约 ' + Math.max(1, Math.ceil(Number(c.etaSec) / 60)) + ' 分钟' : '')
  if (c.state === 'traveling') return String(c.transport || '出行') + '中' + (c.etaSec ? ' · 约 ' + Math.max(1, Math.ceil(Number(c.etaSec) / 60)) + ' 分钟' : '')
  return '在「' + String(c.placeName || '某个地方') + '」'
}

// ── 地图画布：底图 + 地点钉（编辑模式可拖）+ 角色位置 ─────────────────
function MapCanvas(props) {
  const p = props || {}
  const map = p.map || {}
  const places = Array.isArray(p.places) ? p.places : []
  const characters = Array.isArray(p.characters) ? p.characters : []
  const location = p.location || {}
  const editMode = !!p.editMode
  const busyPlaceId = String(p.busyPlaceId || '')
  const mapImgPath = map.image && map.image.url ? String(map.image.url) : ''

  const mapImg = useImage(mapImgPath)
  const canvasRef = React.useRef(null)
  const pinRefs = React.useRef({})
  const dragRef = React.useRef(null)
  const fit = sbcFitUseSize(canvasRef)
  const size = fit.size
  const [aspect, setAspect] = React.useState(STAGE_MAP_ASPECT_FALLBACK)
  const [bgFailed, setBgFailed] = React.useState(false)

  React.useEffect(() => {
    setAspect(STAGE_MAP_ASPECT_FALLBACK)
    setBgFailed(false)
  }, [mapImgPath])

  const rect = sbcFitRect(size, aspect)

  // 编辑模式：按住地点钉拖动，过程中只改 DOM，松手才提交一次 state（N04）
  const onPinDown = (place, ev) => {
    if (!editMode) return
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    const box = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null
    if (!box || !box.width || !box.height) return
    const start = { x: Number(place.x) || 0.5, y: Number(place.y) || 0.5 }
    const drag = { id: place.id, place, el: pinRefs.current[String(place.id)] || null, box, x: start.x, y: start.y, moved: false }
    dragRef.current = drag
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      const nx = clampNum((e.clientX - d.box.left) / d.box.width, 0.05, 0.95)
      const ny = clampNum((e.clientY - d.box.top) / d.box.height, 0.08, 0.92)
      if (Math.abs(nx - d.x) + Math.abs(ny - d.y) > 0.004) d.moved = true
      d.x = nx
      d.y = ny
      if (d.el) { d.el.style.left = (nx * 100) + '%'; d.el.style.top = (ny * 100) + '%' }
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (d.moved) { if (p.onPlaceMove) p.onPlaceMove(d.id, d.x, d.y) }
      else if (p.onPlaceClick) p.onPlaceClick(d.place)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const viewStyle = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    overflow: 'hidden',
    borderRadius: 10,
  }

  const gridStyle = {
    backgroundImage:
      'linear-gradient(rgba(127,127,127,.16) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(127,127,127,.16) 1px, transparent 1px)',
    backgroundSize: '10% 10%, 10% 10%',
    backgroundColor: T.bg2,
  }

  // 角色小人（读取 /api/world/characters；只在同一张图上画）
  const charPins = characters
    .filter((c) => c && c.sameMap && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)))
    .map((c) => h('div', {
      key: 'char-' + String(c.id),
      title: String(c.name || '她') + ' · ' + mapCharStatus(c),
      style: {
        position: 'absolute',
        left: pct(c.x),
        top: pct(c.y),
        transform: 'translate(-50%,-100%)',
        zIndex: 5,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        pointerEvents: 'none',
        transition: 'left 1s linear, top 1s linear',
      },
    },
      h('div', {
        // 脚下投影：给透明底的小人一个「落地」的底，看着不悬空
        style: {
          position: 'absolute',
          bottom: c.isActive ? 15 : 13,
          left: '50%',
          transform: 'translateX(-50%)',
          width: c.isActive ? 58 : 42,
          height: c.isActive ? 15 : 11,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse at center, rgba(0,0,0,.42), rgba(0,0,0,0) 72%)',
          filter: 'blur(.4px)',
          pointerEvents: 'none',
          zIndex: 0,
        },
      }),
      h(SkeletonAvatar, {
        path: c.avatar, name: c.name, x: c.x, y: c.y,
        moving: c.state ? c.state !== 'stationary' : undefined,
        size: c.isActive ? 96 : 72,
        fallbackSize: c.isActive ? 30 : 24,
      }),
      h('span', {
        style: {
          fontSize: 9.5, lineHeight: '13px', whiteSpace: 'nowrap',
          color: c.isActive ? T.text : T.text2,
          background: 'rgba(8,13,20,.78)',
          border: '1px solid ' + (c.isActive ? T.brand : T.border),
          borderRadius: 999, padding: '0 5px',
        },
      }, String(c.name || '她')),
    ))

  return h('div', {
    ref: fit.ref,
    style: {
      position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
      // 编辑模式铺一层网格底板（透明底/没底图时不再显得悬空）
      background: editMode
        ? ('linear-gradient(rgba(127,127,127,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(127,127,127,.12) 1px, transparent 1px), ' + T.bg2)
        : T.bg2,
      backgroundSize: editMode ? '28px 28px, 28px 28px, auto' : undefined,
      borderRadius: 12, border: '1px solid ' + (editMode ? T.brand : T.border),
    },
  },
    h('div', { style: viewStyle },
      mapImgPath && !bgFailed && mapImg.src
            ? h('img', {
                src: mapImg.src,
                alt: '',
                draggable: false,
                onLoad: (e) => {
                  const el = e.currentTarget
                  const nw = Number(el.naturalWidth) || 0
                  const nh = Number(el.naturalHeight) || 0
                  if (nw > 0 && nh > 0) setAspect(nw / nh)
                },
                onError: () => setBgFailed(true),
                style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' },
              })
            : h('div', {
                style: Object.assign({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, textAlign: 'center' }, gridStyle),
              },
                h('div', { style: { fontSize: 24, opacity: 0.7 } }, '🗺️'),
                h('div', { style: { fontSize: 12.5, color: T.text2, fontWeight: 600 } },
                  mapImgPath ? '底图加载失败' : '这张地图没有 2D 底图'),
                h('div', { style: { fontSize: 11, color: T.text3, lineHeight: 1.65, maxWidth: 300 } },
                  mapImgPath
                    ? '地点钉还会按数据画出来（坐标是对的），只是底图没加载出来。'
                    : (editMode ? '编辑模式里可以点上方「上传底图」给这张地图加一张底图。' : '进入编辑模式后可以上传底图；地点坐标仍然可用。')),
                mapImgPath && bgFailed ? h(Btn, { size: 'sm', onClick: () => { setBgFailed(false); mapImg.retry() } }, '重试') : null,
              ),
          // 地点钉
          places.map((place) => {
            const here = location.state === 'stationary' && String(location.placeId) === String(place.id)
            const isBusy = busyPlaceId === String(place.id)
            return h('div', {
              key: 'pin-' + String(place.id),
              ref: (el) => { pinRefs.current[String(place.id)] = el },
              title: editMode
                ? ('拖动改「' + String(place.name || '') + '」的位置（x=' + Number(place.x || 0).toFixed(2) + ', y=' + Number(place.y || 0).toFixed(2) + '）')
                : ('点开「' + String(place.name || '') + '」详情'),
              onClick: editMode ? undefined : (() => { if (p.onPlaceClick) p.onPlaceClick(place) }),
              onPointerDown: editMode ? ((ev) => onPinDown(place, ev)) : undefined,
              style: {
                position: 'absolute',
                left: pct(place.x),
                top: pct(place.y),
                transform: 'translate(-50%,-100%)',
                zIndex: here ? 4 : 3,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                cursor: editMode ? 'grab' : 'pointer',
                opacity: isBusy ? 0.45 : 1,
                userSelect: 'none',
                maxWidth: 108,
              },
            },
              h('span', {
                style: {
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: here ? 'rgba(47,107,216,.30)' : 'rgba(8,13,20,.74)',
                  border: '1px ' + (editMode ? 'dashed ' : 'solid ') + (here ? T.brand : T.border2),
                  fontSize: 11.5, lineHeight: 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,.32)',
                },
              }, place.icon || '📍'),
              h('span', {
                style: {
                  fontSize: 10, lineHeight: '14px',
                  color: here ? T.text : T.text2,
                  background: 'rgba(8,13,20,.72)', border: '1px solid ' + T.border,
                  borderRadius: 999, padding: '0 5px', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                },
              }, String(place.name || '')),
              editMode
                ? h('span', { style: { fontSize: 8.5, lineHeight: '12px', color: T.text3, whiteSpace: 'nowrap' } },
                    Number(place.x || 0).toFixed(2) + ', ' + Number(place.y || 0).toFixed(2))
                : null,
            )
          }),
          charPins,
        ),
  )
}

// ── 地点详情（查看模式点地点钉打开）───────────────────────────────────
function MapPlaceModal(props) {
  const p = props || {}
  const place = p.place || {}
  const scene = place.scene || null
  const hotspots = scene && Array.isArray(scene.hotspots) ? scene.hotspots.length : 0
  const obstacles = scene && Array.isArray(scene.obstacles) ? scene.obstacles.length : 0
  const walkable = scene && Array.isArray(scene.walkable) ? scene.walkable.length : 0
  const people = Array.isArray(p.people) ? p.people : []
  return h(Modal, {
    open: true,
    title: (place.icon || '📍') + ' ' + String(place.name || '地点'),
    onClose: p.onClose,
    width: 480,
    footer: h(Row, { gap: 8, justify: 'flex-end' },
      h(Btn, { onClick: p.onClose }, '关闭'),
      h(Btn, { onClick: () => { if (p.onEdit) p.onEdit(place) } }, '编辑地点'),
      h(Btn, { kind: 'primary', disabled: !!p.busy, onClick: () => { if (p.onGo) p.onGo(place) } }, p.busy ? '移动中…' : '让她来这里'),
    ),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      place.image ? h(Img, { path: place.image, width: 72, height: 72, style: { borderRadius: 10 }, fallback: '图标加载失败' }) : null,
      place.desc ? h(KV, { k: '描述', v: place.desc }) : null,
      place.feel ? h(KV, { k: '她的感受', v: place.feel }) : null,
      h(Divider, {}),
      h(KV, { k: '坐标', v: 'x ' + Number(place.x || 0).toFixed(3) + ' · y ' + Number(place.y || 0).toFixed(3) + '（0~1 归一化，不是像素）' }),
      h(KV, {
        k: '内部场景',
        v: scene && scene.background
          ? ('有背景图 · 热点 ' + hotspots + ' 个 · 障碍 ' + obstacles + ' · 可走 ' + walkable + (scene.mode === '3d' ? ' · 3D 模型' : ''))
          : '没有设置',
      }),
      people.length
        ? h(KV, { k: '现在在这', v: people.map((c) => String(c.name || '')).join('、') })
        : h(Note, {}, '现在这里没有别人。'),
      h(Note, {}, '「让她来这里」会按她的出行方式走一段路（夜里/没钱可能被拒绝，会显示原因）。'),
    ),
  )
}

// ── 内部场景编辑器：背景图 / 热点 / 障碍 / 可走区域（全部 0~1 归一化）──
function MapSceneEditor(props) {
  const p = props || {}
  const scene = p.scene || null
  const sc = scene || {}
  // 保留旧字段：只改我们认识的，其余原样带回去（M04「不丢旧 fields」）
  const base = {
    background: String(sc.background || ''),
    characters: Array.isArray(sc.characters) ? sc.characters : [],
    hotspots: Array.isArray(sc.hotspots) ? sc.hotspots : [],
    photos: Array.isArray(sc.photos) ? sc.photos : [],
    obstacles: Array.isArray(sc.obstacles) ? sc.obstacles : [],
    walkable: Array.isArray(sc.walkable) ? sc.walkable : [],
    mode: sc.mode === '3d' ? '3d' : '2d',
    model3d: sc.model3d || null,
  }
  const bg = base.background
  const img = useImage(bg)
  const boxRef = React.useRef(null)
  const previewRef = React.useRef(null)
  const fileRef = React.useRef(null)
  const drawRef = React.useRef(null)
  const fit = sbcFitUseSize()
  const [aspect, setAspect] = React.useState(16 / 9)
  const [bgText, setBgText] = React.useState(bg)
  const [brush, setBrush] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [elError, setElError] = React.useState('')

  React.useEffect(() => { setBgText(bg); setAspect(16 / 9) }, [bg])

  const update = (patch) => {
    if (!p.onChange) return
    p.onChange(Object.assign({}, base, patch))
  }

  // 画布尺寸：按背景图比例 fit，最高 300px，避免竖图把弹窗撑爆
  const wrapW = Math.max(0, Math.round(Number(fit.size.w) || 0))
  let boxW = wrapW
  let boxH = boxW > 0 ? boxW / Math.max(0.2, Number(aspect) || 16 / 9) : 0
  if (boxH > 300) { boxH = 300; boxW = boxH * Math.max(0.2, Number(aspect) || 16 / 9) }

  // 拖框画障碍 / 可走区域：拖动过程直接改预览层，松手才写一次 state
  const onCanvasDown = (ev) => {
    if (!brush || !boxRef.current) return
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    const rect = boxRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    drawRef.current = { sx: ev.clientX, sy: ev.clientY, rect }
    const move = (e) => {
      const d = drawRef.current
      if (!d) return
      const x = Math.min(e.clientX, d.sx) - d.rect.left
      const y = Math.min(e.clientY, d.sy) - d.rect.top
      const w = Math.abs(e.clientX - d.sx)
      const h = Math.abs(e.clientY - d.sy)
      const el = previewRef.current
      if (el) {
        el.style.display = 'block'
        el.style.left = clampNum(x / d.rect.width, 0, 1) * 100 + '%'
        el.style.top = clampNum(y / d.rect.height, 0, 1) * 100 + '%'
        el.style.width = clampNum(w / d.rect.width, 0, 1) * 100 + '%'
        el.style.height = clampNum(h / d.rect.height, 0, 1) * 100 + '%'
      }
    }
    const up = (e) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const d = drawRef.current
      drawRef.current = null
      if (previewRef.current) previewRef.current.style.display = 'none'
      if (!d) return
      const x = Math.min(e.clientX, d.sx) - d.rect.left
      const y = Math.min(e.clientY, d.sy) - d.rect.top
      const w = Math.abs(e.clientX - d.sx)
      const h = Math.abs(e.clientY - d.sy)
      if (w / d.rect.width < 0.02 || h / d.rect.height < 0.02) return
      const rectNew = {
        x: clampNum(x / d.rect.width, 0, 1),
        y: clampNum(y / d.rect.height, 0, 1),
        w: clampNum(w / d.rect.width, 0.01, 1),
        h: clampNum(h / d.rect.height, 0.01, 1),
      }
      if (brush === 'obstacle') update({ obstacles: base.obstacles.concat([rectNew]) })
      else update({ walkable: base.walkable.concat([rectNew]) })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // 拖动热点改位置
  const onHotspotDown = (idx, ev) => {
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const box = boxRef.current ? boxRef.current.getBoundingClientRect() : null
    if (!box || !box.width || !box.height) return
    const cur = base.hotspots[idx] || {}
    const drag = { x: clampNum(cur.x, 0.02, 0.98), y: clampNum(cur.y, 0.05, 0.95), moved: false, el: ev.currentTarget }
    const move = (e) => {
      const nx = clampNum((e.clientX - box.left) / box.width, 0.02, 0.98)
      const ny = clampNum((e.clientY - box.top) / box.height, 0.05, 0.95)
      if (Math.abs(nx - drag.x) + Math.abs(ny - drag.y) > 0.002) drag.moved = true
      drag.x = nx
      drag.y = ny
      if (drag.el) { drag.el.style.left = (nx * 100) + '%'; drag.el.style.top = (ny * 100) + '%' }
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      if (!drag.moved) return
      update({ hotspots: base.hotspots.map((h, i) => (i === idx ? Object.assign({}, h, { x: drag.x, y: drag.y }) : h)) })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const setHotspotLabel = (idx, label) => {
    update({ hotspots: base.hotspots.map((h, i) => (i === idx ? Object.assign({}, h, { label: String(label || '').slice(0, 40) }) : h)) })
  }
  const addHotspot = () => {
    update({ hotspots: base.hotspots.concat([{ id: 'hs-' + Date.now().toString(36), label: '新热点', x: 0.5, y: 0.5, action: '' }]) })
  }
  const delHotspot = (idx) => { update({ hotspots: base.hotspots.filter((x, i) => i !== idx) }) }
  const delObstacle = (idx) => { update({ obstacles: base.obstacles.filter((x, i) => i !== idx) }) }
  const delWalk = (idx) => { update({ walkable: base.walkable.filter((x, i) => i !== idx) }) }

  // 服务端只接受 /models/、/assets/、/images/ 开头的背景图；这里先挡一次，免得保存后回读才报错
  const applyBg = () => {
    const url = String(bgText || '').trim()
    if (url && !/^\/(models|assets|images)\//.test(url)) {
      setElError('背景图路径要以 /models/、/assets/ 或 /images/ 开头（也可以直接上传）')
      return
    }
    setElError('')
    update({ background: url })
  }
  const clearBg = async () => {
    const hasMore = base.hotspots.length || base.obstacles.length || base.walkable.length
    if (hasMore) {
      const yes = await confirmDialog('清除背景图？', {
        detail: '服务端要求内部场景必须有背景图；清空后保存，热点 / 障碍 / 可走区域会一起被清掉。',
        danger: true,
        okText: '清除',
      })
      if (!yes) return
    }
    setBgText('')
    setElError('')
    update({ background: '' })
    toast('已清除背景（保存地点/地图后才写入服务端）')
  }

  const onPickFile = async (file) => {
    if (!file) return
    setUploading(true)
    setElError('')
    try {
      const read = await Api.readFileAsDataUrl(file, 8 * 1024 * 1024)
      if (!read.ok) { setElError(read.error || '读取图片失败'); return }
      const r = await Api.upload('/api/scene/image', { dataUrl: read.dataUrl })
      const d = r && r.ok ? (r.data || {}) : null
      if (d && d.ok !== false && d.url) {
        update({ background: String(d.url) })
        toast('背景图已上传（点「保存地点」再保存地图才写进数据）', 'ok')
      } else {
        setElError((d && d.error) || (r && r.error) || '上传失败')
      }
    } catch (e) {
      setElError((e && e.message) || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const rectDiv = (rectLike, idx, kind) => h('div', {
    key: kind + '-' + idx,
    title: '点一下删除这个' + (kind === 'obstacle' ? '障碍' : '可走区域'),
    onPointerDown: (ev) => { ev.stopPropagation() },
    onClick: (ev) => {
      ev.stopPropagation()
      if (kind === 'obstacle') delObstacle(idx)
      else delWalk(idx)
      toast('已删除' + (kind === 'obstacle' ? '障碍' : '可走区域'))
    },
    style: {
      position: 'absolute',
      left: pct(rectLike.x),
      top: pct(rectLike.y),
      width: pct(rectLike.w),
      height: pct(rectLike.h),
      background: kind === 'obstacle' ? 'rgba(239,83,80,.22)' : 'rgba(34,197,94,.18)',
      border: '1px dashed ' + (kind === 'obstacle' ? T.danger : T.ok),
      borderRadius: 3,
      cursor: 'pointer',
    },
  })

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 12, color: T.text2, flexShrink: 0 } }, '背景图'),
      h('span', { style: { flex: 1, minWidth: 140 } }, h(TextInput, {
        value: bgText,
        placeholder: '/models/scenes/xxx.jpg（也可以直接上传）',
        onChange: setBgText,
        onEnter: applyBg,
      })),
      h(Btn, { size: 'sm', onClick: applyBg }, '应用'),
      h(Btn, { size: 'sm', disabled: uploading, onClick: () => { if (fileRef.current) fileRef.current.click() } }, uploading ? '上传中…' : '上传'),
      h(Btn, { size: 'sm', kind: 'danger', onClick: clearBg }, '清除'),
      h('input', {
        type: 'file',
        accept: 'image/*',
        ref: fileRef,
        style: { display: 'none' },
        onChange: (e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = ''
          if (f) onPickFile(f)
        },
      }),
    ),
    elError ? h('div', { style: { fontSize: 11, color: T.danger, lineHeight: 1.6 } }, elError) : null,
    // 场景画布：热点可拖、障碍/可走可拖框画
    h('div', { ref: fit.ref, style: { width: '100%', minHeight: 1 } },
      boxW > 0
        ? h('div', {
            ref: boxRef,
            onPointerDown: onCanvasDown,
            style: {
              position: 'relative',
              width: boxW,
              height: boxH,
              margin: '0 auto',
              borderRadius: 10,
              border: '1px solid ' + T.border,
              overflow: 'hidden',
              background: T.bg2,
              cursor: brush ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            },
          },
            img.src && bg && !img.error
              ? h('img', {
                  src: img.src,
                  alt: '',
                  draggable: false,
                  onLoad: (e) => {
                    const el = e.currentTarget
                    const nw = Number(el.naturalWidth) || 0
                    const nh = Number(el.naturalHeight) || 0
                    if (nw > 0 && nh > 0) setAspect(nw / nh)
                  },
                  style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' },
                })
              : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center', fontSize: 11, color: T.text3 } },
                  bg ? '背景图加载失败（路径要 /models/ 开头）' : '还没有背景图：上传或填入 /models/ 地址后，这里会显示她的内部场景'),
            base.walkable.map((it, i) => rectDiv(it, i, 'walkable')),
            base.obstacles.map((it, i) => rectDiv(it, i, 'obstacle')),
            base.hotspots.map((hs, i) => h('div', {
              key: 'hs-pin-' + String(hs.id || i),
              title: '拖动改位置 · 热点「' + String(hs.label || '') + '」',
              onPointerDown: (ev) => onHotspotDown(i, ev),
              style: {
                position: 'absolute',
                left: pct(hs.x),
                top: pct(hs.y),
                transform: 'translate(-50%,-100%)',
                zIndex: 4,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                cursor: 'grab', userSelect: 'none',
              },
            },
              h('span', { style: { fontSize: 12, lineHeight: '15px', background: 'rgba(8,13,20,.82)', border: '1px solid ' + T.brand, borderRadius: 999, padding: '0 5px', color: T.text, whiteSpace: 'nowrap' } }, String(hs.label || '热点')),
              h('span', { style: { fontSize: 8.5, lineHeight: '11px', color: T.text3, whiteSpace: 'nowrap' } }, Number(hs.x || 0).toFixed(2) + ', ' + Number(hs.y || 0).toFixed(2)),
            )),
            h('div', { ref: previewRef, style: { position: 'absolute', display: 'none', border: '1px dashed ' + T.brand, background: 'rgba(47,107,216,.18)', pointerEvents: 'none' } }),
          )
        : null,
    ),
    h(Row, { gap: 6 },
      h(Chip, { active: brush === 'obstacle', onClick: () => setBrush(brush === 'obstacle' ? '' : 'obstacle') }, '🧱 画障碍'),
      h(Chip, { active: brush === 'walkable', onClick: () => setBrush(brush === 'walkable' ? '' : 'walkable') }, '🚶 画可走'),
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', onClick: () => { update({ obstacles: [] }); toast('已清空障碍（保存后才生效）') }, disabled: !base.obstacles.length }, '清空障碍'),
      h(Btn, { size: 'sm', onClick: () => { update({ walkable: [] }); toast('已清空可走区域（保存后才生效）') }, disabled: !base.walkable.length }, '清空可走'),
    ),
    h(Note, {}, '在背景图上拖一个框 = 新增；点已有框删除。障碍 ' + base.obstacles.length + ' 个 · 可走 ' + base.walkable.length + ' 个 · 坐标按背景图宽高 0~1 记录' + (brush ? '（当前正在画' + (brush === 'obstacle' ? '障碍' : '可走区域') + '）' : '') + '。'),
    h(Divider, {}),
    h(Row, { gap: 6 },
      h('span', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, '热点'),
      h(Btn, { size: 'sm', onClick: addHotspot }, '+ 热点'),
      h('span', { style: { flex: 1 } }),
      h(Note, {}, '热点是场景里可点的位置（例如床/书桌），拖动图上的标签可改坐标'),
    ),
    base.hotspots.length
      ? base.hotspots.map((hs, i) => h('div', { key: 'hs-row-' + String(hs.id || i), style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 22, flexShrink: 0, fontSize: 10.5, color: T.text3 } }, '#' + (i + 1)),
          h('span', { style: { flex: 1, minWidth: 80 } }, h(TextInput, { value: hs.label || '', placeholder: '热点名字', onChange: (v) => setHotspotLabel(i, v) })),
          h('span', { style: { width: 92, flexShrink: 0, textAlign: 'right', fontSize: 10, color: T.text3 } },
            Number(hs.x || 0).toFixed(2) + ', ' + Number(hs.y || 0).toFixed(2)),
          h(Btn, { size: 'sm', kind: 'danger', onClick: () => delHotspot(i) }, '删'),
        ))
      : h(Note, {}, '还没有热点。'),
  )
}

// ── 地点编辑（名字/图标/描述/感受 + 内部场景）─────────────────────────
function MapPlaceEditor(props) {
  const p = props || {}
  const initial = p.place || {}
  const [form, setForm] = React.useState(() => mapCloneJson(initial))
  const setField = (key, value) => setForm((f) => Object.assign({}, f || {}, { [key]: value }))
  const onSave = () => {
    const name = String(form.name || '').trim().slice(0, 20)
    if (!name) { toast('地点名字不能为空', 'error'); return }
    const next = Object.assign({}, form, {
      name,
      icon: String(form.icon || '').trim().slice(0, 4) || '📍',
      desc: String(form.desc || '').slice(0, 80),
      feel: String(form.feel || '').slice(0, 80),
      scene: form.scene || null,
    })
    if (p.onSave) p.onSave(next)
  }
  return h(Modal, {
    open: true,
    title: '编辑地点 · ' + String(initial.name || ''),
    onClose: p.onClose,
    width: 700,
    footer: h(Row, { gap: 8, justify: 'flex-end' },
      h(Btn, { onClick: p.onClose }, '取消'),
      h(Btn, { kind: 'primary', onClick: onSave }, '保存到草稿'),
    ),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      h(Row, { gap: 8, style: { alignItems: 'flex-start' } },
        h('div', { style: { width: 190, flexShrink: 0 } }, h(Field, { label: '名字（最多 20 字）' },
          h(TextInput, { value: form.name || '', placeholder: '地点名字', onChange: (v) => setField('name', String(v || '').slice(0, 20)) }))),
        h('div', { style: { width: 110, flexShrink: 0 } }, h(Field, { label: '图标（emoji）' },
          h(TextInput, { value: form.icon || '', placeholder: '📍', onChange: (v) => setField('icon', String(v || '').slice(0, 4)) }))),
        h('div', { style: { flex: 1, minWidth: 120, fontSize: 10.5, color: T.text3, lineHeight: 1.6, paddingTop: 18 } },
          '位置由地图上的钉决定：拖动钉即可改 x/y（0~1 归一化）。当前 x=' +
          Number(form.x || 0).toFixed(3) + ' · y=' + Number(form.y || 0).toFixed(3)),
      ),
      h(Field, { label: '描述', hint: '地图/详情里看到的一句话（≤80 字）' },
        h(TextArea, { rows: 2, value: form.desc || '', placeholder: '这是个什么地方', onChange: (v) => setField('desc', String(v || '').slice(0, 80)) })),
      h(Field, { label: '她的感受', hint: '她对这个地方的感觉，会参与生活模拟（≤80 字）' },
        h(TextArea, { rows: 2, value: form.feel || '', placeholder: '在这里她会觉得……', onChange: (v) => setField('feel', String(v || '').slice(0, 80)) })),
      h(Divider, {}),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, '内部场景（2D）'),
        h(Note, {}, '「进入内部」时看到的画面。背景图上传后先存在 /models/ 下，点「保存到草稿」→ 再「保存」才会写进地图数据。'),
      ),
      h(MapSceneEditor, {
        scene: form.scene,
        placeName: form.name,
        onChange: (sc) => setField('scene', sc),
      }),
    ),
  )
}

// ── 旅行（跨城买票：/api/travel/options + /api/travel/ticket）──────────
function MapTravelModal(props) {
  const p = props || {}
  const opts = useApi('/api/travel/options')
  const [busy, setBusy] = React.useState('')
  const [err, setErr] = React.useState('')
  const d = opts.data || {}
  const from = d.from || {}
  const wallet = d.wallet || {}
  const options = Array.isArray(d.options) ? d.options : []

  const fmtDepart = (ms) => {
    const n = Number(ms) || 0
    if (!n) return ''
    try { return new Date(n).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' }
  }

  const buy = async (option, mode) => {
    if (busy) return
    const modeLabel = String(mode.label || mode.mode || '')
    const fare = Number(mode.fare) || 0
    const yes = await confirmDialog('买「' + modeLabel + '」去「' + String(option.name || '') + '」的票？', {
      detail: '票价 ' + (fare ? fare + ' 块' : '免费') + ' · 约 ' + (mode.minutes === undefined ? '?' : mode.minutes) + ' 分钟' +
        (mode.waitMinutes ? ' · 还要等 ' + mode.waitMinutes + ' 分钟' : '') +
        (mode.delayMinutes ? ' · 晚点 ' + mode.delayMinutes + ' 分钟' : ''),
      okText: '买票',
    })
    if (!yes) return
    setBusy(String(option.id) + ':' + String(mode.mode))
    setErr('')
    try {
      const r = await Api.post('/api/travel/ticket', {
        mapId: option.id,
        mode: mode.mode,
        waitMinutes: Number(mode.waitMinutes) || 0,
        delayMinutes: Number(mode.delayMinutes) || 0,
      })
      const res = mapResultOf(r)
      if (!res.ok) {
        setErr(res.reason || res.error || '买票失败')
        toast(res.reason || res.error || '买票失败', 'error')
        return
      }
      toast('票买好了，她出发去「' + String(option.name || '') + '」', 'ok')
      if (p.onDone) p.onDone()
    } catch (e) {
      setErr((e && e.message) || '买票失败')
    } finally {
      setBusy('')
    }
  }

  return h(Modal, {
    open: true,
    title: '🚉 旅行 · 跨城买票',
    onClose: p.onClose,
    width: 640,
    footer: h(Row, { gap: 8, justify: 'flex-end' }, h(Btn, { onClick: p.onClose }, '关闭')),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      opts.error && !opts.data
        ? h(ErrorBox, { title: '旅行选项读取失败', error: opts.error, onRetry: opts.reload })
        : null,
      opts.loading && !opts.data ? h(Loading, { text: '正在查班次…' }) : null,
      opts.data
        ? h('div', { style: { fontSize: 12, color: T.text2, lineHeight: 1.7 } },
            '从「' + String(from.name || '当前地图') + '」出发 · 她的余额 ' + fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 块 · 买票后她会自己坐车过去，到站跟你说。')
        : null,
      err ? h(ErrorBox, { title: '买票失败', error: err, onRetry: () => setErr('') }) : null,
      options.length
        ? options.map((option) => h(Card, {
            key: String(option.id),
            title: String(option.name || option.id),
            sub: '约 ' + String(option.km === undefined ? '?' : option.km) + ' km',
            tag: '目的地',
          },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              (Array.isArray(option.modes) ? option.modes : []).map((mode) => h('button', {
                key: String(mode.mode),
                type: 'button',
                disabled: !!busy || mode.canAfford === false,
                title: mode.canAfford === false ? '余额不够' : ('买「' + String(mode.label || '') + '」票'),
                onClick: () => buy(option, mode),
                className: 'sbc-btn',
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  border: '1px solid ' + (mode.canAfford === false ? T.border : T.border2),
                  borderRadius: 9, background: 'rgba(127,127,127,.06)',
                  color: T.text, padding: '7px 10px', cursor: (busy || mode.canAfford === false) ? 'default' : 'pointer',
                  opacity: (busy || mode.canAfford === false) ? 0.55 : 1,
                  fontFamily: T.font, fontSize: 12.5,
                },
              },
                h('span', { style: { fontSize: 15 } }, String(mode.icon || '🚌')),
                h('span', { style: { fontWeight: 600, flexShrink: 0 } }, String(mode.label || mode.mode || '')),
                h('span', { style: { color: T.text2, flexShrink: 0 } }, (mode.minutes === undefined ? '?' : mode.minutes) + ' 分钟'),
                h('span', { style: { color: mode.fare ? T.warn : T.ok, flexShrink: 0 } }, mode.fare ? (mode.fare + ' 块') : '免费'),
                h('span', { style: { flex: 1, minWidth: 0, color: T.text3, fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  (mode.canAfford === false ? '余额不够 · ' : '') +
                  (mode.waitMinutes ? '等 ' + mode.waitMinutes + ' 分钟 · ' : '') +
                  (mode.delayMinutes ? '晚点 ' + mode.delayMinutes + ' 分钟 · ' : '') +
                  (mode.nextDeparture ? fmtDepart(mode.nextDeparture) + ' 发车' : '')),
                h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy || mode.canAfford === false }, busy === String(option.id) + ':' + String(mode.mode) ? '买票中…' : '买票'),
              )),
            ),
          ))
        : (opts.data ? h(Empty, { icon: '🚉' }, '没有别的城市可以去（当前只有一张地图）。') : null),
    ),
  )
}

// ── 她的时段习惯（权重）：旧 map.html「她的时段习惯」搬进原生面板 ─────────
// 数据：GET /api/routine → { routine:{ bands:[{start,end,allowed,weights}], smart }, visits, places, character }
// 保存：POST /api/routine { bands, smart } —— 只发这两个字段；权重 0~100，0=不去（服务端也会 clamp/排序/丢 0）

// 小时数 → "08:30"（24 显示成 24:00，方便表达"到当天结束"）
function mapFmtHour(v) {
  const n = clampNum(v, 0, 24, 0)
  const hh = Math.floor(n)
  const mm = Math.round((n - hh) * 60)
  const h2 = mm >= 60 ? Math.min(24, hh + 1) : hh
  const m2 = mm >= 60 ? 0 : mm
  return (h2 < 10 ? '0' : '') + h2 + ':' + (m2 < 10 ? '0' : '') + m2
}

// 时段是否覆盖当前小时（start > end 表示跨夜：22:00 → 06:00）
function mapBandActive(band, hour) {
  if (!band) return false
  const s = clampNum(band.start, 0, 24, 0)
  const e = clampNum(band.end, 0, 24, 24)
  const h = clampNum(hour, 0, 24, 0)
  return s <= e ? (h >= s && h < e) : (h >= s || h < e)
}

// 提交给服务端的形状：{ bands, smart }，并在前端按同样的规则 clamp 一次
function mapRoutinePayload(draft) {
  const src = draft || {}
  const bands = (Array.isArray(src.bands) ? src.bands : []).slice(0, 16).map((band) => {
    const b = band || {}
    const weights = {}
    const w = b.weights || {}
    Object.keys(w).forEach((pid) => {
      const v = Math.round(clampNum(w[pid], 0, 100, 0))
      if (v > 0) weights[String(pid)] = v
    })
    return {
      start: clampNum(b.start, 0, 24, 0),
      end: clampNum(b.end, 0, 24, 24),
      allowed: b.allowed !== false,
      weights,
    }
  })
  return { smart: src.smart === true, bands }
}

function MapRoutineCard(props) {
  const p = props || {}
  const routineApi = useApi('/api/routine')
  const [draft, setDraft] = React.useState(null)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [saveInfo, setSaveInfo] = React.useState('')
  const [openIdx, setOpenIdx] = React.useState(-1)
  const [expandAll, setExpandAll] = React.useState(false)
  const [, setMinuteTick] = React.useState(0)
  const lastMapRef = React.useRef('')

  const data = routineApi.data
  const places = data && Array.isArray(data.places) ? data.places : []
  const visits = (data && data.visits) || {}
  const readFailed = !!routineApi.error
  const bands = draft && Array.isArray(draft.bands) ? draft.bands : []
  const smart = !!(draft && draft.smart)
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60

  // 当前时段高亮；每分钟重算一次（页面隐藏时 useInterval 会自己暂停）
  useInterval(() => setMinuteTick((v) => v + 1), 60000)

  // 读到数据 → 草稿（只在接口数据变化时重置；默认展开"此刻"在用的那个时段）
  React.useEffect(() => {
    if (!data) return
    const r = (data && data.routine) || {}
    const list = Array.isArray(r.bands) ? r.bands : []
    setDraft(mapCloneJson({ smart: r.smart === true, bands: list }))
    setDirty(false)
    setSaveError('')
    const hour = new Date().getHours() + new Date().getMinutes() / 60
    let activeIdx = -1
    for (let i = 0; i < list.length; i++) { if (mapBandActive(list[i], hour)) { activeIdx = i; break } }
    setOpenIdx(activeIdx)
  }, [data])

  // 她换城市后 places 变了：重新读一次；有未保存修改时不覆盖，只提示
  React.useEffect(() => {
    const id = String(p.mapId || '')
    if (!id) return
    if (!lastMapRef.current) { lastMapRef.current = id; return }
    if (lastMapRef.current === id) return
    lastMapRef.current = id
    if (dirty) { setSaveInfo('地图切到别的城市了：习惯数据没有自动刷新（先保存或刷新，再按新地图的地点改权重）'); return }
    routineApi.reload()
  }, [p.mapId])

  const markDirty = () => { setDirty(true); setSaveInfo('') }

  const updateBand = (idx, patch) => {
    setDraft((d) => {
      const base = d || { smart: false, bands: [] }
      const list = (Array.isArray(base.bands) ? base.bands : []).map((b, i) => (i === idx ? Object.assign({}, b, patch) : b))
      return Object.assign({}, base, { bands: list })
    })
    markDirty()
  }

  const setBandWeight = (idx, placeId, value) => {
    const v = Math.round(clampNum(value, 0, 100, 0))
    setDraft((d) => {
      const base = d || { smart: false, bands: [] }
      const list = (Array.isArray(base.bands) ? base.bands : []).map((b, i) => {
        if (i !== idx) return b
        const weights = Object.assign({}, b.weights || {})
        if (v > 0) weights[String(placeId)] = v
        else delete weights[String(placeId)]
        return Object.assign({}, b, { weights })
      })
      return Object.assign({}, base, { bands: list })
    })
    markDirty()
  }

  const addBand = () => {
    if (bands.length >= 16) { toast('最多 16 个时段，先删掉一些再添加', 'error'); return }
    setDraft((d) => {
      const base = d || { smart: false, bands: [] }
      const list = Array.isArray(base.bands) ? base.bands : []
      return Object.assign({}, base, { bands: list.concat([{ start: 0, end: 24, allowed: true, weights: {} }]) })
    })
    setOpenIdx(bands.length)
    markDirty()
  }

  const delBand = (idx) => {
    if (bands.length <= 1) { toast('至少保留一个时段', 'error'); return }
    setDraft((d) => {
      const base = d || { smart: false, bands: [] }
      const list = Array.isArray(base.bands) ? base.bands : []
      return Object.assign({}, base, { bands: list.filter((b, i) => i !== idx) })
    })
    setOpenIdx(-1)
    markDirty()
  }

  const refresh = async () => {
    if (dirty) {
      const yes = await confirmDialog('有还没保存的权重修改，刷新会丢掉，继续吗？', { danger: true, okText: '刷新' })
      if (!yes) return
    }
    setSaveError('')
    setSaveInfo('')
    routineApi.reload()
  }

  const saveRoutine = async () => {
    if (!draft || saving) return
    if (readFailed) { setSaveError('习惯数据读取失败，禁止保存（先点「刷新」重试读取）'); return }
    setSaving(true)
    setSaveError('')
    setSaveInfo('')
    try {
      const payload = mapRoutinePayload(draft)
      const r = await Api.post('/api/routine', payload)
      if (!r.ok) { setSaveError(r.error || '保存失败'); toast('保存失败：' + (r.error || ''), 'error'); return }
      const d = r.data || {}
      if (d.ok === false) { setSaveError(d.error || '保存失败'); return }
      const saved = d.routine || null
      if (saved) { setDraft(mapCloneJson({ smart: saved.smart === true, bands: saved.bands || [] })); setDirty(false) }
      setSaveInfo('已保存：' + payload.bands.length + ' 个时段' + (payload.smart ? '（智能权重开）' : ''))
      toast('习惯已保存', 'ok')
      routineApi.reload()
    } catch (e) {
      setSaveError((e && e.message) || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleBand = (idx) => {
    if (expandAll) { setExpandAll(false); setOpenIdx(idx); return }
    setOpenIdx(openIdx === idx ? -1 : idx)
  }

  const weightPreview = (band) => {
    const w = (band && band.weights) || {}
    const items = Object.keys(w)
      .map((pid) => ({ id: pid, v: Math.round(Number(w[pid]) || 0) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => {
        const place = places.find((pp) => String(pp.id) === x.id)
        return (place ? String(place.icon || '') + String(place.name || '') : x.id) + ' ' + x.v
      })
    return items.length ? items.join('、') : '还没设权重'
  }

  const visitText = () => {
    const list = Object.keys(visits || {})
      .map((id) => {
        const v = visits[id] || {}
        const place = places.find((pp) => String(pp.id) === String(id))
        return { name: place ? String(place.icon || '') + String(place.name || '') : String(id), count: Math.max(0, Number(v.count) || 0), lastAt: Number(v.lastAt) || 0 }
      })
      .filter((x) => x.count > 0)
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, 4)
    return list.length ? ('她最近去过：' + list.map((x) => x.name + '×' + x.count).join('、')) : '她还没怎么出过门'
  }

  const cardActions = h(Row, { gap: 4 },
    h(Btn, { size: 'sm', disabled: !draft, onClick: () => setExpandAll((v) => !v) }, expandAll ? '全部收起' : '全部展开'),
    h(Btn, { size: 'sm', disabled: routineApi.loading || saving, onClick: refresh }, routineApi.loading ? '读取中…' : '刷新'),
  )

  return h(Card, { title: '她的时段习惯', tag: '权重', actions: cardActions },
    !data
      ? (routineApi.loading
        ? h(Loading, { text: '习惯读取中…' })
        : h(ErrorBox, { title: '习惯读取失败', error: routineApi.error || '没有拿到习惯数据', onRetry: () => routineApi.reload() }))
      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 7 } },
          readFailed ? h(ErrorBox, { title: '读出错了（已禁止保存）', error: routineApi.error, onRetry: () => routineApi.reload() }) : null,
          h(Toggle, {
            checked: smart,
            onChange: (v) => {
              setDraft((d) => Object.assign({}, d || { bands: [] }, { smart: !!v }))
              markDirty()
            },
            label: '智能权重',
          }),
          h(Note, {}, '开启后：随记忆 / 天气 / 体力 / 最近习惯自动微调；关闭就完全按下面每个时段的权重来。'),
          h('div', { style: { fontSize: 10.5, color: T.text3, lineHeight: 1.6 } }, visitText()),
          h(Note, {}, '每个时段她想待在哪：数字是权重（0=不去，越大越常去）；当前时段会高亮。'),
          bands.length
            ? bands.map((band, i) => {
                const active = mapBandActive(band, nowHour)
                const isOpen = expandAll || openIdx === i
                const weights = (band && band.weights) || {}
                const crossNight = clampNum(band.start, 0, 24, 0) > clampNum(band.end, 0, 24, 24)
                return h('div', {
                  key: 'routine-band-' + i,
                  style: {
                    border: '1px solid ' + (active ? T.brand : T.border),
                    background: active ? 'rgba(47,107,216,.08)' : 'rgba(127,127,127,.04)',
                    borderRadius: 9, padding: '5px 7px',
                    display: 'flex', flexDirection: 'column', gap: 5,
                  },
                },
                  h('button', {
                    type: 'button',
                    className: 'sbc-btn',
                    onClick: () => toggleBand(i),
                    title: '展开/收起这个时段的权重',
                    style: {
                      display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                      border: 'none', background: 'transparent', padding: 0,
                      cursor: 'pointer', color: T.text, fontFamily: T.font, textAlign: 'left',
                    },
                  },
                    h(Dot, { on: active, tone: active ? T.ok : T.idle, size: 6 }),
                    h('span', { style: { fontSize: 11.5, fontWeight: 600, color: active ? T.text : T.text2, whiteSpace: 'nowrap' } },
                      mapFmtHour(band.start) + '–' + mapFmtHour(band.end)),
                    crossNight ? h('span', { style: { fontSize: 9, color: T.warn, whiteSpace: 'nowrap' } }, '跨夜') : null,
                    h('span', { style: { fontSize: 9.5, color: band.allowed === false ? T.text3 : T.ok, border: '1px solid ' + T.border, borderRadius: 999, padding: '0 4px', whiteSpace: 'nowrap' } },
                      band.allowed === false ? '不出门' : '出门逛'),
                    h('span', { style: { flex: 1, minWidth: 0, fontSize: 9.5, color: T.text3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, weightPreview(band)),
                    h('span', { style: { fontSize: 9.5, color: T.text3, flexShrink: 0 } }, isOpen ? '收起' : '展开'),
                  ),
                  isOpen
                    ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
                        h(Row, { gap: 4, style: { alignItems: 'center' } },
                          h('span', { style: { fontSize: 10.5, color: T.text3, flexShrink: 0 } }, '从'),
                          h(NumInput, { value: band.start, min: 0, max: 24, step: 0.5, width: 54, onChange: (v) => updateBand(i, { start: clampNum(v, 0, 24, 0) }) }),
                          h('span', { style: { fontSize: 10.5, color: T.text3, flexShrink: 0 } }, '点到'),
                          h(NumInput, { value: band.end, min: 0, max: 24, step: 0.5, width: 54, onChange: (v) => updateBand(i, { end: clampNum(v, 0, 24, 24) }) }),
                        ),
                        h(Row, { gap: 6, style: { alignItems: 'center' } },
                          h(Toggle, { checked: band.allowed !== false, onChange: (v) => updateBand(i, { allowed: !!v }), label: '允许出门逛' }),
                          h('span', { style: { flex: 1 } }),
                          h(Btn, { size: 'sm', kind: 'danger', onClick: () => delBand(i) }, '删除时段'),
                        ),
                        places.length
                          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                              places.map((place) => {
                                const raw = weights[place.id] !== undefined ? weights[place.id] : weights[String(place.id)]
                                const wv = Math.round(clampNum(raw, 0, 100, 0))
                                return h('label', {
                                  key: 'routine-w-' + i + '-' + String(place.id),
                                  title: String(place.icon || '') + ' ' + String(place.name || '') + '：权重 0~100（0=不去）',
                                  style: {
                                    display: 'flex', alignItems: 'center', gap: 2,
                                    border: '1px solid ' + T.border, borderRadius: 7,
                                    padding: '1px 3px', background: 'rgba(127,127,127,.05)', maxWidth: '100%',
                                  },
                                },
                                  h('span', { style: { fontSize: 11, flexShrink: 0 } }, place.icon || '📍'),
                                  h('span', { style: { fontSize: 9.5, color: T.text2, flexShrink: 0, maxWidth: 36, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(place.name || '')),
                                  h(NumInput, { value: wv, min: 0, max: 100, step: 1, width: 40, onChange: (v) => setBandWeight(i, place.id, v) }),
                                )
                              }),
                            )
                          : h(Note, {}, '这张地图还没有地点，暂时没有可设权重的目标。'),
                      )
                    : null,
                )
              })
            : h(Empty, { icon: '🕐', style: { padding: '10px 4px' } }, '还没有时段，点「+ 添加时段」加一个。'),
          h(Row, { gap: 6, style: { marginTop: 1 } },
            h(Btn, { size: 'sm', onClick: addBand, title: bands.length >= 16 ? '最多 16 个时段' : '加一个时段（默认 0-24 都允许出门）' }, '+ 添加时段'),
            h('span', { style: { flex: 1 } }),
            h(Btn, {
              size: 'sm',
              kind: 'primary',
              disabled: saving || readFailed || !draft || !dirty,
              title: readFailed ? '习惯读取失败，禁止保存' : (!dirty ? '没有改动' : '把全部时段和智能权重写到服务端'),
              onClick: saveRoutine,
            }, saving ? '保存中…' : '保存习惯'),
          ),
          saveError ? h(ErrorBox, { title: '保存失败', error: saveError, onRetry: saving ? undefined : saveRoutine }) : null,
          saveInfo ? h('div', { style: { fontSize: 10.5, color: T.ok, lineHeight: 1.5 } }, saveInfo) : null,
        ),
  )
}

// ── 主视图：地图查看 + 基础编辑（D04 B）────────────────────────────────
function MapView(props) {
  const p = props || {}
  const mapApi = useApi('/api/map')
  const worldApi = useApi('/api/world/characters', { refreshMs: 5000 })
  const data = mapApi.data
  const map = (data && data.map) || {}
  const maps = (data && Array.isArray(data.maps)) ? data.maps : []
  const serverPlaces = Array.isArray(map.places) ? map.places : []
  const characters = (worldApi.data && Array.isArray(worldApi.data.characters)) ? worldApi.data.characters : []
  const location = (data && data.location) || {}
  const activeMapId = data ? String(data.activeMapId || '') : ''

  const [selMapId, setSelMapId] = React.useState('')
  const [editMode, setEditMode] = React.useState(false)
  const [editMapId, setEditMapId] = React.useState('')
  const [draftPlaces, setDraftPlaces] = React.useState(null)
  const [dirty, setDirty] = React.useState(false)
  const [baseRev, setBaseRev] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [saveInfo, setSaveInfo] = React.useState('')
  const [busyPlaceId, setBusyPlaceId] = React.useState('')
  const [mapBusy, setMapBusy] = React.useState('')
  const [actionError, setActionError] = React.useState('')
  const [viewPlace, setViewPlace] = React.useState(null)
  const [editingPlace, setEditingPlace] = React.useState(null)
  const [travelOpen, setTravelOpen] = React.useState(false)
  const imageInputRef = React.useRef(null)

  const mapSelectValue = selMapId || activeMapId
  const places = editMode && Array.isArray(draftPlaces) ? draftPlaces : serverPlaces
  const readFailed = !!mapApi.error
  const canSave = editMode && !!draftPlaces && dirty && !saving && !readFailed && !!data

  React.useEffect(() => {
    if (activeMapId) setSelMapId(activeMapId)
  }, [activeMapId])

  // 跨城到达 / 别的页面切了地图：编辑中的草稿属于旧地图，直接退出，避免覆盖新地图
  React.useEffect(() => {
    if (!editMode) return
    const id = data && data.map ? String(data.map.id || '') : ''
    if (id && editMapId && id !== editMapId) {
      setEditMode(false)
      setEditMapId('')
      setDraftPlaces(null)
      setDirty(false)
      setSaveError('')
      setSaveInfo('')
      toast('地图已经切换，编辑模式已退出', 'error')
    }
  }, [editMode, editMapId, data])

  // 非编辑状态低频刷新（旅行到达 / 天气 / 精力）；编辑中不自动刷新，避免冲掉草稿
  useInterval(() => { mapApi.reload() }, 15000, !editMode)

  const readRev = async () => {
    const rev = await mapReadBaseRev()
    setBaseRev(rev)
    return rev
  }

  const startEdit = async () => {
    if (!data || !data.map) { toast('地图还没读出来，先刷新', 'error'); return }
    if (readFailed) { toast('地图数据读取失败，修好读取再编辑（读失败禁止保存）', 'error'); return }
    setDraftPlaces(mapCloneJson(serverPlaces))
    setEditMapId(String(data.map.id))
    setEditMode(true)
    setDirty(false)
    setSaveError('')
    setSaveInfo('')
    setActionError('')
    await readRev()
  }

  const cancelEdit = async () => {
    if (dirty) {
      const yes = await confirmDialog('放弃这次未保存的地图修改？', { detail: '没保存的改动会丢掉（服务端数据没动过）。', danger: true, okText: '放弃' })
      if (!yes) return
    }
    setEditMode(false)
    setEditMapId('')
    setDraftPlaces(null)
    setDirty(false)
    setSaveError('')
    setSaveInfo('')
    setEditingPlace(null)
    mapApi.reload()
  }

  const toggleEdit = async () => {
    if (editMode) { await cancelEdit(); return }
    await startEdit()
  }

  const movePlace = (placeId, x, y) => {
    setDraftPlaces((prev) => {
      const list = Array.isArray(prev) ? prev : mapCloneJson(serverPlaces)
      return list.map((it) => (String(it.id) === String(placeId)
        ? Object.assign({}, it, { x: clampNum(x, 0.05, 0.95), y: clampNum(y, 0.08, 0.92) })
        : it))
    })
    setDirty(true)
  }

  // 从查看/列表进入某个地点的编辑：必要时自动进编辑模式
  const startEditPlace = async (place) => {
    if (!place) return
    if (readFailed) { toast('地图数据读取失败，修好读取再编辑（读失败禁止保存）', 'error'); return }
    let list = editMode && Array.isArray(draftPlaces) ? draftPlaces : null
    if (!list) {
      list = mapCloneJson(serverPlaces)
      setDraftPlaces(list)
      setEditMapId(String((data && data.map && data.map.id) || ''))
      setEditMode(true)
      setDirty(false)
      setSaveError('')
      setSaveInfo('')
      readRev()
    }
    const cur = list.find((it) => String(it.id) === String(place.id)) || place
    setEditingPlace(mapCloneJson(cur))
    setViewPlace(null)
  }

  const commitPlace = (next) => {
    if (!next) return
    setDraftPlaces((prev) => {
      const list = Array.isArray(prev) ? prev : mapCloneJson(serverPlaces)
      return list.map((it) => (String(it.id) === String(next.id) ? next : it))
    })
    setDirty(true)
    setEditingPlace(null)
    setSaveInfo('')
    toast('已更新到草稿，点「保存」写入服务端')
  }

  const saveDraft = async () => {
    if (!data || !data.map || !draftPlaces || saving) return
    if (readFailed) { setSaveError('地图数据读取失败，禁止保存（先点「刷新」重试读取）'); return }
    setSaving(true)
    setSaveError('')
    setSaveInfo('')
    try {
      const sent = mapCloneJson(draftPlaces)
      const body = { mapId: String(data.map.id), places: sent }
      if (baseRev !== null && baseRev !== undefined) body.expectedRev = baseRev
      const r = await Api.post('/api/map', body)
      if (!r.ok) {
        let msg = r.error || '保存失败'
        if (r.status === 409) msg = msg + '（本次没有覆盖任何东西；点「重新读取地图」后再改）'
        setSaveError(msg)
        toast(msg, 'error')
        return
      }
      const d = r.data || {}
      if (d.ok === false) { setSaveError(d.error || '保存失败'); return }
      // 回读验证：真的落盘了吗？旧字段还在吗？（「刷新不丢」的自检）
      const back = await Api.get('/api/map')
      if (!back.ok) {
        setSaveError('已提交，但回读失败：' + (back.error || '') + '（点「重新读取地图」确认）')
        return
      }
      const fresh = back.data || {}
      if (!fresh.map || String(fresh.map.id) !== String(body.mapId)) {
        setSaveError('回读到的不是同一张地图，先不要继续编辑，点「重新读取地图」')
        return
      }
      const problems = mapPlacesDiff(sent, fresh.map.places)
      mapApi.setData(fresh)
      setDraftPlaces(mapCloneJson(fresh.map.places || []))
      setDirty(false)
      if (problems.length) {
        setSaveError('保存后回读不一致（服务端可能规范化了字段）：' + problems.join('；'))
        toast('保存后回读不一致，请看提示', 'error')
        return
      }
      setSaveInfo('已保存，回读确认 ' + ((fresh.map.places || []).length) + ' 个地点（刷新不会丢）')
      toast('地图已保存', 'ok')
      await readRev()
    } catch (e) {
      setSaveError((e && e.message) || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reloadMap = async () => {
    setSaveError('')
    setSaveInfo('')
    mapApi.reload()
    worldApi.reload()
    await readRev()
  }

  // 同图移动：/api/location（不是瞬移，会按出行方式走；夜里/没钱会被拒绝）
  const goPlace = async (place) => {
    if (!place || busyPlaceId) return false
    if (location.state === 'stationary' && String(location.placeId) === String(place.id)) {
      setViewPlace(null)
      toast('她已经在这儿了')
      return true
    }
    setBusyPlaceId(String(place.id))
    setActionError('')
    try {
      let r = await Api.post('/api/location', { placeId: String(place.id) })
      let res = mapResultOf(r)
      if (!res.ok && res.refused && res.needsConfirm) {
        const yes = await confirmDialog(res.reason || '她有点犹豫，确定让她去吗？', { detail: '确定就让她去，她会跟你报备。', okText: '让她去' })
        if (!yes) return false
        r = await Api.post('/api/location', { placeId: String(place.id), confirmNight: true })
        res = mapResultOf(r)
      }
      if (!res.ok) {
        const msg = res.reason || res.error || '出行失败'
        setActionError(msg)
        toast(msg, 'error')
        return false
      }
      setViewPlace(null)
      toast('她出门了：前往「' + String(place.name || '') + '」', 'ok')
      mapApi.reload()
      worldApi.reload()
      return true
    } catch (e) {
      const msg = (e && e.message) || '出行失败'
      setActionError(msg)
      toast(msg, 'error')
      return false
    } finally {
      setBusyPlaceId('')
    }
  }

  // 切地图 = 跨城旅行（/api/map/activate；可能被拒绝/需要确认）
  const switchMap = async (nextId) => {
    const id = String(nextId || '')
    setSelMapId(id)
    const back = () => setSelMapId(activeMapId)
    if (!data || !id || id === activeMapId) { back(); return }
    if (mapBusy) { back(); return }
    if (editMode) {
      toast('先退出编辑模式再切地图', 'error')
      back()
      return
    }
    const target = maps.find((m) => String(m.id) === id) || {}
    const yes = await confirmDialog('让她去「' + String(target.name || id) + '」？', {
      detail: '这是跨城移动：要买票/等车，路上要几分钟，到了会自动切到那张地图。只想看看别的地图可以点「取消」。',
      okText: '出发',
    })
    if (!yes) { back(); return }
    setMapBusy('switch')
    setActionError('')
    try {
      let r = await Api.post('/api/map/activate', { id })
      let res = mapResultOf(r)
      if (!res.ok && res.refused && res.needsConfirm) {
        const again = await confirmDialog(res.reason || '她有点犹豫，确定让她去吗？', { okText: '让她去' })
        if (!again) { back(); return }
        r = await Api.post('/api/map/activate', { id, confirmNight: true })
        res = mapResultOf(r)
      }
      if (!res.ok) {
        const msg = res.reason || res.error || '切换地图失败'
        setActionError(msg)
        toast(msg, 'error')
        back()
        return
      }
      toast('票买好了，她出发去「' + String(target.name || id) + '」了', 'ok')
      // 跨城是"在路上"，地图要等她到了服务端才切；先保留下拉显示当前地图
      back()
      mapApi.reload()
    } catch (e) {
      const msg = (e && e.message) || '切换地图失败'
      setActionError(msg)
      toast(msg, 'error')
      back()
    } finally {
      setMapBusy('')
    }
  }

  const newMap = async () => {
    if (mapBusy || saving) return
    if (editMode) { toast('先退出编辑模式再新建地图', 'error'); return }
    const name = await promptDialog('新地图叫什么？', { title: '新建地图', detail: '新地图会带一套默认地点和 2D 底图。', placeholder: '例如：安溪镇' })
    if (!name || !String(name).trim()) return
    const nm = String(name).trim().slice(0, 20)
    setMapBusy('create')
    try {
      const r = await Api.post('/api/map/create', { name: nm })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '创建失败', 'error'); return }
      toast('已创建「' + nm + '」', 'ok')
      await reloadMap()
      if (d.id) {
        const go = await confirmDialog('现在让她搬去「' + nm + '」吗？', { detail: '不搬也可以，之后在地图下拉里随时能切。', okText: '现在过去' })
        if (go) {
          const r2 = await Api.post('/api/map/activate', { id: d.id, instant: true })
          const res2 = mapResultOf(r2)
          if (!res2.ok) toast(res2.reason || res2.error || '切换失败', 'error')
          await reloadMap()
        }
      }
    } catch (e) {
      toast((e && e.message) || '创建失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const delMap = async () => {
    if (mapBusy || saving || !data || !data.map) return
    if (maps.length <= 1) { toast('至少保留一张地图', 'error'); return }
    if (editMode) { toast('先退出编辑模式再删地图', 'error'); return }
    const yes = await confirmDialog('删除「' + String(data.map.name || '') + '」这张地图？', {
      detail: '地图和地点会一起删掉，不能撤销；至少会保留一张地图。',
      danger: true,
      okText: '删除',
    })
    if (!yes) return
    setMapBusy('delete')
    try {
      const r = await Api.post('/api/map/delete', { id: data.map.id })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '删除失败', 'error'); return }
      toast('已删除这张地图', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '删除失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const renameMap = async () => {
    if (mapBusy || saving || !data || !data.map) return
    const name = await promptDialog('地图叫什么？', { title: '改地图名', value: String(data.map.name || ''), placeholder: '最多 20 字' })
    if (!name || !String(name).trim()) return
    setMapBusy('rename')
    try {
      const r = await Api.post('/api/map', { mapId: data.map.id, name: String(name).trim().slice(0, 20) })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '改名失败', 'error'); return }
      toast('已改名', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '改名失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const uploadMapImage = async (file) => {
    if (!file || !data || !data.map || mapBusy) return
    setMapBusy('image')
    setActionError('')
    try {
      const read = await Api.readFileAsDataUrl(file, 8 * 1024 * 1024)
      if (!read.ok) { toast(read.error || '读取图片失败', 'error'); return }
      const r = await Api.upload('/api/map/image', { mapId: data.map.id, dataUrl: read.dataUrl })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '上传失败', 'error'); return }
      toast('底图已上传', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '上传失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const clearMapImage = async () => {
    if (!data || !data.map || mapBusy) return
    const yes = await confirmDialog('清除这张地图的 2D 底图？', { detail: '只清底图，地点和坐标都会保留。', danger: true, okText: '清除' })
    if (!yes) return
    setMapBusy('image')
    try {
      const r = await Api.upload('/api/map/image', { mapId: data.map.id, dataUrl: '' })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '清除失败', 'error'); return }
      toast('底图已清除', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '清除失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const peopleOf = (placeId) => characters.filter((c) => c && c.sameMap && String(c.placeId) === String(placeId) && c.state === 'stationary')

  const rootStyle = {
    flex: 1, minHeight: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
    background: T.bg, color: T.text, fontFamily: T.font, fontSize: 13,
    padding: 10, gap: 8, boxSizing: 'border-box',
  }

  if (!data) {
    return h('div', { style: rootStyle },
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 16 } },
        mapApi.loading
          ? h(Loading, { text: '地图加载中…' })
          : h(ErrorBox, { title: '地图加载失败', error: mapApi.error || '没有拿到地图数据', onRetry: () => { mapApi.reload(); worldApi.reload() } }),
      ),
    )
  }

  const locationText = location.state === 'intercity' && location.intercity
    ? ('她正在跨城：' + String(location.intercity.fromMapName || '这里') + ' → ' + String(location.intercity.toMapName || '目的地') +
      ' · ' + String(location.intercity.modeIcon || '') + String(location.intercity.modeLabel || '') +
      ' · 约 ' + Math.max(1, Math.ceil((Number(location.intercity.etaSec) || 0) / 60)) + ' 分钟')
    : location.state === 'traveling' && location.traveling
      ? ('她在路上：' + String(location.traveling.fromName || '') + ' → ' + String(location.traveling.toName || '') +
        ' · ' + String(location.traveling.modeIcon || '') + String(location.traveling.modeLabel || '') +
        ' · 约 ' + Math.max(1, Math.ceil((Number(location.traveling.etaSec) || 0) / 60)) + ' 分钟')
      : ('她在「' + String(location.name || location.placeName || '不知道在哪') + '」' +
        (Number(location.minutes) > 0 ? '（已待 ' + Number(location.minutes) + ' 分钟）' : '') +
        ' · 这张地图：' + String(map.name || '') + '（' + serverPlaces.length + ' 个地点）')

  const currentIntercity = location.state === 'intercity' && location.intercity ? location.intercity : null
  const currentTraveling = location.state === 'traveling' && location.traveling ? location.traveling : null
  const journeyProgress = currentIntercity
    ? stageTravelProgress(currentIntercity)
    : (currentTraveling ? stageTravelProgress(currentTraveling) : 0)

  return h('div', { style: rootStyle },
    // 顶部工具条：地图切换 / 状态 / 编辑 / 旅行 / 刷新
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 } },
      h('span', { style: { width: 210, flexShrink: 0 } }, h(Select, {
        value: mapSelectValue,
        disabled: !!mapBusy || editMode,
        title: editMode ? '先退出编辑模式再切地图' : '切换地图（跨城会真的移动她）',
        options: maps.map((m) => ({ value: String(m.id), label: String(m.name || m.id) + '（' + (m.placeCount || 0) + ' 个地点）' })),
        onChange: switchMap,
      })),
      h(Badge, { tone: map.has2d ? 'ok' : 'warn', title: '这张地图有没有 2D 底图' }, map.has2d ? '2D 底图' : '没有 2D 底图'),
      map.has3d ? h(Badge, { title: '这张地图有 3D 资源；本版客户端只做 2D（D03 B / M07）' }, '有 3D 资源 · 本版显示 2D') : null,
      dirty ? h(Badge, { tone: 'warn', title: '有改动还没保存' }, '未保存') : null,
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', disabled: mapApi.loading || !!mapBusy, onClick: () => { reloadMap() } }, mapApi.loading ? '刷新中…' : '刷新'),
      h(Btn, { size: 'sm', kind: editMode ? 'primary' : 'ghost', disabled: !!mapBusy || readFailed, onClick: toggleEdit, title: readFailed ? '地图读取失败，禁止编辑/保存' : '' },
        editMode ? '完成编辑' : '编辑地图'),
      h(Btn, { size: 'sm', disabled: !!mapBusy, onClick: () => setTravelOpen(true) }, '🚉 旅行'),
    ),
    // 编辑工具条
    editMode
      ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: '6px 8px', borderRadius: 10,
            border: '1px solid ' + (dirty ? T.warn : T.border), background: 'rgba(127,127,127,.07)',
          },
        },
          h('span', { style: { fontSize: 11.5, color: T.text2 } },
            dirty ? '有未保存的修改：拖动地点钉 / 编辑地点后点「保存」写到服务端' : '编辑模式：拖动地图上的地点钉改坐标，点地点列表可改名字/内部场景'),
          h('span', { style: { flex: 1 } }),
          h(Btn, {
            size: 'sm', kind: 'primary', disabled: !canSave, onClick: saveDraft,
            title: readFailed ? '地图读取失败，禁止保存' : (dirty ? '保存地点到服务端' : '没有要保存的修改'),
          }, saving ? '保存中…' : '保存'),
          h(Btn, { size: 'sm', disabled: saving, onClick: () => { imageInputRef.current && imageInputRef.current.click() } }, mapBusy === 'image' ? '上传中…' : '上传底图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: clearMapImage }, '清除底图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: newMap }, '新建地图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: renameMap }, '改名'),
          h(Btn, { size: 'sm', kind: 'danger', disabled: saving || !!mapBusy || maps.length <= 1, onClick: delMap }, '删除地图'),
          h(Btn, { size: 'sm', onClick: cancelEdit, disabled: saving }, '退出编辑'),
          h('input', {
            type: 'file', accept: 'image/*', ref: imageInputRef, style: { display: 'none' },
            onChange: (e) => {
              const f = e.target.files && e.target.files[0]
              e.target.value = ''
              if (f) uploadMapImage(f)
            },
          }),
        )
      : null,
    // 读失败 / 保存失败 / 出行失败：都给出可重试的错误态（N03）
    readFailed
      ? h(ErrorBox, { title: '地图读取失败（已禁止保存）', error: mapApi.error || '读不到地图数据', onRetry: () => { mapApi.reload(); worldApi.reload() } })
      : null,
    saveError
      ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 } },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(ErrorBox, { title: '保存失败', error: saveError, onRetry: saving ? undefined : saveDraft })),
          h(Btn, { size: 'sm', onClick: reloadMap }, '重新读取地图'),
        )
      : null,
    actionError
      ? h(Row, { gap: 8, style: { flexShrink: 0 } },
          h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: T.danger, lineHeight: 1.6 } }, actionError),
          h(Btn, { size: 'sm', onClick: () => setActionError('') }, '知道了'),
        )
      : null,
    // 主体：左地图 + 右信息/地点列表
    h('div', { style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', gap: 10 } },
      h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h(MapCanvas, {
          map: map,
          places: places,
          characters: characters,
          location: location,
          editMode: editMode,
          busyPlaceId: busyPlaceId,
          onPlaceClick: (place) => setViewPlace(place),
          onPlaceMove: movePlace,
        }),
        // 底部状态行（位置 / 行程进度 / 保存回读结果）
        h('div', { style: { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 11.5, color: T.text2, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: locationText }, locationText),
          journeyProgress > 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('div', { style: { flex: 1, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
                  h('div', { style: { width: Math.round(journeyProgress * 100) + '%', height: '100%', background: T.brand } })),
                h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap' } }, Math.round(journeyProgress * 100) + '%'),
                h(Btn, { size: 'sm', onClick: () => { mapApi.reload(); worldApi.reload() } }, '刷新进度'),
              )
            : null,
          saveInfo
            ? h('div', { style: { fontSize: 10.5, color: T.ok, lineHeight: 1.5 } }, saveInfo)
            : null,
        ),
      ),
      h('div', {
        className: 'sbc-scroll',
        style: { width: 300, flexShrink: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
      },
        // 当前状态 / 角色位置
        h(Card, {
          title: '当前状态',
          tag: editMode ? '编辑中' : '',
          actions: h(Btn, { size: 'sm', onClick: () => { worldApi.reload(); mapApi.reload() } }, '刷新'),
        },
          h('div', { style: { fontSize: 11.5, color: T.text2, lineHeight: 1.7 } }, locationText),
          currentIntercity || currentTraveling
            ? h(Note, {}, '跨城/赶路要几分钟；到了之后点「刷新」就能看到新地图。')
            : null,
          h(Divider, {}),
          worldApi.error
            ? h(Row, { gap: 8 }, h('span', { style: { flex: 1, minWidth: 0, fontSize: 11, color: T.danger } }, '角色位置读取失败：' + worldApi.error),
                h(Btn, { size: 'sm', onClick: () => worldApi.reload() }, '重试'))
            : (characters.length
              ? characters.map((c) => h(Row, { key: String(c.id), gap: 6, style: { alignItems: 'flex-start' } },
                  h(Avatar, { path: c.avatar, name: c.name, size: 22 }),
                  h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: T.text2, lineHeight: 1.6 } },
                    h('span', { style: { color: c.isActive ? T.text : T.text2, fontWeight: c.isActive ? 600 : 400 } }, String(c.name || '')),
                    h('br'),
                    (c.sameMap ? mapCharStatus(c) : ('在「' + String(c.mapName || '别的城市') + '」' + (c.state === 'intercity' ? ' · 跨城中' : '')))),
                ))
              : h(Note, {}, '没有读到角色位置。')),
        ),
        // 地点列表
        h(Card, {
          title: '地点',
          tag: places.length + ' 个',
          actions: h(Btn, {
            size: 'sm',
            disabled: readFailed,
            title: editMode ? '新增地点（会先创建在中间，再拖动定位）' : '进入编辑模式后可新增地点',
            onClick: () => {
              if (!editMode) { startEdit(); return }
              setDraftPlaces((prev) => {
                const list = Array.isArray(prev) ? prev.slice() : mapCloneJson(serverPlaces)
                list.push({
                  id: 'p-' + Date.now().toString(36),
                  name: '新地点',
                  icon: '📍',
                  x: 0.5,
                  y: 0.5,
                  desc: '',
                  feel: '',
                  image: null,
                  scene: null,
                })
                return list
              })
              setDirty(true)
              toast('已新增「新地点」（草稿），拖动定位后点保存')
            },
          }, editMode ? '+ 新增地点' : '编辑'),
        },
          places.length
            ? places.map((place) => {
                const here = String(location.placeId) === String(place.id) && location.state === 'stationary'
                const count = peopleOf(place.id).length
                return h('button', {
                  key: String(place.id),
                  type: 'button',
                  className: 'sbc-btn',
                  title: editMode ? ('编辑「' + String(place.name || '') + '」') : ('查看「' + String(place.name || '') + '」'),
                  onClick: () => { if (editMode) startEditPlace(place); else setViewPlace(place) },
                  style: {
                    display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                    border: '1px solid ' + (here ? T.brand : T.border),
                    background: here ? 'rgba(47,107,216,.10)' : 'rgba(127,127,127,.05)',
                    borderRadius: 9, padding: '6px 8px', cursor: 'pointer',
                    color: T.text, textAlign: 'left', fontFamily: T.font,
                  },
                },
                  h('span', { style: { fontSize: 15, flexShrink: 0 } }, place.icon || '📍'),
                  h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                    h('span', { style: { fontSize: 12.5, color: here ? T.text : T.text, fontWeight: here ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                      String(place.name || '') + (here ? ' · 她现在在这' : '')),
                    h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                      Number(place.x || 0).toFixed(2) + ', ' + Number(place.y || 0).toFixed(2) +
                      (count ? ' · 这里 ' + count + ' 人' : '') +
                      (place.desc ? ' · ' + String(place.desc) : '')),
                  ),
                  h('span', { style: { fontSize: 10, color: T.text3, flexShrink: 0 } }, editMode ? '编辑' : '详情'),
                )
              })
            : h(Empty, { icon: '📍' }, '这张地图还没有地点。编辑模式下可以新增。'),
        ),
        // 她的时段习惯（权重）：旧 map.html 的「她的时段习惯」搬进原生面板
        h(MapRoutineCard, { mapId: String(map.id || '') }),
        // 旅行入口
        h(Card, { title: '旅行入口', tag: '跨城' },
          h(Note, {}, '跨城去别的地图：先到车站买票，班次/票价由服务端算。也可以直接在地图下拉里切换（会真的移动她）。'),
          h(Row, { gap: 6 },
            h(Btn, { size: 'sm', kind: 'primary', disabled: !!mapBusy, onClick: () => setTravelOpen(true) }, '打开旅行面板'),
            h(Btn, { size: 'sm', disabled: !!mapBusy, onClick: () => switchMap(maps.find((m) => String(m.id) !== activeMapId) ? maps.find((m) => String(m.id) !== activeMapId).id : '') }, '直接换城市'),
          ),
        ),
        // 编辑说明
        editMode
          ? h(Card, { title: '基础编辑说明', tag: 'D04 B' },
              h(Note, {}, '· 拖动地图上的地点钉 = 改 x/y（0~1 归一化），松开鼠标才记一次；'),
              h(Note, {}, '· 点地点列表「编辑」= 改名字/图标/描述/感受 + 内部场景（背景图、热点、障碍、可走区域）；'),
              h(Note, {}, '· 所有改动先存草稿，点「保存」才会 POST /api/map 写服务端；保存后会回读比对，确认刷新不丢；'),
              h(Note, {}, '· 读不到地图数据时保存按钮会被禁用（读失败禁存）。'),
            )
          : null,
      ),
    ),
    // 弹层
    viewPlace
      ? h(MapPlaceModal, {
          place: viewPlace,
          people: peopleOf(viewPlace.id),
          busy: !!busyPlaceId,
          onClose: () => setViewPlace(null),
          onGo: goPlace,
          onEdit: startEditPlace,
        })
      : null,
    editingPlace
      ? h(MapPlaceEditor, {
          place: editingPlace,
          onClose: () => setEditingPlace(null),
          onSave: commitPlace,
        })
      : null,
    travelOpen
      ? h(MapTravelModal, {
          onClose: () => setTravelOpen(false),
          onDone: () => { setTravelOpen(false); mapApi.reload(); worldApi.reload() },
        })
      : null,
  )
}

    /* ===== src/client/30-settings/settings-core.js ===== */
// 30-settings/settings-core.js —— 设置：角色 / 人设 / 上下文 / 经济
//
// 构建顺序在 settings-life.js / settings.js 之前，所以生活标签可以复用这里的
// SettingsEconomyCard / SettingsBalanceAlertCard / SettingsContextCard。
//
// 约定（docs/NATIVE-CLIENT-ARCH.md）：
//   · 这是单文件工厂的片段：不写 import/export，只能引用前面文件里的 const/function；
//   · 颜色只走 T.*，中文 UI，不写死角色名/ID（角色名一律从接口读，N02）；
//   · 读取用 useApi，保存只提交「改动过的字段」（POST 局部字段，避免整体覆盖丢字段）；
//   · 读失败时禁用保存 + 显示 ErrorBox；非法值前端 clamp（后端也会 clamp）；
//   · 危险操作（删除/清空/覆盖）一律 await confirmDialog(...)；成功 toast。

// ───────────────────────── 共用小工具（life / shell 也会用） ─────────────────────────

// 结构比较：这里的值都是小对象/数组，JSON 比较够用，且能避免两个对象不一致却判等
function stgCoreEq(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) } catch (e) { return false }
}

// 只挑出变化过的字段（保存用：绝不整体覆盖）
function stgCoreDiff(base, next, keys) {
  const out = {}
  if (!base || !next) return out
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (!stgCoreEq(base[k], next[k])) out[k] = next[k]
  }
  return out
}

function stgCoreHas(obj) { return !!obj && Object.keys(obj).length > 0 }

// 数字夹紧（前端先拦一次；后端还有一层 clamp）
function stgCoreNum(v, lo, hi, dflt) { return clampNum(v, lo, hi, dflt) }
function stgCoreInt(v, lo, hi, dflt) { return Math.round(clampNum(v, lo, hi, dflt)) }

// 读取失败统一展示（配合「读失败禁用保存」）
function stgCoreErrBox(error, onRetry) {
  if (!error) return null
  return h(ErrorBox, { title: '读取失败', error: error, onRetry: onRetry })
}

// 保存中状态：run(fn) 自动加锁，避免连点重复提交
function stgCoreBusy() {
  const [busy, setBusy] = React.useState(false)
  const run = React.useCallback(async (fn) => {
    setBusy(true)
    try { return await fn() } finally { setBusy(false) }
  }, [])
  return [busy, run]
}

// useApi 的返回值 → 可编辑草稿 + 保存基线。
//   · 数据到达（或 reload 后 at 变化）时重建草稿；
//   · patch(部分字段) 改草稿；base 始终是上次读取到的值，用来算「改了哪些字段」。
function stgCoreDraft(api, seed) {
  const [draft, setDraft] = React.useState(null)
  const [base, setBase] = React.useState(null)
  const at = api && api.data ? api.at : 0
  React.useEffect(() => {
    // 只在「读到新数据」时重建草稿：读取失败（api.error）时保留用户正在改的内容，
    // 避免手动点「重新读取」失败一次就把没保存的编辑清空。
    if (!at || !api || !api.data || api.error) return
    const v = seed(api.data)
    setDraft(v)
    setBase(v)
  }, [at])
  const patch = React.useCallback((next) => {
    setDraft((prev) => {
      if (prev === null) return prev
      const p = typeof next === 'function' ? next(prev) : next
      return Object.assign({}, prev, p)
    })
  }, [])
  const reset = React.useCallback(() => { setDraft(base) }, [base])
  return { draft: draft, base: base, patch: patch, reset: reset }
}

// 统一保存按钮
function stgCoreSaveBtn(props) {
  const p = props || {}
  return h(Btn, {
    size: 'sm',
    kind: 'primary',
    disabled: !!p.disabled,
    onClick: p.onClick,
    title: p.title || '只保存改动过的字段',
  }, p.busy ? '保存中…' : (p.label || '保存'))
}

// ───────────────────────── 角色 / 人设 ─────────────────────────

const STG_ROLE_TRAVEL_PREFS = [
  { value: 'auto', label: '随便 / 看情况' },
  { value: 'cheap', label: '省钱优先' },
  { value: 'fast', label: '赶时间优先' },
]
const STG_ROLE_MODEL_TYPES = [
  { value: 'none', label: '没有（用头像）' },
  { value: 'sprite', label: '2D 精灵图' },
  { value: 'live2d', label: 'Live2D' },
  { value: '3d', label: '3D 模型（本版不渲染）' },
]
const STG_ROLE_TRAIT_MAX = 24

function stgCoreTraitsSeed(src) {
  const out = {}
  const raw = src && typeof src === 'object' ? src : {}
  for (const k of Object.keys(raw)) {
    const name = String(k).trim().slice(0, 20)
    if (!name) continue
    out[name] = stgCoreInt(raw[k], 0, 10, 5)
    if (Object.keys(out).length >= STG_ROLE_TRAIT_MAX) break
  }
  return out
}

// /api/persona → 角色卡草稿（meta 的字段平铺，body 一起）
function stgCorePersonaSeed(d) {
  const m = (d && d.meta) || {}
  const model = m.model || {}
  return {
    name: String(m.name || ''),
    userCall: String(m.userCall || ''),
    relation: String(m.relation || ''),
    age: (m.age === undefined || m.age === null || m.age === '') ? '' : stgCoreInt(m.age, 0, 200, 0),
    license: m.license === true,
    travelPref: ['auto', 'cheap', 'fast'].includes(m.travelPref) ? m.travelPref : 'auto',
    examples: Array.isArray(m.examples) ? m.examples.map((x) => String(x)) : [],
    traits: stgCoreTraitsSeed(m.traits),
    modelType: ['none', 'sprite', 'live2d', '3d'].includes(model.type) ? model.type : 'none',
    modelUrl: String(model.url || ''),
    modelScale: Number(model.scale) || 1,
    body: String((d && d.body) || ''),
  }
}

// 草稿 → POST /api/persona 的 meta/body 局部字段（meta 里只放改过的项，服务端浅合并）
function stgCorePersonaPayload(baseDraft, draft, prevMeta) {
  const payload = {}
  const meta = {}
  if (!stgCoreEq(String(baseDraft.name || ''), String(draft.name || ''))) meta.name = String(draft.name || '').trim().slice(0, 60)
  if (!stgCoreEq(String(baseDraft.userCall || ''), String(draft.userCall || ''))) meta.userCall = String(draft.userCall || '').trim().slice(0, 30)
  if (!stgCoreEq(String(baseDraft.relation || ''), String(draft.relation || ''))) meta.relation = String(draft.relation || '').trim().slice(0, 200)
  if (!stgCoreEq(baseDraft.age, draft.age)) meta.age = draft.age === '' ? null : stgCoreInt(draft.age, 0, 200, null)
  if (!stgCoreEq(!!baseDraft.license, !!draft.license)) meta.license = !!draft.license
  if (!stgCoreEq(baseDraft.travelPref, draft.travelPref)) meta.travelPref = draft.travelPref
  if (!stgCoreEq(baseDraft.examples, draft.examples)) meta.examples = (draft.examples || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  if (!stgCoreEq(baseDraft.traits, draft.traits)) meta.traits = stgCoreTraitsSeed(draft.traits)
  const model = {}
  if (!stgCoreEq(baseDraft.modelType, draft.modelType)) model.type = draft.modelType
  if (!stgCoreEq(String(baseDraft.modelUrl || ''), String(draft.modelUrl || ''))) model.url = String(draft.modelUrl || '').trim().slice(0, 300)
  if (!stgCoreEq(Number(baseDraft.modelScale), Number(draft.modelScale))) model.scale = stgCoreNum(draft.modelScale, 0.1, 3, 1)
  if (stgCoreHas(model)) meta.model = Object.assign({}, prevMeta && prevMeta.model ? prevMeta.model : {}, model)
  if (stgCoreHas(meta)) payload.meta = meta
  if (!stgCoreEq(String(baseDraft.body || ''), String(draft.body || ''))) payload.body = String(draft.body || '').slice(0, 20000)
  return payload
}

function SettingsRoleTab() {
  const persona = useApi('/api/persona')
  const chars = useApi('/api/characters')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(persona, stgCorePersonaSeed)
  const draft = f.draft
  const base = f.base
  const [newExample, setNewExample] = React.useState('')
  const [newTrait, setNewTrait] = React.useState('')
  const [avatarBusy, setAvatarBusy] = React.useState(false)
  const avatarFile = React.useRef(null)
  const importFile = React.useRef(null)
  const readError = persona.error || ''
  const readOnly = !draft || !base
  const prevMeta = persona.data && persona.data.meta ? persona.data.meta : null

  const reloadAll = React.useCallback(() => {
    persona.reload()
    chars.reload()
  }, [persona, chars])

  const patch = f.patch

  // 角色列表：切换 / 新建 / 删除（切换会换人设、记忆、聊天记录）
  const switchChar = async (id) => {
    if (!chars.data || !id || String(id) === String(chars.data.active)) return
    const r = await Api.post('/api/characters', { action: 'switch', id: String(id) })
    if (!r.ok) { toast(r.error || '切换失败', 'error'); return }
    const nm = (r.data && r.data.character && r.data.character.name) || ''
    toast('已切换到 ' + (nm || '新角色'))
    reloadAll()
  }
  const newChar = async () => {
    const name = await promptDialog('新角色叫什么？', { title: '新建角色', okText: '创建', placeholder: '名字（之后可以改）' })
    if (name === null) return
    const v = String(name).trim()
    if (!v) { toast('名字不能为空', 'error'); return }
    const r = await Api.post('/api/characters', { action: 'new', name: v.slice(0, 60) })
    if (!r.ok) { toast(r.error || '创建失败', 'error'); return }
    toast('已创建新角色')
    reloadAll()
  }
  const deleteChar = async () => {
    if (!chars.data) return
    const id = chars.data.active
    const list = chars.data.characters || []
    const target = list.find((c) => String(c.id) === String(id))
    const ok = await confirmDialog('删除当前角色「' + ((target && target.name) || '当前角色') + '」？', {
      title: '删除角色',
      detail: '她的记忆、日记、聊天记录都会一起删掉，且找不回来。',
      danger: true,
      okText: '删除',
    })
    if (!ok) return
    const r = await Api.post('/api/characters', { action: 'delete', id: String(id) })
    if (!r.ok) { toast(r.error || '删除失败', 'error'); return }
    toast('角色已删除')
    reloadAll()
  }

  // 头像：上传 / 恢复默认（服务端会落成 /avatar.png 并打时间戳）
  const onAvatarFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      const rd = await Api.readFileAsDataUrl(file, 3 * 1024 * 1024)
      if (!rd.ok) { toast(rd.error || '读取图片失败', 'error'); return }
      const r = await Api.upload('/api/avatar', { dataUrl: rd.dataUrl })
      if (!r.ok) { toast('头像上传失败：' + (r.error || '未知错误'), 'error'); return }
      toast('头像已更新')
      persona.reload()
    } finally {
      setAvatarBusy(false)
    }
  }
  const clearAvatar = async () => {
    const ok = await confirmDialog('恢复成默认头像？', { detail: '当前上传的头像文件会被删掉。', danger: true, okText: '恢复默认' })
    if (!ok) return
    const r = await Api.upload('/api/avatar', { dataUrl: '' })
    if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
    toast('已恢复默认头像')
    persona.reload()
  }

  // 示例句 / 性格开关（都先改草稿，点“保存角色卡”才提交）
  const addExample = () => {
    const v = String(newExample || '').trim()
    if (!v) { toast('先写一句她会说的话', 'error'); return }
    if ((draft.examples || []).length >= 12) { toast('示例最多 12 条', 'error'); return }
    patch((prev) => ({ examples: (prev.examples || []).concat(v.slice(0, 120)) }))
    setNewExample('')
  }
  const addTrait = () => {
    const v = String(newTrait || '').trim().slice(0, 20)
    if (!v) { toast('先写性格开关的名字', 'error'); return }
    if (Object.keys(draft.traits || {}).length >= STG_ROLE_TRAIT_MAX) { toast('性格开关最多 ' + STG_ROLE_TRAIT_MAX + ' 个', 'error'); return }
    patch((prev) => ({ traits: Object.assign({}, prev.traits || {}, { [v]: 5 }) }))
    setNewTrait('')
  }

  const saveRole = () => run(async () => {
    if (!draft || !base) return
    const name = String(draft.name || '').trim()
    if (!name) { toast('名字不能为空', 'error'); return }
    if (draft.age !== '' && draft.age !== null && !Number.isFinite(Number(draft.age))) { toast('年龄要填数字（0–200，可不填）', 'error'); return }
    const next = Object.assign({}, draft, {
      name: name,
      userCall: String(draft.userCall || '').trim(),
      relation: String(draft.relation || '').trim(),
      age: draft.age === '' ? '' : stgCoreInt(draft.age, 0, 200, 0),
    })
    const payload = stgCorePersonaPayload(base, next, prevMeta)
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/persona', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('角色卡已保存，下一条消息生效')
    persona.reload()
  })

  const resetDraft = () => { f.reset(); toast('已撤销未保存的修改') }

  // 导出 / 导入角色卡（纯本地 JSON，不请求任何网页）
  const exportRole = () => {
    if (!draft) return
    const payload = {
      meta: {
        name: draft.name, userCall: draft.userCall, relation: draft.relation,
        age: draft.age === '' ? null : draft.age, license: !!draft.license, travelPref: draft.travelPref,
        examples: (draft.examples || []).filter((x) => String(x).trim()),
        traits: draft.traits || {},
        model: { type: draft.modelType, url: draft.modelUrl, scale: Number(draft.modelScale) || 1 },
      },
      body: draft.body || '',
    }
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (String(draft.name || 'persona').trim() || 'persona') + '-角色卡.json'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove() } catch (e) {} }, 1500)
      toast('角色卡已导出')
    } catch (e) {
      toast('导出失败：' + ((e && e.message) || '浏览器不允许下载'), 'error')
    }
  }
  const onImportFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    let j = null
    try { j = JSON.parse(await file.text()) } catch (err) { toast('导入失败：不是有效的 JSON 角色卡', 'error'); return }
    if (!j || typeof j !== 'object' || (!j.meta && typeof j.body !== 'string')) { toast('导入失败：角色卡格式不对', 'error'); return }
    const src = j.meta && typeof j.meta === 'object' ? j.meta : {}
    const ok = await confirmDialog('用这张角色卡覆盖当前角色？', {
      title: '导入角色卡',
      detail: '会覆盖：名字、称呼、关系、年龄、说话示例、性格开关、模型设置、人设正文。头像不动。',
      danger: true,
      okText: '覆盖当前角色',
    })
    if (!ok) return
    const meta = {}
    if (typeof src.name === 'string' && src.name.trim()) meta.name = src.name.trim().slice(0, 60)
    if (typeof src.userCall === 'string') meta.userCall = src.userCall.trim().slice(0, 30)
    if (typeof src.relation === 'string') meta.relation = src.relation.trim().slice(0, 200)
    if (src.age !== undefined) meta.age = src.age === null || src.age === '' ? null : stgCoreInt(src.age, 0, 200, null)
    if (src.license !== undefined) meta.license = !!src.license
    if (['auto', 'cheap', 'fast'].includes(src.travelPref)) meta.travelPref = src.travelPref
    if (Array.isArray(src.examples)) meta.examples = src.examples.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
    if (src.traits && typeof src.traits === 'object') meta.traits = stgCoreTraitsSeed(src.traits)
    if (src.model && typeof src.model === 'object') {
      const m = {}
      if (['none', 'sprite', 'live2d', '3d'].includes(src.model.type)) m.type = src.model.type
      if (typeof src.model.url === 'string') m.url = src.model.url.trim().slice(0, 300)
      if (src.model.scale !== undefined) m.scale = stgCoreNum(src.model.scale, 0.1, 3, 1)
      if (stgCoreHas(m)) meta.model = Object.assign({}, (prevMeta && prevMeta.model) || {}, m)
    }
    const payload = {}
    if (stgCoreHas(meta)) payload.meta = meta
    if (typeof j.body === 'string') payload.body = j.body.slice(0, 20000)
    if (!stgCoreHas(payload)) { toast('角色卡里没有可导入的字段', 'error'); return }
    const r = await Api.post('/api/persona', payload)
    if (!r.ok) { toast('导入失败：' + (r.error || '未知错误'), 'error'); return }
    toast('角色卡已导入')
    persona.reload()
  }

  // ── 效果预览 ──
  const [previewIn, setPreviewIn] = React.useState('')
  const [previewOut, setPreviewOut] = React.useState('')
  const [previewErr, setPreviewErr] = React.useState('')
  const [previewing, setPreviewing] = React.useState(false)
  const doPreview = async () => {
    const text = String(previewIn || '').trim() || '在吗'
    setPreviewing(true)
    setPreviewErr('')
    try {
      const r = await Api.post('/api/preview', { text: text.slice(0, 200) })
      if (!r.ok) { setPreviewOut(''); setPreviewErr(r.error || '生成失败'); return }
      setPreviewOut(String((r.data && r.data.text) || ''))
    } finally {
      setPreviewing(false)
    }
  }

  const charList = (chars.data && chars.data.characters) || []
  const activeId = chars.data ? chars.data.active : ''
  const activeChar = charList.find((c) => String(c.id) === String(activeId)) || null
  const metaAvatar = (prevMeta && prevMeta.avatar) || (activeChar && activeChar.avatar) || ''

  const chipList = h(Row, { gap: 8, wrap: true },
    charList.map((c) => h(Chip, {
      key: String(c.id),
      active: String(c.id) === String(activeId),
      title: String(c.id) === String(activeId) ? '当前角色' : '切换到这个角色',
      onClick: () => { switchChar(c.id).catch(() => {}) },
    }, (c.name || '') + (String(c.id) === String(activeId) ? ' · 当前' : ''))),
    charList.length ? null : h(Note, {}, chars.error ? '角色列表读取失败' : '还没有角色'),
  )

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    stgCoreErrBox(readError, persona.reload),

    // 顶部操作条：保存 / 撤销 / 刷新 / 导入导出
    h(Row, { gap: 8, wrap: true, style: { position: 'sticky', top: 0, zIndex: 3, padding: '6px 0', background: T.bg, borderBottom: '1px solid ' + T.border } },
      h('span', { style: { fontSize: 12.5, color: T.text2 } }, '角色卡'),
      h('span', { style: { fontSize: 11, color: T.text3 } }, readOnly ? '读取中…' : '改完点保存；只提交改动过的字段'),
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError || !draft, onClick: resetDraft }, '撤销修改'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError, onClick: reloadAll }, '重新读取'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: exportRole }, '导出角色卡'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: () => { if (importFile.current) importFile.current.click() } }, '导入角色卡'),
      stgCoreSaveBtn({ disabled: readOnly || busy || !!readError, busy: busy, onClick: saveRole }),
    ),
    h('input', {
      ref: importFile, type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onChange: onImportFile,
    }),

    // 角色列表
    h(Card, {
      title: '角色列表', tag: '多角色：每个角色有自己的记忆、日记和聊天记录', sub: chars.data ? charList.length + ' 个' : '',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: chars.loading, onClick: () => newChar().catch(() => {}) }, '+ 新建角色'),
        h(Btn, { size: 'sm', kind: 'danger', disabled: !!chars.error, onClick: () => deleteChar().catch(() => {}) }, '删除当前角色'),
      ),
    },
      stgCoreErrBox(chars.error, chars.reload),
      chipList,
      activeChar ? h(Note, {}, '当前角色：' + (activeChar.name || '') + '（切换会换人设、记忆、日记和聊天记录）') : null,
    ),

    // 基本信息 + 头像
    h(Card, { title: '基本信息', sub: '角色身份与基本设定' },
      readOnly ? (readError ? null : h(Loading, { text: '读取角色卡…' })) : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 } },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', gridColumn: '1 / -1', flexWrap: 'wrap' } },
          h(Avatar, { path: metaAvatar || '', name: (draft && draft.name) || '', size: 64 }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(Row, { gap: 6 },
              h(Btn, { size: 'sm', kind: 'ghost', disabled: avatarBusy, onClick: () => { if (avatarFile.current) avatarFile.current.click() } }, avatarBusy ? '上传中…' : '上传头像'),
              h(Btn, { size: 'sm', kind: 'ghost', disabled: avatarBusy || !metaAvatar, onClick: () => clearAvatar().catch(() => {}) }, '用默认头像'),
            ),
            h(Note, {}, 'png / jpg / webp，最大 3MB；上传后立即生效'),
          ),
          h('input', { ref: avatarFile, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onAvatarFile }),
        ),
        h(Field, { label: '名字' }, h(TextInput, { value: draft.name, onChange: (v) => patch({ name: v }), placeholder: '她的名字' })),
        h(Field, { label: '怎么称呼你' }, h(TextInput, { value: draft.userCall, onChange: (v) => patch({ userCall: v }), placeholder: '例如：你' })),
        h(Field, { label: '关系', hint: '一句话说明她和你的关系' }, h(TextInput, { value: draft.relation, onChange: (v) => patch({ relation: v }) })),
        h(Field, { label: '年龄', hint: '选填；0 或不填都算没填（会影响出行/夜间出门等判断）' }, h(NumInput, { value: draft.age, min: 0, max: 200, step: 1, onChange: (v) => patch({ age: v }), suffix: '岁' })),
        h(Field, { label: '有驾照' }, h(Toggle, { checked: !!draft.license, onChange: (v) => patch({ license: v }), label: draft.license ? '有（可以开车）' : '没有' })),
        h(Field, { label: '出行偏好' }, h(Select, { value: draft.travelPref, onChange: (v) => patch({ travelPref: v }), options: STG_ROLE_TRAVEL_PREFS })),
        h(Field, { label: '模型类型', hint: '舞台用她的形象；本版只有 2D 舞台' }, h(Select, { value: draft.modelType, onChange: (v) => patch({ modelType: v }), options: STG_ROLE_MODEL_TYPES })),
        h(Field, { label: '模型地址', hint: '可留空' }, h(TextInput, { value: draft.modelUrl, onChange: (v) => patch({ modelUrl: v }), placeholder: '模型文件 URL（可留空）', mono: true })),
        h(Field, { label: '模型缩放' }, h(NumInput, { value: draft.modelScale, min: 0.1, max: 3, step: 0.1, onChange: (v) => patch({ modelScale: v }) })),
        h(Field, { label: '2D 表现', hint: '地图和 2D 舞台上的她用什么画' }, h(SkeletonSwitch, {})),
      ),
    ),

    // 人设正文
    h(Card, { title: '人设正文', tag: '会全部注入提示词', sub: draft ? String(draft.body || '').length + ' 字' : '' },
      readOnly ? (readError ? null : h(Loading, { text: '读取人设…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h(TextArea, {
          value: draft.body,
          rows: 14,
          placeholder: '写她是谁、什么性格、怎么说话、有什么生活……',
          onChange: (v) => patch({ body: v }),
          style: { fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.7 },
        }),
        h(Note, {}, '建议 800~1500 字；保存后下一条消息立即生效，不需要重启。'),
      ),
    ),

    // 说话风格示例 + 性格开关
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, minWidth: 0 } },
      h(Card, { title: '说话风格示例', tag: '让她学自己的口气' },
        readOnly ? (readError ? null : h(Loading, { text: '读取…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          (draft.examples || []).map((ex, i) => h(Row, { key: 'ex' + i, gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: ex, onChange: (v) => patch((prev) => ({ examples: (prev.examples || []).map((x, j) => (j === i ? v : x)) })) })),
            h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这条（保存后生效）', onClick: () => patch((prev) => ({ examples: (prev.examples || []).filter((x, j) => j !== i) })) }, '✕'),
          )),
          (draft.examples || []).length ? null : h(Note, {}, '还没有示例句'),
          h(Row, { gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newExample, onChange: setNewExample, placeholder: '加一句她会说的话…', onEnter: addExample })),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: addExample }, '+ 添加'),
          ),
        ),
      ),
      h(Card, { title: '性格开关', tag: '软约束，写进人设', sub: draft ? Object.keys(draft.traits || {}).length + ' 个' : '' },
        readOnly ? (readError ? null : h(Loading, { text: '读取…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          Object.keys(draft.traits || {}).map((k) => h(Row, { key: 'trait-' + k, gap: 8 },
            h('span', { style: { fontSize: 12.5, color: T.text2, flex: '0 0 84px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: k }, k),
            h('span', { style: { flex: 1, minWidth: 90 } }, h(Slider, { value: draft.traits[k], min: 0, max: 10, step: 1, onChange: (v) => patch((prev) => ({ traits: Object.assign({}, prev.traits || {}, { [k]: stgCoreInt(v, 0, 10, 5) }) })) })),
            h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这个开关（保存后生效）', onClick: () => patch((prev) => { const t = Object.assign({}, prev.traits || {}); delete t[k]; return { traits: t } }) }, '✕'),
          )),
          h(Row, { gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newTrait, onChange: setNewTrait, placeholder: '新开关名字，例如 话多', onEnter: addTrait })),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: addTrait }, '+ 添加'),
          ),
        ),
      ),
    ),

    // 效果预览
    h(Card, { title: '效果预览', tag: '用已保存的人设实时生成', sub: '消耗少量 token' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(Row, { gap: 6 },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: previewIn, onChange: setPreviewIn, placeholder: '试一句，比如：今天好累', onEnter: () => { doPreview().catch(() => {}) } })),
          h(Btn, { size: 'sm', kind: 'primary', disabled: previewing, onClick: () => { doPreview().catch(() => {}) } }, previewing ? '生成中…' : '试一句'),
        ),
        previewErr ? h(ErrorBox, { error: previewErr, onRetry: () => { doPreview().catch(() => {}) } }) : null,
        previewOut
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid ' + T.border, borderRadius: T.radius, padding: '8px 10px', background: T.bg2 } },
              h('div', { style: { fontSize: 11.5, color: T.text3 } }, '你：' + (String(previewIn).trim() || '在吗')),
              h('div', { style: { fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, ((prevMeta && prevMeta.name) || '她') + '：' + previewOut),
            )
          : h(Note, {}, '预览用的是「已保存」的人设；刚改完记得先保存。'),
      ),
    ),

    h(Note, {}, '提示：角色卡里的模型类型/地址只影响舞台形象；人设、示例、性格开关都会注入提示词。'),
  )
}

// ───────────────────────── 上下文注入 ─────────────────────────

const STG_CTX_HISTORY_OPTIONS = [
  { value: 'full', label: '完整（最近 30 条）' },
  { value: 'short', label: '精简（最近 8 条 + 摘要）' },
  { value: 'compact', label: '压缩（最近 8 条）' },
  { value: 'minimal', label: '最少（最近 4 条）' },
  { value: 'off', label: '不带历史（最省）' },
]

function stgCoreContextSeed(d) {
  const c = (d && d.context) || {}
  return {
    historyMode: ['full', 'short', 'off', 'compact', 'minimal'].includes(c.historyMode) ? c.historyMode : 'full',
    memoryInject: stgCoreInt(c.memoryInject, 2, 20, 8),
  }
}

function SettingsContextCard() {
  const ctx = useApi('/api/context')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(ctx, stgCoreContextSeed)
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = { historyMode: d.historyMode, memoryInject: stgCoreInt(d.memoryInject, 2, 20, 8) }
    const payload = stgCoreDiff(f.base, next, ['historyMode', 'memoryInject'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/context', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('上下文设置已保存，下一条消息生效')
    f.patch(next)
    ctx.reload()
  })
  const summary = (ctx.data && ctx.data.summary) || null
  return h(Card, {
    title: '上下文注入', sub: '这一轮带多少聊天历史与记忆', tag: '省 token',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!ctx.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(ctx.error, ctx.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: '聊天历史', hint: '精简/压缩会用更少原文、必要时额外生成一次摘要；不带历史最省，但短期连贯性差一点。' },
        h(Select, { value: d.historyMode, onChange: (v) => f.patch({ historyMode: v }), options: STG_CTX_HISTORY_OPTIONS })),
      h(Field, { label: '每轮注入记忆', hint: '2–20 条（默认 8）' },
        h(NumInput, { value: d.memoryInject, min: 2, max: 20, step: 1, onChange: (v) => f.patch({ memoryInject: v }), suffix: '条' })),
      ctx.data && ctx.data.historyKeep ? h(Note, {}, '「精简」档保留最近 ' + ctx.data.historyKeep + ' 条原文。') : null,
      summary && summary.text
        ? h('div', { style: { border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { fontSize: 11.5, color: T.text3 } }, '当前历史摘要' + (summary.upto ? '（到第 ' + summary.upto + ' 条）' : '')),
            h('div', { style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(summary.text)),
          )
        : h(Note, {}, '还没有历史摘要（聊得多了才会有）。'),
    ) : (ctx.error ? null : h(Loading, { text: '读取上下文设置…' })),
  )
}

// 记忆标签：上下文卡片 + 记忆管理（条目列表/置顶/删除/导入/遗忘参数，组件在 settings-data.js）+ 说明
function SettingsMemoryTab() {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    h(SettingsContextCard, {}),
    h(SettingsMemoryCard, {}),
    h(Card, { title: '关于记忆', sub: '她记住的东西分三层' },
      h(Note, {}, '· 长期记忆条目：她对你的印象、发生过的事，会按重要度/新近度衰减，强的重要条目会被注入。'),
      h(Note, {}, '· 聊天历史：上面「聊天历史」档位决定这一轮带多少原文；太省 token 会让她记不住刚说过的话。'),
      h(Note, {}, '· 日记/摘要：她每天写日记，历史被精简时会用摘要补上下文；日记本身在「数据」标签里查看/生成。'),
      h(Note, {}, '· 上面的记忆列表：「置顶」= 放进核心记忆（永不遗忘）；「取消置顶」= 回到普通记忆按清晰度衰减；删除后她就不会再记得这件事。'),
    ),
  )
}

// ───────────────────────── 经济 / 零花钱 ─────────────────────────

const STG_ECON_KEYS = ['enabled', 'initialBalance', 'dailyIncome', 'wagePerHour', 'mealCost', 'entertainmentCost', 'moneyType', 'tokenBudget', 'tokensPerYuan']
const STG_ECON_MONEY_TYPES = [
  { value: 'virtual', label: '虚拟货币（自己设数值）' },
  { value: 'token', label: 'Token 实时预算（按剩余 token 折算）' },
]

function stgCoreEconomySeed(d) {
  const e = (d && d.economy) || {}
  return {
    enabled: e.enabled !== false,
    initialBalance: stgCoreNum(e.initialBalance, 0, 1000000, 200),
    dailyIncome: stgCoreNum(e.dailyIncome, 0, 100000, 20),
    wagePerHour: stgCoreNum(e.wagePerHour, 0, 100000, 15),
    mealCost: stgCoreNum(e.mealCost, 0, 100000, 12),
    entertainmentCost: stgCoreNum(e.entertainmentCost, 0, 100000, 30),
    moneyType: e.moneyType === 'token' ? 'token' : 'virtual',
    tokenBudget: stgCoreNum(e.tokenBudget, 0, 100000000, 2000000),
    tokensPerYuan: stgCoreNum(e.tokensPerYuan, 0, 1000000, 1000),
  }
}

function stgCoreFmtInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  try { return Math.round(n).toLocaleString('zh-CN') } catch (e) { return String(Math.round(n)) }
}

function SettingsEconomyCard() {
  const econ = useApi('/api/economy')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(econ, stgCoreEconomySeed)
  const d = f.draft
  const wallet = (econ.data && econ.data.wallet) || null
  const real = (econ.data && econ.data.realBalance) || null
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      initialBalance: stgCoreNum(d.initialBalance, 0, 1000000, 0),
      dailyIncome: stgCoreNum(d.dailyIncome, 0, 100000, 0),
      wagePerHour: stgCoreNum(d.wagePerHour, 0, 100000, 0),
      mealCost: stgCoreNum(d.mealCost, 0, 100000, 0),
      entertainmentCost: stgCoreNum(d.entertainmentCost, 0, 100000, 0),
      moneyType: d.moneyType === 'token' ? 'token' : 'virtual',
      tokenBudget: stgCoreNum(d.tokenBudget, 0, 100000000, 0),
      tokensPerYuan: stgCoreNum(d.tokensPerYuan, 0, 1000000, 0),
    }
    const payload = stgCoreDiff(f.base, next, STG_ECON_KEYS)
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/economy', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('经济设置已保存')
    f.patch(next)
    econ.reload()
  })
  const spendable = wallet ? (wallet.spendable === undefined ? wallet.balance : wallet.spendable) : null
  return h(Card, {
    title: '经济 / 零花钱', sub: '她自己的钱包（不是你的 DeepSeek 余额）',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!econ.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(econ.error, econ.reload),
    wallet ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 } },
      h(KV, { k: '可用零花', v: fmtMoney(spendable, 0) + ' 元' }),
      h(KV, { k: '计费口径', v: wallet.tokenMode ? 'Token 预算折算' : '虚拟货币' }),
      wallet.tokenMode ? h(KV, { k: '剩余 token', v: stgCoreFmtInt(wallet.remainingTokens) }) : null,
      h(KV, { k: '今日 token', v: stgCoreFmtInt(wallet.dailyUsed) }),
      real && real.ok ? h(KV, { k: '你的 DeepSeek 余额', v: '¥' + fmtMoney(real.total) }) : null,
      real && real.ok ? h(KV, { k: '今日你的消耗', v: '¥' + fmtMoney(real.todayRmb) }) : null,
    ) : null,
    real && real.ok === false && real.error ? h(Note, {}, '真实余额读取失败：' + real.error) : null,
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 } },
      h(Field, { label: '启用经济' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开着（会花钱/赚钱）' : '关掉（不扣钱）' })),
      h(Field, { label: '初始余额', hint: '新角色/重置时用' }, h(NumInput, { value: d.initialBalance, min: 0, max: 1000000, step: 10, onChange: (v) => f.patch({ initialBalance: v }), suffix: '元' })),
      h(Field, { label: '每日零花钱' }, h(NumInput, { value: d.dailyIncome, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ dailyIncome: v }), suffix: '元/天' })),
      h(Field, { label: '工作时薪', hint: '上班/工作作息时赚' }, h(NumInput, { value: d.wagePerHour, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ wagePerHour: v }), suffix: '元/时' })),
      h(Field, { label: '吃饭开销' }, h(NumInput, { value: d.mealCost, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ mealCost: v }), suffix: '元/顿' })),
      h(Field, { label: '娱乐开销' }, h(NumInput, { value: d.entertainmentCost, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ entertainmentCost: v }), suffix: '元/次' })),
      h(Field, { label: '货币类型' }, h(Select, { value: d.moneyType, onChange: (v) => f.patch({ moneyType: v }), options: STG_ECON_MONEY_TYPES })),
      h(Field, { label: 'Token 预算' }, h(NumInput, { value: d.tokenBudget, min: 0, max: 100000000, step: 100000, onChange: (v) => f.patch({ tokenBudget: v }), suffix: 'tokens' })),
      h(Field, { label: '1 元 = 多少 token' }, h(NumInput, { value: d.tokensPerYuan, min: 0, max: 1000000, step: 100, onChange: (v) => f.patch({ tokensPerYuan: v }), suffix: 'tokens' })),
    ) : null,
    h(Note, {}, '充值口径：她的「零花」是插件里独立的虚拟钱包（交通、吃饭、娱乐都从这里扣），'),
    h(Note, {}, '和你在 DeepSeek 平台充的钱不是同一笔；Token 模式只是把零花按「剩余 token ÷ 每元 token 数」折算显示。'),
  )
}

// 低余额提醒（她主动提醒你充值；属于经济设置的一部分）
function SettingsBalanceAlertCard() {
  const api = useApi('/api/balance-alert')
  const [busy, run] = stgCoreBusy()
  const [testing, setTesting] = React.useState(false)
  const f = stgCoreDraft(api, (d) => {
    const a = (d && d.alert) || {}
    return {
      enabled: a.enabled !== false,
      thresholdRmb: stgCoreNum(a.thresholdRmb, 0, 10000, 5),
      cooldownMin: stgCoreInt(a.cooldownMin, 1, 10080, 360),
    }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      thresholdRmb: stgCoreNum(d.thresholdRmb, 0, 10000, 5),
      cooldownMin: stgCoreInt(d.cooldownMin, 1, 10080, 360),
    }
    const payload = stgCoreDiff(f.base, next, ['enabled', 'thresholdRmb', 'cooldownMin'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/balance-alert', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('低余额提醒已保存')
    f.patch(next)
    api.reload()
  })
  const sendTest = async () => {
    const ok = await confirmDialog('真的让她发一条低余额提醒？', {
      title: '发一条测试',
      detail: '她会把提醒消息真的发到聊天里（会消耗少量 token）。',
      okText: '发一条',
    })
    if (!ok) return
    setTesting(true)
    try {
      const r = await Api.post('/api/balance-alert/test', {})
      if (!r.ok) { toast('发送失败：' + (r.error || '未知错误'), 'error'); return }
      if (r.data && r.data.ok) toast('已发送：' + String(r.data.text || '').slice(0, 40))
      else toast('没有发送：' + ((r.data && r.data.error) || '余额读数不可用'), 'error')
      api.reload()
    } finally {
      setTesting(false)
    }
  }
  const lastAt = api.data && api.data.alert && api.data.alert.lastAt
  return h(Card, {
    title: '低余额提醒', sub: '余额低于阈值时她主动提醒你充值',
    actions: h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: testing || !d, onClick: () => { sendTest().catch(() => {}) } }, testing ? '发送中…' : '发一条测试'),
      stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
    ),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 } },
      h(Field, { label: '开启提醒' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '阈值', hint: '低于这个金额就提醒' }, h(NumInput, { value: d.thresholdRmb, min: 0, max: 10000, step: 0.5, onChange: (v) => f.patch({ thresholdRmb: v }), suffix: '元' })),
      h(Field, { label: '冷却', hint: '避免刷屏' }, h(NumInput, { value: d.cooldownMin, min: 1, max: 10080, step: 30, onChange: (v) => f.patch({ cooldownMin: v }), suffix: '分钟' })),
    ) : (api.error ? null : h(Loading, { text: '读取提醒设置…' })),
    lastAt ? h(Note, {}, '上次提醒：' + fmtDateTime(lastAt)) : null,
  )
}

// 2D 表现开关：骨骼角色（会动） / 静态头像图。存 localStorage，地图/舞台立即跟着变。
function SkeletonSwitch() {
  const [on, setOn] = React.useState(skeletonEnabled())
  return h(Toggle, {
    checked: on,
    onChange: (v) => { setOn(v); setSkeletonEnabled(v) },
    label: on ? '骨骼角色（会动）' : '静态头像图（省内存）',
  })
}

// (anchor fallback)

    /* ===== src/client/30-settings/settings-life.js ===== */
// 30-settings/settings-life.js —— 设置：生活 / 环境（主动消息 / 心跳 / 日记 / 天气表现 / 桌宠 / 权限）
//
// 本文件在 settings-core.js 之后构建，所以可以直接用：
//   stgCoreEq / stgCoreDiff / stgCoreHas / stgCoreNum / stgCoreInt / stgCoreErrBox /
//   stgCoreBusy / stgCoreDraft / stgCoreSaveBtn / SettingsEconomyCard / SettingsBalanceAlertCard
//
// 约定（docs/NATIVE-CLIENT-ARCH.md）：
//   · 不写 import/export；颜色只走 T.*；中文 UI；不写死角色名/ID（N02）；
//   · 保存只提交改动字段；读失败禁用保存 + ErrorBox；危险操作 confirmDialog；成功 toast；
//   · 桌宠卡片由 40-screen/pet.js 提供（构建顺序在后，只在渲染时调用，所以运行时可用）。

// ───────────────────────── 生活：现在在做什么 ─────────────────────────

function stgLifeMinutesLeft(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(0, Math.round((n - Date.now()) / 60000))
}

function stgLifeEnergyTone(energy) {
  const v = Number(energy)
  if (!Number.isFinite(v)) return undefined
  if (v >= 55) return 'ok'
  if (v >= 30) return 'warn'
  return 'danger'
}

function SettingsLifeNowCard() {
  const api = useApi('/api/life/states', { refreshMs: 15000 })
  const [tickBusy, setTickBusy] = React.useState(false)
  const states = (api.data && api.data.states) || []
  const doTick = async () => {
    setTickBusy(true)
    try {
      const r = await Api.post('/api/life/tick', {})
      if (!r.ok) { toast('操作失败：' + (r.error || '未知错误'), 'error'); return }
      toast('她重新安排了一下现在做什么')
      api.reload()
    } finally {
      setTickBusy(false)
    }
  }
  return h(Card, {
    title: '现在在做什么', sub: '她自己安排的生活状态',
    actions: h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!api.error, onClick: api.reload }, '刷新'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: tickBusy || !!api.error, title: '让她重新决定当前行为', onClick: () => { doTick().catch(() => {}) } }, tickBusy ? '安排中…' : '让她动一动'),
    ),
  },
    stgCoreErrBox(api.error, api.reload),
    states.length
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } }, states.map((st, i) => {
          const left = stgLifeMinutesLeft(st.endsAt)
          return h('div', {
            key: String(st.characterId || i),
            style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: i ? '1px solid ' + T.border : 'none', minWidth: 0 },
          },
            h(Avatar, { path: st.avatar || '', name: st.name || '', size: 32 }),
            h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
              h('div', { style: { fontSize: 13, color: T.text, fontWeight: 600 } },
                (st.name || '') + (st.placeName ? ' · ' + st.placeName : '') + (st.hotspotLabel ? ' · ' + st.hotspotLabel : '')),
              h(Row, { gap: 6, wrap: true },
                h(Badge, { tone: stgLifeEnergyTone(st.energy), title: '精力' }, '精力 ' + (Number.isFinite(Number(st.energy)) ? Math.round(Number(st.energy)) : '—')),
                st.mood ? h(Badge, { title: '心情' }, String(st.mood)) : null,
                h(Badge, { title: '当前行为' }, String(st.behaviorLabel || '发呆')),
                left === null ? null : h(Note, {}, '预计再 ' + left + ' 分钟'),
              ),
            ),
          )
        }))
      : (api.error ? null : h(Empty, { icon: '🌙' }, '她现在没在任何地点（生活模拟可能没启动 / 当前模式是纯聊天）')),
    h(Note, {}, '这是她的生活模拟状态：行为、地点、精力、心情都由运行时自己推进；「让她动一动」= 立刻重算一次。'),
  )
}

// ───────────────────────── 生活：作息表 ─────────────────────────

const STG_LIFE_TIME_RE = /\d{1,2}:\d{2}/

function stgLifeSchedulesSeed(d) {
  const l = (d && d.life) || {}
  const list = Array.isArray(l.schedules) ? l.schedules : []
  return {
    schedules: list.map((s) => ({
      time: String((s && s.time) || ''),
      label: String((s && s.label) || ''),
      days: String((s && s.days) || '每天'),
      place: (s && s.place) || '',
    })),
  }
}

function SettingsLifeScheduleCard() {
  const api = useApi('/api/life')
  // 地点下拉的数据源：GET /api/routine 的 places（[{id,name,icon}]）。
  // 不传 refreshMs → 只在挂载 / 点重试时请求一次，改输入不会重复拉接口。
  const placesApi = useApi('/api/routine')
  const [busy, run] = stgCoreBusy()
  const [newTime, setNewTime] = React.useState('')
  const [newLabel, setNewLabel] = React.useState('')
  const [newPlace, setNewPlace] = React.useState('')
  const f = stgCoreDraft(api, stgLifeSchedulesSeed)
  const d = f.draft
  const rows = (d && d.schedules) || []
  const placeList = (placesApi.data && Array.isArray(placesApi.data.places)) ? placesApi.data.places : []
  const placeOptions = [{ value: '', label: '（不指定）' }].concat(placeList.map((p) => ({
    value: String(p.id),
    label: String((p.icon ? p.icon + ' ' : '') + (p.name || p.id)),
  })))
  const placesReady = !placesApi.error && placeList.length > 0
  // 历史数据里的 place 可能已经不在当前地图：补一条选项保住原值（不要静默清空）
  const optionsForPlace = (current) => {
    if (!current) return placeOptions
    if (placeOptions.some((o) => o.value === String(current))) return placeOptions
    return placeOptions.concat([{ value: String(current), label: String(current) + '（地点已不存在）' }])
  }
  const placeLabel = (id) => {
    const hit = placeList.find((p) => String(p.id) === String(id))
    return hit ? String((hit.icon ? hit.icon + ' ' : '') + (hit.name || hit.id)) : String(id)
  }
  const patchRows = (next) => f.patch({ schedules: next })
  const addRow = () => {
    const time = String(newTime || '').trim()
    const label = String(newLabel || '').trim()
    if (!time || !label) { toast('时间和内容都要填', 'error'); return }
    if (!STG_LIFE_TIME_RE.test(time)) { toast('时间格式像 07:30 或 21:00-22:00', 'error'); return }
    if (rows.length >= 24) { toast('作息最多 24 条', 'error'); return }
    patchRows(rows.concat({ time: time.slice(0, 20), label: label.slice(0, 40), days: '每天', place: newPlace || '' }))
    setNewTime('')
    setNewLabel('')
    setNewPlace('')
  }
  const save = () => run(async () => {
    if (!d || !f.base) return
    const cleaned = []
    for (let i = 0; i < rows.length; i++) {
      const t = String(rows[i].time || '').trim()
      const lb = String(rows[i].label || '').trim()
      if (!t && !lb) continue
      if (!t || !lb) { toast('第 ' + (i + 1) + ' 条作息的时间和内容都要填', 'error'); return }
      if (!STG_LIFE_TIME_RE.test(t)) { toast('第 ' + (i + 1) + ' 条时间格式不对（像 07:30 或 21:00-22:00）', 'error'); return }
      cleaned.push({ time: t.slice(0, 20), label: lb.slice(0, 40), days: String(rows[i].days || '每天').slice(0, 10), place: rows[i].place || '' })
    }
    const payload = stgCoreDiff(f.base, { schedules: cleaned }, ['schedules'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('作息表已保存')
    api.reload()
  })
  return h(Card, {
    title: '作息表', sub: '每天固定时间点/时段做什么', tag: '可增删',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      rows.length ? rows.map((row, i) => h(Row, { key: 'sch' + i, gap: 6 },
        h('span', { style: { width: 148, minWidth: 110 } }, h(TextInput, {
          value: row.time, placeholder: '07:30',
          onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { time: v }) : x))),
        })),
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, {
          value: row.label, placeholder: '起床 / 上学 / 午饭…',
          onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { label: v }) : x))),
        })),
        placesReady
          ? h('span', { title: '这个时段她更倾向去的地方（不指定就按地图权重自己决定）', style: { width: 134, minWidth: 104 } },
              h(Select, {
                value: row.place || '',
                onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { place: v }) : x))),
                options: optionsForPlace(row.place),
              }))
          : h('span', { style: { width: 134, minWidth: 104, fontSize: 11, color: T.text3, wordBreak: 'break-all' } },
              row.place ? '地点：' + placeLabel(row.place) : ''),
        h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这条（保存后生效）', onClick: () => patchRows(rows.filter((x, j) => j !== i)) }, '✕'),
      )) : h(Note, {}, '还没有作息，先在下面加一条'),
      h(Row, { gap: 6, style: { marginTop: 4 } },
        h('span', { style: { width: 148, minWidth: 110 } }, h(TextInput, { value: newTime, placeholder: '21:00-22:00', onChange: setNewTime, onEnter: addRow })),
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newLabel, placeholder: '做什么（自由填写）', onChange: setNewLabel, onEnter: addRow })),
        placesReady
          ? h('span', { style: { width: 134, minWidth: 104 } }, h(Select, { value: newPlace, onChange: setNewPlace, options: placeOptions }))
          : null,
        h(Btn, { size: 'sm', kind: 'ghost', onClick: addRow }, '+ 添加作息'),
      ),
      h(Note, {}, '时间可以写单点（07:30）也可以写时段（21:00-22:00）；作息会影响她去哪、什么时候该睡。'),
      h(Note, {}, '指定地点 = 这个时段命中时她更倾向去那里（权重 ×1.8，不锁死）；不指定就按地图权重和她的心情自己决定。'),
      placesApi.error
        ? h(Row, { gap: 8, wrap: true },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(Note, {}, '地点列表读取失败（下拉暂不可用，已选地点会原样保留）：' + placesApi.error)),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: placesApi.reload }, '重试'),
          )
        : null,
    ) : (api.error ? null : h(Loading, { text: '读取作息…' })),
  )
}

// ───────────────────────── 生活：活动池 ─────────────────────────

function stgLifeActivitiesSeed(d) {
  const l = (d && d.life) || {}
  const list = Array.isArray(l.activities) ? l.activities : []
  return {
    activities: list.map((a) => ({
      name: String((a && a.name) || ''),
      window: String((a && a.window) || ''),
      weight: stgCoreInt(a && a.weight, 0, 100, 20),
      minMin: stgCoreInt(a && a.minMin, 1, 720, 5),
      maxMin: stgCoreInt(a && a.maxMin, 1, 720, 20),
    })),
  }
}

function SettingsLifeActivityCard() {
  const api = useApi('/api/life')
  const [busy, run] = stgCoreBusy()
  const [newName, setNewName] = React.useState('')
  const f = stgCoreDraft(api, stgLifeActivitiesSeed)
  const d = f.draft
  const rows = (d && d.activities) || []
  const patchRows = (next) => f.patch({ activities: next })
  const addRow = () => {
    const name = String(newName || '').trim()
    if (!name) { toast('先写活动名', 'error'); return }
    if (rows.length >= 40) { toast('活动最多 40 个', 'error'); return }
    patchRows(rows.concat({ name: name.slice(0, 40), window: '', weight: 20, minMin: 5, maxMin: 20 }))
    setNewName('')
  }
  const save = () => run(async () => {
    if (!d || !f.base) return
    const cleaned = []
    for (let i = 0; i < rows.length; i++) {
      const name = String(rows[i].name || '').trim()
      if (!name) continue
      const win = String(rows[i].window || '').trim()
      if (win && !STG_LIFE_TIME_RE.test(win)) { toast('第 ' + (i + 1) + ' 个活动的时段格式不对（像 22:00-01:30，留空=随时）', 'error'); return }
      const minMin = stgCoreInt(rows[i].minMin, 1, 720, 5)
      const maxMin = stgCoreInt(rows[i].maxMin, 1, 720, 20)
      if (maxMin < minMin) { toast('第 ' + (i + 1) + ' 个活动：最长时长不能小于最短时长', 'error'); return }
      cleaned.push({ name: name.slice(0, 40), window: win.slice(0, 20), weight: stgCoreInt(rows[i].weight, 0, 100, 20), minMin: minMin, maxMin: maxMin })
    }
    const payload = stgCoreDiff(f.base, { activities: cleaned }, ['activities'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('活动池已保存')
    api.reload()
  })
  return h(Card, {
    title: '活动池', sub: '空闲时按权重抽；可限定只在某个时段做', tag: '权重越大越常做',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      rows.length ? rows.map((row, i) => h('div', {
        key: 'act' + i,
        style: { border: '1px solid ' + T.border, borderRadius: T.radius, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, background: T.bg2 },
      },
        h(Row, { gap: 6 },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, {
            value: row.name, placeholder: '活动名',
            onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { name: v }) : x))),
          })),
          h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这个活动（保存后生效）', onClick: () => patchRows(rows.filter((x, j) => j !== i)) }, '✕'),
        ),
        h(Row, { gap: 8, wrap: true },
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '时段'),
          h('span', { style: { width: 130 } }, h(TextInput, {
            value: row.window, placeholder: '留空=随时', mono: true,
            onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { window: v }) : x))),
          })),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '权重'),
          h(NumInput, { value: row.weight, min: 0, max: 100, step: 5, width: 70, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { weight: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '时长'),
          h(NumInput, { value: row.minMin, min: 1, max: 720, step: 1, width: 64, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { minMin: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '~'),
          h(NumInput, { value: row.maxMin, min: 1, max: 720, step: 1, width: 64, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { maxMin: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '分钟'),
        ),
      )) : h(Note, {}, '还没有活动，先在下面加一个'),
      h(Row, { gap: 6 },
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newName, placeholder: '活动名，例如 刷 B 站', onChange: setNewName, onEnter: addRow })),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: addRow }, '+ 添加活动'),
      ),
      h(Note, {}, '固定时段的活动只在那个时段被抽到；「留空 = 随时」任何空档都可能做。'),
    ) : (api.error ? null : h(Loading, { text: '读取活动池…' })),
  )
}

// ───────────────────────── 生活：心跳 / 主动消息 / 日记 ─────────────────────────

function stgLifeHeartbeatSeed(d) {
  const l = (d && d.life) || {}
  return {
    enabled: l.enabled !== false,
    heartbeatMin: stgCoreInt(l.heartbeatMin, 5, 180, 45),
    proactive: stgCoreInt(l.proactive, 0, 10, 3),
    proactiveEnabled: l.proactiveEnabled === true,
    proactiveMinMin: stgCoreInt(l.proactiveMinMin, 5, 1440, 30),
    proactiveMaxMin: stgCoreInt(l.proactiveMaxMin, 5, 1440, 90),
    quietStart: stgCoreInt(l.quietStart, 0, 23, 2),
    quietEnd: stgCoreInt(l.quietEnd, 0, 23, 7),
    diaryHour: stgCoreInt(l.diaryHour, 0, 23, 22),
    diaryAuto: l.diaryAuto !== false,
    smartLife: l.smartLife === true,
  }
}

function SettingsLifeHeartbeatCard() {
  const api = useApi('/api/life')
  const [busy, run] = stgCoreBusy()
  const [testing, setTesting] = React.useState(false)
  const [diaryOpen, setDiaryOpen] = React.useState(false)
  const [diaryBusy, setDiaryBusy] = React.useState(false)
  const [diaryText, setDiaryText] = React.useState('')
  const [diaryErr, setDiaryErr] = React.useState('')
  const f = stgCoreDraft(api, stgLifeHeartbeatSeed)
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      heartbeatMin: stgCoreInt(d.heartbeatMin, 5, 180, 45),
      proactive: stgCoreInt(d.proactive, 0, 10, 3),
      proactiveEnabled: !!d.proactiveEnabled,
      proactiveMinMin: stgCoreInt(d.proactiveMinMin, 5, 1440, 30),
      proactiveMaxMin: stgCoreInt(d.proactiveMaxMin, 5, 1440, 90),
      quietStart: stgCoreInt(d.quietStart, 0, 23, 2),
      quietEnd: stgCoreInt(d.quietEnd, 0, 23, 7),
      diaryHour: stgCoreInt(d.diaryHour, 0, 23, 22),
      diaryAuto: !!d.diaryAuto,
      smartLife: !!d.smartLife,
    }
    if (next.proactiveMaxMin < next.proactiveMinMin) { toast('主动消息：最大间隔不能小于最小间隔', 'error'); return }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('生活作息设置已保存')
    f.patch(next)
    api.reload()
  })
  const sendProactive = async () => {
    const ok = await confirmDialog('让她现在主动发一条消息？', {
      title: '主动消息测试',
      detail: '她会真的在聊天里给你发一句话（消耗少量 token）。',
      okText: '发一条',
    })
    if (!ok) return
    setTesting(true)
    try {
      const r = await Api.post('/api/proactive/test', {})
      if (!r.ok) { toast('生成失败：' + (r.error || '未知错误'), 'error'); return }
      const txt = r.data && r.data.text
      toast(txt ? '已发：' + String(txt).slice(0, 40) : '已发')
    } finally {
      setTesting(false)
    }
  }
  const writeDiary = async () => {
    setDiaryOpen(true)
    setDiaryBusy(true)
    setDiaryErr('')
    setDiaryText('')
    try {
      const r = await Api.post('/api/diary/generate', {})
      if (!r.ok) { setDiaryErr(r.error || '写失败'); return }
      const data = r.data || {}
      if (data.ok === false) { setDiaryErr(data.error || '还没写成（可能今天没有可写的内容）'); return }
      setDiaryText(String(data.text || '（空的）'))
    } finally {
      setDiaryBusy(false)
    }
  }
  return h(Card, {
    title: '心跳 / 主动消息 / 日记', sub: '她多久动一次、什么时候不打扰你',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 } },
      h(Field, { label: '启用生活', hint: '关掉后她不会自己走动/说话' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '空闲心跳', hint: '5–180 分钟' }, h(NumInput, { value: d.heartbeatMin, min: 5, max: 180, step: 5, onChange: (v) => f.patch({ heartbeatMin: v }), suffix: '分钟' })),
      h(Field, { label: '主动找你', hint: '0–10，越大越主动' }, h(Slider, { value: d.proactive, min: 0, max: 10, step: 1, onChange: (v) => f.patch({ proactive: v }) })),
      h(Field, { label: '智能安排', hint: '按天气/精力/记忆自动微调作息和活动' }, h(Toggle, { checked: !!d.smartLife, onChange: (v) => f.patch({ smartLife: v }), label: d.smartLife ? '开' : '关' })),

      h('div', { style: { gridColumn: '1 / -1', height: 0, borderTop: '1px solid ' + T.border, margin: '2px 0' } }),
      h(Field, { label: '主动消息', hint: '只在非安静时段、你没在聊的时候发；一句话' }, h(Toggle, { checked: !!d.proactiveEnabled, onChange: (v) => f.patch({ proactiveEnabled: v }), label: d.proactiveEnabled ? '开' : '关' })),
      h(Field, { label: '间隔（最小）', hint: '5–1440 分钟' }, h(NumInput, { value: d.proactiveMinMin, min: 5, max: 1440, step: 5, onChange: (v) => f.patch({ proactiveMinMin: v }), suffix: '分钟' })),
      h(Field, { label: '间隔（最大）' }, h(NumInput, { value: d.proactiveMaxMin, min: 5, max: 1440, step: 5, onChange: (v) => f.patch({ proactiveMaxMin: v }), suffix: '分钟' })),
      h(Field, { label: '试一条', hint: '真的会发到聊天里' },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: testing, onClick: () => { sendProactive().catch(() => {}) } }, testing ? '生成中…' : '让她主动发一条')),

      h('div', { style: { gridColumn: '1 / -1', height: 0, borderTop: '1px solid ' + T.border, margin: '2px 0' } }),
      h(Field, { label: '安静开始', hint: '0–23 时' }, h(NumInput, { value: d.quietStart, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietStart: v }), suffix: '时' })),
      h(Field, { label: '安静结束', hint: '这个时段她不主动打扰你' }, h(NumInput, { value: d.quietEnd, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietEnd: v }), suffix: '时' })),
      h(Field, { label: '写日记时间', hint: '0–23 时' }, h(NumInput, { value: d.diaryHour, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ diaryHour: v }), suffix: '时' })),
      h(Field, { label: '自动写日记' }, h(Toggle, { checked: !!d.diaryAuto, onChange: (v) => f.patch({ diaryAuto: v }), label: d.diaryAuto ? '开' : '关' })),
      h(Field, { label: '现在写今天的日记' },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: diaryBusy, onClick: () => { writeDiary().catch(() => {}) } }, diaryBusy ? '写日记中…' : '现在写一篇')),
      h(Note, { style: { gridColumn: '1 / -1' } }, '安静时段的含义：这期间她不主动找你（主动消息、看屏幕这类动作不会触发），但你找她她照常回。'),
    ) : (api.error ? null : h(Loading, { text: '读取生活设置…' })),
    h(Modal, {
      open: diaryOpen,
      title: '今天的日记',
      onClose: () => setDiaryOpen(false),
      footer: h(Btn, { size: 'sm', kind: 'primary', onClick: () => setDiaryOpen(false) }, '知道了'),
    },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        diaryErr ? h(ErrorBox, { error: diaryErr }) : null,
        diaryBusy ? h(Loading, { text: '她在写日记…' }) : null,
        diaryText
          ? h('div', {
              className: 'sbc-scroll',
              style: { maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: T.text, lineHeight: 1.85, border: '1px solid ' + T.border, borderRadius: T.radius, padding: '10px 12px', background: T.bg2 },
            }, diaryText)
          : null,
      ),
    ),
  )
}

// ───────────────────────── 生活：生活模拟（事件/照片） ─────────────────────────

function SettingsLifeSimCard() {
  const api = useApi('/api/life/settings')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(api, (d) => {
    const s = (d && d.settings) || {}
    return {
      enabled: s.enabled !== false,
      minEventGapMin: stgCoreInt(s.minEventGapMin, 5, 720, 90),
      maxDaily: stgCoreInt(s.maxDaily, 0, 100, 8),
      quietStart: stgCoreInt(s.quietStart, 0, 23, 23),
      quietEnd: stgCoreInt(s.quietEnd, 0, 23, 8),
      photoChance: stgCoreNum(s.photoChance, 0, 1, 0.25),
    }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      minEventGapMin: stgCoreInt(d.minEventGapMin, 5, 720, 90),
      maxDaily: stgCoreInt(d.maxDaily, 0, 100, 8),
      quietStart: stgCoreInt(d.quietStart, 0, 23, 23),
      quietEnd: stgCoreInt(d.quietEnd, 0, 23, 8),
      photoChance: stgCoreNum(d.photoChance, 0, 1, 0.25),
    }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life/settings', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('生活模拟已保存')
    f.patch(next)
    api.reload()
  })
  const photoPct = d ? Math.round(stgCoreNum(d.photoChance, 0, 1, 0.25) * 100) : 0
  return h(Card, {
    title: '生活模拟', sub: '她自己过日子时多久发生一次事件', tag: '含自拍/拍照概率',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 } },
      h(Field, { label: '启用生活模拟' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '两次事件最短间隔', hint: '5–720 分钟' }, h(NumInput, { value: d.minEventGapMin, min: 5, max: 720, step: 5, onChange: (v) => f.patch({ minEventGapMin: v }), suffix: '分钟' })),
      h(Field, { label: '每天最多事件', hint: '0–100 次' }, h(NumInput, { value: d.maxDaily, min: 0, max: 100, step: 1, onChange: (v) => f.patch({ maxDaily: v }), suffix: '次' })),
      h(Field, { label: '事件安静开始', hint: '生活事件不会落在这个时段' }, h(NumInput, { value: d.quietStart, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietStart: v }), suffix: '时' })),
      h(Field, { label: '事件安静结束' }, h(NumInput, { value: d.quietEnd, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietEnd: v }), suffix: '时' })),
      h(Field, { label: '拍照概率', hint: '事件里带照片的概率：' + photoPct + '%' },
        h(Slider, { value: stgCoreNum(d.photoChance, 0, 1, 0.25), min: 0, max: 1, step: 0.05, onChange: (v) => f.patch({ photoChance: v }) })),
      h(Note, { style: { gridColumn: '1 / -1' } }, '这个「安静时段」管的是生活事件（不会在睡觉时段突然发照片），和上一张卡片的「不主动打扰你」不是同一个开关。'),
    ) : (api.error ? null : h(Loading, { text: '读取生活模拟设置…' })),
  )
}

// ───────────────────────── 生活：场景活动（拍照） ─────────────────────────

function SettingsSceneCard() {
  const api = useApi('/api/scene/settings')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(api, (d) => {
    const s = (d || {})
    return { ai: s.ai !== false, photoChance: stgCoreNum(s.photoChance, 0, 1, 0.25) }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = { ai: !!d.ai, photoChance: stgCoreNum(d.photoChance, 0, 1, 0.25) }
    const payload = stgCoreDiff(f.base, next, ['ai', 'photoChance'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/scene/settings', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('场景活动设置已保存')
    f.patch(next)
    api.reload()
  })
  const photoPct = d ? Math.round(stgCoreNum(d.photoChance, 0, 1, 0.25) * 100) : 0
  return h(Card, {
    title: '场景活动', sub: '她在地点里做什么 / 要不要拍照给你看',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: 'AI 生成活动描述', hint: '关掉更省 token，但活动会更模板化' }, h(Toggle, { checked: !!d.ai, onChange: (v) => f.patch({ ai: v }), label: d.ai ? '开' : '关' })),
      h(Field, { label: '拍照概率', hint: '当前约 ' + photoPct + '%' },
        h(Slider, { value: stgCoreNum(d.photoChance, 0, 1, 0.25), min: 0, max: 1, step: 0.05, onChange: (v) => f.patch({ photoChance: v }) })),
      api.data ? h(Note, {}, '照片最短间隔 ' + (api.data.minGapMinutes || 5) + ' 分钟，同一场景缓存 ' + (api.data.cacheMinutes || 10) + ' 分钟。') : null,
    ) : (api.error ? null : h(Loading, { text: '读取场景设置…' })),
  )
}

// ───────────────────────── 生活：天气表现 ─────────────────────────

function SettingsWeatherFxRow(props) {
  const p = props || {}
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef(null)
  const cfg = p.cfg || null
  const upload = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const rd = await Api.readFileAsDataUrl(file, 20 * 1024 * 1024)
      if (!rd.ok) { toast(rd.error || '读取文件失败', 'error'); return }
      const r = await Api.upload('/api/weatherfx/upload', { kind: String(p.kind), dataUrl: rd.dataUrl })
      if (!r.ok) { toast('上传失败：' + (r.error || '未知错误'), 'error'); return }
      toast('「' + (p.label || p.kind) + '」的天气表现已更新')
      if (p.onChanged) p.onChanged()
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    const ok = await confirmDialog('把「' + (p.label || p.kind) + '」恢复成内置粒子效果？', {
      detail: '上传的图片/GIF/视频配置会被删掉。',
      danger: true,
      okText: '恢复内置',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await Api.post('/api/weatherfx', { kind: String(p.kind), clear: true })
      if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
      toast('已恢复内置效果')
      if (p.onChanged) p.onChanged()
    } finally {
      setBusy(false)
    }
  }
  return h(Row, { gap: 6, style: { padding: '3px 0' } },
    h('span', { style: { fontSize: 12.5, color: T.text, flex: '0 0 84px' } }, (p.icon ? p.icon + ' ' : '') + (p.label || p.kind)),
    h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: cfg ? T.ok : T.text3 } },
      cfg ? ('自定义' + (cfg.type === 'video' ? '（视频）' : '（图片）')) : '内置效果'),
    h(Btn, { size: 'sm', kind: 'ghost', disabled: busy, onClick: () => { if (fileRef.current) fileRef.current.click() } }, busy ? '处理中…' : '上传'),
    cfg ? h(Btn, { size: 'sm', kind: 'ghost', disabled: busy, onClick: () => { clear().catch(() => {}) } }, '恢复内置') : null,
    h('input', { ref: fileRef, type: 'file', accept: 'image/*,video/mp4,video/webm', style: { display: 'none' }, onChange: upload }),
  )
}

function SettingsWeatherCard() {
  const wx = useApi('/api/weather')
  const fx = useApi('/api/weatherfx')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(wx, (d) => {
    const s = d || {}
    return {
      mode: s.mode === 'real' ? 'real' : 'manual',
      manual: String(s.manual || 'sunny'),
    }
  })
  const d = f.draft
  const weathers = (wx.data && wx.data.weathers) || {}
  const kinds = (fx.data && fx.data.kinds) || Object.keys(weathers)
  const fxMap = (fx.data && fx.data.fx) || {}
  const manualOptions = Object.keys(weathers).map((k) => ({ value: k, label: (weathers[k].icon || '') + ' ' + (weathers[k].label || k) }))
  const save = () => run(async () => {
    if (!d || !f.base) return
    const payload = stgCoreDiff(f.base, { mode: d.mode, manual: d.manual }, ['mode', 'manual'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/weather', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('天气设置已保存')
    f.patch(d)
    wx.reload()
  })
  const cur = wx.data || null
  return h(Card, {
    title: '天气', sub: '手动选，或按真实天气', tag: '改完点保存',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!wx.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(wx.error, wx.reload),
    cur ? h(Row, { gap: 8, wrap: true, style: { padding: '4px 0' } },
      h(Badge, { tone: 'ok', title: '当前天气' }, (cur.icon || '') + ' ' + (cur.label || cur.kind || '—')),
      cur.source === 'real' ? h(Badge, { title: '按真实天气' }, '真实' + (cur.city ? ' · ' + cur.city : '') + (cur.temp !== null && cur.temp !== undefined ? ' · ' + cur.temp + '°C' : '')) : h(Badge, {}, '手动'),
    ) : (wx.error ? null : h(Loading, { text: '读取天气…' })),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: '天气来源', hint: '真实天气需要联网抓取，可能慢一两秒' },
        h(Select, { value: d.mode, onChange: (v) => f.patch({ mode: v }), options: [{ value: 'manual', label: '手动指定（推荐）' }, { value: 'real', label: '按真实天气' }] })),
      d.mode === 'manual'
        ? h(Field, { label: '现在是什么天气' }, h(Select, { value: d.manual, onChange: (v) => f.patch({ manual: v }), options: manualOptions }))
        : h(Note, {}, '按真实天气时，上面的「现在是什么天气」会自动跟着变。'),
    ) : null,
    h('div', { style: { borderTop: '1px solid ' + T.border, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 } },
      h(Row, { gap: 8, style: { marginBottom: 2 } },
        h('span', { style: { fontSize: 12.5, color: T.text, fontWeight: 600 } }, '天气表现'),
        h('span', { style: { fontSize: 11, color: T.text3 } }, '可上传图片 / GIF / 视频（≤20MB）；不传就用内置粒子'),
        h('span', { style: { flex: 1 } }),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!fx.error, onClick: fx.reload }, '刷新'),
      ),
      stgCoreErrBox(fx.error, fx.reload),
      kinds.length
        ? kinds.map((k) => h(SettingsWeatherFxRow, {
            key: 'fx-' + k,
            kind: k,
            label: (weathers[k] && weathers[k].label) || k,
            icon: (weathers[k] && weathers[k].icon) || '',
            cfg: fxMap[k] || null,
            onChanged: fx.reload,
          }))
        : (fx.error ? null : h(Note, {}, '正在读取天气表现…')),
    ),
  )
}

// ───────────────────────── 生活标签：把卡片拼起来 ─────────────────────────

function SettingsLifeTab() {
  const petOk = typeof PetCard === 'function'
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(SettingsLifeNowCard, {}),
      h(SettingsLifeHeartbeatCard, {}),
    ),
    h(SettingsLifeScheduleCard, {}),
    h(SettingsLifeActivityCard, {}),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(SettingsLifeSimCard, {}),
      h(SettingsSceneCard, {}),
    ),
    h(SettingsWeatherCard, {}),
    h(SettingsEconomyCard, {}),
    h(SettingsBalanceAlertCard, {}),
    petOk ? h(PetCard, {}) : h(Card, { title: '桌宠', sub: '把她放到桌面上' }, h(Note, {}, '桌宠卡片加载中…')),
  )
}

// ───────────────────────── 环境：权限 / 自检 / 自动看屏幕 ─────────────────────────

const STG_ENV_TARGETS = [
  { key: 'pc', icon: '🖥️', name: '你的电脑', desc: 'Windows 桌面：她可以截图看屏幕、用鼠标键盘点东西。' },
  { key: 'space', icon: '💻', name: '她自己的屏幕', desc: 'Linux 虚拟机：她自己的桌面，随便折腾。' },
  { key: 'phone', icon: '📱', name: '她自己的手机', desc: 'Android 模拟器：截图、点击、滑动、输入。' },
]
const STG_ENV_LEVELS = [
  { value: 'off', label: '关闭' },
  { value: 'gui', label: '仅鼠标键盘' },
  { value: 'code', label: '代码控制（危险）' },
]
const STG_ENV_LEVEL_LABEL = { off: '关闭', gui: '仅鼠标键盘', code: '代码控制' }

function SettingsEnvTab() {
  const env = useApi('/api/env')
  const watch = useApi('/api/watch-screen')
  const [busy, run] = stgCoreBusy()
  const [watchBusy, setWatchBusy] = React.useState(false)
  const [checkBusy, setCheckBusy] = React.useState(false)
  const [checkData, setCheckData] = React.useState(null)
  const [checkError, setCheckError] = React.useState('')
  const f = stgCoreDraft(env, (d) => {
    const e = (d && d.env) || {}
    return {
      pc: ['off', 'gui', 'code'].includes(e.pc) ? e.pc : 'gui',
      space: ['off', 'gui', 'code'].includes(e.space) ? e.space : 'gui',
      phone: ['off', 'gui', 'code'].includes(e.phone) ? e.phone : 'gui',
      confirmDanger: e.confirmDanger !== false,
      selfStart: e.selfStart === 'allow' ? 'allow' : 'deny',
    }
  })
  const d = f.draft
  const resources = (env.data && env.data.resources) || null
  const watchCfg = (watch.data && watch.data.watch) || null

  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      pc: d.pc, space: d.space, phone: d.phone,
      confirmDanger: !!d.confirmDanger,
      selfStart: d.selfStart === 'allow' ? 'allow' : 'deny',
    }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    // 危险变更二次确认（关掉权限 / 开代码控制都很敏感）
    const lines = []
    for (const t of STG_ENV_TARGETS) {
      if (payload[t.key] !== undefined && payload[t.key] !== f.base[t.key]) lines.push(t.name + '：' + STG_ENV_LEVEL_LABEL[f.base[t.key]] + ' → ' + STG_ENV_LEVEL_LABEL[payload[t.key]])
    }
    if (payload.selfStart !== undefined) lines.push('她自己开机：' + (payload.selfStart === 'allow' ? '允许' : '不允许'))
    const risky = (payload.pc === 'code' || payload.space === 'code' || payload.phone === 'code') || lines.length > 0
    if (risky && lines.length) {
      const ok = await confirmDialog('保存这些权限修改？', {
        title: '修改权限',
        detail: lines.join('\n') + '\n\n「关闭」她不能再用这个环境；「代码控制」可以直接执行命令、读写文件，只在你信任时开。',
        danger: payload.pc === 'code' || payload.space === 'code' || payload.phone === 'code',
        okText: '保存',
      })
      if (!ok) return
    }
    const r = await Api.post('/api/env', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('权限已保存，立即生效')
    f.patch(next)
    env.reload()
  })

  const toggleWatch = async () => {
    if (!watchCfg) return
    const next = !watchCfg.enabled
    if (next) {
      const ok = await confirmDialog('开启「她自己看你的屏幕」？', {
        title: '自动看屏幕',
        detail: '开启后她在你授权「用户的电脑」的前提下，每隔 20–40 分钟自己瞥一眼你在做什么；看到值得说的才提一句。会消耗少量 token。',
        okText: '开启',
      })
      if (!ok) return
    }
    setWatchBusy(true)
    try {
      const r = await Api.post('/api/watch-screen', { enabled: next })
      if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
      toast(next ? '已开启：她会偶尔看看你的屏幕' : '已关闭自动看屏幕')
      watch.reload()
    } finally {
      setWatchBusy(false)
    }
  }

  const runCheck = async () => {
    setCheckBusy(true)
    setCheckError('')
    try {
      const r = await Api.get('/api/env/check')
      if (!r.ok) { setCheckData(null); setCheckError(r.error || '自检失败'); return }
      setCheckData(r.data)
    } finally {
      setCheckBusy(false)
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    // 权限
    h(Card, {
      title: '她能操作哪些环境', sub: '按目标分开授权，权限分两级', tag: '保存后立即生效',
      actions: stgCoreSaveBtn({ disabled: !d || busy || !!env.error, busy: busy, onClick: save }),
    },
      stgCoreErrBox(env.error, env.reload),
      h(Note, {}, '「仅鼠标键盘」= 像人一样看屏幕、点鼠标、打字，安全；「代码控制」= 直接执行命令、读写文件，强大但危险，只在你信任时开。'),
      d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        STG_ENV_TARGETS.map((t) => h('div', {
          key: t.key,
          style: { border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
        },
          h(Row, { gap: 6, wrap: true },
            h('span', { style: { fontSize: 13, color: T.text, fontWeight: 600 } }, t.icon + ' ' + t.name),
            h('span', { style: { fontSize: 11, color: T.text3 } }, '当前：' + (STG_ENV_LEVEL_LABEL[d[t.key]] || '仅鼠标键盘')),
            h('span', { style: { flex: 1 } }),
            h(Row, { gap: 6 },
              STG_ENV_LEVELS.map((lv) => h(Chip, {
                key: lv.value,
                active: d[t.key] === lv.value,
                tone: lv.value === 'code' ? 'warn' : lv.value === 'off' ? 'danger' : undefined,
                onClick: () => f.patch({ [t.key]: lv.value }),
              }, lv.label)),
            ),
          ),
          h(Note, {}, t.desc),
        )),
        h(Row, { gap: 10, wrap: true, style: { borderTop: '1px solid ' + T.border, paddingTop: 8 } },
          h(Field, { label: '危险操作确认', inline: true, hint: '删除/关机/转账这类动作她先问你' },
            h(Toggle, { checked: !!d.confirmDanger, onChange: (v) => f.patch({ confirmDanger: v }), label: d.confirmDanger ? '开' : '关' })),
        ),
        h(Field, { label: '她自己能开机吗', hint: '允许后她可以自己启动屏幕/手机（会占 2~6GB 内存）' },
          h(Row, { gap: 6 },
            h(Chip, { active: d.selfStart === 'deny', onClick: () => f.patch({ selfStart: 'deny' }) }, '不允许（推荐）'),
            h(Chip, { active: d.selfStart === 'allow', tone: 'warn', onClick: () => f.patch({ selfStart: 'allow' }) }, '允许她自己开'),
          ),
        ),
      ) : (env.error ? null : h(Loading, { text: '读取权限设置…' })),
    ),

    // 环境自检
    h(Card, {
      title: '环境自检', sub: '环境不生效先点这里', tag: '要几秒',
      actions: h(Btn, { size: 'sm', kind: 'primary', disabled: checkBusy, onClick: () => { runCheck().catch(() => {}) } }, checkBusy ? '检查中…' : '开始自检'),
    },
      checkError ? h(ErrorBox, { error: checkError, onRetry: () => { runCheck().catch(() => {}) } }) : null,
      checkData
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            (checkData.checks || []).map((c) => h(Row, { key: String(c.id || c.label), gap: 6, align: 'flex-start' },
              h(Dot, { on: !!c.ok, tone: c.ok ? T.ok : T.danger, style: { marginTop: 6 } }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12.5, color: T.text } }, String(c.label || c.id || '')),
                h('div', { style: { fontSize: 11, color: T.text3, wordBreak: 'break-all' } }, String(c.detail || '')),
              ),
            )),
            (checkData.hints || []).length
              ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('div', { style: { fontSize: 12, color: T.warn } }, '建议：'),
                  (checkData.hints || []).map((hint, i) => h(Note, { key: 'hint' + i }, '· ' + String(hint))),
                )
              : h(Note, {}, '没有发现明显问题。'),
            checkData.paths && checkData.paths.version ? h(Note, {}, '运行时版本 ' + checkData.paths.version + ' · 数据目录 ' + (checkData.paths.dataRoot || '—')) : null,
          )
        : h(Note, {}, '还没检查。点右上角「开始自检」看看缺什么（只读检查，不会改任何东西）。'),
    ),

    // 自动看屏幕 + 资源
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(Card, { title: '她自己看你的屏幕', sub: '默认关闭', tag: '需要「你的电脑」权限' },
        stgCoreErrBox(watch.error, watch.reload),
        watchCfg ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h(Row, { gap: 8, wrap: true },
            h(Dot, { on: !!watchCfg.enabled, tone: watchCfg.enabled ? T.ok : T.idle }),
            h('span', { style: { fontSize: 12.5, color: T.text } }, watchCfg.enabled ? '已开启 · 约每 ' + (watchCfg.minMinutes || 20) + '–' + (watchCfg.maxMinutes || 40) + ' 分钟看一次' : '已关闭'),
            h('span', { style: { flex: 1 } }),
            h(Btn, { size: 'sm', kind: watchCfg.enabled ? 'ghost' : 'primary', disabled: watchBusy, onClick: () => { toggleWatch().catch(() => {}) } }, watchBusy ? '保存中…' : (watchCfg.enabled ? '关闭' : '开启')),
          ),
          h(Note, {}, '看到值得说的才自然提一句，没事就不打扰；不需要虚拟机/模拟器。'),
        ) : (watch.error ? null : h(Loading, { text: '读取看屏幕设置…' })),
      ),
      h(Card, { title: '环境占用', sub: '屏幕/手机是否在跑' },
        stgCoreErrBox(env.error, env.reload),
        resources
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h(Row, { gap: 6 }, h(Dot, { on: !!resources.space }), h('span', { style: { fontSize: 12.5, color: T.text } }, '她的屏幕：' + (resources.space ? '运行中' : '已关闭'))),
              h(Row, { gap: 6 }, h(Dot, { on: !!resources.phone }), h('span', { style: { fontSize: 12.5, color: T.text } }, '她的手机：' + (resources.phone ? '运行中' : '已关闭'))),
              (resources.mem || []).length ? h(Note, {}, '当前占用：' + (resources.mem || []).join(' · ')) : null,
              h(Note, {}, '启动 / 关闭屏幕和手机在「屏幕」标签里；屏幕虚拟机约占 2~6GB 内存，不用时建议关掉。'),
            )
          : (env.error ? null : h(Loading, { text: '读取资源状态…' })),
      ),
    ),

    h(Card, { title: '说明' },
      h(Note, {}, '· 代码控制是按目标分别开的：可以只给她的屏幕开，不给你的电脑开。'),
      h(Note, {}, '· 开了代码控制后，她的工具里会多一个 code 工具；关掉后立即消失。'),
      h(Note, {}, '· 人设里也会告诉她当前权限，她不会越权。'),
      h(Note, {}, '· 这里不启动/关闭虚拟机；看屏幕和手机开关请用「屏幕」标签。'),
    ),
  )
}

    /* ===== src/client/30-settings/settings-model.js ===== */
// 30-settings/settings-model.js —— 设置·模型卡片
//
// 内容：推理等级 / 模型参数 / DeepSeek API Key / 图片反馈 / 聊天风格 / 省 token /
//       上下文档位 / 最近用量
// 契约：function SettingsModelTab()（外壳不传 props，需要什么自己取接口；N02 不写死角色信息）
// 安全：API Key 只提交、不回显明文；「是否已配置」取 /api/status.setup.apiKeyOk
// 可靠性：读取失败时禁用保存（不拿默认值覆盖真实配置）；POST 只发改动字段；前端也 clamp（后端同样会 clamp）

const SETTINGS_MODEL_EFFORTS = [
  { value: 'low', label: '低', desc: '日常聊天够用，最省 token（推荐）' },
  { value: 'medium', label: '中', desc: '稍复杂一点的对话' },
  { value: 'high', label: '高', desc: '需要想清楚的问题、多步操作' },
  { value: 'max', label: '最高', desc: '专业编程、复杂逻辑，最费 token' },
]

const SETTINGS_MODEL_IMAGE_PROVIDERS = [
  { value: 'seedream', label: '火山 Seedream' },
  { value: 'openai-compat', label: 'OpenAI 兼容' },
  { value: 'http', label: '自定义 HTTP' },
]

const SETTINGS_MODEL_HISTORY_MODES = [
  { value: 'full', label: '完整历史（约 30 条）' },
  { value: 'short', label: '精简历史（约 8 条）' },
  { value: 'off', label: '不带历史' },
]

// 只把「和已保存值不同」的字段挑出来，POST 时不去覆盖没动的字段
function settingsModelChanged(cur, next, keys) {
  const out = {}
  for (const k of keys) {
    const a = cur ? cur[k] : undefined
    const b = next ? next[k] : undefined
    if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a) !== Number(b)) out[k] = b
    } else if (a !== b) {
      out[k] = b
    }
  }
  return out
}

function settingsModelUsageRows(usage) {
  if (!usage || typeof usage !== 'object') return []
  const rows = []
  const push = (k, label) => {
    const v = Number(usage[k])
    if (Number.isFinite(v)) rows.push(h(KV, { key: k, k: label, v: String(v) }))
  }
  push('prompt_tokens', '输入 tokens')
  push('completion_tokens', '输出 tokens')
  push('total_tokens', '合计 tokens')
  push('prompt_cache_hit_tokens', '缓存命中')
  push('prompt_cache_miss_tokens', '缓存未命中')
  return rows
}

function SettingsModelTab() {
  const status = useStatus()
  const st = (status && status.data) || {}
  const setup = st.setup || {}
  const tokens = st.tokens || {}
  const apiKeyOk = !!setup.apiKeyOk

  const modelApi = useApi('/api/model')
  const imageApi = useApi('/api/image/config')
  const styleApi = useApi('/api/chat-style')
  const savingApi = useApi('/api/token-saving')
  const ctxApi = useApi('/api/context')

  // ── 草稿状态（从接口数据同步；保存成功后由 reload 回写）─────────────────
  const [mName, setMName] = React.useState('')
  const [mTemp, setMTemp] = React.useState(0.9)
  const [mMaxTok, setMMaxTok] = React.useState(900)
  const [mSteps, setMSteps] = React.useState(20)
  const [keyInput, setKeyInput] = React.useState('')

  const [imgDraft, setImgDraft] = React.useState(null)
  const [imgKeyInput, setImgKeyInput] = React.useState('')

  const [ctxDraft, setCtxDraft] = React.useState({ historyMode: 'full', memoryInject: 8 })

  const [busy, setBusy] = React.useState('')

  const modelData = modelApi.data
  React.useEffect(() => {
    const m = modelData && modelData.model
    if (!m) return
    setMName(String(m.name || ''))
    setMTemp(clampNum(m.temperature, 0, 1.5, 0.9))
    setMMaxTok(Math.round(clampNum(m.maxTokens, 200, 8000, 900)))
    setMSteps(Math.round(clampNum(m.maxSteps, 4, 60, 20)))
  }, [modelData])

  const imageData = imageApi.data
  React.useEffect(() => {
    const c = imageData && imageData.config
    if (!c) return
    setImgDraft({
      provider: c.provider || 'seedream',
      baseURL: String(c.baseURL || ''),
      model: String(c.model || ''),
      size: String(c.size || '1024x1024'),
      watermark: !!c.watermark,
      enabled: !!c.enabled,
      apiKeySet: !!c.apiKeySet,
    })
    setImgKeyInput('')
  }, [imageData])

  const ctxData = ctxApi.data
  React.useEffect(() => {
    const c = ctxData && ctxData.context
    if (!c) return
    setCtxDraft({
      historyMode: ['full', 'short', 'off'].indexOf(String(c.historyMode)) >= 0 ? String(c.historyMode) : 'full',
      memoryInject: Math.round(clampNum(c.memoryInject, 2, 20, 8)),
    })
  }, [ctxData])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => {
    modelApi.reload()
    imageApi.reload()
    styleApi.reload()
    savingApi.reload()
    ctxApi.reload()
  }

  // ── 保存动作 ─────────────────────────────────────────────────────────
  const saveModelParams = () => run('model', async () => {
    if (modelApi.error) { toast('模型配置读取失败，先点「刷新」再保存', 'error'); return }
    const name = String(mName || '').trim()
    if (!name) { toast('模型名不能为空', 'error'); return }
    const next = {
      name,
      temperature: Math.round(clampNum(mTemp, 0, 1.5, 0.9) * 100) / 100,
      maxTokens: Math.round(clampNum(mMaxTok, 200, 8000, 900)),
      maxSteps: Math.round(clampNum(mSteps, 4, 60, 20)),
    }
    setMTemp(next.temperature)
    setMMaxTok(next.maxTokens)
    setMSteps(next.maxSteps)
    const body = settingsModelChanged(modelData && modelData.model, next, ['name', 'temperature', 'maxTokens', 'maxSteps'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/model', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('模型参数已保存')
    modelApi.reload()
  })

  const saveEffort = (value) => run('effort', async () => {
    if (modelApi.error) { toast('模型配置读取失败，先点「刷新」再保存', 'error'); return }
    const cur = (modelData && modelData.model) || {}
    if (cur.reasoningEffort === value) return
    const r = await Api.post('/api/model', { reasoningEffort: value })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    const hit = SETTINGS_MODEL_EFFORTS.filter((x) => x.value === value)[0]
    toast('推理等级已改为「' + (hit ? hit.label : value) + '」')
    modelApi.reload()
  })

  const saveApiKey = () => run('key', async () => {
    const key = String(keyInput || '').trim()
    if (key.length < 10) { toast('API Key 太短（至少 10 位）', 'error'); return }
    if (apiKeyOk) {
      const ok = await confirmDialog('覆盖已保存的 DeepSeek API Key？', {
        title: '覆盖 API Key',
        detail: '新 Key 保存后会立即生效；旧 Key 不会保留。',
        okText: '覆盖',
        danger: true,
      })
      if (!ok) return
    }
    const r = await Api.post('/api/model/key', { key })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    setKeyInput('')
    toast('API Key 已保存')
  })

  const setImgField = (k, v) => {
    setImgDraft((prev) => Object.assign({}, prev || {}, { [k]: v }))
  }

  const saveImageConfig = () => run('image', async () => {
    if (imageApi.error) { toast('图片配置读取失败，先点「刷新」再保存', 'error'); return }
    const d = imgDraft || {}
    const size = String(d.size || '').trim()
    if (!/^\d{2,5}x\d{2,5}$/.test(size)) { toast('尺寸格式应为 宽x高，例如 1024x1024', 'error'); return }
    const loaded = (imageData && imageData.config) || {}
    const next = {
      provider: String(d.provider || ''),
      baseURL: String(d.baseURL || '').trim(),
      model: String(d.model || '').trim(),
      size,
      watermark: !!d.watermark,
    }
    const body = settingsModelChanged(loaded, next, ['provider', 'baseURL', 'model', 'size', 'watermark'])
    const key = String(imgKeyInput || '').trim()
    if (key) body.apiKey = key
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/image/config', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    setImgKeyInput('')
    toast('图片反馈配置已保存')
    imageApi.reload()
  })

  const toggleImageEnabled = (next) => run('imageEnabled', async () => {
    if (imageApi.error) { toast('图片配置读取失败，先点「刷新」再保存', 'error'); return }
    const r = await Api.post('/api/image/config', { enabled: !!next })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '图片反馈已开启' : '图片反馈已关闭')
    imageApi.reload()
  })

  const toggleNoParens = (next) => run('style', async () => {
    if (styleApi.error) { toast('聊天风格读取失败，先点「刷新」再保存', 'error'); return }
    const r = await Api.post('/api/chat-style', { noParens: !!next })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '已开启无括号模式' : '已关闭无括号模式')
    styleApi.reload()
  })

  const toggleSaving = (key, next) => run('saving:' + key, async () => {
    if (savingApi.error) { toast('省 token 配置读取失败，先点「刷新」再保存', 'error'); return }
    const body = {}
    body[key] = !!next
    const r = await Api.post('/api/token-saving', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '已开启' : '已关闭')
    savingApi.reload()
  })

  const saveContext = () => run('context', async () => {
    if (ctxApi.error) { toast('上下文配置读取失败，先点「刷新」再保存', 'error'); return }
    const next = {
      historyMode: SETTINGS_MODEL_HISTORY_MODES.some((x) => x.value === ctxDraft.historyMode) ? ctxDraft.historyMode : 'full',
      memoryInject: Math.round(clampNum(ctxDraft.memoryInject, 2, 20, 8)),
    }
    setCtxDraft(next)
    const body = settingsModelChanged((ctxData && ctxData.context) || {}, next, ['historyMode', 'memoryInject'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/context', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('上下文档位已保存')
    ctxApi.reload()
  })

  // ── 渲染 ─────────────────────────────────────────────────────────────
  const model = (modelData && modelData.model) || {}
  const usage = modelData && modelData.usage
  const style = (styleApi.data && styleApi.data.style) || {}
  const saving = (savingApi.data && savingApi.data.saving) || {}
  const ctx = (ctxData && ctxData.context) || {}
  const img = imgDraft || {}
  const imgLoaded = (imageData && imageData.config) || {}
  const providerChanged = !!(imgDraft && imgLoaded.provider && imgDraft.provider !== imgLoaded.provider)
  const effortHit = SETTINGS_MODEL_EFFORTS.filter((x) => x.value === model.reasoningEffort)[0] || SETTINGS_MODEL_EFFORTS[0]

  const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, minWidth: 0 }

  const keyConfiguredBadge = h(Badge, { tone: apiKeyOk ? 'ok' : 'warn' }, apiKeyOk ? '已配置' : '未配置')

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：刷新 + 生效说明
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '修改后对下一条消息生效；这里的设置只影响本插件，不影响 DSH 其它会话。'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy, title: '重新读取模型 / 图片 / 风格 / 省 token / 上下文配置' }, '刷新'),
    ),

    // 推理等级
    h(Card, { title: '推理等级', tag: '只影响聊天回复', sub: '越高越慢、越费 token' },
      h(Row, { gap: 8 },
        SETTINGS_MODEL_EFFORTS.map((lv) => h(Chip, {
          key: lv.value,
          active: model.reasoningEffort === lv.value,
          title: lv.desc,
          onClick: busy ? undefined : () => saveEffort(lv.value),
        }, lv.label)),
      ),
      h(Note, {}, '当前：' + effortHit.label + ' —— ' + effortHit.desc),
      h(Note, {}, '记忆提取、日记、预览这些后台调用固定用「低」，不占这里的设置。'),
      modelApi.error ? h(ErrorBox, { title: '模型配置读取失败', error: modelApi.error, onRetry: modelApi.reload }) : null,
    ),

    // 模型参数
    h(Card, { title: '模型参数', tag: 'OpenAI 兼容接口', sub: model.name || '' },
      h('div', { style: cardGrid },
        h(Field, { label: '模型名' }, h(TextInput, { value: mName, onChange: setMName, placeholder: 'deepseek-flash', disabled: !!busy })),
        h(Field, { label: '温度', hint: '越高越随机，0.9 左右最自然（0 – 1.5）' },
          h(NumInput, { value: mTemp, onChange: setMTemp, min: 0, max: 1.5, step: 0.1, width: 96, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '单轮输出上限（tokens）', hint: '200 – 8000，越长越容易说完但更费 token' },
          h(NumInput, { value: mMaxTok, onChange: setMMaxTok, min: 200, max: 8000, step: 50, width: 110, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '工具循环上限（步）', hint: '一次最多连续调几次工具，4 – 60' },
          h(NumInput, { value: mSteps, onChange: setMSteps, min: 4, max: 60, step: 1, width: 96, disabled: !!busy, flex: true }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!modelApi.error, onClick: saveModelParams }, busy === 'model' ? '保存中…' : '保存模型参数'),
        h(Note, {}, '只验证过 DeepSeek 系列；换其它模型时工具循环/推理回传可能不兼容。'),
      ),
      modelApi.error ? h(ErrorBox, { title: '模型配置读取失败（读失败禁存）', error: modelApi.error, onRetry: modelApi.reload }) : null,
    ),

    // DeepSeek API Key
    h(Card, { title: 'DeepSeek API Key', tag: '独立运行 / 没装 DSH 时填这里', actions: keyConfiguredBadge },
      h(Row, { gap: 8, align: 'flex-end' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h(TextInput, {
            value: keyInput,
            onChange: setKeyInput,
            password: true,
            placeholder: apiKeyOk ? '已配置；要换 Key 就贴新的（不会显示原来的 Key）' : 'sk-…（只保存在本机数据目录）',
            disabled: !!busy,
            onEnter: () => { if (!busy) saveApiKey() },
          }),
        ),
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !String(keyInput || '').trim(), onClick: saveApiKey }, busy === 'key' ? '保存中…' : '保存 Key'),
      ),
      h(Note, {}, '为了安全，输入框永远不回显已保存的 Key；状态只看右边「已配置 / 未配置」。'),
      h(Note, {}, 'DSH 环境下会自动读取 DSH 的 Key，通常不用在这里填；只有脱离 DSH 单独跑运行时才必须填。'),
    ),

    // 图片反馈
    h(Card, {
      title: '🖼️ 图片反馈',
      sub: '她会在聊天里发图',
      actions: h(Row, { gap: 6 },
        h(Badge, { tone: img.apiKeySet ? 'ok' : 'warn' }, img.apiKeySet ? 'Key 已配置' : 'Key 未配置'),
        h(Badge, { tone: img.enabled ? 'ok' : 'warn' }, img.enabled ? '已开启' : '已关闭'),
      ),
    },
      h('div', { style: cardGrid },
        h(Field, { label: '服务' },
          h(Select, {
            value: img.provider || 'seedream',
            disabled: !!busy,
            onChange: (v) => setImgField('provider', v),
            options: SETTINGS_MODEL_IMAGE_PROVIDERS,
          }),
        ),
        h(Field, { label: 'Base URL' }, h(TextInput, { value: img.baseURL || '', onChange: (v) => setImgField('baseURL', v), disabled: !!busy, placeholder: 'https://…/api/v3' })),
        h(Field, { label: '模型' }, h(TextInput, { value: img.model || '', onChange: (v) => setImgField('model', v), disabled: !!busy, placeholder: '生图模型名' })),
        h(Field, { label: '尺寸', hint: '宽x高，例如 1024x1024' },
          h(TextInput, { value: img.size || '1024x1024', onChange: (v) => setImgField('size', v), disabled: !!busy, placeholder: '1024x1024' }),
        ),
      ),
      h(Row, { gap: 8, align: 'flex-end' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h(TextInput, {
            value: imgKeyInput,
            onChange: setImgKeyInput,
            password: true,
            placeholder: img.apiKeySet ? '生图 Key 已配置；要换就贴新的（留空保持原样）' : '生图服务 API Key（没配就贴这里）',
            disabled: !!busy,
          }),
        ),
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!imageApi.error, onClick: saveImageConfig }, busy === 'image' ? '保存中…' : '保存图片配置'),
      ),
      h(Note, {}, providerChanged ? '⚠️ 切换了服务，需要重新填生图 Key 再保存（旧 Key 对新服务可能无效）。' : '切换生图服务时旧 Key 可能对新服务无效，记得重新填。'),
      h(Row, { gap: 10 },
        h(Toggle, { checked: !!img.enabled, disabled: !!busy || !!imageApi.error, onChange: toggleImageEnabled, label: '聊天里允许发图（关闭后完全不调生图 API、不花钱）' }),
        h(Toggle, { checked: !!img.watermark, disabled: !!busy || !!imageApi.error, onChange: (v) => setImgField('watermark', v), label: '图片加水印' }),
      ),
      h(Note, {}, '自定义 HTTP 需返回 data[0].b64_json 或 data[0].url。'),
      imageApi.error ? h(ErrorBox, { title: '图片配置读取失败（读失败禁存）', error: imageApi.error, onRetry: imageApi.reload }) : null,
    ),

    // 聊天风格
    h(Card, { title: '聊天风格', tag: '影响她所有说话' },
      h(Toggle, {
        checked: !!style.noParens,
        disabled: !!busy || !!styleApi.error,
        onChange: toggleNoParens,
        label: '无括号模式：她不用括号写动作和表情，只直接说话',
      }),
      styleApi.error ? h(ErrorBox, { title: '聊天风格读取失败（读失败禁存）', error: styleApi.error, onRetry: styleApi.reload }) : null,
    ),

    // 省 token
    h(Card, { title: '🧠 省 token 开关', tag: '按需打开，随时关' },
      h(Toggle, {
        checked: !!saving.dynamicTools,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('dynamicTools', v),
        label: '按需给工具：闲聊时不带屏幕/手机/代码工具说明（关键词命中会自动带上）',
      }),
      h(Toggle, {
        checked: !!saving.compressImage,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('compressImage', v),
        label: '压缩工具结果：截图缩到 720 内、长输出截断，看屏幕更省',
      }),
      h(Toggle, {
        checked: !!saving.batchActions,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('batchActions', v),
        label: '批量动作：连续点击/输入一次提交（危险操作别开）',
      }),
      h(Note, {}, '实测（deepseek-flash）：只开「按需给工具」闲聊省约 42%；再开「压缩工具结果」看屏幕省约 24%；「批量动作」点两下省约 48%。'),
      savingApi.error ? h(ErrorBox, { title: '省 token 配置读取失败（读失败禁存）', error: savingApi.error, onRetry: savingApi.reload }) : null,
    ),

    // 上下文档位
    h(Card, { title: '上下文档位', tag: '省 token 的力度' },
      h('div', { style: cardGrid },
        h(Field, { label: '聊天历史' },
          h(Select, {
            value: ctxDraft.historyMode,
            disabled: !!busy || !!ctxApi.error,
            onChange: (v) => setCtxDraft((prev) => Object.assign({}, prev, { historyMode: v })),
            options: SETTINGS_MODEL_HISTORY_MODES,
          }),
        ),
        h(Field, { label: '每轮注入记忆（条）', hint: '2 – 20；精简历史会在需要时额外花一次便宜的摘要调用' },
          h(NumInput, {
            value: ctxDraft.memoryInject,
            onChange: (v) => setCtxDraft((prev) => Object.assign({}, prev, { memoryInject: v })),
            min: 2, max: 20, step: 1, width: 96, disabled: !!busy || !!ctxApi.error, flex: true,
          }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!ctxApi.error, onClick: saveContext }, busy === 'context' ? '保存中…' : '保存档位'),
        h(Note, {}, ctx.historyMode === 'off' ? '当前不带历史，最省但短期连贯性会差一点。' : '精简会在需要时生成「刚才聊到…」摘要；不带历史最省。'),
      ),
      ctxApi.error ? h(ErrorBox, { title: '上下文配置读取失败（读失败禁存）', error: ctxApi.error, onRetry: ctxApi.reload }) : null,
    ),

    // 最近用量
    h(Card, { title: '最近用量', sub: '最近一次模型调用与今日额度' },
      usage
        ? h('div', { style: cardGrid }, settingsModelUsageRows(usage))
        : h(Note, {}, '还没有产生模型调用用量。'),
      usage ? null : h(Note, {}, '发一条消息后再回来点「刷新」就能看到。'),
      (tokens.tokenMode || tokens.dailyUsed !== undefined || tokens.remainingTokens !== undefined)
        ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, marginTop: 2 } },
            tokens.dailyUsed !== undefined ? h(KV, { k: '今日消耗', v: String(tokens.dailyUsed) + ' tokens' }) : null,
            tokens.remainingTokens !== undefined ? h(KV, { k: '剩余额度', v: String(tokens.remainingTokens) + (tokens.tokenBudget ? ' / ' + tokens.tokenBudget : '') }) : null,
            tokens.realBalanceKnown && tokens.realRmb !== undefined ? h(KV, { k: 'DeepSeek 余额', v: '¥' + fmtMoney(tokens.realRmb, 2) }) : null,
            st.model ? h(KV, { k: '当前模型', v: String(st.model) }) : null,
          )
        : null,
      h(Note, {}, '这里的用量只统计本插件的模型调用；「她的零花」和 DeepSeek 真实余额不是同一笔钱。'),
    ),
  )
}

    /* ===== src/client/30-settings/settings-data.js ===== */
// 30-settings/settings-data.js —— 设置·数据卡片 + 记忆管理卡片
//
// 本文件提供两个组件（外壳/记忆标签按名字引用）：
//   · function SettingsDataTab()     数据标签：日记（生成/查看/给她看）、备份列表 + 一键备份 + 恢复、
//                                    数据目录/版本/数据修订信息、使用说明（教程 Modal）
//   · function SettingsMemoryCard()  记忆标签用：记忆统计/核心/普通/归档列表、置顶(=核心记忆增减)/
//                                    删除、文本导入、遗忘参数（本组件可单独嵌入任意标签）
// 契约：外壳不传 props，需要什么自己取接口（N02 不写死角色信息）
// 可靠性：读取失败时禁用写操作（读失败禁存）；危险操作（删除记忆/恢复备份）必须 confirmDialog；
//         恢复备份会覆盖数据 → 二次确认；所有 POST 只发改动字段；值前端 clamp（后端同样会 clamp）；
//         /api/memory/pin|delete|import 带 expectedRev，版本冲突(409) 时自动重读

// 只把「和已保存值不同」的字段挑出来，POST 时不去覆盖没动的字段
function settingsDataChanged(cur, next, keys) {
  const out = {}
  for (const k of keys) {
    const a = cur ? cur[k] : undefined
    const b = next ? next[k] : undefined
    if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a) !== Number(b)) out[k] = b
    } else if (a !== b) {
      out[k] = b
    }
  }
  return out
}

// 统计小方块（记忆卡片用）
function settingsDataStatBox(label, value, tone) {
  return h('div', {
    style: {
      border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
    },
  },
    h('div', { style: { fontSize: 19, fontWeight: 600, color: tone || T.text, lineHeight: 1.2 } }, String(value === undefined || value === null ? 0 : value)),
    h('div', { style: { fontSize: 10.5, color: T.text3 } }, label),
  )
}

// 单条记忆（带置顶/取消置顶、删除）
function settingsDataFactRow(f, handlers) {
  const pct = Math.round(clampNum(f.strength, 0, 1, 0) * 100)
  const pinned = !!f.pinned
  const disabled = !!handlers.disabled
  const tags = Array.isArray(f.tags) ? f.tags : []
  return h('div', {
    key: String(f.id),
    style: {
      border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2,
      padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
    },
  },
    h(Row, { gap: 6, align: 'flex-start', wrap: false },
      h('span', { style: { flex: 1, minWidth: 0, fontSize: 12.5, color: T.text, lineHeight: 1.6, wordBreak: 'break-word' } }, String(f.text || '')),
      h(Btn, { size: 'sm', kind: pinned ? 'ghost' : 'primary', disabled: disabled, onClick: () => handlers.onPin(f), title: pinned ? '取消置顶后按清晰度衰减' : '置顶后永远记得（核心记忆 +1）' }, pinned ? '取消置顶' : '置顶'),
      h(Btn, { size: 'sm', kind: 'danger', disabled: disabled, onClick: () => handlers.onDelete(f) }, '删除'),
    ),
    h(Row, { gap: 6, style: { fontSize: 10.5, color: T.text3, minWidth: 0 } },
      pinned ? h(Badge, { tone: 'warn' }, '置顶') : null,
      h('span', null, '清晰度 ' + pct + '%'),
      h('span', { style: { flex: '0 1 110px', minWidth: 40, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
        h('span', { style: { display: 'block', width: pct + '%', height: '100%', background: pinned ? T.warn : T.brand, borderRadius: 3 } }),
      ),
      h('span', null, '提到 ' + (Number(f.hitCount) || 1) + ' 次'),
      tags.length ? h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '· ' + tags.slice(0, 4).join(' / ')) : null,
    ),
  )
}

// 教程是纯文本 markdown（/api/tutorial），这里只做很轻的排版
function settingsDataTutorialBlocks(text) {
  const lines = String(text || '').split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const key = 'tut-' + i
    const strip = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1')
    if (line.indexOf('### ') === 0) blocks.push(h('div', { key, style: { fontSize: 13, fontWeight: 600, color: T.text, margin: '12px 0 3px' } }, strip(line.slice(4))))
    else if (line.indexOf('## ') === 0) blocks.push(h('div', { key, style: { fontSize: 14.5, fontWeight: 600, color: T.text, margin: '16px 0 5px' } }, strip(line.slice(3))))
    else if (line.indexOf('# ') === 0) blocks.push(h('div', { key, style: { fontSize: 16, fontWeight: 600, color: T.text, margin: '18px 0 8px' } }, strip(line.slice(2))))
    else if (line.indexOf('> ') === 0) blocks.push(h('div', { key, style: { fontSize: 12, color: T.text2, lineHeight: 1.7, padding: '3px 10px', borderLeft: '2px solid ' + T.border2, margin: '5px 0' } }, strip(line.slice(2))))
    else if (line.indexOf('- ') === 0) blocks.push(h('div', { key, style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7, paddingLeft: 14 } }, '· ' + strip(line.slice(2))))
    else if (!line) blocks.push(h('div', { key, style: { height: 6 } }))
    else blocks.push(h('div', { key, style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7 } }, strip(raw)))
  }
  return blocks
}

// ───────────────────────── 记忆管理卡片（记忆标签用） ─────────────────────────
// 自带 /api/memory 数据与全部状态：统计 4 格、核心/普通/归档列表、置顶/取消置顶、删除、
// 文本导入、遗忘参数。置顶 = 进入核心记忆（永不遗忘）；取消置顶后按清晰度衰减，核心数 -1。
function SettingsMemoryCard() {
  const memApi = useApi('/api/memory')

  const [memParams, setMemParams] = React.useState({ halfLifeDays: 5, forgetThreshold: 0.12, reinforceBoost: 0.22, maxInjected: 8 })
  const [showArchived, setShowArchived] = React.useState(false)
  const [factLimit, setFactLimit] = React.useState(30)
  const [importText, setImportText] = React.useState('')
  const [importImportance, setImportImportance] = React.useState(0.5)
  const [importPin, setImportPin] = React.useState(false)
  const [busy, setBusy] = React.useState('')

  // ── 同步遗忘参数草稿 ────────────────────────────────────────────────
  const memData = memApi.data
  React.useEffect(() => {
    const p = memData && memData.params
    if (!p) return
    setMemParams({
      halfLifeDays: clampNum(p.halfLifeDays, 0.5, 365, 5),
      forgetThreshold: clampNum(p.forgetThreshold, 0.01, 0.9, 0.12),
      reinforceBoost: clampNum(p.reinforceBoost, 0, 1, 0.22),
      maxInjected: Math.round(clampNum(p.maxInjected, 0, 100, 8)),
    })
  }, [memData])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  // ── 数据 ────────────────────────────────────────────────────────────
  const facts = (memApi.data && memApi.data.facts) || []
  const archived = (memApi.data && memApi.data.archived) || []
  const stats = (memApi.data && memApi.data.stats) || {}
  const params = (memApi.data && memApi.data.params) || {}
  const diaryDates = (memApi.data && memApi.data.diaryDates) || []
  const coreStrength = Number(params.coreStrength) || 0.85
  const coreFacts = facts.filter((f) => f.pinned || Number(f.strength) >= coreStrength)
  const normalFacts = facts.filter((f) => !(f.pinned || Number(f.strength) >= coreStrength))
  const memRev = () => {
    const rev = memApi.data && memApi.data.rev
    return rev && rev.rev !== undefined ? rev.rev : undefined
  }
  // 并发保护的兜底：409（别人刚改过 / 衰减落盘）时自动重读一次再重试一次，用户无感
  const postMemory = async (path, payload) => {
    let r = await Api.post(path, { ...payload, expectedRev: memRev() })
    if (r.status === 409) {
      try { await memApi.reload() } catch {}
      await new Promise((res) => setTimeout(res, 120))
      const fresh = (memApi.data && memApi.data.rev && memApi.data.rev.rev !== undefined) ? memApi.data.rev.rev : undefined
      if (fresh !== undefined) r = await Api.post(path, { ...payload, expectedRev: fresh })
    }
    return r
  }

  // ── 置顶 / 取消置顶（核心记忆 +1/-1）────────────────────────────────
  const togglePin = (f) => run('pin', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「重新读取」再操作', 'error'); return }
    const r = await postMemory('/api/memory/pin', { id: f.id })
    if (!r.ok) { toast(r.error || '操作失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast(f.pinned ? '已取消置顶（核心 -1，之后按清晰度衰减）' : '已置顶（核心 +1，永远记得）')
    memApi.reload()
  })

  // ── 删除（危险操作，二次确认）──────────────────────────────────────
  const deleteFact = (f) => run('deleteFact', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「重新读取」再操作', 'error'); return }
    const ok = await confirmDialog('删掉这条记忆？', { title: '删除记忆', detail: String(f.text || ''), danger: true, okText: '删除' })
    if (!ok) return
    const r = await postMemory('/api/memory/delete', { id: f.id })
    if (!r.ok) { toast(r.error || '删除失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast('已删除这条记忆（她不会再记得这件事）')
    memApi.reload()
  })

  const factHandlers = { disabled: !!busy || !!memApi.error, onPin: togglePin, onDelete: deleteFact }

  // ── 遗忘参数 ────────────────────────────────────────────────────────
  const saveMemParams = () => run('memParams', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「重新读取」再保存', 'error'); return }
    const next = {
      halfLifeDays: Math.round(clampNum(memParams.halfLifeDays, 0.5, 365, 5) * 10) / 10,
      forgetThreshold: Math.round(clampNum(memParams.forgetThreshold, 0.01, 0.9, 0.12) * 100) / 100,
      reinforceBoost: Math.round(clampNum(memParams.reinforceBoost, 0, 1, 0.22) * 100) / 100,
      maxInjected: Math.round(clampNum(memParams.maxInjected, 0, 100, 8)),
    }
    setMemParams(next)
    const body = settingsDataChanged(params, next, ['halfLifeDays', 'forgetThreshold', 'reinforceBoost', 'maxInjected'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/memory/params', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('遗忘参数已保存')
    memApi.reload()
  })

  // ── 文本导入 ────────────────────────────────────────────────────────
  const importMemory = () => run('import', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「重新读取」再导入', 'error'); return }
    const text = String(importText || '').trim()
    if (!text) { toast('先粘贴要导入的记忆文本', 'error'); return }
    const ok = await confirmDialog('导入这些记忆？', {
      title: '导入记忆',
      detail: '会按行/句子拆分、去重并合并到现有记忆（单次最多 500 条）。',
      okText: '导入',
    })
    if (!ok) return
    const r = await Api.post('/api/memory/import', {
      text,
      importance: clampNum(importImportance, 0, 1, 0.5),
      pinNew: !!importPin,
      expectedRev: memRev(),
    })
    if (!r.ok) { toast(r.error || '导入失败', 'error'); if (r.status === 409) memApi.reload(); return }
    const d = r.data || {}
    toast('导入完成：解析 ' + (Number(d.total) || 0) + ' 条，新增 ' + (Number(d.added) || 0) + '，合并 ' + (Number(d.merged) || 0))
    setImportText('')
    memApi.reload()
  })

  // ── 渲染 ────────────────────────────────────────────────────────────
  const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, minWidth: 0 }
  const formGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, minWidth: 0 }
  const normals = normalFacts.slice(0, factLimit)
  const hiddenCount = Math.max(0, normalFacts.length - normals.length)

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 统计 + 核心/普通/归档列表
    h(Card, {
      title: '记忆条目',
      tag: '按半衰期淡忘，提到会加深；置顶 = 核心记忆（永不遗忘）',
      actions: h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: memApi.reload, title: '重新读取记忆列表' }, '重新读取'),
    },
      h(Note, {}, '「置顶」= 把这条放进核心记忆（不遗忘）；「取消置顶」= 放回普通记忆，之后按清晰度慢慢衰减。'),
      h('div', { style: statGrid },
        settingsDataStatBox('活着的记忆', Number(stats.live) || 0),
        settingsDataStatBox('核心（不遗忘）', Number(stats.core) || 0, T.warn),
        settingsDataStatBox('已模糊归档', Number(stats.archived) || 0, T.text2),
        settingsDataStatBox('日记篇数', diaryDates.length),
      ),
      memApi.error ? h(ErrorBox, { title: '记忆读取失败（读失败禁写）', error: memApi.error, onRetry: memApi.reload }) : null,
      memApi.data
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
            h('div', { style: { fontSize: 12, color: T.text2, marginTop: 2 } }, '核心记忆（' + coreFacts.length + '）'),
            coreFacts.length
              ? coreFacts.map((f) => settingsDataFactRow(f, factHandlers))
              : h(Note, {}, '还没有核心记忆。重要的事可以「置顶」，置顶后永远记得。'),
            h('div', { style: { fontSize: 12, color: T.text2, marginTop: 4 } }, '普通记忆（' + normalFacts.length + '）'),
            normalFacts.length
              ? normals.map((f) => settingsDataFactRow(f, factHandlers))
              : h(Note, {}, '暂无普通记忆。'),
            hiddenCount > 0
              ? h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setFactLimit((n) => n + 50) }, '再显示 50 条（还有 ' + hiddenCount + ' 条）')
              : null,
            archived.length
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
                  h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setShowArchived((v) => !v) }, (showArchived ? '收起' : '查看') + '归档（' + archived.length + '）'),
                  showArchived
                    ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' } },
                        archived.map((f) => h('div', { key: String(f.id), style: { fontSize: 11.5, color: T.text3, lineHeight: 1.6, borderLeft: '2px solid ' + T.border, paddingLeft: 8 } },
                          String(f.text || '') + '（清晰度 ' + Math.round(clampNum(f.strength, 0, 1, 0) * 100) + '%）',
                        )),
                      )
                    : null,
                )
              : null,
          )
        : h(Note, {}, memApi.loading ? '记忆加载中…' : '还没有读到记忆，点「重新读取」再试。'),
    ),

    // 遗忘参数
    h(Card, { title: '遗忘参数', tag: '影响所有普通记忆' },
      h('div', { style: formGrid },
        h(Field, { label: '半衰期（天）', hint: '0.5 – 365；越短忘得越快，核心记忆不受影响' },
          h(NumInput, { value: memParams.halfLifeDays, onChange: (v) => setMemParams((p) => Object.assign({}, p, { halfLifeDays: v })), min: 0.5, max: 365, step: 0.5, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '遗忘阈值', hint: '0.01 – 0.9；清晰度低于它就归档' },
          h(NumInput, { value: memParams.forgetThreshold, onChange: (v) => setMemParams((p) => Object.assign({}, p, { forgetThreshold: v })), min: 0.01, max: 0.9, step: 0.01, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '提到时强化', hint: '0 – 1；对话里再次提到时加多少清晰度' },
          h(NumInput, { value: memParams.reinforceBoost, onChange: (v) => setMemParams((p) => Object.assign({}, p, { reinforceBoost: v })), min: 0, max: 1, step: 0.05, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '每轮最多注入（条）', hint: '0 – 100；还受「模型 → 上下文档位」里的每轮注入条数限制' },
          h(NumInput, { value: memParams.maxInjected, onChange: (v) => setMemParams((p) => Object.assign({}, p, { maxInjected: v })), min: 0, max: 100, step: 1, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!memApi.error, onClick: saveMemParams }, busy === 'memParams' ? '保存中…' : '保存参数'),
        h(Note, {}, '改完立刻生效，不用重启。'),
      ),
      memApi.error ? h(ErrorBox, { title: '参数读取失败（读失败禁存）', error: memApi.error, onRetry: memApi.reload }) : null,
    ),

    // 导入记忆
    h(Card, { title: '导入记忆', tag: 'txt / md / json / jsonl 纯文本' },
      h(TextArea, {
        value: importText,
        onChange: setImportText,
        rows: 4,
        placeholder: '每行一条；也可以直接粘贴 JSON（会被拆句去重）。例如：\n用户喜欢猫，讨厌狗\n用户最近在写作业',
        disabled: !!busy,
      }),
      h('div', { style: formGrid },
        h(Field, { label: '重要度', hint: '0 – 1；≥0.95 会自动置顶' },
          h(NumInput, { value: importImportance, onChange: setImportImportance, min: 0, max: 1, step: 0.05, width: 100, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '导入后置顶', hint: '新导入的记忆立刻变成核心记忆' },
          h(Toggle, { checked: !!importPin, disabled: !!busy, onChange: setImportPin, label: importPin ? '会置顶' : '不置顶' }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!memApi.error, onClick: importMemory }, busy === 'import' ? '导入中…' : '导入这些记忆'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !String(importText || '').trim(), onClick: () => { setImportText(''); setImportPin(false); setImportImportance(0.5) } }, '清空'),
      ),
      h(Note, {}, '导入会合并相似记忆、去重；不会删除或覆盖已有记忆。'),
    ),
  )
}

// ───────────────────────── 数据标签 ─────────────────────────
// 记忆管理已移到「记忆」标签（SettingsMemoryCard），这里只留日记/备份/数据目录/版本/教程。
function SettingsDataTab() {
  const status = useStatus()
  const st = (status && status.data) || {}
  const setup = st.setup || {}

  const diaryApi = useApi('/api/diary')
  const backupApi = useApi('/api/backup/list')

  const [verInfo, setVerInfo] = React.useState(null)
  const [revInfo, setRevInfo] = React.useState(null)
  const [revError, setRevError] = React.useState('')

  const [diaryModal, setDiaryModal] = React.useState({ open: false, title: '', text: '', loading: false, error: '' })
  const [tutModal, setTutModal] = React.useState({ open: false, loading: false, text: '', error: '' })

  const [busy, setBusy] = React.useState('')

  // ── 版本 / 数据修订（/api/version 是冻结契约，老运行时可能 404 → 静默降级）──
  const loadMeta = React.useCallback(() => {
    Api.get('/api/version').then((r) => { setVerInfo(r.ok && r.data ? r.data : null) }).catch(() => setVerInfo(null))
    Api.get('/api/data/revisions').then((r) => {
      if (r.ok && r.data) { setRevInfo(r.data); setRevError('') } else { setRevInfo(null); setRevError(r.error || '读取失败') }
    }).catch((e) => { setRevInfo(null); setRevError((e && e.message) || '读取失败') })
  }, [])
  React.useEffect(() => { loadMeta() }, [loadMeta])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => {
    diaryApi.reload()
    backupApi.reload()
    loadMeta()
  }

  // ── 日记 ────────────────────────────────────────────────────────────
  const diaryDates = (diaryApi.data && diaryApi.data.dates) || []

  const openDiary = async (date) => {
    setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: true, error: '' })
    try {
      const r = await Api.get('/api/diary?date=' + encodeURIComponent(date))
      if (!r.ok) { setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: false, error: r.error || '读取失败' }); return }
      const text = String((r.data && r.data.text) || '')
      setDiaryModal({ open: true, title: '日记 · ' + date, text: text || '（这篇日记是空的）', loading: false, error: '' })
    } catch (e) {
      setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: false, error: (e && e.message) || '读取失败' })
    }
  }

  const generateDiary = () => run('diaryGen', async () => {
    if (diaryApi.error) { toast('日记列表读取失败，先点「刷新」再生成', 'error'); return }
    const ok = await confirmDialog('现在生成今天的日记？', {
      title: '生成日记',
      detail: '会调用一次模型（消耗少量 token）；今天已经有日记时直接显示已有的。',
      okText: '生成',
    })
    if (!ok) return
    const r = await Api.post('/api/diary/generate', {}, { timeoutMs: 120000 })
    if (!r.ok) { toast('生成失败：' + (r.error || '未知错误'), 'error'); return }
    const text = String((r.data && r.data.text) || '')
    if (!text) { toast('生成失败（模型没有返回内容）', 'error'); return }
    toast('今天的日记已生成')
    setDiaryModal({ open: true, title: '今天的日记', text, loading: false, error: '' })
    diaryApi.reload()
  })

  const showDiaryToHer = () => run('diaryShow', async () => {
    const ok = await confirmDialog('把今天的日记发到聊天里给她看？', { title: '给她看日记', detail: '会在聊天记录里加一条「她把日记给你看了」。', okText: '发给她' })
    if (!ok) return
    const r = await Api.post('/api/diary/show', {})
    if (!r.ok) { toast(r.error || '发送失败', 'error'); return }
    if (r.data && r.data.ok === false) { toast(r.data.error || '今天还没写日记', 'error'); return }
    toast('已把今天的日记给她看')
  })

  // ── 备份 ────────────────────────────────────────────────────────────
  const backups = (backupApi.data && backupApi.data.backups) || []
  const backupDir = (backupApi.data && backupApi.data.dir) || ''

  const doBackup = () => run('backup', async () => {
    const ok = await confirmDialog('现在备份数据目录？', {
      title: '立即备份',
      detail: '会打包成 zip 写到数据目录下的 backups；数据大时可能要几分钟。',
      okText: '开始备份',
    })
    if (!ok) return
    const r = await Api.post('/api/backup', {}, { timeoutMs: 300000 })
    if (!r.ok) { toast('备份失败：' + (r.error || '未知错误'), 'error'); return }
    if (r.data && r.data.ok === false) { toast('备份失败：' + (r.data.error || '未知错误'), 'error'); return }
    toast((r.data && r.data.message) || '备份完成')
    backupApi.reload()
  })

  const restoreBackup = (name) => run('restore', async () => {
    const ok1 = await confirmDialog('恢复备份 ' + name + '？', {
      title: '恢复备份',
      detail: '会覆盖当前的角色、配置、记忆、日记和聊天数据。建议先「立即备份」一次再恢复。',
      danger: true,
      okText: '继续',
    })
    if (!ok1) return
    const ok2 = await confirmDialog('最后确认：真的要恢复这个备份吗？', {
      title: '最后确认',
      detail: '恢复过程中不要关闭 DSH；完成后需要重启 DSH 让运行时重新加载数据。',
      danger: true,
      okText: '恢复',
    })
    if (!ok2) return
    const r = await Api.post('/api/backup/restore', { name }, { timeoutMs: 300000 })
    if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
    if (r.data && r.data.ok === false) {
      toast('恢复失败：' + (r.data.error || '未知错误'), 'error')
      return
    }
    const msg = (r.data && r.data.message) || '恢复完成，请重启 DSH 让运行时重新加载数据'
    toast('恢复完成')
    await alertDialog(msg, { title: '恢复完成' })
    backupApi.reload()
  })

  // ── 目录 / 版本 ─────────────────────────────────────────────────────
  const dataRoot = String(setup.dataRoot || '')
  const dataDir = dataRoot ? dataRoot.replace(/[\\/]+$/, '') + '\\data' : ''
  const copyDataRoot = async () => {
    if (!dataRoot) { toast('还没拿到数据目录', 'error'); return }
    try {
      await navigator.clipboard.writeText(dataRoot)
      toast('数据目录已复制')
    } catch (e) {
      toast(dataRoot)
    }
  }

  // ── 教程 ────────────────────────────────────────────────────────────
  const openTutorial = async () => {
    setTutModal({ open: true, loading: true, text: '', error: '' })
    try {
      const r = await Api.get('/api/tutorial')
      if (!r.ok) { setTutModal({ open: true, loading: false, text: '', error: r.error || '读取失败' }); return }
      setTutModal({ open: true, loading: false, text: String((r.data && r.data.text) || ''), error: '' })
    } catch (e) {
      setTutModal({ open: true, loading: false, text: '', error: (e && e.message) || '读取失败' })
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  const revEntityCount = revInfo && revInfo.entities ? Object.keys(revInfo.entities).length : 0
  const revAt = revInfo && revInfo.updatedAt ? Date.parse(revInfo.updatedAt) : 0
  const deviceShort = revInfo && revInfo.deviceId ? String(revInfo.deviceId).slice(0, 8) : ''

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：刷新
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '日记/备份都直接读写本机运行时数据目录；危险操作都会二次确认。'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy, title: '重新读取日记 / 备份 / 版本' }, '刷新'),
    ),

    // 记忆管理已移到「记忆」标签
    h(Note, {}, '记忆条目的查看/置顶/删除/导入、遗忘参数在「记忆」标签里管理；这里是日记、备份、数据目录、版本与教程。'),

    // 日记
    h(Card, { title: '日记', tag: '她每天写一篇' },
      diaryApi.error
        ? h(ErrorBox, { title: '日记列表读取失败', error: diaryApi.error, onRetry: diaryApi.reload })
        : (diaryDates.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                diaryDates.slice(0, 30).map((d) => h(Btn, { key: String(d), size: 'sm', kind: 'ghost', disabled: !!busy, onClick: () => openDiary(String(d)) }, String(d))),
              )
            : h(Note, {}, diaryApi.loading ? '日记加载中…' : '还没有日记；点「生成今天的日记」试试。')),
      h(Row, { gap: 8, style: { marginTop: 2 } },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!diaryApi.error, onClick: generateDiary }, busy === 'diaryGen' ? '生成中…（可能要十几秒）' : '生成今天的日记'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: showDiaryToHer }, '把今天的日记给她看'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: diaryApi.reload }, '刷新日记'),
      ),
      h(Note, {}, '日记生成会调用一次模型；完整日记只保存在本机数据目录。'),
    ),

    // 备份与恢复
    h(Card, {
      title: '备份与恢复',
      tag: '恢复会覆盖当前数据',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy, onClick: doBackup }, busy === 'backup' ? '备份中…' : '立即备份'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !!backupApi.error, onClick: backupApi.reload }, '刷新列表'),
      ),
    },
      h(Note, {}, '导出把数据目录打包成 zip；系统每天凌晨 4 点后会自动备份一次。恢复会覆盖角色/配置/记忆/日记/聊天数据，恢复后需要重启 DSH。'),
      backupApi.error ? h(ErrorBox, { title: '备份列表读取失败', error: backupApi.error, onRetry: backupApi.reload }) : null,
      backupApi.loading && !backupApi.data ? h(Loading, { text: '备份列表加载中…' }) : null,
      backupApi.data
        ? (backups.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 } },
                backups.map((b) => h('div', {
                  key: String(b.name),
                  style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid ' + T.border, minWidth: 0 },
                },
                  h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, color: T.text, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(b.name)),
                  h('span', { style: { fontSize: 11, color: T.text3, whiteSpace: 'nowrap' } }, fmtDateTime(b.at) + ' · ' + fmtBytes(b.size)),
                  h(Btn, { size: 'sm', kind: 'danger', disabled: !!busy, onClick: () => restoreBackup(String(b.name)), title: '恢复这个备份（会覆盖当前数据）' }, busy === 'restore' ? '恢复中…' : '恢复'),
                )),
              )
            : h(Empty, { icon: '🗂️' }, '还没有备份；点「立即备份」生成第一个。'))
        : h(Note, {}, backupApi.loading ? '备份列表加载中…' : '还没读到备份列表，点「刷新列表」再试。'),
      backupDir ? h(Note, {}, '备份目录：' + backupDir) : null,
    ),

    // 数据目录 / 版本
    h(Card, {
      title: '数据目录与版本',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: copyDataRoot, disabled: !dataRoot }, '复制数据目录'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { Api.openExternal('/api/version') } }, '打开版本信息'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: loadMeta }, '刷新'),
      ),
    },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 8, minWidth: 0 } },
        h(KV, { k: '数据根目录', v: dataRoot || '读取中…', mono: true }),
        h(KV, { k: '数据子目录', v: dataDir || '读取中…', mono: true }),
        h(KV, { k: '运行时版本', v: st.version || '—' }),
        h(KV, { k: '插件版本', v: (typeof CLIENT_BUILD === 'object' && CLIENT_BUILD && CLIENT_BUILD.pluginVersion) ? String(CLIENT_BUILD.pluginVersion) : '—' }),
        h(KV, { k: 'API 契约版本', v: verInfo && verInfo.apiVersion !== undefined ? String(verInfo.apiVersion) : '运行时未提供 /api/version' }),
        h(KV, { k: '备份目录', v: backupDir || '读取中…', mono: true }),
      ),
      h(Divider, {}),
      revError
        ? h(ErrorBox, { title: '数据修订信息读取失败', error: revError, onRetry: loadMeta })
        : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 8, minWidth: 0 } },
            h(KV, { k: '同步格式版本', v: revInfo && revInfo.version !== undefined ? String(revInfo.version) : '—' }),
            h(KV, { k: '设备 ID', v: deviceShort ? deviceShort + '…' : '—', mono: true }),
            h(KV, { k: '数据实体数', v: revInfo ? String(revEntityCount) : '—' }),
            h(KV, { k: '最近更新时间', v: revAt ? fmtDateTime(revAt) : '—' }),
          ),
      h(Note, {}, '版本信息来自运行时 /api/status 与 /api/version（老运行时没有 /api/version 时显示「运行时未提供」，不影响其它功能）。'),
    ),

    // 使用说明
    h(Card, { title: '使用说明', tag: '教程全文' },
      h(Row, { gap: 8 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: openTutorial }, '查看完整教程'),
        h(Note, {}, '教程内容由运行时 /api/tutorial 提供，不请求任何 HTML 页面。'),
      ),
    ),

    // 日记弹层
    h(Modal, {
      open: !!diaryModal.open,
      title: diaryModal.title || '日记',
      onClose: () => setDiaryModal({ open: false, title: '', text: '', loading: false, error: '' }),
      footer: h(Btn, { kind: 'ghost', onClick: () => setDiaryModal({ open: false, title: '', text: '', loading: false, error: '' }) }, '关闭'),
    },
      diaryModal.loading
        ? h(Loading, { text: '日记读取中…' })
        : (diaryModal.error
            ? h(ErrorBox, { title: '读取失败', error: diaryModal.error })
            : h('div', { style: { fontSize: 13, color: T.text, lineHeight: 1.9, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, diaryModal.text)),
    ),

    // 教程弹层
    h(Modal, {
      open: !!tutModal.open,
      title: '使用说明',
      width: 720,
      onClose: () => setTutModal({ open: false, loading: false, text: '', error: '' }),
      footer: h(Btn, { kind: 'ghost', onClick: () => setTutModal({ open: false, loading: false, text: '', error: '' }) }, '关闭'),
    },
      tutModal.loading
        ? h(Loading, { text: '教程加载中…' })
        : (tutModal.error
            ? h(ErrorBox, { title: '教程读取失败', error: tutModal.error, onRetry: openTutorial })
            : h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, settingsDataTutorialBlocks(tutModal.text))),
    ),
  )
}

    /* ===== src/client/30-settings/settings-direct.js ===== */
// 设置里的两块新卡片：
//  1) DirectChatCard —— 聊天软件直连（OneBot 11 HTTP 适配器）：插件只负责连「用户自己跑的 OneBot 实现」，
//     不内置、不捆绑、不绑定任何具体桥（QQ 风控风险由用户自己决定用哪个桥）。
//  2) UpdateCard —— 插件自动更新：检查 npm 上的新版本；git 检出可一键更新，npm/DSH 安装只提示。

// ---------- 直连 ----------
function DirectChatCard() {
  const [s, setS] = React.useState(null)
  const [st, setSt] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [diag, setDiag] = React.useState('')

  const load = React.useCallback(() => {
    Api.get('/api/direct-chat/settings').then((r) => {
      if (r.ok && r.data) { setS(r.data.settings || null); setSt(r.data.status || null); setErr('') }
      else setErr(r.error || '直连模块不可用')
    })
  }, [])
  React.useEffect(load, [load])
  const patch = (k, v) => setS((prev) => Object.assign({}, prev || {}, { [k]: v }))
  const save = async () => {
    if (!s) return
    setBusy('save')
    const r = await Api.post('/api/direct-chat/settings', s)
    setBusy('')
    if (!r.ok) { toast(r.error || '保存失败', 'error'); return }
    setS(r.data.settings || s)
    toast('直连设置已保存')
    refresh()
  }
  const refresh = async () => {
    setBusy('status'); setDiag('')
    const r = await Api.get('/api/direct-chat/status')
    setBusy('')
    if (r.ok && r.data && r.data.status) setSt(r.data.status)
    setDiag(r.ok ? (r.data.status && r.data.status.ok ? '连接正常' : ('连接失败：' + ((r.data.status && r.data.status.error) || '未知'))) : (r.error || '读取失败'))
  }
  const sendTest = async () => {
    const text = await promptDialog('发一条测试消息到直连的 QQ（会以她的身份真实发送）', {
      title: '直连测试消息',
      okText: '发送',
      value: '（测试消息）来自屏幕彼端的直连测试，收到不用回～',
    })
    if (!text) return
    setBusy('send'); setDiag('')
    const r = await Api.post('/api/direct-chat/test', { sendTest: true, text })
    setBusy('')
    const ok = !!(r.ok && r.data && r.data.status && r.data.status.ok)
    if (r.data && r.data.status) setSt(r.data.status)
    if (r.ok && r.data && r.data.send) {
      setDiag(r.data.send.ok ? ('已发送（messageId ' + String(r.data.send.messageId || '') + '）') : ('发送失败：' + (r.data.send.error || '')))
      toast(r.data.send.ok ? '测试消息已发出' : ('发送失败：' + (r.data.send.error || '')), r.data.send.ok ? 'success' : 'error')
    } else {
      setDiag(ok ? '连接正常，但没发消息' : '连接失败')
    }
  }

  const login = (st && st.login) || null
  return h(Card, {
    title: '聊天软件直连（OneBot 11）',
    sub: '不经过虚拟机看屏幕；插件只连你自己跑的 OneBot 实现',
    tag: s ? (s.enabled ? '已开启' : '未开启') : '读取中',
  },
    err ? h(ErrorBox, { error: err, onRetry: load }) : null,
    h(Note, {}, '需要本机已经有一个 OneBot 11 实现（HTTP 接口），填它的地址和 token。注意：NapCat 已下架、Lagrange 官方签名服务已停、LLOneBot 转收费，现成能直接用的桥越来越少。'),
    h(Note, {}, '自建桥（研究分支已打通，可选）：QQ 9.9.37 便携副本 + 开源注入器 TzdInjectorNTQQ（LGPL，内存注入、不改 QQ 文件）+ 本地 OneBot 11 子集（默认 127.0.0.1:3010）。装什么、注意什么、怎么改，见插件目录下的 docs/DIRECT-CHAT.md（桥代码在 docs/self-bridge/）。'),
h(Note, { style: { color: T.warn || T.danger } }, '自建桥注意：① 注入类方案有账号风险，只建议给小号用；② QQ 重启后要重跑 start-bridge.ps1（内存注入，不是服务）；③ 目前只支持单个会话的文本消息（图片/群聊未做）；④ 插件不内置也不启动这个桥，装不装由你决定。'),
    h(Note, {}, '插件不内置、不捆绑任何桥；QQ 风控/封号风险由你选择的桥承担。不想用直连就保持关闭，原来的虚拟机看屏幕通道照常可用。'),
    s ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '开启直连', hint: '开启后主动消息优先走直连' }, h(Toggle, { value: !!s.enabled, onChange: (v) => patch('enabled', v) })),
        h(Field, { label: '允许自动回复', hint: '收到私聊消息后由她生成回复并回过去' }, h(Toggle, { value: s.autoReply !== false, onChange: (v) => patch('autoReply', v) })),
        h(Field, { label: '允许发图片', hint: '她有图片时用 OneBot 图片段发送' }, h(Toggle, { value: s.sendImages !== false, onChange: (v) => patch('sendImages', v) })),
        h(Field, { label: '直连失败回退虚拟机', hint: '不开就失败即止' }, h(Toggle, { value: s.fallbackVm !== false, onChange: (v) => patch('fallbackVm', v) })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: 'OneBot 地址', hint: '例如 http://127.0.0.1:3000' }, h(TextInput, { value: s.apiBase || '', onChange: (v) => patch('apiBase', v), placeholder: 'http://127.0.0.1:3000' })),
        h(Field, { label: 'Access Token', hint: 'OneBot 配置里的 token；没有就留空' }, h(TextInput, { value: s.token || '', onChange: (v) => patch('token', v), placeholder: '可留空' })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '对方 QQ 号（发给她用）', hint: '她要发消息的人（主人自己的号），只填数字；不填就不会发' }, h(TextInput, { value: s.userId || '', onChange: (v) => patch('userId', String(v || '').replace(/[^0-9]/g, '')) })),
        h(Field, { label: '她的 QQ 号（机器人账号，可选）', hint: 'OneBot 桥登录的号；用来过滤她自己发的消息' }, h(TextInput, { value: s.selfId || '', onChange: (v) => patch('selfId', String(v || '').replace(/[^0-9]/g, '')) })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '回复前缀', hint: '可选，比如「（QQ）」，最多 40 字' }, h(TextInput, { value: s.replyPrefix || '', onChange: (v) => patch('replyPrefix', v), placeholder: '可不填' })),
        h(Field, { label: '请求超时（毫秒）', hint: '1000 ~ 30000' }, h(NumInput, { value: s.timeoutMs || 8000, min: 1000, max: 30000, step: 500, onChange: (v) => patch('timeoutMs', v) })),
      ),
      h(Row, { gap: 8, wrap: true },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy, onClick: save }, busy === 'save' ? '保存中…' : '保存'),
        h(Btn, { size: 'sm', disabled: !!busy, onClick: refresh }, busy === 'status' ? '检测中…' : '测试连接'),
        h(Btn, { size: 'sm', disabled: !!busy, onClick: sendTest }, busy === 'send' ? '发送中…' : '发测试消息'),
        h(Btn, { kind: 'ghost', size: 'sm', disabled: !!busy, onClick: load }, '重新读取'),
      ),
      st ? h('div', { style: { fontSize: 11.5, color: T.text2, display: 'flex', flexDirection: 'column', gap: 2 } },
        h('span', {}, '连接状态：' + (st.ok ? '✅ 可用' : '❌ ' + (st.error || '不可用')) + (st.latencyMs ? (' · ' + st.latencyMs + 'ms') : '')),
        login ? h('span', {}, '登录账号：' + (login.nickname || '') + (login.userId ? '（' + login.userId + '）' : '')) : null,
        diag ? h('span', { style: { color: st.ok ? T.ok || T.text2 : T.danger } }, '最近操作：' + diag) : null,
      ) : null,
    ) : h(Loading, {}),
    h(Note, {}, '· 入站消息由 OneBot 桥 POST 到运行时的 /api/direct-chat/event（桥的 HTTP 上报地址填这个；自建桥已内置这一上报）。'),
    h(Note, {}, '· 只处理私聊消息；群聊需要另外开（避免她在群里乱说话）。'),
  )
}

// ---------- 自动更新 ----------
function UpdateCard() {
  const [info, setInfo] = React.useState(null)
  const [busy, setBusy] = React.useState('')
  const [diag, setDiag] = React.useState('')
  const [err, setErr] = React.useState('')

  const check = React.useCallback(async (force) => {
    setBusy('check'); setDiag('')
    const r = await Api.get('/api/update/check' + (force ? '?force=1' : ''))
    setBusy('')
    if (!r.ok) { setDiag('检查失败：' + (r.error || '')); return }
    setInfo((prev) => Object.assign({}, prev || {}, { update: r.data, settings: Object.assign({}, (prev && prev.settings) || {}, { lastCheckAt: r.data.checkedAt, lastResult: r.data }) }))
    setDiag(r.data.updateAvailable ? ('发现新版本 ' + r.data.latest) : ('已是最新（' + r.data.current + '）'))
  }, [])

  const load = React.useCallback(() => {
    Api.get('/api/update/settings').then((r) => {
      if (!r.ok || !r.data) { setInfo(null); setErr(r.error || '更新模块不可用'); return }
      setInfo(r.data); setErr('')
      // 自动检查更新：默认开；上次检查超过 6 小时才真的去查（也不阻塞页面）
      const cfg = (r.data && r.data.settings) || {}
      const last = Number(cfg.lastCheckAt) || 0
      if (cfg.autoCheck !== false && Date.now() - last >= 6 * 3600 * 1000) check(false)
    })
  }, [check])
  React.useEffect(load, [load])
  const apply = async () => {
    const ok = await confirmDialog('立即更新插件？', {
      title: '插件更新',
      detail: '会执行 git pull --ff-only 拉取新代码；成功后运行时会自动重启（约 3~10 秒）。',
      okText: '更新',
    })
    if (!ok) return
    setBusy('apply'); setDiag('')
    const r = await Api.post('/api/update/apply', {})
    setBusy('')
    const d = r.data || {}
    setDiag(d.message || d.error || (d.ok ? '更新完成，运行时即将重启' : '更新失败'))
    if (d.ok) toast('更新成功，运行时即将重启'); else toast('更新失败：' + (d.error || d.message || ''), 'error')
    check(false)
  }

  const up = info && info.update
  const s = (info && info.settings) || {}
  return h(Card, {
    title: '插件更新',
    sub: '自动检查新版本；git 检出可一键更新',
    tag: up && up.updateAvailable ? ('有新版 ' + (up.latest || '')) : '已是最新',
  },
    err ? h(ErrorBox, { error: err, onRetry: load }) : null,
    h(Row, { gap: 10, wrap: true },
      h(KV, { k: '当前版本', v: (info && info.version) || (up && up.current) || '—' }),
      h(KV, { k: '最新版本', v: (up && up.latest) || '未检查' }),
      h(KV, { k: '安装方式', v: up ? ({ link: '本地链接（git 检出）', npm: 'npm 安装', unknown: '未知' }[up.installKind] || up.installKind) : '—' }),
      h(KV, { k: 'git 仓库', v: up ? (up.gitRepo ? (up.gitDirty === false ? '是（工作区干净）' : up.gitDirty === true ? '是（有未提交改动）' : '是（状态未知）') : '否') : '—' }),
    ),
    h(Row, { gap: 10, wrap: true },
      h(Field, { label: '自动检查更新', hint: '启动时和每 6 小时检查一次，发现新版在面板提示' },
        h(Toggle, {
          value: s.autoCheck !== false,
          onChange: async (v) => {
            const r = await Api.post('/api/update/settings', { autoCheck: v })
            if (r.ok && r.data) setInfo((prev) => Object.assign({}, prev || {}, { settings: r.data.settings }))
            toast(v ? '已开启自动检查' : '已关闭自动检查')
          },
        }),
      ),
      h(Field, { label: '自动安装', hint: '默认关闭；只有 git 检出且工作区干净时才会真的拉取' },
        h(Toggle, {
          value: !!s.autoApply,
          onChange: async (v) => {
            if (v) {
              const ok = await confirmDialog('开启自动安装？', { title: '自动更新', detail: 'autoApply 打开后，后台检查到新版且 git 工作区干净时会自动 git pull 并重启运行时。', okText: '开启' })
              if (!ok) return
            }
            const r = await Api.post('/api/update/settings', { autoApply: v })
            if (r.ok && r.data) setInfo((prev) => Object.assign({}, prev || {}, { settings: r.data.settings }))
          },
        }),
      ),
    ),
    h(Row, { gap: 8, wrap: true },
      h(Btn, { size: 'sm', disabled: !!busy, onClick: () => check(true) }, busy === 'check' ? '检查中…' : '检查更新'),
      h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !(up && up.updateAvailable), onClick: apply }, busy === 'apply' ? '更新中…' : '立即更新'),
      h(Btn, { kind: 'ghost', size: 'sm', disabled: !!busy, onClick: load }, '重新读取'),
    ),
    diag ? h(Note, {}, '最近操作：' + diag) : null,
    s.lastCheckAt ? h(Note, {}, '上次检查：' + new Date(s.lastCheckAt).toLocaleString()) : null,
    h(Note, {}, '· 当前是本地链接安装（插件目录本身是 git 检出）时，一键更新会 git pull --ff-only，成功后运行时自动重启。'),
    h(Note, {}, '· npm / DSH 插件管理器安装的版本不会自己改用户 profile，只会提示你去更新。'),
  )
}

    /* ===== src/client/30-settings/settings-vm.js ===== */
// 30-settings/settings-vm.js —— 设置·VM 聊天卡片（D10 A：完整设置 + 状态 + 一键打开屏幕）
//
// 内容：/api/vm-chat/settings 的 9 项设置（开关 / 看消息 / 自动启动 / 空闲关闭 /
//       检查间隔 / 目标联系人 / 未读扫描 / watchdog / 发送图片）+ 运行状态 + 唤醒 /
//       立即检查 / 发测试文字 / 打开她的屏幕
// 契约：function SettingsVmTab()（外壳不传 props，需要什么自己取接口；N02 不写死角色信息）
// 可靠性：读取失败时禁用保存；POST 只发改动字段；间隔前端 clamp（后端同样 clamp）；
//         唤醒/检查/发消息都会真的操作虚拟机里的社交软件 → 一律 confirmDialog

// 只把「和已保存值不同」的字段挑出来
function settingsVmChanged(cur, next, keys) {
  const out = {}
  for (const k of keys) {
    const a = cur ? cur[k] : undefined
    const b = next ? next[k] : undefined
    if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a) !== Number(b)) out[k] = b
    } else if (a !== b) {
      out[k] = b
    }
  }
  return out
}

// 一行设置：左边标题+说明，右边控件
function settingsVmRow(title, hint, control) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
      borderTop: '1px solid ' + T.border, minWidth: 0,
    },
  },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: 12.5, color: T.text } }, title),
      hint ? h('div', { style: { fontSize: 10.5, color: T.text3, lineHeight: 1.55 } }, hint) : null,
    ),
    control,
  )
}

// 把 /api/vm-chat/check 的 result 转成一句人话
function settingsVmCheckSummary(r) {
  if (!r || typeof r !== 'object') return '检查完成（没有返回详情）'
  if (r.error) return '检查失败：' + r.error
  if (r.requiresLogin) return '检测到登录/扫码页：' + (r.loginHint || '去「看屏幕」里登录后再试')
  const bits = []
  if (r.skipped === 'targetContact') bits.push('当前会话不是目标联系人，已跳过回复')
  if (r.duplicate) bits.push('最近消息已经回过，跳过')
  bits.push('未读 ' + (Number(r.unread) || 0) + ' 条 / 最近 ' + (Number(r.recent) || 0) + ' 条')
  if (r.sent) bits.push(r.sent.ok ? '已自动回复' : ('回复失败：' + (r.sent.error || '未知原因')))
  else if (r.analysis && r.analysis.needReply === false) bits.push('不需要回复')
  return bits.join('；')
}

function SettingsVmTab() {
  const status = useStatus()
  const st = (status && status.data) || {}

  const settingsApi = useApi('/api/vm-chat/settings')
  const vmStatusApi = useApi('/api/vm-chat/status', { refreshMs: 12000 })

  const [draft, setDraft] = React.useState({
    enabled: false,
    checkMessages: true,
    autoStart: true,
    idleShutdown: true,
    checkIntervalMin: 15,
    targetContact: '',
    unreadScan: false,
    watchdog: true,
    sendImages: true,
  })
  const [busy, setBusy] = React.useState('')
  const [lastResult, setLastResult] = React.useState('')
  const [sendOpen, setSendOpen] = React.useState(false)
  const [sendText, setSendText] = React.useState('')

  const loaded = (settingsApi.data && settingsApi.data.settings) || null

  React.useEffect(() => {
    const s = settingsApi.data && settingsApi.data.settings
    if (!s) return
    setDraft({
      enabled: !!s.enabled,
      checkMessages: s.checkMessages !== false,
      autoStart: s.autoStart !== false,
      idleShutdown: s.idleShutdown !== false,
      unreadScan: s.unreadScan === true,
      watchdog: s.watchdog !== false,
      sendImages: s.sendImages !== false,
      checkIntervalMin: Math.round(clampNum(s.checkIntervalMin, 2, 1440, 15)),
      targetContact: String(s.targetContact || ''),
    })
  }, [settingsApi.data])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => { settingsApi.reload(); vmStatusApi.reload() }

  // ── 保存设置（只发改动字段）──────────────────────────────────────────
  const saveSettings = () => run('save', async () => {
    if (settingsApi.error) { toast('VM 聊天设置读取失败，先点「刷新」再保存', 'error'); return }
    const cur = loaded || {}
    const next = {
      enabled: !!draft.enabled,
      checkMessages: !!draft.checkMessages,
      autoStart: !!draft.autoStart,
      idleShutdown: !!draft.idleShutdown,
      checkIntervalMin: Math.round(clampNum(draft.checkIntervalMin, 2, 1440, 15)),
      targetContact: String(draft.targetContact || '').trim().slice(0, 60),
      unreadScan: !!draft.unreadScan,
      watchdog: !!draft.watchdog,
      sendImages: !!draft.sendImages,
    }
    setDraft((prev) => Object.assign({}, prev, { checkIntervalMin: next.checkIntervalMin, targetContact: next.targetContact }))
    const body = settingsVmChanged(cur, next, [
      'enabled', 'checkMessages', 'autoStart', 'idleShutdown',
      'checkIntervalMin', 'targetContact', 'unreadScan', 'watchdog', 'sendImages',
    ])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/vm-chat/settings', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('VM 聊天设置已保存')
    settingsApi.reload()
  })

  // ── 唤醒 / 检查 / 发送 ──────────────────────────────────────────────
  const wakeVm = () => run('wake', async () => {
    const ok = await confirmDialog('唤醒虚拟机？', {
      title: '唤醒虚拟机',
      detail: '会启动她的虚拟屏幕（约占 2–6GB 内存），第一次可能要一两分钟；唤醒后可以「立即检查」消息。',
      okText: '唤醒',
    })
    if (!ok) return
    const r = await Api.post('/api/vm-chat/wake', {}, { timeoutMs: 180000 })
    if (!r.ok) {
      const data = r.data || {}
      toast('唤醒失败：' + (data.error || r.error || '未知错误'), 'error')
      setLastResult('唤醒失败：' + (data.error || r.error || '未知错误'))
      return
    }
    const running = !!(r.data && r.data.running)
    toast(running ? '虚拟机已唤醒' : '唤醒指令已发出，但虚拟机还没就绪')
    setLastResult(running ? '虚拟机已唤醒，可以「立即检查」消息。' : '唤醒指令已发出，虚拟机还没就绪；稍等再刷新状态。')
    vmStatusApi.reload()
  })

  const checkNow = () => run('check', async () => {
    const ok = await confirmDialog('现在检查虚拟机消息？', {
      title: '立即检查',
      detail: '会截屏识别当前会话；如果设置里开启了自动回复，可能直接以她的身份回复对方。检查/截图会消耗少量 token。',
      okText: '开始检查',
    })
    if (!ok) return
    setLastResult('检查中…（可能要几十秒）')
    const r = await Api.post('/api/vm-chat/check', {}, { timeoutMs: 180000 })
    if (!r.ok) {
      const msg = '检查失败：' + (r.error || '未知错误')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    const result = (r.data && r.data.result) || {}
    const msg = settingsVmCheckSummary(result)
    setLastResult(msg)
    toast(result && result.error ? msg : '检查完成', result && result.error ? 'error' : 'ok')
    if (result && result.ok !== false) { vmStatusApi.reload(); settingsApi.reload() }
  })

  const openSendModal = () => {
    setSendText('')
    setSendOpen(true)
  }

  const sendTestText = () => run('send', async () => {
    const text = String(sendText || '').trim()
    if (!text) { toast('先输入要发的内容', 'error'); return }
    const ok = await confirmDialog('以她的身份在虚拟机社交软件里发送这句话？', {
      title: '发送测试消息',
      detail: text.length > 120 ? text.slice(0, 120) + '…' : text,
      okText: '发送',
    })
    if (!ok) return
    setLastResult('发送中…')
    const r = await Api.post('/api/vm-chat/send', { text }, { timeoutMs: 180000 })
    if (!r.ok) {
      const msg = '发送失败：' + (r.error || '未知错误')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    const result = (r.data && r.data.result) || {}
    if (result && result.ok === false) {
      const msg = '发送失败：' + (result.error || '发送被拒绝') + (result.requiresLogin ? '（先在「看屏幕」里登录）' : '')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    setSendOpen(false)
    setSendText('')
    setLastResult('测试消息已发送。')
    toast('测试消息已发送')
    vmStatusApi.reload()
  })

  const openScreen = async () => {
    try {
      if (typeof openHerScreen === 'function') await openHerScreen()
      else Api.openExternal('/screen')
    } catch (e) {
      toast('打开她的屏幕失败：' + ((e && e.message) || '浏览器拦截了弹窗'), 'error')
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  const vmStatus = (vmStatusApi.data && vmStatusApi.data.status) || null
  const running = !!(vmStatus && vmStatus.running)
  const apps = (vmStatus && Array.isArray(vmStatus.apps)) ? vmStatus.apps : []
  const last = (vmStatus && vmStatus.last) || null
  const appNames = apps.map((a) => String((a && a.name) || (a && a.id) || '')).filter(Boolean)
  const modeChat = String(st.mode || '') === 'chat'
  const lastCheckAt = (loaded && loaded.lastCheckAt) || (last && last.at) || 0
  const lastUserText = loaded && loaded.lastUserText ? String(loaded.lastUserText) : ''
  const dirty = !!loaded && Object.keys(settingsVmChanged(loaded, {
    enabled: !!draft.enabled,
    checkMessages: !!draft.checkMessages,
    autoStart: !!draft.autoStart,
    idleShutdown: !!draft.idleShutdown,
    checkIntervalMin: Math.round(clampNum(draft.checkIntervalMin, 2, 1440, 15)),
    targetContact: String(draft.targetContact || '').trim().slice(0, 60),
    unreadScan: !!draft.unreadScan,
    watchdog: !!draft.watchdog,
    sendImages: !!draft.sendImages,
  }, ['enabled', 'checkMessages', 'autoStart', 'idleShutdown', 'checkIntervalMin', 'targetContact', 'unreadScan', 'watchdog', 'sendImages'])).length > 0

  const setBool = (key, value) => setDraft((prev) => Object.assign({}, prev, { [key]: !!value }))

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：说明 + 刷新 + 打开屏幕
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '虚拟机社交软件：她在虚拟机里用 QQ 之类的软件和你聊天（需要虚拟屏幕/环境）。设置改完点下面「保存设置」生效。'),
      h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy }, '刷新'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: openScreen }, '打开她的屏幕'),
      ),
    ),

    modeChat ? h(Note, { style: { color: T.warn } }, '⚠️ 当前是纯聊天模式，虚拟机聊天不会生效；要使用请让运行时切到完整版。') : null,

    // 状态
    h(Card, {
      title: '运行状态',
      tag: '虚拟机里的社交软件',
      actions: h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !!vmStatusApi.error, onClick: vmStatusApi.reload }, '刷新状态'),
    },
      vmStatusApi.error
        ? h(ErrorBox, { title: 'VM 状态读取失败', error: vmStatusApi.error, onRetry: vmStatusApi.reload })
        : null,
      vmStatus
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
            h(Row, { gap: 8 },
              h(Dot, { on: running, tone: running ? T.ok : T.idle }),
              h('span', { style: { fontSize: 13, color: T.text, fontWeight: 600 } }, running ? '虚拟机运行中' : '虚拟机未运行'),
              apps.length ? h(Badge, { tone: 'ok' }, apps.length + ' 个社交应用') : null,
              last && last.loginRequired ? h(Badge, { tone: 'danger' }, '停在登录/扫码页') : null,
              last && last.skipped === 'targetContact' ? h(Badge, { tone: 'warn' }, '会话不在目标范围') : null,
            ),
            apps.length
              ? h(Note, {}, '检测到：' + appNames.slice(0, 6).join(' / ') + (appNames.length > 6 ? ' 等 ' + appNames.length + ' 个' : ''))
              : h(Note, {}, running ? '虚拟机能连上，但没检测到社交应用（可能停在登录页或应用没打开）。' : '唤醒或启动虚拟屏幕后才能检测社交应用。'),
            h(Row, { gap: 10, style: { flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 11.5, color: T.text3 } },
                lastCheckAt ? '上次检查：' + fmtDateTime(lastCheckAt) : '还没有检查过'),
              lastUserText ? h('span', { style: { fontSize: 11.5, color: T.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                '对方最新：' + (lastUserText.length > 60 ? lastUserText.slice(0, 60) + '…' : lastUserText)) : null,
            ),
            last && last.action === 'check' && last.unread === 0 && last.recent === 0
              ? h(Note, {}, '最近一次检查：没有发现新消息。')
              : null,
            lastResult ? h(Note, { style: { color: T.text2 } }, lastResult) : null,
          )
        : h(Note, {}, vmStatusApi.loading ? '状态读取中…' : '还没拿到虚拟机状态，点「刷新状态」再试。'),
      h(Row, { gap: 8, style: { marginTop: 2 } },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy, onClick: wakeVm }, busy === 'wake' ? '唤醒中…' : '唤醒虚拟机'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: checkNow }, busy === 'check' ? '检查中…' : '立即检查消息'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: openSendModal }, '发测试文字'),
      ),
      h(Note, {}, '唤醒/检查都会真实操作虚拟机（占用内存、消耗少量 token）；检查时如果开启了自动回复，她可能会直接回对方。'),
    ),

    // 设置
    h(Card, {
      title: 'VM 聊天设置',
      tag: dirty ? '有未保存的修改' : '',
      actions: h(Btn, {
        kind: 'primary', size: 'sm',
        disabled: !!busy || !!settingsApi.error,
        onClick: saveSettings,
      }, busy === 'save' ? '保存中…' : '保存设置'),
    },
      settingsApi.error ? h(ErrorBox, { title: '设置读取失败（读失败禁存）', error: settingsApi.error, onRetry: settingsApi.reload }) : null,
      settingsApi.loading && !settingsApi.data ? h(Loading, { text: 'VM 设置读取中…' }) : null,

      // 主动消息
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 2 } }, '主动消息'),
      settingsVmRow(
        '主动消息走虚拟机',
        '她主动发消息时，通过虚拟机里的社交软件发给你；关掉就只在 DSH 聊天窗口里说',
        h(Toggle, { checked: !!draft.enabled, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('enabled', v) }),
      ),

      // 检查与回复
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '检查与回复'),
      settingsVmRow(
        '定时看消息',
        '按下面的间隔检查虚拟机里的新消息；有新消息时按需回复',
        h(Toggle, { checked: !!draft.checkMessages, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('checkMessages', v) }),
      ),
      settingsVmRow(
        '检查间隔',
        '2 – 1440 分钟；开着「定时看消息」才生效',
        h(NumInput, {
          value: draft.checkIntervalMin,
          onChange: (v) => setDraft((prev) => Object.assign({}, prev, { checkIntervalMin: v })),
          min: 2, max: 1440, step: 1, suffix: '分钟', width: 96,
          disabled: !!busy || !!settingsApi.error,
        }),
      ),
      settingsVmRow(
        '目标联系人',
        '只处理和 TA 的会话（会话名里包含这个字符串即可）；留空 = 不限制，当前打开哪个会话就处理哪个',
        h('div', { style: { width: 190 } }, h(TextInput, {
          value: draft.targetContact,
          onChange: (v) => setDraft((prev) => Object.assign({}, prev, { targetContact: v })),
          placeholder: '留空 = 不限制',
          disabled: !!busy || !!settingsApi.error,
        })),
      ),
      settingsVmRow(
        '未读扫描',
        '回复前先只读扫一遍其它会话的未读消息（更主动，也更费 token）',
        h(Toggle, { checked: !!draft.unreadScan, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('unreadScan', v) }),
      ),

      // 稳定性 / 省内存
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '稳定性与内存'),
      settingsVmRow(
        '自动启动虚拟机',
        '需要发送/检查时自动唤醒虚拟屏幕（不勾就要你手动开）',
        h(Toggle, { checked: !!draft.autoStart, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('autoStart', v) }),
      ),
      settingsVmRow(
        '用完自动关虚拟机',
        '每次检查/发完自动关闭虚拟屏幕，省内存（下次要重新唤醒）',
        h(Toggle, { checked: !!draft.idleShutdown, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('idleShutdown', v) }),
      ),
      settingsVmRow(
        '窗口看门狗',
        '聊天窗口不在时自动重开应用（≥60 秒防抖，避免反复重启）',
        h(Toggle, { checked: !!draft.watchdog, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('watchdog', v) }),
      ),

      // 图片
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '图片'),
      settingsVmRow(
        '允许往聊天软件发图片',
        '她可以通过 VM 通道把图片粘贴进聊天软件；关掉后发图会被拒绝',
        h(Toggle, { checked: !!draft.sendImages, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('sendImages', v) }),
      ),

      h(Note, {}, '保存只提交改动过的字段；间隔等数值前端也会夹到合法范围内。'),
    ),

    // 直连（OneBot 11）：设置 + 测试连接/发测试消息按钮
    typeof DirectChatCard === 'function' ? h(DirectChatCard, {}) : null,

    // 说明
    h(Card, { title: '说明' },
      h(Note, {}, '· 虚拟机聊天不是聊天/识图的前置条件：不装虚拟机也能正常聊天，只是没有「在 QQ 里和你聊」这一层。'),
      h(Note, {}, '· 检测到登录/扫码页时不会误发消息；先去「打开她的屏幕」里扫码登录，再回来点「立即检查」。'),
      h(Note, {}, '· 「立即检查」和「发测试文字」都会真的截屏/操作虚拟机里的软件，敏感场景请先确认。'),
    ),

    // 发测试文字弹层
    h(Modal, {
      open: !!sendOpen,
      title: '发测试文字到虚拟机社交软件',
      onClose: () => { if (!busy) setSendOpen(false) },
      footer: h(Row, { gap: 8 },
        h(Btn, { kind: 'ghost', disabled: !!busy, onClick: () => setSendOpen(false) }, '取消'),
        h(Btn, { kind: 'primary', disabled: !!busy || !String(sendText || '').trim(), onClick: sendTestText }, busy === 'send' ? '发送中…' : '发送'),
      ),
    },
      h(Field, { label: '内容', hint: '会以她的身份、在虚拟机当前打开的会话里发送；发送前还会再确认一次。' },
        h(TextArea, { value: sendText, onChange: setSendText, rows: 3, placeholder: '比如：我到家啦，你在干嘛～', disabled: !!busy }),
      ),
    ),
  )
}

    /* ===== src/client/30-settings/settings.js ===== */
// 30-settings/settings.js —— 设置外壳（分类标签 + 各标签卡片）
//
// 结构：顶部标签条（角色/生活/记忆/环境/模型/数据/VM）→ 可滚动内容区。
// 每个标签只负责内容；滚动与 padding 在外壳这里统一处理。
//
// 组件归属（跨文件契约，名字固定，不要改）：
//   · SettingsRoleTab / SettingsMemoryTab           → settings-core.js（本团队：settings-a）
//   · SettingsLifeTab / SettingsEnvTab              → settings-life.js（本团队：settings-a）
//   · SettingsModelTab / SettingsDataTab / SettingsVmTab → settings-model.js / settings-data.js / settings-vm.js（settings-b）
//
// 约定：不写 import/export；颜色只走 T.*；本文件不发任何请求（各卡片自己读接口）；
// 标签切走不卸载（保留未保存的编辑），首次点开才挂载（省请求）。

const STG_TABS = [
  { key: 'role', label: '角色', icon: '🎭' },
  { key: 'life', label: '生活', icon: '🕐' },
  { key: 'memory', label: '记忆', icon: '🧠' },
  { key: 'env', label: '环境', icon: '🖥️' },
  { key: 'model', label: '模型', icon: '⚙️' },
  { key: 'data', label: '数据', icon: '💾' },
  { key: 'vm', label: 'VM', icon: '💻' },
]

// 还没写好的标签给个明确占位（构建期不会报错；实现者写好文件后自动生效）
function stgShellMissing(label) {
  return h(Card, { title: label, sub: '这个标签还在实现中' },
    h(Note, {}, '该标签的卡片由另一位实现者负责，文件写好并通过构建后会自动出现在这里。'),
  )
}

// 标签 key → 组件。用 typeof 保护跨文件引用：对方文件还没实现/改名时不会白屏
function stgShellTabBody(key) {
  if (key === 'role') return h(SettingsRoleTab, {})
  if (key === 'life') return h(SettingsLifeTab, {})
  if (key === 'memory') return h(SettingsMemoryTab, {})
  if (key === 'env') return h(SettingsEnvTab, {})
  if (key === 'model') return typeof SettingsModelTab === 'function' ? h(SettingsModelTab, {}) : stgShellMissing('模型')
  if (key === 'data') return typeof SettingsDataTab === 'function' ? h(SettingsDataTab, {}) : stgShellMissing('数据')
  if (key === 'vm') return typeof SettingsVmTab === 'function' ? h(SettingsVmTab, {}) : stgShellMissing('VM')
  return stgShellMissing(key)
}

function SettingsView(props) {
  ensureUiStyle()
  const [tab, setTab] = useLocal('companionSettingsTab', 'role')
  // 首次点开才挂载；之后切走保持挂载，避免丢掉未保存的编辑
  const [opened, setOpened] = React.useState(() => ({ role: true }))
  const current = STG_TABS.some((t) => t.key === tab) ? tab : 'role'
  const openTab = React.useCallback((key) => {
    setTab(key)
    setOpened((prev) => (prev[key] ? prev : Object.assign({}, prev, { [key]: true })))
  }, [setTab])

  return h('div', {
    style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: T.font },
  },
    // 头部：标题 + 说明 + 运行时刷新
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '9px 14px 6px', borderBottom: '1px solid ' + T.border, background: T.bg1, flexShrink: 0,
      },
    },
      h('span', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, '设置'),
      h('span', { style: { fontSize: 11.5, color: T.text2 } }, '每个卡片独立保存，只提交改动过的字段'),
      h('span', { style: { flex: 1 } }),
      h(Btn, {
        size: 'sm', kind: 'ghost', title: '刷新运行时状态（顶部状态条 / 钱包）',
        onClick: () => { try { pollStatusOnce() } catch (e) {} },
      }, '刷新状态'),
    ),
    // 标签条
    h('div', {
      style: { padding: '8px 14px 0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    },
      h(Tabs, { value: current, items: STG_TABS, onChange: openTab }),
    ),
    // 内容区（滚动 + padding 统一在这里）
    h('div', {
      className: 'sbc-scroll',
      style: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', padding: '12px 14px 20px' },
    },
      STG_TABS.map((t) => {
        if (!opened[t.key] && t.key !== current) return null
        return h('div', {
          key: t.key,
          style: {
            display: t.key === current ? 'flex' : 'none',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
          },
        }, stgShellTabBody(t.key))
      }),
    ),
  )
}

    /* ===== src/client/40-screen/screen.js ===== */
// 40-screen/screen.js —— 屏幕：她的虚拟屏幕（noVNC）默认内嵌在面板里 + 系统浏览器兜底；手机/电脑是只读截图
//
// 为什么这么写：
//   · 2026-11-15 用户要求「手机截图都嵌入了，虚拟屏幕也嵌进面板」：新增「内嵌虚拟屏幕」卡片，
//     默认用 iframe 显示 noVNC（127.0.0.1:6081/vnc.html；这是虚拟机自带的实时画面服务，没有 X-Frame-Options）；
//   · 外部浏览器没删：「打开她的屏幕」按钮 / 顶栏「看屏幕」/ Alt+S 仍然走 openHerScreen，
//     作为窗口太小、或 DSH 面板 CSP 不允许内嵌时的兜底；
//   · 除这一个 noVNC 画面外，面板里没有其它 iframe，也不请求旧版插件的任何 HTML 页面；
//   · 面板里另外能看的是只读截图：她的手机（/api/screen/phone，3 秒刷新）、你的电脑（/api/screen/pc，2.5 秒刷新）；
//   · 虚拟机/模拟器都很吃内存，启动/关闭一律先 confirmDialog；后端内存不足会 refused，这里显示它的 message；
//   · 所有失败都给中文说明（M06 验收：失败有错误说明），不静默失败。

const SCREEN_SPACE_POLL_MS = 6000
const SCREEN_PHONE_SHOT_MS = 3000
const SCREEN_PC_SHOT_MS = 2500
const SCREEN_ENSURE_TIMEOUT_SEC = 90
// 外部浏览器用的 noVNC 参数：不告诉它自动连接/自动重连的话，浏览器里还要手动点一次连接
const SCREEN_VNC_QUERY = 'autoconnect=1&reconnect=1&reconnect_delay=2000&resize=scale'
// 内嵌 iframe 用的 noVNC 参数（按需求：自动连接 / 随容器缩放 / 自动重连 / 显示连接状态点 / 裁剪视口）
const SCREEN_EMBED_PARAMS = 'autoconnect=true&resize=scale&reconnect=true&show_dot=true&view_clip=true'
// onLoad 之前最多等这么久；超时按「内嵌失败」处理（CSP 拦截/服务没起来都会命中）
const SCREEN_EMBED_LOAD_TIMEOUT_MS = 8000

// 她的屏幕状态 → 中文（后端 /api/screen/space/status 只有 vm/http/healing 三个布尔量）
function screenSpaceText(st) {
  if (!st) return '读取中…'
  if (st.http) return '已连接，可以直接操作'
  if (st.healing) return '连接掉了，正在自动修复…'
  if (!st.vm) return '她的屏幕没开（虚拟机没启动）'
  return '虚拟机开着，但画面链路没通'
}

function screenSpaceTone(st) {
  if (!st) return T.idle
  if (st.http) return T.ok
  if (!st.vm) return T.idle
  return T.warn
}

// 后端只给 http://127.0.0.1:6081/vnc.html，这里补上自动连接/自动重连参数
function screenVncSrc(spaceUrl) {
  const base = String(spaceUrl || '').trim()
  if (!base) return ''
  const sep = base.indexOf('?') >= 0 ? '&' : '?'
  return base + sep + SCREEN_VNC_QUERY
}

// 内嵌 iframe 的 noVNC 地址：spaceUrl 可能已经带 query 或 #hash，两种都要容错
function screenEmbedSrc(spaceUrl) {
  const raw = String(spaceUrl || '').trim()
  if (!raw) return ''
  const hashIdx = raw.indexOf('#')
  const head = hashIdx >= 0 ? raw.slice(0, hashIdx) : raw
  const hash = hashIdx >= 0 ? raw.slice(hashIdx) : ''
  const sep = head.indexOf('?') >= 0 ? '&' : '?'
  return head + sep + SCREEN_EMBED_PARAMS + hash
}

// /api/resources 的 mem 形如 "VBoxHeadless:6123"（进程名:占用的 MB）
function screenMemLabel(item) {
  const s = String(item || '').trim()
  const i = s.lastIndexOf(':')
  if (i > 0) return s.slice(0, i) + ' ' + s.slice(i + 1) + ' MB'
  return s
}

// 外壳顶栏「看屏幕」按钮 / Alt+S 快捷键调这个（签名固定，别改）：
// 拿 /api/screen/info 的 spaceUrl → 系统浏览器打开；任何失败 toast(..., 'error')。
async function openHerScreen() {
  try {
    const info = await Api.get('/api/screen/info')
    if (!info || !info.ok) {
      const why = (info && (info.error || ('HTTP ' + info.status))) || '运行时没有响应'
      toast('打不开她的屏幕：' + why, 'error')
      return { ok: false, error: why }
    }
    const data = info.data || {}
    const url = screenVncSrc(data.spaceUrl)
    if (!url) {
      toast('打不开她的屏幕：运行时没有给出 noVNC 地址（spaceUrl 为空）', 'error')
      return { ok: false, error: '运行时没有给出 noVNC 地址' }
    }
    // 顺手看一眼状态：没开/链路断的时候提醒一句（不阻止打开，浏览器会自动重连）
    const spaceStatus = await Api.get('/api/screen/space/status')
    const st = (spaceStatus && spaceStatus.ok && spaceStatus.data) || null
    if (st && !st.http) {
      if (!st.vm) toast('她的屏幕还没启动，浏览器窗口已经打开；先在「屏幕」页点「启动/修复」，再刷新浏览器', 'info')
      else toast('她的屏幕链路正在修复，浏览器会自动重连（一般十几秒）', 'info')
    }
    let r
    try {
      r = Api.openExternal(url)
    } catch (e) {
      r = { ok: false, error: (e && e.message) || '浏览器拒绝打开新窗口' }
    }
    if (!r || !r.ok) {
      const why = (r && r.error) || '系统浏览器没有打开新窗口'
      toast('用系统浏览器打开她的屏幕失败：' + why, 'error')
      return { ok: false, error: why, url }
    }
    return { ok: true, url }
  } catch (e) {
    const why = (e && e.message) || '未知错误'
    toast('打不开她的屏幕：' + why, 'error')
    return { ok: false, error: why }
  }
}

// ── 内嵌虚拟屏幕（noVNC iframe）──────────────────────────────────────────
// 用户明确要求把她的虚拟机桌面直接嵌进面板（不再只跳外部浏览器）。
// noVNC（127.0.0.1:6081/vnc.html）是虚拟机自带的画面服务、没有 X-Frame-Options，可以直接 iframe 内嵌；
// 它不属于旧版插件网页。万一被 DSH 面板的 CSP 拦掉：onError / 8 秒超时会给「重试内嵌 + 外部浏览器」兜底。
function ScreenEmbedCard(props) {
  const p = props || {}
  const spaceUrl = String(p.spaceUrl || '')
  const st = p.spaceStatus || null
  const [embed, setEmbed] = useLocal('companionScreenEmbed', true)
  const [frameKey, setFrameKey] = React.useState(0)
  const [frameLoaded, setFrameLoaded] = React.useState(false)
  const [frameError, setFrameError] = React.useState('')
  const prevHttp = React.useRef(null)

  const src = screenEmbedSrc(spaceUrl)
  const httpOk = !!(st && st.http)
  const statusKnown = !!st
  const waiting = !!embed && !!src && !frameLoaded && !frameError

  // 重建 iframe（换 key → 卸载旧的、重新加载）
  const reloadFrame = () => {
    setFrameLoaded(false)
    setFrameError('')
    setFrameKey((k) => k + 1)
  }

  // 地址变了（第一次拿到地址 / 运行时换端口）→ 重置 iframe 状态
  React.useEffect(() => {
    setFrameLoaded(false)
    setFrameError('')
  }, [src])

  // 折叠时立刻卸掉加载态；再展开会重新连接（折叠期间 iframe 不渲染，省内存/CPU）
  React.useEffect(() => {
    if (!embed) {
      setFrameLoaded(false)
      setFrameError('')
    }
  }, [embed])

  // onLoad 之前最多等 8 秒：CSP 拦截 / noVNC 没起来 / 链路断都会命中这个兜底
  React.useEffect(() => {
    if (!embed || !src || frameLoaded || frameError) return undefined
    const timer = setTimeout(() => {
      setFrameError('内嵌画面等了 8 秒还没加载出来：可能是 noVNC 服务没启动、画面链路断了，或浏览器策略不允许内嵌本机页面。')
    }, SCREEN_EMBED_LOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [embed, src, frameLoaded, frameError, frameKey])

  // 画面链路从断到通：自动重建 iframe，用户不用手动点重试
  React.useEffect(() => {
    const was = prevHttp.current
    prevHttp.current = httpOk
    if (was === false && httpOk) reloadFrame()
  }, [httpOk])

  // 如果 DSH 面板自己设了 CSP frame-src，iframe 会被拦成空白；监听安全策略违规，给准确提示
  React.useEffect(() => {
    if (!embed || !src) return undefined
    if (typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function') return undefined
    const onViolation = (e) => {
      try {
        const directive = String((e && (e.effectiveDirective || e.violatedDirective)) || '')
        if (!/frame/i.test(directive)) return
        setFrameLoaded(false)
        setFrameError('DSH 面板的内容安全策略（CSP）不允许内嵌 noVNC 画面：请用「外部浏览器打开」，或让开发者在面板 CSP 的 frame-src 里放行本机 noVNC 地址。')
      } catch (err) {}
    }
    document.addEventListener('securitypolicyviolation', onViolation)
    return () => document.removeEventListener('securitypolicyviolation', onViolation)
  }, [embed, src])

  const openExternalBtn = h(Btn, {
    size: 'sm',
    kind: 'primary',
    onClick: () => { if (p.onOpenExternal) p.onOpenExternal() },
    title: '用系统浏览器打开同一台虚拟机的画面（内嵌失败时的兜底）',
  }, '用系统浏览器打开')

  let body
  if (!embed) {
    body = h(Empty, { icon: '🖥️' }, '内嵌画面已折叠（折叠时不会加载 iframe，省内存和 CPU）。点「展开」继续看她的桌面，或直接用外部浏览器打开。')
  } else if (!src) {
    const errText = String(p.infoError || '')
    if (errText) {
      body = h(ErrorBox, { title: '拿不到虚拟屏幕地址', error: errText, onRetry: p.onReloadInfo })
    } else {
      body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        p.infoLoading
          ? h(Loading, { text: '正在读取她的屏幕地址…' })
          : h(Empty, { icon: '🖥️' }, '运行时还没给出 noVNC 地址（spaceUrl 为空）：可以先点下面「她自己的屏幕」里的「启动/修复」，或直接用外部浏览器打开。'),
        h(Row, { gap: 8 }, openExternalBtn),
      )
    }
  } else {
    const frame = h('div', {
      style: {
        position: 'relative', width: '100%',
        height: 'clamp(480px, calc(100vh - 320px), 820px)',
        background: T.bg, border: '1px solid ' + T.border, borderRadius: T.radius, overflow: 'hidden',
      },
    },
      h('iframe', {
        key: 'screen-embed-' + frameKey,
        src: src,
        title: '她的虚拟屏幕（noVNC）',
        referrerPolicy: 'no-referrer',
        allow: 'clipboard-read; clipboard-write',
        onLoad: () => { setFrameLoaded(true); setFrameError('') },
        onError: () => setFrameError('内嵌虚拟屏幕加载失败：noVNC 页面打不开（服务没起来，或浏览器策略不允许内嵌）。'),
        style: { width: '100%', height: '100%', border: '0', display: 'block', background: T.bg },
      }),
      waiting
        ? h('div', {
            style: {
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20,
              background: T.bg, textAlign: 'center',
            },
          },
            h(Loading, { text: '虚拟屏幕连接中…（第一次约 3~10 秒）' }),
            h(Note, {}, '连上后可以直接在面板里点鼠标、敲键盘；画面会随窗口自动缩放。'),
          )
        : null,
      frameError
        ? h('div', {
            style: {
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20,
              background: T.bg, textAlign: 'center',
            },
          },
            h('div', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, '内嵌虚拟屏幕没加载出来'),
            h('div', { style: { fontSize: 12, color: T.text2, lineHeight: 1.7, maxWidth: 560 } }, frameError),
            h(Row, { gap: 8 },
              h(Btn, { kind: 'primary', size: 'sm', onClick: reloadFrame }, '重试内嵌'),
              openExternalBtn,
            ),
            h(Note, {}, '一直失败就不要等内嵌了：外部浏览器一定能打开，画面是同一台虚拟机。'),
          )
        : null,
    )
    body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      statusKnown && !httpOk
        ? h('div', { style: { fontSize: 11.5, color: T.warn, lineHeight: 1.6 } },
            '她的屏幕现在还没连上（虚拟机没开或画面链路断了）：先在下面「她自己的屏幕」卡片里点「启动/修复」，连上后这里会自动重新连接。')
        : null,
      frame,
      h(Note, {}, '内嵌的是她虚拟机的桌面实时画面（noVNC）：可以直接在面板里点鼠标、敲键盘，窗口会自动缩放。'),
      h(Note, {}, '第一次连接约 3~10 秒；切到别的标签再回来会重新连。画面太小就点「折叠」，再用「外部浏览器打开」。'),
      h(Note, {}, '如果画面一直空白/黑屏：多半是浏览器策略不允许内嵌本机页面，点上面的「外部浏览器打开」即可（同一台虚拟机）。'),
    )
  }

  return h(Card, {
    title: '内嵌虚拟屏幕',
    sub: 'noVNC 实时画面 · 在面板里直接看和操作',
    tag: embed ? '实时' : '已折叠',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, {
        size: 'sm',
        kind: embed ? 'soft' : 'ghost',
        onClick: () => setEmbed((v) => !v),
        title: embed ? '折叠后不加载 iframe，省内存/CPU' : '展开内嵌画面（会重新连接）',
      }, embed ? '折叠' : '展开'),
      h(Btn, { size: 'sm', disabled: !embed || !src, onClick: reloadFrame, title: '重建 iframe 重新连接' }, '重新连接'),
      h(Btn, {
        size: 'sm',
        kind: 'primary',
        onClick: () => { if (p.onOpenExternal) p.onOpenExternal() },
        title: '用系统浏览器打开（画面太小/嵌不进去时的兜底）',
      }, '外部浏览器'),
    ),
  }, body)
}

function ScreenView(props) {
  // 地址 / 屏幕状态 / 环境状态：只走 /api/* JSON 接口（noVNC 画面是 iframe，独立于这些请求）
  const info = useApi('/api/screen/info', { refreshMs: 30000 })
  const space = useApi('/api/screen/space/status', { refreshMs: SCREEN_SPACE_POLL_MS })
  const res = useApi('/api/resources', { refreshMs: 8000 })

  const [spaceBusy, setSpaceBusy] = React.useState(false)
  const [powerBusy, setPowerBusy] = React.useState('')
  const [ensureAt, setEnsureAt] = React.useState(0)     // 启动/修复开始时间（0 = 没有在启动）
  const [ensureSec, setEnsureSec] = React.useState(0)   // 已经等了多少秒
  const [ensureNote, setEnsureNote] = React.useState('') // 超时/失败的说明

  const [phoneLive, setPhoneLive] = React.useState(true)
  const [phoneBust, setPhoneBust] = React.useState(() => Date.now())
  const [pcLive, setPcLive] = React.useState(true)
  const [pcBust, setPcBust] = React.useState(() => Date.now())

  const st = space.data || null
  const resources = res.data || null
  const screenRunning = resources ? !!resources.space : null
  const phoneRunning = resources ? !!resources.phone : null
  const ensureOn = !!ensureAt
  // 内嵌虚拟屏幕的地址：优先 /api/screen/info 的 spaceUrl，其次 space/status 里的 url
  const spaceUrl = (info.data && info.data.spaceUrl) || (st && st.url) || ''
  const embedCard = h(ScreenEmbedCard, {
    spaceUrl,
    spaceStatus: st,
    infoLoading: info.loading,
    infoError: info.error,
    onReloadInfo: info.reload,
    onOpenExternal: () => { void openHerScreen() },
  })

  // 截图自动刷新（N04：用 useInterval，页面不可见时它自己会暂停）
  // 她的手机：3 秒一张；手机没开时不空转（否则每张都要等截图超时）
  useInterval(() => setPhoneBust(Date.now()), SCREEN_PHONE_SHOT_MS, phoneLive && phoneRunning !== false)
  // 你的电脑：2.5 秒一张（可暂停）
  useInterval(() => setPcBust(Date.now()), SCREEN_PC_SHOT_MS, pcLive)

  // 启动/修复之后轮询到连上或超时（90 秒），超时/失败都给说明（N03/M06）
  useInterval(() => {
    if (!ensureAt) return
    const cur = space.data || {}
    if (cur.http) {
      setEnsureAt(0)
      setEnsureSec(0)
      setEnsureNote('')
      toast('她的屏幕连上了，可以在内嵌画面里操作了', 'ok')
      space.reload()
      return
    }
    const sec = Math.round((Date.now() - ensureAt) / 1000)
    if (sec >= SCREEN_ENSURE_TIMEOUT_SEC) {
      setEnsureAt(0)
      setEnsureNote('启动超时：等了 ' + SCREEN_ENSURE_TIMEOUT_SEC + ' 秒还没连上。可能是虚拟机启动慢，或空闲内存不够；可以再点「启动/修复」，或先关掉她的手机/别的程序再试。')
      toast('启动她的屏幕超时了（' + SCREEN_ENSURE_TIMEOUT_SEC + ' 秒没连上）', 'error')
      space.reload()
      return
    }
    setEnsureSec(sec)
    space.reload()
  }, 2000, ensureOn)

  // 「启动/修复」：POST /api/screen/space/ensure（后端自己判断是启动虚拟机还是修 noVNC 链路）
  const doEnsure = async () => {
    if (spaceBusy) return
    const cur = space.data || {}
    if (cur.http) {
      toast('她的屏幕已经连上了，上面的内嵌画面可以直接操作', 'info')
      return
    }
    if (cur.vm === false) {
      const ok = await confirmDialog('启动她的屏幕？', {
        detail: '会启动她的 Linux 虚拟机（约 1 分钟，占用 2~6 GB 内存），好了之后在上面的内嵌画面里操作她的屏幕。',
        okText: '启动',
      })
      if (!ok) return
    }
    setSpaceBusy(true)
    setEnsureNote('')
    try {
      const r = await Api.post('/api/screen/space/ensure', {}, { timeoutMs: 150000 })
      const d = (r && r.data) || {}
      if (!r || !r.ok) {
        const why = (r && r.error) || '运行时没有响应'
        setEnsureNote('启动/修复失败：' + why + '。稍后再点一次「启动/修复」。')
        toast('启动/修复她的屏幕失败：' + why, 'error')
        return
      }
      if (d.ok) {
        toast('她的屏幕链路正常，内嵌画面会自动连上', 'ok')
        setEnsureAt(0)
        setEnsureSec(0)
        setEnsureNote('')
        return
      }
      // 虚拟机没开：后端已经在后台启动，这里开始轮询进度
      setEnsureAt(Date.now())
      setEnsureSec(0)
      toast(d.message || '正在启动她的屏幕（约 1 分钟），最多等 ' + SCREEN_ENSURE_TIMEOUT_SEC + ' 秒…', 'info')
    } catch (e) {
      const why = (e && e.message) || '未知错误'
      setEnsureNote('启动/修复失败：' + why)
      toast('启动/修复她的屏幕失败：' + why, 'error')
    } finally {
      setSpaceBusy(false)
      space.reload()
    }
  }

  // 启动/关闭 她的屏幕、她的手机：重操作，一律先确认；后端内存不足会 refused + message
  const togglePower = async (kind) => {
    if (powerBusy) return
    const label = kind === 'space' ? '她的屏幕' : '她的手机'
    const running = kind === 'space' ? screenRunning === true : phoneRunning === true
    const ok = await confirmDialog((running ? '关掉' : '启动') + label + '？', {
      detail: running
        ? '关掉后大约能释放 2~6 GB 内存；她就不能看/用这个环境了，随时可以再启动。'
        : '启动大约需要 1 分钟；空闲内存不够时后端会拒绝，并说明还差多少。',
      danger: running,
      okText: running ? '关掉' : '启动',
    })
    if (!ok) return
    setPowerBusy(kind)
    try {
      const r = await Api.post('/api/' + (kind === 'space' ? 'space' : 'phone') + (running ? '/stop' : '/start'), {})
      const d = (r && r.data) || {}
      if (!r || !r.ok) {
        const why = (r && r.error) || '运行时没有响应'
        toast((running ? '关闭' : '启动') + label + '失败：' + why, 'error')
        return
      }
      if (d.ok === false) {
        // 内存不够时后端返回 HTTP 200 + { ok:false, refused:true, message }
        const why = d.message || d.error || '后端拒绝了这次操作'
        toast((running ? '关闭' : '启动') + label + '失败：' + why, 'error')
        return
      }
      toast(d.message || ((running ? '已关闭' : '正在启动') + label), running ? 'ok' : 'info')
      // 关屏幕时把启动轮询也停掉，避免后续一直等到超时
      if (kind === 'space') {
        setEnsureAt(0)
        setEnsureSec(0)
        setEnsureNote('')
      }
      res.reload()
      space.reload()
    } catch (e) {
      toast((running ? '关闭' : '启动') + label + '失败：' + ((e && e.message) || '未知错误'), 'error')
    } finally {
      setPowerBusy('')
    }
  }

  const chainItems = (st && st.chain)
    ? [
        { label: '画面服务', on: !!st.chain.x11vnc },
        { label: '网页转发', on: !!st.chain.websockify },
        { label: '6080 端口', on: !!st.chain.listening_6080 },
      ]
    : []

  // ── 她自己的屏幕（状态/链路/开关；实时画面在内嵌卡片里，外部浏览器作兜底） ──
  const spaceCard = h(Card, {
    title: '她自己的屏幕',
    sub: '状态 / 链路 / 开关 · 画面在上面的内嵌卡片',
    tag: 'noVNC',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, { kind: 'primary', size: 'sm', onClick: () => { void openHerScreen() }, title: '用系统浏览器打开 noVNC（Alt+S 同效）' }, '打开她的屏幕'),
      h(Btn, { size: 'sm', disabled: spaceBusy || ensureOn, onClick: () => { void doEnsure() }, title: '虚拟机没开就启动，画面链路断了就修' }, spaceBusy ? '处理中…' : '启动/修复'),
      h(Btn, { size: 'sm', kind: 'danger', disabled: !!powerBusy || !st || st.vm === false, onClick: () => { void togglePower('space') } }, '关闭'),
    ),
  },
    h(Row, { gap: 8 },
      h(Dot, { on: !!(st && st.http), tone: space.error ? T.danger : screenSpaceTone(st), size: 8 }),
      h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, space.error ? '状态读不到' : screenSpaceText(st)),
      st && st.healing ? h(Badge, { tone: 'warn' }, '自动修复中') : null,
      h('span', { style: { flex: 1 } }),
      space.at ? h(Note, {}, '更新于 ' + fmtTime(space.at)) : null,
    ),
    space.error ? h(ErrorBox, { title: '读不到她的屏幕状态', error: space.error, onRetry: space.reload }) : null,
    chainItems.length
      ? h(Row, { gap: 6 },
          h(Note, {}, '画面链路：'),
          chainItems.map((it) => h('span', {
            key: it.label,
            style: {
              fontSize: 11, lineHeight: '16px', whiteSpace: 'nowrap',
              color: it.on ? T.ok : T.danger,
              border: '1px solid ' + T.border, borderRadius: 999, padding: '1px 8px',
            },
          }, (it.on ? '✔ ' : '✘ ') + it.label)),
        )
      : null,
    h(KV, { k: 'noVNC 地址', v: (info.data && info.data.spaceUrl) || '运行时还没给地址', mono: true }),
    info.error ? h(ErrorBox, { title: '读不到屏幕地址', error: info.error, onRetry: info.reload }) : null,
    ensureOn
      ? h(Loading, { text: '正在启动/修复：已等 ' + ensureSec + ' 秒' + (st && st.vm ? '（虚拟机已启动，等待桌面画面）' : '（等待虚拟机启动）') })
      : null,
    ensureNote ? h('div', { style: { fontSize: 11.5, color: T.warn, lineHeight: 1.6, whiteSpace: 'pre-wrap' } }, ensureNote) : null,
    h(Note, {}, '她的屏幕是独立的 Linux 虚拟机：实时画面默认嵌在上面的「内嵌虚拟屏幕」卡片里，可以直接在面板里点鼠标、敲键盘。'),
    h(Note, {}, '窗口太小或内嵌被浏览器策略拦住时，用「打开她的屏幕」交给系统浏览器（两种方式看的是同一台虚拟机）。屏幕约占 2~6 GB 内存，不用时点「关闭」释放。'),
    h(Note, {}, '快捷键 Alt+S：随时用系统浏览器打开她的屏幕。'),
  )

  // ── 她的手机（只读截图，3 秒刷新；开关机是重操作） ─────────────────────
  const phoneCard = h(Card, {
    title: '她的手机',
    sub: '只读截图 · 约 3 秒刷新',
    tag: 'Waydroid',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, {
        size: 'sm',
        kind: phoneLive ? 'soft' : 'ghost',
        title: '打开/关闭 3 秒自动刷新（关掉可以省性能，还能随时手动刷新）',
        onClick: () => {
          const next = !phoneLive
          setPhoneLive(next)
          if (next) setPhoneBust(Date.now())
        },
      }, phoneLive ? '自动刷新：开' : '自动刷新：关'),
      h(Btn, { size: 'sm', onClick: () => setPhoneBust(Date.now()), title: '立刻重新截一张' }, '刷新'),
      h(Btn, {
        size: 'sm',
        kind: phoneRunning ? 'danger' : 'primary',
        disabled: !!powerBusy,
        onClick: () => { void togglePower('phone') },
      }, phoneRunning ? '关闭手机' : '启动手机'),
    ),
  },
    phoneRunning === false
      ? h(Empty, { icon: '📱' }, '她的手机没开。它跑在她的 Linux 屏幕里（Waydroid 窗口），点「启动手机」，或先打开「她自己的屏幕」。')
      : null,
    h('div', { style: { width: '100%', height: 380, display: 'flex', background: T.bg2, border: '1px solid ' + T.border, borderRadius: T.radius, overflow: 'hidden' } },
      h(Img, {
        path: '/api/screen/phone?t=' + phoneBust,
        bust: phoneBust,
        alt: '她的手机截图',
        title: '她的手机截图（只读）',
        fit: 'contain',
        width: '100%',
        height: '100%',
        fallback: '手机截图失败（可能手机没开或截图服务忙）',
      }),
    ),
    h(Note, {}, '这是她手机（Waydroid）的只读截图；要操作手机，请打开「她自己的屏幕」，在她桌面上的手机窗口里点。'),
    h(Note, {}, '手机截图偶尔要 1~2 秒；一直失败就先确认手机在运行，再点图上的「重试」。'),
  )

  // ── 你的电脑（只读截图，2.5 秒刷新，可暂停） ─────────────────────────────
  const pcCard = h(Card, {
    title: '你的电脑',
    sub: '只读截图 · 约 2.5 秒刷新',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, {
        size: 'sm',
        kind: pcLive ? 'soft' : 'ghost',
        title: '打开/关闭 2.5 秒自动刷新',
        onClick: () => {
          const next = !pcLive
          setPcLive(next)
          if (next) setPcBust(Date.now())
        },
      }, pcLive ? '自动刷新：开' : '自动刷新：关'),
      h(Btn, { size: 'sm', onClick: () => setPcBust(Date.now()), title: '立刻重新截一张' }, '刷新'),
    ),
  },
    h('div', { style: { width: '100%', height: 300, display: 'flex', background: T.bg2, border: '1px solid ' + T.border, borderRadius: T.radius, overflow: 'hidden' } },
      h(Img, {
        path: '/api/screen/pc?t=' + pcBust,
        bust: pcBust,
        alt: '你的电脑屏幕',
        title: '你的电脑屏幕（只读）',
        fit: 'contain',
        width: '100%',
        height: '100%',
        fallback: '截不到你的电脑画面（桌面内核没运行，兜底截图也失败了）',
      }),
    ),
    h(Note, {}, '这里只是只读截图：她能从画面里看到你的桌面，但不能替你点鼠标。'),
    h(Note, {}, '要让电脑被她操作，请让她用 pc 工具；面板这里只负责显示画面，不提供操作。'),
    h(Note, {}, '桌面内核没开时会改用宿主机兜底截图，第一次会慢几秒。'),
  )

  // ── 环境开关（她屏幕/手机的运行状态 + 内存提示） ─────────────────────────
  const mem = (resources && resources.mem) || []
  const envCard = h(Card, {
    title: '环境开关',
    sub: '她的屏幕 / 她的手机（都很吃内存）',
    tag: '2~6 GB',
    actions: h(Btn, { size: 'sm', onClick: () => { res.reload(); space.reload() }, title: '重新读运行状态' }, '刷新状态'),
  },
    h(Row, { gap: 8 },
      h(Badge, { tone: screenRunning ? 'ok' : undefined }, '她的屏幕：' + (screenRunning === null ? '读取中…' : screenRunning ? '运行中' : '未运行')),
      h(Badge, { tone: phoneRunning ? 'ok' : undefined }, '她的手机：' + (phoneRunning === null ? '读取中…' : phoneRunning ? '运行中' : '未运行')),
      h('span', { style: { flex: 1 } }),
      res.at ? h(Note, {}, '更新于 ' + fmtTime(res.at)) : null,
    ),
    res.error ? h(ErrorBox, { title: '读不到环境状态', error: res.error, onRetry: res.reload }) : null,
    h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'primary', disabled: !!powerBusy || screenRunning === true, onClick: () => { void togglePower('space') } }, '启动她的屏幕'),
      h(Btn, { size: 'sm', kind: 'danger', disabled: !!powerBusy || screenRunning !== true, onClick: () => { void togglePower('space') } }, '关闭她的屏幕'),
      h(Btn, { size: 'sm', kind: 'primary', disabled: !!powerBusy || phoneRunning === true, onClick: () => { void togglePower('phone') } }, '启动她的手机'),
      h(Btn, { size: 'sm', kind: 'danger', disabled: !!powerBusy || phoneRunning !== true, onClick: () => { void togglePower('phone') } }, '关闭她的手机'),
    ),
    h(Note, {}, '启动她的屏幕大约要 9 GB 空闲内存、启动手机大约要 6 GB；不够时后端会拒绝，并在提示里说明原因。'),
    mem.length
      ? h(Row, { gap: 6 },
          h(Note, {}, '当前占用：'),
          mem.map((item, i) => h('span', {
            key: 'screen-mem-' + i,
            style: { fontSize: 11, color: T.text2, border: '1px solid ' + T.border, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
          }, screenMemLabel(item))),
        )
      : h(Note, {}, '当前没有检测到虚拟机/模拟器进程在占内存。'),
    h(Note, {}, '关闭会中断她正在用的环境，属于危险操作，所以每次都会先弹确认框。'),
  )

  const petSection = typeof PetCard === 'function' ? h(PetCard, {}) : null

  return h('div', {
    className: 'sbc-scroll',
    style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  }, embedCard, spaceCard, phoneCard, pcCard, envCard, petSection)
}

    /* ===== src/client/40-screen/pet.js ===== */
// 40-screen/pet.js —— 桌宠卡片（D07 A：桌宠保持独立的 WPF 桌面程序，面板只做开关和状态）
//
// 关键约束（M19 验收）：
//   · 面板刷新 / 切标签只读 /api/pet/status，**不会**自动启动桌宠；
//   · 点「启动桌宠」之前先问一次后端现在是否已经在跑：在跑就只提示，不再调 start；
//     后端 /api/pet/start 本身也是幂等的（已经在跑返回 already:true），两层保险；
//   · 桌宠是桌面上的独立进程，面板不嵌入它，只显示状态和形象/属性；
//   · 停止等于把桌面上的她收起来，属于危险操作 → confirmDialog；
//   · 失败都给中文错误说明（N03）。

const PET_STATUS_POLL_MS = 5000
const PET_MANIFEST_POLL_MS = 20000

// 后端 state 字段（stationary / traveling / intercity）→ 中文
function petStateText(state) {
  if (state === 'traveling') return '正在路上'
  if (state === 'intercity') return '跨城移动中'
  if (state === 'stationary') return '待在原地'
  return state ? String(state) : '—'
}

function petBoolText(v) {
  return v ? '开' : '关'
}

function PetCard(props) {
  // 状态（运行/未启动、角色、地点、活动、精力）+ 形象配置（pet 的图/尺寸/手势/按钮/表情）
  const status = useApi('/api/pet/status', { refreshMs: PET_STATUS_POLL_MS })
  const manifest = useApi('/api/pet/manifest', { refreshMs: PET_MANIFEST_POLL_MS })
  const [busy, setBusy] = React.useState('') // '' | 'start' | 'stop'

  const st = status.data || {}
  const pet = (manifest.data && manifest.data.pet) || st.manifest || {}
  // 状态两个接口都带一份：/api/pet/status 挂了也能用 /api/pet/manifest 里的 status 兜底
  const live = st && Object.keys(st).length ? st : ((manifest.data && manifest.data.status) || {})
  const running = !!live.running
  const character = live.character || {}
  const place = live.place || {}
  const lastHer = live.lastHer || null
  const gestures = Array.isArray(pet.gestures) ? pet.gestures : []
  const expressions = pet.expressions || {}
  const firstLoad = !live.running && !live.character && status.loading

  const reloadAll = () => {
    status.reload()
    manifest.reload()
  }

  // 启动前先按后端状态判断，避免面板刷新/重复点击把桌宠起两份
  const startPet = async () => {
    if (busy) return
    setBusy('start')
    try {
      const cur = await Api.get('/api/pet/status')
      const curData = (cur && cur.data) || {}
      if (cur && cur.ok && curData.running) {
        toast('桌宠已经在运行了，没有重复启动', 'info')
        reloadAll()
        return
      }
      const r = await Api.post('/api/pet/start', {})
      const d = (r && r.data) || {}
      if (!r || !r.ok || d.ok === false) {
        const why = d.error || d.message || (r && r.error) || '运行时没有响应'
        toast('启动桌宠失败：' + why, 'error')
        return
      }
      if (d.already) toast('桌宠本来就在运行，没有重复启动', 'info')
      else toast('桌宠已启动（独立桌面窗口）', 'ok')
    } catch (e) {
      toast('启动桌宠失败：' + ((e && e.message) || '未知错误'), 'error')
    } finally {
      setBusy('')
      reloadAll()
    }
  }

  const stopPet = async () => {
    if (busy) return
    const ok = await confirmDialog('关掉桌宠？', {
      detail: '桌宠是桌面上的独立小程序（WPF）；关掉后桌面上的她就不在了，聊天和记忆不受影响，随时可以再启动。',
      danger: true,
      okText: '关掉',
    })
    if (!ok) return
    setBusy('stop')
    try {
      const r = await Api.post('/api/pet/stop', {})
      const d = (r && r.data) || {}
      if (!r || !r.ok || d.ok === false) {
        const why = d.error || d.message || (r && r.error) || '运行时没有响应'
        toast('关闭桌宠失败：' + why, 'error')
        return
      }
      toast('桌宠已关闭', 'ok')
    } catch (e) {
      toast('关闭桌宠失败：' + ((e && e.message) || '未知错误'), 'error')
    } finally {
      setBusy('')
      reloadAll()
    }
  }

  return h(Card, {
    title: '桌宠',
    sub: '独立桌面程序（WPF）· 面板只做开关和状态',
    tag: 'D07 A',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, {
        kind: 'primary',
        size: 'sm',
        disabled: !!busy || running || firstLoad,
        onClick: () => { void startPet() },
        title: running ? '桌宠已经在运行了' : '启动独立的桌面桌宠（不会重复启动）',
      }, running ? '已启动' : (busy === 'start' ? '启动中…' : '启动桌宠')),
      h(Btn, {
        kind: 'danger',
        size: 'sm',
        disabled: !!busy || !running,
        onClick: () => { void stopPet() },
        title: running ? '关掉桌面上的桌宠' : '桌宠没在运行',
      }, busy === 'stop' ? '关闭中…' : '停止'),
      h(Btn, { size: 'sm', disabled: !!busy, onClick: reloadAll, title: '重新读状态' }, '刷新'),
    ),
  },
    h(Row, { gap: 8 },
      h(Dot, { on: running, tone: running ? T.ok : T.idle, size: 8 }),
      h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } },
        firstLoad ? '读取状态…' : running ? '桌宠在运行' : '桌宠没启动'),
      running ? h(Badge, { tone: 'ok' }, '独立进程') : null,
      character.name ? h(Badge, { title: '当前角色' }, character.name) : null,
      h('span', { style: { flex: 1 } }),
      status.at ? h(Note, {}, '更新于 ' + fmtTime(status.at)) : null,
    ),
    status.error ? h(ErrorBox, { title: '读不到桌宠状态', error: status.error, onRetry: status.reload }) : null,
    manifest.error
      ? h('div', { style: { fontSize: 11.5, color: T.warn, lineHeight: 1.6 } }, '读不到桌宠形象配置：' + manifest.error + '（下面显示的是最后一份数据）')
      : null,
    firstLoad && !status.error
      ? h(Loading, { text: '正在读桌宠状态…' })
      : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, alignItems: 'start' } },
          // 形象预览 + 她现在在干什么
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 } },
            h('div', { style: { width: 88, height: 88, flexShrink: 0, background: T.bg2, border: '1px solid ' + T.border, borderRadius: T.radius, overflow: 'hidden' } },
              h(Img, {
                path: pet.image || '',
                width: '100%',
                height: '100%',
                fit: 'contain',
                alt: '桌宠形象',
                title: '桌宠当前形象',
                fallback: '没有形象图',
              }),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 } },
              h('div', {
                style: { fontSize: 12.5, color: T.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                title: pet.image || '',
              }, character.name || '（角色名没读到）'),
              h('div', { style: { fontSize: 11, color: T.text3, wordBreak: 'break-all' } }, '形象：' + (pet.image || '未配置')),
              h('div', { style: { fontSize: 11, color: T.text3 } },
                (place.icon ? place.icon + ' ' : '') + (place.name || '地点未知') + ' · ' + petStateText(live.state)),
            ),
          ),
          // 她的状态
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h(KV, { k: '在做什么', v: live.activity || '—' }),
            h(KV, { k: '精力', v: live.energy || '—' }),
            h(KV, { k: '状态', v: petStateText(live.state) + (live.transport ? '（' + live.transport + '）' : '') }),
          ),
          // 桌宠形象配置
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h(KV, { k: '桌宠尺寸', v: pet.size ? pet.size + ' px' : '—' }),
            h(KV, { k: '不透明度', v: pet.opacity === undefined ? '—' : Math.round((Number(pet.opacity) || 0) * 100) + '%' }),
            h(KV, { k: '窗口置顶', v: petBoolText(pet.alwaysOnTop) }),
            h(KV, { k: '状态气泡', v: petBoolText(pet.statusText) }),
            h(KV, { k: '手势', v: gestures.length ? gestures.map((g) => g.label || g.id).join(' / ') : '—' }),
            h(KV, { k: '表情', v: Object.keys(expressions).length ? Object.keys(expressions).length + ' 套' : '—' }),
            h(KV, { k: '桌宠按钮', v: Array.isArray(pet.buttons) && pet.buttons.length ? pet.buttons.map((b) => b.title || b.label || b.id).join(' / ') : '—' }),
          ),
        ),
    lastHer
      ? h('div', {
          style: { borderTop: '1px solid ' + T.border, paddingTop: 6, fontSize: 11.5, color: T.text2, lineHeight: 1.6, wordBreak: 'break-word' },
        }, '她最后说：' + String(lastHer.text || '').slice(0, 120) + (lastHer.at ? '（' + fmtTime(lastHer.at) + '）' : ''))
      : null,
    h(Note, {}, '桌宠是桌面上的独立小程序（WPF），浮在窗口最上层；面板里只显示开关和状态，不把它嵌进来。'),
    h(Note, {}, '刷新/切换面板不会重复启动桌宠：这个卡片只读状态，启动只发生在你点「启动桌宠」的时候，而且会先确认后端是不是已经在跑。'),
    h(Note, {}, '想改形象、大小、手势、气泡这些配置，去「设置 → 生活 → 桌宠」；这张卡片只负责开关。'),
  )
}

    /* ===== src/client/50-app/app.js ===== */
// 50-app/app.js —— 原生面板外壳：标签/状态/错误重连/分屏/挂载点
//
// 这是 DSH 客户端半的最后一层，负责把各模块拼成一个面板：
//   · 顶部：角色头像/名字/所在地 + 状态 chips + 刷新
//   · 标签：聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于（打开的标签保持挂载，切走不丢状态）
//   · 聊天标签支持 2D 舞台分屏（拖宽、双击还原、放大、隐藏，宽度持久化）
//   · 断线：状态条变红 + 一键重连；运行时离线时整页给错误态（N03）
//   · 全局只在这里挂 ToastHost / DialogHost 一次
//   · 没有 iframe，也没有任何 HTML 页面请求（M01 验收）

function PanelIcon(props) {
  const size = props && props.size ? props.size : 18
  const active = props && props.active
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.55,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  return h('svg', {
    viewBox: '0 0 24 24', width: size, height: size,
    style: { display: 'block', opacity: active ? 1 : 0.78 },
    'aria-hidden': true,
  },
    h('rect', { x: 8.1, y: 2.6, width: 7.8, height: 18.8, rx: 2.2, ...stroke }),
    h('path', { d: 'M10.4 4.3h3.2', ...stroke }),
    h('path', { d: 'M10.4 19.3h3.2', ...stroke }),
    h('path', { d: 'M18.6 3.6l.65 1.65 1.65.65-1.65.65-.65 1.65-.65-1.65-1.65-.65 1.65-.65z', fill: 'currentColor', stroke: 'none' }),
    h('path', { d: 'M5.1 7.7l.5 1.25 1.25.5-1.25.5-.5 1.25-.5-1.25L3.35 9.95l1.25-.5z', fill: 'currentColor', stroke: 'none' }),
    h('circle', { cx: 4.7, cy: 14.4, r: 0.55, fill: 'currentColor', stroke: 'none' }),
  )
}

// 状态 chips 里的小分隔
function chipSep() {
  return h('span', { style: { width: 1, height: 14, background: T.border, flexShrink: 0 } })
}

function StatusChips(props) {
  const st = props.status || {}
  const tokens = st.tokens || {}
  const wallet = props.wallet || null
  const mode = st.mode
  const money = wallet
    ? (wallet.tokenMode ? '零花 ' + fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元' : fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元')
    : ''
  return h(Row, { gap: 6, style: { minWidth: 0 } },
    h(Badge, { tone: st.error ? 'danger' : 'ok', title: st.error ? '运行时连不上' : '运行时在线' },
      h(Dot, { on: !st.error, style: { width: 6, height: 6 } }),
      st.error ? '离线' : '在线',
    ),
    money ? h(Badge, { title: '她的钱包' }, '💰 ' + money) : null,
    tokens.realBalanceKnown && tokens.tokenMode
      ? h(Badge, { title: 'DeepSeek 真实余额（和她的零花不是同一笔钱）' }, '¥' + fmtMoney(tokens.realRmb))
      : null,
    h(Badge, { title: '运行模式' }, modeLabel(mode)),
    st.energy !== undefined && st.energy !== null ? h(Badge, { title: '她的精力' }, energyLabel(st.energy)) : null,
  )
}

// 「关于」标签：运行时状态 + API 契约入口 + 版本（不链接任何网页）
function AboutView() {
  const status = useStatus()
  const base = useRuntimeBase()
  const [info, setInfo] = React.useState(null)
  const [infoErr, setInfoErr] = React.useState('')
  const [threeState, setThreeState] = React.useState('检测中…')
  const loadInfo = React.useCallback(() => {
    Api.get('/api/version').then((r) => {
      if (r.ok) { setInfo(r.data); setInfoErr('') } else { setInfo(null); setInfoErr(r.error || '读取失败') }
    })
  }, [])
  React.useEffect(() => { loadInfo() }, [loadInfo])
  // 3D 舞台引擎自检：面板里 three 是从本机运行时动态 import 的（跨源 + blob 依赖改写），
  // 在宿主页面策略不同的地方可能被拦；这里直接探一次，失败就显示原因（面板会自动回退 2D）。
  React.useEffect(() => {
    let alive = true
    setThreeState('检测中…')
    const probe = async () => {
      try {
        const b = await Runtime.base()
        const mod = await import(b + '/vendor/three.module.min.js')
        if (!alive) return
        if (mod && typeof mod.WebGLRenderer === 'function') setThreeState('可用（three ' + String(mod.REVISION || '?') + '）')
        else setThreeState('已加载，但缺少 WebGLRenderer')
      } catch (e) {
        if (!alive) return
        setThreeState('加载失败：' + String((e && e.message) || e))
      }
    }
    probe()
    return () => { alive = false }
  }, [])
  const st = status.data || {}
  return h('div', { className: 'sbc-scroll', style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 } },
    h(Card, { title: '屏幕彼端 · 原生面板', sub: 'DSH 原生 React，不再用 iframe 嵌网页', tag: '0 个 iframe' },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 8 } },
        h(KV, { k: '运行时', v: base || '未发现' , mono: true }),
        h(KV, { k: '插件版本', v: (CLIENT_BUILD && CLIENT_BUILD.pluginVersion) || '—' }),
        h(KV, { k: '运行时版本', v: st.version || '—' }),
        h(KV, { k: '数据目录', v: (st.setup && st.setup.dataRoot) || '—', mono: true }),
        h(KV, { k: '当前角色', v: (st.character && st.character.name) || '—' }),
        h(KV, { k: '消息条数', v: st.count === undefined ? '—' : String(st.count) }),
        h(KV, { k: '模型', v: st.model || '—' }),
        h(KV, { k: 'API 版本', v: info && info.apiVersion !== undefined ? String(info.apiVersion) : (infoErr || '读取中…') }),
        h(KV, { k: '3D 舞台引擎', v: threeState }),
      ),
    ),
    // 插件更新（检查/一键更新）
    typeof UpdateCard === 'function' ? h(UpdateCard, {}) : null,
    h(Card, { title: '接口契约', sub: '给未来手机客户端用的冻结契约（不做手机 UI）' },
      h(Note, {}, '后端业务 API 保持不变；契约文档在插件目录 docs/API-CONTRACT.md，机器可读版本在 docs/schema/。'),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'ghost', size: 'sm', onClick: () => { Api.openExternal('/api/version') } }, '在浏览器打开 /api/version'),
        h(Btn, { kind: 'ghost', size: 'sm', onClick: loadInfo }, '重新读取'),
      ),
    ),
    h(Card, { title: '旧网页（仅开发调试）', sub: 'S06：不再提供给用户' },
      h(Note, {}, '运行时默认不再对外提供 /、/map、/settings、/stage、/model、/screen 这些网页入口；'),
      h(Note, {}, '需要对照调试时，用环境变量 DSH_COMPANION_LEGACY_WEB=1 启动运行时才会继续提供。'),
    ),
    h(Card, { title: '面板快捷键', sub: '' },
      h(Note, {}, 'Alt+S：用系统浏览器打开她的屏幕（noVNC）。'),
      h(Note, {}, '聊天分屏：拖动舞台左边缘调宽；双击分界线恢复 50%。'),
    ),
  )
}

// 单个标签内容渲染出错时兜住，避免整个面板白屏（N03）
class SbcViewBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: '' } }
  static getDerivedStateFromError(e) { return { error: String((e && e.message) || e) } }
  componentDidCatch(e) { try { console.warn('[screen-beyond] 视图渲染失败', e) } catch (err) {} }
  render() {
    if (this.state.error) {
      return h('div', { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 8 } },
        h(ErrorBox, {
          title: ((this.props && this.props.name) || '面板') + '渲染失败',
          error: this.state.error,
          onRetry: () => this.setState({ error: '' }),
        }),
        h(Note, {}, '点「重试」重新渲染；反复失败说明这次的数据有异常。'),
      )
    }
    return (this.props && this.props.children) || null
  }
}

function AppShell() {
  ensureUiStyle()
  const base = useRuntimeBase()
  const status = useStatus()
  const st = status.data || {}
  // 标签持久化。注意：面板重新挂载时（刷新/客户端热更新）如果 localStorage 里记的是别的标签，
  // 必须把那个标签一起标成「已打开」，否则会出现「标签高亮但内容空白」（真机踩到过）。
  const [tabRaw, setTab] = useLocal('companionTab', 'chat')
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw : 'chat'
  const [opened, setOpened] = React.useState(() => ({ chat: true, [tab]: true }))
  const [wallet, setWallet] = React.useState(null)
  const [reconnecting, setReconnecting] = React.useState(false)
  const [screenBusy, setScreenBusy] = React.useState(false)

  const openTab = React.useCallback((key) => {
    setTab(key)
    setOpened((prev) => (prev[key] ? prev : Object.assign({}, prev, { [key]: true })))
    // 兜底：给其它模块一个切标签的入口（StageView 无底图时引导去地图页）
    try { window.__sbcOpenTab = openTab } catch (e) {}
  }, [setTab])

  // 钱包（零花/真实余额）不是 /api/status 的字段，单独拉 + 高频刷新（用户反馈余额延迟大）
  const loadWallet = React.useCallback(() => {
    Api.get('/api/economy').then((r) => { if (r.ok && r.data) setWallet(r.data.wallet || null) })
  }, [])
  // 让运行时立刻去 DeepSeek 查一次真实余额（它自己会合并 4 秒内的重复请求），然后拉状态 + 钱包
  const refreshBalanceNow = React.useCallback(async () => {
    await Api.post('/api/balance/refresh', {})
    await pollStatusOnce()
    loadWallet()
  }, [loadWallet])
  React.useEffect(() => { loadWallet() }, [loadWallet, base])
  useInterval(loadWallet, 10000)

  // 她这一轮说完话（typing true→false）立刻刷一次余额：token 刚花掉，别等定时器
  const wasTyping = React.useRef(!!(st.typing))
  React.useEffect(() => {
    const nowTyping = !!st.typing
    if (wasTyping.current && !nowTyping) refreshBalanceNow()
    wasTyping.current = nowTyping
  }, [st.typing, refreshBalanceNow])

  // Alt+S：她的屏幕交给系统浏览器（D06 A：面板里不嵌 noVNC）
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (typeof openHerScreen === 'function') openHerScreen().catch(() => {})
        else Api.openExternal('/screen')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const retry = React.useCallback(async () => {
    setReconnecting(true)
    try {
      Runtime.reset()
      let ok = false
      let lastErr = ''
      for (let i = 0; i < 10; i++) {
        try {
          await Runtime.discover(true)
          await pollStatusOnce()
          const snap = StatusStore.get()
          if (snap && snap.data && snap.data.version && !snap.error) { ok = true; break }
          lastErr = (snap && snap.error) || ''
        } catch (e) {
          lastErr = String((e && e.message) || e)
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
      if (ok) toast('已连上运行时')
      else toast('还连不上运行时' + (lastErr ? '：' + lastErr : '（等几秒再点一次）'), 'error')
    } finally {
      setReconnecting(false)
    }
  }, [])

  // 聊天分屏舞台（宽度持久化：companionStageWidth / companionShowStage）
  const [showStage, setShowStage] = useLocal('companionShowStage', true)
  const [stageWidth, setStageWidth] = useLocal('companionStageWidth', 50)
  const [stageMax, setStageMax] = React.useState(false)
  const [dragStage, setDragStage] = React.useState(false)
  const splitRef = React.useRef(null)
  const changeStageWidth = React.useCallback((w, persist) => {
    const v = Math.min(85, Math.max(20, Math.round(Number(w) || 50)))
    if (persist) setStageWidth(v)
    else {
      // 拖动过程只改 DOM，松手才写状态，避免每帧重渲染（N04）
      try { if (splitRef.current) splitRef.current.style.setProperty('--sbc-stage-w', v + '%') } catch (e) {}
    }
    return v
  }, [setStageWidth])
  const onDividerDown = React.useCallback((e) => {
    if (e.button && e.button !== 0) return
    e.preventDefault()
    const el = splitRef.current
    if (!el) return
    setDragStage(true)
    const move = (ev) => {
      const rect = el.getBoundingClientRect()
      if (!rect.width) return
      const v = Math.min(85, Math.max(20, Math.round(100 - ((ev.clientX - rect.left) / rect.width) * 100)))
      try { el.style.setProperty('--sbc-stage-w', v + '%') } catch (err) {}
    }
    const up = (ev) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragStage(false)
      const rect = el.getBoundingClientRect()
      if (rect.width) changeStageWidth(100 - ((ev.clientX - rect.left) / rect.width) * 100, true)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [changeStageWidth])

  const statusErr = status.error
  const runtimeDown = !!statusErr && !st.version
  const widthStyle = { '--sbc-stage-w': (stageMax ? 100 : Math.min(85, Math.max(20, Number(stageWidth) || 50))) + '%' }

  const paneStyle = (key) => ({
    display: tab === key ? 'flex' : 'none',
    flex: 1, minHeight: 0, minWidth: 0, flexDirection: 'column',
  })

  let body
  if (runtimeDown && !st.version) {
    body = h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 } },
      h('div', { style: { maxWidth: 560, width: '100%', display: 'flex', flexDirection: 'column', gap: 10 } },
        h(ErrorBox, { title: '运行时没起来', error: statusErr || '连接不上本机运行时', onRetry: retry }),
        h(Note, {}, '屏幕彼端的 Node 运行时由插件自动拉起（端口 8900 起自动避让）。'),
        h(Note, {}, '第一次启动或版本升级后要等几秒；一直失败可以点「重试」，或检查插件是否被禁用。'),
        h(Row, { gap: 8 }, h(Btn, { kind: 'primary', onClick: retry, disabled: reconnecting }, reconnecting ? '重连中…' : '重试连接')),
      ),
    )
  } else {
    body = h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
      // 聊天（可带 2D 舞台分屏）
      h('div', { key: 'chat', style: paneStyle('chat') },
        h('div', {
          ref: splitRef,
          style: Object.assign({
            display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0, gap: 0,
          }, widthStyle),
        },
          h('div', { style: { flex: 1, minHeight: 0, display: 'flex', gap: 8 } },
            h('div', { style: { flex: 1, minWidth: 0, display: showStage && stageMax ? 'none' : 'flex', flexDirection: 'column' } },
              h(SbcViewBoundary, { name: '聊天' }, h(ChatView, {
                stageOpen: !!showStage,
                onToggleStage: () => setShowStage((v) => !v),
              })),
            ),
            showStage
              ? h('div', {
                  onPointerDown: onDividerDown,
                  onDoubleClick: () => changeStageWidth(50, true),
                  title: '拖动调整舞台宽度，双击恢复 50%',
                  style: {
                    flex: '0 0 6px', cursor: 'col-resize', borderRadius: 3,
                    background: dragStage ? T.brand : 'rgba(127,127,127,.18)',
                  },
                })
              : null,
            showStage
              ? h('div', {
                  style: {
                    flex: stageMax ? '1 1 100%' : '0 0 var(--sbc-stage-w, 50%)',
                    minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4,
                  },
                },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' } },
                    h('span', { style: { fontSize: 11, color: T.text3 } }, '舞台'),
                    h('span', { style: { flex: 1 } }),
                    h(Chip, { active: stageMax, onClick: () => setStageMax((v) => !v), title: stageMax ? '还原布局' : '把舞台放到最大' }, stageMax ? '还原' : '放大'),
                    h(Chip, { onClick: () => openTab('stage'), title: '在「舞台」标签里看大图' }, '大图'),
                    h(Chip, { onClick: () => setShowStage(false), title: '隐藏舞台，只留聊天' }, '隐藏'),
                    stageMax ? null : h('span', { style: { fontSize: 10, color: T.text3, minWidth: 26, textAlign: 'right' } }, (Number(stageWidth) || 50) + '%'),
                  ),
                  h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, h(SbcViewBoundary, { name: '舞台' }, h(StageView, { compact: true, onOpenMap: () => openTab('map') }))),
                )
              : null,
          ),
        ),
      ),
      // 独立标签页（打开过就保持挂载）
      opened.stage ? h('div', { key: 'stage', style: paneStyle('stage') }, h(SbcViewBoundary, { name: '舞台' }, h(StageView, { onOpenMap: () => openTab('map') }))) : null,
      opened.map ? h('div', { key: 'map', style: paneStyle('map') }, h(SbcViewBoundary, { name: '地图' }, h(MapView, {}))) : null,
      opened.settings ? h('div', { key: 'settings', style: paneStyle('settings') }, h(SbcViewBoundary, { name: '设置' }, h(SettingsView, {}))) : null,
      opened.screen ? h('div', { key: 'screen', style: paneStyle('screen') }, h(SbcViewBoundary, { name: '屏幕' }, h(ScreenView, {}))) : null,
      opened.about ? h('div', { key: 'about', style: paneStyle('about') }, h(SbcViewBoundary, { name: '关于' }, h(AboutView, {}))) : null,
    )
  }

  return h('div', {
    style: {
      display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0,
      boxSizing: 'border-box', background: T.bg, color: T.text, fontFamily: T.font,
      fontSize: 13, lineHeight: 1.6,
    },
  },
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '8px 12px 6px', borderBottom: '1px solid ' + T.border, background: T.bg1, flexShrink: 0,
      },
    },
      h(Avatar, { path: st.character && st.character.avatar, name: st.character && st.character.name, size: 30 }),
      h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' } },
          h('span', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, (st.character && st.character.name) || '屏幕彼端'),
          st.place ? h('span', { style: { fontSize: 11.5, color: T.text2 } }, (st.place.icon ? st.place.icon + ' ' : '') + (st.place.name || '')) : null,
        ),
        h('div', { style: { fontSize: 10.5, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 460 } },
          st.typing ? '正在输入…' : ((st.place && st.place.traveling) ? '在路上…' : '就在这里'),
        ),
      ),
      h('span', { style: { flex: 1 } }),
      StatusChips({ status: { error: statusErr, ...st }, wallet }),
      h(Btn, { size: 'sm', kind: 'ghost', title: '立刻刷新状态和 DeepSeek 真实余额', onClick: () => { refreshBalanceNow() } }, '刷新'),
      h(Btn, { size: 'sm', kind: 'ghost', title: '用系统浏览器打开她的屏幕（noVNC）', disabled: screenBusy, onClick: async () => {
        setScreenBusy(true)
        try { if (typeof openHerScreen === 'function') await openHerScreen(); else Api.openExternal('/screen') }
        finally { setScreenBusy(false) }
      } }, '看屏幕'),
    ),
    // 标签条
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', borderBottom: '1px solid ' + T.border, background: T.bg, flexShrink: 0 } },
      h(Tabs, { value: tab, items: TABS, onChange: openTab }),
      h('span', { style: { flex: 1 } }),
      statusErr && st.version ? h(Btn, { size: 'sm', kind: 'danger', onClick: retry, disabled: reconnecting }, reconnecting ? '重连中…' : '断线重连') : null,
    ),
    // 断线提示条（有旧数据时不清空界面，只提示）
    statusErr && st.version
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', background: 'rgba(239,83,80,.12)', borderBottom: '1px solid ' + T.border, fontSize: 11.5, color: T.text2 } },
          h(Dot, { on: false, tone: T.danger }),
          h('span', null, '运行时无响应：' + statusErr + '（显示的是最后一次数据）'),
          h('span', { style: { flex: 1 } }),
          h(Btn, { size: 'sm', kind: 'ghost', onClick: retry, disabled: reconnecting }, '重连'),
        )
      : null,
    body,
    h(ToastHost, {}),
    h(DialogHost, {}),
  )
}

// 设置页里的启动器（兜底入口；主入口在左侧栏）
function CompanionLauncher() {
  const status = useStatus()
  const st = status.data || {}
  const error = status.error
  return h('div', { style: { padding: '12px 2px', display: 'flex', flexDirection: 'column', gap: 8 } },
    h(Row, { gap: 8 },
      h(Avatar, { path: st.character && st.character.avatar, name: st.character && st.character.name, size: 34 }),
      h('div', { style: { display: 'flex', flexDirection: 'column' } },
        h('div', { style: { fontSize: 13.5, fontWeight: 600, color: T.text } }, '屏幕彼端'),
        h('div', { style: { fontSize: 11.5, color: T.text2 } },
          error ? '运行时离线' : '运行时在线 · ' + modeLabel(st.mode) + ' · 记忆 ' + (((st.memory && st.memory.live) || 0)) + ' 条',
        ),
      ),
    ),
    h(Note, {}, '原生面板在左侧栏「屏幕彼端」图标里打开；这里只显示状态和外部入口。'),
    h(Row, { gap: 8 },
      h(Btn, { kind: 'primary', size: 'sm', onClick: () => {
        try { window.open((Runtime.baseSync() || DEFAULT_BASE) + '/api/version', '_blank', 'noopener') } catch (e) {}
      } }, '打开 API 版本信息'),
      h(Btn, { kind: 'ghost', size: 'sm', onClick: () => { pollStatusOnce() } }, '刷新状态'),
    ),
  )
}

function apply(ctx) {
  ensureUiStyle()
  const slots = ctx.get('slots')
  if (slots === undefined) return
  try {
    slots.inject('sidebar.panellist', () =>
      slots.register({ name: 'sidebar.panellist', id: 'companion', order: 21, label: () => '屏幕彼端' }, PanelIcon),
    )
  } catch (e) { console.warn('[screen-beyond] 注册左栏入口失败', e) }
  try {
    slots.inject('main', () => slots.register({ name: 'main', key: 'companion' }, AppShell))
  } catch (e) { console.warn('[screen-beyond] 注册主面板失败', e) }
  try {
    slots.inject('settings.section', () =>
      slots.register({ name: 'settings.section', id: 'companion-settings', order: 12, label: () => '屏幕彼端' }, CompanionLauncher),
    )
  } catch (e) { console.warn('[screen-beyond] 注册设置入口失败', e) }
}
    exports.apply = apply
    exports.inject = inject
    exports.clientBuild = CLIENT_BUILD
    return module.exports
  },
})
