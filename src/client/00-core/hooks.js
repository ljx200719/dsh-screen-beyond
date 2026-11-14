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
