// 30-settings/settings-life.js —— 设置：生活 / 环境（主动消息 / 心跳 / 日记 / 天气表现 / 桌宠 / 权限）
//
// 本文件在 settings-core.js 之后构建，所以可以直接用：
//   stgCoreEq / stgCoreDiff / stgCoreHas / stgCoreNum / stgCoreInt / stgCoreErrBox /
//   stgCoreBusy / stgCoreDraft / stgCoreSaveBtn / SettingsEconomyCard / SettingsBalanceAlertCard
//
// 约定（docs/NATIVE-CLIENT-ARCH.md）：
//   · 不写 import/export；颜色只走 T.*；中文 UI；不写死角色名/ID（N02）；
//   · 保存只提交改动字段；读失败禁用保存 + ErrorBox；危险操作 confirmDialog；成功 toast；
//   · 桌宠卡片由 40-screen/pet.js 提供（构建顺序在后，只在渲染时调用，所以运行时可用）。

// ───────────────────────── 生活：现在在做什么 ─────────────────────────

function stgLifeMinutesLeft(ts) {
  const n = Number(ts)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.max(0, Math.round((n - Date.now()) / 60000))
}

function stgLifeEnergyTone(energy) {
  const v = Number(energy)
  if (!Number.isFinite(v)) return undefined
  if (v >= 55) return 'ok'
  if (v >= 30) return 'warn'
  return 'danger'
}

function SettingsLifeNowCard() {
  const api = useApi('/api/life/states', { refreshMs: 15000 })
  const [tickBusy, setTickBusy] = React.useState(false)
  const states = (api.data && api.data.states) || []
  const doTick = async () => {
    setTickBusy(true)
    try {
      const r = await Api.post('/api/life/tick', {})
      if (!r.ok) { toast('操作失败：' + (r.error || '未知错误'), 'error'); return }
      toast('她重新安排了一下现在做什么')
      api.reload()
    } finally {
      setTickBusy(false)
    }
  }
  return h(Card, {
    title: '现在在做什么', sub: '她自己安排的生活状态',
    actions: h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!api.error, onClick: api.reload }, '刷新'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: tickBusy || !!api.error, title: '让她重新决定当前行为', onClick: () => { doTick().catch(() => {}) } }, tickBusy ? '安排中…' : '让她动一动'),
    ),
  },
    stgCoreErrBox(api.error, api.reload),
    states.length
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0 } }, states.map((st, i) => {
          const left = stgLifeMinutesLeft(st.endsAt)
          return h('div', {
            key: String(st.characterId || i),
            style: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: i ? '1px solid ' + T.border : 'none', minWidth: 0 },
          },
            h(Avatar, { path: st.avatar || '', name: st.name || '', size: 32 }),
            h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 } },
              h('div', { style: { fontSize: 13, color: T.text, fontWeight: 600 } },
                (st.name || '') + (st.placeName ? ' · ' + st.placeName : '') + (st.hotspotLabel ? ' · ' + st.hotspotLabel : '')),
              h(Row, { gap: 6, wrap: true },
                h(Badge, { tone: stgLifeEnergyTone(st.energy), title: '精力' }, '精力 ' + (Number.isFinite(Number(st.energy)) ? Math.round(Number(st.energy)) : '—')),
                st.mood ? h(Badge, { title: '心情' }, String(st.mood)) : null,
                h(Badge, { title: '当前行为' }, String(st.behaviorLabel || '发呆')),
                left === null ? null : h(Note, {}, '预计再 ' + left + ' 分钟'),
              ),
            ),
          )
        }))
      : (api.error ? null : h(Empty, { icon: '🌙' }, '她现在没在任何地点（生活模拟可能没启动 / 当前模式是纯聊天）')),
    h(Note, {}, '这是她的生活模拟状态：行为、地点、精力、心情都由运行时自己推进；「让她动一动」= 立刻重算一次。'),
  )
}

// ───────────────────────── 生活：作息表 ─────────────────────────

const STG_LIFE_TIME_RE = /\d{1,2}:\d{2}/

function stgLifeSchedulesSeed(d) {
  const l = (d && d.life) || {}
  const list = Array.isArray(l.schedules) ? l.schedules : []
  return {
    schedules: list.map((s) => ({
      time: String((s && s.time) || ''),
      label: String((s && s.label) || ''),
      days: String((s && s.days) || '每天'),
      place: (s && s.place) || '',
    })),
  }
}

function SettingsLifeScheduleCard() {
  const api = useApi('/api/life')
  const [busy, run] = stgCoreBusy()
  const [newTime, setNewTime] = React.useState('')
  const [newLabel, setNewLabel] = React.useState('')
  const f = stgCoreDraft(api, stgLifeSchedulesSeed)
  const d = f.draft
  const rows = (d && d.schedules) || []
  const patchRows = (next) => f.patch({ schedules: next })
  const addRow = () => {
    const time = String(newTime || '').trim()
    const label = String(newLabel || '').trim()
    if (!time || !label) { toast('时间和内容都要填', 'error'); return }
    if (!STG_LIFE_TIME_RE.test(time)) { toast('时间格式像 07:30 或 21:00-22:00', 'error'); return }
    if (rows.length >= 24) { toast('作息最多 24 条', 'error'); return }
    patchRows(rows.concat({ time: time.slice(0, 20), label: label.slice(0, 40), days: '每天', place: '' }))
    setNewTime('')
    setNewLabel('')
  }
  const save = () => run(async () => {
    if (!d || !f.base) return
    const cleaned = []
    for (let i = 0; i < rows.length; i++) {
      const t = String(rows[i].time || '').trim()
      const lb = String(rows[i].label || '').trim()
      if (!t && !lb) continue
      if (!t || !lb) { toast('第 ' + (i + 1) + ' 条作息的时间和内容都要填', 'error'); return }
      if (!STG_LIFE_TIME_RE.test(t)) { toast('第 ' + (i + 1) + ' 条时间格式不对（像 07:30 或 21:00-22:00）', 'error'); return }
      cleaned.push({ time: t.slice(0, 20), label: lb.slice(0, 40), days: String(rows[i].days || '每天').slice(0, 10), place: rows[i].place || '' })
    }
    const payload = stgCoreDiff(f.base, { schedules: cleaned }, ['schedules'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('作息表已保存')
    api.reload()
  })
  return h(Card, {
    title: '作息表', sub: '每天固定时间点/时段做什么', tag: '可增删',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      rows.length ? rows.map((row, i) => h(Row, { key: 'sch' + i, gap: 6 },
        h('span', { style: { width: 148, minWidth: 110 } }, h(TextInput, {
          value: row.time, placeholder: '07:30',
          onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { time: v }) : x))),
        })),
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, {
          value: row.label, placeholder: '起床 / 上学 / 午饭…',
          onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { label: v }) : x))),
        })),
        h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这条（保存后生效）', onClick: () => patchRows(rows.filter((x, j) => j !== i)) }, '✕'),
      )) : h(Note, {}, '还没有作息，先在下面加一条'),
      h(Row, { gap: 6, style: { marginTop: 4 } },
        h('span', { style: { width: 148, minWidth: 110 } }, h(TextInput, { value: newTime, placeholder: '21:00-22:00', onChange: setNewTime, onEnter: addRow })),
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newLabel, placeholder: '做什么（自由填写）', onChange: setNewLabel, onEnter: addRow })),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: addRow }, '+ 添加作息'),
      ),
      h(Note, {}, '时间可以写单点（07:30）也可以写时段（21:00-22:00）；作息会影响她去哪、什么时候该睡。'),
    ) : (api.error ? null : h(Loading, { text: '读取作息…' })),
  )
}

// ───────────────────────── 生活：活动池 ─────────────────────────

function stgLifeActivitiesSeed(d) {
  const l = (d && d.life) || {}
  const list = Array.isArray(l.activities) ? l.activities : []
  return {
    activities: list.map((a) => ({
      name: String((a && a.name) || ''),
      window: String((a && a.window) || ''),
      weight: stgCoreInt(a && a.weight, 0, 100, 20),
      minMin: stgCoreInt(a && a.minMin, 1, 720, 5),
      maxMin: stgCoreInt(a && a.maxMin, 1, 720, 20),
    })),
  }
}

function SettingsLifeActivityCard() {
  const api = useApi('/api/life')
  const [busy, run] = stgCoreBusy()
  const [newName, setNewName] = React.useState('')
  const f = stgCoreDraft(api, stgLifeActivitiesSeed)
  const d = f.draft
  const rows = (d && d.activities) || []
  const patchRows = (next) => f.patch({ activities: next })
  const addRow = () => {
    const name = String(newName || '').trim()
    if (!name) { toast('先写活动名', 'error'); return }
    if (rows.length >= 40) { toast('活动最多 40 个', 'error'); return }
    patchRows(rows.concat({ name: name.slice(0, 40), window: '', weight: 20, minMin: 5, maxMin: 20 }))
    setNewName('')
  }
  const save = () => run(async () => {
    if (!d || !f.base) return
    const cleaned = []
    for (let i = 0; i < rows.length; i++) {
      const name = String(rows[i].name || '').trim()
      if (!name) continue
      const win = String(rows[i].window || '').trim()
      if (win && !STG_LIFE_TIME_RE.test(win)) { toast('第 ' + (i + 1) + ' 个活动的时段格式不对（像 22:00-01:30，留空=随时）', 'error'); return }
      const minMin = stgCoreInt(rows[i].minMin, 1, 720, 5)
      const maxMin = stgCoreInt(rows[i].maxMin, 1, 720, 20)
      if (maxMin < minMin) { toast('第 ' + (i + 1) + ' 个活动：最长时长不能小于最短时长', 'error'); return }
      cleaned.push({ name: name.slice(0, 40), window: win.slice(0, 20), weight: stgCoreInt(rows[i].weight, 0, 100, 20), minMin: minMin, maxMin: maxMin })
    }
    const payload = stgCoreDiff(f.base, { activities: cleaned }, ['activities'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('活动池已保存')
    api.reload()
  })
  return h(Card, {
    title: '活动池', sub: '空闲时按权重抽；可限定只在某个时段做', tag: '权重越大越常做',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      rows.length ? rows.map((row, i) => h('div', {
        key: 'act' + i,
        style: { border: '1px solid ' + T.border, borderRadius: T.radius, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, background: T.bg2 },
      },
        h(Row, { gap: 6 },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, {
            value: row.name, placeholder: '活动名',
            onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { name: v }) : x))),
          })),
          h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这个活动（保存后生效）', onClick: () => patchRows(rows.filter((x, j) => j !== i)) }, '✕'),
        ),
        h(Row, { gap: 8, wrap: true },
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '时段'),
          h('span', { style: { width: 130 } }, h(TextInput, {
            value: row.window, placeholder: '留空=随时', mono: true,
            onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { window: v }) : x))),
          })),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '权重'),
          h(NumInput, { value: row.weight, min: 0, max: 100, step: 5, width: 70, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { weight: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '时长'),
          h(NumInput, { value: row.minMin, min: 1, max: 720, step: 1, width: 64, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { minMin: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '~'),
          h(NumInput, { value: row.maxMin, min: 1, max: 720, step: 1, width: 64, onChange: (v) => patchRows(rows.map((x, j) => (j === i ? Object.assign({}, x, { maxMin: v }) : x))) }),
          h('span', { style: { fontSize: 11.5, color: T.text3 } }, '分钟'),
        ),
      )) : h(Note, {}, '还没有活动，先在下面加一个'),
      h(Row, { gap: 6 },
        h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newName, placeholder: '活动名，例如 刷 B 站', onChange: setNewName, onEnter: addRow })),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: addRow }, '+ 添加活动'),
      ),
      h(Note, {}, '固定时段的活动只在那个时段被抽到；「留空 = 随时」任何空档都可能做。'),
    ) : (api.error ? null : h(Loading, { text: '读取活动池…' })),
  )
}

// ───────────────────────── 生活：心跳 / 主动消息 / 日记 ─────────────────────────

function stgLifeHeartbeatSeed(d) {
  const l = (d && d.life) || {}
  return {
    enabled: l.enabled !== false,
    heartbeatMin: stgCoreInt(l.heartbeatMin, 5, 180, 45),
    proactive: stgCoreInt(l.proactive, 0, 10, 3),
    proactiveEnabled: l.proactiveEnabled === true,
    proactiveMinMin: stgCoreInt(l.proactiveMinMin, 5, 1440, 30),
    proactiveMaxMin: stgCoreInt(l.proactiveMaxMin, 5, 1440, 90),
    quietStart: stgCoreInt(l.quietStart, 0, 23, 2),
    quietEnd: stgCoreInt(l.quietEnd, 0, 23, 7),
    diaryHour: stgCoreInt(l.diaryHour, 0, 23, 22),
    diaryAuto: l.diaryAuto !== false,
    smartLife: l.smartLife === true,
  }
}

function SettingsLifeHeartbeatCard() {
  const api = useApi('/api/life')
  const [busy, run] = stgCoreBusy()
  const [testing, setTesting] = React.useState(false)
  const [diaryOpen, setDiaryOpen] = React.useState(false)
  const [diaryBusy, setDiaryBusy] = React.useState(false)
  const [diaryText, setDiaryText] = React.useState('')
  const [diaryErr, setDiaryErr] = React.useState('')
  const f = stgCoreDraft(api, stgLifeHeartbeatSeed)
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      heartbeatMin: stgCoreInt(d.heartbeatMin, 5, 180, 45),
      proactive: stgCoreInt(d.proactive, 0, 10, 3),
      proactiveEnabled: !!d.proactiveEnabled,
      proactiveMinMin: stgCoreInt(d.proactiveMinMin, 5, 1440, 30),
      proactiveMaxMin: stgCoreInt(d.proactiveMaxMin, 5, 1440, 90),
      quietStart: stgCoreInt(d.quietStart, 0, 23, 2),
      quietEnd: stgCoreInt(d.quietEnd, 0, 23, 7),
      diaryHour: stgCoreInt(d.diaryHour, 0, 23, 22),
      diaryAuto: !!d.diaryAuto,
      smartLife: !!d.smartLife,
    }
    if (next.proactiveMaxMin < next.proactiveMinMin) { toast('主动消息：最大间隔不能小于最小间隔', 'error'); return }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('生活作息设置已保存')
    f.patch(next)
    api.reload()
  })
  const sendProactive = async () => {
    const ok = await confirmDialog('让她现在主动发一条消息？', {
      title: '主动消息测试',
      detail: '她会真的在聊天里给你发一句话（消耗少量 token）。',
      okText: '发一条',
    })
    if (!ok) return
    setTesting(true)
    try {
      const r = await Api.post('/api/proactive/test', {})
      if (!r.ok) { toast('生成失败：' + (r.error || '未知错误'), 'error'); return }
      const txt = r.data && r.data.text
      toast(txt ? '已发：' + String(txt).slice(0, 40) : '已发')
    } finally {
      setTesting(false)
    }
  }
  const writeDiary = async () => {
    setDiaryOpen(true)
    setDiaryBusy(true)
    setDiaryErr('')
    setDiaryText('')
    try {
      const r = await Api.post('/api/diary/generate', {})
      if (!r.ok) { setDiaryErr(r.error || '写失败'); return }
      const data = r.data || {}
      if (data.ok === false) { setDiaryErr(data.error || '还没写成（可能今天没有可写的内容）'); return }
      setDiaryText(String(data.text || '（空的）'))
    } finally {
      setDiaryBusy(false)
    }
  }
  return h(Card, {
    title: '心跳 / 主动消息 / 日记', sub: '她多久动一次、什么时候不打扰你',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 } },
      h(Field, { label: '启用生活', hint: '关掉后她不会自己走动/说话' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '空闲心跳', hint: '5–180 分钟' }, h(NumInput, { value: d.heartbeatMin, min: 5, max: 180, step: 5, onChange: (v) => f.patch({ heartbeatMin: v }), suffix: '分钟' })),
      h(Field, { label: '主动找你', hint: '0–10，越大越主动' }, h(Slider, { value: d.proactive, min: 0, max: 10, step: 1, onChange: (v) => f.patch({ proactive: v }) })),
      h(Field, { label: '智能安排', hint: '按天气/精力/记忆自动微调作息和活动' }, h(Toggle, { checked: !!d.smartLife, onChange: (v) => f.patch({ smartLife: v }), label: d.smartLife ? '开' : '关' })),

      h('div', { style: { gridColumn: '1 / -1', height: 0, borderTop: '1px solid ' + T.border, margin: '2px 0' } }),
      h(Field, { label: '主动消息', hint: '只在非安静时段、你没在聊的时候发；一句话' }, h(Toggle, { checked: !!d.proactiveEnabled, onChange: (v) => f.patch({ proactiveEnabled: v }), label: d.proactiveEnabled ? '开' : '关' })),
      h(Field, { label: '间隔（最小）', hint: '5–1440 分钟' }, h(NumInput, { value: d.proactiveMinMin, min: 5, max: 1440, step: 5, onChange: (v) => f.patch({ proactiveMinMin: v }), suffix: '分钟' })),
      h(Field, { label: '间隔（最大）' }, h(NumInput, { value: d.proactiveMaxMin, min: 5, max: 1440, step: 5, onChange: (v) => f.patch({ proactiveMaxMin: v }), suffix: '分钟' })),
      h(Field, { label: '试一条', hint: '真的会发到聊天里' },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: testing, onClick: () => { sendProactive().catch(() => {}) } }, testing ? '生成中…' : '让她主动发一条')),

      h('div', { style: { gridColumn: '1 / -1', height: 0, borderTop: '1px solid ' + T.border, margin: '2px 0' } }),
      h(Field, { label: '安静开始', hint: '0–23 时' }, h(NumInput, { value: d.quietStart, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietStart: v }), suffix: '时' })),
      h(Field, { label: '安静结束', hint: '这个时段她不主动打扰你' }, h(NumInput, { value: d.quietEnd, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietEnd: v }), suffix: '时' })),
      h(Field, { label: '写日记时间', hint: '0–23 时' }, h(NumInput, { value: d.diaryHour, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ diaryHour: v }), suffix: '时' })),
      h(Field, { label: '自动写日记' }, h(Toggle, { checked: !!d.diaryAuto, onChange: (v) => f.patch({ diaryAuto: v }), label: d.diaryAuto ? '开' : '关' })),
      h(Field, { label: '现在写今天的日记' },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: diaryBusy, onClick: () => { writeDiary().catch(() => {}) } }, diaryBusy ? '写日记中…' : '现在写一篇')),
      h(Note, { style: { gridColumn: '1 / -1' } }, '安静时段的含义：这期间她不主动找你（主动消息、看屏幕这类动作不会触发），但你找她她照常回。'),
    ) : (api.error ? null : h(Loading, { text: '读取生活设置…' })),
    h(Modal, {
      open: diaryOpen,
      title: '今天的日记',
      onClose: () => setDiaryOpen(false),
      footer: h(Btn, { size: 'sm', kind: 'primary', onClick: () => setDiaryOpen(false) }, '知道了'),
    },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        diaryErr ? h(ErrorBox, { error: diaryErr }) : null,
        diaryBusy ? h(Loading, { text: '她在写日记…' }) : null,
        diaryText
          ? h('div', {
              className: 'sbc-scroll',
              style: { maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, color: T.text, lineHeight: 1.85, border: '1px solid ' + T.border, borderRadius: T.radius, padding: '10px 12px', background: T.bg2 },
            }, diaryText)
          : null,
      ),
    ),
  )
}

// ───────────────────────── 生活：生活模拟（事件/照片） ─────────────────────────

function SettingsLifeSimCard() {
  const api = useApi('/api/life/settings')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(api, (d) => {
    const s = (d && d.settings) || {}
    return {
      enabled: s.enabled !== false,
      minEventGapMin: stgCoreInt(s.minEventGapMin, 5, 720, 90),
      maxDaily: stgCoreInt(s.maxDaily, 0, 100, 8),
      quietStart: stgCoreInt(s.quietStart, 0, 23, 23),
      quietEnd: stgCoreInt(s.quietEnd, 0, 23, 8),
      photoChance: stgCoreNum(s.photoChance, 0, 1, 0.25),
    }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      minEventGapMin: stgCoreInt(d.minEventGapMin, 5, 720, 90),
      maxDaily: stgCoreInt(d.maxDaily, 0, 100, 8),
      quietStart: stgCoreInt(d.quietStart, 0, 23, 23),
      quietEnd: stgCoreInt(d.quietEnd, 0, 23, 8),
      photoChance: stgCoreNum(d.photoChance, 0, 1, 0.25),
    }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/life/settings', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('生活模拟已保存')
    f.patch(next)
    api.reload()
  })
  const photoPct = d ? Math.round(stgCoreNum(d.photoChance, 0, 1, 0.25) * 100) : 0
  return h(Card, {
    title: '生活模拟', sub: '她自己过日子时多久发生一次事件', tag: '含自拍/拍照概率',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 } },
      h(Field, { label: '启用生活模拟' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '两次事件最短间隔', hint: '5–720 分钟' }, h(NumInput, { value: d.minEventGapMin, min: 5, max: 720, step: 5, onChange: (v) => f.patch({ minEventGapMin: v }), suffix: '分钟' })),
      h(Field, { label: '每天最多事件', hint: '0–100 次' }, h(NumInput, { value: d.maxDaily, min: 0, max: 100, step: 1, onChange: (v) => f.patch({ maxDaily: v }), suffix: '次' })),
      h(Field, { label: '事件安静开始', hint: '生活事件不会落在这个时段' }, h(NumInput, { value: d.quietStart, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietStart: v }), suffix: '时' })),
      h(Field, { label: '事件安静结束' }, h(NumInput, { value: d.quietEnd, min: 0, max: 23, step: 1, onChange: (v) => f.patch({ quietEnd: v }), suffix: '时' })),
      h(Field, { label: '拍照概率', hint: '事件里带照片的概率：' + photoPct + '%' },
        h(Slider, { value: stgCoreNum(d.photoChance, 0, 1, 0.25), min: 0, max: 1, step: 0.05, onChange: (v) => f.patch({ photoChance: v }) })),
      h(Note, { style: { gridColumn: '1 / -1' } }, '这个「安静时段」管的是生活事件（不会在睡觉时段突然发照片），和上一张卡片的「不主动打扰你」不是同一个开关。'),
    ) : (api.error ? null : h(Loading, { text: '读取生活模拟设置…' })),
  )
}

// ───────────────────────── 生活：场景活动（拍照） ─────────────────────────

function SettingsSceneCard() {
  const api = useApi('/api/scene/settings')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(api, (d) => {
    const s = (d || {})
    return { ai: s.ai !== false, photoChance: stgCoreNum(s.photoChance, 0, 1, 0.25) }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = { ai: !!d.ai, photoChance: stgCoreNum(d.photoChance, 0, 1, 0.25) }
    const payload = stgCoreDiff(f.base, next, ['ai', 'photoChance'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/scene/settings', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('场景活动设置已保存')
    f.patch(next)
    api.reload()
  })
  const photoPct = d ? Math.round(stgCoreNum(d.photoChance, 0, 1, 0.25) * 100) : 0
  return h(Card, {
    title: '场景活动', sub: '她在地点里做什么 / 要不要拍照给你看',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: 'AI 生成活动描述', hint: '关掉更省 token，但活动会更模板化' }, h(Toggle, { checked: !!d.ai, onChange: (v) => f.patch({ ai: v }), label: d.ai ? '开' : '关' })),
      h(Field, { label: '拍照概率', hint: '当前约 ' + photoPct + '%' },
        h(Slider, { value: stgCoreNum(d.photoChance, 0, 1, 0.25), min: 0, max: 1, step: 0.05, onChange: (v) => f.patch({ photoChance: v }) })),
      api.data ? h(Note, {}, '照片最短间隔 ' + (api.data.minGapMinutes || 5) + ' 分钟，同一场景缓存 ' + (api.data.cacheMinutes || 10) + ' 分钟。') : null,
    ) : (api.error ? null : h(Loading, { text: '读取场景设置…' })),
  )
}

// ───────────────────────── 生活：天气表现 ─────────────────────────

function SettingsWeatherFxRow(props) {
  const p = props || {}
  const [busy, setBusy] = React.useState(false)
  const fileRef = React.useRef(null)
  const cfg = p.cfg || null
  const upload = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const rd = await Api.readFileAsDataUrl(file, 20 * 1024 * 1024)
      if (!rd.ok) { toast(rd.error || '读取文件失败', 'error'); return }
      const r = await Api.upload('/api/weatherfx/upload', { kind: String(p.kind), dataUrl: rd.dataUrl })
      if (!r.ok) { toast('上传失败：' + (r.error || '未知错误'), 'error'); return }
      toast('「' + (p.label || p.kind) + '」的天气表现已更新')
      if (p.onChanged) p.onChanged()
    } finally {
      setBusy(false)
    }
  }
  const clear = async () => {
    const ok = await confirmDialog('把「' + (p.label || p.kind) + '」恢复成内置粒子效果？', {
      detail: '上传的图片/GIF/视频配置会被删掉。',
      danger: true,
      okText: '恢复内置',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await Api.post('/api/weatherfx', { kind: String(p.kind), clear: true })
      if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
      toast('已恢复内置效果')
      if (p.onChanged) p.onChanged()
    } finally {
      setBusy(false)
    }
  }
  return h(Row, { gap: 6, style: { padding: '3px 0' } },
    h('span', { style: { fontSize: 12.5, color: T.text, flex: '0 0 84px' } }, (p.icon ? p.icon + ' ' : '') + (p.label || p.kind)),
    h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: cfg ? T.ok : T.text3 } },
      cfg ? ('自定义' + (cfg.type === 'video' ? '（视频）' : '（图片）')) : '内置效果'),
    h(Btn, { size: 'sm', kind: 'ghost', disabled: busy, onClick: () => { if (fileRef.current) fileRef.current.click() } }, busy ? '处理中…' : '上传'),
    cfg ? h(Btn, { size: 'sm', kind: 'ghost', disabled: busy, onClick: () => { clear().catch(() => {}) } }, '恢复内置') : null,
    h('input', { ref: fileRef, type: 'file', accept: 'image/*,video/mp4,video/webm', style: { display: 'none' }, onChange: upload }),
  )
}

function SettingsWeatherCard() {
  const wx = useApi('/api/weather')
  const fx = useApi('/api/weatherfx')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(wx, (d) => {
    const s = d || {}
    return {
      mode: s.mode === 'real' ? 'real' : 'manual',
      manual: String(s.manual || 'sunny'),
    }
  })
  const d = f.draft
  const weathers = (wx.data && wx.data.weathers) || {}
  const kinds = (fx.data && fx.data.kinds) || Object.keys(weathers)
  const fxMap = (fx.data && fx.data.fx) || {}
  const manualOptions = Object.keys(weathers).map((k) => ({ value: k, label: (weathers[k].icon || '') + ' ' + (weathers[k].label || k) }))
  const save = () => run(async () => {
    if (!d || !f.base) return
    const payload = stgCoreDiff(f.base, { mode: d.mode, manual: d.manual }, ['mode', 'manual'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/weather', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('天气设置已保存')
    f.patch(d)
    wx.reload()
  })
  const cur = wx.data || null
  return h(Card, {
    title: '天气', sub: '手动选，或按真实天气', tag: '改完点保存',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!wx.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(wx.error, wx.reload),
    cur ? h(Row, { gap: 8, wrap: true, style: { padding: '4px 0' } },
      h(Badge, { tone: 'ok', title: '当前天气' }, (cur.icon || '') + ' ' + (cur.label || cur.kind || '—')),
      cur.source === 'real' ? h(Badge, { title: '按真实天气' }, '真实' + (cur.city ? ' · ' + cur.city : '') + (cur.temp !== null && cur.temp !== undefined ? ' · ' + cur.temp + '°C' : '')) : h(Badge, {}, '手动'),
    ) : (wx.error ? null : h(Loading, { text: '读取天气…' })),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: '天气来源', hint: '真实天气需要联网抓取，可能慢一两秒' },
        h(Select, { value: d.mode, onChange: (v) => f.patch({ mode: v }), options: [{ value: 'manual', label: '手动指定（推荐）' }, { value: 'real', label: '按真实天气' }] })),
      d.mode === 'manual'
        ? h(Field, { label: '现在是什么天气' }, h(Select, { value: d.manual, onChange: (v) => f.patch({ manual: v }), options: manualOptions }))
        : h(Note, {}, '按真实天气时，上面的「现在是什么天气」会自动跟着变。'),
    ) : null,
    h('div', { style: { borderTop: '1px solid ' + T.border, paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 2 } },
      h(Row, { gap: 8, style: { marginBottom: 2 } },
        h('span', { style: { fontSize: 12.5, color: T.text, fontWeight: 600 } }, '天气表现'),
        h('span', { style: { fontSize: 11, color: T.text3 } }, '可上传图片 / GIF / 视频（≤20MB）；不传就用内置粒子'),
        h('span', { style: { flex: 1 } }),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!fx.error, onClick: fx.reload }, '刷新'),
      ),
      stgCoreErrBox(fx.error, fx.reload),
      kinds.length
        ? kinds.map((k) => h(SettingsWeatherFxRow, {
            key: 'fx-' + k,
            kind: k,
            label: (weathers[k] && weathers[k].label) || k,
            icon: (weathers[k] && weathers[k].icon) || '',
            cfg: fxMap[k] || null,
            onChanged: fx.reload,
          }))
        : (fx.error ? null : h(Note, {}, '正在读取天气表现…')),
    ),
  )
}

// ───────────────────────── 生活标签：把卡片拼起来 ─────────────────────────

function SettingsLifeTab() {
  const petOk = typeof PetCard === 'function'
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(SettingsLifeNowCard, {}),
      h(SettingsLifeHeartbeatCard, {}),
    ),
    h(SettingsLifeScheduleCard, {}),
    h(SettingsLifeActivityCard, {}),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(SettingsLifeSimCard, {}),
      h(SettingsSceneCard, {}),
    ),
    h(SettingsWeatherCard, {}),
    h(SettingsEconomyCard, {}),
    h(SettingsBalanceAlertCard, {}),
    petOk ? h(PetCard, {}) : h(Card, { title: '桌宠', sub: '把她放到桌面上' }, h(Note, {}, '桌宠卡片加载中…')),
  )
}

// ───────────────────────── 环境：权限 / 自检 / 自动看屏幕 ─────────────────────────

const STG_ENV_TARGETS = [
  { key: 'pc', icon: '🖥️', name: '你的电脑', desc: 'Windows 桌面：她可以截图看屏幕、用鼠标键盘点东西。' },
  { key: 'space', icon: '💻', name: '她自己的屏幕', desc: 'Linux 虚拟机：她自己的桌面，随便折腾。' },
  { key: 'phone', icon: '📱', name: '她自己的手机', desc: 'Android 模拟器：截图、点击、滑动、输入。' },
]
const STG_ENV_LEVELS = [
  { value: 'off', label: '关闭' },
  { value: 'gui', label: '仅鼠标键盘' },
  { value: 'code', label: '代码控制（危险）' },
]
const STG_ENV_LEVEL_LABEL = { off: '关闭', gui: '仅鼠标键盘', code: '代码控制' }

function SettingsEnvTab() {
  const env = useApi('/api/env')
  const watch = useApi('/api/watch-screen')
  const [busy, run] = stgCoreBusy()
  const [watchBusy, setWatchBusy] = React.useState(false)
  const [checkBusy, setCheckBusy] = React.useState(false)
  const [checkData, setCheckData] = React.useState(null)
  const [checkError, setCheckError] = React.useState('')
  const f = stgCoreDraft(env, (d) => {
    const e = (d && d.env) || {}
    return {
      pc: ['off', 'gui', 'code'].includes(e.pc) ? e.pc : 'gui',
      space: ['off', 'gui', 'code'].includes(e.space) ? e.space : 'gui',
      phone: ['off', 'gui', 'code'].includes(e.phone) ? e.phone : 'gui',
      confirmDanger: e.confirmDanger !== false,
      selfStart: e.selfStart === 'allow' ? 'allow' : 'deny',
    }
  })
  const d = f.draft
  const resources = (env.data && env.data.resources) || null
  const watchCfg = (watch.data && watch.data.watch) || null

  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      pc: d.pc, space: d.space, phone: d.phone,
      confirmDanger: !!d.confirmDanger,
      selfStart: d.selfStart === 'allow' ? 'allow' : 'deny',
    }
    const payload = stgCoreDiff(f.base, next, Object.keys(next))
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    // 危险变更二次确认（关掉权限 / 开代码控制都很敏感）
    const lines = []
    for (const t of STG_ENV_TARGETS) {
      if (payload[t.key] !== undefined && payload[t.key] !== f.base[t.key]) lines.push(t.name + '：' + STG_ENV_LEVEL_LABEL[f.base[t.key]] + ' → ' + STG_ENV_LEVEL_LABEL[payload[t.key]])
    }
    if (payload.selfStart !== undefined) lines.push('她自己开机：' + (payload.selfStart === 'allow' ? '允许' : '不允许'))
    const risky = (payload.pc === 'code' || payload.space === 'code' || payload.phone === 'code') || lines.length > 0
    if (risky && lines.length) {
      const ok = await confirmDialog('保存这些权限修改？', {
        title: '修改权限',
        detail: lines.join('\n') + '\n\n「关闭」她不能再用这个环境；「代码控制」可以直接执行命令、读写文件，只在你信任时开。',
        danger: payload.pc === 'code' || payload.space === 'code' || payload.phone === 'code',
        okText: '保存',
      })
      if (!ok) return
    }
    const r = await Api.post('/api/env', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('权限已保存，立即生效')
    f.patch(next)
    env.reload()
  })

  const toggleWatch = async () => {
    if (!watchCfg) return
    const next = !watchCfg.enabled
    if (next) {
      const ok = await confirmDialog('开启「她自己看你的屏幕」？', {
        title: '自动看屏幕',
        detail: '开启后她在你授权「用户的电脑」的前提下，每隔 20–40 分钟自己瞥一眼你在做什么；看到值得说的才提一句。会消耗少量 token。',
        okText: '开启',
      })
      if (!ok) return
    }
    setWatchBusy(true)
    try {
      const r = await Api.post('/api/watch-screen', { enabled: next })
      if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
      toast(next ? '已开启：她会偶尔看看你的屏幕' : '已关闭自动看屏幕')
      watch.reload()
    } finally {
      setWatchBusy(false)
    }
  }

  const runCheck = async () => {
    setCheckBusy(true)
    setCheckError('')
    try {
      const r = await Api.get('/api/env/check')
      if (!r.ok) { setCheckData(null); setCheckError(r.error || '自检失败'); return }
      setCheckData(r.data)
    } finally {
      setCheckBusy(false)
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    // 权限
    h(Card, {
      title: '她能操作哪些环境', sub: '按目标分开授权，权限分两级', tag: '保存后立即生效',
      actions: stgCoreSaveBtn({ disabled: !d || busy || !!env.error, busy: busy, onClick: save }),
    },
      stgCoreErrBox(env.error, env.reload),
      h(Note, {}, '「仅鼠标键盘」= 像人一样看屏幕、点鼠标、打字，安全；「代码控制」= 直接执行命令、读写文件，强大但危险，只在你信任时开。'),
      d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        STG_ENV_TARGETS.map((t) => h('div', {
          key: t.key,
          style: { border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 },
        },
          h(Row, { gap: 6, wrap: true },
            h('span', { style: { fontSize: 13, color: T.text, fontWeight: 600 } }, t.icon + ' ' + t.name),
            h('span', { style: { fontSize: 11, color: T.text3 } }, '当前：' + (STG_ENV_LEVEL_LABEL[d[t.key]] || '仅鼠标键盘')),
            h('span', { style: { flex: 1 } }),
            h(Row, { gap: 6 },
              STG_ENV_LEVELS.map((lv) => h(Chip, {
                key: lv.value,
                active: d[t.key] === lv.value,
                tone: lv.value === 'code' ? 'warn' : lv.value === 'off' ? 'danger' : undefined,
                onClick: () => f.patch({ [t.key]: lv.value }),
              }, lv.label)),
            ),
          ),
          h(Note, {}, t.desc),
        )),
        h(Row, { gap: 10, wrap: true, style: { borderTop: '1px solid ' + T.border, paddingTop: 8 } },
          h(Field, { label: '危险操作确认', inline: true, hint: '删除/关机/转账这类动作她先问你' },
            h(Toggle, { checked: !!d.confirmDanger, onChange: (v) => f.patch({ confirmDanger: v }), label: d.confirmDanger ? '开' : '关' })),
        ),
        h(Field, { label: '她自己能开机吗', hint: '允许后她可以自己启动屏幕/手机（会占 2~6GB 内存）' },
          h(Row, { gap: 6 },
            h(Chip, { active: d.selfStart === 'deny', onClick: () => f.patch({ selfStart: 'deny' }) }, '不允许（推荐）'),
            h(Chip, { active: d.selfStart === 'allow', tone: 'warn', onClick: () => f.patch({ selfStart: 'allow' }) }, '允许她自己开'),
          ),
        ),
      ) : (env.error ? null : h(Loading, { text: '读取权限设置…' })),
    ),

    // 环境自检
    h(Card, {
      title: '环境自检', sub: '环境不生效先点这里', tag: '要几秒',
      actions: h(Btn, { size: 'sm', kind: 'primary', disabled: checkBusy, onClick: () => { runCheck().catch(() => {}) } }, checkBusy ? '检查中…' : '开始自检'),
    },
      checkError ? h(ErrorBox, { error: checkError, onRetry: () => { runCheck().catch(() => {}) } }) : null,
      checkData
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            (checkData.checks || []).map((c) => h(Row, { key: String(c.id || c.label), gap: 6, align: 'flex-start' },
              h(Dot, { on: !!c.ok, tone: c.ok ? T.ok : T.danger, style: { marginTop: 6 } }),
              h('div', { style: { flex: 1, minWidth: 0 } },
                h('div', { style: { fontSize: 12.5, color: T.text } }, String(c.label || c.id || '')),
                h('div', { style: { fontSize: 11, color: T.text3, wordBreak: 'break-all' } }, String(c.detail || '')),
              ),
            )),
            (checkData.hints || []).length
              ? h('div', { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 } },
                  h('div', { style: { fontSize: 12, color: T.warn } }, '建议：'),
                  (checkData.hints || []).map((hint, i) => h(Note, { key: 'hint' + i }, '· ' + String(hint))),
                )
              : h(Note, {}, '没有发现明显问题。'),
            checkData.paths && checkData.paths.version ? h(Note, {}, '运行时版本 ' + checkData.paths.version + ' · 数据目录 ' + (checkData.paths.dataRoot || '—')) : null,
          )
        : h(Note, {}, '还没检查。点右上角「开始自检」看看缺什么（只读检查，不会改任何东西）。'),
    ),

    // 自动看屏幕 + 资源
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 12, minWidth: 0 } },
      h(Card, { title: '她自己看你的屏幕', sub: '默认关闭', tag: '需要「你的电脑」权限' },
        stgCoreErrBox(watch.error, watch.reload),
        watchCfg ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          h(Row, { gap: 8, wrap: true },
            h(Dot, { on: !!watchCfg.enabled, tone: watchCfg.enabled ? T.ok : T.idle }),
            h('span', { style: { fontSize: 12.5, color: T.text } }, watchCfg.enabled ? '已开启 · 约每 ' + (watchCfg.minMinutes || 20) + '–' + (watchCfg.maxMinutes || 40) + ' 分钟看一次' : '已关闭'),
            h('span', { style: { flex: 1 } }),
            h(Btn, { size: 'sm', kind: watchCfg.enabled ? 'ghost' : 'primary', disabled: watchBusy, onClick: () => { toggleWatch().catch(() => {}) } }, watchBusy ? '保存中…' : (watchCfg.enabled ? '关闭' : '开启')),
          ),
          h(Note, {}, '看到值得说的才自然提一句，没事就不打扰；不需要虚拟机/模拟器。'),
        ) : (watch.error ? null : h(Loading, { text: '读取看屏幕设置…' })),
      ),
      h(Card, { title: '环境占用', sub: '屏幕/手机是否在跑' },
        stgCoreErrBox(env.error, env.reload),
        resources
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
              h(Row, { gap: 6 }, h(Dot, { on: !!resources.space }), h('span', { style: { fontSize: 12.5, color: T.text } }, '她的屏幕：' + (resources.space ? '运行中' : '已关闭'))),
              h(Row, { gap: 6 }, h(Dot, { on: !!resources.phone }), h('span', { style: { fontSize: 12.5, color: T.text } }, '她的手机：' + (resources.phone ? '运行中' : '已关闭'))),
              (resources.mem || []).length ? h(Note, {}, '当前占用：' + (resources.mem || []).join(' · ')) : null,
              h(Note, {}, '启动 / 关闭屏幕和手机在「屏幕」标签里；屏幕虚拟机约占 2~6GB 内存，不用时建议关掉。'),
            )
          : (env.error ? null : h(Loading, { text: '读取资源状态…' })),
      ),
    ),

    h(Card, { title: '说明' },
      h(Note, {}, '· 代码控制是按目标分别开的：可以只给她的屏幕开，不给你的电脑开。'),
      h(Note, {}, '· 开了代码控制后，她的工具里会多一个 code 工具；关掉后立即消失。'),
      h(Note, {}, '· 人设里也会告诉她当前权限，她不会越权。'),
      h(Note, {}, '· 这里不启动/关闭虚拟机；看屏幕和手机开关请用「屏幕」标签。'),
    ),
  )
}
