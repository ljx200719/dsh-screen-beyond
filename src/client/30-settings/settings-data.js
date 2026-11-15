// 30-settings/settings-data.js —— 设置·数据卡片 + 记忆管理卡片
//
// 本文件提供两个组件（外壳/记忆标签按名字引用）：
//   · function SettingsDataTab()     数据标签：日记（生成/查看/给她看）、备份列表 + 一键备份 + 恢复、
//                                    数据目录/版本/数据修订信息、使用说明（教程 Modal）
//   · function SettingsMemoryCard()  记忆标签用：记忆统计/核心/普通/归档列表、置顶(=核心记忆增减)/
//                                    删除、文本导入、遗忘参数（本组件可单独嵌入任意标签）
// 契约：外壳不传 props，需要什么自己取接口（N02 不写死角色信息）
// 可靠性：读取失败时禁用写操作（读失败禁存）；危险操作（删除记忆/恢复备份）必须 confirmDialog；
//         恢复备份会覆盖数据 → 二次确认；所有 POST 只发改动字段；值前端 clamp（后端同样会 clamp）；
//         /api/memory/pin|delete|import 带 expectedRev，版本冲突(409) 时自动重读

// ── 日记日期工具（F-022）──────────────────────────────────────────────
// 本地时区的 YYYY-MM-DD；前后跳一天；不用 Date 的 toISOString（那是 UTC，会差一天）
function settingsDataToday() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}
function settingsDataShiftDate(dateStr, delta) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''))
  if (!m) return settingsDataToday()
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  d.setDate(d.getDate() + (Number(delta) || 0))
  const p = (n) => String(n).padStart(2, '0')
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

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

// 统计小方块（记忆卡片用）
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

// 单条记忆（带置顶/取消置顶、删除）
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
      h(Btn, { size: 'sm', kind: pinned ? 'ghost' : 'primary', disabled: disabled, onClick: () => handlers.onPin(f), title: pinned ? '取消置顶后按清晰度衰减' : '置顶后永远记得（核心记忆 +1）' }, pinned ? '取消置顶' : '置顶'),
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

// ───────────────────────── 记忆管理卡片（记忆标签用） ─────────────────────────
// 自带 /api/memory 数据与全部状态：统计 4 格、核心/普通/归档列表、置顶/取消置顶、删除、
// 文本导入、遗忘参数。置顶 = 进入核心记忆（永不遗忘）；取消置顶后按清晰度衰减，核心数 -1。
function SettingsMemoryCard() {
  const memApi = useApi('/api/memory')

  const [memParams, setMemParams] = React.useState({ halfLifeDays: 5, forgetThreshold: 0.12, reinforceBoost: 0.22, maxInjected: 8 })
  const [showArchived, setShowArchived] = React.useState(false)
  const [factLimit, setFactLimit] = React.useState(30)
  const [importText, setImportText] = React.useState('')
  const [importImportance, setImportImportance] = React.useState(0.5)
  const [importPin, setImportPin] = React.useState(false)
  const [busy, setBusy] = React.useState('')

  // ── 同步遗忘参数草稿 ────────────────────────────────────────────────
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

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  // ── 数据 ────────────────────────────────────────────────────────────
  const facts = (memApi.data && memApi.data.facts) || []
  const archived = (memApi.data && memApi.data.archived) || []
  const stats = (memApi.data && memApi.data.stats) || {}
  const params = (memApi.data && memApi.data.params) || {}
  const diaryDates = (memApi.data && memApi.data.diaryDates) || []
  const coreStrength = Number(params.coreStrength) || 0.85
  const coreFacts = facts.filter((f) => f.pinned || Number(f.strength) >= coreStrength)
  const normalFacts = facts.filter((f) => !(f.pinned || Number(f.strength) >= coreStrength))
  const memRev = () => {
    const rev = memApi.data && memApi.data.rev
    return rev && rev.rev !== undefined ? rev.rev : undefined
  }
  // 并发保护的兜底：409（别人刚改过 / 衰减落盘）时自动重读一次再重试一次，用户无感
  const postMemory = async (path, payload) => {
    let r = await Api.post(path, { ...payload, expectedRev: memRev() })
    if (r.status === 409) {
      try { await memApi.reload() } catch {}
      await new Promise((res) => setTimeout(res, 120))
      const fresh = (memApi.data && memApi.data.rev && memApi.data.rev.rev !== undefined) ? memApi.data.rev.rev : undefined
      if (fresh !== undefined) r = await Api.post(path, { ...payload, expectedRev: fresh })
    }
    return r
  }

  // ── 置顶 / 取消置顶（核心记忆 +1/-1）────────────────────────────────
  const togglePin = (f) => run('pin', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「重新读取」再操作', 'error'); return }
    const r = await postMemory('/api/memory/pin', { id: f.id })
    if (!r.ok) { toast(r.error || '操作失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast(f.pinned ? '已取消置顶（核心 -1，之后按清晰度衰减）' : '已置顶（核心 +1，永远记得）')
    memApi.reload()
  })

  // ── 删除（危险操作，二次确认）──────────────────────────────────────
  const deleteFact = (f) => run('deleteFact', async () => {
    if (memApi.error) { toast('记忆读取失败，先点「重新读取」再操作', 'error'); return }
    const ok = await confirmDialog('删掉这条记忆？', { title: '删除记忆', detail: String(f.text || ''), danger: true, okText: '删除' })
    if (!ok) return
    const r = await postMemory('/api/memory/delete', { id: f.id })
    if (!r.ok) { toast(r.error || '删除失败', 'error'); if (r.status === 409) memApi.reload(); return }
    toast('已删除这条记忆（她不会再记得这件事）')
    memApi.reload()
  })

  const factHandlers = { disabled: !!busy || !!memApi.error, onPin: togglePin, onDelete: deleteFact }

  // ── 遗忘参数 ────────────────────────────────────────────────────────
  const saveMemParams = () => run('memParams', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「重新读取」再保存', 'error'); return }
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

  // ── 文本导入 ────────────────────────────────────────────────────────
  // F-021：拆句规则可配置 + 导入前预览（行数/前 5 条/解析不出内容的行号）
  const [importOpts, setImportOpts] = React.useState({ splitOnComma: false, perLineOnly: false, maxLen: 90 })
  const [importPreview, setImportPreview] = React.useState(null)
  const [importPreviewErr, setImportPreviewErr] = React.useState('')
  const [importPreviewing, setImportPreviewing] = React.useState(false)
  const importRuleLabel = importOpts.perLineOnly
    ? '只按行拆'
    : (importOpts.splitOnComma ? '按行 + 按 。！？；， 拆' : '按行 + 按 。！？； 拆')
  const importLineCount = String(importText || '').replace(/\r/g, '').split('\n').filter((l) => l.trim()).length

  const doPreview = async () => {
    const text = String(importText || '').trim()
    if (!text) { toast('先粘贴要导入的记忆文本', 'error'); return }
    setImportPreviewing(true)
    setImportPreviewErr('')
    try {
      const r = await Api.post('/api/memory/import/preview', { text, opts: importOpts }, { timeoutMs: 30000 })
      if (!r.ok) { setImportPreview(null); setImportPreviewErr(r.error || '预览失败'); return }
      setImportPreview(r.data || null)
    } catch (e) {
      setImportPreview(null)
      setImportPreviewErr((e && e.message) || '预览失败')
    } finally {
      setImportPreviewing(false)
    }
  }

  const importMemory = () => run('import', async () => {
    if (memApi.error) { toast('记忆配置读取失败，先点「重新读取」再导入', 'error'); return }
    const text = String(importText || '').trim()
    if (!text) { toast('先粘贴要导入的记忆文本', 'error'); return }
    const ok = await confirmDialog('导入这些记忆？', {
      title: '导入记忆',
      detail: '规则：' + importRuleLabel + '；单条最多 ' + importOpts.maxLen + ' 字。会合并相似记忆、去重（单次最多 500 条）。',
      okText: '导入',
    })
    if (!ok) return
    const r = await Api.post('/api/memory/import', {
      text,
      opts: importOpts,
      importance: clampNum(importImportance, 0, 1, 0.5),
      pinNew: !!importPin,
      expectedRev: memRev(),
    })
    if (!r.ok) {
      // F-021：失败带行号
      const empty = (r.data && Array.isArray(r.data.emptyLines)) ? r.data.emptyLines : []
      toast((r.error || '导入失败') + (empty.length ? '（第 ' + empty.join('、') + ' 行）' : ''), 'error')
      if (r.status === 409) memApi.reload()
      return
    }
    const d = r.data || {}
    toast('导入完成：解析 ' + (Number(d.total) || 0) + ' 条，新增 ' + (Number(d.added) || 0) + '，合并 ' + (Number(d.merged) || 0))
    setImportText('')
    setImportPreview(null)
    memApi.reload()
  })

  // ── 渲染 ────────────────────────────────────────────────────────────
  const statGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8, minWidth: 0 }
  const formGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, minWidth: 0 }
  const normals = normalFacts.slice(0, factLimit)
  const hiddenCount = Math.max(0, normalFacts.length - normals.length)

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 统计 + 核心/普通/归档列表
    h(Card, {
      title: '记忆条目',
      tag: '按半衰期淡忘，提到会加深；置顶 = 核心记忆（永不遗忘）',
      actions: h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: memApi.reload, title: '重新读取记忆列表' }, '重新读取'),
    },
      h(Note, {}, '「置顶」= 把这条放进核心记忆（不遗忘）；「取消置顶」= 放回普通记忆，之后按清晰度慢慢衰减。'),
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
        onChange: (v) => { setImportText(v); setImportPreview(null) },
        rows: 6,
        placeholder: '每行一条；也可以直接粘贴 JSON（会被拆句去重）。例如：\n用户喜欢猫，讨厌狗\n用户最近在写作业',
        disabled: !!busy,
      }),
      h(Row, { gap: 8, wrap: true },
        h(Note, {}, '已输入 ' + importLineCount + ' 行（非空）· 当前规则：' + importRuleLabel),
        h('span', { style: { flex: 1 } }),
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy || !String(importText || '').trim(), onClick: () => { void doPreview() } },
          importPreviewing ? '预览中…' : '预览前 5 条'),
      ),
      h('div', { style: formGrid },
        h(Field, { label: '重要度', hint: '0 – 1；≥0.95 会自动置顶' },
          h(NumInput, { value: importImportance, onChange: setImportImportance, min: 0, max: 1, step: 0.05, width: 100, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '导入后置顶', hint: '新导入的记忆立刻变成核心记忆' },
          h(Toggle, { checked: !!importPin, disabled: !!busy, onChange: setImportPin, label: importPin ? '会置顶' : '不置顶' }),
        ),
        h(Field, { label: '拆句规则', hint: '默认按行 + 句子符号拆；逗号太多时别开' },
          h(Select, {
            value: importOpts.perLineOnly ? 'line' : (importOpts.splitOnComma ? 'comma' : 'sentence'),
            disabled: !!busy,
            onChange: (v) => {
              const next = {
                perLineOnly: v === 'line',
                splitOnComma: v === 'comma',
                maxLen: importOpts.maxLen,
              }
              setImportOpts(next)
              setImportPreview(null)
            },
            options: [
              { value: 'sentence', label: '按行 + 。！？； 拆（默认）' },
              { value: 'comma', label: '再按逗号拆（更碎）' },
              { value: 'line', label: '只按行拆（不拆句）' },
            ],
          }),
        ),
        h(Field, { label: '单条最长', hint: '8 – 200 字，超了截断' },
          h(NumInput, {
            value: importOpts.maxLen, min: 8, max: 200, step: 10, disabled: !!busy, flex: true,
            onChange: (v) => { setImportOpts((o) => Object.assign({}, o, { maxLen: clampNum(v, 8, 200, 90) })); setImportPreview(null) },
          }),
        ),
      ),
      importPreviewErr ? h(ErrorBox, { title: '预览失败', error: importPreviewErr }) : null,
      importPreview
        ? h('div', {
            style: { border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 },
          },
            h('div', { style: { fontSize: 12, color: T.text, fontWeight: 600 } },
              '预览：共 ' + importPreview.total + ' 条（原文 ' + importPreview.lineCount + ' 行）'),
            (importPreview.preview || []).map((t, i) => h('div', { key: 'pv' + i, style: { fontSize: 11.5, color: T.text2, lineHeight: 1.6 } }, '· ' + String(t))),
            (importPreview.total > (importPreview.preview || []).length)
              ? h('div', { style: { fontSize: 11, color: T.text3 } }, '…还有 ' + (importPreview.total - importPreview.preview.length) + ' 条')
              : null,
            (importPreview.emptyLines && importPreview.emptyLines.length)
              ? h('div', { style: { fontSize: 11, color: T.warn, lineHeight: 1.6 } },
                  '这些行解析不出内容（会被跳过）：第 ' + importPreview.emptyLines.join('、') + ' 行')
              : null,
          )
        : null,
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!memApi.error, onClick: importMemory }, busy === 'import' ? '导入中…' : '导入这些记忆'),
        h(Btn, {
          size: 'sm', kind: 'ghost', disabled: !!busy || !String(importText || '').trim(),
          onClick: () => { setImportText(''); setImportPin(false); setImportImportance(0.5); setImportPreview(null) },
        }, '清空'),
      ),
      h(Note, {}, '导入会合并相似记忆、去重；不会删除或覆盖已有记忆。失败时会给出具体行号。'),
    ),
  )
}

// ───────────────────────── 数据标签 ─────────────────────────
// 记忆管理已移到「记忆」标签（SettingsMemoryCard），这里只留日记/备份/数据目录/版本/教程。
function SettingsDataTab() {
  const status = useStatus()
  const st = (status && status.data) || {}
  const setup = st.setup || {}

  const diaryApi = useApi('/api/diary')
  const backupApi = useApi('/api/backup/list')
  const petCacheApi = useApi('/api/pet/cache')

  const [verInfo, setVerInfo] = React.useState(null)
  const [revInfo, setRevInfo] = React.useState(null)
  const [revError, setRevError] = React.useState('')

  const [diaryModal, setDiaryModal] = React.useState({ open: false, title: '', text: '', loading: false, error: '' })
  const [tutModal, setTutModal] = React.useState({ open: false, loading: false, text: '', error: '' })

  const [busy, setBusy] = React.useState('')

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
    diaryApi.reload()
    backupApi.reload()
    petCacheApi.reload()
    loadMeta()
  }

  // ── 日记 ────────────────────────────────────────────────────────────
  const diaryDates = (diaryApi.data && diaryApi.data.dates) || []
  // F-022：原来只有最近 30 天的日期按钮，看不到更早的、也不能直接选一天。
  // 现在加一个日期选择器 + 前一天/后一天/今天，并且明确告诉用户"这一天没有日记"。
  const diaryToday = settingsDataToday()
  const [diaryDate, setDiaryDate] = React.useState(diaryToday)
  const diaryShift = (delta) => {
    const d = settingsDataShiftDate(diaryDate, delta)
    if (d > diaryToday) return
    setDiaryDate(d)
    openDiary(d)
  }
  const onPickDiaryDate = (v) => {
    const d = String(v || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return
    if (d > diaryToday) { toast('还没到那天，看不到未来的日记', 'error'); return }
    setDiaryDate(d)
    openDiary(d)
  }

  const openDiary = async (date) => {
    setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: true, error: '' })
    try {
      const r = await Api.get('/api/diary?date=' + encodeURIComponent(date))
      if (!r.ok) { setDiaryModal({ open: true, title: '日记 · ' + date, text: '', loading: false, error: r.error || '读取失败' }); return }
      const text = String((r.data && r.data.text) || '').trim()
      const exists = r.data && (r.data.exists === undefined ? !!text : !!r.data.exists)
      const body = text || (exists ? '（这篇日记是空的）' : '这一天没有日记（她那天没写）。这里只做查看，不会自动生成、也不会改数据。')
      setDiaryModal({ open: true, title: '日记 · ' + date, text: body, loading: false, error: '' })
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
  // F-020：恢复前先看差异（只读 inspect，不动数据）
  const [restoreModal, setRestoreModal] = React.useState({ open: false, name: '', loading: false, error: '', info: null })
  // 进度：备份/恢复期间给一句明确的状态，不要只有转圈
  const [backupNote, setBackupNote] = React.useState('')

  const doBackup = () => run('backup', async () => {
    const ok = await confirmDialog('现在备份数据目录？', {
      title: '立即备份',
      detail: '会打包成 zip 写到数据目录下的 backups；数据大时可能要几分钟。',
      okText: '开始备份',
    })
    if (!ok) return
    setBackupNote('正在打包（数据大时几分钟）…')
    try {
      const r = await Api.post('/api/backup', {}, { timeoutMs: 300000 })
      if (!r.ok) { toast('备份失败：' + (r.error || '未知错误'), 'error'); return }
      if (r.data && r.data.ok === false) { toast('备份失败：' + (r.data.error || '未知错误'), 'error'); return }
      const made = String((r.data && r.data.name) || '')
      // F-020：先把新备份就地插进列表（不用等下一次刷新），再对一次服务端
      if (made) {
        const now = Date.now()
        backupApi.setData((d) => {
          const list = Array.isArray(d && d.backups) ? d.backups.slice() : []
          if (list.some((x) => x && x.name === made)) return { ok: true, dir: (d && d.dir) || '', backups: list }
          list.unshift({ name: made, size: 0, at: now })
          return { ok: true, dir: (d && d.dir) || '', backups: list }
        })
      }
      toast((r.data && r.data.message) || '备份完成')
    } finally {
      setBackupNote('')
    }
    backupApi.reload()
  })

  // P1-2：备份删除。只删 backups/ 下这个命名规则的 zip；恢复路径不受影响。
  const removeBackup = (name) => run('backupDel', async () => {
    const ok = await confirmDialog('删除备份 ' + name + '？', {
      title: '删除备份',
      detail: '只删除这一个 zip 文件，不会动当前数据；删除后无法找回。',
      okText: '删除',
    })
    if (!ok) return
    const r = await Api.post('/api/backup/delete', { name }, { timeoutMs: 30000 })
    if (!r.ok || (r.data && r.data.ok === false)) {
      toast('删除失败：' + ((r.data && r.data.error) || r.error || '未知错误'), 'error')
      return
    }
    toast('已删除备份：' + name)
    backupApi.reload()
  })

  // P1-6：清理旧桌宠立绘缓存。服务端只删数据根目录里旧 stamp 的 sprite-*.png，
  // 当前版本和最近 10 分钟文件保留；不会碰角色素材目录。
  const cleanPetCache = () => run('petCache', async () => {
    const info = petCacheApi.data || {}
    const n = Number(info.removable) || 0
    const mb = Number(info.removableBytes) || 0
    const ok = await confirmDialog('清理旧桌宠立绘缓存？', {
      title: '清理立绘缓存',
      detail: '将删除旧版本 sprite-*.png（约 ' + n + ' 个 / ' + fmtBytes(mb) + '）。当前版本和最近 10 分钟的文件会保留，不影响正在运行的桌宠。',
      okText: '清理',
    })
    if (!ok) return
    const r = await Api.post('/api/pet/cache/clean', {}, { timeoutMs: 60000 })
    if (!r.ok || (r.data && r.data.ok === false)) {
      toast('清理失败：' + ((r.data && r.data.error) || r.error || '未知错误'), 'error')
      return
    }
    const d = (r.data && r.data.stats) || {}
    toast('已清理 ' + ((r.data && r.data.removed) || 0) + ' 个旧文件，' + fmtBytes((r.data && r.data.removedBytes) || 0) + '；剩余 ' + (d.count || 0) + ' 个')
    petCacheApi.reload()
  })

  // 第一步：只读差异预览
  const inspectBackup = async (name) => {
    setRestoreModal({ open: true, name: name, loading: true, error: '', info: null })
    try {
      const r = await Api.post('/api/backup/inspect', { name }, { timeoutMs: 60000 })
      if (!r.ok || !r.data || r.data.ok === false) {
        setRestoreModal({ open: true, name: name, loading: false, error: (r.error || (r.data && r.data.error) || '读取备份内容失败'), info: null })
        return
      }
      setRestoreModal({ open: true, name: name, loading: false, error: '', info: r.data })
    } catch (e) {
      setRestoreModal({ open: true, name: name, loading: false, error: (e && e.message) || '读取失败', info: null })
    }
  }

  // 第二步：看过差异再确认恢复（会覆盖）
  const restoreBackup = (name) => run('restore', async () => {
    const ok = await confirmDialog('恢复备份 ' + name + '？', {
      title: '恢复备份',
      detail: '会覆盖当前的角色、配置、记忆、日记和聊天数据。恢复前会自动再备份一次当前状态，出问题还能回来。',
      danger: true,
      okText: '继续',
    })
    if (!ok) return
    const ok2 = await confirmDialog('最后确认：真的要恢复这个备份吗？', {
      title: '最后确认',
      detail: '恢复过程中不要关闭 DSH；完成后需要重启 DSH 让运行时重新加载数据。',
      danger: true,
      okText: '恢复',
    })
    if (!ok2) return
    setRestoreModal((m) => Object.assign({}, m, { open: false }))
    setBackupNote('正在恢复（会覆盖当前数据，期间别关 DSH）…')
    let r = null
    try {
      r = await Api.post('/api/backup/restore', { name }, { timeoutMs: 300000 })
    } finally {
      setBackupNote('')
    }
    if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
    if (r.data && r.data.ok === false) {
      toast('恢复失败：' + ((r.data && r.data.error) || '未知错误'), 'error')
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
  const revEntityCount = revInfo && revInfo.entities ? Object.keys(revInfo.entities).length : 0
  const revAt = revInfo && revInfo.updatedAt ? Date.parse(revInfo.updatedAt) : 0
  const deviceShort = revInfo && revInfo.deviceId ? String(revInfo.deviceId).slice(0, 8) : ''

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：刷新
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '日记/备份都直接读写本机运行时数据目录；危险操作都会二次确认。'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy, title: '重新读取日记 / 备份 / 版本' }, '刷新'),
    ),

    // 记忆管理已移到「记忆」标签
    h(Note, {}, '记忆条目的查看/置顶/删除/导入、遗忘参数在「记忆」标签里管理；这里是日记、备份、数据目录、版本与教程。'),

    // 日记
    h(Card, { title: '日记', tag: '她每天写一篇' },
      diaryApi.error
        ? h(ErrorBox, { title: '日记列表读取失败', error: diaryApi.error, onRetry: diaryApi.reload })
        : null,
      // F-022：任意日期都能看。前后日/今天 + 原生日期选择器（未来日期禁止）
      h(Row, { gap: 6, wrap: true },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, title: '看前一天的日记', onClick: () => diaryShift(-1) }, '◀ 前一天'),
        h(Btn, {
          size: 'sm', kind: 'ghost', disabled: !!busy,
          title: '看后一天的日记（不能超过今天）',
          onClick: () => diaryShift(1),
        }, '后一天 ▶'),
        h(Btn, {
          size: 'sm', kind: diaryDate === diaryToday ? 'soft' : 'ghost',
          disabled: !!busy,
          title: '回到今天',
          onClick: () => { setDiaryDate(diaryToday); openDiary(diaryToday) },
        }, '今天'),
        h('input', {
          type: 'date',
          className: 'sbc-input',
          value: diaryDate,
          max: diaryToday,
          disabled: !!busy,
          title: '选任意一天看那天的日记（未来日期不能选）',
          onChange: (e) => onPickDiaryDate(e.target.value),
          style: {
            fontSize: 12, padding: '4px 8px', borderRadius: 8, minWidth: 132,
            color: T.text, background: T.bg1, border: '1px solid ' + T.border, fontFamily: T.font,
          },
        }),
        h('span', { style: { fontSize: 11, color: T.text3 } }, '正在看：' + diaryDate),
      ),
      // 有日记的日期（最近 30 个）保留成快捷按钮
      diaryDates.length
        ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            diaryDates.slice(0, 30).map((d) => h(Btn, {
              key: String(d), size: 'sm',
              kind: String(d) === diaryDate ? 'soft' : 'ghost',
              disabled: !!busy,
              onClick: () => { setDiaryDate(String(d)); openDiary(String(d)) },
            }, String(d))),
          )
        : h(Note, {}, diaryApi.loading ? '日记加载中…' : '还没有日记；点「生成今天的日记」试试。'),
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
      // F-020：备份/恢复过程中的状态说明（不只是转圈）
      backupNote ? h(Loading, { text: backupNote }) : null,
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
                  // F-020：先看差异预览，再决定要不要覆盖
                  h(Btn, {
                    size: 'sm', kind: 'danger', disabled: !!busy,
                    title: '先看差异预览，再决定要不要恢复（会覆盖当前数据）',
                    onClick: () => { inspectBackup(String(b.name)).catch(() => {}) },
                  }, busy === 'restore' ? '恢复中…' : '恢复…'),
                  h(Btn, {
                    size: 'sm', kind: 'ghost', disabled: !!busy,
                    title: '只删除这个备份文件，不动当前数据',
                    onClick: () => { removeBackup(String(b.name)).catch(() => {}) },
                  }, busy === 'backupDel' ? '删除中…' : '删除'),
                )),
              )
            : h(Empty, { icon: '🗂️' }, '还没有备份；点「立即备份」生成第一个。'))
        : h(Note, {}, backupApi.loading ? '备份列表加载中…' : '还没读到备份列表，点「刷新列表」再试。'),
      backupDir ? h(Note, {}, '备份目录：' + backupDir) : null,
    ),

    // P1-6：桌宠立绘缓存（数据根目录里 sprite-*.png 旧版本会累积）
    h(Card, {
      title: '桌宠立绘缓存',
      tag: '只清旧版本，不动当前',
      actions: h(Btn, {
        size: 'sm', kind: 'ghost', disabled: !!busy || !(petCacheApi.data && petCacheApi.data.removable),
        onClick: () => { cleanPetCache().catch(() => {}) },
      }, busy === 'petCache' ? '清理中…' : '清理旧版本'),
    },
      petCacheApi.error
        ? h(ErrorBox, { title: '缓存统计读取失败', error: petCacheApi.error, onRetry: petCacheApi.reload })
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
            h(Note, {}, '数据目录里保存的是桌宠每次换素材时缓存的立绘帧；旧版本不会自动删除。这里只删旧版本，当前版本和最近 10 分钟文件保留。',
              petCacheApi.data
                ? ' 当前共 ' + (petCacheApi.data.count || 0) + ' 个 / ' + fmtBytes(petCacheApi.data.bytes || 0) + '，可清理 ' + (petCacheApi.data.removable || 0) + ' 个 / ' + fmtBytes(petCacheApi.data.removableBytes || 0) + '。'
                : ''),
            h(Btn, { size: 'sm', kind: 'ghost', disabled: !!busy, onClick: petCacheApi.reload }, '刷新缓存统计'),
          ),
    ),

    // 恢复前的差异预览（只读）；确认后才真的覆盖
    h(Modal, {
      open: !!restoreModal.open,
      title: '恢复前先看差异 · ' + String(restoreModal.name || ''),
      onClose: () => setRestoreModal({ open: false, name: '', loading: false, error: '', info: null }),
      width: 640,
    },
      restoreModal.loading ? h(Loading, { text: '正在读取备份内容（只读，不动任何数据）…' }) : null,
      restoreModal.error ? h(ErrorBox, { title: '读不了这个备份的清单', error: restoreModal.error }) : null,
      restoreModal.info
        ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8 } },
              h(KV, { k: '备份文件数', v: String(restoreModal.info.backup.fileCount) }),
              h(KV, { k: '数据文件 / 大小', v: restoreModal.info.backup.dataFiles + ' 个 · ' + restoreModal.info.backup.dataMB + ' MB' }),
              h(KV, { k: '压缩包大小', v: restoreModal.info.zipMB + ' MB' }),
              h(KV, { k: '备份时间', v: fmtDateTime(restoreModal.info.at) }),
              h(KV, { k: '备份里的角色数', v: String(restoreModal.info.backup.characters.length) + '（含 ' + restoreModal.info.backup.characters.join('、') + '）' }),
              h(KV, { k: '当前角色数', v: String(restoreModal.info.current.characters.length) + '（含 ' + restoreModal.info.current.characters.join('、') + '）' }),
            ),
            restoreModal.info.onlyInBackup.length
              ? h(Note, {}, '⚠ 恢复后会多出这些角色：' + restoreModal.info.onlyInBackup.join('、'))
              : null,
            restoreModal.info.onlyNow.length
              ? h(Note, {}, '⚠ 这些角色现在有、备份里没有 —— 恢复后会消失：' + restoreModal.info.onlyNow.join('、'))
              : null,
            restoreModal.info.configOverwritten
              ? h(Note, {}, '配置（config.json）会被备份里的版本覆盖：模型设置、面板配色、VM/直连开关都会回到备份那一刻。')
              : null,
            h(Note, {}, '恢复前运行时会先自动备份一次当前状态，出问题还能再恢复回来；恢复完成后需要重启 DSH。'),
            h(Row, { gap: 8, style: { justifyContent: 'flex-end' } },
              h(Btn, { size: 'sm', kind: 'ghost', onClick: () => setRestoreModal({ open: false, name: '', loading: false, error: '', info: null }) }, '算了'),
              h(Btn, {
                size: 'sm', kind: 'danger', disabled: !!busy,
                onClick: () => { restoreBackup(String(restoreModal.name)).catch(() => {}) },
              }, '确认覆盖并恢复'),
            ),
          )
        : null,
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
