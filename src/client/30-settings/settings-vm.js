// 30-settings/settings-vm.js —— 设置·VM 聊天卡片（D10 A：完整设置 + 状态 + 一键打开屏幕）
//
// 内容：/api/vm-chat/settings 的 9 项设置（开关 / 看消息 / 自动启动 / 空闲关闭 /
//       检查间隔 / 目标联系人 / 未读扫描 / watchdog / 发送图片）+ 运行状态 + 唤醒 /
//       立即检查 / 发测试文字 / 打开她的屏幕
// 契约：function SettingsVmTab()（外壳不传 props，需要什么自己取接口；N02 不写死角色信息）
// 可靠性：读取失败时禁用保存；POST 只发改动字段；间隔前端 clamp（后端同样 clamp）；
//         唤醒/检查/发消息都会真的操作虚拟机里的社交软件 → 一律 confirmDialog

// 只把「和已保存值不同」的字段挑出来
function settingsVmChanged(cur, next, keys) {
  const out = {}
  for (const k of keys) {
    const a = cur ? cur[k] : undefined
    const b = next ? next[k] : undefined
    if (typeof a === 'number' || typeof b === 'number') {
      if (Number(a) !== Number(b)) out[k] = b
    } else if (a !== b) {
      out[k] = b
    }
  }
  return out
}

// 一行设置：左边标题+说明，右边控件
function settingsVmRow(title, hint, control) {
  return h('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
      borderTop: '1px solid ' + T.border, minWidth: 0,
    },
  },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: 12.5, color: T.text } }, title),
      hint ? h('div', { style: { fontSize: 10.5, color: T.text3, lineHeight: 1.55 } }, hint) : null,
    ),
    control,
  )
}

// 把 /api/vm-chat/check 的 result 转成一句人话
function settingsVmCheckSummary(r) {
  if (!r || typeof r !== 'object') return '检查完成（没有返回详情）'
  if (r.error) return '检查失败：' + r.error
  if (r.requiresLogin) return '检测到登录/扫码页：' + (r.loginHint || '去「看屏幕」里登录后再试')
  const bits = []
  if (r.skipped === 'targetContact') bits.push('当前会话不是目标联系人，已跳过回复')
  if (r.duplicate) bits.push('最近消息已经回过，跳过')
  bits.push('未读 ' + (Number(r.unread) || 0) + ' 条 / 最近 ' + (Number(r.recent) || 0) + ' 条')
  if (r.sent) bits.push(r.sent.ok ? '已自动回复' : ('回复失败：' + (r.sent.error || '未知原因')))
  else if (r.analysis && r.analysis.needReply === false) bits.push('不需要回复')
  return bits.join('；')
}

function SettingsVmTab() {
  const status = useStatus()
  const st = (status && status.data) || {}

  const settingsApi = useApi('/api/vm-chat/settings')
  const vmStatusApi = useApi('/api/vm-chat/status', { refreshMs: 12000 })

  const [draft, setDraft] = React.useState({
    enabled: false,
    checkMessages: true,
    autoStart: true,
    idleShutdown: true,
    checkIntervalMin: 15,
    targetContact: '',
    unreadScan: false,
    watchdog: true,
    sendImages: true,
  })
  const [busy, setBusy] = React.useState('')
  const [lastResult, setLastResult] = React.useState('')
  const [sendOpen, setSendOpen] = React.useState(false)
  const [sendText, setSendText] = React.useState('')

  const loaded = (settingsApi.data && settingsApi.data.settings) || null

  React.useEffect(() => {
    const s = settingsApi.data && settingsApi.data.settings
    if (!s) return
    setDraft({
      enabled: !!s.enabled,
      checkMessages: s.checkMessages !== false,
      autoStart: s.autoStart !== false,
      idleShutdown: s.idleShutdown !== false,
      unreadScan: s.unreadScan === true,
      watchdog: s.watchdog !== false,
      sendImages: s.sendImages !== false,
      checkIntervalMin: Math.round(clampNum(s.checkIntervalMin, 2, 1440, 15)),
      targetContact: String(s.targetContact || ''),
    })
  }, [settingsApi.data])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => { settingsApi.reload(); vmStatusApi.reload() }

  // ── 保存设置（只发改动字段）──────────────────────────────────────────
  const saveSettings = () => run('save', async () => {
    if (settingsApi.error) { toast('VM 聊天设置读取失败，先点「刷新」再保存', 'error'); return }
    const cur = loaded || {}
    const next = {
      enabled: !!draft.enabled,
      checkMessages: !!draft.checkMessages,
      autoStart: !!draft.autoStart,
      idleShutdown: !!draft.idleShutdown,
      checkIntervalMin: Math.round(clampNum(draft.checkIntervalMin, 2, 1440, 15)),
      targetContact: String(draft.targetContact || '').trim().slice(0, 60),
      unreadScan: !!draft.unreadScan,
      watchdog: !!draft.watchdog,
      sendImages: !!draft.sendImages,
    }
    setDraft((prev) => Object.assign({}, prev, { checkIntervalMin: next.checkIntervalMin, targetContact: next.targetContact }))
    const body = settingsVmChanged(cur, next, [
      'enabled', 'checkMessages', 'autoStart', 'idleShutdown',
      'checkIntervalMin', 'targetContact', 'unreadScan', 'watchdog', 'sendImages',
    ])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/vm-chat/settings', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('VM 聊天设置已保存')
    settingsApi.reload()
  })

  // ── 唤醒 / 检查 / 发送 ──────────────────────────────────────────────
  const wakeVm = () => run('wake', async () => {
    const ok = await confirmDialog('唤醒虚拟机？', {
      title: '唤醒虚拟机',
      detail: '会启动她的虚拟屏幕（约占 2–6GB 内存），第一次可能要一两分钟；唤醒后可以「立即检查」消息。',
      okText: '唤醒',
    })
    if (!ok) return
    const r = await Api.post('/api/vm-chat/wake', {}, { timeoutMs: 180000 })
    if (!r.ok) {
      const data = r.data || {}
      toast('唤醒失败：' + (data.error || r.error || '未知错误'), 'error')
      setLastResult('唤醒失败：' + (data.error || r.error || '未知错误'))
      return
    }
    const running = !!(r.data && r.data.running)
    toast(running ? '虚拟机已唤醒' : '唤醒指令已发出，但虚拟机还没就绪')
    setLastResult(running ? '虚拟机已唤醒，可以「立即检查」消息。' : '唤醒指令已发出，虚拟机还没就绪；稍等再刷新状态。')
    vmStatusApi.reload()
  })

  const checkNow = () => run('check', async () => {
    const ok = await confirmDialog('现在检查虚拟机消息？', {
      title: '立即检查',
      detail: '会截屏识别当前会话；如果设置里开启了自动回复，可能直接以她的身份回复对方。检查/截图会消耗少量 token。',
      okText: '开始检查',
    })
    if (!ok) return
    setLastResult('检查中…（可能要几十秒）')
    const r = await Api.post('/api/vm-chat/check', {}, { timeoutMs: 180000 })
    if (!r.ok) {
      const msg = '检查失败：' + (r.error || '未知错误')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    const result = (r.data && r.data.result) || {}
    const msg = settingsVmCheckSummary(result)
    setLastResult(msg)
    toast(result && result.error ? msg : '检查完成', result && result.error ? 'error' : 'ok')
    if (result && result.ok !== false) { vmStatusApi.reload(); settingsApi.reload() }
  })

  const openSendModal = () => {
    setSendText('')
    setSendOpen(true)
  }

  const sendTestText = () => run('send', async () => {
    const text = String(sendText || '').trim()
    if (!text) { toast('先输入要发的内容', 'error'); return }
    const ok = await confirmDialog('以她的身份在虚拟机社交软件里发送这句话？', {
      title: '发送测试消息',
      detail: text.length > 120 ? text.slice(0, 120) + '…' : text,
      okText: '发送',
    })
    if (!ok) return
    setLastResult('发送中…')
    const r = await Api.post('/api/vm-chat/send', { text }, { timeoutMs: 180000 })
    if (!r.ok) {
      const msg = '发送失败：' + (r.error || '未知错误')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    const result = (r.data && r.data.result) || {}
    if (result && result.ok === false) {
      const msg = '发送失败：' + (result.error || '发送被拒绝') + (result.requiresLogin ? '（先在「看屏幕」里登录）' : '')
      setLastResult(msg)
      toast(msg, 'error')
      return
    }
    setSendOpen(false)
    setSendText('')
    setLastResult('测试消息已发送。')
    toast('测试消息已发送')
    vmStatusApi.reload()
  })

  const openScreen = async () => {
    try {
      if (typeof openHerScreen === 'function') await openHerScreen()
      else Api.openExternal('/screen')
    } catch (e) {
      toast('打开她的屏幕失败：' + ((e && e.message) || '浏览器拦截了弹窗'), 'error')
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  const vmStatus = (vmStatusApi.data && vmStatusApi.data.status) || null
  const running = !!(vmStatus && vmStatus.running)
  const apps = (vmStatus && Array.isArray(vmStatus.apps)) ? vmStatus.apps : []
  const last = (vmStatus && vmStatus.last) || null
  const appNames = apps.map((a) => String((a && a.name) || (a && a.id) || '')).filter(Boolean)
  const modeChat = String(st.mode || '') === 'chat'
  const lastCheckAt = (loaded && loaded.lastCheckAt) || (last && last.at) || 0
  const lastUserText = loaded && loaded.lastUserText ? String(loaded.lastUserText) : ''
  const dirty = !!loaded && Object.keys(settingsVmChanged(loaded, {
    enabled: !!draft.enabled,
    checkMessages: !!draft.checkMessages,
    autoStart: !!draft.autoStart,
    idleShutdown: !!draft.idleShutdown,
    checkIntervalMin: Math.round(clampNum(draft.checkIntervalMin, 2, 1440, 15)),
    targetContact: String(draft.targetContact || '').trim().slice(0, 60),
    unreadScan: !!draft.unreadScan,
    watchdog: !!draft.watchdog,
    sendImages: !!draft.sendImages,
  }, ['enabled', 'checkMessages', 'autoStart', 'idleShutdown', 'checkIntervalMin', 'targetContact', 'unreadScan', 'watchdog', 'sendImages'])).length > 0

  const setBool = (key, value) => setDraft((prev) => Object.assign({}, prev, { [key]: !!value }))

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：说明 + 刷新 + 打开屏幕
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '虚拟机社交软件：她在虚拟机里用 QQ 之类的软件和你聊天（需要虚拟屏幕/环境）。设置改完点下面「保存设置」生效。'),
      h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy }, '刷新'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: openScreen }, '打开她的屏幕'),
      ),
    ),

    modeChat ? h(Note, { style: { color: T.warn } }, '⚠️ 当前是纯聊天模式，虚拟机聊天不会生效；要使用请让运行时切到完整版。') : null,

    // 状态
    h(Card, {
      title: '运行状态',
      tag: '虚拟机里的社交软件',
      actions: h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !!vmStatusApi.error, onClick: vmStatusApi.reload }, '刷新状态'),
    },
      vmStatusApi.error
        ? h(ErrorBox, { title: 'VM 状态读取失败', error: vmStatusApi.error, onRetry: vmStatusApi.reload })
        : null,
      vmStatus
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
            h(Row, { gap: 8 },
              h(Dot, { on: running, tone: running ? T.ok : T.idle }),
              h('span', { style: { fontSize: 13, color: T.text, fontWeight: 600 } }, running ? '虚拟机运行中' : '虚拟机未运行'),
              apps.length ? h(Badge, { tone: 'ok' }, apps.length + ' 个社交应用') : null,
              last && last.loginRequired ? h(Badge, { tone: 'danger' }, '停在登录/扫码页') : null,
              last && last.skipped === 'targetContact' ? h(Badge, { tone: 'warn' }, '会话不在目标范围') : null,
            ),
            apps.length
              ? h(Note, {}, '检测到：' + appNames.slice(0, 6).join(' / ') + (appNames.length > 6 ? ' 等 ' + appNames.length + ' 个' : ''))
              : h(Note, {}, running ? '虚拟机能连上，但没检测到社交应用（可能停在登录页或应用没打开）。' : '唤醒或启动虚拟屏幕后才能检测社交应用。'),
            h(Row, { gap: 10, style: { flexWrap: 'wrap' } },
              h('span', { style: { fontSize: 11.5, color: T.text3 } },
                lastCheckAt ? '上次检查：' + fmtDateTime(lastCheckAt) : '还没有检查过'),
              lastUserText ? h('span', { style: { fontSize: 11.5, color: T.text2, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                '对方最新：' + (lastUserText.length > 60 ? lastUserText.slice(0, 60) + '…' : lastUserText)) : null,
            ),
            last && last.action === 'check' && last.unread === 0 && last.recent === 0
              ? h(Note, {}, '最近一次检查：没有发现新消息。')
              : null,
            lastResult ? h(Note, { style: { color: T.text2 } }, lastResult) : null,
          )
        : h(Note, {}, vmStatusApi.loading ? '状态读取中…' : '还没拿到虚拟机状态，点「刷新状态」再试。'),
      h(Row, { gap: 8, style: { marginTop: 2 } },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy, onClick: wakeVm }, busy === 'wake' ? '唤醒中…' : '唤醒虚拟机'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: checkNow }, busy === 'check' ? '检查中…' : '立即检查消息'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: openSendModal }, '发测试文字'),
      ),
      h(Note, {}, '唤醒/检查都会真实操作虚拟机（占用内存、消耗少量 token）；检查时如果开启了自动回复，她可能会直接回对方。'),
    ),

    // 设置
    h(Card, {
      title: 'VM 聊天设置',
      tag: dirty ? '有未保存的修改' : '',
      actions: h(Btn, {
        kind: 'primary', size: 'sm',
        disabled: !!busy || !!settingsApi.error,
        onClick: saveSettings,
      }, busy === 'save' ? '保存中…' : '保存设置'),
    },
      settingsApi.error ? h(ErrorBox, { title: '设置读取失败（读失败禁存）', error: settingsApi.error, onRetry: settingsApi.reload }) : null,
      settingsApi.loading && !settingsApi.data ? h(Loading, { text: 'VM 设置读取中…' }) : null,

      // 主动消息
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 2 } }, '主动消息'),
      settingsVmRow(
        '主动消息走虚拟机',
        '她主动发消息时，通过虚拟机里的社交软件发给你；关掉就只在 DSH 聊天窗口里说',
        h(Toggle, { checked: !!draft.enabled, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('enabled', v) }),
      ),

      // 检查与回复
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '检查与回复'),
      settingsVmRow(
        '定时看消息',
        '按下面的间隔检查虚拟机里的新消息；有新消息时按需回复',
        h(Toggle, { checked: !!draft.checkMessages, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('checkMessages', v) }),
      ),
      settingsVmRow(
        '检查间隔',
        '2 – 1440 分钟；开着「定时看消息」才生效',
        h(NumInput, {
          value: draft.checkIntervalMin,
          onChange: (v) => setDraft((prev) => Object.assign({}, prev, { checkIntervalMin: v })),
          min: 2, max: 1440, step: 1, suffix: '分钟', width: 96,
          disabled: !!busy || !!settingsApi.error,
        }),
      ),
      settingsVmRow(
        '目标联系人',
        '只处理和 TA 的会话（会话名里包含这个字符串即可）；留空 = 不限制，当前打开哪个会话就处理哪个',
        h('div', { style: { width: 190 } }, h(TextInput, {
          value: draft.targetContact,
          onChange: (v) => setDraft((prev) => Object.assign({}, prev, { targetContact: v })),
          placeholder: '留空 = 不限制',
          disabled: !!busy || !!settingsApi.error,
        })),
      ),
      settingsVmRow(
        '未读扫描',
        '回复前先只读扫一遍其它会话的未读消息（更主动，也更费 token）',
        h(Toggle, { checked: !!draft.unreadScan, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('unreadScan', v) }),
      ),

      // 稳定性 / 省内存
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '稳定性与内存'),
      settingsVmRow(
        '自动启动虚拟机',
        '需要发送/检查时自动唤醒虚拟屏幕（不勾就要你手动开）',
        h(Toggle, { checked: !!draft.autoStart, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('autoStart', v) }),
      ),
      settingsVmRow(
        '用完自动关虚拟机',
        '每次检查/发完自动关闭虚拟屏幕，省内存（下次要重新唤醒）',
        h(Toggle, { checked: !!draft.idleShutdown, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('idleShutdown', v) }),
      ),
      settingsVmRow(
        '窗口看门狗',
        '聊天窗口不在时自动重开应用（≥60 秒防抖，避免反复重启）',
        h(Toggle, { checked: !!draft.watchdog, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('watchdog', v) }),
      ),

      // 图片
      h('div', { style: { fontSize: 12, fontWeight: 600, color: T.text2, marginTop: 8 } }, '图片'),
      settingsVmRow(
        '允许往聊天软件发图片',
        '她可以通过 VM 通道把图片粘贴进聊天软件；关掉后发图会被拒绝',
        h(Toggle, { checked: !!draft.sendImages, disabled: !!busy || !!settingsApi.error, onChange: (v) => setBool('sendImages', v) }),
      ),

      h(Note, {}, '保存只提交改动过的字段；间隔等数值前端也会夹到合法范围内。'),
    ),

    // 说明
    h(Card, { title: '说明' },
      h(Note, {}, '· 虚拟机聊天不是聊天/识图的前置条件：不装虚拟机也能正常聊天，只是没有「在 QQ 里和你聊」这一层。'),
      h(Note, {}, '· 检测到登录/扫码页时不会误发消息；先去「打开她的屏幕」里扫码登录，再回来点「立即检查」。'),
      h(Note, {}, '· 「立即检查」和「发测试文字」都会真的截屏/操作虚拟机里的软件，敏感场景请先确认。'),
    ),

    // 发测试文字弹层
    h(Modal, {
      open: !!sendOpen,
      title: '发测试文字到虚拟机社交软件',
      onClose: () => { if (!busy) setSendOpen(false) },
      footer: h(Row, { gap: 8 },
        h(Btn, { kind: 'ghost', disabled: !!busy, onClick: () => setSendOpen(false) }, '取消'),
        h(Btn, { kind: 'primary', disabled: !!busy || !String(sendText || '').trim(), onClick: sendTestText }, busy === 'send' ? '发送中…' : '发送'),
      ),
    },
      h(Field, { label: '内容', hint: '会以她的身份、在虚拟机当前打开的会话里发送；发送前还会再确认一次。' },
        h(TextArea, { value: sendText, onChange: setSendText, rows: 3, placeholder: '比如：我到家啦，你在干嘛～', disabled: !!busy }),
      ),
    ),
  )
}
