const src = fs.readFileSync('F:/onebot/next/bridge-core.js', 'utf8')
const factory = new Function('require', 'process', 'electron', 'fs', 'path', 'http', 'log', src)
factory(require, process, require('electron'), fs, path, require('http'), function (m) { log(String(m)) })
const start = globalThis.__sbcStartBridge
if (!start) return { error: 'no start fn' }
if (globalThis.__sbcBridge && globalThis.__sbcBridge.started) return { error: 'already running', state: { events: globalThis.__sbcBridge.events } }
const r = start({ require: require, process: process, electron: require('electron'), fs: fs, path: path, http: require('http') })
return r
