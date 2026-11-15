// 发布前扫一遍：仓库里不允许出现真实密钥 / 用户本机绝对路径
// 用法：node scripts/check-secrets.mjs   （已接进 npm run check）
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'sync', 'vendor', 'models', 'images', 'attachments', 'backups'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.csv', '.ps1', '.yml', '.yaml', '.html', '.css', '.txt'])

const RULES = [
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}/, why: 'OpenAI 风格的明文 Key' },
  { id: 'bearer-token', re: /Bearer[;]?\s+[A-Za-z0-9._~+/=-]{30,}/, why: 'Authorization 里带了明文 token' },
  { id: 'user-home-path', re: /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9_.-]+\\\\?/i, why: '写死了某台机器的用户目录' },
  { id: 'apikeyref-file', re: /apiKeyRef['"]?\s*[:=]\s*['"]file:\s*[A-Za-z]:\\/i, why: '配置里写死了本机密钥文件路径（应该让用户在设置页填）' },
  { id: 'volc-apikey', re: /X-Api-Key['"]?\s*[:=]\s*['"][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"]/i, why: '写死了火山 API Key' },
]

const hits = []
let scanned = 0

function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir) } catch (e) { return }
  for (const name of entries) {
    const full = path.join(dir, name)
    let st
    try { st = fs.statSync(full) } catch (e) { continue }
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue }
    if (!TEXT_EXT.has(path.extname(name).toLowerCase())) continue
    if (st.size > 2 * 1024 * 1024) continue
    scanned++
    const rel = path.relative(ROOT, full).replace(/\\/g, '/')
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const rule of RULES) {
        if (rule.re.test(line)) hits.push({ rel, line: i + 1, why: rule.why, sample: line.trim().slice(0, 80) })
      }
    }
  }
}

walk(ROOT)
console.log('密钥扫描：' + scanned + ' 个文本文件')
if (hits.length) {
  console.error('\n发现 ' + hits.length + ' 处疑似把密钥/本机路径写进了仓库：')
  for (const h of hits.slice(0, 40)) console.error('  · ' + h.rel + ':' + h.line + ' — ' + h.why + ' → ' + h.sample)
  console.error('\n发布前必须清掉：这些会跟着 npm 包发给所有用户。')
  process.exit(1)
}
console.log('通过：没有明文 Key / Bearer token / 本机用户路径')
