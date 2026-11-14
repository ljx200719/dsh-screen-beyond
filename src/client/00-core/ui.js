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
