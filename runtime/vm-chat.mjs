/**
 * 虚拟机社交软件通道（基础版）
 *
 * 不绑定具体软件：先检测 VM 里有哪些 Network/Chat 类应用，再由 AI 看屏幕选应用。
 * 依赖：
 *  - VirtualBox（DSH-Space）
 *  - agent_ssh.py / space_ctl.py（env 目录，SSH 密码可用 DSH_COMPANION_SSH_PASS 覆盖）
 *  - 宿主机多模态 chatCompletion
 *
 * 可选能力（设置 → 虚拟机聊天，均可用配置关闭）：
 *  - targetContact：目标联系人白名单，配置后只在会话名包含该字符串时发送/回复
 *  - unreadScan：回复前先只读扫描其它会话的未读消息
 *  - watchdog：聊天窗口不在时按 ≥60s 防抖自动重开应用
 *  - sendImages：允许通过 sendImageToUser() 往聊天软件里粘贴图片
 *  - 每次文字发送后都会二次截图校验（verify），失败只记录日志，不重复发送
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const VM_NAME = process.env.DSH_COMPANION_VM || 'DSH-Space';
const VBOX = process.env.DSH_COMPANION_VBOX || 'C:\\Program Files\\Oracle\\VirtualBox\\VBoxManage.exe';
const LAUNCH_PROFILES = [
  { match: /(^|[\\/ ])qq([\\/ .]|$)/i, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-gpu-sandbox', '--disable-gpu-compositing', '--disable-software-rasterizer', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=Vulkan,UseSkiaRenderer,NetworkServiceSandbox', '--enable-features=NetworkServiceInProcess'] },
];

function run(file, args, timeout = 120000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String((stdout || '') + (stderr || '')).slice(0, 40000), err: err ? String(err.message) : '' });
    });
  });
}

export function createVmChat({ runPy, probeTcp, chatCompletion, getSettings, saveSettings, getCharacter, dataRoot, log }) {
  const cfg = () => ({ ...(getSettings() || {}) });
  let last = null;
  let busy = false;
  let lastAppRestartAt = 0;      // 应用重开防抖（≥60s）
  let loginRequiredAt = 0;       // 最近一次检测到登录/扫码页的时间
  const CHAT_WINDOW_RE = /qq|telegram|discord|wechat|signal|element|slack|messages?/i;

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function targetContact() { return String(cfg().targetContact || '').trim(); }
  /** 目标联系人白名单：未配置=不限制；配置后当前会话名必须包含该字符串。 */
  function conversationAllowed(conversation) {
    const want = targetContact();
    if (!want) return true;
    const got = String(conversation || '').trim();
    return !!got && got.includes(want);
  }
  /** 最近一条「自己」的消息文本（AI 识别结果里的 from 字段）。 */
  function validPoint(p) {
    return !!(p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)) && !(Number(p.x) === 0 && Number(p.y) === 0));
  }
  function lastSelfText(an) {
    const recent = Array.isArray(an && an.recent) ? an.recent : [];
    const mine = recent.filter((m) => /自己|me|self/i.test(String((m && m.from) || '')));
    return mine.length ? String(mine[mine.length - 1].text || '') : '';
  }

  async function isRunning() {
    const r = await run(VBOX, ['list', 'runningvms'], 8000);
    return r.ok && r.out.includes(VM_NAME);
  }

  async function wake() {
    if (await isRunning()) return true;
    if (cfg().autoStart === false) return false;
    await run(VBOX, ['startvm', VM_NAME, '--type', 'headless'], 30000);
    for (let i = 0; i < 60; i += 1) {
      if (await probeTcp(2222) && (i < 3 || await probeTcp(6081))) {
        await new Promise((r) => setTimeout(r, 4000));
        return true;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  async function stop() {
    if (!(await isRunning())) return true;
    const r = await run(VBOX, ['controlvm', VM_NAME, 'savestate'], 60000);
    return r.ok;
  }

  async function ssh(cmd) {
    if (!(await probeTcp(2222))) return { ok: false, out: '' };
    return runPy('agent_ssh.py', ['run', cmd], 60000);
  }

  async function space(args) {
    return runPy('space_ctl.py', args, 60000);
  }

  async function detectApps() {
    const py = `python3 - <<'PY'
import glob, json, os
apps = []
for f in glob.glob('/usr/share/applications/*.desktop'):
    try:
        data = open(f, encoding='utf-8', errors='ignore').read()
        kv = {}
        for line in data.splitlines():
            if '=' in line:
                k, v = line.split('=', 1)
                kv.setdefault(k.strip(), v.strip())
        name = kv.get('Name', '')
        cats = kv.get('Categories', '')
        exe = kv.get('Exec', '')
        if name:
            blob = name + ' ' + cats + ' ' + exe
            if any(k in blob.lower() for k in ['network', 'chat', 'instantmessaging', 'browser', 'qq', 'telegram', 'discord', 'wechat', 'signal', 'element', 'slack', 'firefox', 'chromium', 'chrome']):
                apps.append({'id': os.path.basename(f)[:-8], 'name': name, 'categories': cats, 'exec': exe})
    except Exception:
        pass
print(json.dumps(apps, ensure_ascii=False))
PY`;
    const r = await ssh(py);
    if (!r.ok) return [];
    try {
      const arr = JSON.parse(String(r.out || '').trim().split('\n').filter(Boolean).pop() || '[]');
      return Array.isArray(arr) ? arr.filter((a) => /Network|Chat|InstantMessaging|Browser|WebBrowser/i.test(a.categories || '') || /firefox|chromium|chrome|qq|telegram|discord|wechat|signal|element|slack/i.test(String(a.id || '') + ' ' + String(a.name || ''))) : [];
    } catch { return []; }
  }

  async function windows() {
    const r = await ssh("export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; xdotool search --name . getwindowname %@ 2>/dev/null | head -40");
    return String((r && r.out) || '').split('\n').map((x) => x.trim()).filter(Boolean);
  }

  async function visibleWindows() {
    const r = await ssh("export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; xdotool search --onlyvisible --name . getwindowname %@ 2>/dev/null | head -40");
    return String((r && r.out) || '').split('\n').map((x) => x.trim()).filter(Boolean);
  }

  async function screenshot() {
    const dir = path.join(dataRoot, 'vm-chat');
    fs.mkdirSync(dir, { recursive: true });
    // 只保留最近 20 张截图，避免每天几十张 ~190KB 的 PNG 无限堆积
    try {
      const olds = fs.readdirSync(dir).filter((f) => /^screen-\d+\.png$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const x of olds.slice(20)) { try { fs.unlinkSync(path.join(dir, x.f)); } catch {} }
    } catch {}
    const p = path.join(dir, 'screen-' + Date.now() + '.png');
    const r = await space(['shot', p]);
    return r.ok && fs.existsSync(p) ? p : null;
  }

  function dataUrl(file) {
    try {
      const b = fs.readFileSync(file);
      const mime = b[0] === 0x89 ? 'image/png' : (b[0] === 0xFF ? 'image/jpeg' : 'image/webp');
      return 'data:' + mime + ';base64,' + b.toString('base64');
    } catch { return ''; }
  }

  function parseObj(text) {
    try {
      const a = String(text || '').indexOf('{'), b = String(text || '').lastIndexOf('}');
      if (a >= 0 && b > a) return JSON.parse(String(text).slice(a, b + 1));
    } catch {}
    return null;
  }

  async function visionOnce(prompt, img, maxTokens) {
    const resp = await chatCompletion({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: img } },
        ],
      }],
      max_tokens: maxTokens, temperature: 0.4,
    });
    const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
    return { content: String((msg && msg.content) || ''), reasoning: String((msg && msg.reasoning_content) || '') };
  }

  async function vision(prompt, imagePath) {
    const img = imagePath ? dataUrl(imagePath) : '';
    if (!img) return null;
    const first = await visionOnce(prompt, img, 3600);
    let parsed = parseObj(first.content) || parseObj(first.reasoning);
    if (parsed) return parsed;
    // 长提示词有时会被推理吃掉；用短提示再要一次纯 JSON
    const shortPrompt = '看这张 Linux 虚拟机截图。右侧气泡是自己发的，左侧是对方发的。只输出一行 JSON，不要 markdown、不要解释：{"appName":"当前聊天软件","conversation":"当前会话","conversationRow":{"x":0,"y":0},"recent":[{"from":"自己|对方","text":""}],"lastFrom":"自己|对方","unread":[{"from":"","text":"","conversation":"","row":{"x":0,"y":0}}],"needReply":false,"reply":"要回就写一句自然回复","composer":{"x":0,"y":0},"note":"简述"}；composer 是输入框中心，坐标按屏幕 0-1000 归一化。';
    const second = await visionOnce(shortPrompt, img, 3000);
    return parseObj(second.content) || parseObj(second.reasoning);
  }

  function profileFor(app) {
    const text = String((app && (app.id + ' ' + app.name + ' ' + app.exec)) || '');
    return LAUNCH_PROFILES.find((p) => p.match.test(text)) || null;
  }

  async function launch(app) {
    if (!app || !app.id) return false;
    const profile = profileFor(app);
    const env = "SHELLPID=$(pgrep -n gnome-shell); export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority; export DBUS_SESSION_BUS_ADDRESS=$(tr '\\0' '\\n' < /proc/$SHELLPID/environ | sed -n 's/^DBUS_SESSION_BUS_ADDRESS=//p'); export XDG_RUNTIME_DIR=$(tr '\\0' '\\n' < /proc/$SHELLPID/environ | sed -n 's/^XDG_RUNTIME_DIR=//p'); export LIBGL_ALWAYS_SOFTWARE=1; export GDK_BACKEND=x11; ";
    if (profile) {
      const exe = String(app.exec || '').split(/\s+/)[0];
      if (!exe) return false;
      const args = profile.args.map((a) => JSON.stringify(a)).join(' ');
      await ssh(env + "setsid -f " + JSON.stringify(exe) + " " + args + " >/tmp/dsh-vm-chat-app.log 2>&1");
    } else {
      await ssh(env + "setsid -f gtk-launch " + JSON.stringify(app.id).replace(/"/g, ''));
    }
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 800));
      const wins = await visibleWindows();
      if (wins.some((w) => w && w.toLowerCase().includes(String(app.name || app.id).toLowerCase().slice(0, 3)))) return true;
    }
    return true;
  }

  function chatApps(apps) {
    return (apps || []).filter((a) => /chat|instantmessaging/i.test(a.categories || '') || /qq|telegram|discord|wechat|signal|element|slack/i.test(a.id + ' ' + a.name));
  }

  async function ensureApp() {
    const wins = await visibleWindows();
    if (wins.some((w) => /qq|telegram|discord|wechat|signal|element|slack|messages?/i.test(w))) return true;
    const apps = await detectApps();
    const list = chatApps(apps);
    const app = list[0] || apps[0];
    if (!app) return false;
    await launch(app);
    return true;
  }

  /**
   * 应用健康守护：没有聊天类窗口时重开应用。
   * - 60s 防抖，避免每次 analyze 都重启
   * - 登录/扫码等待期间不重开（否则会把登录页刷掉，用户没法扫码）
   * 失败只打日志，不抛异常（调用方在 analyze 里等它返回）。
   */
  async function ensureAppAlive() {
    if (cfg().watchdog === false) return true;
    try {
      const wins = await visibleWindows();
      if (wins.some((w) => CHAT_WINDOW_RE.test(w))) return true;
      if (loginRequiredAt && Date.now() - loginRequiredAt < 10 * 60 * 1000) {
        log('[vm-chat] 登录页等待人工扫码，跳过应用重开');
        return false;
      }
      if (Date.now() - lastAppRestartAt < 60000) return false;
      lastAppRestartAt = Date.now();
      log('[vm-chat] 未发现聊天窗口，尝试重开应用');
      const apps = await detectApps();
      const list = chatApps(apps);
      const app = list[0] || apps[0];
      if (!app) { log('[vm-chat] 没有可用的聊天应用'); return false; }
      await launch(app);
      for (let i = 0; i < 15; i += 1) {
        await sleep(800);
        const again = await visibleWindows();
        if (again.some((w) => CHAT_WINDOW_RE.test(w))) { log('[vm-chat] 应用已重开'); return true; }
      }
      log('[vm-chat] 重开应用后仍未发现聊天窗口');
      return false;
    } catch (e) {
      log('[vm-chat] ensureAppAlive 失败: ' + String((e && e.message) || e));
      return false;
    }
  }

  async function clickPoint(p) {
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) return false;
    const ss = await getScreenSize();
    const x = Math.round(Math.max(0, Math.min(1000, Number(p.x))) * ss.w / 1000);
    const y = Math.round(Math.max(0, Math.min(1000, Number(p.y))) * ss.h / 1000);
    await space(['click', x, y]);
    await new Promise((r) => setTimeout(r, 700));
    return true;
  }

  async function openConversation(an) {
    if (!an || !an.conversationRow) return false;
    const ok = await clickPoint(an.conversationRow);
    if (!ok) return false;
    await new Promise((r) => setTimeout(r, 700));
    return true;
  }

  async function analyze(extra = '') {
    if (!(await wake())) return { ok: false, error: '虚拟机没启动' };
    const apps = await detectApps();
    // 应用健康守护：没有聊天窗口就按防抖重开应用（失败不抛，继续截图）
    await ensureAppAlive();
    const wins = await visibleWindows();
    const shot = await screenshot();
    if (!shot) return { ok: false, error: '截图失败', apps, windows: wins };
    const ch = getCharacter();
    const prompt = `你在一台 Linux 虚拟机里替角色看社交软件。可用应用：
${apps.map((a) => a.id + ' / ' + a.name + ' / ' + a.categories).join('\n') || '（没有检测到）'}
当前窗口：${wins.slice(0, 12).join(' | ') || '（无）'}
角色：${ch.name}，用户关系：${ch.relation || ''}。
看截图，找出正在打开的聊天软件、当前会话、最近消息、未读消息、输入框和发送按钮的位置。
右侧气泡是账号自己发的，左侧气泡是对方（用户）发的。
坐标用 0-1000 的屏幕归一化坐标。
未读会话除了 from/text，还要给出 conversation（会话名）和 row（该会话在侧栏的行中心坐标，用来点开）；没有把握就把 row 留空。
只输出 JSON：
{"appId":"哪个应用","appName":"","conversation":"当前会话名","conversationRow":{"x":0,"y":0},"recent":[{"from":"自己|对方","text":"","time":""}],"lastFrom":"自己|对方","unread":[{"from":"","text":"","conversation":"","row":{"x":0,"y":0}}],"composer":{"x":0,"y":0},"send":{"x":0,"y":0},"needReply":false,"reply":"如果要回，写一句自然回复","note":"你看到了什么"}
${extra}`;
    const v = await vision(prompt, shot);
    const note = String((v && v.note) || '');
    const hasConv = !!(v && (String(v.conversation || '').trim() || (Array.isArray(v.recent) && v.recent.length)));
    // 「没识别到会话」不等于登录页：只有明确出现登录/扫码文案才拦截发送。
    // 否则冷启动/主界面/视觉漏读都会把正常发送误判成登录页。
    const requiresLogin = /登录|扫码|login|验证码|滑动验证/i.test(note);
    return { ok: true, apps, windows: wins, screen: shot, analysis: v, requiresLogin, noConversation: !hasConv };
  }

  let screenSize = null;
  async function getScreenSize() {
    if (screenSize) return screenSize;
    const r = await space(['res']);
    const out = String((r && r.out) || '');
    const m = out.match(/(\d{3,5})\s*x\s*(\d{3,5})/i) || out.match(/(\d{3,5})\s+(\d{3,5})/);
    screenSize = m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1280, h: 800 };
    return screenSize;
  }

  async function typeAt(text, composer) {
    const ss = await getScreenSize();
    const x = Math.round(Math.max(0, Math.min(1000, Number(composer.x))) * ss.w / 1000);
    const y = Math.round(Math.max(0, Math.min(1000, Number(composer.y))) * ss.h / 1000);
    await space(['click', x, y]);
    await new Promise((r) => setTimeout(r, 350));
    await space(['type', String(text).slice(0, 800)]);
    await new Promise((r) => setTimeout(r, 250));
    await space(['key', 'Return']);
    await new Promise((r) => setTimeout(r, 700));
    return { x, y };
  }

  /**
   * 发送后校验：等 1.2s 再截一次图，确认最近一条「自己」的消息包含所发内容的前 12 字。
   * 只是确认与日志，不重发（避免重复刷屏）。
   */
  async function verifySent(text, prevLastSelf = '') {
    const probe = String(text || '').trim().slice(0, 12);
    try {
      await sleep(1200);
      const a = await analyze('刚发出一条消息，请只读当前会话最近消息，不要发送任何内容。');
      const an = a && a.ok ? a.analysis : null;
      if (!an) return { ok: false, lastText: '', error: (a && a.error) || '未看懂屏幕' };
      const lastText = lastSelfText(an);
      const ok = !!(probe && lastText && (lastText.includes(probe) || (prevLastSelf && lastText !== prevLastSelf)));
      return { ok, lastText };
    } catch (e) {
      return { ok: false, lastText: '', error: String((e && e.message) || e) };
    }
  }

  /** 图片消息没有文字可比对：只要求「自己」侧出现了新的气泡（文本变化/图片占位）。 */
  async function verifyImageSent(prevLastSelf = '') {
    try {
      const a = await analyze('刚发出一条图片消息，请只读当前会话最近消息，不要发送任何内容。');
      const an = a && a.ok ? a.analysis : null;
      if (!an) return { ok: false, lastText: '', error: (a && a.error) || '未看懂屏幕' };
      const lastText = lastSelfText(an);
      const ok = !!lastText && (lastText !== prevLastSelf || /图|照片|图片|image|photo|\[/i.test(lastText));
      return { ok, lastText };
    } catch (e) {
      return { ok: false, lastText: '', error: String((e && e.message) || e) };
    }
  }

  async function sendText(text, hint) {
    if (!text || !String(text).trim()) return { ok: false, error: '空消息' };
    if (busy) return { ok: false, error: 'vm-chat busy' };
    busy = true;
    try {
      let an = hint && hint.composer ? hint : null;
      if (!an) {
        const a = await analyze('这条消息是要主动发给用户的。请确认当前会话是用户，并给出输入框坐标。');
        if (!a.ok) return a;
        an = a.analysis;
        if (!an) return { ok: false, error: 'AI 没有看懂屏幕', screen: a.screen };
        if (a.requiresLogin) return { ok: false, error: '虚拟机聊天停在登录/扫码页，先登录再发送', requiresLogin: true, analysis: an, screen: a.screen };
        if (!an.appId || !an.composer) {
          await ensureApp();
          const b = await analyze('刚打开了应用，请重新找会话和输入框。');
          an = (b.analysis) || an;
        }
      }
      let composer = an.composer || an.send;
      if ((!composer || !Number.isFinite(Number(composer.x))) && an.conversationRow) {
        await openConversation(an);
        const b = await analyze('已经点开了会话，请重新找输入框。');
        an = (b.analysis) || an;
        composer = an.composer || an.send;
      }
      if (!validPoint(composer)) {
        return { ok: false, error: '没找到输入框', analysis: an, screen: null };
      }
      // 目标联系人白名单：会话名缺失时补一次只读确认，避免把消息发到别的会话
      if (targetContact() && !String(an.conversation || '').trim()) {
        const t = await analyze('只确认当前会话名称，不要发送任何消息。');
        if (t.ok && t.analysis && t.analysis.conversation) an = { ...an, conversation: t.analysis.conversation };
      }
      if (!conversationAllowed(an.conversation)) {
        log('[vm-chat] 取消发送：当前会话「' + String(an.conversation || '') + '」不是目标联系人「' + targetContact() + '」');
        return { ok: false, error: '当前会话不是目标联系人', conversation: an.conversation || '', analysis: an };
      }
      const pos = await typeAt(text, composer);
      const verify = await verifySent(text);
      last = { at: Date.now(), action: 'send', ok: true, text, verify };
      if (!verify.ok) log('[vm-chat] 发送校验失败：未在屏幕上确认到刚发出的消息「' + String(text).slice(0, 20) + '」' + (verify.lastText ? '（识别到「' + String(verify.lastText).slice(0, 30) + '」）' : ''));
      return { ok: true, sentAt: pos, analysis: an, verify, screen: null };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      busy = false;
    }
  }

  /**
   * 只读扫描未读会话：最多 max 个。
   * - 只点开、只读，不发送任何消息
   * - unread 行有 row 坐标时点开取最近消息；没有坐标就只登记会话名
   */
  async function scanUnread(max = 3) {
    const found = [];
    try {
      const cap = Math.max(1, Math.min(10, Number(max) || 3));
      const a = await analyze('现在只做未读扫描，不要发送任何消息。在 unread 数组里列出最多 ' + cap + ' 个有未读的会话，每条给出 conversation 和该会话在侧栏的行坐标 row。');
      const an = a && a.ok ? a.analysis : null;
      if (!an) { log('[vm-chat] scanUnread 跳过：AI 未看懂屏幕'); return found; }
      const unread = Array.isArray(an.unread) ? an.unread.slice(0, cap) : [];
      const seen = new Set();
      for (const u of unread) {
        if (!u) continue;
        const conv = String(u.conversation || u.from || '').trim();
        const text = String(u.text || '').trim();
        const key = conv + '|' + text;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = (u.row && Number.isFinite(Number(u.row.x))) ? u.row : (u.conversationRow && Number.isFinite(Number(u.conversationRow.x)) ? u.conversationRow : null);
        let detail = { conversation: conv, text, recent: [], lastFrom: String(u.from || ''), row: row || null };
        if (row) {
          await clickPoint(row);
          const b = await analyze('已经点开未读会话，只读最近消息，不要发送任何内容。');
          const bn = b && b.ok ? b.analysis : null;
          if (bn) {
            detail = {
              conversation: String(bn.conversation || conv),
              text,
              recent: Array.isArray(bn.recent) ? bn.recent : [],
              lastFrom: String(bn.lastFrom || ''),
              row,
            };
          }
        }
        found.push(detail);
        await sleep(300);
      }
      log('[vm-chat] scanUnread 命中 ' + found.length + '/' + unread.length + ' 个未读');
    } catch (e) {
      log('[vm-chat] scanUnread 失败: ' + String((e && e.message) || e));
    }
    return found;
  }

  /** 从未读扫描结果里取最新一条「对方」消息（用于优先处理该会话）。 */
  function latestUserFromScan(list) {
    let hit = null;
    for (const it of list || []) {
      const recent = Array.isArray(it.recent) ? it.recent : [];
      for (const m of recent) {
        if (!/对方|user|用户/i.test(String((m && m.from) || ''))) continue;
        const t = String((m && m.text) || '').trim();
        if (t) hit = { conversation: it.conversation || '', text: t };
      }
    }
    return hit;
  }

  /**
   * 发送一张图片（宿主机路径）：
   * 找输入框 → 点击 → space_ctl send-image（SFTP 上传到 VM + xclip 剪贴板 → ctrl+v）→ 回车 → 校验。
   */
  async function sendImageToUser(hostImagePath, hint) {
    if (cfg().sendImages === false) return { ok: false, error: '虚拟机图片发送已关闭（sendImages=false）' };
    const local = String(hostImagePath || '');
    if (!local || !fs.existsSync(local)) return { ok: false, error: '图片文件不存在: ' + (local || '(空)') };
    if (busy) return { ok: false, error: 'vm-chat busy' };
    busy = true;
    try {
      let an = hint && hint.composer ? hint : null;
      if (!an) {
        const a = await analyze('这条消息是要把一张图片主动发给用户的。请确认当前会话是用户，并给出输入框坐标。');
        if (!a.ok) return a;
        an = a.analysis;
        if (!an) return { ok: false, error: 'AI 没有看懂屏幕', screen: a.screen };
        if (a.requiresLogin) return { ok: false, error: '虚拟机聊天停在登录/扫码页，先登录再发送', requiresLogin: true, analysis: an, screen: a.screen };
        if (!an.appId || !an.composer) {
          await ensureApp();
          const b = await analyze('刚打开了应用，请重新找会话和输入框。');
          an = (b.analysis) || an;
        }
      }
      if (targetContact() && !String(an.conversation || '').trim()) {
        const t = await analyze('只确认当前会话名称，不要发送任何消息。');
        if (t.ok && t.analysis && t.analysis.conversation) an = { ...an, conversation: t.analysis.conversation };
      }
      if (!conversationAllowed(an.conversation)) {
        log('[vm-chat] 取消发图：当前会话「' + String(an.conversation || '') + '」不是目标联系人「' + targetContact() + '」');
        return { ok: false, error: '当前会话不是目标联系人', conversation: an.conversation || '', analysis: an };
      }
      let composer = an.composer || an.send;
      if ((!composer || !Number.isFinite(Number(composer.x))) && an.conversationRow) {
        await openConversation(an);
        const b = await analyze('已经点开了会话，请重新找输入框。');
        an = (b.analysis) || an;
        composer = an.composer || an.send;
      }
      if (!validPoint(composer)) {
        return { ok: false, error: '没找到输入框', analysis: an };
      }
      const prevLastSelf = lastSelfText(an);
      await clickPoint(composer);
      await sleep(300);
      const r = await space(['send-image', local]);
      if (!r || !r.ok) {
        const detail = String((r && (r.out || r.err)) || '').slice(0, 300);
        log('[vm-chat] send-image 失败: ' + detail);
        return { ok: false, error: '图片粘贴失败（space_ctl send-image）', detail };
      }
      await sleep(1000);
      await space(['key', 'Return']);
      await sleep(1200);
      const verify = await verifyImageSent(prevLastSelf);
      last = { at: Date.now(), action: 'send-image', ok: true, image: local, verify };
      if (!verify.ok) log('[vm-chat] 图片发送校验失败：' + JSON.stringify(verify));
      return { ok: true, image: local, verify, analysis: an, output: String((r && r.out) || '').slice(0, 300) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      busy = false;
    }
  }

  let lastHandled = String(cfg().lastHandledKey || '') || null;
  async function checkAndReply() {
    if (busy) return { ok: false, error: 'busy' };
    // 未读扫描（可选、只读）：先看其它会话有没有新消息，再回到当前会话的回复流程
    let scanned = [];
    if (cfg().unreadScan === true) scanned = await scanUnread(3);
    const scanLatest = latestUserFromScan(scanned);
    const scanHint = scanned.length
      ? '未读扫描：' + scanned.map((x) => x.conversation).filter(Boolean).join('、') + (scanLatest ? '。其中最新一条对方消息在「' + scanLatest.conversation + '」：「' + String(scanLatest.text).slice(0, 60) + '」，优先处理这个会话。' : '')
      : '';
    let a = await analyze('看当前聊天软件的当前会话最近消息。左侧是对方（用户）发的，右侧是自己发的。判断最后一条是不是对方发的、要不要回；要回就给一句自然的回复。' + (scanHint ? ' ' + scanHint : ''));
    if (a.ok && !a.analysis) {
      // 登录等待期间不再反复重开应用（避免把扫码页刷掉）
      if (!(loginRequiredAt && Date.now() - loginRequiredAt < 10 * 60 * 1000)) await ensureApp();
      a = await analyze('看当前聊天软件的当前会话最近消息。左侧是对方（用户）发的，右侧是自己发的。判断最后一条是不是对方发的、要不要回；要回就给一句自然的回复。');
    }
    if (!a.ok || !a.analysis) return a;
    let an = a.analysis;
    if (/登录|验证|扫码|login|验证码/i.test(String(an.note || '')) && !(Array.isArray(an.recent) && an.recent.length)) {
      loginRequiredAt = Date.now();
      last = { at: Date.now(), action: 'check', loginRequired: true };
      log('[vm-chat] 检测到登录/扫码页，等待人工在「看屏幕」里扫码');
      return { ok: true, unread: 0, recent: 0, requiresLogin: true, loginHint: '请在「看屏幕」里扫码登录', analysis: an, screen: a.screen, unreadScan: scanned };
    }
    // 目标联系人：当前会话不对时，先尝试切到未读扫描里命中的目标会话
    if (targetContact() && !conversationAllowed(an.conversation) && scanned.length) {
      const hit = scanned.find((x) => conversationAllowed(x.conversation) && x.row);
      if (hit) {
        await clickPoint(hit.row);
        await sleep(700);
        const b = await analyze('已经切到目标会话，请只读最近消息并判断是否需要回复。');
        if (b.ok && b.analysis) { a = b; an = b.analysis; }
      }
    }
    if ((!an.composer || !Array.isArray(an.recent) || !an.recent.length) && an.conversationRow) {
      await openConversation(an);
      const b = await analyze('已经点开了会话，请重新看最近消息。');
      if (b.ok && b.analysis) a = b;
      an = a.analysis || an;
    }
    const recent = Array.isArray(an.recent) ? an.recent : [];
    const userMsgs = recent.filter((m) => /对方|user|用户/i.test(String(m.from || '')));
    const key = recent.length ? String(recent[recent.length - 1].from || '') + '|' + String(recent[recent.length - 1].text || '') : '';
    const lastFrom = String(an.lastFrom || (userMsgs.length ? '对方' : ''));
    if (!recent.length && !(Array.isArray(an.unread) && an.unread.length)) {
      last = { at: Date.now(), action: 'check', unread: 0 };
      return { ok: true, unread: 0, recent: 0, analysis: an, unreadScan: scanned };
    }
    if (lastFrom !== '对方' && !/对方/.test(lastFrom) && !userMsgs.length) {
      last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length };
      return { ok: true, unread: 0, recent: recent.length, analysis: an, unreadScan: scanned };
    }
    if (key && key === lastHandled) {
      last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length, duplicate: true };
      return { ok: true, unread: 0, recent: recent.length, duplicate: true, analysis: an, unreadScan: scanned };
    }
    // 目标联系人白名单：不是目标会话就不回（避免回错人）
    if (!conversationAllowed(an.conversation)) {
      log('[vm-chat] 跳过回复：当前会话「' + String(an.conversation || '') + '」不是目标联系人「' + targetContact() + '」');
      last = { at: Date.now(), action: 'check', skipped: 'targetContact', conversation: an.conversation || '' };
      return { ok: true, unread: 0, recent: recent.length, skipped: 'targetContact', analysis: an, unreadScan: scanned };
    }
    let sent = null;
    if (an.needReply && an.reply) {
      sent = await sendText(an.reply, { appId: an.appId, composer: an.composer, conversation: an.conversation });
      if (sent && sent.ok) { lastHandled = key; saveSettings({ lastHandledKey: key }); }
    }
    last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length, analysis: an };
    return { ok: true, unread: 0, recent: recent.length, sent, analysis: an, screen: a.screen, unreadScan: scanned };
  }

  return {
    cfg, isRunning, wake, stop, detectApps, windows, screenshot, analyze, sendText, checkAndReply,
    scanUnread, ensureAppAlive, sendImageToUser,
    status: async () => ({ running: await isRunning(), apps: await (probeTcp(2222) ? detectApps() : []), last }),
  };
}
