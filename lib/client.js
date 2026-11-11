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

    const brand = 'var(--dsw-alias-brand, #2f6bd8)'
    const border = 'var(--dsw-alias-border-l1, rgba(255,255,255,.12))'
    const text = 'var(--dsw-alias-text-1, #d7dee8)'

    async function discoverRuntime() {
      // 1) 宿主路由（正常情况）
      try {
        const r = await fetch('/dsh-screen-beyond/info', { cache: 'no-store' })
        if (r.ok) {
          const j = await r.json()
          if (j && j.url) { try { localStorage.setItem('companionBase', j.url) } catch (e) {} ; return j.url }
        }
      } catch (e) {}
      // 2) 本地缓存
      try {
        const cached = localStorage.getItem('companionBase')
        if (cached) {
          const r = await fetch(cached + '/api/status', { cache: 'no-store' })
          if (r.ok) return cached
        }
      } catch (e) {}
      // 3) 端口扫描兜底（8900-8912）
      for (let port = 8900; port <= 8912; port++) {
        const url = 'http://127.0.0.1:' + port
        try {
          const r = await fetch(url + '/api/status', { cache: 'no-store' })
          if (r.ok) { try { localStorage.setItem('companionBase', url) } catch (e) {} ; return url }
        } catch (e) {}
      }
      return DEFAULT_BASE
    }
    function useRuntimeBase() {
      const [base, setBase] = React.useState(() => {
        try { return localStorage.getItem('companionBase') || DEFAULT_BASE } catch (e) { return DEFAULT_BASE }
      })
      React.useEffect(() => {
        let alive = true
        discoverRuntime().then((u) => { if (alive && u) setBase(u) }).catch(() => {})
        return () => { alive = false }
      }, [])
      return base
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 18
      const active = props && props.active
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, style: { display: 'block' }, 'aria-hidden': true },
        h('path', { d: 'M12 2.2l1.6 2.6M12 2.2l-1.6 2.6', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: active ? 0.95 : 0.6 }),
        h('circle', { cx: 12, cy: 12.8, r: 8.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, opacity: active ? 1 : 0.75 }),
        h('circle', { cx: 9.2, cy: 11.6, r: 1.2, fill: 'currentColor', opacity: active ? 1 : 0.85 }),
        h('circle', { cx: 14.8, cy: 11.6, r: 1.2, fill: 'currentColor', opacity: active ? 1 : 0.85 }),
        h('path', { d: 'M8.8 15.2c1 1.15 2.1 1.7 3.2 1.7s2.2-.55 3.2-1.7', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', opacity: active ? 1 : 0.8 }),
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

    function CompanionPage() {
      const base = useRuntimeBase()
      React.useEffect(() => {
        const onKey = (e) => {
          if (e.altKey && (e.key === 's' || e.key === 'S')) { e.preventDefault(); try { window.open(base + '/screen', '_blank') } catch (err) {} }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [base])
      const [tab, setTab] = React.useState('chat')
      const [stageView, setStageView] = React.useState('3d')
      const [showStage, setShowStage] = React.useState(() => {
        try { return localStorage.getItem('companionShowStage') !== '0' } catch (e) { return true }
      })
      const [stageWidth, setStageWidth] = React.useState(() => {
        try { return Math.min(70, Math.max(25, Number(localStorage.getItem('companionStageWidth')) || 48)) } catch (e) { return 48 }
      })
      const toggleStage = () => {
        const next = !showStage
        setShowStage(next)
        try { localStorage.setItem('companionShowStage', next ? '1' : '0') } catch (e) {}
      }
      const changeStageWidth = (w) => {
        const v = Math.min(70, Math.max(25, Number(w) || 48))
        setStageWidth(v)
        try { localStorage.setItem('companionStageWidth', String(v)) } catch (e) {}
      }
      React.useEffect(() => {
        fetch(base + '/api/stage', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => { if (j && j.map) setStageView(j.map.displayMode === '2d' ? '2d' : '3d') })
          .catch(() => {})
      }, [base])
      const url = tab === 'chat' ? base + '/'
        : tab === 'stage' ? (base + (stageView === '3d' ? '/model' : '/stage'))
        : tab === 'screen' ? base + '/screen'
        : tab === 'map' ? base + '/map' : base + '/settings'
      const stageUrl = base + (stageView === '3d' ? '/model' : '/stage')
      const chatFrame = h('iframe', {
        key: 'chat-' + base,
        src: base + '/',
        title: '聊天',
        style: { flex: 1, minWidth: 0, minHeight: 0, border: '1px solid ' + border, borderRadius: 10, background: '#0b0f14' },
      })
      const stageFrame = h('iframe', {
        key: 'stage-' + stageView + '-' + base,
        src: stageUrl,
        title: '舞台',
        style: { flex: 1, minWidth: 0, minHeight: 0, border: '1px solid ' + border, borderRadius: 10, background: '#0b0f14' },
      })
      const split = tab === 'chat' && showStage
      const wrapStyle = (on) => ({ flex: 1, minHeight: 0, minWidth: 0, display: on ? 'flex' : 'none', gap: 8 })
      const tabFrame = (name) => h('div', { key: name + '-wrap', style: wrapStyle(tab === name) },
        h('iframe', {
          key: name + '-frame-' + base,
          src: base + (name === 'map' ? '/map' : name === 'screen' ? '/screen' : name === 'settings' ? '/settings' : '/stage'),
          title: name,
          style: { flex: 1, minWidth: 0, minHeight: 0, width: '100%', border: '1px solid ' + border, borderRadius: 10, background: '#0b0f14' },
        }),
      )
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100vh', padding: '6px 10px 10px', boxSizing: 'border-box', gap: 6, background: 'var(--dsw-alias-bg-layer-0, #0b0f14)' } },
        h(
          'div',
          { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h('button', { style: tabBtn(tab === 'chat'), onClick: () => setTab('chat') }, '聊天'),
          h('button', { style: tabBtn(tab === 'stage'), onClick: () => setTab('stage') }, '舞台'),
          h('button', { style: tabBtn(tab === 'screen'), onClick: () => setTab('screen') }, '屏幕'),
          h('button', { style: tabBtn(tab === 'map'), onClick: () => setTab('map') }, '地图'),
          h('button', { style: tabBtn(tab === 'settings'), onClick: () => setTab('settings') }, '设置'),
          tab === 'stage' ? h('span', { style: { display: 'inline-flex', gap: 4, marginLeft: 4 } },
            h('button', { style: tabBtn(stageView === '2d'), onClick: () => setStageView('2d') }, '2D'),
            h('button', { style: tabBtn(stageView === '3d'), onClick: () => setStageView('3d') }, '3D'),
          ) : null,
          h('span', { style: { fontSize: 12, opacity: 0.5 } }, base),
          tab === 'chat' ? h('button', { style: tabBtn(showStage), onClick: toggleStage }, showStage ? '隐藏舞台' : '显示舞台') : null,
          (tab === 'chat' && showStage) ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, opacity: 0.75 } },
            '舞台宽度',
            h('input', { type: 'range', min: 25, max: 70, step: 5, value: stageWidth, onChange: (e) => changeStageWidth(e.target.value), style: { width: 110 } }),
            String(stageWidth) + '%',
          ) : null,
          h('button', { style: tabBtn(false), marginLeft: 'auto', onClick: () => window.open(base + '/screen', '_blank') }, '看屏幕'),
          h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { marginLeft: 6, fontSize: 12, color: 'var(--dsw-alias-brand, #59a6ff)', textDecoration: 'none' } }, '在新窗口打开'),
        ),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
          h('div', { style: { flex: 1, minHeight: 0, display: tab === 'chat' ? 'flex' : 'none', gap: 8 } },
            split
              ? h('div', { style: { flex: 1, minHeight: 0, display: 'flex', gap: 8 } },
                  h('div', { style: { flex: '1 1 ' + (100 - stageWidth) + '%', minWidth: 0, display: 'flex' } }, chatFrame),
                  h('div', { style: { flex: '1 1 ' + stageWidth + '%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
                    h('div', { style: { display: 'flex', gap: 4, fontSize: 11, opacity: 0.55 } }, '舞台（' + (stageView === '3d' ? '3D' : '2D') + '）'),
                    stageFrame,
                  ),
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
      const [st, setSt] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        fetch(base + '/api/status', { cache: 'no-store' })
          .then((r) => r.json())
          .then((j) => { if (alive) setSt(j) })
          .catch(() => {})
        return () => { alive = false }
      }, [base])
      const mode = st && st.mode === 'chat' ? '纯聊天版' : '完整版'
      return h(
        'div',
        { style: { padding: '12px 14px', fontSize: 13, lineHeight: 1.8, color: text } },
        h('div', { style: { fontSize: 15, fontWeight: 600, marginBottom: 6 } }, '屏幕彼端'),
        h('div', { style: { opacity: 0.7, marginBottom: 10 } },
          st ? `运行时在线 · ${mode} · 记忆 ${(st.memory && st.memory.live) || 0} 条` : '运行时状态读取中…'),
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
