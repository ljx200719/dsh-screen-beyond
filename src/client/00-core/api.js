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
