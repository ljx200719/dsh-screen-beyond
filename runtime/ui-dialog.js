/* 轻量页面内弹窗：替代 iframe/沙盒里会被拦掉的 prompt/confirm/alert */
(function () {
  if (window.__uiDialogReady) return;
  window.__uiDialogReady = true;

  const css = document.createElement('style');
  css.textContent = `
#uiDlgMask{position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;padding:20px;background:rgba(2,7,14,.58);backdrop-filter:blur(4px)}
#uiDlgMask.show{display:flex}
#uiDlgCard{width:420px;max-width:calc(100vw - 32px);box-sizing:border-box;background:#111b27;color:#dce8f5;border:1px solid #2e465f;border-radius:16px;padding:20px;box-shadow:0 24px 80px rgba(0,0,0,.55);font:14px/1.65 "Segoe UI","Microsoft YaHei",sans-serif}
#uiDlgTitle{margin:0 0 6px;font-size:16px;font-weight:600;color:#eef6ff}
#uiDlgMsg{white-space:pre-wrap;color:#b4c6d8;font-size:13px;margin-bottom:16px}
#uiDlgInput{width:100%;box-sizing:border-box;display:none;margin:0 0 16px;padding:9px 11px;border-radius:9px;border:1px solid #36516b;background:#0a131d;color:#eaf3ff;font:inherit;outline:none}
#uiDlgInput:focus{border-color:#4f8bc7;box-shadow:0 0 0 3px rgba(79,139,199,.18)}
#uiDlgRow{display:flex;justify-content:flex-end;gap:9px}
#uiDlgRow button{padding:7px 16px;border-radius:9px;border:1px solid #334b64;background:#172534;color:#b9cbdc;font:inherit;cursor:pointer}
#uiDlgRow button:hover{border-color:#4f8bc7;color:#eef6ff}
#uiDlgRow button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
#uiDlgRow button.danger{background:#7f2f34;border-color:#9b3b41;color:#ffe6e6}
#uiDlgRow button.primary:hover{background:#3574f2}
`;
  document.head.appendChild(css);

  let mask, titleEl, msgEl, inputEl, okEl, cancelEl, resolver = null, mode = 'alert';

  function build() {
    if (mask) return;
    mask = document.createElement('div');
    mask.id = 'uiDlgMask';
    mask.innerHTML = '<div id="uiDlgCard"><h3 id="uiDlgTitle">提示</h3><div id="uiDlgMsg"></div>' +
      '<input id="uiDlgInput" autocomplete="off">' +
      '<div id="uiDlgRow"><button id="uiDlgCancel" type="button">取消</button><button id="uiDlgOk" class="primary" type="button">确定</button></div></div>';
    document.body.appendChild(mask);
    titleEl = mask.querySelector('#uiDlgTitle');
    msgEl = mask.querySelector('#uiDlgMsg');
    inputEl = mask.querySelector('#uiDlgInput');
    okEl = mask.querySelector('#uiDlgOk');
    cancelEl = mask.querySelector('#uiDlgCancel');
    okEl.addEventListener('click', () => finish(true));
    cancelEl.addEventListener('click', () => finish(false));
    mask.addEventListener('click', (e) => { if (e.target === mask) finish(false); });
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    document.addEventListener('keydown', (e) => {
      if (!mask || mask.style.display !== 'flex') return;
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      if (e.key === 'Enter' && mode === 'prompt' && document.activeElement !== inputEl) { e.preventDefault(); finish(true); }
    });
  }

  function open(kind, message, title, defaultValue, okText, cancelText, danger) {
    build();
    mode = kind;
    titleEl.textContent = title || (kind === 'alert' ? '提示' : kind === 'confirm' ? '确认' : '输入');
    msgEl.textContent = message || '';
    inputEl.style.display = kind === 'prompt' ? 'block' : 'none';
    inputEl.value = kind === 'prompt' ? (defaultValue == null ? '' : String(defaultValue)) : '';
    cancelEl.style.display = kind === 'alert' ? 'none' : '';
    okEl.textContent = okText || '确定';
    okEl.className = danger ? 'danger' : 'primary';
    cancelEl.textContent = cancelText || '取消';
    mask.classList.add('show');
    mask.style.display = 'flex';
    setTimeout(() => {
      if (kind === 'prompt') { inputEl.focus(); inputEl.select(); }
      else okEl.focus();
    }, 30);
    return new Promise((resolve) => { resolver = resolve; });
  }

  function finish(ok) {
    if (!resolver) return;
    const kind = mode;
    const value = kind === 'prompt' ? (ok ? inputEl.value : null) : (ok ? true : false);
    resolver(value);
    resolver = null;
    if (mask) { mask.classList.remove('show'); mask.style.display = 'none'; }
  }

  window.uiAlert = (message, title) => open('alert', message, title || '提示');
  window.uiConfirm = (message, title, opts) => open('confirm', message, title || '确认', '', (opts && opts.okText) || '确定', (opts && opts.cancelText) || '取消', false);
  window.uiPrompt = (message, defaultValue, title) => open('prompt', message, title || '输入', defaultValue || '', '确定', '取消', false);
})();
