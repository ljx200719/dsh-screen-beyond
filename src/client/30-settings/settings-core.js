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
  { value: '3d', label: '3D 模型（GLB / glTF，3D 舞台用）' },
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

// 头像缩成小方块塞进角色卡（F-016）：128px JPEG，base64 后约 7~15KB，不会把卡撑成几 MB
function stgCoreAvatarToSmallDataUrl(src, size) {
  return new Promise((resolve) => {
    const fail = () => { resolve('') }
    try {
      if (!src) { fail(); return }
      const img = new Image()
      img.onload = () => {
        try {
          const n = Math.max(32, Math.min(256, Number(size) || 128))
          const sw = img.naturalWidth || img.width || n
          const sh = img.naturalHeight || img.height || n
          const side = Math.min(sw, sh)
          const c = document.createElement('canvas')
          c.width = n
          c.height = n
          const g = c.getContext('2d')
          if (!g) return fail()
          g.drawImage(img, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, n, n)
          resolve(c.toDataURL('image/jpeg', 0.86))
        } catch (e) { fail() }
      }
      img.onerror = fail
      img.src = src
    } catch (e) { fail() }
  })
}

// 角色卡里的头像字段：只认 data:image/*;base64（不接受远程 URL / 本地路径，免得导入别人的卡时去联网）
function stgCoreCardAvatar(v) {
  const s = String(v || '').trim()
  if (!s) return ''
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) return ''
  if (s.length > 2.2 * 1024 * 1024) return ''
  return s
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

  // F-012：滚动后顶栏收成「只有保存按钮」的一条，滚回顶部再展开；
  // 用哨兵 + IntersectionObserver 判断，不监听 scroll（不跟滚动条抢帧）。
  const roleBarSentinelRef = React.useRef(null)
  const [compactBar, setCompactBar] = React.useState(false)
  React.useEffect(() => {
    const el = roleBarSentinelRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return undefined
    let io = null
    try {
      io = new IntersectionObserver((ents) => {
        const e = ents && ents[0]
        if (e) setCompactBar(!e.isIntersecting)
      }, { threshold: 0, rootMargin: '-4px 0px 0px 0px' })
      io.observe(el)
    } catch (err) {}
    return () => { try { if (io) io.disconnect() } catch (e) {} }
  }, [])
  // 回到这张卡的开头：往上找最近的可滚动祖先
  const scrollRoleTop = () => {
    try {
      let n = roleBarSentinelRef.current
      while (n && n !== document.body) {
        const st = window.getComputedStyle(n)
        if (st && (st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight) {
          n.scrollTo ? n.scrollTo({ top: 0, behavior: 'smooth' }) : (n.scrollTop = 0)
          return
        }
        n = n.parentElement
      }
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (e) {}
  }

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
  const exportRole = async () => {
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
    // 头像是可选字段（F-016）：只有用户自己传过的头像才问，默认带头像（同尺寸 128px 小图）
    const curAvatar = (persona.data && persona.data.meta && persona.data.meta.avatar) || ''
    const hasCustomAvatar = !!curAvatar && curAvatar.indexOf('/default-avatar.png') === -1
    let withAvatar = false
    if (hasCustomAvatar) {
      withAvatar = await confirmDialog('把头像也放进角色卡？', {
        title: '导出角色卡',
        detail: '会附一张 128px 的小头像（约十几 KB，base64 内嵌在 JSON 里）。不带的话导入方只能看到默认图标。',
        okText: '带头像导出',
        cancelText: '不带',
      })
      if (withAvatar) {
        const small = await stgCoreAvatarToSmallDataUrl(curAvatar, 128)
        if (small) payload.avatar = small
        else toast('头像读取失败，这张卡不带头像', 'error')
      }
    }
    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = (String(draft.name || 'persona').trim() || 'persona') + '-角色卡.json'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => { try { URL.revokeObjectURL(a.href); a.remove() } catch (e) {} }, 1500)
      toast(payload.avatar ? '角色卡已导出（含头像）' : '角色卡已导出')
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
    // 头像兼容两种写法：顶层 avatar（本版导出格式）/ meta.avatar（手工做的卡）
    const cardAvatar = stgCoreCardAvatar(j.avatar) || stgCoreCardAvatar(src.avatar)
    const ok = await confirmDialog('用这张角色卡覆盖当前角色？', {
      title: '导入角色卡',
      detail: '会覆盖：名字、称呼、关系、年龄、说话示例、性格开关、模型设置、人设正文。'
        + (cardAvatar ? '头像也会一起换成卡里带的这张。' : '这张卡没带头像，导入后可以手动上传。'),
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
    if (!stgCoreHas(payload) && !cardAvatar) { toast('角色卡里没有可导入的字段', 'error'); return }
    if (stgCoreHas(payload)) {
      const r = await Api.post('/api/persona', payload)
      if (!r.ok) { toast('导入失败：' + (r.error || '未知错误'), 'error'); return }
    }
    // 头像单独走 /api/avatar（meta 里不收 avatar，会被服务端剥掉）
    if (cardAvatar) {
      const rv = await Api.upload('/api/avatar', { dataUrl: cardAvatar })
      if (!rv.ok) toast('人设已导入，但头像没换成功：' + (rv.error || '未知错误'), 'error')
    }
    toast(cardAvatar ? '角色卡已导入（含头像）' : '角色卡已导入 · 这张卡没带头像，可在上面「头像」里传一张')
    // F-006：导入改的是「当前角色」，所以列表 chip、当前角色名、页头都要一起刷新（原来只刷了 persona）
    reloadAll()
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
    // F-012：滚动时收成一条窄的保存条（只留按钮），滚回顶部再展开；背景用玻璃 + 下阴影，
    // 不再用整块不透明底色把下面的卡片标题/说明「吃掉」。
    h('div', { ref: roleBarSentinelRef, style: { height: 1, marginTop: -1, marginBottom: -1 } }),
    h(Row, {
      gap: 8,
      wrap: true,
      style: {
        position: 'sticky',
        top: 0,
        zIndex: 5,
        padding: compactBar ? '4px 0' : '6px 0',
        marginTop: 0,
        background: paintGlass(T.bg1, 0.92),
        borderBottom: '1px solid ' + T.border,
        boxShadow: compactBar ? '0 6px 14px -10px rgba(0,0,0,.55)' : 'none',
        transition: 'padding .14s ease, box-shadow .14s ease',
      },
    },
      compactBar ? null : h('span', { style: { fontSize: 12.5, color: T.text2 } }, '角色卡'),
      compactBar ? null : h('span', { style: { fontSize: 11, color: T.text3 } }, readOnly ? '读取中…' : '改完点保存；只提交改动过的字段'),
      h('span', { style: { flex: 1 } }),
      compactBar ? null : h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError || !draft, onClick: resetDraft }, '撤销修改'),
      compactBar ? null : h(Btn, { size: 'sm', kind: 'ghost', disabled: !!readError, onClick: reloadAll }, '重新读取'),
      compactBar ? null : h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: exportRole }, '导出角色卡'),
      compactBar ? null : h(Btn, { size: 'sm', kind: 'ghost', disabled: !draft, onClick: () => { if (importFile.current) importFile.current.click() } }, '导入角色卡'),
      stgCoreSaveBtn({ disabled: readOnly || busy || !!readError, busy: busy, onClick: saveRole }),
      compactBar ? h(Btn, { size: 'sm', kind: 'ghost', title: '回到这张卡的开头', onClick: scrollRoleTop }, '↑ 顶部') : null,
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
    h(Card, { title: '面板配色', sub: '亮/暗和主色都能调；改完立即生效，不用重启', tag: '影响整个面板' }, h(ThemeCard, {})),
    h(Card, { title: '语音', sub: '她说话：一个能用的声音 + 留给你自己的接口', tag: '0.8.7' }, h(VoiceCard, {})),
    h(Card, { title: '外观美化', sub: '可选：给舞台/地图空白处加背景美化，关闭就是现在的简洁样式', tag: '可开关' }, h(PaintCard, {})),
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
        h(Field, { label: '模型类型', hint: '舞台 3D 分支用她的形象；没有模型就退回立绘/程序化小人' }, h(Select, { value: draft.modelType, onChange: (v) => patch({ modelType: v }), options: STG_ROLE_MODEL_TYPES })),
        h(Field, { label: '模型地址', hint: '填 /models/xxx.glb（插件自带：/models/xiaojing-3d.glb）；留空则不用模型' }, h(TextInput, { value: draft.modelUrl, onChange: (v) => patch({ modelUrl: v }), placeholder: '/models/xxx.glb', mono: true })),
        h(Field, { label: '模型缩放' }, h(NumInput, { value: draft.modelScale, min: 0.1, max: 3, step: 0.1, onChange: (v) => patch({ modelScale: v }) })),
        h(Field, { label: '2D 表现', hint: '地图和 2D 舞台上的她用什么画' }, h(SkeletonSwitch, {})),
        h(Field, { label: '地图动作速度', hint: '她在图上走动/动画的快慢' }, h(MapSpeedChips, {})),
        h(Field, { label: '导入 2D 姿态素材', hint: '把你自己的角色姿态图导进来（同一尺寸、透明背景）' }, h(PoseImporter, {})),
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

// 地图动作速度：慢 / 标准 / 快（localStorage，地图上的走路动画与位移跟着变）
function MapSpeedChips() {
  const [v, setV] = React.useState(typeof mapSpeed === 'function' ? mapSpeed() : 1)
  const opts = [{ v: 0.6, label: '慢' }, { v: 1, label: '标准' }, { v: 1.6, label: '快' }]
  return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
    opts.map((o) => h(Chip, {
      key: 'spd-' + o.v,
      active: Math.abs(v - o.v) < 0.01,
      onClick: () => {
        setV(o.v)
        if (typeof setMapSpeed === 'function') setMapSpeed(o.v)
      },
    }, o.label)),
  )
}

// 导入 2D 姿态素材：顾客自己的角色图，命名 idle/walkA/walkB/wave/stretch/sleepy/happy，
// 同一尺寸 + 透明背景；调 /api/stage/import-poses 存进当前角色的 skeleton-assets。
function PoseImporter() {
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  const inputRef = React.useRef(null)
  const onFiles = async (ev) => {
    const list = Array.from(ev.target.files || [])
    ev.target.value = ''
    if (!list.length) return
    setBusy(true)
    setMsg('读取图片…')
    try {
      const files = await Promise.all(list.map((f) => new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => {
          const img = new Image()
          img.onload = () => resolve({ name: f.name, dataUrl: String(r.result), w: img.naturalWidth, h: img.naturalHeight })
          img.onerror = () => reject(new Error(f.name + ' 不是有效图片'))
          img.src = String(r.result)
        }
        r.onerror = () => reject(new Error('读取 ' + f.name + ' 失败'))
        r.readAsDataURL(f)
      })))
      setMsg('上传中…')
      const resp = await Api.post('/api/stage/import-poses', { files })
      const data = (resp && (resp.data || resp.json)) || {}
      if (resp && resp.ok && data.ok) {
        setMsg('已导入：' + (data.saved || []).join('、') + '（刷新面板后地图上生效）')
        toast('姿态素材已导入', 'ok')
      } else {
        setMsg((data && data.error) || (resp && resp.error) || '导入失败')
      }
    } catch (e) {
      setMsg(String((e && e.message) || e))
    }
    setBusy(false)
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
    h(Row, { gap: 6 },
      h(Btn, { size: 'sm', disabled: busy, onClick: () => { if (inputRef.current) inputRef.current.click() } }, busy ? '导入中…' : '选择图片导入'),
      h('input', {
        ref: inputRef, type: 'file', multiple: true,
        accept: 'image/png,image/jpeg,image/webp',
        style: { display: 'none' }, onChange: onFiles,
      }),
    ),
    h(Note, {}, '文件名用 idle / walkA / walkB / wave / stretch / sleepy / happy（png/jpg/webp），必须全部同一尺寸、透明背景；只导 idle 就只会有待机。导入后刷新面板生效。'),
    msg ? h('div', { style: { fontSize: 11, color: T.text2, lineHeight: 1.6 } }, msg) : null,
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

// 语音：总开关 + provider（sapi/http）+ 试听。不做训练/克隆（V-D14），音色由用户自己接。
function VoiceCard() {
  const voice = useVoiceSettings()
  const s = voice.settings || SBC_VOICE_DEFAULTS
  const [busy, setBusy] = React.useState('')
  const [msg, setMsg] = React.useState('')
  const [audioUrl, setAudioUrl] = React.useState('')
  const [autoSpeak, setAutoSpeak] = useLocal('companionVoiceAutoplay', true)
  // 语音输入（0.8.8）：借 DSH 自带的 SenseVoice，本插件不带模型
  const [speechNote, setSpeechNote] = React.useState('')
  const [speechErr, setSpeechErr] = React.useState('')
  const [speechBusy, setSpeechBusy] = React.useState(false)
  const prepareSpeech = async () => {
    setSpeechBusy(true)
    setSpeechErr('')
    setSpeechNote('正在检查识别器…')
    const r = await sbcSpeechEnsureReady((m) => setSpeechNote(m))
    setSpeechBusy(false)
    if (!r.ok) { setSpeechErr(r.error); setSpeechNote(''); return }
    setSpeechNote('识别器已就绪：' + r.providerId)
  }
  const [draft, setDraft] = React.useState({ voice: '', endpoint: '', apiKeyRef: '', appId: '', cluster: 'volcano_tts', resourceId: 'seed-tts-2.0', model: 'tts-1' })
  React.useEffect(() => {
    setDraft({
      voice: s.voice || '',
      endpoint: s.endpoint || '',
      apiKeyRef: s.apiKeyRef || '',
      appId: s.appId || '',
      cluster: s.cluster || 'volcano_tts',
      resourceId: s.resourceId || 'seed-tts-2.0',
      model: s.model || 'tts-1',
    })
  }, [s.voice, s.endpoint, s.apiKeyRef, s.appId, s.cluster, s.resourceId, s.model])
  const draftKey = ['voice', 'endpoint', 'apiKeyRef', 'appId', 'cluster', 'resourceId', 'model']
  const dirty = draftKey.some((k) => String(draft[k] || '') !== String(s[k] || (k === 'cluster' ? 'volcano_tts' : k === 'resourceId' ? 'seed-tts-2.0' : k === 'model' ? 'tts-1' : '')))
  const save = async (patch) => {
    setBusy('save')
    setMsg('')
    const r = await saveVoiceSettings(patch)
    setBusy('')
    if (!r.ok) setMsg(r.error || '保存失败')
  }
  const preview = async () => {
    if (busy) return
    setBusy('preview')
    setMsg('')
    const r = await Api.post('/api/voice/preview', {})
    setBusy('')
    const d = (r && r.data) || {}
    if (!r || !r.ok || d.ok !== true) { setMsg(d.error || (r && r.error) || '试听失败'); return }
    const url = await Api.fileUrl(d.audio, { bust: Date.now() })
    setAudioUrl(url)
    setMsg(d.fallbackFrom
      ? ('当前通道 ' + d.fallbackFrom + ' 不可用，已自动改用 Windows 内置语音试听。建议点下面「改用 Windows 内置语音」。')
      : (d.cached ? '已生成（命中缓存）' : ('已生成' + (d.duration ? '：' + Math.round(d.duration) + ' 秒' : ''))))
    try { await new Audio(url).play() } catch (e) { setMsg((d.cached ? '已生成（命中缓存）' : '已生成') + '，但浏览器没让自动播，点「再播一次」') }
  }
  const replay = async () => {
    if (!audioUrl) return
    try { await new Audio(audioUrl).play() } catch (e) { setMsg('浏览器没让播，先点一下页面再试') }
  }
  const isVolc = s.provider === 'volc'
  const isOpenAI = s.provider === 'openai'
  const isHttp = s.provider === 'http'
  const isSapi = s.provider === 'sapi'
  const voiceHint = isVolc ? '火山 voice_type，例 zh_female_shuangkuaisisi_moon_bigtts'
    : isOpenAI ? '例 alloy / echo / nova（看服务商）'
      : isHttp ? '服务商要求的音色名'
        : '留空 = 系统默认中文音色'
  const providerOptions = (voice.providers && voice.providers.length ? voice.providers : [{ id: 'sapi', name: 'Windows 内置语音（离线、免 Key）' }])
    .map((p) => ({ value: p.id, label: p.name }))
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h(Field, { label: '她说话', hint: '打开后她的每条回复会带一条语音' },
      h(Toggle, { checked: !!s.enabled, onChange: (v) => save({ enabled: v }), label: s.enabled ? '已开启' : '已关闭' })),
    h(Field, { label: '说完自动读出来', hint: '新消息一到就自动播；历史消息仍然只在你点播放时读（关掉=全部手点）' },
      h(Toggle, { checked: !!autoSpeak, onChange: setAutoSpeak, label: autoSpeak ? '自动读' : '只在我点时读' })),
    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 } },
      h(Field, { label: '声音来源' }, h(Select, { value: s.provider, options: providerOptions, onChange: (v) => save({ provider: v }) })),
      h(Field, { label: '音色', hint: voiceHint },
        h(TextInput, { value: draft.voice, placeholder: isVolc ? 'zh_female_shuangkuaisisi_moon_bigtts' : (isOpenAI ? 'alloy' : '留空即可'), mono: isVolc || isOpenAI, onChange: (v) => setDraft((d) => Object.assign({}, d, { voice: v })) })),
      h(Field, { label: '语速', hint: '0.5 ~ 2.0' },
        h(NumInput, { value: s.speed, min: 0.5, max: 2, step: 0.1, onChange: (v) => save({ speed: v }) })),
      h(Field, { label: '单条最长', hint: '超过就截断，不整段念出来' },
        h(NumInput, { value: s.maxChars, min: 20, max: 2000, step: 10, onChange: (v) => save({ maxChars: v }), suffix: '字' })),
    ),
    isVolc
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 11px', borderRadius: 10, border: '1px dashed ' + T.border } },
          h(Field, { label: 'App ID', hint: '新版控制台「服务管理」标题旁的 APP ID；旧版控制台的 App ID 也填这' },
            h(TextInput, { value: draft.appId, placeholder: '1234567890', mono: true, onChange: (v) => setDraft((d) => Object.assign({}, d, { appId: v })) })),
          h(Field, { label: 'Key 引用', hint: '新版控制台「API Key」生成的 Key；只存引用：env:VOLC_TTS_TOKEN 或 file:密钥文件路径' },
            h(TextInput, { value: draft.apiKeyRef, placeholder: 'env:VOLC_TTS_TOKEN', mono: true, onChange: (v) => setDraft((d) => Object.assign({}, d, { apiKeyRef: v })) })),
          h(Field, { label: '资源 ID', hint: '语音合成2.0 用 seed-tts-2.0；留空则走旧版 v1（需要 App ID + Access Token + cluster）' },
            h(TextInput, { value: draft.resourceId, placeholder: 'seed-tts-2.0', mono: true, onChange: (v) => setDraft((d) => Object.assign({}, d, { resourceId: v })) })),
          h(Note, {}, '音色要注意版本：2.0 的音色以 _uranus_bigtts 结尾（如 zh_female_gaolengyujie_uranus_bigtts），1.0 的是 _moon_bigtts——资源 ID 和音色版本不匹配会报「resource ID is mismatched with speaker related resource」。'),
        )
      : null,
    (isOpenAI || isHttp)
      ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '9px 11px', borderRadius: 10, border: '1px dashed ' + T.border } },
          h(Field, {
            label: isOpenAI ? '服务地址（base URL）' : 'TTS 服务地址',
            hint: isOpenAI ? '例如 https://api.openai.com/v1（自动拼 /audio/speech）' : '约定：POST {text,voice,speed,pitch,format}，直接回音频二进制（mp3/wav/ogg）',
          },
            h(TextInput, {
              value: draft.endpoint,
              placeholder: isOpenAI ? 'https://api.openai.com/v1' : 'http://127.0.0.1:9880/tts',
              mono: true,
              onChange: (v) => setDraft((d) => Object.assign({}, d, { endpoint: v })),
            })),
          isOpenAI
            ? h(Field, { label: '模型', hint: 'tts-1 / gpt-4o-mini-tts / 服务商自定' },
                h(TextInput, { value: draft.model, placeholder: 'tts-1', mono: true, onChange: (v) => setDraft((d) => Object.assign({}, d, { model: v })) }))
            : null,
          h(Field, { label: '密钥引用', hint: '只存引用：env:变量名 或 file:密钥文件路径；明文别填这里' },
            h(TextInput, { value: draft.apiKeyRef, placeholder: 'env:TTS_KEY', mono: true, onChange: (v) => setDraft((d) => Object.assign({}, d, { apiKeyRef: v })) })),
          h(Note, {}, isOpenAI
            ? 'OpenAI 兼容的 /audio/speech：OpenAI、SiliconFlow 等都能接。注意：火山方舟（Ark）目前没有这个路由，Ark 的 Key 用不了。'
            : '这个口子是留给你的：GPT-SoVITS 的 api_v2、CosyVoice 自建服务都能接，插件不认具体模型，只转发文本。'),
        )
      : null,
    h(Row, { gap: 8, wrap: true },
      dirty ? h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy, onClick: () => save(draft) }, '保存音色设置') : null,
      h(Btn, { size: 'sm', disabled: !!busy, onClick: () => { void preview() } }, busy === 'preview' ? '合成中…' : '试听'),
      audioUrl ? h(Btn, { size: 'sm', kind: 'ghost', onClick: () => { void replay() } }, '再播一次') : null,
      !isSapi
        ? h(Btn, {
            size: 'sm', kind: 'ghost', disabled: !!busy,
            title: '不用等云端通道修好，先用 Windows 内置语音',
            onClick: () => { save({ provider: 'sapi' }).catch(() => {}) },
          }, '改用 Windows 内置语音')
        : null,
      voice.cache ? h('span', { style: { fontSize: 11, color: T.text3 } }, '缓存 ' + (voice.cache.count || 0) + ' 条 · ' + fmtBytes(voice.cache.total || 0)) : null,
      msg ? h('span', { style: { fontSize: 11, color: T.text2 } }, msg) : null,
    ),
    isVolc
      ? h(Note, {}, '⚠ 火山通道如果资源 ID / 音色不匹配，会报 45000030；试听或回复失败时插件会自动回退 Windows 内置语音，也可以直接点「改用 Windows 内置语音」先恢复。')
      : null,
    h(Note, {}, '第一版只有一个能用的声音：Windows 自带的离线语音（不用 Key、不联网）。想要更好的音色，把「声音来源」换成你自己的 TTS 服务；训练 / 克隆这类事插件不做，留给你在外面自己搞。'),
    h(Note, {}, '「她主动看屏幕并说一句」的子开关在：设置 → 生活 → 环境权限 →「她自己看你的屏幕」（默认关，需要「你的电脑」权限）。'),
    // 语音输入：用 DSH 自带的 SenseVoice（0.8.8 接回来的），插件不打包模型
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 11px', borderRadius: 10, border: '1px dashed ' + T.border } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
        h('span', { style: { fontSize: 12.5, color: T.text, fontWeight: 600 } }, '语音输入（你说话）'),
        h('span', { style: { fontSize: 11, color: T.text3 } }, '用 DSH 自带的 SenseVoice，聊天输入区的 🎤 点一下就能用'),
      ),
      h(Row, { gap: 8, wrap: true },
        h(Btn, { size: 'sm', disabled: speechBusy, onClick: () => { void prepareSpeech() } }, speechBusy ? '准备中…' : '检查 / 准备识别模型'),
        speechNote ? h('span', { style: { fontSize: 11, color: T.text2 } }, speechNote) : null,
        speechErr ? h('span', { style: { fontSize: 11, color: T.danger } }, speechErr) : null,
      ),
      h(Note, {}, '模型由 DSH 管（首次约 228MB，会自动走 hf-mirror 镜像），本插件不打包也不存第二份。'),
      h(Note, {}, 'DSH 大版本升级后如果这里报「没启用或版本不匹配」，说明 profile 里 pin 的语音插件版本落后了，让我同步一次版本即可。'),
    ),
  )
}

// 面板配色：配色模式 + 强调色（存运行时 CONFIG.panelTheme；改完派发 sbc-panel-theme-changed 立即生效）
function ThemeCard() {
  const theme = usePanelTheme()
  const detected = useScheme()
  const effective = sbcEffectiveScheme(theme, detected)
  const [busy, setBusy] = React.useState(false)
  const [msg, setMsg] = React.useState('')
  const save = async (patch) => {
    // F-011：切模式不能把强调色丢掉 —— 每次都把 mode + accent 成对提交，成功后直接用服务端回读值
    const next = Object.assign({ mode: theme.mode, accent: theme.accent }, patch || {})
    setBusy(true)
    setMsg('')
    const r = await Api.post('/api/panel-theme', { mode: next.mode, accent: next.accent })
    setBusy(false)
    if (r.ok) {
      const cur = r.data && r.data.current
      if (cur && (cur.mode !== theme.mode || cur.accent !== theme.accent)) {
        try { sbcThemeSet(cur) } catch (e) {}
      }
      try { window.dispatchEvent(new Event('sbc-panel-theme-changed')) } catch (e) {}
    } else setMsg(r.error || '保存失败')
  }
  const modeChips = SBC_THEME_MODES.map((m) => h(Chip, {
    key: m.key,
    active: theme.mode === m.key,
    title: m.hint,
    onClick: busy ? undefined : () => save({ mode: m.key }),
  }, m.label))
  const swatches = SBC_ACCENTS.map((a) => h('button', {
    key: a.id,
    type: 'button',
    title: a.name,
    disabled: busy || undefined,
    onClick: () => save({ accent: a.id }),
    style: {
      width: 26, height: 26, borderRadius: 999, padding: 0,
      cursor: busy ? 'default' : 'pointer',
      background: a.color, border: 'none',
      boxShadow: theme.accent === a.id
        ? '0 0 0 2px ' + T.bg1 + ', 0 0 0 4px ' + a.color
        : 'inset 0 0 0 1px rgba(127,127,127,.35)',
      opacity: busy ? 0.6 : 1,
    },
  }))
  const accentName = (SBC_ACCENTS.filter((a) => a.id === theme.accent)[0] || SBC_ACCENTS[0]).name
  const modeName = (SBC_THEME_MODES.filter((m) => m.key === theme.mode)[0] || SBC_THEME_MODES[0]).label
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
    h(Field, { label: '配色模式', hint: '「跟随 DSH」= DSH 切亮/暗面板跟着变；固定浅色/深色只影响这个面板' },
      h(Row, { gap: 6 }, modeChips)),
    h(Field, { label: '强调色', hint: '按钮、选中态、开关、她的气泡这些「主色」位置' },
      h(Row, { gap: 8 }, swatches,
        h('span', { style: { fontSize: 11.5, color: T.text3, marginLeft: 2 } }, accentName))),
    // 预览：直接看当前配色的文字/主按钮对比够不够
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 12, border: '1px solid ' + T.border, background: T.bg2 } },
      h('span', { style: { fontSize: 12.5, color: T.text, fontWeight: 600 } }, '预览：她就在这里'),
      h('span', { style: { fontSize: 11.5, color: T.text2 } }, '次要文字'),
      h('span', { style: { fontSize: 11, color: T.text3 } }, '提示文字'),
      h('span', { style: { marginLeft: 'auto' } }),
      h('span', { style: { fontSize: 12, lineHeight: '18px', padding: '3px 11px', borderRadius: 8, background: T.brand, color: T.accentInk } }, '主按钮'),
      h('span', { style: { fontSize: 11.5, lineHeight: '18px', padding: '3px 11px', borderRadius: 999, background: 'rgba(127,127,127,.10)', color: T.text2, border: '1px solid ' + T.border } }, '标签'),
    ),
    h(Row, { gap: 8, wrap: true },
      h(Btn, { size: 'sm', kind: 'ghost', disabled: busy, onClick: () => save({ mode: 'follow', accent: 'blue' }) }, '恢复默认'),
      h('span', { style: { fontSize: 11, color: T.text3 } },
        '当前：' + modeName + ' · ' + (effective === 'light' ? '浅色外观' : '深色外观')),
      msg ? h('span', { style: { fontSize: 11, color: T.danger } }, msg) : null,
    ),
    h(Note, {}, '「外观美化」的玻璃底和星空会跟着这里变：浅色外观下是白玻璃 + 浅底，不会再出现「深底深字」看不见。'),
  )
}

// 外观美化：开关 + 自定义背景图（存运行时 CONFIG.paint；改完派发 sbc-paint-changed）
function PaintCard() {
  const beauty = usePaintConfig()
  const paint = beauty.paint || { enabled: false, image: '' }
  const [busy, setBusy] = React.useState('')
  const [msg, setMsg] = React.useState('')
  const fileRef = React.useRef(null)
  const save = async (body) => {
    setBusy('save')
    const r = await Api.post('/api/paint', body)
    setBusy('')
    if (r.ok) {
      setMsg('已保存')
      try { window.dispatchEvent(new Event('sbc-paint-changed')) } catch (e) {}
      toast('外观设置已保存')
    } else setMsg(r.error || '保存失败')
  }
  const onFile = async (ev) => {
    const f = ev.target.files && ev.target.files[0]
    ev.target.value = ''
    if (!f) return
    setBusy('upload')
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(new Error('读取失败'))
        r.readAsDataURL(f)
      })
      await save({ dataUrl: dataUrl, enabled: true })
    } catch (e) { setMsg(String(e.message || e)) }
    setBusy('')
  }
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h(Field, { label: '美化背景', hint: '关闭=现在的简洁样式；开启=舞台/地图空白处的星空氛围 + 可选背景图' },
      h(Toggle, { checked: !!paint.enabled, onChange: (v) => save({ enabled: v }), label: paint.enabled ? '已开启' : '已关闭' })),
    h(Row, { gap: 8, wrap: true },
      h(Btn, { size: 'sm', disabled: !!busy, onClick: () => { if (fileRef.current) fileRef.current.click() } }, busy === 'upload' ? '上传中…' : '上传背景图'),
      paint.image ? h(Btn, { size: 'sm', kind: 'danger', disabled: !!busy, onClick: () => save({ clearImage: true }) }, '清除背景图') : null,
      h('input', { ref: fileRef, type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: onFile }),
    ),
    beauty.imageUrl ? h('div', { style: { position: 'relative', width: '100%', maxWidth: 360, height: 120, borderRadius: 10, overflow: 'hidden', border: '1px solid ' + T.border } },
      h('img', { src: beauty.imageUrl, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } }),
    ) : null,
    h(Note, {}, '背景图只用于面板里的舞台/地图空白处，不会改 QQ 桌宠窗口；png/jpg/webp 都行，建议 16:9 横图。'),
    msg ? h('div', { style: { fontSize: 11, color: T.text2 } }, msg) : null,
  )
}
