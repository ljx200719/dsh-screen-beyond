// 编码体检：防止「被别的工具按 ANSI 写坏」这类事故再发生
// 检查：NUL 字节 / 非法 UTF-8 / 替换字符 U+FFFD / JSON 能否解析 / CSV 列数与表头一致 / .ps1 带中文却没 BOM
// 用法：node scripts/check-encoding.mjs   （已接进 npm run check）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'backups', 'data', 'sync', 'vendor', 'models', 'images', 'attachments'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.csv', '.ps1', '.cmd', '.yml', '.yaml', '.html', '.css', '.txt'])
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.glb', '.gltf', '.wav', '.mp3', '.zip', '.docx', '.pak', '.node', '.dll', '.exe', '.apk', '.svg'])

// 引号感知的 CSV 行切分（备注里带英文逗号也不会误判）
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
      continue
    }
    if (c === ',' && !quoted) { out.push(cur); cur = ''; continue }
    cur += c
  }
  out.push(cur)
  return out
}

const problems = []
const stats = { files: 0, json: 0, csv: 0, ps1Bom: 0 }
const decoder = new TextDecoder('utf-8', { fatal: false })

function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir) } catch (e) { return }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try { st = fs.statSync(full) } catch (e) { continue }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue }
    const ext = path.extname(name).toLowerCase()
    if (BINARY_EXT.has(ext) || !TEXT_EXT.has(ext)) continue
    stats.files++
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    const buf = fs.readFileSync(full)
    if (buf.includes(0)) problems.push(rel + '：含 NUL 字节（多半被按 UTF-16/ANSI 写坏）')
    const text = decoder.decode(buf)
    if (text.includes('\uFFFD')) problems.push(rel + '：含替换字符 U+FFFD（编码坏了）')
    if (ext === '.json') {
      try { JSON.parse(text.replace(/^\uFEFF/, '')); stats.json++ } catch (e) { problems.push(rel + '：JSON 解析失败 → ' + String(e.message).slice(0, 90)) }
    }
    if (ext === '.csv') {
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
      if (lines.length) {
        const cols = splitCsvLine(lines[0]).length
        const bad = []
        lines.forEach((l, i) => { if (splitCsvLine(l).length !== cols) bad.push(i + 1) })
        if (bad.length) problems.push(rel + '：' + bad.length + ' 行列数与表头(' + cols + ')不符，行号 ' + bad.slice(0, 5).join(','))
        else stats.csv++
      }
    }
    if (ext === '.ps1') {
      const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
      if (bom) stats.ps1Bom++
      else if (/[\u4e00-\u9fff]/.test(text)) problems.push(rel + '：含中文但没有 UTF-8 BOM（Windows PowerShell 5.1 会按 ANSI 读坏）')
    }
  }
}

walk(ROOT)
console.log('编码体检：' + stats.files + ' 个文本文件，JSON ' + stats.json + ' 个、CSV ' + stats.csv + ' 个、PS1 带 BOM ' + stats.ps1Bom + ' 个')
if (problems.length) {
  console.error('\n发现 ' + problems.length + ' 个问题：')
  for (const p of problems) console.error('  · ' + p)
  console.error('\n修法：JSON/JS/CSV 用 Node 或编辑器按 UTF-8 重写；.ps1 补 BOM。不要用 PowerShell 的 Get-Content/Set-Content 读写这些文件。')
  process.exit(1)
}
console.log('通过：没有 NUL / 坏编码 / JSON 解析失败 / CSV 列数不符 / PS1 缺 BOM')
