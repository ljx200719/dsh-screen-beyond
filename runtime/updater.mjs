/**
 * 插件自动更新（检查 + 执行）
 *
 * 设计边界（用户要求「插件自动更新」）：
 *   · 自动更新**只处理 git 检出**：apply() 只用固定 argv `git pull --ff-only`（cwd = pluginRoot），
 *     从不拼接 shell 字符串，也不执行任何用户输入；
 *   · npm 安装 / DSH 插件管理器安装 / link 安装：只返回 manual 提示，**绝不擅自改用户 profile**、
 *     不替用户跑 `npm i`（那是插件管理器的事）；
 *   · 本模块只负责「检查 + 执行」，不负责重启运行时、不负责 UI：apply 成功后由调用方
 *     （runtime/server.mjs）决定什么时候退出、让宿主用新代码重启；
 *   · check 结果缓存 15 分钟；force 跳过缓存，但同一时刻只允许一个在飞请求；
 *   · check/apply 全链路 try/catch，不向调用方抛异常；失败都给中文 error/message；
 *   · 日志只打版本号/仓库状态，不含任何密钥（这里也没有密钥）。
 *
 * 契约（server.mjs 按这个接 /api/update/*）：
 *   const up = createUpdater({ pluginRoot, version, log?, npmRegistry?, runner?, settings? });
 *   await up.check(force) -> { ok, current, latest, updateAvailable, source, installKind,
 *                              gitRepo, gitDirty, error?, checkedAt }
 *   await up.apply()      -> { ok, method, message, changed, needRestart, error? }
 *   up.cfg()              -> { autoCheck, autoApply, allowPrerelease, lastCheckAt, lastResult, update }
 *   up.setSettings(partial) -> cfg()
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PKG_NAME = 'dsh-screen-beyond';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const CHECK_CACHE_MS = 15 * 60 * 1000; // check 结果缓存 15 分钟
const FETCH_TIMEOUT_MS = 10 * 1000; // 连 npm registry 超时
const GIT_STATUS_TIMEOUT_MS = 2500; // git status 超时（失败只记 null，不致命）
const GIT_PULL_TIMEOUT_MS = 60 * 1000; // git pull 超时

// ---------- 纯函数小工具 ----------

function timeoutSignal(ms) {
  try {
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  } catch {}
  try {
    const ctl = new AbortController();
    setTimeout(() => { try { ctl.abort(); } catch {} }, ms);
    return ctl.signal;
  } catch {
    return undefined;
  }
}

function isTimeoutError(e) {
  if (!e) return false;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  return /abort|timed?\s*out|timeout/i.test(String(e.message || ''));
}

/** 'v0.7.24' / '0.7.24-beta.1' / '0.7.24+build' → { nums:[0,7,24], pre:'beta.1' } */
function parseVersion(v) {
  const raw = String(v === undefined || v === null ? '' : v).trim();
  if (!raw) return null;
  const text = raw.replace(/^[vV]/, '').split('+')[0]; // 不参与比较的 build metadata
  const dash = text.indexOf('-');
  const corePart = dash >= 0 ? text.slice(0, dash) : text;
  const pre = dash >= 0 ? text.slice(dash + 1) : '';
  const nums = corePart.split('.').map((x) => {
    const n = parseInt(x, 10);
    return Number.isFinite(n) ? n : 0;
  });
  if (!nums.length) return null;
  return { nums, pre };
}

/**
 * 语义化版本比较：核心数字段逐段比；release 高于同核心的预发布；
 * 两个预发布后缀按字符串比较（契约要求）。返回 -1 / 0 / 1。
 */
function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const x = pa.nums[i] || 0;
    const y = pb.nums[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  if (pa.pre && !pb.pre) return -1; // 0.7.24-beta.1 < 0.7.24
  if (!pa.pre && pb.pre) return 1; // 0.7.24 > 0.7.24-beta.1
  if (pa.pre && pb.pre) {
    if (pa.pre === pb.pre) return 0;
    return pa.pre > pb.pre ? 1 : -1; // 后缀按字符串比较
  }
  return 0;
}

/** 读 package.json 的 version（读不到返回 ''） */
function readPkgVersion(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, '');
    const pkg = JSON.parse(text);
    return String((pkg && pkg.version) || '').trim();
  } catch {
    return '';
  }
}

/**
 * installKind：
 *   · pluginRoot 在某个 node_modules 里、且本身是符号链接/junction → 'link'
 *   · 否则有 package.json → 'npm'
 *   · 否则 → 'unknown'
 */
function detectInstallKind(root) {
  const abs = path.resolve(String(root || '.'));
  let link = false;
  try {
    link = fs.lstatSync(abs).isSymbolicLink();
  } catch {}
  if (!link) {
    try { link = path.resolve(fs.realpathSync(abs)) !== abs; } catch {}
  }
  const inNodeModules = abs.split(/[\\/]+/).indexOf('node_modules') >= 0;
  if (inNodeModules && link) return 'link';
  try {
    if (fs.statSync(path.join(abs, 'package.json')).isFile()) return 'npm';
  } catch {}
  return 'unknown';
}

/** registry 基地址：env 覆盖 > opts.npmRegistry > 官方 registry；去掉末尾斜杠 */
function registryBase(npmRegistry) {
  const fromEnv = String(process.env.DSH_COMPANION_NPM_REGISTRY || '').trim();
  const raw = fromEnv || String(npmRegistry || '').trim() || DEFAULT_REGISTRY;
  return raw.replace(/\/+$/, '');
}

function cloneObject(v) {
  return v && typeof v === 'object' ? Object.assign({}, v) : null;
}

/** 默认 runner：execFile + 固定 argv（超时被杀按 124 返回） */
function defaultRunner(file, args, o) {
  const opt = o || {};
  return new Promise((resolve) => {
    try {
      execFile(file, args, {
        cwd: opt.cwd,
        timeout: opt.timeout || 0,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      }, (err, stdout, stderr) => {
        let code = 0;
        if (err) {
          if (typeof err.code === 'number') code = err.code;
          else if (err.killed) code = 124;
          else code = 1;
        }
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String((e && e.message) || e) });
    }
  });
}

// ---------- 工厂 ----------

export function createUpdater(opts) {
  const options = opts && typeof opts === 'object' ? opts : {};
  const pluginRoot = path.resolve(String(options.pluginRoot || '.'));
  const currentVersion = String(options.version || '0.0.0').trim() || '0.0.0';
  const runner = typeof options.runner === 'function' ? options.runner : defaultRunner;
  const log = (m) => {
    try {
      if (typeof options.log === 'function') options.log(String(m));
    } catch {}
  };

  const init = options.settings && typeof options.settings === 'object' ? options.settings : {};
  const state = {
    autoCheck: init.autoCheck !== false,
    autoApply: init.autoApply === true,
    allowPrerelease: init.allowPrerelease === true,
    lastCheckAt: Number.isFinite(Number(init.lastCheckAt)) ? Number(init.lastCheckAt) : 0,
    lastResult: cloneObject(init.lastResult),
    update: cloneObject(init.update),
  };

  let cache = null; // { at:number, result:object }
  let checkInflight = null; // 同一时刻只允许一个在飞 check
  let applying = false; // apply 串行，避免同时 pull 两次

  // ---------- git ----------

  async function runGit(args, timeoutMs) {
    const runnerOpts = { cwd: pluginRoot, timeout: timeoutMs };
    try {
      const raw = await runner('git', args, runnerOpts);
      if (!raw || typeof raw !== 'object') {
        return { ok: false, code: -1, stdout: '', stderr: 'git runner 返回值不合法' };
      }
      const code = Number.isFinite(Number(raw.code)) ? Number(raw.code) : 0;
      return { ok: code === 0, code, stdout: String(raw.stdout || ''), stderr: String(raw.stderr || '') };
    } catch (e) {
      return { ok: false, code: -1, stdout: '', stderr: String((e && e.message) || e || 'git 执行失败') };
    }
  }

  /** 探测 .git 与工作区是否干净；git status 失败时 dirty 记 null（不致命） */
  async function inspectGit() {
    const gitDir = path.join(pluginRoot, '.git');
    let gitRepo = false;
    try {
      gitRepo = fs.existsSync(gitDir);
    } catch {
      gitRepo = false;
    }
    if (!gitRepo) return { gitRepo: false, gitDirty: null };
    const st = await runGit(['status', '--porcelain'], GIT_STATUS_TIMEOUT_MS);
    if (!st.ok) {
      log('[update] git status 失败：' + ((st.stderr || '').trim().slice(0, 200) || '未知错误'));
      return { gitRepo: true, gitDirty: null };
    }
    return { gitRepo: true, gitDirty: st.stdout.trim().length > 0 };
  }

  /** 更新前后对比：HEAD + package.json version（用来判断 pull 是否真的带来变化） */
  async function snapshotVersionState() {
    const head = await runGit(['rev-parse', 'HEAD'], GIT_STATUS_TIMEOUT_MS);
    return { head: head.ok ? head.stdout.trim() : '', pkgVersion: readPkgVersion(pluginRoot) };
  }

  function detectChanged(before, after, pullStdout) {
    const bh = (before && before.head) || '';
    const ah = (after && after.head) || '';
    if (bh && ah) return bh !== ah; // HEAD 变了 = 有新提交
    const bv = (before && before.pkgVersion) || '';
    const av = (after && after.pkgVersion) || '';
    if (bv && av && bv !== av) return true; // 版本文件变了也算
    const out = String(pullStdout || '').trim();
    if (!out) return false;
    if (/already up/i.test(out)) return false;
    return true; // git 说更新了东西
  }

  // ---------- registry ----------

  async function fetchLatestVersion() {
    const url = registryBase(options.npmRegistry) + '/' + PKG_NAME + '/latest';
    if (typeof fetch !== 'function') throw new Error('检查更新失败：当前运行时不支持 fetch');
    log('[update] 检查 npm registry：' + url);
    let res;
    try {
      res = await fetch(url, { headers: { accept: 'application/json' }, signal: timeoutSignal(FETCH_TIMEOUT_MS) });
    } catch (e) {
      if (isTimeoutError(e)) throw new Error('检查更新超时（' + Math.round(FETCH_TIMEOUT_MS / 1000) + ' 秒没有响应）');
      throw new Error('检查更新失败：连不上 npm registry（' + ((e && e.message) || '网络错误') + '）');
    }
    if (!res || !res.ok) throw new Error('检查更新失败：npm registry 返回 HTTP ' + ((res && res.status) || 0));
    let json;
    try {
      json = await res.json();
    } catch {
      throw new Error('检查更新失败：npm registry 返回的不是 JSON');
    }
    const v = json && typeof json.version === 'string' ? json.version.trim() : '';
    if (!v) throw new Error('检查更新失败：npm registry 返回里没有 version 字段');
    return v;
  }

  // ---------- check ----------

  function buildResult(fields) {
    const result = {
      ok: !!fields.ok,
      current: currentVersion,
      latest: fields.latest === undefined ? null : fields.latest,
      updateAvailable: !!fields.updateAvailable,
      source: fields.source === undefined ? null : fields.source,
      installKind: fields.installKind,
      gitRepo: !!fields.gitRepo,
      gitDirty: fields.gitDirty === undefined ? null : fields.gitDirty,
      checkedAt: fields.checkedAt,
    };
    if (fields.error) result.error = String(fields.error);
    return result;
  }

  async function runCheck() {
    const checkedAt = Date.now();
    const installKind = detectInstallKind(pluginRoot);
    let gitInfo = { gitRepo: false, gitDirty: null };
    let latest = null;
    let fetchError = '';

    // 网络与 git 探测并行，互不拖累
    const [regRes, gitRes] = await Promise.all([
      fetchLatestVersion().then((v) => ({ ok: true, latest: v })).catch((e) => ({ ok: false, error: (e && e.message) || '检查更新失败' })),
      inspectGit(),
    ]);
    gitInfo = gitRes || gitInfo;
    if (regRes.ok) latest = regRes.latest;
    else fetchError = regRes.error || '检查更新失败';

    let result;
    if (fetchError) {
      result = buildResult({
        ok: false, error: fetchError, installKind,
        gitRepo: gitInfo.gitRepo, gitDirty: gitInfo.gitDirty, checkedAt,
      });
    } else {
      const newer = compareVersion(latest, currentVersion) > 0;
      const isPrerelease = /-/.test(String(latest));
      // 未开启 allowPrerelease 时：预发布版本只上报 latest，不提示「可更新」
      const updateAvailable = newer && (!isPrerelease || state.allowPrerelease);
      result = buildResult({
        ok: true, latest, updateAvailable, source: 'npm', installKind,
        gitRepo: gitInfo.gitRepo, gitDirty: gitInfo.gitDirty, checkedAt,
      });
    }

    state.lastCheckAt = checkedAt;
    state.lastResult = result;
    state.update = result.ok && result.updateAvailable
      ? { latest: result.latest, current: result.current, source: result.source, checkedAt }
      : null;
    cache = { at: Date.now(), result };
    log('[update] 检查完成：current=' + currentVersion + ' latest=' + (latest || '?')
      + ' 可更新=' + result.updateAvailable + ' gitRepo=' + result.gitRepo + ' gitDirty=' + String(result.gitDirty));
    return cloneObject(result);
  }

  async function check(force) {
    try {
      const now = Date.now();
      if (!force && cache && now - cache.at < CHECK_CACHE_MS) return cloneObject(cache.result);
      // force 也复用正在飞的请求：同一时刻只发一次网络
      if (checkInflight) return checkInflight;
      checkInflight = runCheck()
        .catch((e) => buildResult({
          ok: false,
          error: '检查更新失败：' + ((e && e.message) || '未知错误'),
          installKind: detectInstallKind(pluginRoot),
          checkedAt: Date.now(),
        }))
        .finally(() => { checkInflight = null; });
      return checkInflight;
    } catch (e) {
      return buildResult({
        ok: false,
        error: '检查更新失败：' + ((e && e.message) || '未知错误'),
        installKind: detectInstallKind(pluginRoot),
        checkedAt: Date.now(),
      });
    }
  }

  // ---------- apply ----------

  function applyManual(installKind) {
    const message = installKind === 'link'
      ? '当前是链接安装（不是 git 检出）：请在源码目录里更新（git pull），插件不会擅自改动你的安装。'
      : '当前是 npm 安装，请在 DSH 插件管理器里更新，或在插件目录执行 npm i dsh-screen-beyond@latest';
    return { ok: false, method: 'manual', message, changed: false, needRestart: false };
  }

  async function apply() {
    if (applying) {
      return {
        ok: false,
        method: 'manual',
        message: '正在更新中，请稍等…',
        changed: false,
        needRestart: false,
        error: '正在更新中',
      };
    }
    applying = true;
    try {
      const installKind = detectInstallKind(pluginRoot);
      const gitInfo = await inspectGit();
      // 执行前清缓存：更新后必须重新检查，不能继续用旧的「可更新」结果；
      // 同时先登记一条「进行中」，调用方轮询 cfg().lastResult 时能看到更新正在进行。
      cache = null;
      state.lastResult = {
        kind: 'apply',
        at: Date.now(),
        ok: false,
        method: gitInfo.gitRepo && gitInfo.gitDirty === false ? 'git-pull' : 'manual',
        message: '正在更新…',
        changed: false,
        needRestart: false,
      };
      let result;
      if (!gitInfo.gitRepo) {
        result = applyManual(installKind);
      } else if (gitInfo.gitDirty === true) {
        result = {
          ok: false,
          method: 'git-pull',
          message: '插件目录有未提交的本地修改（git 工作区不干净），为安全起见不自动更新；请先提交或还原改动后再试。',
          changed: false,
          needRestart: false,
        };
      } else if (gitInfo.gitDirty === null) {
        result = {
          ok: false,
          method: 'git-pull',
          message: '没法确认 git 工作区状态（git 不可用或命令执行失败），先不自动更新。',
          changed: false,
          needRestart: false,
        };
      } else {
        // 固定 argv，cwd=pluginRoot；不拼 shell 字符串
        const before = await snapshotVersionState();
        log('[update] 执行 git pull --ff-only（cwd=' + pluginRoot + '）');
        const pull = await runGit(['pull', '--ff-only'], GIT_PULL_TIMEOUT_MS);
        if (!pull.ok) {
          const detail = (pull.stderr || '').trim() || (pull.stdout || '').trim();
          const conflict = /non-fast-forward|not possible to fast-forward|CONFLICT|rejected/i.test(detail);
          const tip = conflict ? '（不是快进更新或存在冲突，请手动 git pull 处理）' : '';
          result = {
            ok: false,
            method: 'git-pull',
            message: 'git pull 失败，' + (detail ? '原因：' + detail.slice(0, 300) + tip : '请手动在插件目录执行 git pull 查看原因' + tip),
            changed: false,
            needRestart: false,
            error: detail ? detail.slice(0, 300) : 'git pull 失败',
          };
        } else {
          const after = await snapshotVersionState();
          const changed = detectChanged(before, after, pull.stdout);
          if (changed) {
            result = {
              ok: true,
              method: 'git-pull',
              message: '已拉到新代码，重启运行时后生效。',
              changed: true,
              needRestart: true,
            };
            state.update = null; // 已经拉到新代码，旧的可更新提示作废
          } else {
            result = {
              ok: true,
              method: 'git-pull',
              message: '已经是最新代码，没有拉到新提交。',
              changed: false,
              needRestart: false,
            };
          }
        }
      }
      state.lastResult = Object.assign({ kind: 'apply', at: Date.now() }, result);
      log('[update] 更新结束：ok=' + result.ok + ' method=' + result.method + ' changed=' + result.changed);
      return Object.assign({}, result);
    } catch (e) {
      const why = (e && e.message) || '未知错误';
      const result = {
        ok: false,
        method: 'manual',
        message: '自动更新时出错：' + why,
        changed: false,
        needRestart: false,
        error: why,
      };
      state.lastResult = Object.assign({ kind: 'apply', at: Date.now() }, result);
      log('[update] 更新出错：' + why);
      return result;
    } finally {
      applying = false;
    }
  }

  // ---------- 设置 ----------

  function cfg() {
    return {
      autoCheck: !!state.autoCheck,
      autoApply: !!state.autoApply,
      allowPrerelease: !!state.allowPrerelease,
      lastCheckAt: Number(state.lastCheckAt) || 0,
      lastResult: cloneObject(state.lastResult),
      update: cloneObject(state.update),
    };
  }

  function setSettings(partial) {
    const p = partial && typeof partial === 'object' ? partial : {};
    const keys = ['autoCheck', 'autoApply', 'allowPrerelease'];
    let prereleaseChanged = false;
    for (const key of keys) {
      if (typeof p[key] !== 'boolean') continue;
      if (key === 'allowPrerelease' && p[key] !== state.allowPrerelease) prereleaseChanged = true;
      state[key] = p[key];
    }
    // 预发布开关会影响 updateAvailable：清缓存，下次 check 按新设置重新判断
    if (prereleaseChanged) cache = null;
    return cfg();
  }

  return { check, apply, cfg, setSettings };
}
