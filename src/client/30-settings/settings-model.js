// 30-settings/settings-model.js —— 设置·模型卡片
//
// 内容：推理等级 / 模型参数 / DeepSeek API Key / 图片反馈 / 聊天风格 / 省 token /
//       上下文档位 / 最近用量
// 契约：function SettingsModelTab()（外壳不传 props，需要什么自己取接口；N02 不写死角色信息）
// 安全：API Key 只提交、不回显明文；「是否已配置」取 /api/status.setup.apiKeyOk
// 可靠性：读取失败时禁用保存（不拿默认值覆盖真实配置）；POST 只发改动字段；前端也 clamp（后端同样会 clamp）

const SETTINGS_MODEL_EFFORTS = [
  { value: 'low', label: '低', desc: '日常聊天够用，最省 token（推荐）' },
  { value: 'medium', label: '中', desc: '稍复杂一点的对话' },
  { value: 'high', label: '高', desc: '需要想清楚的问题、多步操作' },
  { value: 'max', label: '最高', desc: '专业编程、复杂逻辑，最费 token' },
]

const SETTINGS_MODEL_IMAGE_PROVIDERS = [
  { value: 'seedream', label: '火山 Seedream' },
  { value: 'openai-compat', label: 'OpenAI 兼容' },
  { value: 'http', label: '自定义 HTTP' },
]

const SETTINGS_MODEL_HISTORY_MODES = [
  { value: 'full', label: '完整历史（约 30 条）' },
  { value: 'short', label: '精简历史（约 8 条）' },
  { value: 'off', label: '不带历史' },
]

// 只把「和已保存值不同」的字段挑出来，POST 时不去覆盖没动的字段
function settingsModelChanged(cur, next, keys) {
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

function settingsModelUsageRows(usage) {
  if (!usage || typeof usage !== 'object') return []
  const rows = []
  const push = (k, label) => {
    const v = Number(usage[k])
    if (Number.isFinite(v)) rows.push(h(KV, { key: k, k: label, v: String(v) }))
  }
  push('prompt_tokens', '输入 tokens')
  push('completion_tokens', '输出 tokens')
  push('total_tokens', '合计 tokens')
  push('prompt_cache_hit_tokens', '缓存命中')
  push('prompt_cache_miss_tokens', '缓存未命中')
  return rows
}

function SettingsModelTab() {
  const status = useStatus()
  const st = (status && status.data) || {}
  const setup = st.setup || {}
  const tokens = st.tokens || {}
  const apiKeyOk = !!setup.apiKeyOk

  const modelApi = useApi('/api/model')
  const imageApi = useApi('/api/image/config')
  const styleApi = useApi('/api/chat-style')
  const savingApi = useApi('/api/token-saving')
  const ctxApi = useApi('/api/context')

  // ── 草稿状态（从接口数据同步；保存成功后由 reload 回写）─────────────────
  const [mName, setMName] = React.useState('')
  const [mTemp, setMTemp] = React.useState(0.9)
  const [mMaxTok, setMMaxTok] = React.useState(900)
  const [mSteps, setMSteps] = React.useState(20)
  const [keyInput, setKeyInput] = React.useState('')

  const [imgDraft, setImgDraft] = React.useState(null)
  const [imgKeyInput, setImgKeyInput] = React.useState('')

  const [ctxDraft, setCtxDraft] = React.useState({ historyMode: 'full', memoryInject: 8 })

  const [busy, setBusy] = React.useState('')

  const modelData = modelApi.data
  React.useEffect(() => {
    const m = modelData && modelData.model
    if (!m) return
    setMName(String(m.name || ''))
    setMTemp(clampNum(m.temperature, 0, 1.5, 0.9))
    setMMaxTok(Math.round(clampNum(m.maxTokens, 200, 8000, 900)))
    setMSteps(Math.round(clampNum(m.maxSteps, 4, 60, 20)))
  }, [modelData])

  const imageData = imageApi.data
  React.useEffect(() => {
    const c = imageData && imageData.config
    if (!c) return
    setImgDraft({
      provider: c.provider || 'seedream',
      baseURL: String(c.baseURL || ''),
      model: String(c.model || ''),
      size: String(c.size || '1024x1024'),
      watermark: !!c.watermark,
      enabled: !!c.enabled,
      apiKeySet: !!c.apiKeySet,
    })
    setImgKeyInput('')
  }, [imageData])

  const ctxData = ctxApi.data
  React.useEffect(() => {
    const c = ctxData && ctxData.context
    if (!c) return
    setCtxDraft({
      historyMode: ['full', 'short', 'off'].indexOf(String(c.historyMode)) >= 0 ? String(c.historyMode) : 'full',
      memoryInject: Math.round(clampNum(c.memoryInject, 2, 20, 8)),
    })
  }, [ctxData])

  const run = async (key, fn) => {
    if (busy) return
    setBusy(key)
    try { await fn() } catch (e) { toast('操作失败：' + ((e && e.message) || '网络错误'), 'error') } finally { setBusy('') }
  }

  const reloadAll = () => {
    modelApi.reload()
    imageApi.reload()
    styleApi.reload()
    savingApi.reload()
    ctxApi.reload()
  }

  // ── 保存动作 ─────────────────────────────────────────────────────────
  const saveModelParams = () => run('model', async () => {
    if (modelApi.error) { toast('模型配置读取失败，先点「刷新」再保存', 'error'); return }
    const name = String(mName || '').trim()
    if (!name) { toast('模型名不能为空', 'error'); return }
    const next = {
      name,
      temperature: Math.round(clampNum(mTemp, 0, 1.5, 0.9) * 100) / 100,
      maxTokens: Math.round(clampNum(mMaxTok, 200, 8000, 900)),
      maxSteps: Math.round(clampNum(mSteps, 4, 60, 20)),
    }
    setMTemp(next.temperature)
    setMMaxTok(next.maxTokens)
    setMSteps(next.maxSteps)
    const body = settingsModelChanged(modelData && modelData.model, next, ['name', 'temperature', 'maxTokens', 'maxSteps'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/model', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('模型参数已保存')
    modelApi.reload()
  })

  const saveEffort = (value) => run('effort', async () => {
    if (modelApi.error) { toast('模型配置读取失败，先点「刷新」再保存', 'error'); return }
    const cur = (modelData && modelData.model) || {}
    if (cur.reasoningEffort === value) return
    const r = await Api.post('/api/model', { reasoningEffort: value })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    const hit = SETTINGS_MODEL_EFFORTS.filter((x) => x.value === value)[0]
    toast('推理等级已改为「' + (hit ? hit.label : value) + '」')
    modelApi.reload()
  })

  const saveApiKey = () => run('key', async () => {
    const key = String(keyInput || '').trim()
    if (key.length < 10) { toast('API Key 太短（至少 10 位）', 'error'); return }
    if (apiKeyOk) {
      const ok = await confirmDialog('覆盖已保存的 DeepSeek API Key？', {
        title: '覆盖 API Key',
        detail: '新 Key 保存后会立即生效；旧 Key 不会保留。',
        okText: '覆盖',
        danger: true,
      })
      if (!ok) return
    }
    const r = await Api.post('/api/model/key', { key })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    setKeyInput('')
    toast('API Key 已保存')
  })

  const setImgField = (k, v) => {
    setImgDraft((prev) => Object.assign({}, prev || {}, { [k]: v }))
  }

  const saveImageConfig = () => run('image', async () => {
    if (imageApi.error) { toast('图片配置读取失败，先点「刷新」再保存', 'error'); return }
    const d = imgDraft || {}
    const size = String(d.size || '').trim()
    if (!/^\d{2,5}x\d{2,5}$/.test(size)) { toast('尺寸格式应为 宽x高，例如 1024x1024', 'error'); return }
    const loaded = (imageData && imageData.config) || {}
    const next = {
      provider: String(d.provider || ''),
      baseURL: String(d.baseURL || '').trim(),
      model: String(d.model || '').trim(),
      size,
      watermark: !!d.watermark,
    }
    const body = settingsModelChanged(loaded, next, ['provider', 'baseURL', 'model', 'size', 'watermark'])
    const key = String(imgKeyInput || '').trim()
    if (key) body.apiKey = key
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/image/config', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    setImgKeyInput('')
    toast('图片反馈配置已保存')
    imageApi.reload()
  })

  const toggleImageEnabled = (next) => run('imageEnabled', async () => {
    if (imageApi.error) { toast('图片配置读取失败，先点「刷新」再保存', 'error'); return }
    const r = await Api.post('/api/image/config', { enabled: !!next })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '图片反馈已开启' : '图片反馈已关闭')
    imageApi.reload()
  })

  const toggleNoParens = (next) => run('style', async () => {
    if (styleApi.error) { toast('聊天风格读取失败，先点「刷新」再保存', 'error'); return }
    const r = await Api.post('/api/chat-style', { noParens: !!next })
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '已开启无括号模式' : '已关闭无括号模式')
    styleApi.reload()
  })

  const toggleSaving = (key, next) => run('saving:' + key, async () => {
    if (savingApi.error) { toast('省 token 配置读取失败，先点「刷新」再保存', 'error'); return }
    const body = {}
    body[key] = !!next
    const r = await Api.post('/api/token-saving', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast(next ? '已开启' : '已关闭')
    savingApi.reload()
  })

  const saveContext = () => run('context', async () => {
    if (ctxApi.error) { toast('上下文配置读取失败，先点「刷新」再保存', 'error'); return }
    const next = {
      historyMode: SETTINGS_MODEL_HISTORY_MODES.some((x) => x.value === ctxDraft.historyMode) ? ctxDraft.historyMode : 'full',
      memoryInject: Math.round(clampNum(ctxDraft.memoryInject, 2, 20, 8)),
    }
    setCtxDraft(next)
    const body = settingsModelChanged((ctxData && ctxData.context) || {}, next, ['historyMode', 'memoryInject'])
    if (!Object.keys(body).length) { toast('没有改动'); return }
    const r = await Api.post('/api/context', body)
    if (!r.ok) { toast('保存失败：' + (r.error || '未知错误'), 'error'); return }
    toast('上下文档位已保存')
    ctxApi.reload()
  })

  // ── 渲染 ─────────────────────────────────────────────────────────────
  const model = (modelData && modelData.model) || {}
  const usage = modelData && modelData.usage
  const style = (styleApi.data && styleApi.data.style) || {}
  const saving = (savingApi.data && savingApi.data.saving) || {}
  const ctx = (ctxData && ctxData.context) || {}
  const img = imgDraft || {}
  const imgLoaded = (imageData && imageData.config) || {}
  const providerChanged = !!(imgDraft && imgLoaded.provider && imgDraft.provider !== imgLoaded.provider)
  const effortHit = SETTINGS_MODEL_EFFORTS.filter((x) => x.value === model.reasoningEffort)[0] || SETTINGS_MODEL_EFFORTS[0]

  const cardGrid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, minWidth: 0 }

  const keyConfiguredBadge = h(Badge, { tone: apiKeyOk ? 'ok' : 'warn' }, apiKeyOk ? '已配置' : '未配置')

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 } },

    // 顶部：刷新 + 生效说明
    h(Row, { gap: 8, justify: 'space-between' },
      h(Note, {}, '修改后对下一条消息生效；这里的设置只影响本插件，不影响 DSH 其它会话。'),
      h(Btn, { size: 'sm', kind: 'ghost', onClick: reloadAll, disabled: !!busy, title: '重新读取模型 / 图片 / 风格 / 省 token / 上下文配置' }, '刷新'),
    ),

    // 推理等级
    h(Card, { title: '推理等级', tag: '只影响聊天回复', sub: '越高越慢、越费 token' },
      h(Row, { gap: 8 },
        SETTINGS_MODEL_EFFORTS.map((lv) => h(Chip, {
          key: lv.value,
          active: model.reasoningEffort === lv.value,
          title: lv.desc,
          onClick: busy ? undefined : () => saveEffort(lv.value),
        }, lv.label)),
      ),
      h(Note, {}, '当前：' + effortHit.label + ' —— ' + effortHit.desc),
      h(Note, {}, '记忆提取、日记、预览这些后台调用固定用「低」，不占这里的设置。'),
      modelApi.error ? h(ErrorBox, { title: '模型配置读取失败', error: modelApi.error, onRetry: modelApi.reload }) : null,
    ),

    // 模型参数
    h(Card, { title: '模型参数', tag: 'OpenAI 兼容接口', sub: model.name || '' },
      h('div', { style: cardGrid },
        h(Field, { label: '模型名' }, h(TextInput, { value: mName, onChange: setMName, placeholder: 'deepseek-flash', disabled: !!busy })),
        h(Field, { label: '温度', hint: '越高越随机，0.9 左右最自然（0 – 1.5）' },
          h(NumInput, { value: mTemp, onChange: setMTemp, min: 0, max: 1.5, step: 0.1, width: 96, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '单轮输出上限（tokens）', hint: '200 – 8000，越长越容易说完但更费 token' },
          h(NumInput, { value: mMaxTok, onChange: setMMaxTok, min: 200, max: 8000, step: 50, width: 110, disabled: !!busy, flex: true }),
        ),
        h(Field, { label: '工具循环上限（步）', hint: '一次最多连续调几次工具，4 – 60' },
          h(NumInput, { value: mSteps, onChange: setMSteps, min: 4, max: 60, step: 1, width: 96, disabled: !!busy, flex: true }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!modelApi.error, onClick: saveModelParams }, busy === 'model' ? '保存中…' : '保存模型参数'),
        h(Note, {}, '只验证过 DeepSeek 系列；换其它模型时工具循环/推理回传可能不兼容。'),
      ),
      modelApi.error ? h(ErrorBox, { title: '模型配置读取失败（读失败禁存）', error: modelApi.error, onRetry: modelApi.reload }) : null,
    ),

    // DeepSeek API Key
    h(Card, { title: 'DeepSeek API Key', tag: '独立运行 / 没装 DSH 时填这里', actions: keyConfiguredBadge },
      h(Row, { gap: 8, align: 'flex-end' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h(TextInput, {
            value: keyInput,
            onChange: setKeyInput,
            password: true,
            placeholder: apiKeyOk ? '已配置；要换 Key 就贴新的（不会显示原来的 Key）' : 'sk-…（只保存在本机数据目录）',
            disabled: !!busy,
            onEnter: () => { if (!busy) saveApiKey() },
          }),
        ),
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !String(keyInput || '').trim(), onClick: saveApiKey }, busy === 'key' ? '保存中…' : '保存 Key'),
      ),
      h(Note, {}, '为了安全，输入框永远不回显已保存的 Key；状态只看右边「已配置 / 未配置」。'),
      h(Note, {}, 'DSH 环境下会自动读取 DSH 的 Key，通常不用在这里填；只有脱离 DSH 单独跑运行时才必须填。'),
    ),

    // 图片反馈
    h(Card, {
      title: '🖼️ 图片反馈',
      sub: '她会在聊天里发图',
      actions: h(Row, { gap: 6 },
        h(Badge, { tone: img.apiKeySet ? 'ok' : 'warn' }, img.apiKeySet ? 'Key 已配置' : 'Key 未配置'),
        h(Badge, { tone: img.enabled ? 'ok' : 'warn' }, img.enabled ? '已开启' : '已关闭'),
      ),
    },
      h('div', { style: cardGrid },
        h(Field, { label: '服务' },
          h(Select, {
            value: img.provider || 'seedream',
            disabled: !!busy,
            onChange: (v) => setImgField('provider', v),
            options: SETTINGS_MODEL_IMAGE_PROVIDERS,
          }),
        ),
        h(Field, { label: 'Base URL' }, h(TextInput, { value: img.baseURL || '', onChange: (v) => setImgField('baseURL', v), disabled: !!busy, placeholder: 'https://…/api/v3' })),
        h(Field, { label: '模型' }, h(TextInput, { value: img.model || '', onChange: (v) => setImgField('model', v), disabled: !!busy, placeholder: '生图模型名' })),
        h(Field, { label: '尺寸', hint: '宽x高，例如 1024x1024' },
          h(TextInput, { value: img.size || '1024x1024', onChange: (v) => setImgField('size', v), disabled: !!busy, placeholder: '1024x1024' }),
        ),
      ),
      h(Row, { gap: 8, align: 'flex-end' },
        h('div', { style: { flex: 1, minWidth: 0 } },
          h(TextInput, {
            value: imgKeyInput,
            onChange: setImgKeyInput,
            password: true,
            placeholder: img.apiKeySet ? '生图 Key 已配置；要换就贴新的（留空保持原样）' : '生图服务 API Key（没配就贴这里）',
            disabled: !!busy,
          }),
        ),
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!imageApi.error, onClick: saveImageConfig }, busy === 'image' ? '保存中…' : '保存图片配置'),
      ),
      h(Note, {}, providerChanged ? '⚠️ 切换了服务，需要重新填生图 Key 再保存（旧 Key 对新服务可能无效）。' : '切换生图服务时旧 Key 可能对新服务无效，记得重新填。'),
      h(Row, { gap: 10 },
        h(Toggle, { checked: !!img.enabled, disabled: !!busy || !!imageApi.error, onChange: toggleImageEnabled, label: '聊天里允许发图（关闭后完全不调生图 API、不花钱）' }),
        h(Toggle, { checked: !!img.watermark, disabled: !!busy || !!imageApi.error, onChange: (v) => setImgField('watermark', v), label: '图片加水印' }),
      ),
      h(Note, {}, '自定义 HTTP 需返回 data[0].b64_json 或 data[0].url。'),
      imageApi.error ? h(ErrorBox, { title: '图片配置读取失败（读失败禁存）', error: imageApi.error, onRetry: imageApi.reload }) : null,
    ),

    // 聊天风格
    h(Card, { title: '聊天风格', tag: '影响她所有说话' },
      h(Toggle, {
        checked: !!style.noParens,
        disabled: !!busy || !!styleApi.error,
        onChange: toggleNoParens,
        label: '无括号模式：她不用括号写动作和表情，只直接说话',
      }),
      styleApi.error ? h(ErrorBox, { title: '聊天风格读取失败（读失败禁存）', error: styleApi.error, onRetry: styleApi.reload }) : null,
    ),

    // 省 token
    h(Card, { title: '🧠 省 token 开关', tag: '按需打开，随时关' },
      h(Toggle, {
        checked: !!saving.dynamicTools,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('dynamicTools', v),
        label: '按需给工具：闲聊时不带屏幕/手机/代码工具说明（关键词命中会自动带上）',
      }),
      h(Toggle, {
        checked: !!saving.compressImage,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('compressImage', v),
        label: '压缩工具结果：截图缩到 720 内、长输出截断，看屏幕更省',
      }),
      h(Toggle, {
        checked: !!saving.batchActions,
        disabled: !!busy || !!savingApi.error,
        onChange: (v) => toggleSaving('batchActions', v),
        label: '批量动作：连续点击/输入一次提交（危险操作别开）',
      }),
      h(Note, {}, '实测（deepseek-flash）：只开「按需给工具」闲聊省约 42%；再开「压缩工具结果」看屏幕省约 24%；「批量动作」点两下省约 48%。'),
      savingApi.error ? h(ErrorBox, { title: '省 token 配置读取失败（读失败禁存）', error: savingApi.error, onRetry: savingApi.reload }) : null,
    ),

    // 上下文档位
    h(Card, { title: '上下文档位', tag: '省 token 的力度' },
      h('div', { style: cardGrid },
        h(Field, { label: '聊天历史' },
          h(Select, {
            value: ctxDraft.historyMode,
            disabled: !!busy || !!ctxApi.error,
            onChange: (v) => setCtxDraft((prev) => Object.assign({}, prev, { historyMode: v })),
            options: SETTINGS_MODEL_HISTORY_MODES,
          }),
        ),
        h(Field, { label: '每轮注入记忆（条）', hint: '2 – 20；精简历史会在需要时额外花一次便宜的摘要调用' },
          h(NumInput, {
            value: ctxDraft.memoryInject,
            onChange: (v) => setCtxDraft((prev) => Object.assign({}, prev, { memoryInject: v })),
            min: 2, max: 20, step: 1, width: 96, disabled: !!busy || !!ctxApi.error, flex: true,
          }),
        ),
      ),
      h(Row, { gap: 8 },
        h(Btn, { kind: 'primary', size: 'sm', disabled: !!busy || !!ctxApi.error, onClick: saveContext }, busy === 'context' ? '保存中…' : '保存档位'),
        h(Note, {}, ctx.historyMode === 'off' ? '当前不带历史，最省但短期连贯性会差一点。' : '精简会在需要时生成「刚才聊到…」摘要；不带历史最省。'),
      ),
      ctxApi.error ? h(ErrorBox, { title: '上下文配置读取失败（读失败禁存）', error: ctxApi.error, onRetry: ctxApi.reload }) : null,
    ),

    // 最近用量
    h(Card, { title: '最近用量', sub: '最近一次模型调用与今日额度' },
      usage
        ? h('div', { style: cardGrid }, settingsModelUsageRows(usage))
        : h(Note, {}, '还没有产生模型调用用量。'),
      usage ? null : h(Note, {}, '发一条消息后再回来点「刷新」就能看到。'),
      (tokens.tokenMode || tokens.dailyUsed !== undefined || tokens.remainingTokens !== undefined)
        ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 8, marginTop: 2 } },
            tokens.dailyUsed !== undefined ? h(KV, { k: '今日消耗', v: String(tokens.dailyUsed) + ' tokens' }) : null,
            tokens.remainingTokens !== undefined ? h(KV, { k: '剩余额度', v: String(tokens.remainingTokens) + (tokens.tokenBudget ? ' / ' + tokens.tokenBudget : '') }) : null,
            tokens.realBalanceKnown && tokens.realRmb !== undefined ? h(KV, { k: 'DeepSeek 余额', v: '¥' + fmtMoney(tokens.realRmb, 2) }) : null,
            st.model ? h(KV, { k: '当前模型', v: String(st.model) }) : null,
          )
        : null,
      h(Note, {}, '这里的用量只统计本插件的模型调用；「她的零花」和 DeepSeek 真实余额不是同一笔钱。'),
    ),
  )
}
