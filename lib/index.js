// 屏幕彼端 · dsh-screen-beyond — DSH 宿主半（v0.7.14）
//
// 职责：
//   1. 提供 /dsh-screen-beyond/info：给客户端半返回运行时地址 + 健康状态（响应快，永远不阻塞）；
//   2. 拉起/复用运行时（runtime/server.mjs），并在它异常退出后按退避策略自愈；
//   3. 版本与数据目录不一致时主动重启旧运行时，避免「旧代码写新数据」；
//   4. 插件卸载时清理定时器与子进程。
//
// 与 v0.6.x 的差异：
//   · version 改为每次从磁盘 package.json 读取（升级插件后 /info 不再返回旧版本号）；
//   · /info 增加 runtime 健康信息与 starting 标志，客户端可据此显示状态、少发一次探测请求；
//   · 增加 15s 巡检：运行时挂了会自动拉起（autoStart 为 true 时）；
//   · 子进程崩溃后按 1s→30s 退避重启，避免坏配置导致无限快速重启；
//   · 所有定时器都登记在 ctx.effect / 返回值里，插件卸载即清理。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-screen-beyond'
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(HERE, '..')
const RUNTIME = path.join(ROOT_DIR, 'runtime')
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const PORT_FILE = path.join(HOME, '.dsh-companion-port.json')
const LOCAL_CONFIG = process.env.DSH_COMPANION_CONFIG || path.join(HOME, '.dsh-companion.json')
const SUPERVISE_MS = 15000
const RESTART_MIN_MS = 1000
const RESTART_MAX_MS = 30000

const NODE_CANDIDATES = [
  process.env.DSH_COMPANION_NODE,
  process.env.DSH_NODE,
  'C:\\Program Files\\nodejs\\node.exe',
  '/usr/bin/node',
  '/usr/local/bin/node',
]

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}
function readLocalConfig() {
  return readJson(LOCAL_CONFIG) || {}
}
/** 每次从磁盘读版本号：升级插件目录后无需重启宿主也能在 /info 反映新版本。 */
function readVersion() {
  const pkg = readJson(path.join(ROOT_DIR, 'package.json'))
  return (pkg && pkg.version) || '0.0.0'
}
function readPortFile() {
  return readJson(PORT_FILE)
}
function resolveNode() {
  for (const c of NODE_CANDIDATES) {
    if (c && fs.existsSync(c)) return c
  }
  return process.execPath
}
function fetchJson(url, ms) {
  const timeout = ms || 1500
  return new Promise((resolve) => {
    let settled = false
    const ctl = typeof AbortController === 'function' ? new AbortController() : null
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      if (ctl) { try { ctl.abort() } catch {} }
      finish(null)
    }, timeout)
    let req
    try {
      req = fetch(url, { signal: ctl ? ctl.signal : undefined })
    } catch {
      finish(null)
      return
    }
    req.then((r) => (r && r.ok ? r.json() : null)).then((j) => finish(j || null)).catch(() => finish(null))
  })
}
async function statusOf(port) {
  if (!port) return null
  return fetchJson(`http://127.0.0.1:${port}/api/status`, 1500)
}

/** 停掉旧的运行时实例（pid 优先，端口兜底），最多等约 6 秒。 */
async function stopStale(info) {
  try {
    const pid = info && Number(info.pid)
    const fresh = info && info.at && (Date.now() - Number(info.at) < 24 * 3600 * 1000)
    if (pid && pid > 4 && pid !== process.pid && fresh) process.kill(pid)
    else if (info && info.port) {
      const out = await new Promise((resolve) => {
        import('node:child_process').then(({ execFile }) => {
          execFile('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${info.port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { windowsHide: true, timeout: 8000 }, (e, o) => resolve(String(o || '')))
        }).catch(() => resolve(''))
      })
      for (const pid of out.split(/\s+/)) {
        if (/^\d+$/.test(pid)) { try { process.kill(Number(pid)) } catch {} }
      }
    }
  } catch {}
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300))
    const st = info && info.port ? await statusOf(info.port) : null
    if (!st) return
  }
}

export function apply(ctx, config = {}) {
  const local = readLocalConfig()
  const preferred = Number(config.port || local.port) || 8900
  // 数据目录优先级：插件配置 > 本机 override 文件 > 运行时默认值（%USERPROFILE%\.dsh-companion）
  const dataRoot = config.dataRoot ? String(config.dataRoot) : (local.dataRoot ? String(local.dataRoot) : null)
  const envDir = config.envDir ? String(config.envDir) : (local.envDir ? String(local.envDir) : null)
  const autoStart = config.autoStart !== false

  const state = {
    child: null,
    disposed: false,
    starting: false,
    restartDelay: RESTART_MIN_MS,
    restartTimer: 0,
    health: { ok: false, port: null, version: null, checkedAt: 0, error: null },
    lastLog: '',
  }
  const timers = new Set()
  function every(ms, fn) {
    const t = setInterval(() => { if (!state.disposed) { try { fn() } catch (e) { console.warn('[dsh-screen-beyond] 巡检失败:', String(e && e.message)) } } }, ms)
    timers.add(t)
    return t
  }

  function log(line) {
    state.lastLog = line
    console.log('[dsh-screen-beyond]', line)
  }

  async function healthCheck() {
    const info = readPortFile()
    const prev = state.health
    if (!info || !info.port) {
      state.health = { ok: false, port: null, version: null, checkedAt: Date.now(), error: '运行时未启动' }
      return state.health
    }
    const st = await statusOf(info.port)
    if (!st) {
      state.health = { ok: false, port: info.port, version: prev.port === info.port ? prev.version : null, checkedAt: Date.now(), error: '运行时无响应' }
      return state.health
    }
    // 关键：健康不只是"端口有响应"，还要版本与数据目录一致，否则旧代码会一直被复用
    const want = readVersion()
    const got = String(st.version || '')
    const wantRoot = dataRoot || (local.dataRoot ? String(local.dataRoot) : null)
    const gotRoot = st.setup && st.setup.dataRoot ? String(st.setup.dataRoot) : ''
    const rootOk = !wantRoot || !gotRoot || path.resolve(gotRoot) === path.resolve(wantRoot)
    if (got !== want || !rootOk) {
      state.health = { ok: false, port: info.port, version: got || null, checkedAt: Date.now(), error: '运行时版本/数据目录不一致（运行 ' + (got || '?') + (rootOk ? '' : ' @' + gotRoot) + '，期望 ' + want + (wantRoot ? ' @' + wantRoot : '') + '）' }
    } else {
      state.health = { ok: true, port: info.port, version: got, checkedAt: Date.now(), error: null }
    }
    return state.health
  }

  async function startRuntime(force) {
    if (state.disposed || state.starting || state.child) return
    if (!autoStart && !force) return
    state.starting = true
    try {
      const version = readVersion()
      const server = path.join(RUNTIME, 'server.mjs')
      if (!fs.existsSync(server)) {
        log('缺少 runtime/server.mjs，跳过启动')
        return
      }
      const prev = readPortFile()
      if (prev && prev.port) {
        const st = await statusOf(prev.port)
        const sameVersion = st && String(st.version || '') === version
        const sameRoot = !dataRoot || (st && st.setup && st.setup.dataRoot && path.resolve(String(st.setup.dataRoot)) === path.resolve(dataRoot))
        if (sameVersion && sameRoot) {
          state.health = { ok: true, port: prev.port, version: String(st.version || version), checkedAt: Date.now(), error: null }
          log(`复用已运行运行时 (v${version}): http://127.0.0.1:${prev.port}/`)
          return
        }
        log(`运行时版本/数据目录不一致，重启：旧 v${(st && st.version) || '?'} root=${(st && st.setup && st.setup.dataRoot) || prev.root || '?'}`)
        await stopStale(prev)
      }
      const node = resolveNode()
      const env = Object.assign({}, process.env)
      if (dataRoot) env.LINZHI_ROOT = dataRoot
      if (envDir) env.DSH_COMPANION_ENV = envDir
      env.LINZHI_PORT = String(preferred)
      if (node === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
      const child = spawn(node, [server], { cwd: RUNTIME, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      state.child = child
      child.stdout?.on('data', (d) => console.log('[dsh-screen-beyond]', String(d).trim()))
      child.stderr?.on('data', (d) => console.warn('[dsh-screen-beyond]', String(d).trim()))
      child.on('exit', (code) => {
        state.child = null
        log(`运行时退出 code=${code}`)
        if (state.disposed || !autoStart) return
        // 以退避策略等待下一次巡检/重启拉起，避免坏配置导致快速重启风暴
        const delay = state.restartDelay
        state.restartDelay = Math.min(RESTART_MAX_MS, Math.round(delay * 2))
        if (state.restartTimer) clearTimeout(state.restartTimer)
        state.restartTimer = setTimeout(() => {
          state.restartTimer = 0
          if (!state.disposed) void ensureRunning()
        }, delay)
        timers.add(state.restartTimer)
      })
      log(`启动运行时 v${version}（优先端口 ${preferred}）数据: ${dataRoot || '默认(~/.dsh-companion)'}`)
    } catch (e) {
      log('启动运行时失败: ' + String(e && e.message))
    } finally {
      state.starting = false
    }
  }

  async function ensureRunning() {
    if (state.disposed) return
    const h = await healthCheck()
    if (h.ok) {
      state.restartDelay = RESTART_MIN_MS
      return
    }
    if (autoStart) await startRuntime(false)
  }

  // ── /dsh-screen-beyond/info：客户端用它拿到运行时地址与健康状态 ──
  try {
    const web = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null)
    if (web && typeof web.register === 'function') {
      const register = () => web.register({
        kind: 'exact',
        path: '/dsh-screen-beyond/info',
        handler: async (req, res) => {
          // 5 秒内的巡检结果直接复用；过期才现场探测（端口关闭时 connect 会立刻失败，不会拖慢响应）
          const info = readPortFile()
          const fresh = Date.now() - (state.health.checkedAt || 0) < 5000
          if (!fresh) {
            if (info && info.port) {
              const st = await statusOf(info.port)
              state.health = st
                ? { ok: true, port: info.port, version: st.version || null, checkedAt: Date.now(), error: null }
                : { ok: false, port: info.port, version: null, checkedAt: Date.now(), error: '运行时无响应' }
            } else {
              state.health = { ok: false, port: null, version: null, checkedAt: Date.now(), error: '运行时未启动' }
            }
          }
          const runtime = state.health
          const body = JSON.stringify({
            ok: !!(runtime.ok && runtime.port),
            port: runtime.port || (info && info.port) || null,
            url: runtime.port ? `http://127.0.0.1:${runtime.port}` : null,
            mode: null,
            root: (info && info.root) || dataRoot,
            version: readVersion(),
            starting: state.starting,
            runtime: { ok: !!runtime.ok, port: runtime.port || null, version: runtime.version || null, checkedAt: runtime.checkedAt || 0 },
            config: { autoStart, dataRoot: dataRoot || null, envDir: envDir || null },
          })
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          res.end(body)
        },
      })
      if (typeof ctx.effect === 'function') ctx.effect(register)
      else register()
      console.log('[dsh-screen-beyond] 已注册 /dsh-screen-beyond/info')
    } else {
      console.warn('[dsh-screen-beyond] webServer 服务不可用，客户端将走端口扫描兜底')
    }
  } catch (e) {
    console.warn('[dsh-screen-beyond] 注册 info 路由失败:', String(e && e.message))
  }

  if (!autoStart) {
    console.log('[dsh-screen-beyond] autoStart=false：不自动拉起运行时，仅做健康巡检')
  } else {
    void ensureRunning()
  }
  every(SUPERVISE_MS, () => { void ensureRunning() })

  return () => {
    state.disposed = true
    for (const t of timers) {
      try { clearInterval(t); clearTimeout(t) } catch {}
    }
    timers.clear()
    if (state.child) { try { state.child.kill() } catch {} }
  }
}
