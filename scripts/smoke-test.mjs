// 冒烟测试：起一个隔离的运行时实例（临时数据根/临时 HOME/随机端口），跑接口与安全矩阵。
// 用法：npm run smoke    （不需要真实数据，不影响正在运行的实例）
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(pluginRoot, 'runtime', 'server.mjs');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-smoke-'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Node 的 fetch 会丢掉 Sec-Fetch-* 等受限头，安全矩阵必须用原始 http 请求
function rawReq(url, headers, method) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: method || 'GET', headers: headers || {} }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function req(url, opts = {}) {
  const init = { ...opts, signal: AbortSignal.timeout(20000) };
  const r = await fetch(url, init);
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

function startServer(name, envExtra, portBase) {
  const home = path.join(tmpRoot, name, 'home');
  const root = path.join(tmpRoot, name, 'data');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(root, { recursive: true });
  const port = portBase + Math.floor(Math.random() * 40);
  const child = spawn(process.execPath, [serverPath], {
    cwd: pluginRoot,
    env: {
      ...process.env,
      LINZHI_ROOT: root,
      USERPROFILE: home,
      HOME: home,
      LINZHI_PORT: String(port),
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });
  return { name, home, root, port, child, token: envExtra.DSH_COMPANION_API_TOKEN || '', getLog: () => log };
}

async function waitReady(s) {
  const started = Date.now();
  const hdr = s.token ? { 'x-companion-token': s.token } : {};
  while (Date.now() - started < 30000) {
    if (s.child.exitCode !== null) throw new Error(s.name + ' 启动即退出：' + s.getLog().slice(-800));
    try {
      const r = await fetch('http://127.0.0.1:' + s.port + '/api/status', { headers: hdr, signal: AbortSignal.timeout(3000) });
      if (r.status === 200 || r.status === 401) return;
    } catch (e) {}
    await sleep(300);
  }
  throw new Error(s.name + ' 启动超时：' + s.getLog().slice(-800));
}

function stopServer(s) {
  try { s.child.kill(); } catch (e) {}
}

try {
  // ---------- 普通实例 ----------
  const plain = startServer('plain', {}, 18700);
  try {
    await waitReady(plain);
    const base = 'http://127.0.0.1:' + plain.port;

    let r = await req(base + '/api/status');
    let j = {};
    try { j = JSON.parse(r.text); } catch (e) {}
    check('GET /api/status 200', r.status === 200 && j.ok !== false, 'version=' + (j.version || '?'));
    check('runtime 版本存在', !!j.version, String(j.version || ''));

    r = await req(base + '/');
    check('GET / 200 html', r.status === 200 && r.text.includes('<!doctype html>'), 'len=' + r.text.length);
    for (const page of ['/map', '/settings', '/model', '/stage', '/screen']) {
      r = await req(base + page);
      check('GET ' + page + ' 200', r.status === 200 && r.text.length > 5000, 'len=' + r.text.length);
    }

    r = await rawReq(base + '/api/memory', { Origin: 'https://evil.example' });
    check('恶意 Origin 403', r.status === 403, 'status=' + r.status);

    r = await rawReq(base + '/api/memory', { Origin: 'http://127.0.0.1:62252', 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'cors' });
    check('本机回环 Origin 200 + ACAO', r.status === 200 && r.headers['access-control-allow-origin'] === 'http://127.0.0.1:62252', 'status=' + r.status);

    r = await rawReq(base + '/', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' });
    check('iframe 导航 200（不拦页面）', r.status === 200, 'status=' + r.status);

    r = await req(base + '/api/token');
    j = JSON.parse(r.text || '{}');
    check('默认 /api/token 为空（未启用 token）', r.status === 200 && j.token === '', String(j.token));

    r = await req(base + '/api/chat/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    check('POST /api/chat/cancel 200', r.status === 200, 'status=' + r.status);

    r = await req(base + '/api/backup/list');
    check('GET /api/backup/list 200', r.status === 200, 'status=' + r.status);

    r = await req(base + '/api/economy');
    j = JSON.parse(r.text || '{}');
    check('GET /api/economy 200（不阻塞）', r.status === 200 && !!j.wallet, 'status=' + r.status);
  } finally { stopServer(plain); }

  // ---------- token + 加密密钥实例 ----------
  const sec = startServer('secure', { DSH_COMPANION_API_TOKEN: 'smoke-token-123', DSH_COMPANION_ENCRYPT_KEYS: '1' }, 18800);
  try {
    await waitReady(sec);
    const base = 'http://127.0.0.1:' + sec.port;
    const hdr = { 'x-companion-token': 'smoke-token-123' };

    let r = await req(base + '/api/status');
    check('token 模式：无 token 401', r.status === 401, 'status=' + r.status);

    r = await req(base + '/api/token');
    let j = JSON.parse(r.text || '{}');
    check('token 模式：/api/token 可读', r.status === 200 && j.token === 'smoke-token-123', String(j.token));

    r = await req(base + '/api/status', { headers: hdr });
    check('token 模式：带 header 200', r.status === 200, 'status=' + r.status);

    r = await req(base + '/');
    check('token 模式：页面下发 cookie', r.status === 200 && /companion_token=/.test(r.headers.get('set-cookie') || ''), String(r.headers.get('set-cookie') || '').slice(0, 60));

    r = await req(base + '/api/model/key', {
      method: 'POST',
      headers: { ...hdr, 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'sk-smoke-中文-1234567890' }),
    });
    check('token 模式：保存 Key 200', r.status === 200, 'status=' + r.status);
    const keyFile = path.join(sec.root, 'api-key.txt');
    const stored = fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '';
    check('ENCRYPT_KEYS：key 文件是 DPAPI1 密文', stored.startsWith('DPAPI1:'), stored.slice(0, 12) + '... len=' + stored.length);

    r = await req(base + '/api/image/config', { headers: hdr });
    check('token 模式：/api/image/config 200', r.status === 200, 'status=' + r.status);
  } finally { stopServer(sec); }
} catch (e) {
  check('smoke 运行异常', false, e && e.message);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
}

const failed = results.filter((x) => !x.ok);
console.log('');
console.log('结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
if (failed.length) {
  console.log('失败项：' + failed.map((x) => x.name).join('、'));
  process.exitCode = 1;
}
