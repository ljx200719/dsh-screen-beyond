// 30-settings/settings-core.js —— 设置：角色 / 人设 / 上下文 / 经济
//
// 构建顺序在 settings-life.js / settings.js 之前，所以生活标签可以复用这里的
// SettingsEconomyCard / SettingsBalanceAlertCard / SettingsContextCard。
//
// 约定（docs/NATIVE-CLIENT-ARCH.md）：
//   · 这是单文件工厂的片段：不写 import/export，只能引用前面文件里的 const/function；
//   · 颜色只走 T.*，中文 UI，不写死角色名/ID（角色名一律从接口读，N02）；
//   · 读取用 useApi，保存只提交「改动过的字段」（POST 局部字段，避免整体覆盖丢字段）；
//   · 读失败时禁用保存 + 显示 ErrorBox；非法值前端 clamp（后端也会 clamp）；
//   · 危险操作（删除/清空/覆盖）一律 await confirmDialog(...)；成功 toast。

// ───────────────────────── 共用小工具（life / shell 也会用） ─────────────────────────

// 结构比较：这里的值都是小对象/数组，JSON 比较够用，且能避免两个对象不一致却判等
function stgCoreEq(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) } catch (e) { return false }
}

// 只挑出变化过的字段（保存用：绝不整体覆盖）
function stgCoreDiff(base, next, keys) {
  const out = {}
  if (!base || !next) return out
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]
    if (!stgCoreEq(base[k], next[k])) out[k] = next[k]
  }
  return out
}

function stgCoreHas(obj) { return !!obj && Object.keys(obj).length > 0 }

// 数字夹紧（前端先拦一次；后端还有一层 clamp）
function stgCoreNum(v, lo, hi, dflt) { return clampNum(v, lo, hi, dflt) }
function stgCoreInt(v, lo, hi, dflt) { return Math.round(clampNum(v, lo, hi, dflt)) }

// 读取失败统一展示（配合「读失败禁用保存」）
function stgCoreErrBox(error, onRetry) {
  if (!error) return null
  return h(ErrorBox, { title: '读取失败', error: error, onRetry: onRetry })
}

// 保存中状态：run(fn) 自动加锁，避免连点重复提交
function stgCoreBusy() {
  const [busy, setBusy] = React.useState(false)
  const run = React.useCallback(async (fn) => {
    setBusy(true)
    try { return await fn() } finally { setBusy(false) }
  }, [])
  return [busy, run]
}

// useApi 的返回值 → 可编辑草稿 + 保存基线。
//   · 数据到达（或 reload 后 at 变化）时重建草稿；
//   · patch(部分字段) 改草稿；base 始终是上次读取到的值，用来算「改了哪些字段」。
function stgCoreDraft(api, seed) {
  const [draft, setDraft] = React.useState(null)
  const [base, setBase] = React.useState(null)
  const at = api && api.data ? api.at : 0
  React.useEffect(() => {
    // 只在「读到新数据」时重建草稿：读取失败（api.error）时保留用户正在改的内容，
    // 避免手动点「重新读取」失败一次就把没保存的编辑清空。
    if (!at || !api || !api.data || api.error) return
    const v = seed(api.data)
    setDraft(v)
    setBase(v)
  }, [at])
  const patch = React.useCallback((next) => {
    setDraft((prev) => {
      if (prev === null) return prev
      const p = typeof next === 'function' ? next(prev) : next
      return Object.assign({}, prev, p)
    })
  }, [])
  const reset = React.useCallback(() => { setDraft(base) }, [base])
  return { draft: draft, base: base, patch: patch, reset: reset }
}

// 统一保存按钮
function stgCoreSaveBtn(props) {
  const p = props || {}
  return h(Btn, {
    size: 'sm',
    kind: 'primary',
    disabled: !!p.disabled,
    onClick: p.onClick,
    title: p.title || '只保存改动过的字段',
  }, p.busy ? '保存中…' : (p.label || '保存'))
}

// ───────────────────────── 角色 / 人设 ─────────────────────────

const STG_ROLE_TRAVEL_PREFS = [
  { value: 'auto', label: '随便 / 看情况' },
  { value: 'cheap', label: '省钱优先' },
  { value: 'fast', label: '赶时间优先' },
]
const STG_ROLE_MODEL_TYPES = [
  { value: 'none', label: '没有（用头像）' },
  { value: 'sprite', label: '2D 精灵图' },
  { value: 'live2d', label: 'Live2D' },
  { value: '3d', label: '3D 模型（本版不渲染）' },
]
const STG_ROLE_TRAIT_MAX = 24

function stgCoreTraitsSeed(src) {
  const out = {}
  const raw = src && typeof src === 'object' ? src : {}
  for (const k of Object.keys(raw)) {
    const name = String(k).trim().slice(0, 20)
    if (!name) continue
    out[name] = stgCoreInt(raw[k], 0, 10, 5)
    if (Object.keys(out).length >= STG_ROLE_TRAIT_MAX) break
  }
  return out
}

// /api/persona → 角色卡草稿（meta 的字段平铺，body 一起）
function stgCorePersonaSeed(d) {
  const m = (d && d.meta) || {}
  const model = m.model || {}
  return {
    name: String(m.name || ''),
    userCall: String(m.userCall || ''),
    relation: String(m.relation || ''),
    age: (m.age === undefined || m.age === null || m.age === '') ? '' : stgCoreInt(m.age, 0, 200, 0),
    license: m.license === true,
    travelPref: ['auto', 'cheap', 'fast'].includes(m.travelPref) ? m.travelPref : 'auto',
    examples: Array.isArray(m.examples) ? m.examples.map((x) => String(x)) : [],
    traits: stgCoreTraitsSeed(m.traits),
    modelType: ['none', 'sprite', 'live2d', '3d'].includes(model.type) ? model.type : 'none',
    modelUrl: String(model.url || ''),
    modelScale: Number(model.scale) || 1,
    body: String((d && d.body) || ''),
  }
}

// 草稿 → POST /api/persona 的 meta/body 局部字段（meta 里只放改过的项，服务端浅合并）
function stgCorePersonaPayload(baseDraft, draft, prevMeta) {
  const payload = {}
  const meta = {}
  if (!stgCoreEq(String(baseDraft.name || ''), String(draft.name || ''))) meta.name = String(draft.name || '').trim().slice(0, 60)
  if (!stgCoreEq(String(baseDraft.userCall || ''), String(draft.userCall || ''))) meta.userCall = String(draft.userCall || '').trim().slice(0, 30)
  if (!stgCoreEq(String(baseDraft.relation || ''), String(draft.relation || ''))) meta.relation = String(draft.relation || '').trim().slice(0, 200)
  if (!stgCoreEq(baseDraft.age, draft.age)) meta.age = draft.age === '' ? null : stgCoreInt(draft.age, 0, 200, null)
  if (!stgCoreEq(!!baseDraft.license, !!draft.license)) meta.license = !!draft.license
  if (!stgCoreEq(baseDraft.travelPref, draft.travelPref)) meta.travelPref = draft.travelPref
  if (!stgCoreEq(baseDraft.examples, draft.examples)) meta.examples = (draft.examples || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
  if (!stgCoreEq(baseDraft.traits, draft.traits)) meta.traits = stgCoreTraitsSeed(draft.traits)
  const model = {}
  if (!stgCoreEq(baseDraft.modelType, draft.modelType)) model.type = draft.modelType
  if (!stgCoreEq(String(baseDraft.modelUrl || ''), String(draft.modelUrl || ''))) model.url = String(draft.modelUrl || '').trim().slice(0, 300)
  if (!stgCoreEq(Number(baseDraft.modelScale), Number(draft.modelScale))) model.scale = stgCoreNum(draft.modelScale, 0.1, 3, 1)
  if (stgCoreHas(model)) meta.model = Object.assign({}, prevMeta && prevMeta.model ? prevMeta.model : {}, model)
  if (stgCoreHas(meta)) payload.meta = meta
  if (!stgCoreEq(String(baseDraft.body || ''), String(draft.body || ''))) payload.body = String(draft.body || '').slice(0, 20000)
  return payload
}

function SettingsRoleTab() {
  const persona = useApi('/api/persona')
  const chars = useApi('/api/characters')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(persona, stgCorePersonaSeed)
  const draft = f.draft
  const base = f.base
  const [newExample, setNewExample] = React.useState('')
  const [newTrait, setNewTrait] = React.useState('')
  const [avatarBusy, setAvatarBusy] = React.useState(false)
  const avatarFile = React.useRef(null)
  const importFile = React.useRef(null)
  const readError = persona.error || ''
  const readOnly = !draft || !base
  const prevMeta = persona.data && persona.data.meta ? persona.data.meta : null

  const reloadAll = React.useCallback(() => {
    persona.reload()
    chars.reload()
  }, [persona, chars])

  const patch = f.patch

  // 角色列表：切换 / 新建 / 删除（切换会换人设、记忆、聊天记录）
  const switchChar = async (id) => {
    if (!chars.data || !id || String(id) === String(chars.data.active)) return
    const r = await Api.post('/api/characters', { action: 'switch', id: String(id) })
    if (!r.ok) { toast(r.error || '切换失败', 'error'); return }
    const nm = (r.data && r.data.character && r.data.character.name) || ''
    toast('已切换到 ' + (nm || '新角色'))
    reloadAll()
  }
  const newChar = async () => {
    const name = await promptDialog('新角色叫什么？', { title: '新建角色', okText: '创建', placeholder: '名字（之后可以改）' })
    if (name === null) return
    const v = String(name).trim()
    if (!v) { toast('名字不能为空', 'error'); return }
    const r = await Api.post('/api/characters', { action: 'new', name: v.slice(0, 60) })
    if (!r.ok) { toast(r.error || '创建失败', 'error'); return }
    toast('已创建新角色')
    reloadAll()
  }
  const deleteChar = async () => {
    if (!chars.data) return
    const id = chars.data.active
    const list = chars.data.characters || []
    const target = list.find((c) => String(c.id) === String(id))
    const ok = await confirmDialog('删除当前角色「' + ((target && target.name) || '当前角色') + '」？', {
      title: '删除角色',
      detail: '她的记忆、日记、聊天记录都会一起删掉，且找不回来。',
      danger: true,
      okText: '删除',
    })
    if (!ok) return
    const r = await Api.post('/api/characters', { action: 'delete', id: String(id) })
    if (!r.ok) { toast(r.error || '删除失败', 'error'); return }
    toast('角色已删除')
    reloadAll()
  }

  // 头像：上传 / 恢复默认（服务端会落成 /avatar.png 并打时间戳）
  const onAvatarFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      const rd = await Api.readFileAsDataUrl(file, 3 * 1024 * 1024)
      if (!rd.ok) { toast(rd.error || '读取图片失败', 'error'); return }
      const r = await Api.upload('/api/avatar', { dataUrl: rd.dataUrl })
      if (!r.ok) { toast('头像上传失败：' + (r.error || '未知错误'), 'error'); return }
      toast('头像已更新')
      persona.reload()
    } finally {
      setAvatarBusy(false)
    }
  }
  const clearAvatar = async () => {
    const ok = await confirmDialog('恢复成默认头像？', { detail: '当前上传的头像文件会被删掉。', danger: true, okText: '恢复默认' })
    if (!ok) return
    const r = await Api.upload('/api/avatar', { dataUrl: '' })
    if (!r.ok) { toast('恢复失败：' + (r.error || '未知错误'), 'error'); return }
    toast('已恢复默认头像')
    persona.reload()
  }

  // 示例句 / 性格开关（都先改草稿，点“保存角色卡”才提交）
  const addExample = () => {
    const v = String(newExample || '').trim()
    if (!v) { toast('先写一句她会说的话', 'error'); return }
    if ((draft.examples || []).length >= 12) { toast('示例最多 12 条', 'error'); return }
    patch((prev) => ({ examples: (prev.examples || []).concat(v.slice(0, 120)) }))
    setNewExample('')
  }
  const addTrait = () => {
    const v = String(newTrait || '').trim().slice(0, 20)
    if (!v) { toast('先写性格开关的名字', 'error'); return }
    if (Object.keys(draft.traits || {}).length >= STG_ROLE_TRAIT_MAX) { toast('性格开关最多 ' + STG_ROLE_TRAIT_MAX + ' 个', 'error'); return }
    patch((prev) => ({ traits: Object.assign({}, prev.traits || {}, { [v]: 5 }) }))
    setNewTrait('')
  }

  const saveRole = () => run(async () => {
    if (!draft || !base) return
    const name = String(draft.name || '').trim()
    if (!name) { toast('名字不能为空', 'error'); return }
    if (draft.age !== '' && draft.age !== null && !Number.isFinite(Number(draft.age))) { toast('年龄要填数字（0–200，可不填）', 'error'); return }
    const next = Object.assign({}, draft, {
      name: name,
      userCall: String(draft.userCall || '').trim(),
      relation: String(draft.relation || '').trim(),
      age: draft.age === '' ? '' : stgCoreInt(draft.age, 0, 200, 0),
    })
    const payload = stgCorePersonaPayload(base, next, prevMeta)
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/persona', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('角色卡已保存，下一条消息生效')
    persona.reload()
  })

  const resetDraft = () => { f.reset(); toast('已撤销未保存的修改') }

  // 导出 / 导入角色卡（纯本地 JSON，不请求任何网页）
  const exportRole = () => {
    if (!draft) return
    const payload = {
      meta: {
        name: draft.name, userCall: draft.userCall, relation: draft.relation,
        age: draft.age === '' ? null : draft.age, license: !!draft.license, travelPref: draft.travelPref,
        examples: (draft.examples || []).filter((x) => String(x).trim()),
        traits: draft.traits || {},
        model: { type: draft.modelType, url: draft.modelUrl, scale: Number(draft.modelScale) || 1 },
      },
      body: draft.body || '',
    }
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (String(draft.name || 'persona').trim() || 'persona') + '-角色卡.json'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove() } catch (e) {} }, 1500)
      toast('角色卡已导出')
    } catch (e) {
      toast('导出失败：' + ((e && e.message) || '浏览器不允许下载'), 'error')
    }
  }
  const onImportFile = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (e.target) e.target.value = ''
    if (!file) return
    let j = null
    try { j = JSON.parse(await file.text()) } catch (err) { toast('导入失败：不是有效的 JSON 角色卡', 'error'); return }
    if (!j || typeof j !== 'object' || (!j.meta && typeof j.body !== 'string')) { toast('导入失败：角色卡格式不对', 'error'); return }
    const src = j.meta && typeof j.meta === 'object' ? j.meta : {}
    const ok = await confirmDialog('用这张角色卡覆盖当前角色？', {
      title: '导入角色卡',
      detail: '会覆盖：名字、称呼、关系、年龄、说话示例、性格开关、模型设置、人设正文。头像不动。',
      danger: true,
      okText: '覆盖当前角色',
    })
    if (!ok) return
    const meta = {}
    if (typeof src.name === 'string' && src.name.trim()) meta.name = src.name.trim().slice(0, 60)
    if (typeof src.userCall === 'string') meta.userCall = src.userCall.trim().slice(0, 30)
    if (typeof src.relation === 'string') meta.relation = src.relation.trim().slice(0, 200)
    if (src.age !== undefined) meta.age = src.age === null || src.age === '' ? null : stgCoreInt(src.age, 0, 200, null)
    if (src.license !== undefined) meta.license = !!src.license
    if (['auto', 'cheap', 'fast'].includes(src.travelPref)) meta.travelPref = src.travelPref
    if (Array.isArray(src.examples)) meta.examples = src.examples.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
    if (src.traits && typeof src.traits === 'object') meta.traits = stgCoreTraitsSeed(src.traits)
    if (src.model && typeof src.model === 'object') {
      const m = {}
      if (['none', 'sprite', 'live2d', '3d'].includes(src.model.type)) m.type = src.model.type
      if (typeof src.model.url === 'string') m.url = src.model.url.trim().slice(0, 300)
      if (src.model.scale !== undefined) m.scale = stgCoreNum(src.model.scale, 0.1, 3, 1)
      if (stgCoreHas(m)) meta.model = Object.assign({}, (prevMeta && prevMeta.model) || {}, m)
    }
    const payload = {}
    if (stgCoreHas(meta)) payload.meta = meta
    if (typeof j.body === 'string') payload.body = j.body.slice(0, 20000)
    if (!stgCoreHas(payload)) { toast('角色卡里没有可导入的字段', 'error'); return }
    const r = await Api.post('/api/persona', payload)
    if (!r.ok) { toast('导入失败：' + (r.error || '未知错误'), 'error'); return }
    toast('角色卡已导入')
    persona.reload()
  }

  // ── 效果预览 ──
  const [previewIn, setPreviewIn] = React.useState('')
  const [previewOut, setPreviewOut] = React.useState('')
  const [previewErr, setPreviewErr] = React.useState('')
  const [previewing, setPreviewing] = React.useState(false)
  const doPreview = async () => {
    const text = String(previewIn || '').trim() || '在吗'
    setPreviewing(true)
    setPreviewErr('')
    try {
      const r = await Api.post('/api/preview', { text: text.slice(0, 200) })
      if (!r.ok) { setPreviewOut(''); setPreviewErr(r.error || '生成失败'); return }
      setPreviewOut(String((r.data && r.data.text) || ''))
    } finally {
      setPreviewing(false)
    }
  }

  const charList = (chars.data && chars.data.characters) || []
  const activeId = chars.data ? chars.data.active : ''
  const activeChar = charList.find((c) => String(c.id) === String(activeId)) || null
  const metaAvatar = (prevMeta && prevMeta.avatar) || (activeChar && activeChar.avatar) || ''

  const chipList = h(Row, { gap: 8, wrap: true },
    charList.map((c) => h(Chip, {
      key: String(c.id),
      active: String(c.id) === String(activeId),
      title: String(c.id) === String(activeId) ? '当前角色' : '切换到这个角色',
      onClick: () => { switchChar(c.id).catch(() => {}) },
    }, (c.name || '') + (String(c.id) === String(activeId) ? ' · 当前' : ''))),
    charList.length ? null : h(Note, {}, chars.error ? '角色列表读取失败' : '还没有角色'),
  )

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    stgCoreErrBox(readError, persona.reload),

    // 顶部操作条：保存 / 撤销 / 刷新 / 导入导出
    h(Row, { gap: 8, wrap: true, style: { position: 'sticky', top: 0, zIndex: 3, padding: '6px 0', background: T.bg, borderBottom: '1px solid ' + T.border } },
      h('span', { style: { fontSize: 12.5, color: T.text2 } }, '角色卡'),
      h('span', { style: { fontSize: 11, color: T.text3 } }, readOnly ? '读取中…' : '改完点保存；只提交改动过的字段'),
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError || !draft, onClick: resetDraft }, '撤销修改'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError, onClick: reloadAll }, '重新读取'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: exportRole }, '导出角色卡'),
      h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: () => { if (importFile.current) importFile.current.click() } }, '导入角色卡'),
      stgCoreSaveBtn({ disabled: readOnly || busy || !!readError, busy: busy, onClick: saveRole }),
    ),
    h('input', {
      ref: importFile, type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onChange: onImportFile,
    }),

    // 角色列表
    h(Card, {
      title: '角色列表', tag: '多角色：每个角色有自己的记忆、日记和聊天记录', sub: chars.data ? charList.length + ' 个' : '',
      actions: h(Row, { gap: 6 },
        h(Btn, { size: 'sm', kind: 'ghost', disabled: chars.loading, onClick: () => newChar().catch(() => {}) }, '+ 新建角色'),
        h(Btn, { size: 'sm', kind: 'danger', disabled: !!chars.error, onClick: () => deleteChar().catch(() => {}) }, '删除当前角色'),
      ),
    },
      stgCoreErrBox(chars.error, chars.reload),
      chipList,
      activeChar ? h(Note, {}, '当前角色：' + (activeChar.name || '') + '（切换会换人设、记忆、日记和聊天记录）') : null,
    ),

    // 基本信息 + 头像
    h(Card, { title: '基本信息', sub: '角色身份与基本设定' },
      readOnly ? (readError ? null : h(Loading, { text: '读取角色卡…' })) : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 10 } },
        h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', gridColumn: '1 / -1', flexWrap: 'wrap' } },
          h(Avatar, { path: metaAvatar || '', name: (draft && draft.name) || '', size: 64 }),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            h(Row, { gap: 6 },
              h(Btn, { size: 'sm', kind: 'ghost', disabled: avatarBusy, onClick: () => { if (avatarFile.current) avatarFile.current.click() } }, avatarBusy ? '上传中…' : '上传头像'),
              h(Btn, { size: 'sm', kind: 'ghost', disabled: avatarBusy || !metaAvatar, onClick: () => clearAvatar().catch(() => {}) }, '用默认头像'),
            ),
            h(Note, {}, 'png / jpg / webp，最大 3MB；上传后立即生效'),
          ),
          h('input', { ref: avatarFile, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onAvatarFile }),
        ),
        h(Field, { label: '名字' }, h(TextInput, { value: draft.name, onChange: (v) => patch({ name: v }), placeholder: '她的名字' })),
        h(Field, { label: '怎么称呼你' }, h(TextInput, { value: draft.userCall, onChange: (v) => patch({ userCall: v }), placeholder: '例如：你' })),
        h(Field, { label: '关系', hint: '一句话说明她和你的关系' }, h(TextInput, { value: draft.relation, onChange: (v) => patch({ relation: v }) })),
        h(Field, { label: '年龄', hint: '选填；0 或不填都算没填（会影响出行/夜间出门等判断）' }, h(NumInput, { value: draft.age, min: 0, max: 200, step: 1, onChange: (v) => patch({ age: v }), suffix: '岁' })),
        h(Field, { label: '有驾照' }, h(Toggle, { checked: !!draft.license, onChange: (v) => patch({ license: v }), label: draft.license ? '有（可以开车）' : '没有' })),
        h(Field, { label: '出行偏好' }, h(Select, { value: draft.travelPref, onChange: (v) => patch({ travelPref: v }), options: STG_ROLE_TRAVEL_PREFS })),
        h(Field, { label: '模型类型', hint: '舞台用她的形象；本版只有 2D 舞台' }, h(Select, { value: draft.modelType, onChange: (v) => patch({ modelType: v }), options: STG_ROLE_MODEL_TYPES })),
        h(Field, { label: '模型地址', hint: '可留空' }, h(TextInput, { value: draft.modelUrl, onChange: (v) => patch({ modelUrl: v }), placeholder: '模型文件 URL（可留空）', mono: true })),
        h(Field, { label: '模型缩放' }, h(NumInput, { value: draft.modelScale, min: 0.1, max: 3, step: 0.1, onChange: (v) => patch({ modelScale: v }) })),
        h(Field, { label: '2D 表现', hint: '地图和 2D 舞台上的她用什么画' }, h(SkeletonSwitch, {})),
      ),
    ),

    // 人设正文
    h(Card, { title: '人设正文', tag: '会全部注入提示词', sub: draft ? String(draft.body || '').length + ' 字' : '' },
      readOnly ? (readError ? null : h(Loading, { text: '读取人设…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h(TextArea, {
          value: draft.body,
          rows: 14,
          placeholder: '写她是谁、什么性格、怎么说话、有什么生活……',
          onChange: (v) => patch({ body: v }),
          style: { fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.7 },
        }),
        h(Note, {}, '建议 800~1500 字；保存后下一条消息立即生效，不需要重启。'),
      ),
    ),

    // 说话风格示例 + 性格开关
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, minWidth: 0 } },
      h(Card, { title: '说话风格示例', tag: '让她学自己的口气' },
        readOnly ? (readError ? null : h(Loading, { text: '读取…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          (draft.examples || []).map((ex, i) => h(Row, { key: 'ex' + i, gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: ex, onChange: (v) => patch((prev) => ({ examples: (prev.examples || []).map((x, j) => (j === i ? v : x)) })) })),
            h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这条（保存后生效）', onClick: () => patch((prev) => ({ examples: (prev.examples || []).filter((x, j) => j !== i) })) }, '✕'),
          )),
          (draft.examples || []).length ? null : h(Note, {}, '还没有示例句'),
          h(Row, { gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newExample, onChange: setNewExample, placeholder: '加一句她会说的话…', onEnter: addExample })),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: addExample }, '+ 添加'),
          ),
        ),
      ),
      h(Card, { title: '性格开关', tag: '软约束，写进人设', sub: draft ? Object.keys(draft.traits || {}).length + ' 个' : '' },
        readOnly ? (readError ? null : h(Loading, { text: '读取…' })) : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          Object.keys(draft.traits || {}).map((k) => h(Row, { key: 'trait-' + k, gap: 8 },
            h('span', { style: { fontSize: 12.5, color: T.text2, flex: '0 0 84px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: k }, k),
            h('span', { style: { flex: 1, minWidth: 90 } }, h(Slider, { value: draft.traits[k], min: 0, max: 10, step: 1, onChange: (v) => patch((prev) => ({ traits: Object.assign({}, prev.traits || {}, { [k]: stgCoreInt(v, 0, 10, 5) }) })) })),
            h(Btn, { size: 'sm', kind: 'ghost', title: '删掉这个开关（保存后生效）', onClick: () => patch((prev) => { const t = Object.assign({}, prev.traits || {}); delete t[k]; return { traits: t } }) }, '✕'),
          )),
          h(Row, { gap: 6 },
            h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: newTrait, onChange: setNewTrait, placeholder: '新开关名字，例如 话多', onEnter: addTrait })),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: addTrait }, '+ 添加'),
          ),
        ),
      ),
    ),

    // 效果预览
    h(Card, { title: '效果预览', tag: '用已保存的人设实时生成', sub: '消耗少量 token' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        h(Row, { gap: 6 },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(TextInput, { value: previewIn, onChange: setPreviewIn, placeholder: '试一句，比如：今天好累', onEnter: () => { doPreview().catch(() => {}) } })),
          h(Btn, { size: 'sm', kind: 'primary', disabled: previewing, onClick: () => { doPreview().catch(() => {}) } }, previewing ? '生成中…' : '试一句'),
        ),
        previewErr ? h(ErrorBox, { error: previewErr, onRetry: () => { doPreview().catch(() => {}) } }) : null,
        previewOut
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, border: '1px solid ' + T.border, borderRadius: T.radius, padding: '8px 10px', background: T.bg2 } },
              h('div', { style: { fontSize: 11.5, color: T.text3 } }, '你：' + (String(previewIn).trim() || '在吗')),
              h('div', { style: { fontSize: 13, color: T.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, ((prevMeta && prevMeta.name) || '她') + '：' + previewOut),
            )
          : h(Note, {}, '预览用的是「已保存」的人设；刚改完记得先保存。'),
      ),
    ),

    h(Note, {}, '提示：角色卡里的模型类型/地址只影响舞台形象；人设、示例、性格开关都会注入提示词。'),
  )
}

// ───────────────────────── 上下文注入 ─────────────────────────

const STG_CTX_HISTORY_OPTIONS = [
  { value: 'full', label: '完整（最近 30 条）' },
  { value: 'short', label: '精简（最近 8 条 + 摘要）' },
  { value: 'compact', label: '压缩（最近 8 条）' },
  { value: 'minimal', label: '最少（最近 4 条）' },
  { value: 'off', label: '不带历史（最省）' },
]

function stgCoreContextSeed(d) {
  const c = (d && d.context) || {}
  return {
    historyMode: ['full', 'short', 'off', 'compact', 'minimal'].includes(c.historyMode) ? c.historyMode : 'full',
    memoryInject: stgCoreInt(c.memoryInject, 2, 20, 8),
  }
}

function SettingsContextCard() {
  const ctx = useApi('/api/context')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(ctx, stgCoreContextSeed)
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = { historyMode: d.historyMode, memoryInject: stgCoreInt(d.memoryInject, 2, 20, 8) }
    const payload = stgCoreDiff(f.base, next, ['historyMode', 'memoryInject'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/context', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('上下文设置已保存，下一条消息生效')
    f.patch(next)
    ctx.reload()
  })
  const summary = (ctx.data && ctx.data.summary) || null
  return h(Card, {
    title: '上下文注入', sub: '这一轮带多少聊天历史与记忆', tag: '省 token',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!ctx.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(ctx.error, ctx.reload),
    d ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      h(Field, { label: '聊天历史', hint: '精简/压缩会用更少原文、必要时额外生成一次摘要；不带历史最省，但短期连贯性差一点。' },
        h(Select, { value: d.historyMode, onChange: (v) => f.patch({ historyMode: v }), options: STG_CTX_HISTORY_OPTIONS })),
      h(Field, { label: '每轮注入记忆', hint: '2–20 条（默认 8）' },
        h(NumInput, { value: d.memoryInject, min: 2, max: 20, step: 1, onChange: (v) => f.patch({ memoryInject: v }), suffix: '条' })),
      ctx.data && ctx.data.historyKeep ? h(Note, {}, '「精简」档保留最近 ' + ctx.data.historyKeep + ' 条原文。') : null,
      summary && summary.text
        ? h('div', { style: { border: '1px solid ' + T.border, borderRadius: T.radius, background: T.bg2, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 } },
            h('div', { style: { fontSize: 11.5, color: T.text3 } }, '当前历史摘要' + (summary.upto ? '（到第 ' + summary.upto + ' 条）' : '')),
            h('div', { style: { fontSize: 12.5, color: T.text2, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, String(summary.text)),
          )
        : h(Note, {}, '还没有历史摘要（聊得多了才会有）。'),
    ) : (ctx.error ? null : h(Loading, { text: '读取上下文设置…' })),
  )
}

// 记忆标签：上下文卡片 + 记忆管理（条目列表/置顶/删除/导入/遗忘参数，组件在 settings-data.js）+ 说明
function SettingsMemoryTab() {
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },
    h(SettingsContextCard, {}),
    h(SettingsMemoryCard, {}),
    h(Card, { title: '关于记忆', sub: '她记住的东西分三层' },
      h(Note, {}, '· 长期记忆条目：她对你的印象、发生过的事，会按重要度/新近度衰减，强的重要条目会被注入。'),
      h(Note, {}, '· 聊天历史：上面「聊天历史」档位决定这一轮带多少原文；太省 token 会让她记不住刚说过的话。'),
      h(Note, {}, '· 日记/摘要：她每天写日记，历史被精简时会用摘要补上下文；日记本身在「数据」标签里查看/生成。'),
      h(Note, {}, '· 上面的记忆列表：「置顶」= 放进核心记忆（永不遗忘）；「取消置顶」= 回到普通记忆按清晰度衰减；删除后她就不会再记得这件事。'),
    ),
  )
}

// ───────────────────────── 经济 / 零花钱 ─────────────────────────

const STG_ECON_KEYS = ['enabled', 'initialBalance', 'dailyIncome', 'wagePerHour', 'mealCost', 'entertainmentCost', 'moneyType', 'tokenBudget', 'tokensPerYuan']
const STG_ECON_MONEY_TYPES = [
  { value: 'virtual', label: '虚拟货币（自己设数值）' },
  { value: 'token', label: 'Token 实时预算（按剩余 token 折算）' },
]

function stgCoreEconomySeed(d) {
  const e = (d && d.economy) || {}
  return {
    enabled: e.enabled !== false,
    initialBalance: stgCoreNum(e.initialBalance, 0, 1000000, 200),
    dailyIncome: stgCoreNum(e.dailyIncome, 0, 100000, 20),
    wagePerHour: stgCoreNum(e.wagePerHour, 0, 100000, 15),
    mealCost: stgCoreNum(e.mealCost, 0, 100000, 12),
    entertainmentCost: stgCoreNum(e.entertainmentCost, 0, 100000, 30),
    moneyType: e.moneyType === 'token' ? 'token' : 'virtual',
    tokenBudget: stgCoreNum(e.tokenBudget, 0, 100000000, 2000000),
    tokensPerYuan: stgCoreNum(e.tokensPerYuan, 0, 1000000, 1000),
  }
}

function stgCoreFmtInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  try { return Math.round(n).toLocaleString('zh-CN') } catch (e) { return String(Math.round(n)) }
}

function SettingsEconomyCard() {
  const econ = useApi('/api/economy')
  const [busy, run] = stgCoreBusy()
  const f = stgCoreDraft(econ, stgCoreEconomySeed)
  const d = f.draft
  const wallet = (econ.data && econ.data.wallet) || null
  const real = (econ.data && econ.data.realBalance) || null
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      initialBalance: stgCoreNum(d.initialBalance, 0, 1000000, 0),
      dailyIncome: stgCoreNum(d.dailyIncome, 0, 100000, 0),
      wagePerHour: stgCoreNum(d.wagePerHour, 0, 100000, 0),
      mealCost: stgCoreNum(d.mealCost, 0, 100000, 0),
      entertainmentCost: stgCoreNum(d.entertainmentCost, 0, 100000, 0),
      moneyType: d.moneyType === 'token' ? 'token' : 'virtual',
      tokenBudget: stgCoreNum(d.tokenBudget, 0, 100000000, 0),
      tokensPerYuan: stgCoreNum(d.tokensPerYuan, 0, 1000000, 0),
    }
    const payload = stgCoreDiff(f.base, next, STG_ECON_KEYS)
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/economy', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('经济设置已保存')
    f.patch(next)
    econ.reload()
  })
  const spendable = wallet ? (wallet.spendable === undefined ? wallet.balance : wallet.spendable) : null
  return h(Card, {
    title: '经济 / 零花钱', sub: '她自己的钱包（不是你的 DeepSeek 余额）',
    actions: stgCoreSaveBtn({ disabled: !d || busy || !!econ.error, busy: busy, onClick: save }),
  },
    stgCoreErrBox(econ.error, econ.reload),
    wallet ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8 } },
      h(KV, { k: '可用零花', v: fmtMoney(spendable, 0) + ' 元' }),
      h(KV, { k: '计费口径', v: wallet.tokenMode ? 'Token 预算折算' : '虚拟货币' }),
      wallet.tokenMode ? h(KV, { k: '剩余 token', v: stgCoreFmtInt(wallet.remainingTokens) }) : null,
      h(KV, { k: '今日 token', v: stgCoreFmtInt(wallet.dailyUsed) }),
      real && real.ok ? h(KV, { k: '你的 DeepSeek 余额', v: '¥' + fmtMoney(real.total) }) : null,
      real && real.ok ? h(KV, { k: '今日你的消耗', v: '¥' + fmtMoney(real.todayRmb) }) : null,
    ) : null,
    real && real.ok === false && real.error ? h(Note, {}, '真实余额读取失败：' + real.error) : null,
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 } },
      h(Field, { label: '启用经济' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开着（会花钱/赚钱）' : '关掉（不扣钱）' })),
      h(Field, { label: '初始余额', hint: '新角色/重置时用' }, h(NumInput, { value: d.initialBalance, min: 0, max: 1000000, step: 10, onChange: (v) => f.patch({ initialBalance: v }), suffix: '元' })),
      h(Field, { label: '每日零花钱' }, h(NumInput, { value: d.dailyIncome, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ dailyIncome: v }), suffix: '元/天' })),
      h(Field, { label: '工作时薪', hint: '上班/工作作息时赚' }, h(NumInput, { value: d.wagePerHour, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ wagePerHour: v }), suffix: '元/时' })),
      h(Field, { label: '吃饭开销' }, h(NumInput, { value: d.mealCost, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ mealCost: v }), suffix: '元/顿' })),
      h(Field, { label: '娱乐开销' }, h(NumInput, { value: d.entertainmentCost, min: 0, max: 100000, step: 1, onChange: (v) => f.patch({ entertainmentCost: v }), suffix: '元/次' })),
      h(Field, { label: '货币类型' }, h(Select, { value: d.moneyType, onChange: (v) => f.patch({ moneyType: v }), options: STG_ECON_MONEY_TYPES })),
      h(Field, { label: 'Token 预算' }, h(NumInput, { value: d.tokenBudget, min: 0, max: 100000000, step: 100000, onChange: (v) => f.patch({ tokenBudget: v }), suffix: 'tokens' })),
      h(Field, { label: '1 元 = 多少 token' }, h(NumInput, { value: d.tokensPerYuan, min: 0, max: 1000000, step: 100, onChange: (v) => f.patch({ tokensPerYuan: v }), suffix: 'tokens' })),
    ) : null,
    h(Note, {}, '充值口径：她的「零花」是插件里独立的虚拟钱包（交通、吃饭、娱乐都从这里扣），'),
    h(Note, {}, '和你在 DeepSeek 平台充的钱不是同一笔；Token 模式只是把零花按「剩余 token ÷ 每元 token 数」折算显示。'),
  )
}

// 低余额提醒（她主动提醒你充值；属于经济设置的一部分）
function SettingsBalanceAlertCard() {
  const api = useApi('/api/balance-alert')
  const [busy, run] = stgCoreBusy()
  const [testing, setTesting] = React.useState(false)
  const f = stgCoreDraft(api, (d) => {
    const a = (d && d.alert) || {}
    return {
      enabled: a.enabled !== false,
      thresholdRmb: stgCoreNum(a.thresholdRmb, 0, 10000, 5),
      cooldownMin: stgCoreInt(a.cooldownMin, 1, 10080, 360),
    }
  })
  const d = f.draft
  const save = () => run(async () => {
    if (!d || !f.base) return
    const next = {
      enabled: !!d.enabled,
      thresholdRmb: stgCoreNum(d.thresholdRmb, 0, 10000, 5),
      cooldownMin: stgCoreInt(d.cooldownMin, 1, 10080, 360),
    }
    const payload = stgCoreDiff(f.base, next, ['enabled', 'thresholdRmb', 'cooldownMin'])
    if (!stgCoreHas(payload)) { toast('没有改动'); return }
    const r = await Api.post('/api/balance-alert', payload)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('低余额提醒已保存')
    f.patch(next)
    api.reload()
  })
  const sendTest = async () => {
    const ok = await confirmDialog('真的让她发一条低余额提醒？', {
      title: '发一条测试',
      detail: '她会把提醒消息真的发到聊天里（会消耗少量 token）。',
      okText: '发一条',
    })
    if (!ok) return
    setTesting(true)
    try {
      const r = await Api.post('/api/balance-alert/test', {})
      if (!r.ok) { toast('发送失败：' + (r.error || '未知错误'), 'error'); return }
      if (r.data && r.data.ok) toast('已发送：' + String(r.data.text || '').slice(0, 40))
      else toast('没有发送：' + ((r.data && r.data.error) || '余额读数不可用'), 'error')
      api.reload()
    } finally {
      setTesting(false)
    }
  }
  const lastAt = api.data && api.data.alert && api.data.alert.lastAt
  return h(Card, {
    title: '低余额提醒', sub: '余额低于阈值时她主动提醒你充值',
    actions: h(Row, { gap: 6 },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: testing || !d, onClick: () => { sendTest().catch(() => {}) } }, testing ? '发送中…' : '发一条测试'),
      stgCoreSaveBtn({ disabled: !d || busy || !!api.error, busy: busy, onClick: save }),
    ),
  },
    stgCoreErrBox(api.error, api.reload),
    d ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 } },
      h(Field, { label: '开启提醒' }, h(Toggle, { checked: !!d.enabled, onChange: (v) => f.patch({ enabled: v }), label: d.enabled ? '开' : '关' })),
      h(Field, { label: '阈值', hint: '低于这个金额就提醒' }, h(NumInput, { value: d.thresholdRmb, min: 0, max: 10000, step: 0.5, onChange: (v) => f.patch({ thresholdRmb: v }), suffix: '元' })),
      h(Field, { label: '冷却', hint: '避免刷屏' }, h(NumInput, { value: d.cooldownMin, min: 1, max: 10080, step: 30, onChange: (v) => f.patch({ cooldownMin: v }), suffix: '分钟' })),
    ) : (api.error ? null : h(Loading, { text: '读取提醒设置…' })),
    lastAt ? h(Note, {}, '上次提醒：' + fmtDateTime(lastAt)) : null,
  )
}

// 2D 表现开关：骨骼角色（会动） / 静态头像图。存 localStorage，地图/舞台立即跟着变。
function SkeletonSwitch() {
  const [on, setOn] = React.useState(skeletonEnabled())
  return h(Toggle, {
    checked: on,
    onChange: (v) => { setOn(v); setSkeletonEnabled(v) },
    label: on ? '骨骼角色（会动）' : '静态头像图（省内存）',
  })
}

// (anchor fallback)