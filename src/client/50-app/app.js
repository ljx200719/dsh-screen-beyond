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
  const loadInfo = React.useCallback(() => {
    Api.get('/api/version').then((r) => {
      if (r.ok) { setInfo(r.data); setInfoErr('') } else { setInfo(null); setInfoErr(r.error || '读取失败') }
    })
  }, [])
  React.useEffect(() => { loadInfo() }, [loadInfo])
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
      ),
    ),
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

function AppShell() {
  ensureUiStyle()
  const base = useRuntimeBase()
  const status = useStatus()
  const st = status.data || {}
  const [tab, setTab] = useLocal('companionTab', 'chat')
  const [opened, setOpened] = React.useState(() => ({ chat: true }))
  const [wallet, setWallet] = React.useState(null)
  const [reconnecting, setReconnecting] = React.useState(false)
  const [screenBusy, setScreenBusy] = React.useState(false)

  const openTab = React.useCallback((key) => {
    setTab(key)
    setOpened((prev) => (prev[key] ? prev : Object.assign({}, prev, { [key]: true })))
    // 兜底：给其它模块一个切标签的入口（StageView 无底图时引导去地图页）
    try { window.__sbcOpenTab = openTab } catch (e) {}
  }, [setTab])

  // 钱包（零花/真实余额）不是 /api/status 的字段，单独拉一次 + 低频刷新
  const loadWallet = React.useCallback(() => {
    Api.get('/api/economy').then((r) => { if (r.ok && r.data) setWallet(r.data.wallet || null) })
  }, [])
  React.useEffect(() => { loadWallet() }, [loadWallet, base])
  useInterval(loadWallet, 30000)

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
      await Runtime.discover(true)
      await pollStatusOnce()
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
              h(ChatView, {
                stageOpen: !!showStage,
                onToggleStage: () => setShowStage((v) => !v),
              }),
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
                  h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, h(StageView, { compact: true, onOpenMap: () => openTab('map') })),
                )
              : null,
          ),
        ),
      ),
      // 独立标签页（打开过就保持挂载）
      opened.stage ? h('div', { key: 'stage', style: paneStyle('stage') }, h(StageView, { onOpenMap: () => openTab('map') })) : null,
      opened.map ? h('div', { key: 'map', style: paneStyle('map') }, h(MapView, {})) : null,
      opened.settings ? h('div', { key: 'settings', style: paneStyle('settings') }, h(SettingsView, {})) : null,
      opened.screen ? h('div', { key: 'screen', style: paneStyle('screen') }, h(ScreenView, {})) : null,
      opened.about ? h('div', { key: 'about', style: paneStyle('about') }, h(AboutView, {})) : null,
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
      h(Btn, { size: 'sm', kind: 'ghost', title: '刷新运行时状态', onClick: () => { pollStatusOnce(); loadWallet() } }, '刷新'),
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
