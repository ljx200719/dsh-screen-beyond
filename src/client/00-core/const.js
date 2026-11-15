// 00-core/const.js —— 常量与主题 token
//
// 只允许用这里的 T.*（映射到 DSH 主题变量）写颜色，面板才能跟着 DSH 亮/暗主题走。
// 业务文案生成器（energyLabel 等）也放这里，避免每个模块各写一份。

const DEFAULT_BASE = 'http://127.0.0.1:8900'
const PORT_SCAN_FROM = 8900
const PORT_SCAN_TO = 8912
const STATUS_POLL_MS = 4000
const EVENTS_POLL_MS = 1200
const STAGE_POLL_MS = 2500
const TABS = [
  { key: 'chat', label: '聊天' },
  { key: 'stage', label: '舞台' },
  { key: 'map', label: '地图' },
  { key: 'settings', label: '设置' },
  { key: 'screen', label: '屏幕' },
  { key: 'about', label: '关于' },
]

// DSH 客户端 ctx（0.8.8）：插件的 client 半只有 apply(ctx) 拿得到，语音输入要借它调 DSH 的 speech Remote
let SBC_CLIENT_CTX = null

const T = {
  radius: 10,
  radiusLg: 14,
  font: 'inherit',
  mono: 'ui-monospace, SFMono-Regular, Consolas, "Courier New", monospace',
  bg: 'var(--dsw-alias-bg-base, #0b0f14)',
  bg1: 'var(--dsw-alias-bg-layer-1, #11161d)',
  bg2: 'var(--dsw-alias-bg-layer-2, #16202b)',
  overlay: 'var(--dsw-alias-bg-overlay, #141c26)',
  border: 'var(--dsw-alias-border-l1, rgba(255,255,255,.12))',
  border2: 'var(--dsw-alias-border-l2, rgba(255,255,255,.22))',
  text: 'var(--dsw-alias-label-primary, #d7dee8)',
  text2: 'var(--dsw-alias-label-secondary, #9fb0c4)',
  text3: 'var(--dsw-alias-label-tertiary, #6f849b)',
  // ⚠️ 强调色不能用 --dsw-alias-brand-primary：当前 DSH 版本把它别名成 label-primary
  //（深色主题接近纯白），拿它当填充色会出现「白底白字」（用户气泡、主按钮都不可见，实测踩过）。
  // 现在强调色由「设置 → 面板配色」控制，落在面板根节点的 --sbc-accent* 上（见 00-core/theme.js），
  // 所以这里是变量而不是具体颜色：换配色时组件不用重渲染。
  accent: 'var(--sbc-accent, #3b82f6)',
  accentInk: 'var(--sbc-accent-ink, #ffffff)',
  accentSoft: 'rgba(var(--sbc-accent-rgb, 59,130,246), .18)',
  brand: 'var(--sbc-accent, #3b82f6)',
  danger: 'var(--dsw-alias-state-error-primary, #ef5350)',
  warn: 'var(--dsw-alias-state-warn-primary, #f59e0b)',
  ok: 'var(--dsw-alias-state-success-primary, #22c55e)',
  idle: 'var(--dsw-alias-state-idle-primary, #64748b)',
}

// 角色精力 → 文案（0~100）
function energyLabel(n) {
  const v = Number(n) || 0
  if (v >= 80) return '精力很足'
  if (v >= 55) return '状态不错'
  if (v >= 35) return '有点累'
  if (v >= 20) return '挺累的'
  return '快撑不住了'
}

// 运行时模式 → 文案
function modeLabel(mode) {
  return mode === 'chat' ? '聊天模式' : '完整版'
}

// 舞台/地图里状态点颜色
function stateTone(running) {
  return running ? T.ok : T.idle
}
