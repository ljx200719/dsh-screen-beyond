/**
 * 虚拟机社交软件通道（基础版）
 *
 * 不绑定具体软件：先检测 VM 里有哪些 Network/Chat 类应用，再由 AI 看屏幕选应用。
 * 依赖：
 *  - VirtualBox（DSH-Space）
 *  - D:\dsh-env\agent_ssh.py / space_ctl.py
 *  - 宿主机多模态 chatCompletion
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
      resolve({ ok: !err, out: String((stdout || '') + (stderr || '')).slice(0, 12000), err: err ? String(err.message) : '' });
    });
  });
}

export function createVmChat({ runPy, probeTcp, chatCompletion, getSettings, saveSettings, getCharacter, dataRoot, log }) {
  const cfg = () => ({ ...(getSettings() || {}) });
  let last = null;
  let busy = false;

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
    return String((msg && msg.content) || '');
  }

  async function vision(prompt, imagePath) {
    const img = imagePath ? dataUrl(imagePath) : '';
    if (!img) return null;
    const first = await visionOnce(prompt, img, 2400);
    const parsed = parseObj(first);
    if (parsed) return parsed;
    // 长提示词有时会被推理吃掉；用短提示再要一次纯 JSON
    const shortPrompt = '看这张 Linux 虚拟机截图。右侧气泡是自己发的，左侧是对方发的。只输出一行 JSON，不要 markdown、不要解释：{"appName":"当前聊天软件","conversation":"当前会话","conversationRow":{"x":0,"y":0},"recent":[{"from":"自己|对方","text":""}],"lastFrom":"自己|对方","needReply":false,"reply":"要回就写一句自然回复","composer":{"x":0,"y":0},"note":"简述"}；composer 是输入框中心，坐标按屏幕 0-1000 归一化。';
    const second = await visionOnce(shortPrompt, img, 1200);
    return parseObj(second);
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
    let wins = await visibleWindows();
    if (!wins.some((w) => /qq|telegram|discord|wechat|signal|element|slack|messages?/i.test(w))) {
      await ensureApp();
      wins = await visibleWindows();
    }
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
只输出 JSON：
{"appId":"哪个应用","appName":"","conversation":"当前会话名","conversationRow":{"x":0,"y":0},"recent":[{"from":"自己|对方","text":"","time":""}],"lastFrom":"自己|对方","unread":[{"from":"","text":""}],"composer":{"x":0,"y":0},"send":{"x":0,"y":0},"needReply":false,"reply":"如果要回，写一句自然回复","note":"你看到了什么"}
${extra}`;
    const v = await vision(prompt, shot);
    return { ok: true, apps, windows: wins, screen: shot, analysis: v };
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
      if (!composer || !Number.isFinite(Number(composer.x)) || !Number.isFinite(Number(composer.y))) {
        return { ok: false, error: '没找到输入框', analysis: an, screen: null };
      }
      const pos = await typeAt(text, composer);
      last = { at: Date.now(), action: 'send', ok: true, text, verify: null };
      return { ok: true, sentAt: pos, analysis: an, screen: null };
    } catch (e) {
      return { ok: false, error: String(e.message) };
    } finally {
      busy = false;
    }
  }

  let lastHandled = null;
  async function checkAndReply() {
    if (busy) return { ok: false, error: 'busy' };
    let a = await analyze('看当前聊天软件的当前会话最近消息。左侧是对方（用户）发的，右侧是自己发的。判断最后一条是不是对方发的、要不要回；要回就给一句自然的回复。');
    if (a.ok && !a.analysis) {
      await ensureApp();
      a = await analyze('看当前聊天软件的当前会话最近消息。左侧是对方（用户）发的，右侧是自己发的。判断最后一条是不是对方发的、要不要回；要回就给一句自然的回复。');
    }
    if (!a.ok || !a.analysis) return a;
    let an = a.analysis;
    if (/登录|验证|扫码|login|验证码/i.test(String(an.note || '')) && !(Array.isArray(an.recent) && an.recent.length)) {
      last = { at: Date.now(), action: 'check', loginRequired: true };
      return { ok: true, unread: 0, recent: 0, requiresLogin: true, analysis: an, screen: a.screen };
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
      return { ok: true, unread: 0, recent: 0, analysis: an };
    }
    if (lastFrom !== '对方' && !/对方/.test(lastFrom) && !userMsgs.length) {
      last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length };
      return { ok: true, unread: 0, recent: recent.length, analysis: an };
    }
    if (key && key === lastHandled) {
      last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length, duplicate: true };
      return { ok: true, unread: 0, recent: recent.length, duplicate: true, analysis: an };
    }
    let sent = null;
    if (an.needReply && an.reply) {
      sent = await sendText(an.reply, { appId: an.appId, composer: an.composer, conversation: an.conversation });
      if (sent && sent.ok) lastHandled = key;
    }
    last = { at: Date.now(), action: 'check', unread: 0, recent: recent.length, analysis: an };
    return { ok: true, unread: 0, recent: recent.length, sent, analysis: an, screen: a.screen };
  }

  return {
    cfg, isRunning, wake, stop, detectApps, windows, screenshot, analyze, sendText, checkAndReply,
    status: async () => ({ running: await isRunning(), apps: await (probeTcp(2222) ? detectApps() : []), last }),
  };
}
