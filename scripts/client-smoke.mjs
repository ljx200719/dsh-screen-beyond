// 原生客户端产物冒烟（不依赖浏览器/真实运行时）：
//   · 把 lib/client.js（构建产物）在 Node 里用迷你 React + 假 DOM 加载；
//   · 验证 apply() 注册 3 个挂载点（侧栏入口/主面板/设置入口）；
//   · 验证 6 个标签都能挂载渲染、无 iframe、不请求任何 HTML 页面；
//   · 用假 fetch 验证关键交互发的是预期请求（发消息/点地点/打开屏幕/切标签）。
//
// 设计说明：这是"代码路径冒烟"，不是视觉验证——真实观感要在 DSH 面板里人眼看。
// 跑法：node scripts/client-smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'lib', 'client.js');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail || '' });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}

// ───────────────────────── 迷你 React（只实现客户端用到的 6 个 API） ─────────────────────────
let instances = new Map();
let currentInst = null;
let dirty = false;
let pendingEffects = [];
const effectErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function depsEqual(a, b) {
  if (a === undefined || b === undefined) return false;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
function getInst(p, type) {
  let inst = instances.get(p);
  if (inst && inst.type !== type) inst = null;
  if (!inst) { inst = { path: p, type, slots: [], hookIndex: 0 }; instances.set(p, inst); }
  return inst;
}
function useState(initial) {
  const inst = currentInst;
  const i = inst.hookIndex++;
  let slot = inst.slots[i];
  if (!slot) { slot = { state: typeof initial === 'function' ? initial() : initial }; inst.slots[i] = slot; }
  const set = (v) => {
    const next = typeof v === 'function' ? v(slot.state) : v;
    if (!Object.is(next, slot.state)) { slot.state = next; dirty = true; }
  };
  return [slot.state, set];
}
function useRef(initial) {
  const inst = currentInst;
  const i = inst.hookIndex++;
  if (!inst.slots[i]) inst.slots[i] = { current: initial };
  return inst.slots[i];
}
function useCallback(fn, deps) {
  const inst = currentInst;
  const i = inst.hookIndex++;
  const slot = inst.slots[i];
  if (!slot || !depsEqual(slot.deps, deps)) inst.slots[i] = { fn, deps };
  return inst.slots[i].fn;
}
function useMemo(fn, deps) {
  const inst = currentInst;
  const i = inst.hookIndex++;
  const slot = inst.slots[i];
  if (!slot || !depsEqual(slot.deps, deps)) inst.slots[i] = { value: fn(), deps };
  return inst.slots[i].value;
}
function useEffect(create, deps) {
  const inst = currentInst;
  const i = inst.hookIndex++;
  pendingEffects.push({ inst, i, create, deps });
}
function createElement(type, props, ...children) {
  const p = Object.assign({}, props || {});
  if (children.length === 1) p.children = children[0];
  else if (children.length > 1) p.children = children;
  return { $$el: true, type, props: p, children };
}
// 迷你 React 只实现客户端用到的 API；class 组件（错误边界）也要能挂载
class MiniComponent {
  constructor(props) { this.props = props || {}; this.state = this.state || {} }
  setState(patch) {
    const next = typeof patch === 'function' ? patch(this.state) : patch
    this.state = Object.assign({}, this.state, next || {})
    dirty = true
  }
}
MiniComponent.prototype.isReactComponent = {}
const React = {
  createElement, Fragment: 'Fragment',
  useState, useEffect, useCallback, useRef, useMemo,
  useLayoutEffect: useEffect, memo: (x) => x,
  Component: MiniComponent, PureComponent: MiniComponent,
};

// ───────────────────────── 假 DOM / window / localStorage ─────────────────────────
const openedWindows = [];
const fakeDocument = {
  visibilityState: 'visible',
  getElementById() { return null },
  createElement() { return { style: {}, id: '', textContent: '', appendChild() {}, remove() {} } },
  head: { appendChild() {} },
  body: { appendChild() {} },
  addEventListener() {}, removeEventListener() {},
  documentElement: { style: {}, dataset: {} },
};
const fakeWindow = {
  addEventListener() {}, removeEventListener() {},
  open(url) { openedWindows.push(String(url)); return { closed: false } },
};
const fakeLocalStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null },
  setItem(k, v) { this._m.set(k, String(v)) },
  removeItem(k) { this._m.delete(k) },
};

// ───────────────────────── 假 fetch：按路径返回合成的示例数据 ─────────────────────────
const NOW = Date.now();
const state = { messages: [
  { id: 1, role: 'user', text: '在吗', at: NOW - 60000 },
  { id: 2, role: 'her', text: '在的呀', at: NOW - 30000 },
  { id: 3, role: 'her', text: '', image: '/images/demo.png', at: NOW - 20000 },
  { id: 4, role: 'system', text: '她走到你身边了', at: NOW - 10000 },
] };
const place = { mapId: 'map-main', mapName: '小鱼镇', placeId: 'home', name: '家', icon: '🏠', desc: '小窝', feel: '放松', since: NOW - 180000, minutes: 3, manual: false, reason: '', traveling: null };
const mapPayload = {
  id: 'map-main', name: '小鱼镇', widthMeters: 2000, theme: 'town', displayMode: '2d',
  image: { url: '/official-map.jpg' }, has2d: true, has3d: false, model: null, roads: null, vehicles: null,
  places: [
    { id: 'home', name: '家', icon: '🏠', x: 0.5, y: 0.55, desc: '她自己的小窝', feel: '放松' },
    { id: 'cafe', name: '咖啡店', icon: '☕', x: 0.32, y: 0.28, desc: '咖啡香', feel: '安静' },
  ],
};
const character = { id: 'xiaojing', name: '小鲸', avatar: '/default-avatar.png' };
const status = {
  version: '0.8.0', typing: false, busy: false, lastTurnAt: 0, count: state.messages.length,
  setup: { dataRoot: 'D:\\demo-data', apiKeyOk: true, characters: 1 },
  tokens: { remainingTokens: 1000000, usedTokens: 1000, dailyUsed: 20, tokenBudget: 2000000, moneyType: 'token', tokenMode: false, spendable: 328, balance: 328, date: '2026-11-14', realRmb: 10, realBalanceKnown: true },
  model: 'deepseek-flash', modelConfig: { name: 'deepseek-flash', reasoningEffort: 'low', temperature: 0.9, maxTokens: 900, maxSteps: 20 },
  context: { historyMode: 'full', memoryInject: 8 }, mode: 'full',
  place, character, memory: { total: 2, live: 2, archived: 0, core: 0, strongest: [] }, diaryToday: false, energy: 72,
};
const FI = {
  '/api/token': { ok: true, token: '' },
  '/api/status': status,
  '/api/events': { messages: state.messages, typing: false, lastTurnAt: 0, usage: null, mode: 'full' },
  '/api/economy': { wallet: { balance: 328, spendable: 328, tokenMode: false }, realBalance: { ok: true, total: 10, todayRmb: 0.5 } },
  '/api/stage': {
    ok: true, apiVersion: 1, serverTime: NOW,
    character: { id: 'xiaojing', name: '小鲸', avatar: '/default-avatar.png', sprite: '', chibi: null, model: { type: 'none', url: '', scale: 1 }, age: 20, license: false },
    map: mapPayload, location: { state: 'stationary', placeId: 'home', placeName: '家', icon: '🏠', since: NOW - 180000, minutes: 3, traveling: null },
    weather: { kind: 'sunny', label: '晴', icon: '☀️', temp: 21, city: null, source: 'manual', fx: {} },
    energy: 72, wallet: { balance: 328, spendable: 328, tokenMode: false },
    settings: { weatherMode: 'manual', smartRoutine: true, smartLife: true, locationFree: true }, animationHint: 'idle',
  },
  '/api/map': {
    maps: [{ id: 'map-main', name: '小鱼镇', placeCount: 2 }], activeMapId: 'map-main', map: mapPayload,
    transports: { walk: { label: '走路', icon: '🚶', speed: 1 } }, longTransports: ['coach', 'rail', 'plane'],
    capabilities: {}, weather: 'sunny', weathers: { sunny: { label: '晴', icon: '☀️' } }, energy: 72,
    location: place, schedules: [],
  },
  '/api/map/preview': { ok: true, map: mapPayload, activeMapId: 'map-main', maps: [{ id: 'map-main', name: '小鱼镇' }], location: place },
  '/api/persona': { meta: { name: '小鲸', userCall: '你', relation: '住在一起', age: 20, license: false, travelPref: 'auto', examples: ['早呀'], traits: { 话多: 6 }, model: { type: 'none', url: '', scale: 1 } }, body: '# 人设\n\n她很温柔。', rev: 1 },
  '/api/characters': { characters: [{ id: 'xiaojing', name: '小鲸', avatar: '/default-avatar.png', isActive: true }], active: 'xiaojing' },
  '/api/context': { context: { historyMode: 'full', memoryInject: 8 }, historyKeep: 10, summary: '' },
  '/api/mode': { mode: 'full', effective: 'full', detected: {} },
  '/api/life': { life: { enabled: true, heartbeatMin: 30, schedules: [{ time: '07:00', label: '起床', days: [], place: 'home' }], activities: [{ label: '发呆', weight: 1, minMin: 10, maxMin: 30 }], proactiveEnabled: true, proactiveMinMin: 90, proactiveMaxMin: 240, proactiveQuietStart: 23, proactiveQuietEnd: 7, diaryHour: 22, diaryAuto: true, smartLife: true } },
  '/api/life/settings': { ok: true, settings: { enabled: true, minEventGapMin: 30, maxDaily: 10, quietStart: 23, quietEnd: 7, photoChance: 0.2 } },
  '/api/life/states': { ok: true, states: [{ characterId: 'xiaojing', name: '小鲸', placeName: '家', activity: '发呆', energy: 72 }] },
  '/api/routine': { routine: { smart: true }, visits: {}, places: [{ id: 'home', name: '家', icon: '🏠' }], character: '小鲸' },
  '/api/weather': { ok: true, mode: 'manual', weather: 'sunny', weathers: { sunny: { label: '晴', icon: '☀️', fx: null } } },
  '/api/weatherfx': { ok: true, fx: {}, kinds: ['sunny', 'rain'] },
  '/api/model': { model: { name: 'deepseek-flash', reasoningEffort: 'low', temperature: 0.9, maxTokens: 900, maxSteps: 20 }, usage: { prompt_tokens: 100, completion_tokens: 50 } },
  '/api/image/config': { config: { provider: 'seedream', baseURL: '', model: '', size: '1024x1024', watermark: false, enabled: true, apiKeySet: false } },
  '/api/chat-style': { style: { noParens: false } },
  '/api/token-saving': { saving: { dynamicTools: false, compressImage: true, batchActions: false } },
  '/api/memory': { stats: { live: 2, core: 1, archived: 0 }, params: { halfLifeDays: 5, forgetThreshold: 0.12, reinforceBoost: 1.2, maxInjected: 8 }, facts: [{ id: 1, text: '她喜欢喝咖啡', strength: 0.9, pinned: true, archived: false }], archived: [], diaryDates: [], rev: 1 },
  '/api/diary': { dates: [] },
  '/api/backup/list': { ok: true, dir: 'D:\\demo-data\\backups', backups: [{ name: 'backup-20261114', size: 1024, at: NOW }] },
  '/api/data/revisions': { ok: true, version: 1, deviceId: 'demo', updatedAt: NOW, entities: {} },
  '/api/tutorial': { text: '# 使用说明\n\n这是教程正文。' },
  '/api/vm-chat/settings': { ok: true, settings: { enabled: false, checkMessages: true, autoStart: true, idleShutdown: true, checkIntervalMin: 15, targetContact: '', unreadScan: false, watchdog: true, sendImages: true } },
  '/api/vm-chat/status': { ok: true, status: { running: false, apps: [], last: null } },
  '/api/screen/info': { ok: true, spaceUrl: 'http://127.0.0.1:6081/vnc.html', pc: true, phone: true },
  '/api/screen/space/status': { ok: true, vm: false, http: false, chain: null, healing: false, url: 'http://127.0.0.1:6081/vnc.html' },
  '/api/resources': { space: false, phone: false, mem: ['free:8000MB'] },
  '/api/pet/status': { running: false, character: '小鲸', placeName: '家', activity: '发呆', energy: '状态不错', lastHer: '' },
  '/api/pet/manifest': { pet: { name: '小鲸' }, status: { running: false } },
  '/api/pet': { running: false, pid: 0, pet: {} },
  '/api/version': { ok: true, apiVersion: 2, version: '0.8.0', minClient: '0.8.0', dataRoot: 'D:\\demo-data', auth: { mode: 'loopback' }, features: { chat: true, stage2d: true, mapEdit: true, legacyWeb: false }, schema: { contract: 'docs/API-CONTRACT.md' }, endpoints: {} },
  '/api/env': { env: { off: { pc: [], space: [], phone: [] }, gui: {}, code: {}, selfStart: false }, resources: {} },
  '/api/env/check': { ok: true, checks: [], hints: [], paths: {} },
  '/api/env/install-adbkeyboard': { ok: false, error: '未模拟' },
  '/api/scene/settings': { ok: true, ai: true, photoChance: 0.25 },
  '/api/balance-alert': { ok: true, alert: { enabled: false, threshold: 5, cooldownMin: 60 } },
  '/api/watch-screen': { ok: true, watch: { enabled: false, minMinutes: 12, maxMinutes: 30 } },
  '/api/world/characters': { characters: [], activeMapId: 'map-main' },
  '/api/travel/options': { ok: true, from: { id: 'map-main', name: '小鱼镇' }, wallet: { spendable: 328 }, options: [] },
  '/api/location': { ok: true, location: place },
  '/api/chat': { ok: true },
  '/api/chat/cancel': { ok: true, typing: false },
  '/api/dsh-not-used': {},
};
// /api/stream 不在 FI 里 → 返回 500，让 Api.stream 抛错（客户端要能兜住）
const requests = [];
function jsonResp(statusCode, data) {
  return { ok: statusCode >= 200 && statusCode < 300, status: statusCode, json: async () => data, text: async () => JSON.stringify(data) };
}
async function fakeFetch(url, opts) {
  const o = opts || {};
  const method = String(o.method || 'GET').toUpperCase();
  const u = String(url);
  const pathname = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  requests.push({ method, path: pathname, url: u, body: o.body ? String(o.body) : '' });
  if (pathname === '/dsh-screen-beyond/info') return jsonResp(200, { ok: true, url: 'http://127.0.0.1:8900', port: 8900, version: '0.8.0' });
  if (pathname === '/api/events') {
    const since = Number((u.split('since=')[1] || '0').split('&')[0]) || 0;
    return jsonResp(200, { messages: state.messages.filter((m) => Number(m.id) > since), typing: false, usage: null, mode: 'full' });
  }
  if (pathname === '/api/stream') return jsonResp(500, { ok: false, error: '未模拟 SSE' });
  if (pathname === '/api/chat') {
    const body = o.body ? JSON.parse(o.body) : {};
    if (!body.text) return jsonResp(400, { ok: false, error: '空消息' });
    state.messages = state.messages.concat({ id: state.messages.length + 1, role: 'user', text: body.text, at: Date.now() });
    return jsonResp(200, { ok: true });
  }
  if (FI[pathname]) return jsonResp(200, FI[pathname]);
  return jsonResp(404, { ok: false, error: '未模拟接口 ' + pathname });
}

// ───────────────────────── 加载构建产物（模拟 DSH 客户端半的加载方式） ─────────────────────────
const registered = {};
const fakeSlots = {
  inject(name, fn) { fn() },
  register(opts, comp) {
    registered[opts.name] = registered[opts.name] || [];
    registered[opts.name].push({ options: opts, component: comp });
    return () => {};
  },
};
let captured = null;
const fakeWindowWithLoader = Object.assign({}, fakeWindow, {
  __ModuleLoader__: { load(spec) { captured = spec } },
  __sbcOpenTab: undefined,
});
let clientExports = null;
const clientCode = fs.existsSync(CLIENT) ? fs.readFileSync(CLIENT, 'utf8') : '';
check('lib/client.js 存在', !!clientCode, 'len=' + clientCode.length);
try {
  // 用与 DSH 客户端半相同的入参执行产物：window/document/localStorage/fetch 都是桩
  const runBundle = new Function(
    'window', 'document', 'localStorage', 'fetch', 'setInterval', 'clearInterval',
    'AbortSignal', 'AbortController', 'URL', 'TextDecoder', 'setTimeout', 'navigator', 'location',
    clientCode,
  );
  runBundle(
    fakeWindowWithLoader, fakeDocument, fakeLocalStorage, fakeFetch, () => 0, () => {},
    AbortSignal, AbortController, URL, TextDecoder, setTimeout, { userAgent: 'node-smoke' }, { href: 'http://127.0.0.1:52908/' },
  );
} catch (e) {
  check('构建产物可执行（无语法/顶层错误）', false, String((e && e.stack) || e).slice(0, 400));
}
check('产物调用 __ModuleLoader__.load（含 id 与 factory）', !!captured && captured.id === 'dsh-screen-beyond' && typeof captured.factory === 'function', captured ? String(captured.id) : 'captured=null');
if (captured) {
  try {
    clientExports = captured.factory((name) => (name === 'react' ? React : {}));
    check('factory 返回 apply/inject', typeof clientExports.apply === 'function' && Array.isArray(clientExports.inject), 'inject=' + JSON.stringify(clientExports && clientExports.inject));
    check('产物带 native 构建标记', !!(clientExports.clientBuild && clientExports.clientBuild.native), JSON.stringify(clientExports && clientExports.clientBuild));
  } catch (e) {
    check('factory 可执行', false, String((e && e.stack) || e).slice(0, 400));
  }
}
// 不含 iframe / 不请求 HTML 页面（静态）
check('产物不含 iframe（N01）', !/<iframe/i.test(clientCode) && !/createElement\(\s*['"]iframe['"]\s*\)/i.test(clientCode), '');
check('产物不请求旧 HTML 页面', !/['"]\/(?:map|settings|stage|model|screen|chat)\.html['"]/.test(clientCode), '');

// ───────────────────────── 渲染树工具 ─────────────────────────
function renderNode(node, p) {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  if (Array.isArray(node)) return node.map((n, i) => renderNode(n, p + '[' + i + ']')).filter(Boolean);
  if (!node || !node.$$el) return { text: '[?]' };
  const type = node.type;
  if (typeof type === 'function') {
    // class 组件（错误边界）：new 出来调 render
    if (type.prototype && type.prototype.isReactComponent) {
      const cinst = getInst(p, type);
      try {
        if (!cinst.obj) cinst.obj = new type(node.props);
        cinst.obj.props = node.props;
        const cout = cinst.obj.render();
        return { component: type.name || 'anon', path: p, props: node.props, tree: renderNode(cout, p + '>') };
      } catch (e) {
        return { text: '[render-error ' + ((e && e.message) || e) + ']', error: true };
      }
    }
    const inst = getInst(p, type);
    const prev = currentInst;
    currentInst = inst;
    inst.hookIndex = 0;
    let out;
    try { out = type(node.props); }
    catch (e) { return { text: '[render-error ' + ((e && e.message) || e) + ']', error: true }; }
    finally { currentInst = prev; }
    return { component: type.name || 'anon', path: p, props: node.props, tree: renderNode(out, p + '>') };
  }
  if (typeof type === 'string') {
    const kids = (node.children || []).map((c, i) => renderNode(c, p + '/' + i));
    return { tag: type, props: node.props, children: flatten(kids) };
  }
  return { text: '[?' + String(type) + ']' };
}
function flatten(list) {
  const out = [];
  for (const x of list) { if (Array.isArray(x)) out.push(...flatten(x)); else if (x) out.push(x) }
  return out;
}
function runEffects() {
  const queue = pendingEffects;
  pendingEffects = [];
  for (const item of queue) {
    const slot = item.inst.slots[item.i];
    if (slot && depsEqual(slot.deps, item.deps)) continue;
    if (slot && typeof slot.cleanup === 'function') { try { slot.cleanup() } catch (e) {} }
    const next = slot || { deps: undefined, cleanup: undefined };
    next.deps = item.deps;
    try {
      const cleanup = item.create();
      next.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    } catch (e) {
      next.cleanup = undefined;
      effectErrors.push('effect in ' + (item.inst.type.name || 'anon') + ': ' + ((e && e.message) || e));
    }
    item.inst.slots[item.i] = next;
  }
}
function renderRoot(Comp, props) {
  pendingEffects = [];
  const tree = renderNode({ $$el: true, type: Comp, props: props || {}, children: [] }, 'root');
  runEffects();
  return tree;
}
async function mount(Comp, props) {
  instances = new Map();
  dirty = false;
  effectErrors.length = 0;
  let tree = renderRoot(Comp, props);
  let last = Date.now();
  for (let i = 0; i < 80; i++) {
    await sleep(15);
    if (dirty) { dirty = false; tree = renderRoot(Comp, props); last = Date.now(); }
    else if (Date.now() - last > 250) break;
  }
  return tree;
}
async function pump(Comp, props, tree) {
  let cur = tree;
  for (let i = 0; i < 10; i++) {
    await sleep(15);
    if (dirty) { dirty = false; cur = renderRoot(Comp, props); } else if (i > 3) break;
  }
  return cur;
}
function collectText(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, out)); return }
  if (node.text !== undefined) { out.push(node.text); return }
  if (node.tree) { collectText(node.tree, out); return }
  if (node.children) node.children.forEach((c) => collectText(c, out));
}
function allText(tree) { const out = []; collectText(tree, out); return out.join('|'); }
function collectTags(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectTags(n, out)); return }
  if (node.tree) { collectTags(node.tree, out); return }
  if (node.tag) out.push(node.tag);
  if (node.children) node.children.forEach((c) => collectTags(c, out));
}
function collectButtons(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectButtons(n, out)); return }
  if (node.tree) { collectButtons(node.tree, out); return }
  if (node.tag === 'button' && node.props && typeof node.props.onClick === 'function') {
    const t = []; collectText(node, t);
    out.push({ label: t.join('').trim(), onClick: node.props.onClick });
    return;
  }
  if (node.children) node.children.forEach((c) => collectButtons(c, out));
}
function collectControls(node, out) {
  if (!node) return;
  if (Array.isArray(node)) { node.forEach((n) => collectControls(n, out)); return }
  if (node.tree) { collectControls(node.tree, out); return }
  if (node.tag === 'input' || node.tag === 'textarea' || node.tag === 'select') {
    const p = node.props || {};
    out.push({ tag: node.tag, type: p.type, placeholder: p.placeholder, value: p.value, onChange: p.onChange });
  }
  if (node.children) node.children.forEach((c) => collectControls(c, out));
}
async function pressButton(Comp, props, tree, pred) {
  const btns = [];
  collectButtons(tree, btns);
  const b = btns.find(pred);
  if (!b) return { ok: false, tree };
  try {
    const r = b.onClick();
    if (r && typeof r.then === 'function') await Promise.race([r.catch(() => {}), sleep(400)]);
  } catch (e) {
    return { ok: true, tree, threw: (e && e.message) || String(e) };
  }
  const next = await pump(Comp, props, tree);
  return { ok: true, tree: next, button: b };
}

// ───────────────────────── 主流程 ─────────────────────────
async function run() {
  if (!clientExports) { finish(); return }
  // 1) apply() 注册检查
  try {
    clientExports.apply({ get: (name) => (name === 'slots' ? fakeSlots : undefined) });
    check('apply 注册侧栏入口 sidebar.panellist', !!(registered['sidebar.panellist'] && registered['sidebar.panellist'].some((x) => x.options.id === 'companion' && x.options.label() === '屏幕彼端')), Object.keys(registered).join(','));
    check('apply 注册主面板 main(key=companion)', !!(registered.main && registered.main.some((x) => x.options.key === 'companion' && typeof x.component === 'function')), '');
    check('apply 注册设置入口 settings.section', !!(registered['settings.section'] && registered['settings.section'].some((x) => x.options.id === 'companion-settings')), '');
  } catch (e) {
    check('apply 执行不抛异常', false, String((e && e.stack) || e).slice(0, 400));
  }
  const AppShell = (registered.main && registered.main.find((x) => x.options.key === 'companion') || {}).component;
  check('AppShell 组件存在', typeof AppShell === 'function', typeof AppShell);

  // 2) AppShell 渲染 + 标签挂载
  if (typeof AppShell === 'function') {
    let tree = await mount(AppShell, {});
    let text = allText(tree);
    check('AppShell 渲染不抛异常', effectErrors.length === 0 && text.indexOf('[render-error') < 0, (effectErrors.slice(0, 2).join(';') || '').slice(0, 300));
    check('AppShell 顶部状态显示角色名（来自 /api/status）', text.indexOf('小鲸') >= 0, '');
    check('AppShell 显示所在地', text.indexOf('家') >= 0, '');
    const tabLabels = ['聊天', '舞台', '地图', '设置', '屏幕', '关于'];
    const missingTabs = tabLabels.filter((l) => text.indexOf(l) < 0);
    check('AppShell 六个标签都在', missingTabs.length === 0, missingTabs.length ? '缺少 ' + missingTabs.join(',') : '');
    const tags = [];
    collectTags(tree, tags);
    check('AppShell 渲染树无 iframe（N01）', tags.indexOf('iframe') < 0, '');
    check('AppShell 不请求任何 HTML 页面', !requests.some((r) => /\.html(?:$|\?)/.test(r.path)), requests.filter((r) => /\.html/.test(r.path)).map((r) => r.path).join(','));

    // 聊天：历史消息 + 发送
    check('聊天渲染历史消息', text.indexOf('在的呀') >= 0 && text.indexOf('在吗') >= 0, '');
    const controls = [];
    collectControls(tree, controls);
    const box = controls.find((c) => c.tag === 'textarea');
    if (box && typeof box.onChange === 'function') {
      box.onChange({ target: { value: '原生面板冒烟消息' } });
      tree = await pump(AppShell, {}, tree);
      const sendStep = await pressButton(AppShell, {}, tree, (b) => /发送/.test(b.label));
      tree = sendStep.ok ? sendStep.tree : tree;
      const chatReq = requests.filter((r) => r.method === 'POST' && r.path === '/api/chat').pop();
      const body = chatReq ? JSON.parse(chatReq.body) : null;
      check('聊天发送 POST /api/chat 且文本正确', !!body && body.text === '原生面板冒烟消息', chatReq ? chatReq.body.slice(0, 120) : '没有发出 POST /api/chat');
    } else {
      check('聊天输入框存在', false, '找不到 textarea');
    }

    // 舞台标签：点击后渲染地图地点
    let step = await pressButton(AppShell, {}, tree, (b) => b.label === '舞台');
    check('切到舞台标签', step.ok, '');
    tree = step.tree;
    // 新挂载的视图要拉 /api/stage，多泵几轮等 effect 完成
    tree = await pump(AppShell, {}, tree);
    tree = await pump(AppShell, {}, tree);
    const stageText = allText(tree);
    const stageReqs = requests.filter((r) => r.path === '/api/stage').length;
    check('舞台渲染地点（家/咖啡店）', stageText.indexOf('咖啡店') >= 0, 'stage请求=' + stageReqs + ' text=' + stageText.slice(-200).replace(/\|/g, ' '));
    if (process.env.SMOKE_DEBUG) {
      const onlyPathForDebug = process.env.SMOKE_DEBUG_PATH || '';
      const dump = (node, depth, onlyPath) => {
        if (!node) return;
        if (Array.isArray(node)) { node.forEach((n, i) => dump(n, depth, onlyPath)); return }
        if (node.text !== undefined) { if (onlyPath) console.log('  '.repeat(depth) + '"' + String(node.text).slice(0, 40) + '"'); return }
        if (node.component) {
          const t = []; collectText(node, t);
          const p = String(node.path || '');
          const inside = onlyPath ? p.indexOf(onlyPath) === 0 : false;
          if (!onlyPath || inside) console.log('  '.repeat(depth) + '[' + node.component + '] ' + p + ' len=' + t.join('').length + ' head=' + t.join(' ').slice(0, 50));
          dump(node.tree, depth + 1, onlyPath);
          return;
        }
        if (node.tag) {
          const p = String(node.path || '');
          const inside = onlyPath ? p.indexOf(onlyPath) === 0 : false;
          if (!onlyPath || inside) console.log('  '.repeat(depth) + '<' + node.tag + '> ' + p);
        }
        if (node.children) node.children.forEach((c) => dump(c, depth + 1, onlyPath));
      };
      console.log('--- DEBUG TREE (StageView subtrees) ---');
      dump(tree, 0, onlyPathForDebug);
      console.log('--- requests ---', requests.map((r) => r.method + ' ' + r.path).join(', '));
    }
    const stageTags = [];
    collectTags(tree, stageTags);
    check('舞台渲染树无 iframe', stageTags.indexOf('iframe') < 0, '');

    // 地图标签
    step = await pressButton(AppShell, {}, tree, (b) => b.label === '地图');
    check('切到地图标签', step.ok, '');
    tree = step.tree;
    const mapText = allText(tree);
    check('地图渲染地图名与地点', mapText.indexOf('小鱼镇') >= 0 && mapText.indexOf('咖啡店') >= 0, '');

    // 设置标签
    step = await pressButton(AppShell, {}, tree, (b) => b.label === '设置');
    check('切到设置标签', step.ok, '');
    tree = step.tree;
    const setText = allText(tree);
    check('设置渲染核心分类', ['角色', '生活', '模型', '数据'].every((k) => setText.indexOf(k) >= 0), '');

    // 屏幕标签
    step = await pressButton(AppShell, {}, tree, (b) => b.label === '屏幕');
    check('切到屏幕标签', step.ok, '');
    tree = step.tree;
    const screenText = allText(tree);
    check('屏幕标签有「打开她的屏幕」且无内嵌网页', screenText.indexOf('打开她的屏幕') >= 0, '');
    const screenTags = [];
    collectTags(tree, screenTags);
    check('屏幕渲染树无 iframe（她的屏幕走外部浏览器）', screenTags.indexOf('iframe') < 0, '');
    const openStep = await pressButton(AppShell, {}, tree, (b) => /打开她的屏幕/.test(b.label));
    tree = openStep.ok ? openStep.tree : tree;
    const vnc = openedWindows.filter((u) => u.indexOf('vnc.html') >= 0);
    check('点「打开她的屏幕」交给外部浏览器（window.open noVNC）', vnc.length > 0, vnc[vnc.length - 1] || '没有 window.open');

    // 关于标签
    step = await pressButton(AppShell, {}, tree, (b) => b.label === '关于');
    check('切到关于标签', step.ok, '');
    tree = step.tree;
    check('关于标签显示运行时/API 版本信息', /API 版本|运行时/.test(allText(tree)), '');
  }

  // 3) 兜底：ChatView/StageView 等以函数声明存在（万一外壳重构也能定位到具体模块）
  const moduleFns = ['ChatView', 'StageView', 'MapView', 'SettingsView', 'ScreenView', 'PetCard', 'openHerScreen'];
  for (const name of moduleFns) {
    let ok = true;
    try { ok = clientCode.indexOf('function ' + name) >= 0 || clientCode.indexOf('async function ' + name) >= 0 }
    catch (e) { ok = false }
    check('模块入口存在：' + name, ok, '');
  }
  finish();
}

function finish() {
  const fails = results.filter((r) => !r.ok);
  console.log('');
  console.log('结果：' + (results.length - fails.length) + '/' + results.length + ' 通过');
  if (fails.length) {
    console.log('失败项：');
    fails.forEach((f) => console.log(' - ' + f.name + ' :: ' + f.detail));
  }
  // 桩组件/超时定时器可能还挂着真实 timer，直接退出，避免脚本"跑完了还在等"
  process.exit(fails.length ? 1 : 0);
}
run().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2) });
