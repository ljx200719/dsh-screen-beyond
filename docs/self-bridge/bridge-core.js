// 屏幕彼端 · 自建 QQ 桥（运行在 QQ 主进程内；通过渲染进程 DOM 收/发消息）
// 对外提供 OneBot 11 的极小子集，端口 127.0.0.1:3010
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
  }
  const state = { started: false, lastSig: '', seen: {}, startedAt: Date.now(), lastSendAt: 0, events: 0 }
  function log(o) { try { fs.appendFileSync(LOG, '[' + new Date().toISOString() + '] ' + JSON.stringify(o) + '\n') } catch (e) {} }
  function getWc() {
    try {
      const list = electron.webContents.getAllWebContents()
      return list.find((w) => String(w.getURL()).includes('#/main/message')) || null
    } catch (e) { return null }
  }
  // ---------- 渲染进程辅助脚本 ----------
  function jsEnsureChat() {
    return [
      "(function(){try{",
      "var t=" + JSON.stringify(CFG.peerName) + ";",
      "var h=document.querySelector('.chat-header__contact-name');",
      "if(h && h.innerText.trim()===t) return {name:t,switched:false};",
      "var items=document.querySelectorAll('.recent-contact-item');",
      "for(var i=0;i<items.length;i++){var n=items[i].querySelector('.contact-name__text');if(n && n.innerText.trim()===t){items[i].click();return {name:t,switched:true};}}",
      "return {name:h?h.innerText.trim():null,switched:false,found:false};",
      "}catch(e){return {err:String(e)}}})()",
    ].join('')
  }
  function jsSend(text) {
    return [
      "(async function(){try{",
      "var t=" + JSON.stringify(CFG.peerName) + ";",
      "var h=document.querySelector('.chat-header__contact-name');",
      "if(!h || h.innerText.trim()!==t){",
      "  var items=document.querySelectorAll('.recent-contact-item');",
      "  for(var i=0;i<items.length;i++){var n=items[i].querySelector('.contact-name__text');if(n && n.innerText.trim()===t){items[i].click();break;}}",
      "  await new Promise(function(r){setTimeout(r,650)});",
      "  h=document.querySelector('.chat-header__contact-name');",
      "}",
      "if(!h || h.innerText.trim()!==t) return {ok:false,err:'chat-not-open',now:h?h.innerText.trim():null};",
      "var ed=document.querySelector('.ProseMirror.ExEditor-qq-msg-editor');",
      "if(!ed) return {ok:false,err:'no-editor'};",
      "ed.focus();",
      "var sel=window.getSelection();var range=document.createRange();range.selectNodeContents(ed);sel.removeAllRanges();sel.addRange(range);",
      "document.execCommand('delete',false,null);",
      "await new Promise(function(r){setTimeout(r,90)});",
      "document.execCommand('insertText',false," + JSON.stringify(text) + ");",
      "await new Promise(function(r){setTimeout(r,320)});",
      "var typed=ed.innerText;",
      "var btn=document.querySelector('.send-msg');",
      "if(!btn) return {ok:false,err:'no-send'};",
      "btn.click();",
      "await new Promise(function(r){setTimeout(r,650)});",
      "return {ok:true,typed:typed.slice(0,80),editorAfter:ed.innerText.slice(0,20)};",
      "}catch(e){return {ok:false,err:String(e)}}})()",
    ].join('')
  }
  function jsRead() {
    return [
      "(function(){try{",
      "var h=document.querySelector('.chat-header__contact-name');",
      "var cs=document.querySelectorAll('.msg-content-container');",
      "var msgs=[];",
      "for(var i=Math.max(0,cs.length-12);i<cs.length;i++){",
      "  var c=cs[i];var cls=String(c.className);",
      "  var t=(c.innerText||'').replace(/\\s+/g,' ').trim();",
      "  msgs.push({self:/container--self/.test(cls),text:t.slice(0,300)});",
      "}",
      "return {name:h?h.innerText.trim():null,msgs:msgs};",
      "}catch(e){return {err:String(e)}}})()",
    ].join('')
  }
  async function runInRenderer(code) {
    const wc = getWc()
    if (!wc) return { ok: false, err: 'no-chat-window' }
    try { return await wc.executeJavaScript(code, true) } catch (e) { return { ok: false, err: String((e && e.message) || e) } }
  }
  // ---------- 运行时事件上报 ----------
  function postEvent(payload) {
    try {
      const body = JSON.stringify(payload)
      const url = new URL(CFG.runtimeEventUrl)
      const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => { res.resume() })
      req.on('error', (e) => log({ step: 'event-post-error', msg: String(e && e.message) }))
      req.write(body)
      req.end()
      return true
    } catch (e) { log({ step: 'event-post-throw', msg: String(e && e.message) }); return false }
  }
  // ---------- 轮询收消息 ----------
  let polling = false
  async function pollOnce() {
    if (polling) return
    polling = true
    try {
      const r = await runInRenderer(jsRead())
      if (!r || r.err) { log({ step: 'read-error', r }); return }
      if (r.name !== CFG.peerName) return
      const msgs = r.msgs || []
      if (!msgs.length) return
      const last = msgs[msgs.length - 1]
      const sig = (last.self ? 's' : 'o') + '|' + last.text
      if (sig === state.lastSig) return
      state.lastSig = sig
      if (last.self) return
      if (state.seen[sig]) return
      state.seen[sig] = Date.now()
      state.events++
      const now = Math.floor(Date.now() / 1000)
      postEvent({
        post_type: 'message',
        message_type: 'private',
        sub_type: 'friend',
        time: now,
        self_id: Number(CFG.selfId),
        user_id: Number(CFG.peerId),
        message_id: Date.now(),
        raw_message: last.text,
        message: [{ type: 'text', data: { text: last.text } }],
        sender: { user_id: Number(CFG.peerId), nickname: CFG.peerName },
      })
      log({ step: 'incoming', text: last.text.slice(0, 120) })
    } catch (e) { log({ step: 'poll-throw', msg: String(e && e.message) }) } finally { polling = false }
  }
  // ---------- OneBot 子集 HTTP ----------
  function ok(res, data) { res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ status: 'ok', retcode: 0, data })) }
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      let body = {}
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch (e) {}
      const p = String(req.url || '').split('?')[0]
      try {
        if (p === '/ping' || p === '/get_version_info') { ok(res, { app_name: 'sbc-selfbridge', app_version: '0.1.0' }); return }
        if (p === '/get_login_info') { ok(res, { user_id: Number(CFG.selfId), nickname: '芝芝' }); return }
        if (p === '/get_status') { ok(res, { online: true, good: true }); return }
        if (p === '/get_friend_list') { ok(res, []); return }
        if (p === '/send_private_msg' || p === '/send_msg') {
          let text = ''
          const msg = body.message
          if (typeof msg === 'string') text = msg
          else if (Array.isArray(msg)) text = msg.map((s) => (s && s.type === 'text' && s.data && s.data.text) || '').join('')
          if (!text) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'failed', retcode: 100, data: null, error: 'empty message' })); return }
          const target = String(body.user_id || body.group_id || '')
          if (target && target !== CFG.peerId) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'failed', retcode: 100, data: null, error: 'only peer allowed' })); return }
          const r = await runInRenderer(jsSend(text))
          log({ step: 'send', ok: !!(r && r.ok), r, text: text.slice(0, 80) })
          if (r && r.ok) ok(res, { message_id: Date.now() })
          else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'failed', retcode: 200, data: null, error: (r && r.err) || 'send failed' })) }
          return
        }
        res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'failed', retcode: 404, data: null }))
      } catch (e) { log({ step: 'http-throw', msg: String(e && e.message) }); try { res.writeHead(500); res.end('{}') } catch (x) {} }
    })
  })
  server.on('error', (e) => log({ step: 'server-error', msg: String(e && e.message) }))
  server.listen(CFG.port, '127.0.0.1', () => log({ step: 'listening', port: CFG.port }))
  state.pollTimer = setInterval(pollOnce, CFG.pollMs)
  state.started = true
  state.server = server
  return { ok: true, port: CFG.port, selfId: CFG.selfId, peerName: CFG.peerName, startedAt: state.startedAt }
}
if (typeof globalThis !== 'undefined') globalThis.__sbcStartBridge = startBridge
