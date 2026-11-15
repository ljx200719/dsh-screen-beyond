/* 屏幕彼端 · 手机页（原生 JS，无依赖）
 * 只做三件事：配对拿令牌 → 拉消息（since 游标 + uid 去重）→ 发消息/看状态。
 * 所有请求都打到本页自己的 origin（也就是网关），网关认证后再转发给电脑上的运行时。
 */
(function () {
  'use strict';

  var LS_TOKEN = 'sbcMobileToken';
  var LS_DEVICE = 'sbcMobileDevice';
  var POLL_MS = 1500;
  var POLL_HIDDEN_MS = 6000;
  var MAX_IMAGE_BYTES = 8 * 1024 * 1024;

  var state = {
    token: '',
    device: null,
    messages: [],
    seenUid: Object.create(null),
    lastId: 0,
    typing: false,
    sending: false,
    stopping: false,
    polling: false,
    netError: '',
    pendingImage: '',
    booted: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    pairView: $('pairView'), chatView: $('chatView'), sheetView: $('sheetView'),
    codeInput: $('codeInput'), deviceName: $('deviceName'), pairBtn: $('pairBtn'), pairMsg: $('pairMsg'), fpHint: $('fpHint'),
    avatar: $('avatar'), charName: $('charName'), charWhere: $('charWhere'), moreBtn: $('moreBtn'),
    netbar: $('netbar'), list: $('list'), emptyHint: $('emptyHint'), typing: $('typing'),
    input: $('input'), sendBtn: $('sendBtn'), stopBtn: $('stopBtn'),
    imgBtn: $('imgBtn'), fileInput: $('fileInput'), imgPreview: $('imgPreview'), imgPreviewImg: $('imgPreviewImg'), imgCancel: $('imgCancel'),
    selfName: $('selfName'), selfScope: $('selfScope'), selfUrl: $('selfUrl'), selfFp: $('selfFp'), selfVer: $('selfVer'),
    closeSheet: $('closeSheet'), forgetBtn: $('forgetBtn')
  };

  // ---------- 小工具 ----------
  function api(path, opts) {
    var o = opts || {};
    var headers = o.headers || {};
    if (state.token) headers.authorization = 'Bearer ' + state.token;
    if (o.body !== undefined && !headers['content-type']) headers['content-type'] = 'application/json';
    return fetch(path, {
      method: o.method || 'GET',
      headers: headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      cache: 'no-store'
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { j = null; }
        return { ok: r.ok, status: r.status, data: j, raw: t };
      });
    });
  }
  function fmtTime(ms) {
    try {
      var d = new Date(Number(ms) || Date.now());
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    } catch (e) { return ''; }
  }
  function setNet(msg) {
    state.netError = msg || '';
    if (!el.netbar) return;
    el.netbar.textContent = state.netError;
    el.netbar.hidden = !state.netError;
  }
  function show(view) {
    el.pairView.hidden = view !== 'pair';
    el.chatView.hidden = view !== 'chat';
    el.sheetView.hidden = view !== 'sheet';
  }
  function saveToken(token, device) {
    state.token = token || '';
    state.device = device || null;
    try {
      if (token) localStorage.setItem(LS_TOKEN, token); else localStorage.removeItem(LS_TOKEN);
      if (device) localStorage.setItem(LS_DEVICE, JSON.stringify(device)); else localStorage.removeItem(LS_DEVICE);
    } catch (e) {}
  }
  function loadToken() {
    try {
      state.token = localStorage.getItem(LS_TOKEN) || '';
      var d = localStorage.getItem(LS_DEVICE);
      state.device = d ? JSON.parse(d) : null;
    } catch (e) { state.token = ''; state.device = null; }
    return state.token;
  }

  // ---------- 配对 ----------
  function pair() {
    var code = String(el.codeInput.value || '').replace(/\D/g, '').slice(0, 6);
    if (code.length !== 6) { el.pairMsg.textContent = '配对码是 6 位数字。'; return; }
    el.pairBtn.disabled = true;
    el.pairMsg.textContent = '正在配对…';
    api('/api/mobile-gate/pair', {
      method: 'POST',
      body: { code: code, deviceName: String(el.deviceName.value || '').trim() || '我的手机' }
    }).then(function (r) {
      el.pairBtn.disabled = false;
      if (!r.ok || !r.data || !r.data.ok) {
        var why = (r.data && (r.data.error || r.data.message)) || ('配对失败（HTTP ' + r.status + '）');
        if (r.status === 429) why = '试太多次了，等几分钟再试。';
        el.pairMsg.textContent = why;
        return;
      }
      saveToken(r.data.token, { id: r.data.deviceId, name: r.data.name, scope: r.data.scope });
      el.pairMsg.textContent = '';
      el.codeInput.value = '';
      startChat();
    }).catch(function (e) {
      el.pairBtn.disabled = false;
      el.pairMsg.textContent = '连不上：' + ((e && e.message) || '网络错误');
    });
  }

  // ---------- 聊天 ----------
  function bubbleFor(m) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + (m.role === 'user' ? 'me' : 'her');
    var b = document.createElement('div');
    b.className = 'bubble';
    var text = String(m.text || '');
    if (text) b.appendChild(document.createTextNode(text));
    if (m.image) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '图片';
      img.src = String(m.image);
      img.addEventListener('error', function () {
        img.className = 'broken';
        img.alt = '图片加载失败';
      });
      b.appendChild(img);
    }
    wrap.appendChild(b);
    var t = document.createElement('div');
    t.className = 'time';
    t.textContent = fmtTime(m.at);
    wrap.appendChild(t);
    return wrap;
  }

  function renderAll() {
    var keeps = el.list.querySelectorAll('.msg');
    for (var i = 0; i < keeps.length; i++) keeps[i].remove();
    if (!state.messages.length) {
      el.list.setAttribute('data-empty', '1');
      el.emptyHint.hidden = false;
      return;
    }
    el.list.setAttribute('data-empty', '0');
    el.emptyHint.hidden = true;
    for (var k = 0; k < state.messages.length; k++) el.list.appendChild(bubbleFor(state.messages[k]));
    scrollBottom();
  }

  function appendMessages(list) {
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m || typeof m !== 'object') continue;
      var uid = String(m.uid || ('id:' + m.id));
      if (state.seenUid[uid]) continue;
      state.seenUid[uid] = 1;
      state.messages.push(m);
      if (Number(m.id) > state.lastId) state.lastId = Number(m.id);
      added++;
    }
    if (!added) return;
    if (state.messages.length > 400) {
      state.messages = state.messages.slice(-400);
      renderAll();
      return;
    }
    el.list.setAttribute('data-empty', '0');
    el.emptyHint.hidden = true;
    for (var k = state.messages.length - added; k < state.messages.length; k++) el.list.appendChild(bubbleFor(state.messages[k]));
    scrollBottom();
  }

  function scrollBottom() {
    try { el.list.scrollTop = el.list.scrollHeight + 400; } catch (e) {}
  }

  function setTyping(on) {
    state.typing = !!on;
    el.typing.hidden = !state.typing;
    el.stopBtn.hidden = !state.typing;
    el.sendBtn.hidden = state.typing;
  }

  function poll() {
    if (state.polling || !state.token) return;
    state.polling = true;
    var target = document.hidden ? POLL_HIDDEN_MS : POLL_MS;
    api('/api/events?since=' + state.lastId).then(function (r) {
      state.polling = false;
      if (r.status === 401) { onUnauthorized(); return; }
      if (!r.ok || !r.data) { setNet('连接不稳定，正在重试…'); return; }
      setNet('');
      if (Array.isArray(r.data.messages)) appendMessages(r.data.messages);
      if (typeof r.data.typing === 'boolean') setTyping(r.data.typing);
    }).catch(function () {
      state.polling = false;
      setNet('连不上电脑了（同一 Wi-Fi？电脑还开着吗？）');
    }).then(function () {
      setTimeout(poll, target);
    });
  }

  function refreshHeader() {
    if (!state.token) return;
    api('/api/status').then(function (r) {
      if (r.status === 401) { onUnauthorized(); return; }
      if (!r.ok || !r.data) return;
      var c = r.data.character || {};
      if (c.name) el.charName.textContent = String(c.name);
      if (c.avatar) { el.avatar.src = String(c.avatar); el.avatar.alt = String(c.name || ''); }
      if (typeof r.data.typing === 'boolean') setTyping(r.data.typing);
    }).catch(function () {});
    api('/api/stage').then(function (r) {
      if (!r.ok || !r.data) return;
      var loc = r.data.location || {};
      var bits = [];
      if (loc.placeName) bits.push('在「' + loc.placeName + '」');
      if (r.data.weather && r.data.weather.icon) bits.push(r.data.weather.icon + (r.data.weather.label || ''));
      if (loc.state === 'traveling') bits.unshift('在路上');
      el.charWhere.textContent = bits.join(' · ') || '在线';
    }).catch(function () {});
  }

  function onUnauthorized() {
    saveToken('', null);
    setTyping(false);
    show('pair');
    el.pairMsg.textContent = '这台手机的配对已失效（电脑那边撤销了？），重新配对一次。';
  }

  function send() {
    if (state.sending) return;
    var text = String(el.input.value || '').trim();
    var image = state.pendingImage;
    if (!text && !image) return;
    state.sending = true;
    el.sendBtn.disabled = true;
    var body = { text: text };
    if (image) body.images = [image];
    api('/api/chat', { method: 'POST', body: body }).then(function (r) {
      state.sending = false;
      el.sendBtn.disabled = false;
      if (r.status === 401) { onUnauthorized(); return; }
      if (r.status === 429) { setNet('她还在说话，等她回完再发。'); return; }
      if (!r.ok || (r.data && r.data.ok === false)) {
        setNet('发送失败：' + ((r.data && (r.data.error || r.data.message)) || ('HTTP ' + r.status)));
        return;
      }
      setNet('');
      el.input.value = '';
      autoGrow();
      clearPendingImage();
      setTyping(true);
      setTimeout(poll, 250);
    }).catch(function () {
      state.sending = false;
      el.sendBtn.disabled = false;
      setNet('发送失败：网络断了，内容还在输入框里。');
    });
  }

  function stop() {
    if (state.stopping) return;
    state.stopping = true;
    el.stopBtn.disabled = true;
    api('/api/chat/cancel', { method: 'POST', body: {} }).then(function (r) {
      state.stopping = false;
      el.stopBtn.disabled = false;
      if (r.status === 401) { onUnauthorized(); return; }
      setTyping(false);
      setTimeout(poll, 400);
    }).catch(function () {
      state.stopping = false;
      el.stopBtn.disabled = false;
    });
  }

  function clearPendingImage() {
    state.pendingImage = '';
    el.imgPreview.hidden = true;
    el.imgPreviewImg.removeAttribute('src');
  }

  function pickImage(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { setNet('只能发图片。'); return; }
    if (file.size > MAX_IMAGE_BYTES) { setNet('图片太大了（最大 8MB），先压缩一下。'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      state.pendingImage = String(reader.result || '');
      el.imgPreviewImg.src = state.pendingImage;
      el.imgPreview.hidden = false;
      setNet('');
    };
    reader.onerror = function () { setNet('读不到这张图片。'); };
    reader.readAsDataURL(file);
  }

  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(140, Math.max(44, el.input.scrollHeight)) + 'px';
  }

  // ---------- 启动 ----------
  function startChat() {
    show('chat');
    renderAll();
    refreshHeader();
    setTimeout(poll, 0);
    setInterval(refreshHeader, 15000);
  }

  function boot() {
    if (state.booted) return;
    state.booted = true;
    var token = loadToken();
    if (!token) { show('pair'); return; }
    show('chat');
    api('/api/mobile-gate/self').then(function (r) {
      if (r.status === 401 || !r.ok || !r.data || !r.data.ok) { saveToken('', null); show('pair'); return; }
      if (r.data.device) { state.device = r.data.device; }
      startChat();
    }).catch(function () {
      // 网络暂时不通：先显示聊天页（之后 poll 会重试），不要把令牌清掉
      startChat();
      setNet('连不上电脑，正在重试…');
    });
  }

  // ---------- 事件 ----------
  el.pairBtn.addEventListener('click', pair);
  el.codeInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') pair(); });
  el.codeInput.addEventListener('input', function () {
    el.codeInput.value = String(el.codeInput.value || '').replace(/\D/g, '').slice(0, 6);
  });
  el.sendBtn.addEventListener('click', send);
  el.stopBtn.addEventListener('click', stop);
  el.imgBtn.addEventListener('click', function () { el.fileInput.click(); });
  el.fileInput.addEventListener('change', function (e) {
    var f = e.target && e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    pickImage(f);
  });
  el.imgCancel.addEventListener('click', clearPendingImage);
  el.input.addEventListener('input', autoGrow);
  el.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  el.moreBtn.addEventListener('click', function () {
    el.selfName.textContent = (state.device && state.device.name) || '—';
    el.selfScope.textContent = (state.device && state.device.scope === 'readonly') ? '只读' : '可聊天';
    el.selfUrl.textContent = location.origin;
    el.selfFp.textContent = '和电脑面板上的一致（见下）';
    el.selfVer.textContent = document.title;
    show('sheet');
    api('/api/mobile-gate/self').then(function (r) {
      if (!r.ok || !r.data) return;
      if (r.data.fingerprint) el.selfFp.textContent = String(r.data.fingerprint);
      if (r.data.version) el.selfVer.textContent = String(r.data.version);
      if (r.data.device) {
        state.device = r.data.device;
        el.selfName.textContent = r.data.device.name || '—';
        el.selfScope.textContent = r.data.device.scope === 'readonly' ? '只读' : '可聊天';
      }
    }).catch(function () {});
  });
  el.closeSheet.addEventListener('click', function () { show('chat'); });
  el.sheetView.addEventListener('click', function (e) { if (e.target === el.sheetView) show('chat'); });
  el.forgetBtn.addEventListener('click', function () {
    saveToken('', null);
    state.messages = [];
    state.seenUid = Object.create(null);
    state.lastId = 0;
    clearPendingImage();
    setTyping(false);
    show('pair');
    el.pairMsg.textContent = '已从这台手机解除。电脑面板里那台设备还在，可以去那边撤销。';
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.token) { poll(); refreshHeader(); }
  });

  boot();
})();
