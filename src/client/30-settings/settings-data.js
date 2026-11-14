// 30-settings/settings-data.js —— 设置·数据卡片
//
// 内容：记忆统计/列表（置顶/删除/文本导入/遗忘参数）、日记（生成/查看/给她看）、
//       备份列表 + 一键备份 + 恢复（二次确认）、数据目录/版本/数据修订信息、使用说明
// 契约：function SettingsDataTab()（外壳不传 props，需要什么自己取接口；N02 不写死角色信息）
// 可靠性：读取失败时禁用写操作（读失败禁存）；危险操作（删除记忆/恢复备份）必须 confirmDialog；
//         恢复备份会覆盖数据 → 二次确认；所有 POST 只发改动字段；值前端 clamp（后端同样会 clamp）

// 只把「和已保存值不同」的字段挑出来，POST 时不去覆盖没动的字段
function settingsDataChanged(cur, next, keys) {
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

// 统计小方块
function settingsDataStatBox(label, value, tone) {
  return h('div', {
    style: {
      border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2,
      padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
    },
  },
    h('div', { style: { fontSize: 19, fontWeight: 600, color: tone || T.text, lineHeight: 1.2 } }, String(value === undefined || value === null ? 0 : value)),
    h('div', { style: { fontSize: 10.5, color: T.text3 } }, label),
  )
}

// 单条记忆
function settingsDataFactRow(f, handlers) {
  const pct = Math.round(clampNum(f.strength, 0, 1, 0) * 100)
  const pinned = !!f.pinned
  const disabled = !!handlers.disabled
  const tags = Array.isArray(f.tags) ? f.tags : []
  return h('div', {
    key: String(f.id),
    style: {
      border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2,
      padding: '7px 9px', display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0,
    },
  },
    h(Row, { gap: 6, align: 'flex-start', wrap: false },
      h('span', { style: { flex: 1, minWidth: 0, fontSize: 12.5, color: T.text, lineHeight: 1.6, wordBreak: 'break-word' } }, String(f.text || '')),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: disabled, onClick: () => handlers.onPin(f), title: pinned ? '取消置顶后按清晰度衰减' : '置顶后永远记得' }, pinned ? '取消置顶' : '置顶'),
      h(Btn, { size: 'sm', kind: 'danger', disabled: disabled, onClick: () => handlers.onDelete(f) }, '删除'),
    ),
    h(Row, { gap: 6, style: { fontSize: 10.5, color: T.text3, minWidth: 0 } },
      pinned ? h(Badge, { tone: 'warn' }, '置顶') : null,
      h('span', null, '清晰度 ' + pct + '%'),
      h('span', { style: { flex: '0 1 110px', minWidth: 40, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
        h('span', { style: { display: 'block', width: pct + '%', height: '100%', background: pinned ? T.warn : T.brand, borderRadius: 3 } }),
      ),
      h('span', null, '提到 ' + (Number(f.hitCount) || 1) + ' 次'),
      tags.length ? h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, '· ' + tags.slice(0, 4).join(' / ')) : null,
    ),
  )
}

// 教程是纯文本 markdown（/api/tutorial），这里只做很轻的排版
function settingsDataTutorialBlocks(text) {
  const lines = String(text || '').split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()
    const key = 'tut-' + i
    const strip = (s) => s.replace(/\*\*([^*]+)\*\*/g, '$1')
    if (line.indexOf('### ') === 0) blocks.push(h('div', { key, style: { fontSize: 13, fontWeight: 600, color: T.text, margin: '12px 0 3px' } }, strip(line.slice(4))))
    else if (line.indexOf('## ') === 0) blocks.push(h('div', { key, style: { fontSize: 14.5, fontWeight: 600, color: T.text, margin: '16px 0 5px' } }, strip(line.slice(3))))
    else if (line.indexOf('# ') === 0) blocks.push(h('div', { key, style: { fontSize: 16, fontWeight: 600, color: T.text, margin: '18px 0 8px' } }, strip(line.slice(2))))
    else if (line.indexOf('> ') === 0) blocks.push(h('div', { key, style: { fontSize: 12, color: T.text2, lineHeight: 1.7, padding: '3px 10px', borderLeft: '2px solid ' + T.border2, margin: '5px 0' } }, strip(line.slice(2))))
    else if (line.indexOf('- ') === 0) blocks.push(h('div', { key, style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7, paddingLeft: 14 } }, '· ' + strip(line.slice(2))))
    else if (!line) blocks.push(h('div', { key, style: { height: 6 } }))
    else blocks.push(h('div', { key, style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7 } }, strip(raw)))
  }
  return blocks
}

function SettingsDataTab() {
  const status = useStatus()
  const st = (status && status.data) || {}
  const setup = st.setup || {}

  const memApi = useApi('/api/memory')
  const diaryApi = useApi('/api/diary')
  const backupApi = useApi('/api/backup/list')

  const [verInfo, setVerInfo] = React.useState(null)
  const [revInfo, setRevInfo] = React.useState(null)
  const [revError, setRevError] = React.useState('')

  const [memParams, setMemParams] = React.useState({ halfLifeDays: 5, forgetThreshold: 0.12, reinforceBoost: 0.22, maxInjected: 8 })
  const [showArchived, setShowArchived] = React.useState(false)
  const [factLimit, setFactLimit] = React.useState(30)
  const [importText, setImportText] = React.useState('')
  const [importImportance, setImportImportance] = React.useState(0.5)
  const [importPin, setImportPin] = React.useState(false)

  const [diaryModal, setDiaryModal] = React.useState({ open: false, title: '', text: '', loading: false, error: '' })
  const [tutModal, setTutModal] = React.useState({ open: false, loading: false, text: '', error: '' })

  const [busy, setBusy] = React.useState('')

  // ── 同步记忆参数草稿 ────────────────────────────────────────────────
  const memData = memApi.data
  React.useEffect(() => {
    const p = memData && memData.params
    if (!p) return
    setMemParams({
      halfLifeDays: clampNum(p.halfLifeDays, 0.5, 365, 5),
      forgetThreshold: clampNum(p.forgetThreshold, 0.01, 0.9, 0.12),
      reinforceBoost: clampNum(p.reinforceBoost, 0, 1, 0.22),
      maxInjected: Math.round(clampNum(p.maxInjected, 0, 100, 8)),
    })
  }, [memData])

  // ── 版本 / 数据修订（/api/version 是冻结契约，老运行时可能 404 → 静默降级）──
  const loadMeta = React.useCallback(() => {
    Api.get('/api/version').then((r) => { setVerInfo(r.ok && r.data ? r.data : null) }).catch(() => setVerInfo(null))
    Api.get('/api/data/revisions').then((r) => {
      if (r.ok && r.data) { setRevInfo(r.data); setRevError('') } else { setRevInfo(null); setRevError(r.error || '读取失败') }
    }).catch((e) => { setRevInfo(null); setRevError((e && e.message) || '读取失败') })
  }, [])
  React.useEffect(() => { loadMeta() }, [loadMeta])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => {
    memApi.reload()
    diaryApi.reload()
    backupApi.reload()
    loadMeta()
  }

  // ── 记忆 ────────────────────────────────────────────────────────────
  const facts = (memApi.data && memApi.data.facts) || []
  const archived = (memApi.data && memApi.data.archived) || []
  const stats = (memApi.data && memApi.data.stats) || {}
  const params = (memApi.data && memApi.data.params) || {}
  const coreStrength = Number(params.coreStrength) || 0.85
  const coreFacts = facts.filter((f) => f.pinned || Number(f.strength) >= coreStrength)
  const normalFacts = facts.filter((f) => !(f.pinned || Number(f.strength) >= coreStrength))
  const memRev = () => {
    const rev = memApi.data && memApi.data.rev
    return rev && rev.rev !== undefined ? rev.rev : undefined
  }

  const togglePin = (f) => run('pin', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「刷新」再操作', 'error'); return }
    const r = await Api.post('/api/memory/pin', { id: f.id, expectedRev: memRev() })
    if (!r.ok) { toast(r.error || '操作失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast(f.pinned ? '已取消置顶' : '已置顶')
    memApi.reload()
  })

  const deleteFact = (f) => run('deleteFact', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「刷新」再操作', 'error'); return }
    const ok = await confirmDialog('删掉这条记忆？', { title: '删除记忆', detail: String(f.text || ''), danger: true, okText: '删除' })
    if (!ok) return
    const r = await Api.post('/api/memory/delete', { id: f.id, expectedRev: memRev() })
    if (!r.ok) { toast(r.error || '删除失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast('已删除这条记忆')
    memApi.reload()
  })

  const factHandlers = { disabled: !!busy || !!memApi.error, onPin: togglePin, onDelete: deleteFact }

  const saveMemParams = () => run('memParams', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「刷新」再保存', 'error'); return }
    const next = {
      halfLifeDays: Math.round(clampNum(memParams.halfLifeDays, 0.5, 365, 5) * 10) / 10,
      forgetThreshold: Math.round(clampNum(memParams.forgetThreshold, 0.01, 0.9, 0.12) * 100) / 100,
      reinforceBoost: Math.round(clampNum(memParams.reinforceBoost, 0, 1, 0.22) * 100) / 100,
      maxInjected: Math.round(clampNum(memParams.maxInjected, 0, 100, 8)),
    }
    setMemParams(next)
    const body = settingsDataChanged(params, next, ['halfLifeDays', 'forgetThreshold', 'reinforceBoost', 'maxInjected'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/memory/params', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('遗忘参数已保存')
    memApi.reload()
  })

  const importMemory = () => run('import', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「刷新」再导入', 'error'); return }
    const text = String(importText || '').trim()
    if (!text) { toast('先粘贴要导入的记忆文本', 'error'); return }
    const ok = await confirmDialog('导入这些记忆？', {
      title: '导入记忆',
      detail: '会按行/句子拆分、去重并合并到现有记忆（单次最多 500 条）。',
      okText: '导入',
    })
    if (!ok) return
    const r = await Api.post('/api/memory/import', {
      text,
      importance: clampNum(importImportance, 0, 1, 0.5),
      pinNew: !!importPin,
      expectedRev: memRev(),
    })
    if (!r.ok) { toast(r.error || '导入失败', 'error'); if (r.status === 409) memApi.reload(); return }
    const d = r.data || {}
    toast('导入完成：解析 ' + (Number(d.total) || 0) + ' 条，新增 ' + (Number(d.added) || 0) + '，合并 ' + (Number(d.merged) || 0))
    setImportText('')
    memApi.reload()
  })

  // ── 日记 ────────────────────────────────────────────────────────────
  const diaryDates = (diaryApi.data && diaryApi.data.dates) || []

  const openDiary = async (date) => {
    setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: true, error: '' })
    try {
      const r = await Api.get('/api/diary?date=' + encodeURIComponent(date))
      if (!r.ok) { setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: false, error: r.error || '读取失败' }); return }
      const text = String((r.data && r.data.text) || '')
      setDiaryModal({ open: true, title: '日记 · ' + date, text: text || '（这篇日记是空的）', loading: false, error: '' })
    } catch (e) {
      setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: false, error: (e && e.message) || '读取失败' })
    }
  }

  const generateDiary = () => run('diaryGen', async () => {
    if (diaryApi.error) { toast('日记列表读取失败，先点「刷新」再生成', 'error'); return }
    const ok = await confirmDialog('现在生成今天的日记？', {
      title: '生成日记',
      detail: '会调用一次模型（消耗少量 token）；今天已经有日记时直接显示已有的。',
      okText: '生成',
    })
    if (!ok) return
    const r = await Api.post('/api/diary/generate', {}, { timeoutMs: 120000 })
    if (!r.ok) { toast('生成失败：' + (r.error || '未知错误'), 'error'); return }
    const text = String((r.data && r.data.text) || '')
    if (!text) { toast('生成失败（模型没有返回内容）', 'error'); return }
    toast('今天的日记已生成')
    setDiaryModal({ open: true, title: '今天的日记', text, loading: false, error: '' })
    diaryApi.reload()
  })

  const showDiaryToHer = () => run('diaryShow', async () => {
    const ok = await confirmDialog('把今天的日记发到聊天里给她看？', { title: '给她看日记', detail: '会在聊天记录里加一条「她把日记给你看了」。', okText: '发给她' })
    if (!ok) return
    const r = await Api.post('/api/diary/show', {})
    if (!r.ok) { toast(r.error || '发送失败', 'error'); return }
    if (r.data && r.data.ok === false) { toast(r.data.error || '今天还没写日记', 'error'); return }
    toast('已把今天的日记给她看')
  })

  // ── 备份 ────────────────────────────────────────────────────────────
  const backups = (backupApi.data && backupApi.data.backups) || []
  const backupDir = (backupApi.data && backupApi.data.dir) || ''

  const doBackup = () => run('backup', async () => {
    const ok = await confirmDialog('现在备份数据目录？', {
      title: '立即备份',
      detail: '会打包成 zip 写到数据目录下的 backups；数据大时可能要几分钟。',
      okText: '开始备份',
    })
    if (!ok) return
    const r = await Api.post('/api/backup', {}, { timeoutMs: 300000 })
    if (!r.ok) { toast('备份失败：' + (r.error || '未知错误'), 'error'); return }
    if (r.data && r.data.ok === false) { toast('备份失败：' + (r.data.error || '未知错误'), 'error'); return }
    toast((r.data && r.data.message) || '备份完成')
    backupApi.reload()
  })

  const restoreBackup = (name) => run('restore', async () => {
    const ok1 = await confirmDialog('恢复备份 ' + name + '？', {
      title: '恢复备份',
      detail: '会覆盖当前的角色、配置、记忆、日记和聊天数据。建议先「立即备份」一次再恢复。',
      danger: true,
      okText: '继续',
    })
    if (!ok1) return
    const ok2 = await confirmDialog('最后确认：真的要恢复这个备份吗？', {
      title: '最后确认',
      detail: '恢复过程中不要关闭 DSH；完成后需要重启 DSH 让运行时重新加载数据。',
      danger: true,
      okText: '恢复',
    })
    if (!ok2) return
    const r = await Api.post('/api/backup/restore', { name }, { timeoutMs: 300000 })
    if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
    if (r.data && r.data.ok === false) {
      toast('恢复失败：' + (r.data.error || '未知错误'), 'error')
      return
    }
    const msg = (r.data && r.data.message) || '恢复完成，请重启 DSH 让运行时重新加载数据'
    toast('恢复完成')
    await alertDialog(msg, { title: '恢复完成' })
    backupApi.reload()
  })

  // ── 目录 / 版本 ─────────────────────────────────────────────────────
  const dataRoot = String(setup.dataRoot || '')
  const dataDir = dataRoot ? dataRoot.replace(/[\\/]+$/, '') + '\\data' : ''
  const copyDataRoot = async () => {
    if (!dataRoot) { toast('还没拿到数据目录', 'error'); return }
    try {
      await navigator.clipboard.writeText(dataRoot)
      toast('数据目录已复制')
    } catch (e) {
      toast(dataRoot)
    }
  }

  // ── 教程 ────────────────────────────────────────────────────────────
  const openTutorial = async () => {
    setTutModal({ open: true, loading: true, text: '', error: '' })
    try {
      const r = await Api.get('/api/tutorial')
      if (!r.ok) { setTutModal({ open: true, loading: false, text: '', error: r.error || '读取失败' }); return }
      setTutModal({ open: true, loading: false, text: String((r.data && r.data.text) || ''), error: '' })
    } catch (e) {
      setTutModal({ open: true, loading: false, text: '', error: (e && e.message) || '读取失败' })
    }
  }

  // ── 渲染 ────────────────────────────────────────────────────────────
  const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, minWidth: 0 }
  const formGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, minWidth: 0 }
  const normals = normalFacts.slice(0, factLimit)
  const hiddenCount = Math.max(0, normalFacts.length - normals.length)
  const revEntityCount = revInfo && revInfo.entities ? Object.keys(revInfo.entities).length : 0
  const revAt = revInfo && revInfo.updatedAt ? Date.parse(revInfo.updatedAt) : 0
  const deviceShort = revInfo && revInfo.deviceId ? String(revInfo.deviceId).slice(0, 8) : ''

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：刷新
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '记忆/日记/备份都直接读写本机运行时数据目录；危险操作都会二次确认。'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy, title: '重新读取记忆 / 日记 / 备份 / 版本' }, '刷新'),
    ),

    // 记忆统计 + 列表
    h(Card, {
      title: '记忆',
      tag: '按半衰期淡忘，提到会加深；置顶=永远记得',
      actions: h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !!memApi.error, onClick: memApi.reload }, '重新读取'),
    },
      h('div', { style: statGrid },
        settingsDataStatBox('活着的记忆', Number(stats.live) || 0),
        settingsDataStatBox('核心（不遗忘）', Number(stats.core) || 0, T.warn),
        settingsDataStatBox('已模糊归档', Number(stats.archived) || 0, T.text2),
        settingsDataStatBox('日记篇数', diaryDates.length),
      ),
      memApi.error ? h(ErrorBox, { title: '记忆读取失败（读失败禁写）', error: memApi.error, onRetry: memApi.reload }) : null,
      memApi.data
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 } },
            h('div', { style: { fontSize: 12, color: T.text2, marginTop: 2 } }, '核心记忆（' + coreFacts.length + '）'),
            coreFacts.length
              ? coreFacts.map((f) => settingsDataFactRow(f, factHandlers))
              : h(Note, {}, '还没有核心记忆。重要的事可以「置顶」，置顶后永远记得。'),
            h('div', { style: { fontSize: 12, color: T.text2, marginTop: 4 } }, '普通记忆（' + normalFacts.length + '）'),
            normalFacts.length
              ? normals.map((f) => settingsDataFactRow(f, factHandlers))
              : h(Note, {}, '暂无普通记忆。'),
            hiddenCount > 0
              ? h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setFactLimit((n) => n + 50) }, '再显示 50 条（还有 ' + hiddenCount + ' 条）')
              : null,
            archived.length
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 } },
                  h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setShowArchived((v) => !v) }, (showArchived ? '收起' : '查看') + '归档（' + archived.length + '）'),
                  showArchived
                    ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflow: 'auto' } },
                        archived.map((f) => h('div', { key: String(f.id), style: { fontSize: 11.5, color: T.text3, lineHeight: 1.6, borderLeft: '2px solid ' + T.border, paddingLeft: 8 } },
                          String(f.text || '') + '（清晰度 ' + Math.round(clampNum(f.strength, 0, 1, 0) * 100) + '%）',
                        )),
                      )
                    : null,
                )
              : null,
          )
        : h(Note, {}, memApi.loading ? '记忆加载中…' : '还没有读到记忆，点「重新读取」再试。'),
    ),

    // 遗忘参数
    h(Card, { title: '遗忘参数', tag: '影响所有普通记忆' },
      h('div', { style: formGrid },
        h(Field, { label: '半衰期（天）', hint: '0.5 – 365；越短忘得越快，核心记忆不受影响' },
          h(NumInput, { value: memParams.halfLifeDays, onChange: (v) => setMemParams((p) => Object.assign({}, p, { halfLifeDays: v })), min: 0.5, max: 365, step: 0.5, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '遗忘阈值', hint: '0.01 – 0.9；清晰度低于它就归档' },
          h(NumInput, { value: memParams.forgetThreshold, onChange: (v) => setMemParams((p) => Object.assign({}, p, { forgetThreshold: v })), min: 0.01, max: 0.9, step: 0.01, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '提到时强化', hint: '0 – 1；对话里再次提到时加多少清晰度' },
          h(NumInput, { value: memParams.reinforceBoost, onChange: (v) => setMemParams((p) => Object.assign({}, p, { reinforceBoost: v })), min: 0, max: 1, step: 0.05, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
        h(Field, { label: '每轮最多注入（条）', hint: '0 – 100；还受「模型 → 上下文档位」里的每轮注入条数限制' },
          h(NumInput, { value: memParams.maxInjected, onChange: (v) => setMemParams((p) => Object.assign({}, p, { maxInjected: v })), min: 0, max: 100, step: 1, width: 100, disabled: !!busy || !!memApi.error, flex: true }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!memApi.error, onClick: saveMemParams }, busy === 'memParams' ? '保存中…' : '保存参数'),
        h(Note, {}, '改完立刻生效，不用重启。'),
      ),
      memApi.error ? h(ErrorBox, { title: '参数读取失败（读失败禁存）', error: memApi.error, onRetry: memApi.reload }) : null,
    ),

    // 导入记忆
    h(Card, { title: '导入记忆', tag: 'txt / md / json / jsonl 纯文本' },
      h(TextArea, {
        value: importText,
        onChange: setImportText,
        rows: 4,
        placeholder: '每行一条；也可以直接粘贴 JSON（会被拆句去重）。例如：\n用户喜欢猫，讨厌狗\n用户最近在写作业',
        disabled: !!busy,
      }),
      h('div', { style: formGrid },
        h(Field, { label: '重要度', hint: '0 – 1；≥0.95 会自动置顶' },
          h(NumInput, { value: importImportance, onChange: setImportImportance, min: 0, max: 1, step: 0.05, width: 100, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '导入后置顶', hint: '新导入的记忆立刻变成核心记忆' },
          h(Toggle, { checked: !!importPin, disabled: !!busy, onChange: setImportPin, label: importPin ? '会置顶' : '不置顶' }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!memApi.error, onClick: importMemory }, busy === 'import' ? '导入中…' : '导入这些记忆'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !String(importText || '').trim(), onClick: () => { setImportText(''); setImportPin(false); setImportImportance(0.5) } }, '清空'),
      ),
      h(Note, {}, '导入会合并相似记忆、去重；不会删除或覆盖已有记忆。'),
    ),

    // 日记
    h(Card, { title: '日记', tag: '她每天写一篇' },
      diaryApi.error
        ? h(ErrorBox, { title: '日记列表读取失败', error: diaryApi.error, onRetry: diaryApi.reload })
        : (diaryDates.length
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
                diaryDates.slice(0, 30).map((d) => h(Btn, { key: String(d), size: 'sm', kind: 'ghost', disabled: !!busy, onClick: () => openDiary(String(d)) }, String(d))),
              )
            : h(Note, {}, diaryApi.loading ? '日记加载中…' : '还没有日记；点「生成今天的日记」试试。')),
      h(Row, { gap: 8, style: { marginTop: 2 } },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!diaryApi.error, onClick: generateDiary }, busy === 'diaryGen' ? '生成中…（可能要十几秒）' : '生成今天的日记'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: showDiaryToHer }, '把今天的日记给她看'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: diaryApi.reload }, '刷新日记'),
      ),
      h(Note, {}, '日记生成会调用一次模型；完整日记只保存在本机数据目录。'),
    ),

    // 备份与恢复
    h(Card, {
      title: '备份与恢复',
      tag: '恢复会覆盖当前数据',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy, onClick: doBackup }, busy === 'backup' ? '备份中…' : '立即备份'),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !!backupApi.error, onClick: backupApi.reload }, '刷新列表'),
      ),
    },
      h(Note, {}, '导出把数据目录打包成 zip；系统每天凌晨 4 点后会自动备份一次。恢复会覆盖角色/配置/记忆/日记/聊天数据，恢复后需要重启 DSH。'),
      backupApi.error ? h(ErrorBox, { title: '备份列表读取失败', error: backupApi.error, onRetry: backupApi.reload }) : null,
      backupApi.loading && !backupApi.data ? h(Loading, { text: '备份列表加载中…' }) : null,
      backupApi.data
        ? (backups.length
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 0, minWidth: 0 } },
                backups.map((b) => h('div', {
                  key: String(b.name),
                  style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid ' + T.border, minWidth: 0 },
                },
                  h('span', { style: { flex: 1, minWidth: 0, fontSize: 12, color: T.text, fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(b.name)),
                  h('span', { style: { fontSize: 11, color: T.text3, whiteSpace: 'nowrap' } }, fmtDateTime(b.at) + ' · ' + fmtBytes(b.size)),
                  h(Btn, { size: 'sm', kind: 'danger', disabled: !!busy, onClick: () => restoreBackup(String(b.name)), title: '恢复这个备份（会覆盖当前数据）' }, busy === 'restore' ? '恢复中…' : '恢复'),
                )),
              )
            : h(Empty, { icon: '🗂️' }, '还没有备份；点「立即备份」生成第一个。'))
        : h(Note, {}, backupApi.loading ? '备份列表加载中…' : '还没读到备份列表，点「刷新列表」再试。'),
      backupDir ? h(Note, {}, '备份目录：' + backupDir) : null,
    ),

    // 数据目录 / 版本
    h(Card, {
      title: '数据目录与版本',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: copyDataRoot, disabled: !dataRoot }, '复制数据目录'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { Api.openExternal('/api/version') } }, '打开版本信息'),
        h(Btn, { size: 'sm', kind: 'ghost', onClick: loadMeta }, '刷新'),
      ),
    },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 8, minWidth: 0 } },
        h(KV, { k: '数据根目录', v: dataRoot || '读取中…', mono: true }),
        h(KV, { k: '数据子目录', v: dataDir || '读取中…', mono: true }),
        h(KV, { k: '运行时版本', v: st.version || '—' }),
        h(KV, { k: '插件版本', v: (typeof CLIENT_BUILD === 'object' && CLIENT_BUILD && CLIENT_BUILD.pluginVersion) ? String(CLIENT_BUILD.pluginVersion) : '—' }),
        h(KV, { k: 'API 契约版本', v: verInfo && verInfo.apiVersion !== undefined ? String(verInfo.apiVersion) : '运行时未提供 /api/version' }),
        h(KV, { k: '备份目录', v: backupDir || '读取中…', mono: true }),
      ),
      h(Divider, {}),
      revError
        ? h(ErrorBox, { title: '数据修订信息读取失败', error: revError, onRetry: loadMeta })
        : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 8, minWidth: 0 } },
            h(KV, { k: '同步格式版本', v: revInfo && revInfo.version !== undefined ? String(revInfo.version) : '—' }),
            h(KV, { k: '设备 ID', v: deviceShort ? deviceShort + '…' : '—', mono: true }),
            h(KV, { k: '数据实体数', v: revInfo ? String(revEntityCount) : '—' }),
            h(KV, { k: '最近更新时间', v: revAt ? fmtDateTime(revAt) : '—' }),
          ),
      h(Note, {}, '版本信息来自运行时 /api/status 与 /api/version（老运行时没有 /api/version 时显示「运行时未提供」，不影响其它功能）。'),
    ),

    // 使用说明
    h(Card, { title: '使用说明', tag: '教程全文' },
      h(Row, { gap: 8 },
        h(Btn, { size: 'sm', kind: 'ghost', onClick: openTutorial }, '查看完整教程'),
        h(Note, {}, '教程内容由运行时 /api/tutorial 提供，不请求任何 HTML 页面。'),
      ),
    ),

    // 日记弹层
    h(Modal, {
      open: !!diaryModal.open,
      title: diaryModal.title || '日记',
      onClose: () => setDiaryModal({ open: false, title: '', text: '', loading: false, error: '' }),
      footer: h(Btn, { kind: 'ghost', onClick: () => setDiaryModal({ open: false, title: '', text: '', loading: false, error: '' }) }, '关闭'),
    },
      diaryModal.loading
        ? h(Loading, { text: '日记读取中…' })
        : (diaryModal.error
            ? h(ErrorBox, { title: '读取失败', error: diaryModal.error })
            : h('div', { style: { fontSize: 13, color: T.text, lineHeight: 1.9, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, diaryModal.text)),
    ),

    // 教程弹层
    h(Modal, {
      open: !!tutModal.open,
      title: '使用说明',
      width: 720,
      onClose: () => setTutModal({ open: false, loading: false, text: '', error: '' }),
      footer: h(Btn, { kind: 'ghost', onClick: () => setTutModal({ open: false, loading: false, text: '', error: '' }) }, '关闭'),
    },
      tutModal.loading
        ? h(Loading, { text: '教程加载中…' })
        : (tutModal.error
            ? h(ErrorBox, { title: '教程读取失败', error: tutModal.error, onRetry: openTutorial })
            : h('div', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, settingsDataTutorialBlocks(tutModal.text))),
    ),
  )
}
