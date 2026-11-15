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
// 内嵌 iframe 用的 noVNC 参数（F-005）
//   · resize=scale：远端分辨率跟着 iframe 走，画面按容器等比缩放（contain）；
//   · view_clip=0：⚠ 原来写的是 view_clip=true —— 那是「裁掉视口外的部分」，
//     正好导致「右侧时间被裁 + 左边多一条」；关掉它才会完整显示整块桌面并留黑边；
//   · show_dot：右上角显示连接状态点（重连状态可见）；
//   · reconnect_delay：掉线 1.5 秒后自动重连。
const SCREEN_EMBED_PARAMS = 'autoconnect=true&resize=scale&reconnect=true&reconnect_delay=1500&show_dot=true&view_clip=0&shared=true'
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

// 内存统一单位（F-015）：≥1024MB 就用 GB 一位小数，否则 MB；不再混着 MB/GB 两种写法
function fmtMemMB(mb) {
  const n = Math.max(0, Math.round(Number(mb) || 0))
  if (n >= 1024) return (n / 1024).toFixed(1) + ' GB'
  return n + ' MB'
}
// /api/resources 的 mem：新版本是 [{ name, mb }]，老版本是 "进程名:MB" 字符串，两种都认
function screenMemLabel(item) {
  if (item && typeof item === 'object') return String(item.name || '进程') + ' ' + fmtMemMB(item.mb)
  const s = String(item || '').trim()
  const i = s.lastIndexOf(':')
  if (i > 0) return s.slice(0, i) + ' ' + fmtMemMB(s.slice(i + 1))
  return s
}
// 把 /api/resources 的内存列表整成一屏能读的一行（含合计）
function screenMemSummary(res) {
  const r = res || {}
  const items = Array.isArray(r.memItems) && r.memItems.length
    ? r.memItems
    : (Array.isArray(r.mem) ? r.mem : [])
  if (!items.length) return ''
  const parts = items.map(screenMemLabel)
  const total = Number(r.memTotalMB)
  const sum = Number.isFinite(total) && total > 0 ? total : 0
  return parts.join(' + ') + (sum > 0 ? '（合计 ' + fmtMemMB(sum) + '）' : '')
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
  // F-005：全屏 + 画面状态
  const frameBoxRef = React.useRef(null)
  const [fullscreen, setFullscreen] = React.useState(false)

  React.useEffect(() => {
    if (typeof document === 'undefined' || !document || typeof document.addEventListener !== 'function') return undefined
    const onChange = () => {
      try {
        const el = frameBoxRef.current
        setFullscreen(!!el && document.fullscreenElement === el)
      } catch (e) { setFullscreen(false) }
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => { try { document.removeEventListener('fullscreenchange', onChange) } catch (e) {} }
  }, [])

  const toggleFullscreen = async () => {
    const el = frameBoxRef.current
    if (!el) return
    try {
      if (document.fullscreenElement === el) { await document.exitFullscreen() }
      else if (el.requestFullscreen) { await el.requestFullscreen() }
      else { toast('当前浏览器不支持全屏，可以用「外部浏览器」看', 'error') }
    } catch (e) {
      toast('全屏失败：' + String((e && e.message) || e) + '（可以改用外部浏览器）', 'error')
    }
  }

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
    // F-005：画面层和工具栏层分开 —— 上面是我们自己的工具条（全屏/适应窗口/重连/状态），
    // 下面是纯画面（黑底 + contain）。noVNC 自己的工具条在它页面内部，不再被我们的高度裁掉。
    const frame = h('div', {
      ref: frameBoxRef,
      style: {
        position: 'relative', width: '100%',
        height: fullscreen ? '100vh' : 'clamp(460px, calc(100vh - 300px), 860px)',
        background: '#000', border: '1px solid ' + T.border, borderRadius: fullscreen ? 0 : T.radius,
        overflow: 'hidden',
        // 居中等比：画面按容器缩放（contain），四周留黑边，不裁切、不拉伸
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
    },
      h('iframe', {
        key: 'screen-embed-' + frameKey,
        src: src,
        title: '她的虚拟屏幕（noVNC）',
        referrerPolicy: 'no-referrer',
        allow: 'clipboard-read; clipboard-write; fullscreen',
        scrolling: 'no',
        onLoad: () => { setFrameLoaded(true); setFrameError('') },
        onError: () => setFrameError('内嵌虚拟屏幕加载失败：noVNC 页面打不开（服务没起来，或浏览器策略不允许内嵌）。'),
        style: { width: '100%', height: '100%', border: '0', display: 'block', background: '#000' },
      }),
      waiting
        ? h('div', {
            style: {
              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20,
              background: '#0b0f14', textAlign: 'center',
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
              background: '#0b0f14', textAlign: 'center',
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
    // 画面上方的工具条（和画面分层，不压住桌面）
    const frameState = frameError
      ? { tone: T.danger, text: '内嵌失败' }
      : (waiting ? { tone: T.warn, text: '连接中…' } : (frameLoaded ? { tone: T.ok, text: '已连接' } : { tone: T.idle, text: '未连接' }))
    const toolbar = h(Row, { gap: 6, wrap: true, style: { alignItems: 'center' } },
      h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: T.text2 } },
        h(Dot, { on: true, tone: frameState.tone }),
        '画面：' + frameState.text),
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !src, onClick: reloadFrame, title: '重新连接 noVNC（画面卡住时用）' }, '重连'),
      h(Btn, {
        size: 'sm', kind: 'ghost',
        onClick: () => { void toggleFullscreen() },
        title: fullscreen ? '退出全屏（Esc）' : '全屏看她的桌面（工具栏会浮在画面上方）',
      }, fullscreen ? '退出全屏' : '全屏'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setEmbed(false), title: '收起画面（不加载 iframe，省内存/CPU）' }, '收起'),
    )
    body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      statusKnown && !httpOk
        ? h('div', { style: { fontSize: 11.5, color: T.warn, lineHeight: 1.6 } },
            '她的屏幕现在还没连上（虚拟机没开或画面链路断了）：先在下面「她自己的屏幕」卡片里点「启动/修复」，连上后这里会自动重新连接。')
        : null,
      toolbar,
      frame,
      h(Note, {}, '内嵌的是她虚拟机的桌面实时画面（noVNC）：可以直接在面板里点鼠标、敲键盘，窗口按比例缩放（contain），不会裁掉右边的时间栏。'),
      h(Note, {}, '第一次连接约 3~10 秒；切到别的标签再回来会重新连。画面太小就点「收起」，再用「外部浏览器打开」。'),
      h(Note, {}, '如果画面一直空白/黑屏：多半是浏览器策略不允许内嵌本机页面，点上面的「外部浏览器」即可（同一台虚拟机）。'),
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
  const memItems = (resources && (resources.memItems || resources.mem)) || []
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
    // F-015：运行中就禁用对应的「启动」，别让人点了才发现已经在跑
    h(Row, { gap: 6, wrap: true },
      h(Btn, {
        size: 'sm', kind: 'primary',
        disabled: !!powerBusy || screenRunning === true,
        title: screenRunning === true ? '她的屏幕已经在运行了' : '启动她的 Linux 虚拟机（约 1 分钟，需 9 GB 空闲内存）',
        onClick: () => { void togglePower('space') },
      }, screenRunning === true ? '屏幕运行中' : (powerBusy === 'space' ? '启动中…' : '启动她的屏幕')),
      h(Btn, { size: 'sm', kind: 'danger', disabled: !!powerBusy || screenRunning !== true, onClick: () => { void togglePower('space') } }, '关闭她的屏幕'),
      h(Btn, {
        size: 'sm', kind: 'primary',
        // 手机跑在她的 Linux 屏幕里：屏幕没开时先别让人点（点了也起不来）
        disabled: !!powerBusy || phoneRunning === true || screenRunning === false,
        title: screenRunning === false
          ? '先启动「她的屏幕」：手机（Waydroid）跑在那台虚拟机里'
          : (phoneRunning === true ? '她的手机已经在运行了' : '启动手机（约 30~60 秒，需 6 GB 空闲内存）'),
        onClick: () => { void togglePower('phone') },
      }, phoneRunning === true ? '手机运行中' : (screenRunning === false ? '先开屏幕' : (powerBusy === 'phone' ? '启动中…' : '启动她的手机'))),
      h(Btn, { size: 'sm', kind: 'danger', disabled: !!powerBusy || phoneRunning !== true, onClick: () => { void togglePower('phone') } }, '关闭她的手机'),
    ),
    h(Note, {}, '启动她的屏幕大约要 9 GB 空闲内存、启动手机大约要 6 GB；不够时后端会拒绝，并在提示里说明原因。'),
    // F-015 / P2-5：内存统一单位（≥1GB 显示 GB），并给合计；标明这是「进程占用」的统计口径
    (Array.isArray(memItems) && memItems.length)
      ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' } },
          h(Note, {}, '虚拟机进程占用（私有提交）：'),
          memItems.map((item, i) => h('span', {
            key: 'screen-mem-' + i,
            title: (item && item.workingMb) ? ('工作集 ' + fmtMemMB(item.workingMb)) : '',
            style: { fontSize: 11, color: T.text2, border: '1px solid ' + T.border, borderRadius: 999, padding: '1px 8px', whiteSpace: 'nowrap' },
          }, screenMemLabel(item))),
          Number(resources.memTotalMB) > 0
            ? h('span', { style: { fontSize: 11, color: T.text3 } }, '合计 ' + fmtMemMB(resources.memTotalMB))
            : null,
        )
      : h(Note, {}, '当前没有检测到虚拟机/模拟器进程在占内存。'),
    (resources && resources.memNote) ? h(Note, {}, resources.memNote) : null,
    h(Note, {}, '关闭会中断她正在用的环境，属于危险操作，所以每次都会先弹确认框。'),
  )

  const petSection = typeof PetCard === 'function' ? h(PetCard, {}) : null

  return h('div', {
    className: 'sbc-scroll',
    style: { flex: 1, minHeight: 0, overflow: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  }, embedCard, spaceCard, phoneCard, pcCard, envCard, petSection)
}
