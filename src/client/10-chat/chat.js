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
    color: T.accentInk,
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

// ── 播放统一管理（0.8.6）：自动朗读和手动播放共用一份，不会叠着放；「打断」一键全停 ──
const SBC_AUDIO = { cur: null }
function sbcAudioXmit(name) {
  try { window.dispatchEvent(new Event(name)) } catch (e) {}
}
function sbcAudioStop() {
  const a = SBC_AUDIO.cur
  SBC_AUDIO.cur = null
  if (a) { try { a.pause() } catch (e) {} }
  sbcAudioXmit('sbc-voice-stop')
}
function sbcAudioPlay(url, handlers) {
  sbcAudioStop()
  let a
  try { a = new Audio(url) } catch (e) { return null }
  SBC_AUDIO.cur = a
  sbcAudioXmit('sbc-voice-start')
  const done = () => {
    if (SBC_AUDIO.cur === a) SBC_AUDIO.cur = null
    sbcAudioXmit('sbc-voice-stop')
    if (handlers && handlers.onEnd) handlers.onEnd()
  }
  a.addEventListener('ended', done)
  a.addEventListener('error', () => { done(); if (handlers && handlers.onError) handlers.onError() })
  const pr = a.play()
  if (pr && pr.catch) pr.catch(() => { done(); if (handlers && handlers.onError) handlers.onError() })
  return a
}

// 有没有语音正在放：底部「■ 停止」靠它决定显不显示（F-013：空闲不要留一个点了没反应的按钮）
function useVoicePlaying() {
  const [on, setOn] = React.useState(() => !!SBC_AUDIO.cur)
  React.useEffect(() => {
    const upd = () => setOn(!!SBC_AUDIO.cur)
    try {
      window.addEventListener('sbc-voice-start', upd)
      window.addEventListener('sbc-voice-stop', upd)
    } catch (e) {}
    return () => {
      try {
        window.removeEventListener('sbc-voice-start', upd)
        window.removeEventListener('sbc-voice-stop', upd)
      } catch (e) {}
    }
  }, [])
  return on
}

// P2-14：历史消息里可能已经存了上游半截 JSON；UI 只显示人话，不把整段 body 刷出来。
function chatVoiceErrorText(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!s) return '语音没有生成'
  if (/^[\[{]/.test(s) || /火山 v3 没返回音频.*[\[{]/.test(s) || /"header"\s*:/.test(s)) {
    return '语音通道异常（上游返回了错误）；可以到「设置 → 角色 → 语音」改用 Windows 内置语音，或切换音色/资源 ID。'
  }
  return s.slice(0, 140)
}

// 她的语音消息：点一下播放，再点停止（不自动播放、不自动下一条）
// 全局「停止」由 ChatView 派发 sbc-voice-stop，所有实例一起停（V25）
function ChatVoiceButton(props) {
  const p = props || {}
  const path = String(p.audio || '')
  const [playing, setPlaying] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [err, setErr] = React.useState('')
  React.useEffect(() => {
    const onStop = () => setPlaying(false)
    try { window.addEventListener('sbc-voice-stop', onStop) } catch (e) {}
    return () => { try { window.removeEventListener('sbc-voice-stop', onStop) } catch (e) {} }
  }, [])
  const toggle = async () => {
    if (playing) { sbcAudioStop(); return }
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const url = await Api.fileUrl(path)
      const a = sbcAudioPlay(url, {
        onEnd: () => setPlaying(false),
        onError: () => { setPlaying(false); setErr('播放失败') },
      })
      if (!a) { setErr('播放失败'); return }
      setPlaying(true)
    } catch (e) {
      setErr('播放失败')
    } finally {
      setBusy(false)
    }
  }
  const dur = Number(p.duration) > 0 ? Math.round(Number(p.duration)) + '″' : ''
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 } },
    h('button', {
      type: 'button',
      className: 'sbc-btn',
      onClick: toggle,
      title: playing ? '停止播放' : '播放这条语音',
      style: {
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 11px', borderRadius: 999,
        border: '1px solid ' + T.brand, background: 'rgba(var(--sbc-accent-rgb, 47,107,216), .12)',
        color: T.text, fontWeight: 500,
        fontSize: 11.5, lineHeight: '17px', cursor: 'pointer', fontFamily: T.font,
      },
    }, playing ? '■ 停止' : (busy ? '… 载入' : '🔊 播放语音'), dur ? h('span', { style: { color: T.text3, fontSize: 10.5, fontWeight: 400 } }, dur) : null),
    err ? h('span', { style: { fontSize: 10.5, color: T.danger } }, err) : null,
  )
}

// ── 语音输入（0.8.8）：复用 DSH 自带的 SenseVoice，插件自己不带模型 ──────────
// 录音在浏览器里编成 DSH 认可的规范 WAV（16kHz 单声道 PCM16），
// 交给 DSH 的 speech Remote 识别；文字只放进输入框，不自动发送。
function sbcSpeechRemote() {
  try {
    const ctx = SBC_CLIENT_CTX
    const remote = ctx && typeof ctx.get === 'function' ? ctx.get('remote') : null
    return (remote && remote.speech) || null
  } catch (e) { return null }
}

// 任意采样率 → 16k 单声道（线性插值，够用）
function sbcResample16k(chunks, srcRate) {
  let total = 0
  for (let i = 0; i < chunks.length; i++) total += chunks[i].length
  const flat = new Float32Array(total)
  let off = 0
  for (let i = 0; i < chunks.length; i++) { flat.set(chunks[i], off); off += chunks[i].length }
  const rate = Number(srcRate) || 16000
  if (rate === 16000) return flat
  const ratio = rate / 16000
  const outLen = Math.max(1, Math.floor(flat.length / ratio))
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(flat.length - 1, i0 + 1)
    const t = pos - i0
    out[i] = flat[i0] * (1 - t) + flat[i1] * t
  }
  return out
}

// 规范 WAV：DSH 会逐字节校验（PCM/单声道/16000Hz/16bit/长度自洽）
function sbcWavFromSamples(samples) {
  const n = samples.length
  const buf = new ArrayBuffer(44 + n * 2)
  const v = new DataView(buf)
  const put = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  put(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); put(8, 'WAVE')
  put(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  put(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}

function sbcBytesToBase64(bytes) {
  let out = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + step))
  }
  return btoa(out)
}

// 问 DSH 要识别器；没准备好就触发准备（首次下载约 230MB，走 hf-mirror）并等
async function sbcSpeechEnsureReady(onStatus) {
  const speech = sbcSpeechRemote()
  // 拿不到服务只有两种可能：没启用，或 DSH 升级后插件版本没跟上（profile 里 pin 的是旧版）
  if (!speech) return { ok: false, error: 'DSH 的语音输入没启用：到 DSH「插件」里确认语音插件已启用、并且版本和当前 DSH 一致（升级 DSH 后要同步一次语音插件）；装好后回「设置 → 角色」点「检查 / 准备识别模型」' }
  let cat = null
  try { cat = await speech.catalog() } catch (e) { return { ok: false, error: '读不到识别器状态：' + String((e && e.message) || e) } }
  if (!cat || !cat.providers || !cat.providers.length) return { ok: false, error: '没有可用的识别器' }
  const providerId = (cat.selection && cat.selection.providerId) || cat.providers[0].id
  const language = (cat.selection && cat.selection.language) || 'zh'
  const maxDurationSeconds = cat.maxDurationSeconds || 120
  const view = cat.providers.filter((x) => x.id === providerId)[0] || cat.providers[0]
  const phase = view && view.preparation ? view.preparation.phase : 'ready'
  if (phase === 'ready' || phase === 'standby') return { ok: true, providerId, language, maxDurationSeconds }
  if (phase === 'failed') return { ok: false, error: '识别器准备失败：' + ((view.preparation && view.preparation.message) || '未知原因') }
  try { await speech.prepare(providerId) } catch (e) { return { ok: false, error: '启动准备失败：' + String((e && e.message) || e) } }
  const startedAt = Date.now()
  while (Date.now() - startedAt < 15 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 1500))
    let c2 = null
    try { c2 = await speech.catalog() } catch (e) {}
    const v2 = c2 && c2.providers ? c2.providers.filter((x) => x.id === providerId)[0] : null
    const st = (v2 && v2.preparation) || { phase: 'ready' }
    if (st.phase === 'ready' || st.phase === 'standby') return { ok: true, providerId, language, maxDurationSeconds: (c2 && c2.maxDurationSeconds) || maxDurationSeconds }
    if (st.phase === 'failed') return { ok: false, error: '准备失败：' + (st.message || '未知原因') }
    if (onStatus) {
      if (st.phase === 'downloading') {
        const pct = st.totalBytes ? ' ' + Math.round((st.completedBytes / st.totalBytes) * 100) + '%' : ''
        onStatus('正在下载识别模型' + pct + '（首次约 230MB）')
      } else if (st.phase === 'checking') onStatus('正在检查模型…')
      else if (st.phase === 'loading') onStatus('正在加载模型…')
      else onStatus('准备中…')
    }
  }
  return { ok: false, error: '准备超时，稍后再点一次麦克风' }
}

// 麦克风按钮：点一下开始、再点结束；识别结果只进输入框（不自动发）
function ChatMicButton(props) {
  const p = props || {}
  const [phase, setPhase] = React.useState('idle')   // idle | preparing | recording | transcribing
  const [note, setNote] = React.useState('')
  const [err, setErr] = React.useState('')
  const [seconds, setSeconds] = React.useState(0)
  const stRef = React.useRef(null)
  const optsRef = React.useRef(null)

  const teardown = React.useCallback(() => {
    const st = stRef.current
    stRef.current = null
    if (!st) return null
    try { if (st.timer) clearInterval(st.timer) } catch (e) {}
    try { st.proc.disconnect() } catch (e) {}
    try { st.src.disconnect() } catch (e) {}
    try { st.sink.disconnect() } catch (e) {}
    try { st.stream.getTracks().forEach((t) => { try { t.stop() } catch (e2) {} }) } catch (e) {}
    try { st.ctx.close() } catch (e) {}
    return st
  }, [])
  React.useEffect(() => () => { teardown() }, [teardown])

  const finish = React.useCallback(async (aborted) => {
    const st = teardown()
    setPhase('idle')
    setSeconds(0)
    setNote('')
    if (!st || aborted) return
    if (!st.chunks.length) { setErr('没录到声音'); return }
    const speech = sbcSpeechRemote()
    const opts = optsRef.current || {}
    if (!speech || !opts.providerId) { setErr('DSH 的语音输入不可用'); return }
    setPhase('transcribing')
    let stopAudio = null
    try {
      const samples = sbcResample16k(st.chunks, st.rate)
      const wav = sbcWavFromSamples(samples)
      if (wav.length < 46) { setErr('录音太短'); return }
      const ctrl = new AbortController()
      stopAudio = setTimeout(() => { try { ctrl.abort() } catch (e) {} }, 120000)
      const result = await speech.transcribe({
        audioBase64: sbcBytesToBase64(wav),
        providerId: opts.providerId,
        language: opts.language,
      }, ctrl.signal)
      if (!result || !result.ok) {
        setErr(String((result && result.error && result.error.message) || '识别失败').slice(0, 90))
        return
      }
      const text = String((result.value && result.value.text) || '').trim()
      if (!text) { setErr('没听清（这次没识别到内容）'); return }
      if (p.onText) p.onText(text)
    } catch (e) {
      setErr('识别失败：' + String((e && e.message) || e).slice(0, 60))
    } finally {
      if (stopAudio) clearTimeout(stopAudio)
      setPhase('idle')
    }
  }, [teardown, p])

  const start = React.useCallback(async () => {
    if (phase !== 'idle') return
    setErr('')
    setNote('')
    setPhase('preparing')
    const ready = await sbcSpeechEnsureReady((msg) => setNote(msg))
    if (!ready.ok) { setErr(ready.error); setPhase('idle'); return }
    optsRef.current = { providerId: ready.providerId, language: ready.language, maxDurationSeconds: ready.maxDurationSeconds }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('这个环境不支持录音')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) throw new Error('浏览器不支持 AudioContext')
      const ctx = new Ctx({ sampleRate: 16000 })
      const src = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(4096, 1, 1)
      const sink = ctx.createGain()
      sink.gain.value = 0
      const chunks = []
      proc.onaudioprocess = (ev) => { chunks.push(new Float32Array(ev.inputBuffer.getChannelData(0))) }
      src.connect(proc)
      proc.connect(sink)
      sink.connect(ctx.destination)
      const st = { stream, ctx, src, proc, sink, chunks, rate: ctx.sampleRate || 16000, timer: null, startedAt: Date.now() }
      stRef.current = st
      setNote('')
      setPhase('recording')
      setSeconds(0)
      const maxSec = Math.max(3, Math.min(120, Number(ready.maxDurationSeconds) || 120))
      st.timer = setInterval(() => {
        const cur = stRef.current
        if (!cur) return
        const s = (Date.now() - cur.startedAt) / 1000
        setSeconds(s)
        if (s >= Math.min(60, maxSec)) { void finish(false) }
      }, 200)
    } catch (e) {
      const msg = String((e && e.message) || e)
      setErr(/permission|denied|notallowed/i.test(msg) ? '没有麦克风权限：先在系统里允许 DSH 用麦克风' : ('录音失败：' + msg.slice(0, 60)))
      setPhase('idle')
    }
  }, [phase, finish])

  if (phase === 'recording') {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
      h('button', {
        type: 'button', className: 'sbc-btn', onClick: () => { void finish(false) }, title: '结束录音并转成文字',
        style: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 9, border: '1px solid ' + T.danger, color: T.danger, background: 'rgba(239,83,80,.12)', fontSize: 12.5, cursor: 'pointer', fontFamily: T.font },
      }, '■ 结束 ' + seconds.toFixed(1) + 's'),
      h('button', {
        type: 'button', className: 'sbc-btn', onClick: () => { void finish(true) }, title: '取消这次录音',
        style: { padding: '6px 9px', borderRadius: 9, border: '1px solid ' + T.border, background: 'transparent', color: T.text2, fontSize: 12.5, cursor: 'pointer', fontFamily: T.font },
      }, '×'),
    )
  }
  const busy = phase === 'preparing' || phase === 'transcribing'
  const label = phase === 'transcribing' ? '识别中…' : (phase === 'preparing' ? '准备中…' : '🎤')
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
    h('button', {
      type: 'button', className: 'sbc-btn', disabled: busy || undefined,
      onClick: () => { void start() },
      title: '点一下开始录音，再点结束；识别用 DSH 自带的 SenseVoice，文字只放进输入框',
      style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '6px 12px', borderRadius: 9, border: '1px solid ' + T.border, background: 'transparent', color: T.text, fontSize: 12.5, lineHeight: '18px', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.65 : 1, fontFamily: T.font, flexShrink: 0, whiteSpace: 'nowrap' },
    }, label),
    note ? h('span', { style: { fontSize: 10.5, color: T.text3, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: note }, note) : null,
    err ? h('span', { title: err, style: { fontSize: 10.5, color: T.danger, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, err) : null,
  )
}

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
      // 语音是附加物：文字永远在，音频失败只给一行小字（V15）
      (!isUser && m.audio) ? h(ChatVoiceButton, { audio: m.audio, duration: m.audioDuration }) : null,
      (!isUser && m.voiceWarning) ? h('div', {
        style: { fontSize: 10.5, color: T.text3, lineHeight: 1.5 },
        title: String(m.voiceWarning),
      }, '语音提示：' + String(m.voiceWarning).slice(0, 120)) : null,
      (!isUser && !m.audio && m.voiceError) ? h('div', { style: { fontSize: 10.5, color: T.text3, lineHeight: 1.5 } }, '语音没生成：' + chatVoiceErrorText(m.voiceError)) : null,
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
  const voice = useVoiceSettings()
  // 自动朗读：默认开。Electron 的 webview 默认允许自动播放，所以新消息能直接出声；
  // 历史消息（超过 60 秒）不自动读，只给手点。
  const [autoSpeak, setAutoSpeak] = useLocal('companionVoiceAutoplay', true)
  const autoPlayedRef = React.useRef('')
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
  const voiceRevRef = React.useRef(0)      // 语音异步挂上来的增量水位（/api/events?voiceSince=）

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
    voiceRevRef.current = Number(data.voiceRev) || 0
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
      r = await Api.get('/api/events?since=' + lastIdRef.current + '&voiceSince=' + voiceRevRef.current)
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
    // 语音是异步挂上去的，按 rev 增量补到已有消息上（不重排、不重复）
    const vu = Array.isArray(data.voiceUpdates) ? data.voiceUpdates : []
    if (vu.length) {
      setMsgs((prev) => {
        let touched = false
        const next = prev.map((m) => {
          const hit = vu.find((u) => Number(u.id) === Number(m.id))
          if (!hit) return m
          touched = true
          return Object.assign({}, m, hit)
        })
        return touched ? next : prev
      })
    }
    if (Number(data.voiceRev) > voiceRevRef.current) voiceRevRef.current = Number(data.voiceRev)
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

  // 语音自动朗读：她最新一条带音频的消息只自动播一次；历史消息（>60 秒）不自动读
  React.useEffect(() => {
    if (!autoSpeak) return undefined
    if (!(voice.settings && voice.settings.enabled)) return undefined
    let target = null
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m && m.role === 'her' && m.audio) { target = m; break }
    }
    if (!target || !target.audio) return undefined
    const key = String(target.audio)
    if (autoPlayedRef.current === key) return undefined
    if (Date.now() - (Number(target.at) || 0) > 60000) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled || autoPlayedRef.current === key) return
      // 真正开始播了才记下来：中间又有消息进来导致 effect 重跑时还能补播
      autoPlayedRef.current = key
      Api.fileUrl(target.audio).then((u) => {
        if (cancelled || !u) return
        sbcAudioPlay(u)
      }).catch(() => {})
    }, 150)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [msgs, autoSpeak, voice.settings])

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
  const voicePlaying = useVoicePlaying()
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
        // 语音总开关：关闭只发文字；打开后她的回复会带一条可点的语音（不自动播放）
        h(Chip, {
          active: !!(voice.settings && voice.settings.enabled),
          title: '她的回复要不要生成语音（点一下切换）',
          onClick: () => { void saveVoiceSettings({ enabled: !(voice.settings && voice.settings.enabled) }) },
        }, (voice.settings && voice.settings.enabled) ? '🔊 语音开' : '🔇 语音关'),
        (voice.settings && voice.settings.enabled)
          ? h(Chip, {
              active: !!autoSpeak,
              title: '新消息是否自动读出来（关掉=只在你点播放时读）',
              onClick: () => setAutoSpeak((v) => !v),
            }, autoSpeak ? '🔈 自动读' : '🔈 手点读')
          : null,
        (voice.settings && voice.settings.enabled && voicePlaying)
          ? h(Chip, { title: '停止正在播放的语音', onClick: () => { sbcAudioStop() } }, '■ 停止')
          : null,
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
        h(ChatMicButton, {
          onText: (t) => setInput((prev) => (prev && prev.trim() ? prev.replace(/\s+$/, '') + ' ' + t : t)),
        }),
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
