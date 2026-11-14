// 构建 DSH 客户端半：src/client/** → lib/client.js（单文件工厂）
//
// 为什么需要它：DSH 客户端半只有一个入口（package.json exports["./client"]），
// 但原生面板代码量太大，必须拆成多个源文件维护。这里按固定顺序拼接成一个
// window.__ModuleLoader__.load({...}) 工厂，源文件共享同一个函数作用域。
//
// 用法：npm run build:client
// 约定：源文件是普通脚本片段，禁止 import/export（会破坏单文件工厂）。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src', 'client')
const OUT = path.join(ROOT, 'lib', 'client.js')

// 构建顺序 = 依赖顺序：被使用的一定在前面。改顺序会 502（ReferenceError），别乱动。
export const FILES = [
  '00-core/const.js',
  '00-core/api.js',
  '00-core/format.js',
  '00-core/store.js',
  '00-core/ui.js',
  '00-core/hooks.js',
  '10-chat/chat.js',
  '20-stage/skeleton.js',
  '20-stage/three3d.js',
  '20-stage/stage.js',
  '20-stage/map.js',
  '30-settings/settings-core.js',
  '30-settings/settings-life.js',
  '30-settings/settings-model.js',
  '30-settings/settings-data.js',
  '30-settings/settings-direct.js',
  '30-settings/settings-vm.js',
  '30-settings/settings.js',
  '40-screen/screen.js',
  '40-screen/pet.js',
  '50-app/app.js',
]

function readVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').replace(/^\uFEFF/, ''))
    return String(pkg.version || '0.0.0')
  } catch { return '0.0.0' }
}

function readSource(rel) {
  const file = path.join(SRC, rel)
  if (!fs.existsSync(file)) throw new Error('缺少源文件：src/client/' + rel)
  const code = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\s+$/, '')
  if (!code.trim()) throw new Error('源文件为空：src/client/' + rel)
  // 单文件工厂里不能有模块语法
  if (/^\s*(?:import\s|export\s)/m.test(code)) throw new Error('src/client/' + rel + ' 不能使用 import/export')
  if (code.includes('__ModuleLoader__')) throw new Error('src/client/' + rel + ' 不应该包含 __ModuleLoader__（由构建脚本生成）')
  return code
}

function build() {
  const version = readVersion()
  const parts = []
  for (const rel of FILES) {
    const code = readSource(rel)
    parts.push('    /* ===== src/client/' + rel + ' ===== */\n' + code)
  }
  const head = [
    '// ⚠️ 自动生成，不要直接改这个文件：',
    '//    源码在 src/client/**，改完运行 `npm run build:client` 重新生成。',
    '//    （DSH 客户端半只有一个入口，所以多文件源码在构建时拼成单文件工厂）',
    '//',
    '// 屏幕彼端 · DSH 客户端半（原生 React 面板，v' + version + '）',
    '//   · 左侧栏「屏幕彼端」入口 → 主区域原生面板：聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于',
    '//   · 直接 fetch 本机运行时 127.0.0.1:<端口> 的 /api/*、/models/* 和图片；',
    '//     **不请求任何 HTML 页面，也没有 iframe**',
    '//   · 她的屏幕：只把 noVNC 地址交给系统浏览器（window.open），面板里不嵌网页',
    'window.__ModuleLoader__.load({',
    "  id: 'dsh-screen-beyond',",
    '  factory: (require) => {',
    '    var module = { exports: {} }',
    '    var exports = module.exports',
    "    const React = require('react')",
    '    const h = React.createElement',
    "    const inject = ['slots']",
    '    const CLIENT_BUILD = { pluginVersion: ' + JSON.stringify(version) + ', native: true }',
    '',
  ].join('\n')
  const tail = [
    '',
    '    exports.apply = apply',
    '    exports.inject = inject',
    '    exports.clientBuild = CLIENT_BUILD',
    '    return module.exports',
    '  },',
    '})',
    '',
  ].join('\n')
  const out = head + parts.join('\n\n') + tail
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, out, 'utf8')
  return { out: OUT, bytes: Buffer.byteLength(out) }
}

const result = build()
execFileSync(process.execPath, ['--check', result.out], { stdio: 'inherit' })
console.log('built lib/client.js  ' + FILES.length + ' files  ' + (result.bytes / 1024).toFixed(1) + ' KB')
