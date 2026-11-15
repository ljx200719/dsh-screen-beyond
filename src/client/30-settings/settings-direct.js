// 设置里的两块新卡片：
//  1) DirectChatCard —— 聊天软件直连（OneBot 11 HTTP 适配器）：插件只负责连「用户自己跑的 OneBot 实现」，
//     不内置、不捆绑、不绑定任何具体桥（QQ 风控风险由用户自己决定用哪个桥）。
//  2) UpdateCard —— 插件自动更新：检查 npm 上的新版本；git 检出可一键更新，npm/DSH 安装只提示。

// ---------- 直连 ----------
function DirectChatCard() {
  const [s, setS] = React.useState(null)
  const [st, setSt] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [busy, setBusy] = React.useState('')
  const [diag, setDiag] = React.useState('')

  const load = React.useCallback(() => {
    Api.get('/api/direct-chat/settings').then((r) => {
      if (r.ok && r.data) { setS(r.data.settings || null); setSt(r.data.status || null); setErr('') }
      else setErr(r.error || '直连模块不可用')
    })
  }, [])
  React.useEffect(load, [load])
  const patch = (k, v) => setS((prev) => Object.assign({}, prev || {}, { [k]: v }))
  const save = async () => {
    if (!s) return
    setBusy('save')
    const r = await Api.post('/api/direct-chat/settings', s)
    setBusy('')
    if (!r.ok) { toast(r.error || '保存失败', 'error'); return }
    setS(r.data.settings || s)
    toast('直连设置已保存')
    refresh()
  }
  const refresh = async () => {
    setBusy('status'); setDiag('')
    const r = await Api.get('/api/direct-chat/status')
    setBusy('')
    if (r.ok && r.data && r.data.status) setSt(r.data.status)
    setDiag(r.ok ? (r.data.status && r.data.status.ok ? '连接正常' : ('连接失败：' + ((r.data.status && r.data.status.error) || '未知'))) : (r.error || '读取失败'))
  }
  const sendTest = async () => {
    const text = await promptDialog('发一条测试消息到直连的 QQ（会以她的身份真实发送）', {
      title: '直连测试消息',
      okText: '发送',
      value: '（测试消息）来自屏幕彼端的直连测试，收到不用回～',
    })
    if (!text) return
    setBusy('send'); setDiag('')
    const r = await Api.post('/api/direct-chat/test', { sendTest: true, text })
    setBusy('')
    const ok = !!(r.ok && r.data && r.data.status && r.data.status.ok)
    if (r.data && r.data.status) setSt(r.data.status)
    if (r.ok && r.data && r.data.send) {
      setDiag(r.data.send.ok ? ('已发送（messageId ' + String(r.data.send.messageId || '') + '）') : ('发送失败：' + (r.data.send.error || '')))
      toast(r.data.send.ok ? '测试消息已发出' : ('发送失败：' + (r.data.send.error || '')), r.data.send.ok ? 'success' : 'error')
    } else {
      setDiag(ok ? '连接正常，但没发消息' : '连接失败')
    }
  }

  const login = (st && st.login) || null
  return h(Card, {
    title: '聊天软件直连（OneBot 11）',
    sub: '不经过虚拟机看屏幕；插件只连你自己跑的 OneBot 实现',
    tag: s ? (s.enabled ? '已开启' : '未开启') : '读取中',
  },
    err ? h(ErrorBox, { error: err, onRetry: load }) : null,
    h(Note, {}, '需要本机已经有一个 OneBot 11 实现（HTTP 接口），填它的地址和 token。注意：NapCat 已下架、Lagrange 官方签名服务已停、LLOneBot 转收费，现成能直接用的桥越来越少。'),
    h(Note, {}, '自建桥（可选）：QQ 9.9.37 便携副本 + 开源注入器 TzdInjectorNTQQ（LGPL，内存注入、不改 QQ 文件）+ 本地 OneBot 11 子集（默认 127.0.0.1:3010）。桥与守护脚本在插件目录 docs/self-bridge/，完整步骤见 docs/DIRECT-CHAT.md。'),
    h('div', {
      style: {
        border: '1px solid ' + (T.warn || T.border), borderRadius: 10, padding: '9px 11px',
        display: 'flex', flexDirection: 'column', gap: 4,
        background: 'rgba(214,158,46,.07)',
      },
    },
      h('div', { style: { fontSize: 12, fontWeight: 700, color: T.warn || T.text } }, '⚠ 自建桥的硬限制（务必先看）'),
      h('div', { style: { fontSize: 11, lineHeight: 1.75, color: T.text2 } },
        '· 只建议小号：注入类方案有账号风控/封号风险，别拿主号试。',
        h('br', {}), '· 不是服务：注入在内存里，QQ 退出/重启/更新后桥就没了，必须重跑 start-bridge.ps1；可用 bridge-supervisor.ps1 每 20 秒自动修复（QQ 没登录时它也救不回来）。',
        h('br', {}), '· QQ 9.9.37 的文件带 Ed25519 签名：改 QQ 文件会报「文件已损坏」，所以装不了持久化插件，只能运行时注入。',
        h('br', {}), '· 只能单会话私聊、纯文本：对方 QQ 固定（OneBot 请求里 user_id 不是它会被拒绝），群聊/图片/文件都没做。',
        h('br', {}), '· 依赖 QQ 界面：需要保持消息页可打开；QQ 改版可能让 DOM 选择器失效（改版后要等适配）。',
        h('br', {}), '· 网络边界：只监听 127.0.0.1:3010，不监听公网；桥支持可选 token（默认空=仅本机免鉴权）。',
        h('br', {}), '· 延迟与重试：入站轮询约 1.2 秒；发送串行 + 最小间隔 0.9 秒，失败自动重试 2 次（防连发打乱输入框）。',
        h('br', {}), '· 自检：GET /ping 或 POST /get_status（后者返回事件数、最后收发时间、最后错误、聊天窗口是否存在）。',
      ),
    ),
    h(Note, {}, '怎么跑：① 便携 QQ 登录她的号 → ② 管理员/普通 PowerShell 跑 docs/self-bridge/start-bridge.ps1（或 F:\\onebot\\next\\start-bridge.ps1）→ ③ 这里点「测试连接」→ ④ 点「发测试消息」。掉线就交给 bridge-supervisor.ps1；想开机自启再跑 install-supervisor.ps1（登录计划任务，可卸载）。'),
    h(Note, {}, '什么时候该放弃：QQ 大版本更新后注入反复失败、或频繁掉线修不好 —— 说明这条路被腾讯改死了，换现成的 OneBot 桥或直接回退虚拟机通道，不要在账号上硬扛。'),
    h(Note, {}, '插件不内置、不捆绑、也不会自动启动任何桥；QQ 风控/封号风险由你选择的桥承担。不想用直连就保持关闭，原来的虚拟机看屏幕通道照常可用。'),
    s ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '开启直连', hint: '开启后主动消息优先走直连' }, h(Toggle, { value: !!s.enabled, onChange: (v) => patch('enabled', v) })),
        h(Field, { label: '允许自动回复', hint: '收到私聊消息后由她生成回复并回过去' }, h(Toggle, { value: s.autoReply !== false, onChange: (v) => patch('autoReply', v) })),
        h(Field, { label: '允许发图片', hint: '她有图片时用 OneBot 图片段发送' }, h(Toggle, { value: s.sendImages !== false, onChange: (v) => patch('sendImages', v) })),
        h(Field, { label: '直连失败回退虚拟机', hint: '不开就失败即止' }, h(Toggle, { value: s.fallbackVm !== false, onChange: (v) => patch('fallbackVm', v) })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: 'OneBot 地址', hint: '例如 http://127.0.0.1:3000' }, h(TextInput, { value: s.apiBase || '', onChange: (v) => patch('apiBase', v), placeholder: 'http://127.0.0.1:3000' })),
        h(Field, { label: 'Access Token', hint: 'OneBot 配置里的 token；没有就留空' }, h(TextInput, { value: s.token || '', onChange: (v) => patch('token', v), placeholder: '可留空' })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '对方 QQ 号（发给她用）', hint: '她要发消息的人（主人自己的号），只填数字；不填就不会发' }, h(TextInput, { value: s.userId || '', onChange: (v) => patch('userId', String(v || '').replace(/[^0-9]/g, '')) })),
        h(Field, { label: '她的 QQ 号（机器人账号，可选）', hint: 'OneBot 桥登录的号；用来过滤她自己发的消息' }, h(TextInput, { value: s.selfId || '', onChange: (v) => patch('selfId', String(v || '').replace(/[^0-9]/g, '')) })),
      ),
      h(Row, { gap: 10, wrap: true },
        h(Field, { label: '回复前缀', hint: '可选，比如「（QQ）」，最多 40 字' }, h(TextInput, { value: s.replyPrefix || '', onChange: (v) => patch('replyPrefix', v), placeholder: '可不填' })),
        h(Field, { label: '请求超时（毫秒）', hint: '1000 ~ 30000' }, h(NumInput, { value: s.timeoutMs || 8000, min: 1000, max: 30000, step: 500, onChange: (v) => patch('timeoutMs', v) })),
      ),
      h(Row, { gap: 8, wrap: true },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy, onClick: save }, busy === 'save' ? '保存中…' : '保存'),
        h(Btn, { size: 'sm', disabled: !!busy, onClick: refresh }, busy === 'status' ? '检测中…' : '测试连接'),
        h(Btn, { size: 'sm', disabled: !!busy, onClick: sendTest }, busy === 'send' ? '发送中…' : '发测试消息'),
        h(Btn, { kind: 'ghost', size: 'sm', disabled: !!busy, onClick: load }, '重新读取'),
      ),
      st ? h('div', { style: { fontSize: 11.5, color: T.text2, display: 'flex', flexDirection: 'column', gap: 2 } },
        h('span', {}, '连接状态：' + (st.ok ? '✅ 可用' : '❌ ' + (st.error || '不可用')) + (st.latencyMs ? (' · ' + st.latencyMs + 'ms') : '')),
        login ? h('span', {}, '登录账号：' + (login.nickname || '') + (login.userId ? '（' + login.userId + '）' : '')) : null,
        diag ? h('span', { style: { color: st.ok ? T.ok || T.text2 : T.danger } }, '最近操作：' + diag) : null,
      ) : null,
    ) : h(Loading, {}),
    h(Note, {}, '· 入站消息由 OneBot 桥 POST 到运行时的 /api/direct-chat/event（桥的 HTTP 上报地址填这个；自建桥已内置这一上报）。'),
    h(Note, {}, '· 只处理私聊消息；群聊需要另外开（避免她在群里乱说话）。'),
  )
}

// ---------- 自动更新 ----------
function UpdateCard() {
  const [info, setInfo] = React.useState(null)
  const [busy, setBusy] = React.useState('')
  const [diag, setDiag] = React.useState('')
  const [err, setErr] = React.useState('')

  const check = React.useCallback(async (force) => {
    setBusy('check'); setDiag('')
    const r = await Api.get('/api/update/check' + (force ? '?force=1' : ''))
    setBusy('')
    if (!r.ok) { setDiag('检查失败：' + (r.error || '')); return }
    setInfo((prev) => Object.assign({}, prev || {}, { update: r.data, settings: Object.assign({}, (prev && prev.settings) || {}, { lastCheckAt: r.data.checkedAt, lastResult: r.data }) }))
    setDiag(r.data.updateAvailable ? ('发现新版本 ' + r.data.latest) : ('已是最新（' + r.data.current + '）'))
  }, [])

  const load = React.useCallback(() => {
    Api.get('/api/update/settings').then((r) => {
      if (!r.ok || !r.data) { setInfo(null); setErr(r.error || '更新模块不可用'); return }
      setInfo(r.data); setErr('')
      // 自动检查更新：默认开；上次检查超过 6 小时才真的去查（也不阻塞页面）
      const cfg = (r.data && r.data.settings) || {}
      const last = Number(cfg.lastCheckAt) || 0
      if (cfg.autoCheck !== false && Date.now() - last >= 6 * 3600 * 1000) check(false)
    })
  }, [check])
  React.useEffect(load, [load])
  const apply = async () => {
    const ok = await confirmDialog('立即更新插件？', {
      title: '插件更新',
      detail: '会执行 git pull --ff-only 拉取新代码；成功后运行时会自动重启（约 3~10 秒）。',
      okText: '更新',
    })
    if (!ok) return
    setBusy('apply'); setDiag('')
    const r = await Api.post('/api/update/apply', {})
    setBusy('')
    const d = r.data || {}
    setDiag(d.message || d.error || (d.ok ? '更新完成，运行时即将重启' : '更新失败'))
    if (d.ok) toast('更新成功，运行时即将重启'); else toast('更新失败：' + (d.error || d.message || ''), 'error')
    check(false)
  }

  const up = info && info.update
  const s = (info && info.settings) || {}
  return h(Card, {
    title: '插件更新',
    sub: '自动检查新版本；git 检出可一键更新',
    tag: up && up.updateAvailable ? ('有新版 ' + (up.latest || '')) : '已是最新',
  },
    err ? h(ErrorBox, { error: err, onRetry: load }) : null,
    h(Row, { gap: 10, wrap: true },
      h(KV, { k: '当前版本', v: (info && info.version) || (up && up.current) || '—' }),
      h(KV, { k: '最新版本', v: (up && up.latest) || '未检查' }),
      h(KV, { k: '安装方式', v: up ? ({ link: '本地链接（git 检出）', npm: 'npm 安装', unknown: '未知' }[up.installKind] || up.installKind) : '—' }),
      h(KV, { k: 'git 仓库', v: up ? (up.gitRepo ? (up.gitDirty === false ? '是（工作区干净）' : up.gitDirty === true ? '是（有未提交改动）' : '是（状态未知）') : '否') : '—' }),
    ),
    h(Row, { gap: 10, wrap: true },
      h(Field, { label: '自动检查更新', hint: '启动时和每 6 小时检查一次，发现新版在面板提示' },
        h(Toggle, {
          value: s.autoCheck !== false,
          onChange: async (v) => {
            const r = await Api.post('/api/update/settings', { autoCheck: v })
            if (r.ok && r.data) setInfo((prev) => Object.assign({}, prev || {}, { settings: r.data.settings }))
            toast(v ? '已开启自动检查' : '已关闭自动检查')
          },
        }),
      ),
      h(Field, { label: '自动安装', hint: '默认关闭；只有 git 检出且工作区干净时才会真的拉取' },
        h(Toggle, {
          value: !!s.autoApply,
          onChange: async (v) => {
            if (v) {
              const ok = await confirmDialog('开启自动安装？', { title: '自动更新', detail: 'autoApply 打开后，后台检查到新版且 git 工作区干净时会自动 git pull 并重启运行时。', okText: '开启' })
              if (!ok) return
            }
            const r = await Api.post('/api/update/settings', { autoApply: v })
            if (r.ok && r.data) setInfo((prev) => Object.assign({}, prev || {}, { settings: r.data.settings }))
          },
        }),
      ),
    ),
    h(Row, { gap: 8, wrap: true },
      h(Btn, { size: 'sm', disabled: !!busy, onClick: () => check(true) }, busy === 'check' ? '检查中…' : '检查更新'),
      h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !(up && up.updateAvailable), onClick: apply }, busy === 'apply' ? '更新中…' : '立即更新'),
      h(Btn, { kind: 'ghost', size: 'sm', disabled: !!busy, onClick: load }, '重新读取'),
    ),
    diag ? h(Note, {}, '最近操作：' + diag) : null,
    s.lastCheckAt ? h(Note, {}, '上次检查：' + new Date(s.lastCheckAt).toLocaleString()) : null,
    h(Note, {}, '· 当前是本地链接安装（插件目录本身是 git 检出）时，一键更新会 git pull --ff-only，成功后运行时自动重启。'),
    h(Note, {}, '· npm / DSH 插件管理器安装的版本不会自己改用户 profile，只会提示你去更新。'),
  )
}
