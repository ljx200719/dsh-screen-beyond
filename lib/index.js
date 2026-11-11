import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-screen-beyond'
export const inject = ['webServer']

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNTIME = path.resolve(HERE, '..', 'runtime')
const VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(HERE, '..', 'package.json'), 'utf8')).version || '0.0.0' } catch { return '0.0.0' } })()
const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const PORT_FILE = path.join(HOME, '.dsh-companion-port.json')
const LOCAL_CONFIG = process.env.DSH_COMPANION_CONFIG || path.join(HOME, '.dsh-companion.json')
let child = null

const NODE_CANDIDATES = [
  process.env.DSH_COMPANION_NODE,
  process.env.DSH_NODE,
  'C:\\Program Files\\nodejs\\node.exe',
  '/usr/bin/node',
  '/usr/local/bin/node',
]

function resolveNode() {
  for (const c of NODE_CANDIDATES) {
    if (c && fs.existsSync(c)) return c
  }
  return process.execPath
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function readPortFile() { return readJson(PORT_FILE) }

async function statusOf(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  }
}

async function stopStale(info) {
  try {
    if (info && info.pid) process.kill(info.pid)
    else if (info && info.port) {
      const out = await new Promise((resolve) => {
        import('node:child_process').then(({ execFile }) => {
          execFile('powershell.exe', ['-NoProfile', '-Command', `(Get-NetTCPConnection -LocalPort ${info.port} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { windowsHide: true, timeout: 8000 }, (e, o) => resolve(String(o || '')))
        }).catch(() => resolve(''))
      })
      for (const pid of out.split(/\s+/)) { if (/^\d+$/.test(pid)) { try { process.kill(Number(pid)) } catch {} } }
    }
  } catch {}
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300))
    const st = info && info.port ? await statusOf(info.port) : null
    if (!st) return
  }
}

export function apply(ctx, config = {}) {
  const local = readJson(LOCAL_CONFIG) || {}
  const preferred = Number(config.port || local.port) || 8900
  // 数据目录优先级：插件配置 > 本机 override 文件 > 运行时默认值（%USERPROFILE%\.dsh-companion）
  const dataRoot = config.dataRoot ? String(config.dataRoot) : (local.dataRoot ? String(local.dataRoot) : null)
  const envDir = config.envDir ? String(config.envDir) : (local.envDir ? String(local.envDir) : null)
  const autoStart = config.autoStart !== false

  try {
    const web = ctx.webServer || (typeof ctx.get === 'function' ? ctx.get('webServer') : null)
    if (web && typeof web.register === 'function') {
      const register = () => web.register({
        kind: 'exact',
        path: '/dsh-screen-beyond/info',
        handler: async (req, res) => {
          const info = readPortFile()
          const body = JSON.stringify({
            ok: !!(info && info.port),
            port: info ? info.port : null,
            url: info && info.port ? `http://127.0.0.1:${info.port}` : null,
            mode: info ? info.mode || null : null,
            root: info ? info.root || null : dataRoot,
            version: VERSION,
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
    console.log('[dsh-screen-beyond] autoStart=false，跳过启动')
    return
  }

  const start = async () => {
    const prev = readPortFile()
    if (prev && prev.port) {
      const st = await statusOf(prev.port)
      const sameVersion = st && String(st.version || '') === VERSION
      const sameRoot = !dataRoot || (st && st.setup && st.setup.dataRoot && path.resolve(String(st.setup.dataRoot)) === path.resolve(dataRoot))
      if (sameVersion && sameRoot) {
        console.log(`[dsh-screen-beyond] 复用已运行运行时 (v${VERSION}): http://127.0.0.1:${prev.port}/`)
        return
      }
      console.log(`[dsh-screen-beyond] 运行时版本/数据目录不一致，重启：旧 v${(st && st.version) || '?'} root=${(st && st.setup && st.setup.dataRoot) || prev.root || '?'}`)
      await stopStale(prev)
    }
    const server = path.join(RUNTIME, 'server.mjs')
    if (!fs.existsSync(server)) {
      console.warn('[dsh-screen-beyond] 缺少 runtime/server.mjs，跳过')
      return
    }
    const node = resolveNode()
    const env = { ...process.env }
    if (dataRoot) env.LINZHI_ROOT = dataRoot
    if (envDir) env.DSH_COMPANION_ENV = envDir
    env.LINZHI_PORT = String(preferred)
    if (node === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
    child = spawn(node, [server], { cwd: RUNTIME, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    child.stdout?.on('data', (d) => console.log('[dsh-screen-beyond]', String(d).trim()))
    child.stderr?.on('data', (d) => console.warn('[dsh-screen-beyond]', String(d).trim()))
    child.on('exit', (code) => {
      console.log(`[dsh-screen-beyond] 运行时退出 code=${code}`)
      child = null
    })
    console.log(`[dsh-screen-beyond] 启动运行时 v${VERSION}（优先端口 ${preferred}）数据: ${dataRoot || '默认(~/.dsh-companion)'}`)
  }
  void start()

  return () => {
    try { child?.kill() } catch {}
  }
}
