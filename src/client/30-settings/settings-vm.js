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

// ── 手机连接（桌面端）：局域网 + TLS + 配对 + 设备权限 ──────────────────
// 术语先说清（0.8.10 起全项目统一）：
//   · 「她的手机」= 她用的 Android 模拟器（Waydroid / DSH_Phone），在「屏幕」页；
//   · 「手机连接 / 手机端」= 你自己手上的手机连到这台电脑，这里管的是这个。
function MobileGateCard() {
  const gate = useApi('/api/mobile-gate/status', { refreshMs: 8000 })
  const [busy, setBusy] = React.useState('')
  const [pair, setPair] = React.useState(null) // {code, expiresAt}
  const [nowTick, setNowTick] = React.useState(Date.now())
  React.useEffect(() => {
    if (!pair) return undefined
    const t = setInterval(() => setNowTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pair])

  const st = gate.data || {}
  const enabled = !!st.enabled
  const devices = Array.isArray(st.devices) ? st.devices : []
  const activeDevices = devices.filter((d) => !d.revokedAt)
  const addresses = Array.isArray(st.addresses) ? st.addresses : []

  const setEnabled = async (on) => {
    setBusy('toggle')
    try {
      const r = await Api.post('/api/mobile-gate/enable', { enabled: !!on })
      if (!r.ok || (r.data && r.data.ok === false)) {
        toast('操作失败：' + (r.error || (r.data && r.data.error) || '未知错误'), 'error')
        return
      }
      toast(on ? '手机连接已开启（HTTPS）' : '手机连接已关闭，外部已断开')
      if (!on) setPair(null)
      gate.reload()
    } finally {
      setBusy('')
    }
  }

  const issueCode = async () => {
    setBusy('code')
    try {
      const r = await Api.post('/api/mobile-gate/pair-code', {})
      if (!r.ok || (r.data && r.data.ok === false)) { toast('生成配对码失败：' + (r.error || (r.data && r.data.error) || ''), 'error'); return }
      setPair({ code: String((r.data && r.data.code) || ''), expiresAt: Number((r.data && r.data.expiresAt) || 0) })
      setNowTick(Date.now())
      gate.reload()
    } finally {
      setBusy('')
    }
  }

  const revoke = async (d) => {
    const ok = await confirmDialog('撤销「' + (d.name || '这台手机') + '」？', {
      title: '撤销手机',
      detail: '撤销后这台手机的令牌立刻失效，要重新配对才能再连。不影响你电脑上的聊天。',
      danger: true,
      okText: '撤销',
    })
    if (!ok) return
    setBusy('revoke')
    try {
      const r = await Api.post('/api/mobile-gate/revoke', { deviceId: d.id })
      if (!r.ok) { toast('撤销失败：' + (r.error || ''), 'error'); return }
      toast('已撤销，这台手机需要重新配对')
      gate.reload()
    } finally {
      setBusy('')
    }
  }

  const copyText = async (text, label) => {
    try { await navigator.clipboard.writeText(String(text)); toast(label + '已复制') } catch (e) { toast(String(text)) }
  }

  const leftSec = pair && pair.expiresAt ? Math.max(0, Math.round((pair.expiresAt - nowTick) / 1000)) : 0

  return h(Card, {
    title: '手机连接（把手机接过来）',
    sub: '局域网 + HTTPS + 一次性配对码；默认关闭',
    tag: enabled ? ('已开启 · ' + activeDevices.length + ' 台设备') : '未开启',
    actions: h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || gate.loading, onClick: gate.reload }, '刷新'),
      h(Btn, {
        size: 'sm',
        kind: enabled ? 'danger' : 'primary',
        disabled: !!busy || !!gate.error,
        title: enabled ? '关闭后立即断开所有外部连接（已配对设备的令牌保留，下次开启还能用）' : '开启后会在局域网端口上起一个 HTTPS 网关（手机必须配对才能用）',
        onClick: () => { void setEnabled(!enabled) },
      }, busy === 'toggle' ? '处理中…' : (enabled ? '关闭手机连接' : '开启手机连接')),
    ),
  },
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        border: '1px solid ' + T.warn, borderRadius: 10, padding: '7px 10px', background: 'rgba(245,158,11,.10)',
      },
    },
      h('span', { style: { fontSize: 12.5, fontWeight: 700, color: T.text } }, '🧪 手机端 · 正在研究'),
      h('span', { style: { fontSize: 11.5, color: T.text2 } }, '内部测试版：只有「网页版聊天 + 看状态」可用，功能会变；不要当成品，也先别拿去当唯一入口。'),
    ),
    h(Note, {}, '⚠ 名字别混：「她的手机」是她用的安卓模拟器（在「屏幕」页）；**这里的「手机」是你自己手上的手机**，连的是这台电脑。'),
    gate.error ? h(ErrorBox, { title: '读不到手机连接状态', error: gate.error, onRetry: gate.reload }) : null,
    !gate.data && !gate.error ? h(Loading, { text: '正在读手机连接状态…' }) : null,

    gate.data ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      h(Row, { gap: 8, wrap: true },
        h(Dot, { on: enabled, tone: enabled ? T.ok : T.idle }),
        h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, enabled ? '正在监听（只在局域网内）' : '没有监听，手机连不上这台电脑'),
        h('span', { style: { flex: 1 } }),
        h(KV, { k: '端口', v: String(st.port || '—') }),
        h(KV, { k: '加密', v: st.tls ? 'HTTPS（自签）' : '—' }),
      ),

      enabled
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { style: { fontSize: 12, color: T.text2 } }, '手机浏览器直接打开这个地址就能用（不用装 App；页面上会标着「正在研究」）：'),
            addresses.length
              ? addresses.map((a) => h(Row, { key: a.ip, gap: 6, wrap: true },
                  h('code', { style: { fontSize: 11.5, color: T.text, background: T.bg2, border: '1px solid ' + T.border, borderRadius: 6, padding: '2px 6px' } }, a.url),
                  h('span', { style: { fontSize: 10.5, color: a.kind === 'vpn' ? T.ok : T.text3 } }, a.note || (a.iface + ' · ' + a.ip)),
                  h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { void copyText(a.url, '地址') } }, '复制'),
                ))
              : h(Note, {}, '没检测到局域网网卡（只有回环）——先用 Wi-Fi 连上网络，或改端口/网卡后重开。'),
            addresses.some((a) => a.kind === 'vpn')
              ? null
              : h(Note, {}, '想出门也能连：电脑和手机都装同一个 Tailscale（或 ZeroTier）账号，装好后回来点「刷新」，这里会多出一条「虚拟局域网（不在同一个 Wi-Fi 也能连）」的地址，手机用那个地址打开即可。不要做路由器端口转发。'),
            h(Row, { gap: 6, wrap: true },
              h('span', { style: { fontSize: 11.5, color: T.text3 } }, '证书指纹（手机首次连接会对一次）：'),
              h('code', { style: { fontSize: 10.5, color: T.text2, fontFamily: T.mono, overflowWrap: 'anywhere' } }, String(st.fingerprint || '—')),
              h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { void copyText(st.fingerprint || '', '指纹') } }, '复制'),
            ),
          )
        : h(Note, {}, '开启后会在这里显示：局域网地址、证书指纹、配对码。手机不在同一 Wi-Fi 时连不上（除非走虚拟局域网，见下）。'),

      enabled
        ? h('div', {
            style: {
              border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2,
              padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
            },
          },
            h(Row, { gap: 8, wrap: true },
              h('span', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, '配对码'),
              h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy, onClick: () => { void issueCode() } }, busy === 'code' ? '生成中…' : (pair ? '换一个' : '生成配对码')),
              h('span', { style: { flex: 1 } }),
              pair && leftSec > 0 ? h(Badge, { tone: 'warn' }, '剩 ' + leftSec + ' 秒') : null,
              pair && leftSec <= 0 ? h(Badge, { tone: 'danger' }, '已过期') : null,
            ),
            pair
              ? h(Row, { gap: 8, wrap: true },
                  h('code', {
                    style: { fontSize: 24, letterSpacing: 6, fontWeight: 700, color: T.text, fontFamily: T.mono },
                  }, leftSec > 0 ? pair.code : '—— —— ——'),
                  h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { void copyText(pair.code, '配对码') } }, '复制'),
                )
              : h(Note, {}, '点「生成配对码」，手机上输入这 6 位数字就能配对；一次性、5 分钟内有效。'),
            h(Note, {}, '配对成功后：手机拿到一枚独立令牌（面板里可单独撤销），只能聊天 + 看状态，不能改设置、不能开虚拟机、不能备份。'),
          )
        : null,

      devices.length
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 } },
            h('div', { style: { fontSize: 12, color: T.text2, marginBottom: 2 } }, '已配对设备（' + activeDevices.length + ' 台有效 / ' + devices.length + ' 条记录）'),
            devices.map((d) => h(Row, {
              key: String(d.id),
              gap: 8,
              wrap: true,
              style: { padding: '5px 0', borderTop: '1px solid ' + T.border, minWidth: 0 },
            },
              h(Dot, { on: !d.revokedAt, tone: d.revokedAt ? T.idle : T.ok }),
              h('span', { style: { fontSize: 12, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 } }, String(d.name || '手机')),
              h(Badge, { tone: d.scope === 'readonly' ? undefined : 'ok' }, d.scope === 'readonly' ? '只读' : '可聊天'),
              h('span', { style: { flex: 1 } }),
              h('span', { style: { fontSize: 10.5, color: T.text3, whiteSpace: 'nowrap' } },
                d.revokedAt ? ('已撤销 ' + fmtDateTime(d.revokedAt)) : (d.lastSeenAt ? ('最后活跃 ' + fmtDateTime(d.lastSeenAt)) : '还没连过')),
              d.revokedAt ? null : h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: () => { void revoke(d) } }, '撤销'),
            )),
          )
        : h(Note, {}, '还没有手机配对过。'),

      h(Row, { gap: 6, wrap: true },
        h(Btn, {
          size: 'sm', kind: 'ghost',
          onClick: () => { void (async () => {
            const r = await Api.get('/api/mobile-gate/audit?limit=20')
            if (!r.ok || !r.data) { toast('读不到审计日志：' + (r.error || ''), 'error'); return }
            const lines = (r.data.entries || []).map((e) => String(e.at || '').slice(11, 19) + ' ' + String(e.type || '') + (e.path ? ' ' + String(e.path) : '') + (e.name ? ' ' + String(e.name) : '') + (e.reason ? ' ' + String(e.reason) : ''))
            await alertDialog(lines.length ? lines.join('\n') : '还没有审计记录', { title: '手机连接 · 最近 20 条审计' })
          })() },
        }, '看审计日志'),
        h(Note, {}, '审计只记「谁在什么时候做了什么」，不记令牌明文。'),
      ),
    ) : null,

    h(Note, {}, '· 安全边界：主服务仍然只听 127.0.0.1；手机走的是另一个 HTTPS 端口，关掉开关就立刻断开。**不要把这个端口做路由器端口转发**。'),
    h(Note, {}, '· 手机能做什么写在配对结果里（聊天 / 历史 / 状态 / 图片）。设置、环境、虚拟机、备份、她的屏幕这些永远只在电脑面板里。'),
  )
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

    modeChat ? h(Note, { style: { color: T.warn } }, '⚠️ 当前是无虚拟机模式，虚拟机聊天不会生效；要使用请让运行时切到完整版。') : null,

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

    // 直连（OneBot 11）：设置 + 测试连接/发测试消息按钮
    typeof DirectChatCard === 'function' ? h(DirectChatCard, {}) : null,

    // 手机连接（手机端适配的桌面侧）：局域网 + TLS + 配对 + 设备权限
    typeof MobileGateCard === 'function' ? h(MobileGateCard, {}) : null,

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
