// DSH Companion 客户端半：
//  - 左侧栏「屏幕彼端」图标入口 + 主区域整页聊天（sidebar.panellist + main）
//  - 设置页里的启动器（兜底）
//  - 运行时地址从宿主路由 /dsh-screen-beyond/info 动态获取（端口自动避让，不写死 8900）
window.__ModuleLoader__.load({
  id: 'dsh-screen-beyond',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const h = React.createElement
    const inject = ['slots']
    const DEFAULT_BASE = 'http://127.0.0.1:8900'

    const brand = 'var(--dsw-alias-state-business-primary, #2f6bd8)'
    const border = 'var(--dsw-alias-border-l1, rgba(255,255,255,.12))'
    const text = 'var(--dsw-alias-label-primary, #d7dee8)'

    const STATUS_POLL_MS = 4000
    let discoveredBase = ''
    let discoveryPromise = null
    // 运行时开了 API token 时（DSH_COMPANION_API_TOKEN），面板的跨源 fetch 需要带 token；页面 iframe 走 cookie 不用管
    let apiTokenCache = ''
    let apiTokenPending = null
    async function ensureApiToken(base) {
      if (apiTokenCache) return apiTokenCache
      if (apiTokenPending) return apiTokenPending
      apiTokenPending = (async () => {
        try {
          const r = await fetch(base + '/api/token', { cache: 'no-store' })
          if (r.ok) { const j = await r.json(); apiTokenCache = (j && j.token) || '' }
        } catch (e) {}
        apiTokenPending = null
        return apiTokenCache
      })()
      return apiTokenPending
    }
    async function apiFetch(base, p, opts) {
      const t = await ensureApiToken(base)
      const o = Object.assign({}, opts || {})
      o.headers = Object.assign({}, (o.headers || {}))
      if (t) o.headers['x-companion-token'] = t
      const r = await fetch(base + p, o)
      if (r.status === 401) apiTokenCache = ''
      return r
    }
    const runtimeListeners = new Set()
    function emitBase(base) {
      discoveredBase = base || ''
      runtimeListeners.forEach((fn) => { try { fn(discoveredBase) } catch (e) {} })
    }
    function resetRuntimeDiscovery() {
      discoveredBase = ''
      discoveryPromise = null
    }
    async function probeStatus(base) {
      try {
        const r = await apiFetch(base, '/api/status', { cache: 'no-store' })
        if (!r.ok) return null
        const j = await r.json()
        return j && typeof j === 'object' ? j : null
      } catch (e) { return null }
    }
    async function discoverRuntime() {
      if (discoveredBase) return discoveredBase
      if (discoveryPromise) return discoveryPromise
      discoveryPromise = (async () => {
        // 1) 宿主路由（正常情况）
        try {
          const r = await fetch('/dsh-screen-beyond/info', { cache: 'no-store' })
          if (r.ok) {
            const j = await r.json()
            if (j && j.url && await probeStatus(j.url)) {
              try { localStorage.setItem('companionBase', j.url) } catch (e) {}
              emitBase(j.url)
              return j.url
            }
          }
        } catch (e) {}
        // 2) 本地缓存
        try {
          const cached = localStorage.getItem('companionBase')
          if (cached && await probeStatus(cached)) { emitBase(cached); return cached }
        } catch (e) {}
        // 3) 端口扫描兜底（8900-8912）
        for (let port = 8900; port <= 8912; port++) {
          const url = 'http://127.0.0.1:' + port
          if (url === discoveredBase) continue
          if (await probeStatus(url)) {
            try { localStorage.setItem('companionBase', url) } catch (e) {}
            emitBase(url)
            return url
          }
        }
        emitBase(DEFAULT_BASE)
        return DEFAULT_BASE
      })().finally(() => { discoveryPromise = null })
      return discoveryPromise
    }
    function useRuntimeBase() {
      const [base, setBase] = React.useState(() => {
        try { return localStorage.getItem('companionBase') || DEFAULT_BASE } catch (e) { return DEFAULT_BASE }
      })
      React.useEffect(() => {
        let alive = true
        const fn = (b) => { if (alive && b) setBase(b) }
        runtimeListeners.add(fn)
        discoverRuntime().then((u) => { if (alive && u) fn(u) }).catch(() => {})
        return () => { alive = false; runtimeListeners.delete(fn) }
      }, [])
      return base
    }

    // ── 全局单例状态轮询 ─────────────────────────────────────────────
    // 所有挂载点共享同一份 /api/status；页面隐藏时暂停；payload 未变不通知。
    const statusListeners = new Set()
    let statusState = { data: null, error: null, at: 0 }
    let statusRaw = ''
    let statusTimer = 0
    let statusFetching = false
    let statusFails = 0
    let statusBase = ''
    let statusVisibilityBound = false
    function emitStatus(patch) {
      statusState = Object.assign({}, statusState, patch)
      statusListeners.forEach((fn) => { try { fn(statusState) } catch (e) {} })
    }
    async function pollStatus(base) {
      if (!base || statusFetching) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      statusFetching = true
      try {
        const r = await apiFetch(base, '/api/status', { cache: 'no-store' })
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const payload = await r.json()
        const raw = JSON.stringify(payload)
        statusFails = 0
        if (raw !== statusRaw) {
          statusRaw = raw
          emitStatus({ data: payload, error: null, at: Date.now() })
        } else {
          statusState.at = Date.now()
        }
      } catch (e) {
        statusFails += 1
        if (statusFails >= 2) {
          emitStatus({ error: '运行时无响应' })
          resetRuntimeDiscovery()
          try { localStorage.removeItem('companionBase') } catch (e2) {}
          void discoverRuntime()
        }
      } finally {
        statusFetching = false
      }
    }
    function syncStatusTimer(base) {
      statusBase = base || ''
      const need = statusListeners.size > 0 && !!statusBase
      if (need && !statusTimer) {
        statusTimer = setInterval(() => { void pollStatus(statusBase) }, STATUS_POLL_MS)
        void pollStatus(statusBase)
      } else if (!need && statusTimer) {
        clearInterval(statusTimer)
        statusTimer = 0
      }
    }
    function bindStatusVisibility() {
      if (statusVisibilityBound || typeof document === 'undefined') return
      statusVisibilityBound = true
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (statusListeners.size) syncStatusTimer(statusBase)
        } else if (statusTimer) {
          clearInterval(statusTimer)
          statusTimer = 0
        }
      })
    }
    function useCompanionStatus(base) {
      const [snap, setSnap] = React.useState(statusState)
      React.useEffect(() => {
        const fn = (s) => setSnap(s)
        statusListeners.add(fn)
        bindStatusVisibility()
        fn(statusState)
        syncStatusTimer(base)
        return () => { statusListeners.delete(fn); syncStatusTimer(base) }
      }, [base])
      return snap
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 18
      const active = props && props.active
      // 手机 + 星星/微光：她在自己的手机里，也在屏幕另一端
      const stroke = {
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.55,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, style: { display: 'block', opacity: active ? 1 : 0.78 }, 'aria-hidden': true },
        h('rect', { x: 8.1, y: 2.6, width: 7.8, height: 18.8, rx: 2.2, ...stroke }),
        h('path', { d: 'M10.4 4.3h3.2', ...stroke }),
        h('path', { d: 'M10.4 19.3h3.2', ...stroke }),
        h('path', { d: 'M18.6 3.6l.65 1.65 1.65.65-1.65.65-.65 1.65-.65-1.65-1.65-.65 1.65-.65z', fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M5.1 7.7l.5 1.25 1.25.5-1.25.5-.5 1.25-.5-1.25L3.35 9.95l1.25-.5z', fill: 'currentColor', stroke: 'none' }),
        h('circle', { cx: 4.7, cy: 14.4, r: 0.55, fill: 'currentColor', stroke: 'none' }),
      )
    }

    function tabBtn(on) {
      return {
        padding: '5px 14px',
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid ' + (on ? brand : border),
        background: on ? 'rgba(47,107,216,.18)' : 'transparent',
        color: 'inherit',
        fontSize: 13,
      }
    }

    function chipBtn(on) {
      return {
        padding: '2px 9px',
        borderRadius: 6,
        cursor: 'pointer',
        border: '1px solid ' + (on ? brand : border),
        background: on ? 'rgba(47,107,216,.18)' : 'rgba(255,255,255,.04)',
        color: 'inherit',
        fontSize: 11,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
      }
    }

    function CompanionPage() {
      const base = useRuntimeBase()
      useCompanionStatus(base) // 共享状态轮询；主页面不额外渲染状态条
      React.useEffect(() => {
        const onKey = (e) => {
          if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); try { window.open(base + '/screen', '_blank') } catch (err) {} }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [base])
      const [tab, setTab] = React.useState('chat')
      const [openedTabs, setOpenedTabs] = React.useState(() => new Set(['chat']))
      const openTab = (name) => {
        setTab(name)
        setOpenedTabs((prev) => prev.has(name) ? prev : new Set([...prev, name]))
      }
      const readStageView = () => { try { const v = localStorage.getItem('companionStageView'); return v === '2d' || v === '3d' ? v : '' } catch (e) { return '' } }
      const [stageView, setStageViewState] = React.useState(() => readStageView() || '2d')
      const [can3d, setCan3d] = React.useState(false)
      const setStageView = (v) => {
        setStageViewState(v)
        try { localStorage.setItem('companionStageView', v) } catch (e) {}
      }
      const [showStage, setShowStage] = React.useState(() => {
        try { return localStorage.getItem('companionShowStage') !== '0' } catch (e) { return true }
      })
      const [stageMax, setStageMax] = React.useState(false)
      const [dragStage, setDragStage] = React.useState(false)
      const [stageWidth, setStageWidth] = React.useState(() => {
        try {
          const n = Number(localStorage.getItem('companionStageWidth'))
          return n ? Math.min(85, Math.max(20, n)) : 50
        } catch (e) { return 50 }
      })
      const toggleStage = () => {
        const next = !showStage
        setShowStage(next)
        try { localStorage.setItem('companionShowStage', next ? '1' : '0') } catch (e) {}
      }
      const changeStageWidth = (w, persist) => {
        const v = Math.min(85, Math.max(20, Math.round(Number(w) || 50)))
        setStageWidth(v)
        if (persist !== false) { try { localStorage.setItem('companionStageWidth', String(v)) } catch (e) {} }
      }
      // 地图没有 3D 资源时强制 2D；即使 localStorage 里残留 3d 也不能白屏。
      // 没选过时按地图 displayMode 自动判断，默认先给 2D。
      React.useEffect(() => {
        let alive = true
        apiFetch(base, '/api/stage', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => {
            if (!alive || !j || !j.map) return
            const saved = readStageView()
            const has3d = j.map.has3d === true
            setCan3d(has3d)
            if (!has3d) {
              setStageViewState('2d')
              try { localStorage.setItem('companionStageView', '2d') } catch (e) {}
            } else if (!saved) {
              setStageViewState(j.map.displayMode === '3d' ? '3d' : '2d')
            }
          })
          .catch(() => {
            // 拿不到舞台数据时也不能让残留的 3d 选择把面板弄成白屏，回退 2D。
            if (alive) {
              setCan3d(false)
              setStageViewState('2d')
            }
          })
        return () => { alive = false }
      }, [base])
      // 拖动分界线调整舞台宽度（双击恢复 50%）
      const splitRef = React.useRef(null)
      const onDividerDown = (e) => {
        if (e.button && e.button !== 0) return
        e.preventDefault()
        setDragStage(true)
        const el = splitRef.current
        if (!el) return
        const move = (ev) => {
          const rect = el.getBoundingClientRect()
          if (!rect.width) return
          changeStageWidth(100 - ((ev.clientX - rect.left) / rect.width) * 100, false)
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
      }
      const stageUrl = base + (stageView === '3d' ? '/model' : '/stage')
      const url = tab === 'chat' ? base + '/'
        : tab === 'stage' ? stageUrl
        : tab === 'screen' ? base + '/screen'
        : tab === 'map' ? base + '/map' : base + '/settings'
      const frameStyle = { flex: 1, minWidth: 0, minHeight: 0, border: '1px solid ' + border, borderRadius: 10, background: '#0b0f14' }
      const dragFrameStyle = dragStage ? { ...frameStyle, pointerEvents: 'none' } : frameStyle
      const chatFrame = h('iframe', { key: 'chat-' + base, src: base + '/', title: '聊天', style: dragFrameStyle })
      const stageFrame = h('iframe', { key: 'stage-' + stageView + '-' + base, src: stageUrl, title: '舞台', style: dragFrameStyle })
      const split = tab === 'chat' && showStage
      const wrapStyle = (on) => ({ flex: 1, minHeight: 0, minWidth: 0, display: on ? 'flex' : 'none', gap: 8 })
      const tabFrame = (name) => openedTabs.has(name) ? h('div', { key: name + '-wrap', style: wrapStyle(tab === name) },
        h('iframe', {
          key: name + '-frame-' + base,
          src: base + (name === 'map' ? '/map' : name === 'screen' ? '/screen' : name === 'settings' ? '/settings' : stageUrl),
          title: name,
          style: { flex: 1, minWidth: 0, minHeight: 0, width: '100%', border: '1px solid ' + border, borderRadius: 10, background: '#0b0f14' },
        }),
      ) : null
      const stageHeader = h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px', flexWrap: 'wrap' },
      },
        h('span', { style: { fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap' } }, '舞台'),
        h('button', { style: chipBtn(stageView === '2d'), title: '2D 舞台（地图俯视）', onClick: () => setStageView('2d') }, '2D'),
        h('button', { style: { ...chipBtn(stageView === '3d'), opacity: can3d ? 1 : 0.38, cursor: can3d ? 'pointer' : 'not-allowed' }, disabled: !can3d, title: can3d ? '3D 舞台' : '当前地图没有 3D 资源', onClick: () => { if (can3d) setStageView('3d') } }, '3D'),
        h('span', { style: { flex: 1 } }),
        h('button', { style: chipBtn(stageMax), title: stageMax ? '还原布局' : '把舞台放到最大', onClick: () => setStageMax((v) => !v) }, stageMax ? '还原' : '放大'),
        h('button', { style: chipBtn(false), title: '在新窗口打开当前舞台', onClick: () => { try { window.open(stageUrl, '_blank') } catch (err) {} } }, '弹出'),
        h('button', { style: chipBtn(false), title: '隐藏舞台（只留聊天）', onClick: toggleStage }, '隐藏'),
        h('span', { style: { fontSize: 10, opacity: 0.45, minWidth: 30, textAlign: 'right' } }, (stageMax ? 100 : stageWidth) + '%'),
      )
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, padding: '6px 10px 10px', boxSizing: 'border-box', gap: 6, background: 'var(--dsw-alias-bg-base, #0b0f14)' } },
        h(
          'div',
          { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h('button', { style: tabBtn(tab === 'chat'), onClick: () => openTab('chat') }, '聊天'),
          h('button', { style: tabBtn(tab === 'stage'), onClick: () => openTab('stage') }, '舞台'),
          h('button', { style: tabBtn(tab === 'screen'), onClick: () => openTab('screen') }, '屏幕'),
          h('button', { style: tabBtn(tab === 'map'), onClick: () => openTab('map') }, '地图'),
          h('button', { style: tabBtn(tab === 'settings'), onClick: () => openTab('settings') }, '设置'),
          tab === 'stage' ? h('span', { style: { display: 'inline-flex', gap: 4 } },
            h('button', { style: tabBtn(stageView === '2d'), onClick: () => setStageView('2d') }, '2D'),
            h('button', { style: { ...tabBtn(stageView === '3d'), opacity: can3d ? 1 : 0.38, cursor: can3d ? 'pointer' : 'not-allowed' }, disabled: !can3d, title: can3d ? '3D 舞台' : '当前地图没有 3D 资源', onClick: () => { if (can3d) setStageView('3d') } }, '3D'),
          ) : null,
          tab === 'chat' ? h('button', { style: chipBtn(showStage), onClick: toggleStage, title: showStage ? '隐藏舞台' : '显示舞台' }, showStage ? '隐藏舞台' : '显示舞台') : null,
          h('button', { style: { ...tabBtn(false), marginLeft: 'auto' }, onClick: () => window.open(base + '/screen', '_blank') }, '看屏幕'),
          h('a', { href: url, target: '_blank', rel: 'noreferrer', title: base, style: { fontSize: 12, color: 'var(--dsw-alias-state-business-primary, #59a6ff)', textDecoration: 'none', whiteSpace: 'nowrap' } }, '在新窗口打开'),
        ),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
          h('div', { style: { flex: 1, minHeight: 0, display: tab === 'chat' ? 'flex' : 'none', gap: 8 } },
            split
              ? h('div', { ref: splitRef, style: { flex: 1, minHeight: 0, display: 'flex', gap: 6, alignItems: 'stretch' } },
                  h('div', { style: { flex: stageMax ? '0 0 0px' : '1 1 auto', minWidth: 0, display: stageMax ? 'none' : 'flex' } }, chatFrame),
                  stageMax ? null : h('div', {
                    onPointerDown: onDividerDown,
                    onDoubleClick: () => changeStageWidth(50),
                    title: '拖动调整舞台宽度，双击恢复 50%',
                    style: { flex: '0 0 6px', cursor: 'col-resize', borderRadius: 3, background: 'rgba(255,255,255,.10)' },
                  }),
                  h('div', {
                    style: { flex: stageMax ? '1 1 100%' : '0 0 ' + stageWidth + '%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 },
                  }, stageHeader, stageFrame),
                )
              : chatFrame,
          ),
          tabFrame('stage'),
          tabFrame('map'),
          tabFrame('screen'),
          tabFrame('settings'),
        ),
      )
    }

    function CompanionLauncher() {
      const base = useRuntimeBase()
      const status = useCompanionStatus(base)
      const st = status.data
      const mode = st && st.mode === 'chat' ? '纯聊天版' : '完整版'
      return h(
        'div',
        { style: { padding: '12px 14px', fontSize: 13, lineHeight: 1.8, color: text } },
        h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, '屏幕彼端'),
        h('div', { style: { opacity: 0.7, marginBottom: 10 } },
          st ? `运行时在线 · ${mode} · 记忆 ${(st.memory && st.memory.live) || 0} 条` : (status.error ? '运行时离线' : '运行时状态读取中…')),
        h('button', { style: { ...tabBtn(true), marginRight: 8 }, onClick: () => window.open(base + '/', '_blank') }, '打开聊天窗口'),
        h('button', { style: tabBtn(false), onClick: () => window.open(base + '/settings', '_blank') }, '打开设置页'),
        h('div', { style: { marginTop: 12, fontSize: 12, opacity: 0.55 } }, '网址（每台电脑自动分配端口）：' + base + '/'),
      )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      try {
        slots.inject('sidebar.panellist', () =>
          slots.register({ name: 'sidebar.panellist', id: 'companion', order: 21, label: () => '屏幕彼端' }, PanelIcon),
        )
      } catch (e) {}
      try {
        slots.inject('main', () => slots.register({ name: 'main', key: 'companion' }, CompanionPage))
      } catch (e) {}
      try {
        slots.inject('settings.section', () =>
          slots.register({ name: 'settings.section', id: 'companion-settings', order: 12, label: () => '屏幕彼端' }, CompanionLauncher),
        )
      } catch (e) {}
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
