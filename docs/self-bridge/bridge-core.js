// 屏幕彼端 · 自建 QQ 桥（运行在 QQ 主进程内；通过渲染进程 DOM 收/发消息）
// 对外提供 OneBot 11 的极小子集，端口 127.0.0.1:3010
//
// 相对第一版（0.1.0）的优化：
//  · 发送串行队列 + 最小间隔，避免连发把 QQ 输入框/发送按钮打乱
//  · 发送前自动切会话、等输入框就绪、失败自动重试（默认 2 次）
//  · 收消息按「自身/对方 + 文本」签名去重（10 分钟 TTL），切换会话后不会把旧消息当新消息
//  · 渲染进程执行加超时；聊天窗口重新加载后自动重新定位 webContents
//  · /get_status 返回完整自检信息（事件数、最后收发时间、最后错误、运行时长）
//  · 可选访问 token（只监听 127.0.0.1；token 为空=仅本机不需要鉴权）
//  · HTTP 端口被占用/服务异常时自动重试监听；日志超过 2MB 自动轮转
function startBridge(ctx) {
  const { electron, http, fs } = ctx
  const LOG = 'F:/onebot/next/bridge.log'
  const CFG = {
    selfId: '3762970669',
    peerId: '3655792727',
    peerName: 'aedo',
    port: 3010,
    runtimeEventUrl: 'http://127.0.0.1:8900/api/direct-chat/event',
    pollMs: 1200,
    token: '',            // 可选：填了之后除 /ping 外都要 Authorization: Bearer <token>
    minSendGapMs: 900,    // 两次发送的最小间隔
    sendRetries: 2,
    execTimeoutMs: 8000,
    logMaxBytes: 2 * 1024 * 1024,
  }
  const state = {
    version: '0.2.0', started: false, startedAt: Date.now(),
    lastSig: '', seen: {}, seenAt: {},
    events: 0, lastIncomingAt: 0, lastSendAt: 0, lastError: '',
    lastPollAt: 0, lastStatusAt: 0, sends: 0, sendFails: 0,
    wcId: 0, serverRetry: null,
  }
  function log(o) {
    try {
      try { if (fs.statSync(LOG).size > CFG.logMaxBytes) fs.renameSync(LOG, LOG + '.1') } catch (e) {}
      fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + JSON.stringify(o) + '\n')
    } catch (e) {}
  }
  // F-019：注入到底成没成，先留一条 boot-probe。
  // 之前只能靠"有没有 listening"反推，注入没成功时日志里什么都看不到，
  // 现在：boot-probe 出现 = 代码真的在 QQ 进程里跑起来了；listening 出现 = 端口起来了。
  try {
    log({ step: 'boot-probe', version: state.version, pid: (ctx && ctx.process && ctx.process.pid) || 0, electron: !!electron, at: new Date().toISOString() })
  } catch (e) {}
  // ---------- 聊天窗口定位 ----------
  function getWc() {
    try {
      const list = electron.webContents.getAllWebContents() || []
      // 优先消息页；其次任何 QQ 自己的页面；排除 devtools
      const msg = list.find((w) => { try { return String(w.getURL()).includes('#/main/message') } catch (e) { return false } })
      if (msg) return msg
      const any = list.find((w) => { try { const u = String(w.getURL()); return u.indexOf('qq') >= 0 || u.indexOf('QQ') >= 0 ? true : false } catch (e) { return false } })
      return any || null
    } catch (e) { return null }
  }
  // ---------- 渲染进程辅助脚本 ----------
  function jsEnsureChat() {
    return [
      "(function(){try{",
      "var t=" + JSON.stringify(CFG.peerName) + ";",
      "function hdr(){var h=document.querySelector('.chat-header__contact-name');return h?h.innerText.trim():null;}",
      "if(hdr()===t) return {ok:true,name:t,switched:false};",
      "var items=document.querySelectorAll('.recent-contact-item');",
      "for(var i=0;i<items.length;i++){var n=items[i].querySelector('.contact-name__text');if(n && n.innerText.trim()===t){items[i].click();return {ok:true,name:t,switched:true};}}",
      "return {ok:false,name:hdr(),err:'contact-not-found'};",
      "}catch(e){return {ok:false,err:String(e)}}})()",
    ].join('')
  }
  function jsSend(text) {
    return [
      "(async function(){try{",
      "var t=" + JSON.stringify(CFG.peerName) + ";",
      "function hdr(){var h=document.querySelector('.chat-header__contact-name');return h?h.innerText.trim():null;}",
      "function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}",
      "for(var attempt=0; attempt<3 && hdr()!==t; attempt++){",
      "  var items=document.querySelectorAll('.recent-contact-item');",
      "  for(var i=0;i<items.length;i++){var n=items[i].querySelector('.contact-name__text');if(n && n.innerText.trim()===t){items[i].click();break;}}",
      "  await sleep(700);",
      "}",
      "if(hdr()!==t) return {ok:false,err:'chat-not-open',now:hdr()};",
      "var ed=null;",
      "for(var k=0;k<8;k++){ ed=document.querySelector('.ProseMirror.ExEditor-qq-msg-editor'); if(ed) break; await sleep(150); }",
      "if(!ed) return {ok:false,err:'no-editor'};",
      "ed.focus();",
      "var sel=window.getSelection();var range=document.createRange();range.selectNodeContents(ed);sel.removeAllRanges();sel.addRange(range);",
      "document.execCommand('delete',false,null);",
      "await sleep(90);",
      "document.execCommand('insertText',false," + JSON.stringify(text) + ");",
      "await sleep(360);",
      "var typed=(ed.innerText||'').trim();",
      "if(!typed) return {ok:false,err:'empty-editor'};",
      "var btn=document.querySelector('.send-msg');",
      "if(!btn) return {ok:false,err:'no-send'};",
      "if(btn.disabled || String(btn.className).indexOf('disable')>=0){ await sleep(300); btn=document.querySelector('.send-msg'); }",
      "btn.click();",
      "await sleep(700);",
      "var left=(ed.innerText||'').trim();",
      "return {ok:!left, typed:typed.slice(0,80), editorAfter:left.slice(0,20)};",
      "}catch(e){return {ok:false,err:String(e)}}})()",
    ].join('')
  }
  function jsRead() {
    return [
      "(function(){try{",
      "var h=document.querySelector('.chat-header__contact-name');",
      "var cs=document.querySelectorAll('.msg-content-container');",
      "var msgs=[];",
      "for(var i=Math.max(0,cs.length-15);i<cs.length;i++){",
      "  var c=cs[i];var cls=String(c.className);",
      "  var t=(c.innerText||'').replace(/\\s+/g,' ').trim();",
      "  msgs.push({self:/container--self/.test(cls),text:t.slice(0,300)});",
      "}",
      "return {name:h?h.innerText.trim():null,msgs:msgs};",
      "}catch(e){return {err:String(e)}}})()",
    ].join('')
  }
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve({ ok: false, err: 'timeout' }), ms || CFG.execTimeoutMs))])
  }
  async function runInRenderer(code) {
    const wc = getWc()
    if (!wc) { state.lastError = 'no-chat-window'; return { ok: false, err: 'no-chat-window' } }
    try {
      state.wcId = wc.id || 0
      return await withTimeout(wc.executeJavaScript(code, true))
    } catch (e) {
      const msg = String((e && e.message) || e)
      state.lastError = 'exec: ' + msg
      log({ step: 'exec-error', msg })
      return { ok: false, err: 'exec:' + msg }
    }
  }
  // ---------- 发送（串行队列 + 最小间隔 + 重试） ----------
  let sendChain = Promise.resolve()
  function enqueueSend(text) {
    const task = async () => {
      const wait = Math.max(0, CFG.minSendGapMs - (Date.now() - state.lastSendAt))
      if (wait) await new Promise((r) => setTimeout(r, wait))
      let last = null
      for (let attempt = 0; attempt <= CFG.sendRetries; attempt++) {
        last = await runInRenderer(jsSend(text))
        if (last && last.ok) break
        log({ step: 'send-retry', attempt, r: last })
        if (attempt < CFG.sendRetries) await new Promise((r) => setTimeout(r, 450))
      }
      state.lastSendAt = Date.now()
      state.sends++
      if (!(last && last.ok)) { state.sendFails++; state.lastError = 'send: ' + ((last && last.err) || 'unknown') }
      log({ step: 'send', ok: !!(last && last.ok), r: last, text: text.slice(0, 80) })
      return last || { ok: false, err: 'unknown' }
    }
    const p = sendChain.then(task, task)
    sendChain = p.then(() => null, () => null)
    return p
  }
  // ---------- 运行时事件上报 ----------
  function postEvent(payload) {
    try {
      const body = JSON.stringify(payload)
      const url = new URL(CFG.runtimeEventUrl)
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => res.resume())
      req.on('error', (e) => { state.lastError = 'event-post: ' + String(e && e.message); log({ step: 'event-post-error', msg: String(e && e.message) }) })
      req.write(body)
      req.end()
      return true
    } catch (e) { log({ step: 'event-post-throw', msg: String(e && e.message) }); return false }
  }
  // ---------- 轮询收消息 ----------
  let polling = false
  let lastWsName = null
  async function pollOnce() {
    if (polling) return
    polling = true
    try {
      state.lastPollAt = Date.now()
      const r = await runInRenderer(jsRead())
      if (!r || r.err) { log({ step: 'read-error', r }); return }
      if (r.name !== CFG.peerName) { lastWsName = r.name; return }
      const msgs = r.msgs || []
      if (!msgs.length) return
      // 会话刚切过来：把当前历史当基线，不上报旧消息
      if (lastWsName !== r.name) { lastWsName = r.name; const l0 = msgs[msgs.length - 1]; state.lastSig = (l0.self ? 's' : 'o') + '|' + l0.text; return }
      const last = msgs[msgs.length - 1]
      const sig = (last.self ? 's' : 'o') + '|' + last.text
      if (sig === state.lastSig) return
      state.lastSig = sig
      if (last.self) return
      const nowMs = Date.now()
      if (state.seen[sig] && nowMs - (state.seenAt[sig] || 0) < 10 * 60 * 1000) return
      state.seen[sig] = nowMs
      state.seenAt[sig] = nowMs
      // 清理过期去重表
      if (Object.keys(state.seen).length > 500) { state.seen = {}; state.seenAt = {} }
      state.events++
      state.lastIncomingAt = nowMs
      postEvent({
        post_type: 'message', message_type: 'private', sub_type: 'friend',
        time: Math.floor(nowMs / 1000),
        self_id: Number(CFG.selfId), user_id: Number(CFG.peerId), message_id: nowMs,
        raw_message: last.text, message: [{ type: 'text', data: { text: last.text } }],
        sender: { user_id: Number(CFG.peerId), nickname: CFG.peerName },
      })
      log({ step: 'incoming', text: last.text.slice(0, 120) })
    } catch (e) { log({ step: 'poll-throw', msg: String(e && e.message) }) } finally { polling = false }
  }
  // ---------- HTTP ----------
  function authOk(req) {
    if (!CFG.token) return true
    const h = String(req.headers['authorization'] || '')
    const q = String(req.url || '').split('access_token=')[1] || ''
    return h === 'Bearer ' + CFG.token || q.split('&')[0] === CFG.token
  }
  function sendJson(res, code, obj) {
    try { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)) } catch (e) {}
  }
  function ok(res, data) { sendJson(res, 200, { status: 'ok', retcode: 0, data }) }
  function fail(res, code, error, retcode) { sendJson(res, 200, { status: 'failed', retcode: retcode || 200, data: null, error: String(error || 'failed') }) }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) {}
      const p = String(req.url || '').split('?')[0]
      try {
        if (p === '/ping') { sendJson(res, 200, { ok: true, app: 'sbc-selfbridge', version: state.version, at: Date.now() }); return }
        if (!authOk(req)) { sendJson(res, 401, { status: 'failed', retcode: 401, error: 'unauthorized' }); return }
        if (p === '/get_version_info') { ok(res, { app_name: 'sbc-selfbridge', app_version: state.version, protocol_version: 'v11' }); return }
        if (p === '/get_login_info') { ok(res, { user_id: Number(CFG.selfId), nickname: '芝芝' }); return }
        if (p === '/get_status') {
          const wc = getWc()
          ok(res, {
            online: !!wc, good: !!wc,
            version: state.version, port: CFG.port, selfId: CFG.selfId, peerId: CFG.peerId, peerName: CFG.peerName,
            uptimeSec: Math.floor((Date.now() - state.startedAt) / 1000),
            events: state.events, sends: state.sends, sendFails: state.sendFails,
            lastIncomingAt: state.lastIncomingAt, lastSendAt: state.lastSendAt,
            lastPollAt: state.lastPollAt, lastError: state.lastError, chatWindow: !!wc,
          }); return
        }
        if (p === '/get_friend_list') { ok(res, []); return }
        if (p === '/send_private_msg' || p === '/send_msg') {
          let text = ''
          const msg = body.message
          if (typeof msg === 'string') text = msg
          else if (Array.isArray(msg)) text = msg.map((s) => (s && s.type === 'text' && s.data && s.data.text) || '').join('')
          if (!text) { fail(res, 200, 'empty message', 100); return }
          const target = String(body.user_id || body.group_id || '')
          if (target && target !== CFG.peerId) { fail(res, 200, 'only peer allowed', 100); return }
          const r = await enqueueSend(text)
          if (r && r.ok) ok(res, { message_id: Date.now() })
          else fail(res, 200, (r && r.err) || 'send failed', 200)
          return
        }
        sendJson(res, 404, { status: 'failed', retcode: 404, data: null, error: 'unknown endpoint' })
      } catch (e) { state.lastError = 'http: ' + String(e && e.message); log({ step: 'http-throw', msg: String(e && e.message) }); sendJson(res, 500, { status: 'failed', retcode: 500, error: String(e && e.message) }) }
    })
  })
  function listen() {
    try { server.close() } catch (e) {}
    try {
      server.listen(CFG.port, '127.0.0.1', () => log({ step: 'listening', port: CFG.port, version: state.version }))
    } catch (e) {
      state.lastError = 'listen: ' + String(e && e.message)
      log({ step: 'listen-fail', msg: String(e && e.message) })
      state.serverRetry = setTimeout(listen, 3000)
    }
  }
  server.on('error', (e) => {
    state.lastError = 'server: ' + String(e && e.message)
    log({ step: 'server-error', msg: String(e && e.message) })
    if (!state.serverRetry) state.serverRetry = setTimeout(listen, 3000)
  })
  listen()
  state.pollTimer = setInterval(pollOnce, CFG.pollMs)
  // 每 30 秒自检一次（聊天窗口还在不在），失败只记日志，不影响主循环
  state.keepTimer = setInterval(() => {
    const wc = getWc()
    if (!wc) { state.lastError = 'no-chat-window'; log({ step: 'keepalive', chatWindow: false }) }
  }, 30000)
  state.started = true
  state.server = server
  return { ok: true, port: CFG.port, selfId: CFG.selfId, peerName: CFG.peerName, version: state.version, startedAt: state.startedAt }
}
if (typeof globalThis !== 'undefined') globalThis.__sbcStartBridge = startBridge
