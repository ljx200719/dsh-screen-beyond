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
    background: paintGlass(T.bg1, 0.78),
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
        flexShrink: 0, borderTop: '1px solid ' + T.border, background: paintGlass(T.bg1, 0.72),
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
