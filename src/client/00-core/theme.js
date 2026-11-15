// 00-core/theme.js —— 面板配色层（配色模式 + 强调色 + 方案变量）
//
// 为什么需要它（0.8.1 实机踩到的两类「看不见」）：
//   1. 外观美化（玻璃底 + 星空）硬编码深色，DSH 切浅色后变成「深底 + 深字」，整页读不了；
//   2. 地图/舞台的地点胶囊用固定深色底，却配 T.text（浅色主题下是深字），地点名直接消失。
//
// 做法：面板颜色全部收敛成挂在面板根节点的 CSS 变量（--sbc-*）。
//   · 换配色 = 换变量值，组件不用重渲染，也不会闪；
//   · 强制浅色/深色时顺带覆盖 --dsw-alias-*，让 T.* 那套宿主 token 在面板子树里一起变；
//   · 强调色不用 --dsw-alias-brand-primary（当前 DSH 把它别名成 label-primary，会白底白字）。

const SBC_THEME_DEFAULT = { mode: 'follow', accent: 'blue' }

// 配色模式：follow = 跟着 DSH 自己的亮/暗走；light/dark = 面板自己锁死
const SBC_THEME_MODES = [
  { key: 'follow', label: '跟随 DSH', hint: 'DSH 切亮/暗，面板跟着变（推荐）' },
  { key: 'light', label: '浅色', hint: '面板固定浅色，不受 DSH 影响' },
  { key: 'dark', label: '深色', hint: '面板固定深色，不受 DSH 影响' },
]

// 强调色：只影响按钮/选中态/滑块/她的气泡等「主色」位置，不动背景
const SBC_ACCENTS = [
  { id: 'blue', name: '雾蓝', color: '#3b82f6' },
  { id: 'cyan', name: '青空', color: '#0ea5e9' },
  { id: 'violet', name: '紫罗兰', color: '#8b5cf6' },
  { id: 'rose', name: '樱粉', color: '#ec4899' },
  { id: 'emerald', name: '薄荷绿', color: '#10b981' },
  { id: 'amber', name: '暖琥珀', color: '#d97706' },
  { id: 'coral', name: '珊瑚朱', color: '#f97316' },
  { id: 'graphite', name: '石墨', color: '#64748b' },
]

// 两套底：浅 / 深。只在「强制」时覆盖宿主 token；跟随模式只借它算玻璃和星空的明暗。
const SBC_PALETTES = {
  light: {
    bg: '#f5f7fb', bg1: '#ffffff', bg2: '#eef2f8', overlay: '#ffffff',
    // 浅色外观下发白、边界弱（F-011）：边框从 .10/.20 提到 .16/.30，正文色压深一档
    border: 'rgba(16,24,40,.16)', border2: 'rgba(16,24,40,.30)',
    text: '#1a2532', text2: '#3c4a5c', text3: '#5b6b7f',
    glass: '255,255,255', ink: '26,37,50',
    glow1: 'rgba(59,130,246,.16)', glow2: 'rgba(14,165,233,.12)', glow3: 'rgba(139,92,246,.12)',
    paintA: '#eef3fa', paintB: '#e3ebf5',
    veilA: 'rgba(255,255,255,.72)', veilB: 'rgba(255,255,255,.90)',
    star1: 'rgba(30,41,59,.26)', star2: 'rgba(30,41,59,.16)', star3: 'rgba(30,41,59,.20)',
  },
  dark: {
    bg: '#0b0f14', bg1: '#11161d', bg2: '#16202b', overlay: '#141c26',
    // 深色外观下辅助文字偏暗读不清（F-011）：text2/text3 各提亮一档，边框稍强保住层次
    border: 'rgba(255,255,255,.14)', border2: 'rgba(255,255,255,.26)',
    text: '#e2e9f2', text2: '#aebdd0', text3: '#8b9cb0',
    glass: '12,18,30', ink: '226,233,242',
    glow1: 'rgba(88,101,242,.22)', glow2: 'rgba(0,196,255,.15)', glow3: 'rgba(150,90,255,.13)',
    paintA: '#0d1320', paintB: '#0a0f19',
    veilA: 'rgba(8,12,22,.66)', veilB: 'rgba(8,12,22,.86)',
    star1: 'rgba(255,255,255,.55)', star2: 'rgba(255,255,255,.35)', star3: 'rgba(255,255,255,.45)',
  },
}

// ── 颜色小工具 ─────────────────────────────────────────────────────

// '#3b82f6' / '#abc' → [r,g,b]；失败返回 null
function sbcHexToRgb(hex) {
  const s = String(hex || '').trim().replace(/^#/, '')
  if (s.length === 3) {
    return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)]
  }
  if (s.length === 6) {
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
  }
  return null
}

// 感知亮度（0~1）：只用来判断「这颜色算亮还是暗」
function sbcLuminance(rgb) {
  if (!rgb || rgb.length < 3) return 0
  return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
}

// 解析 #hex / rgb() / rgba()，拿不到就 null
function sbcParseColor(value) {
  const s = String(value || '').trim()
  if (!s) return null
  if (s[0] === '#') return sbcHexToRgb(s)
  const m = s.match(/^rgba?\(([^)]+)\)$/i)
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map((x) => parseFloat(x))
  if (parts.length < 3 || parts.some((n) => !isFinite(n))) return null
  return [parts[0], parts[1], parts[2]]
}

// ── 当前 DSH 到底是亮还是暗 ─────────────────────────────────────────
// 不去猜 DSH 怎么实现主题：直接读它自己的 --dsw-alias-bg-base 算亮度。
function sbcDetectScheme() {
  try {
    const root = document.documentElement
    const cs = window.getComputedStyle(root)
    // 首选：宿主背景色。亮背景 = 浅色主题
    let rgb = sbcParseColor(cs.getPropertyValue('--dsw-alias-bg-base'))
    if (rgb) return sbcLuminance(rgb) > 0.55 ? 'light' : 'dark'
    // 次选：宿主主文字色（反着判）。亮字 = 深色主题
    const ink = sbcParseColor(cs.getPropertyValue('--dsw-alias-label-primary'))
    if (ink) return sbcLuminance(ink) > 0.6 ? 'dark' : 'light'
    // 再退：body 上的同名 token 或实际背景
    const body = document.body
    if (body) {
      const bs = window.getComputedStyle(body)
      rgb = sbcParseColor(bs.getPropertyValue('--dsw-alias-bg-base')) || sbcParseColor(bs.backgroundColor)
      if (rgb) return sbcLuminance(rgb) > 0.55 ? 'light' : 'dark'
    }
  } catch (e) {}
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (e) {}
  return 'dark'
}

// 订阅「宿主主题变了」：属性变化 + <head> 插样式 + 兜底轮询（DSH 换主题的三种常见姿势都盖到）
function useScheme() {
  const [scheme, setScheme] = React.useState(() => sbcDetectScheme())
  React.useEffect(() => {
    let alive = true
    let timer = null
    let last = sbcDetectScheme()
    const check = () => {
      if (!alive) return
      const s = sbcDetectScheme()
      if (s !== last) { last = s; setScheme(s) }
    }
    const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(check, 80) }
    let mq = null
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
      if (mq.addEventListener) mq.addEventListener('change', soon)
    } catch (e) {}
    let mo = null
    try {
      mo = new MutationObserver(soon)
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-scheme'] })
      if (document.head) mo.observe(document.head, { childList: true, subtree: true })
    } catch (e) {}
    const iv = setInterval(check, 2500)
    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      clearInterval(iv)
      try { if (mq && mq.removeEventListener) mq.removeEventListener('change', soon) } catch (e) {}
      try { if (mo) mo.disconnect() } catch (e) {}
    }
  }, [])
  return scheme
}

// ── 配色配置（存运行时 CONFIG.panelTheme，本地再缓存一份防闪烁）────────

const SBC_THEME_LS = 'companionPanelTheme'
let __sbcPanel = { theme: SBC_THEME_DEFAULT, loaded: false }
let __sbcPanelPromise = null
const __sbcPanelSubs = new Set()

function sbcThemeClean(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  const mode = SBC_THEME_MODES.some((x) => x.key === String(t.mode)) ? String(t.mode) : SBC_THEME_DEFAULT.mode
  const accent = SBC_ACCENTS.some((x) => x.id === String(t.accent)) ? String(t.accent) : SBC_THEME_DEFAULT.accent
  return { mode: mode, accent: accent }
}
function sbcThemeCacheRead() {
  try {
    const raw = localStorage.getItem(SBC_THEME_LS)
    if (raw) return sbcThemeClean(JSON.parse(raw))
  } catch (e) {}
  return null
}
function sbcThemeCacheWrite(t) {
  try { localStorage.setItem(SBC_THEME_LS, JSON.stringify(t)) } catch (e) {}
}
;(function sbcThemeBoot() {
  const cached = sbcThemeCacheRead()
  if (cached) __sbcPanel = { theme: cached, loaded: false }
})()

function __sbcPanelNotify() {
  __sbcPanelSubs.forEach((fn) => { try { fn() } catch (e) {} })
}
function sbcThemeSet(next) {
  const clean = sbcThemeClean(next)
  __sbcPanel = { theme: clean, loaded: true }
  sbcThemeCacheWrite(clean)
  __sbcPanelNotify()
}
function sbcThemeLoad(force) {
  if (__sbcPanelPromise && !force) return __sbcPanelPromise
  __sbcPanelPromise = Api.get('/api/panel-theme').then((r) => {
    const cur = r && r.ok && r.data && r.data.current
    if (cur) sbcThemeSet(cur)
    return __sbcPanel.theme
  }).catch(() => __sbcPanel.theme)
  return __sbcPanelPromise
}
function usePanelTheme() {
  const [, setTick] = React.useState(0)
  React.useEffect(() => {
    const fn = () => setTick((t) => t + 1)
    __sbcPanelSubs.add(fn)
    sbcThemeLoad(false)
    const onChange = () => sbcThemeLoad(true)
    try { window.addEventListener('sbc-panel-theme-changed', onChange) } catch (e) {}
    return () => {
      __sbcPanelSubs.delete(fn)
      try { window.removeEventListener('sbc-panel-theme-changed', onChange) } catch (e) {}
    }
  }, [])
  return __sbcPanel.theme
}

// ── 把配色算成 CSS 变量（挂到面板根节点）────────────────────────────
function sbcThemeVars(theme, detected) {
  const t = sbcThemeClean(theme)
  const scheme = t.mode === 'follow' ? (detected === 'light' ? 'light' : 'dark') : t.mode
  const pal = SBC_PALETTES[scheme] || SBC_PALETTES.dark
  const accent = SBC_ACCENTS.filter((a) => a.id === t.accent)[0] || SBC_ACCENTS[0]
  const rgb = sbcHexToRgb(accent.color) || [59, 130, 246]
  const rgbStr = rgb.join(',')
  // 强调色当填充时，按钮/气泡上的字用哪个颜色才读得清：亮色配深字，暗色配白字
  const ink = sbcLuminance(rgb) > 0.62 ? '#0b1220' : '#ffffff'
  const vars = {
    '--sbc-accent': accent.color,
    '--sbc-accent-rgb': rgbStr,
    '--sbc-accent-soft': 'rgba(' + rgbStr + ',.16)',
    '--sbc-accent-ink': ink,
    // 玻璃 / 星空 / 场景胶囊：跟随当前配色的明暗
    '--sbc-glass-rgb': pal.glass,
    '--sbc-ink-rgb': pal.ink,
    '--sbc-glow1': pal.glow1,
    '--sbc-glow2': pal.glow2,
    '--sbc-glow3': pal.glow3,
    '--sbc-paint-a': pal.paintA,
    '--sbc-paint-b': pal.paintB,
    '--sbc-paint-veil-a': pal.veilA,
    '--sbc-paint-veil-b': pal.veilB,
    '--sbc-star1': pal.star1,
    '--sbc-star2': pal.star2,
    '--sbc-star3': pal.star3,
    // 地图/舞台的地点胶囊永远深底浅字（压在照片上，两种配色都要能读）
    '--sbc-pin-bg': 'rgba(8,13,20,.78)',
    '--sbc-pin-ink': '#e7edf5',
    colorScheme: scheme,
  }
  // 强制浅/深色：在面板子树里就地覆盖 DSH 的 token，T.* 那套因此跟着变
  if (t.mode !== 'follow') {
    vars['--dsw-alias-bg-base'] = pal.bg
    vars['--dsw-alias-bg-layer-1'] = pal.bg1
    vars['--dsw-alias-bg-layer-2'] = pal.bg2
    vars['--dsw-alias-bg-overlay'] = pal.overlay
    vars['--dsw-alias-border-l1'] = pal.border
    vars['--dsw-alias-border-l2'] = pal.border2
    vars['--dsw-alias-label-primary'] = pal.text
    vars['--dsw-alias-label-secondary'] = pal.text2
    vars['--dsw-alias-label-tertiary'] = pal.text3
    vars['--dsw-alias-label-caption'] = pal.text3
  }
  return vars
}

// 当前配色对应的「实际明暗」（设置页预览用）
function sbcEffectiveScheme(theme, detected) {
  const t = sbcThemeClean(theme)
  if (t.mode === 'follow') return detected === 'light' ? 'light' : 'dark'
  return t.mode
}
