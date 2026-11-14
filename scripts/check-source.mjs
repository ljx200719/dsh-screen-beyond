// 单文件语法检查（供并行开发时各自验证 src/client/** 的片段，不执行代码）
//
// 为什么不用 node --check：源文件是"单文件工厂的片段"，单独 --check 也能过，
// 但在部分环境（Electron as node / 旧 PowerShell）退出码不可靠；这里用 new Function
// 只做语法编译，不执行，成功返回 0，失败返回 1。
//
// 用法：node scripts/check-source.mjs src/client/10-chat/chat.js [更多文件...]
import fs from 'node:fs'
import path from 'node:path'

const files = process.argv.slice(2)
if (!files.length) {
  console.error('用法：node scripts/check-source.mjs <file...>')
  process.exit(2)
}
let bad = 0
for (const rel of files) {
  const file = path.resolve(process.cwd(), rel)
  try {
    const code = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    // 只做语法编译、不执行（源文件是单文件工厂的片段，单独跑没有意义）
    new Function(code)
    console.log('OK   ' + rel)
  } catch (e) {
    bad++
    console.error('FAIL ' + rel + ' :: ' + (e && e.message))
  }
}
process.exit(bad ? 1 : 0)
