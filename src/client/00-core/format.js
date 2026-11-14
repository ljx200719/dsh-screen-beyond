// 00-core/format.js —— 纯函数小工具（不依赖 React）

function clampNum(v, lo, hi, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback === undefined ? lo : fallback
  return Math.min(hi, Math.max(lo, n))
}

function fmtTime(ts) {
  const d = new Date(Number(ts) || Date.now())
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return hh + ':' + mm
}

function fmtDateTime(ts) {
  const d = new Date(Number(ts) || Date.now())
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return mo + '-' + da + ' ' + fmtTime(ts)
}

// 头像地址白名单：只允许服务端头像路径，其余返回 ''（调用方走首字兜底），避免 url() 注入
function safeAvatarUrl(u) {
  const s = String(u || '')
  if (!/^\/(avatar\.png|default-avatar\.png)(\?[A-Za-z0-9_=.\-&%]*)?$/.test(s)) return ''
  return s
}

function fmtMoney(v, digits) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '…'
  return n.toFixed(digits === undefined ? 2 : digits)
}

function fmtBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return v + ' B'
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + ' KB'
  if (v < 1024 * 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + ' MB'
  return (v / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

// 分钟数 → “x 小时 y 分”
function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0))
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? h + ' 小时 ' + rest + ' 分' : h + ' 小时'
}

// 角色名首字兜底（不写死任何角色名，N02）
function initialOf(name) {
  const s = String(name || '').trim()
  return s ? s.slice(0, 1) : '她'
}

// 稳定的列表 key（没有 id 时用索引）
function keyOf(item, i) {
  if (item && item.id !== undefined && item.id !== null) return String(item.id)
  if (item && item.uid) return String(item.uid)
  return 'i' + i
}

function joinClass() {
  const out = []
  for (let i = 0; i < arguments.length; i++) { const v = arguments[i]; if (v) out.push(v) }
  return out.join(' ')
}

// 从地图坐标（0~1）换算 px
function pct(v) {
  return (clampNum(v, 0, 1, 0.5) * 100).toFixed(2) + '%'
}
