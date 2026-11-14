// 40-screen/screen.js —— 屏幕：她的屏幕用系统浏览器打开（D06 A），面板里只放只读截图和开关
//
// 为什么这么写：
//   · 她的 Linux 桌面是 noVNC（127.0.0.1:6081/vnc.html）。面板里**不内嵌网页、不加载任何 HTML 页面**：
//     点「打开她的屏幕」只是把地址交给系统浏览器（顶栏「看屏幕」和 Alt+S 都走 openHerScreen）；
//   · 面板里能看的是只读截图：她的手机（/api/screen/phone，3 秒刷新）、你的电脑（/api/screen/pc，2.5 秒刷新）；
//   · 虚拟机/模拟器都很吃内存，启动/关闭一律先 confirmDialog；后端内存不足会 refused，这里显示它的 message；
//   · 所有失败都给中文说明（M06 验收：失败有错误说明），不静默失败。

const SCREEN_SPACE_POLL_MS = 6000
const SCREEN_PHONE_SHOT_MS = 3000
const SCREEN_PC_SHOT_MS = 2500
const SCREEN_ENSURE_TIMEOUT_SEC = 90
// noVNC 的自动连接参数：不告诉它连哪台/自动重连的话，浏览器里还要手动点一次连接
const SCREEN_VNC_QUERY = 'autoconnect=1&reconnect=1&reconnect_delay=2000&resize=scale'

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

function ScreenView(props) {
  // 地址 / 屏幕状态 / 环境状态：都走只读 JSON 接口，不请求任何 HTML 页面
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
      toast('她的屏幕连上了，可以在浏览器里操作了', 'ok')
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
      toast('她的屏幕已经连上了，直接点「打开她的屏幕」就行', 'info')
      return
    }
    if (cur.vm === false) {
      const ok = await confirmDialog('启动她的屏幕？', {
        detail: '会启动她的 Linux 虚拟机（约 1 分钟，占用 2~6 GB 内存），好了之后在系统浏览器里操作她的屏幕。',
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
        toast('她的屏幕链路正常，可以打开了', 'ok')
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

  // ── 她自己的屏幕（只给状态 + 外部浏览器按钮，面板里不内嵌画面） ──────────
  const spaceCard = h(Card, {
    title: '她自己的屏幕',
    sub: '用系统窗口打开 · 面板里不内嵌网页',
    tag: 'D06 A',
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
    h(Note, {}, '她的屏幕是独立的 Linux 虚拟机，画面在系统浏览器的新窗口里；面板只显示状态和只读截图，不把网页嵌进来。'),
    h(Note, {}, '要在她的屏幕上点鼠标/敲键盘，就直接在浏览器窗口里操作；手机截图只是用来看的。屏幕上约占 2~6 GB 内存，不用时点「关闭」释放。'),
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
  }, spaceCard, phoneCard, pcCard, envCard, petSection)
}
