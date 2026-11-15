// 冒烟测试：起一个隔离的运行时实例（临时数据根/临时 HOME/随机端口），跑接口与安全矩阵。
// 用法：npm run smoke    （不需要真实数据，不影响正在运行的实例）
import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
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
  // ---------- 原生客户端产物静态检查（M01/N01，不需要起服务）----------
  const clientFile = path.join(pluginRoot, 'lib', 'client.js');
  const clientCode = fs.existsSync(clientFile) ? fs.readFileSync(clientFile, 'utf8') : '';
  check('lib/client.js 存在且是原生构建产物', clientCode.length > 20000 && clientCode.includes('自动生成，不要直接改') && clientCode.includes('__ModuleLoader__'), 'len=' + clientCode.length);
  check('原生客户端不含 iframe（N01）', !/<iframe/i.test(clientCode) && !/createElement\(\s*['"]iframe['"]\s*\)/i.test(clientCode));
  check('原生客户端不请求任何 HTML 页面', !/['"]\/(?:map|settings|stage|model|screen)\.html['"]/.test(clientCode), '');
  // ---------- 0.8.6 修复项的静态回归（改动容易回退，所以每次冒烟都盯一遍）----------
  check('F-001 Toggle 不再传 value（否则开关永远是关）', !/h\(Toggle,\s*\{\s*value:/.test(clientCode), '');
  check('F-001 直连四个开关用 checked', /h\(Toggle, \{ checked: !!s\.enabled/.test(clientCode) && /h\(Toggle, \{ checked: s\.autoReply !== false/.test(clientCode) && /h\(Toggle, \{ checked: s\.sendImages !== false/.test(clientCode) && /h\(Toggle, \{ checked: s\.fallbackVm !== false/.test(clientCode), '');
  check('F-018 未连接时禁用「发测试消息」', /disabled: !!busy \|\| !connected/.test(clientCode) && clientCode.indexOf('还没连上 OneBot：先启动自建桥并点「测试连接」') >= 0, '');
  check('F-013 底部「■ 停止」只在播放时出现', clientCode.indexOf('useVoicePlaying') >= 0 && /voice\.settings\.enabled && voicePlaying/.test(clientCode), '');
  check('F-005 内嵌 noVNC 用 contain（view_clip=0）', /const SCREEN_EMBED_PARAMS = '[^']*view_clip=0/.test(clientCode), '');
  check('F-014 生活页首屏有骨架', clientCode.indexOf('SkeletonRows') >= 0 && clientCode.indexOf('正在读她现在在做什么') >= 0, '');
  check('F-016 角色卡带可选头像', clientCode.indexOf('stgCoreAvatarToSmallDataUrl') >= 0 && /payload\.avatar/.test(clientCode), '');
  check('F-022 日记有日期选择器 + 前后日', /type: 'date'/.test(clientCode) && clientCode.indexOf('settingsDataShiftDate') >= 0 && clientCode.indexOf('这一天没有日记') >= 0, '');
  check('F-020 恢复前有差异预览', clientCode.indexOf('/api/backup/inspect') >= 0 && /恢复前先看差异/.test(clientCode), '');
  check('F-021 记忆导入有预览与规则', clientCode.indexOf('/api/memory/import/preview') >= 0 && /拆句规则/.test(clientCode), '');
  check('F-009 安装方式/版本比较按真实情况显示', clientCode.indexOf('sbcInstallKindLabel') >= 0 && clientCode.indexOf('cmpSbcVersion') >= 0 && clientCode.indexOf('本地版比 npm 新') >= 0, '');
  check('F-008 地点名牌做避让', clientCode.indexOf('visibleLabels') >= 0, '');
  check('F-004 3D 角色用立绘/名牌抬到头顶', clientCode.indexOf('character.standee') >= 0 || clientCode.indexOf('const standee') >= 0, '');
  check('F-003 3D 有天空穹顶与远海', clientCode.indexOf('skyDome') >= 0 && clientCode.indexOf('seaPlane') >= 0 && clientCode.indexOf('fitDistanceForIsland') >= 0, '');
  const archDoc = path.join(pluginRoot, 'docs', 'NATIVE-CLIENT-ARCH.md');
  check('架构契约文档存在', fs.existsSync(archDoc), archDoc);
  for (const f of ['00-core/api.js', '00-core/ui.js', '10-chat/chat.js', '20-stage/stage.js', '20-stage/map.js', '30-settings/settings.js', '40-screen/screen.js', '50-app/app.js']) {
    const p = path.join(pluginRoot, 'src', 'client', f);
    check('源码文件存在：' + f, fs.existsSync(p) && fs.statSync(p).size > 200, '');
  }

  // ---------- 契约一致性（M-405）：文档数字 / 索引计数 / 端点是否真存在 ----------
  // 以前这三处可以各说各的：文档标题写 128 个 / 13 组，api-index 却是 141 / 14，
  // 新增端点也没进索引。手机端只按文档实现，这里必须有机器保证。
  {
    const idxPath = path.join(pluginRoot, 'docs', 'schema', 'api-index.json');
    const modelsPath = path.join(pluginRoot, 'docs', 'schema', 'models.json');
    const contractPath = path.join(pluginRoot, 'docs', 'API-CONTRACT.md');
    const serverSrc = fs.readFileSync(path.join(pluginRoot, 'runtime', 'server.mjs'), 'utf8');
    // 网关（mobile-gate.mjs）也有自己的端点，一并算进「源码里有」的范围
    let runtimeAllSrc = serverSrc;
    try {
      for (const f of fs.readdirSync(path.join(pluginRoot, 'runtime'))) {
        if (!f.endsWith('.mjs')) continue;
        if (f === 'server.mjs') continue;
        runtimeAllSrc += '\n' + fs.readFileSync(path.join(pluginRoot, 'runtime', f), 'utf8');
      }
    } catch {}
    let idx = null;
    let models = null;
    let contract = '';
    try { idx = JSON.parse(fs.readFileSync(idxPath, 'utf8')); } catch { idx = null; }
    try { models = JSON.parse(fs.readFileSync(modelsPath, 'utf8')); } catch { models = null; }
    try { contract = fs.readFileSync(contractPath, 'utf8'); } catch { contract = ''; }

    check('契约：api-index.json 能解析', !!idx && Array.isArray(idx.groups), '');
    const allEndpoints = idx && Array.isArray(idx.groups)
      ? idx.groups.reduce((acc, g) => acc.concat(Array.isArray(g.endpoints) ? g.endpoints : []), [])
      : [];
    const countedEndpoints = allEndpoints.length;
    const countedGroups = idx && Array.isArray(idx.groups) ? idx.groups.length : 0;
    check('契约：api-index totals 与实际条目数一致',
      !!idx && idx.totals && Number(idx.totals.endpoints) === countedEndpoints && Number(idx.totals.groups) === countedGroups,
      'totals=' + JSON.stringify(idx && idx.totals) + ' counted=' + countedEndpoints + '/' + countedGroups);

    const m = contract.match(/## 5\. 端点清单（(\d+) 个 \/ (\d+) 组）/);
    check('契约：API-CONTRACT §5 标题的端点/分组数与 api-index 一致',
      !!m && Number(m[1]) === countedEndpoints && Number(m[2]) === countedGroups,
      'doc=' + (m ? m[1] + '/' + m[2] : '标题没匹配上') + ' index=' + countedEndpoints + '/' + countedGroups);

    // 文档里记的每个端点，源码里必须真有这个路径字面量（防「文档写了、代码没有」）
    const missingInSrc = allEndpoints
      .filter((e) => e && typeof e.path === 'string' && e.path.indexOf('/api/') === 0)
      .filter((e) => runtimeAllSrc.indexOf("'" + e.path + "'") < 0)
      .map((e) => e.method + ' ' + e.path);
    check('契约：api-index 里每个端点都在 runtime/*.mjs 出现', missingInSrc.length === 0, missingInSrc.slice(0, 5).join(', '));

    // 反向：server.mjs 里的每个 /api 路由都必须进索引（防「代码写了、文档没有」——0.8.9 前漏了 11 个）
    const srcRoutes = new Set();
    for (const ln of serverSrc.split(/\r?\n/)) {
      const mm = ln.match(/url\.pathname\s*(?:===|\.startsWith\()\s*'(\/api\/[^']*)'/);
      if (!mm) continue;
      const p = mm[1];
      if (p === '/api/' || p.endsWith('/')) continue; // 前缀路由（如 startsWith 的家族）单独看
      srcRoutes.add(p);
    }
    const idxPaths = new Set(allEndpoints.filter((e) => e && typeof e.path === 'string').map((e) => e.path));
    const missingInIdx = [...srcRoutes].filter((p) => !idxPaths.has(p));
    check('契约：server.mjs 的每条 /api 路由都在 api-index 里', missingInIdx.length === 0, missingInIdx.slice(0, 6).join(', '));

    // 索引里的每个路径都要在 API-CONTRACT.md 里出现过（防「索引加了、人读的文档没写」）
    const contractDoc = contract;
    const missingInDoc = [...idxPaths].filter((p) => contractDoc.indexOf(p) < 0);
    check('契约：api-index 的每条路径都在 API-CONTRACT.md 出现', missingInDoc.length === 0, missingInDoc.slice(0, 6).join(', '));

    // 0.8.9 新增的两个端点必须两端都在（索引 + 文档）
    for (const p of ['/api/backup/inspect', '/api/memory/import/preview']) {
      const inIdx = allEndpoints.some((e) => e && e.path === p);
      check('契约：0.8.9 新端点已进索引 ' + p, inIdx && contract.indexOf(p) >= 0, 'index=' + inIdx + ' doc=' + (contract.indexOf(p) >= 0));
    }
    // /api/version 的 install 字段（0.8.9 新增）要写在文档和索引里
    check('契约：/api/version.install 已写进文档与索引',
      contract.indexOf('install') >= 0 && JSON.stringify((allEndpoints.find((e) => e && e.id === 'version.get') || {}).response || {}).indexOf('install') >= 0, '');

    check('契约：models.json 能解析', !!models && !!models.definitions, '');
    const stageChar = models && models.definitions && models.definitions.stagePayload
      ? models.definitions.stagePayload.properties.character.properties : null;
    check('契约：models.json 的 stagePayload.character 带 standee/hasPoses',
      !!stageChar && !!stageChar.standee && !!stageChar.hasPoses, '');
    check('契约：models.json 版本与 package.json 同步',
      !!models && String(models['x-runtime-version'] || '') === String(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8')).version || ''),
      'models=' + (models && models['x-runtime-version']));
  }

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

    // ---------- 冻结契约 /api/version（M22）----------
    r = await req(base + '/api/version');
    j = JSON.parse(r.text || '{}');
    check('GET /api/version 200 且 apiVersion=2', r.status === 200 && j.apiVersion === 2 && !!j.version, 'apiVersion=' + j.apiVersion + ' features=' + Object.keys(j.features || {}).length);
    check('/api/version 暴露 features 与 schema 路径', !!(j.features && j.features.chat === true && j.schema && j.schema.contract), JSON.stringify(j.features || {}).slice(0, 80));
    check('/api/version 标明旧网页状态', j.features && j.features.legacyWeb === false, 'legacyWeb=' + (j.features && j.features.legacyWeb));
    // F-009：能力标志不能再和关于页打架；安装方式也要如实
    check('F-009 /api/version 的 stage3d 与面板能力一致', !!(j.features && j.features.stage3d === true), 'stage3d=' + (j.features && j.features.stage3d));
    check('F-009 /api/version 带安装方式与旧网页码', !!(j.install && typeof j.install.kind === 'string' && j.install.legacyWebStatus === 410), JSON.stringify(j.install || {}));

    // ---------- F-021：记忆导入预览 / 行号 ----------
    const memImportText = '用户喜欢猫，讨厌狗。\n!!!\n用户最近在写作业。';
    r = await req(base + '/api/memory/import/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: memImportText, opts: { splitOnComma: true } }) });
    j = JSON.parse(r.text || '{}');
    check('F-021 预览给出条数/行数/前 5 条', r.status === 200 && j.ok === true && Number(j.total) >= 3 && Number(j.lineCount) === 3 && Array.isArray(j.preview) && j.preview.length > 0, 'total=' + j.total + ' lines=' + j.lineCount);
    check('F-021 预览标出解析不出内容的行号', Array.isArray(j.emptyLines) && j.emptyLines.indexOf(2) >= 0, JSON.stringify(j.emptyLines || []));
    // 拆句规则可配置：按逗号拆应该比只按句号拆出更多条
    const prevComma = Number(j.total) || 0;
    r = await req(base + '/api/memory/import/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: memImportText, opts: { splitOnComma: false } }) });
    j = JSON.parse(r.text || '{}');
    check('F-021 拆句规则可配置（逗号拆得更多）', Number(j.total) > 0 && Number(j.total) < prevComma, 'comma=' + prevComma + ' sentence=' + j.total);
    r = await req(base + '/api/memory/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '!!!\n???', opts: {} }) });
    j = JSON.parse(r.text || '{}');
    check('F-021 导入失败时带行号', r.status === 400 && Array.isArray(j.emptyLines) && j.emptyLines.length > 0, String(j.error || '').slice(0, 80));

    // ---------- F-022：日记按任意日期读 + 坏日期拒绝 ----------
    r = await req(base + '/api/diary?date=2020-01-02');
    j = JSON.parse(r.text || '{}');
    check('F-022 任意日期都能查（没有就是空）', r.status === 200 && j.date === '2020-01-02' && typeof j.text === 'string' && j.exists === false, 'exists=' + j.exists);
    r = await req(base + '/api/diary?date=../config');
    check('F-022 非法日期直接 400（不碰文件）', r.status === 400, 'status=' + r.status);

    // ---------- F-002/F-007：新角色有完整默认世界；删除角色清掉附属资产 ----------
    r = await req(base + '/api/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'new', name: '冒烟新角色' }) });
    j = JSON.parse(r.text || '{}');
    const newCharId = String(j.id || '');
    check('F-002 能新建角色', r.status === 200 && !!newCharId, newCharId);
    r = await req(base + '/api/map');
    j = JSON.parse(r.text || '{}');
    const newMap = j.map || {};
    const newPlaces = Array.isArray(newMap.places) ? newMap.places : [];
    check('F-007 新角色默认是完整 13 地点地图', newPlaces.length >= 13, 'places=' + newPlaces.length);
    check('F-007 新角色默认带 2D 底图', !!(newMap.image && newMap.image.url), JSON.stringify(newMap.image || null));
    // 给这个角色造一份姿态素材（直接写文件，避免依赖导入接口的图片尺寸校验）
    if (newCharId) {
      const poseDir = path.join(pluginRoot, 'runtime', 'skeleton-assets', newCharId, 'poses');
      let made = false;
      try {
        fs.mkdirSync(poseDir, { recursive: true });
        fs.writeFileSync(path.join(poseDir, 'poses.json'), JSON.stringify({ canvas: [100, 200], baseY: 180, poses: { idle: { file: 'poses/idle.png' } } }), 'utf8');
        made = true;
      } catch { made = false; }
      r = await req(base + '/api/stage/poses');
      j = JSON.parse(r.text || '{}');
      const hasEntry = Array.isArray(j.characters) && j.characters.some((c) => c.id === newCharId);
      check('F-002 姿态接口能列出这个角色', r.status === 200 && (!made || hasEntry), 'made=' + made + ' entry=' + hasEntry);
      // 删除角色（它是当前角色，删完会切回别的角色）
      r = await req(base + '/api/characters', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete', id: newCharId }) });
      j = JSON.parse(r.text || '{}');
      check('F-002 删除角色返回清理结果', r.status === 200 && j.ok === true && Array.isArray(j.cleaned), 'cleaned=' + JSON.stringify(j.cleaned || []));
      check('F-002 删除后角色目录消失', !fs.existsSync(path.join(plain.root, 'data', 'characters', newCharId)), newCharId);
      check('F-002 删除后姿态目录消失', !fs.existsSync(poseDir), poseDir ? 'gone' : 'n/a');
      r = await req(base + '/api/stage/poses');
      j = JSON.parse(r.text || '{}');
      const ghost = Array.isArray(j.characters) && j.characters.some((c) => c.id === newCharId);
      check('F-002 /api/stage/poses 不再返回 ghost 条目', r.status === 200 && !ghost, 'ghost=' + ghost);
    }

    // ---------- F-020：备份创建后能被列出 + 恢复前差异预览 ----------
    r = await req(base + '/api/backup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) });
    j = JSON.parse(r.text || '{}');
    const madeBackup = String(j.name || '');
    check('F-020 备份接口回报新建的备份名', r.status === 200 && /^backup-\d{8}-\d{6}$/.test(madeBackup), madeBackup || String(j.message || '').slice(0, 60));
    if (madeBackup) {
      r = await req(base + '/api/backup/list');
      j = JSON.parse(r.text || '{}');
      check('F-020 新备份立刻出现在列表里', Array.isArray(j.backups) && j.backups.some((b) => String(b.name).indexOf(madeBackup) === 0), 'count=' + ((j.backups || []).length));
      r = await req(base + '/api/backup/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: madeBackup + '.zip' }) });
      j = JSON.parse(r.text || '{}');
      check('F-020 恢复前能拿到差异预览', r.status === 200 && j.ok === true && !!j.backup && !!j.current && Array.isArray(j.onlyInBackup), 'files=' + ((j.backup || {}).fileCount));
    }
    r = await req(base + '/api/backup/inspect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '../config.json' }) });
    check('F-020 inspect 拒绝非法备份名', r.status === 400, 'status=' + r.status);

    // ---------- 手机门（0.8.10）：默认关 / TLS / 配对 / 权限 / 撤销 / 审计 ----------
    {
      const gatePort = plain.port + 45;
      const gateReq = (p, opts) => new Promise((resolve) => {
        const o = opts || {};
        const rq = https.request({
          host: '127.0.0.1', port: gatePort, path: p, method: o.method || 'GET',
          headers: o.headers || {}, rejectUnauthorized: false, timeout: 15000,
        }, (rs) => {
          let cert = null;
          try { cert = rs.socket && rs.socket.getPeerCertificate ? rs.socket.getPeerCertificate() : null } catch (e) {}
          let data = '';
          rs.on('data', (c) => { data += c; });
          rs.on('end', () => {
            let jj = null;
            try { jj = JSON.parse(data); } catch (e) {}
            resolve({ status: rs.statusCode, headers: rs.headers, j: jj, text: data, cert });
          });
        });
        rq.on('error', (e) => resolve({ status: 0, error: e.message }));
        if (o.body) rq.write(o.body);
        rq.end();
      });

      r = await req(base + '/api/version');
      j = JSON.parse(r.text || '{}');
      check('手机门：/api/version 带 mobileGate 且默认关闭', !!(j.mobileGate && j.mobileGate.enabled === false && j.mobileGate.tls === true), JSON.stringify(j.mobileGate || null));

      r = await req(base + '/api/mobile-gate/status');
      j = JSON.parse(r.text || '{}');
      const gateFp = String(j.fingerprint || '');
      check('手机门：status 有证书指纹且默认未启用', r.status === 200 && /^([0-9A-F]{2}:){15,}[0-9A-F]{2}$/.test(gateFp) && j.enabled === false, gateFp.slice(0, 23) + '…');

      r = await req(base + '/api/mobile-gate/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, port: gatePort }) });
      j = JSON.parse(r.text || '{}');
      check('手机门：可以开启 HTTPS 监听', r.status === 200 && j.ok === true && Number(j.port) === gatePort, 'port=' + (j.port || r.status));

      r = await req(base + '/api/mobile-gate/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, tls: false }) });
      check('手机门：拒绝明文（tls:false → 400）', r.status === 400 && /TLS/.test(r.text), 'status=' + r.status);

      let g = await gateReq('/api/version');
      check('手机门：网关 TLS 可达（公开读 /api/version）', g.status === 200 && !!(g.j && g.j.ok), 'status=' + g.status);
      const peerFp = g.cert && g.cert.fingerprint256;
      check('手机门：网关证书指纹与 status 一致', !!peerFp && String(peerFp).toUpperCase() === gateFp.toUpperCase(), String(peerFp || '').slice(0, 23));

      // 手机网页版（0.8.11）：网关直接提供静态页，公开但限流；页面里不含任何令牌
      let pw = await gateReq('/');
      check('手机页 / 可打开（HTML + CSP + 禁嵌入）',
        pw.status === 200 &&
        /text\/html/.test(String(pw.headers && pw.headers['content-type'])) &&
        /default-src 'self'/.test(String(pw.headers && pw.headers['content-security-policy'])) &&
        String(pw.headers && pw.headers['x-frame-options']) === 'DENY',
        'status=' + pw.status);
      check('手机页明确标着「正在研究」', String(pw.text || '').indexOf('正在研究') >= 0 && String(pw.text || '').indexOf('内部测试版') >= 0, '');
      check('手机页不含令牌', String(pw.text || '').indexOf('Bearer') < 0, '');
      pw = await gateReq('/app.css');
      check('/app.css 可打开', pw.status === 200 && /text\/css/.test(String(pw.headers && pw.headers['content-type'])), 'len=' + String(pw.text || '').length);
      pw = await gateReq('/app.js');
      check('/app.js 可打开且调用配对接口', pw.status === 200 && String(pw.text || '').indexOf('/api/mobile-gate/pair') >= 0, 'len=' + String(pw.text || '').length);

      g = await gateReq('/api/status');
      check('手机门：未配对读业务接口 → 401', g.status === 401, 'status=' + g.status);

      r = await req(base + '/api/mobile-gate/pair-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      j = JSON.parse(r.text || '{}');
      const pairCode = String(j.code || '');
      check('手机门：面板能生成 6 位配对码', r.status === 200 && /^\d{6}$/.test(pairCode), pairCode);

      g = await gateReq('/api/mobile-gate/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairCode, deviceName: '冒烟手机' }) });
      const devToken = String(g.j && g.j.token || '');
      check('手机门：配对码换到设备令牌', g.status === 200 && !!devToken && !!(g.j && g.j.deviceId), 'status=' + g.status);
      g = await gateReq('/api/mobile-gate/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairCode, deviceName: '再来一台' }) });
      check('手机门：同一配对码不能用第二次', g.status === 401, 'status=' + g.status);

      const ah = { authorization: 'Bearer ' + devToken };
      g = await gateReq('/api/status', { headers: ah });
      check('手机门：已配对设备能读 /api/status', g.status === 200, 'status=' + g.status);
      g = await gateReq('/api/stage', { headers: ah });
      check('手机门：已配对设备能读 /api/stage', g.status === 200, 'status=' + g.status);
      g = await gateReq('/api/model', { headers: ah });
      check('手机门：手机没有设置权限 → 403', g.status === 403, 'status=' + g.status);
      g = await gateReq('/api/screen/info', { headers: ah });
      check('手机门：手机不能看屏幕接口 → 403', g.status === 403, 'status=' + g.status);

      r = await req(base + '/api/mobile-gate/audit?limit=100');
      j = JSON.parse(r.text || '{}');
      const auditTypes = new Set(((j.entries || []).map((x) => x && x.type)));
      check('手机门：审计记了配对/失败/越权且无明文令牌',
        auditTypes.has('pair.ok') && auditTypes.has('auth.fail') && auditTypes.has('perm.deny') && !JSON.stringify(j.entries || []).includes(devToken),
        [...auditTypes].join(',').slice(0, 90));

      r = await req(base + '/api/mobile-gate/devices');
      j = JSON.parse(r.text || '{}');
      const dev0 = (j.devices || [])[0];
      check('手机门：能列出已配对设备', r.status === 200 && !!dev0 && Number(dev0.lastSeenAt) > 0, (dev0 && dev0.name) || 'none');

      r = await req(base + '/api/mobile-gate/revoke', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: dev0 && dev0.id }) });
      check('手机门：撤销设备 200', r.status === 200 && JSON.parse(r.text || '{}').ok === true, '');
      g = await gateReq('/api/status', { headers: ah });
      check('手机门：撤销后旧令牌立刻 401', g.status === 401, 'status=' + g.status);

      r = await req(base + '/api/mobile-gate/enable', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      check('手机门：可以关闭', r.status === 200 && JSON.parse(r.text || '{}').enabled === false, '');
      g = await gateReq('/api/version');
      check('手机门：关闭后端口不再应答', g.status === 0 || g.status >= 500, 'status=' + g.status);
      try {
        const cfg = JSON.parse(fs.readFileSync(path.join(plain.root, 'config.json'), 'utf8'));
        check('手机门：开关状态写回 config.mobileGate', !!(cfg.mobileGate && cfg.mobileGate.enabled === false), JSON.stringify(cfg.mobileGate || null));
      } catch (e) { check('手机门：开关状态写回 config.mobileGate', false, e && e.message); }
    }

    // ---------- 旧网页默认下线（S02/S06/D08/M27）----------
    r = await req(base + '/');
    check('GET / 默认 410（网页入口已下线）', r.status === 410 && /网页入口已下线/.test(r.text), 'status=' + r.status);
    for (const page of ['/map', '/settings', '/model', '/stage', '/screen']) {
      r = await req(base + page);
      check('GET ' + page + ' 默认 410', r.status === 410, 'status=' + r.status + ' len=' + r.text.length);
    }

    // 业务 API 不受旧网页下线影响（S03）
    r = await req(base + '/api/memory');
    check('旧网页下线后 /api/memory 仍 200', r.status === 200, 'status=' + r.status);

    // ---------- 面板配色（0.8.2）：契约 + 非法值拒绝 ----------
    r = await req(base + '/api/panel-theme');
    j = JSON.parse(r.text || '{}');
    check('GET /api/panel-theme 200', r.status === 200 && j.ok === true && !!j.current && Array.isArray(j.accents), 'mode=' + ((j.current || {}).mode) + ' accent=' + ((j.current || {}).accent));
    r = await req(base + '/api/panel-theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'light' }) });
    j = JSON.parse(r.text || '{}');
    check('POST /api/panel-theme 切浅色', r.status === 200 && j.ok === true && (j.current || {}).mode === 'light', JSON.stringify(j.current || {}));
    r = await req(base + '/api/panel-theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'nope' }) });
    check('POST /api/panel-theme 拒绝非法模式 400', r.status === 400, 'status=' + r.status);
    r = await req(base + '/api/panel-theme', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accent: 'rose' }) });
    j = JSON.parse(r.text || '{}');
    check('POST /api/panel-theme 只改强调色不丢模式', r.status === 200 && (j.current || {}).accent === 'rose' && (j.current || {}).mode === 'light', JSON.stringify(j.current || {}));

    // ---------- 语音（0.8.3）：装上就有一个能用的声音 ----------
    r = await req(base + '/api/voice/settings');
    j = JSON.parse(r.text || '{}');
    check('GET /api/voice/settings 200', r.status === 200 && j.ok === true && !!j.settings && Array.isArray(j.providers), 'provider=' + ((j.settings || {}).provider) + ' providers=' + ((j.providers || []).length));
    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, provider: 'sapi' }) });
    j = JSON.parse(r.text || '{}');
    check('POST /api/voice/settings 打开语音', r.status === 200 && (j.settings || {}).enabled === true, 'enabled=' + ((j.settings || {}).enabled));
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '语音冒烟测试，这句应该能听见。' }) });
    j = JSON.parse(r.text || '{}');
    const audioPath = j.ok ? String(j.audio || '') : '';
    check('POST /api/voice/tts 合成成功', r.status === 200 && j.ok === true && /^\/voice\/audio\/[a-f0-9]{40}\.(wav|mp3)$/.test(audioPath), audioPath + ' ' + (j.error || ''));
    if (audioPath) {
      r = await req(base + audioPath);
      check('GET /voice/audio/<file> 返回音频', r.status === 200 && /audio\//.test(String(r.headers.get('content-type') || '')) && r.text.length > 100, 'status=' + r.status + ' type=' + (r.headers.get('content-type') || ''));
    }
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '语音冒烟测试，这句应该能听见。' }) });
    j = JSON.parse(r.text || '{}');
    check('同一句命中语音缓存', j.ok === true && j.cached === true, 'cached=' + j.cached);
    r = await req(base + '/voice/audio/..%2f..%2fconfig.json');
    check('音频地址不允许目录穿越', r.status === 404 || r.status === 400, 'status=' + r.status);

    // http provider（「交给用户」的那个口子）：起一个假 TTS 服务，验约定 + 落盘
    let mockTtsBody = null;
    const mockTts = http.createServer((mreq, mres) => {
      let body = '';
      mreq.on('data', (c) => { body += c; });
      mreq.on('end', () => {
        try { mockTtsBody = JSON.parse(body); } catch (e) { mockTtsBody = null; }
        mres.writeHead(200, { 'content-type': 'audio/wav' });
        mres.end(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(600, 7)]));
      });
    });
    await new Promise((resolve) => mockTts.listen(0, '127.0.0.1', resolve));
    const mockPort = mockTts.address().port;
    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'http', endpoint: 'http://127.0.0.1:' + mockPort + '/tts' }) });
    check('语音可切到 http provider', r.status === 200 && (JSON.parse(r.text || '{}').settings || {}).provider === 'http', 'endpoint=127.0.0.1:' + mockPort);
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'http 口子测试' }) });
    j = JSON.parse(r.text || '{}');
    check('http provider 按约定发请求', r.status === 200 && j.ok === true && !!mockTtsBody && mockTtsBody.text === 'http 口子测试' && 'voice' in mockTtsBody && 'speed' in mockTtsBody, JSON.stringify(mockTtsBody || {}).slice(0, 120));
    check('http provider 音频落盘', j.ok === true && /^\/voice\/audio\/[a-f0-9]{40}\.wav$/.test(String(j.audio || '')), String(j.audio || j.error || ''));
    mockTts.close();
    // openai 兼容 /audio/speech（OpenAI / SiliconFlow 等）：mock 一个，验 URL / Bearer / body.input
    let oaSeen = { url: '', auth: '', body: null };
    const oaTts = http.createServer((mreq, mres) => {
      const cs = [];
      mreq.on('data', (c) => cs.push(c));
      mreq.on('end', () => {
        oaSeen.url = String(mreq.url || '');
        oaSeen.auth = String(mreq.headers.authorization || '');
        try { oaSeen.body = JSON.parse(Buffer.concat(cs).toString('utf8')) } catch (e) { oaSeen.body = null }
        mres.writeHead(200, { 'content-type': 'audio/mpeg' });
        mres.end(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(600, 5)]));
      });
    });
    await new Promise((r2) => oaTts.listen(0, '127.0.0.1', r2));
    const oaTtsPort = oaTts.address().port;
    const ttsKeyFile = path.join(tmpRoot, 'tts-key.txt');
    fs.writeFileSync(ttsKeyFile, 'sk-tts-1', 'utf8');
    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openai', endpoint: 'http://127.0.0.1:' + oaTtsPort + '/v1', model: 'tts-1', voice: 'alloy', apiKeyRef: 'file:' + ttsKeyFile }) });
    check('语音切到 openai provider', r.status === 200 && (JSON.parse(r.text || '{}').settings || {}).provider === 'openai', 'endpoint=127.0.0.1:' + oaTtsPort);
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'openai 口子测试一句' }) });
    j = JSON.parse(r.text || '{}');
    check('openai 语音走 /audio/speech', r.status === 200 && j.ok === true && /\/v1\/audio\/speech$/.test(oaSeen.url) && oaSeen.auth === 'Bearer sk-tts-1'
      && !!oaSeen.body && oaSeen.body.input === 'openai 口子测试一句' && oaSeen.body.voice === 'alloy', 'url=' + oaSeen.url + ' auth=' + oaSeen.auth.slice(0, 12));
    oaTts.close();

    // 火山引擎 · 豆包语音（新版 v3）：mock 模拟多行 JSON，每行 data 是 base64 音频
    let volcSeen = { key: '', appId: '', resource: '', body: null };
    const volcSrv = http.createServer((mreq, mres) => {
      const cs = [];
      mreq.on('data', (c) => cs.push(c));
      mreq.on('end', () => {
        volcSeen.key = String(mreq.headers['x-api-key'] || '');
        volcSeen.appId = String(mreq.headers['x-api-app-id'] || '');
        volcSeen.resource = String(mreq.headers['x-api-resource-id'] || '');
        try { volcSeen.body = JSON.parse(Buffer.concat(cs).toString('utf8')) } catch (e) { volcSeen.body = null }
        const audio = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(800, 7)]).toString('base64');
        mres.writeHead(200, { 'content-type': 'text/plain' });
        // 分两行返回，验证「多行 JSON 拼接」
        mres.end(JSON.stringify({ code: 0, message: '', data: audio.slice(0, 100) }) + '\n'
          + JSON.stringify({ code: 0, message: '', data: audio.slice(100) }) + '\n'
          + JSON.stringify({ code: 20000000, message: 'ok' }) + '\n');
      });
    });
    await new Promise((r2) => volcSrv.listen(0, '127.0.0.1', r2));
    const volcPort = volcSrv.address().port;
    fs.writeFileSync(ttsKeyFile, 'volc-key-1', 'utf8');
    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'volc', endpoint: 'http://127.0.0.1:' + volcPort + '/api/v3/tts/unidirectional', appId: '1234567890', resourceId: 'seed-tts-2.0', voice: 'zh_female_test_uranus_bigtts', apiKeyRef: 'file:' + ttsKeyFile }) });
    j = JSON.parse(r.text || '{}');
    check('语音切到 volc provider', r.status === 200 && (j.settings || {}).provider === 'volc' && (j.settings || {}).appId === '1234567890', JSON.stringify(j.settings || {}).slice(0, 140));
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '火山口子测试一句' }) });
    j = JSON.parse(r.text || '{}');
    check('火山语音走 v3 协议（多行 base64 拼接）', r.status === 200 && j.ok === true
      && volcSeen.key === 'volc-key-1' && volcSeen.appId === '1234567890' && volcSeen.resource === 'seed-tts-2.0'
      && !!volcSeen.body && volcSeen.body.req_params.text === '火山口子测试一句'
      && volcSeen.body.req_params.speaker === 'zh_female_test_uranus_bigtts'
      && volcSeen.body.req_params.audio_params.format === 'mp3',
      'key=' + volcSeen.key.slice(0, 8) + ' res=' + volcSeen.resource + ' ' + (j.error || ''));
    volcSrv.close();

    // 云端 provider 没配好时应该自动回退 Windows 语音，而不是整条哑掉
    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'volc', appId: '', resourceId: 'seed-tts-2.0', voice: '', apiKeyRef: '' }) });
    r = await req(base + '/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '回退测试一句' }) });
    j = JSON.parse(r.text || '{}');
    check('云端没配 Key 时自动回退 Windows 语音', r.status === 200 && j.ok === true && j.provider === 'sapi' && j.fallbackFrom === 'volc', 'provider=' + j.provider + ' from=' + (j.fallbackFrom || '-'));

    r = await req(base + '/api/voice/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'sapi' }) });
    r = await req(base + '/api/events?since=0&voiceSince=0');
    j = JSON.parse(r.text || '{}');
    check('/api/events 带语音增量字段', Array.isArray(j.voiceUpdates) && typeof j.voiceRev === 'number', 'voiceRev=' + j.voiceRev + ' updates=' + (Array.isArray(j.voiceUpdates) ? j.voiceUpdates.length : 'n/a'));

    // ---------- 主动看屏幕语音（0.8.6）：子开关 + 安静时段 ----------
    r = await req(base + '/api/watch-screen');
    j = JSON.parse(r.text || '{}');
    check('GET /api/watch-screen 带子开关与状态', r.status === 200 && j.ok === true && typeof (j.watch || {}).voice === 'boolean' && typeof j.autoVoiceActive === 'boolean' && !!j.debug, 'voice=' + ((j.watch || {}).voice) + ' autoVoice=' + j.autoVoiceActive);
    r = await req(base + '/api/watch-screen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice: true, quietStart: 1, quietEnd: 6, minMinutes: 10, maxMinutes: 20 }) });
    j = JSON.parse(r.text || '{}');
    check('POST /api/watch-screen 保存子开关/安静时段', r.status === 200 && j.watch.voice === true && j.watch.quietStart === 1 && j.watch.quietEnd === 6 && j.watch.minMinutes === 10, JSON.stringify(j.watch || {}).slice(0, 150));

  } finally { stopServer(plain); }

  // ---------- 旧网页调试开关（DSH_COMPANION_LEGACY_WEB=1）----------
  const legacy = startServer('legacy', { DSH_COMPANION_LEGACY_WEB: '1' }, 18900);
  try {
    await waitReady(legacy);
    const base = 'http://127.0.0.1:' + legacy.port;
    let r = await req(base + '/');
    check('LEGACY_WEB=1：旧聊天页仍可打开（仅调试）', r.status === 200 && r.text.includes('<!doctype html>'), 'len=' + r.text.length);
    for (const page of ['/map', '/settings', '/stage']) {
      r = await req(base + page);
      check('LEGACY_WEB=1：' + page + ' 可打开', r.status === 200 && r.text.length > 5000, 'len=' + r.text.length);
    }
    r = await req(base + '/api/version');
    let j = JSON.parse(r.text || '{}');
    check('LEGACY_WEB=1：/api/version features.legacyWeb=true', !!(j.features && j.features.legacyWeb === true), 'legacyWeb=' + (j.features && j.features.legacyWeb));
  } finally { stopServer(legacy); }

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

    r = await req(base + '/api/version');
    check('token 模式：/api/version 无 token 401', r.status === 401, 'status=' + r.status);

    r = await req(base + '/');
    check('token 模式：旧网页也 410（不再下发 cookie）', r.status === 410 && !r.headers.get('set-cookie'), 'status=' + r.status);

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
