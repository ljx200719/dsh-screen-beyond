// 40-screen/pet.js —— 桌宠卡片（D07 A：桌宠保持独立的 WPF 桌面程序，面板只做开关和状态）
//
// 关键约束（M19 验收）：
//   · 面板刷新 / 切标签只读 /api/pet/status，**不会**自动启动桌宠；
//   · 点「启动桌宠」之前先问一次后端现在是否已经在跑：在跑就只提示，不再调 start；
//     后端 /api/pet/start 本身也是幂等的（已经在跑返回 already:true），两层保险；
//   · 桌宠是桌面上的独立进程，面板不嵌入它，只显示状态和形象/属性；
//   · 停止等于把桌面上的她收起来，属于危险操作 → confirmDialog；
//   · 失败都给中文错误说明（N03）。

const PET_STATUS_POLL_MS = 5000
const PET_MANIFEST_POLL_MS = 20000

// 后端 state 字段（stationary / traveling / intercity）→ 中文
function petStateText(state) {
  if (state === 'traveling') return '正在路上'
  if (state === 'intercity') return '跨城移动中'
  if (state === 'stationary') return '待在原地'
  return state ? String(state) : '—'
}

function petBoolText(v) {
  return v ? '开' : '关'
}

function PetCard(props) {
  // 状态（运行/未启动、角色、地点、活动、精力）+ 形象配置（pet 的图/尺寸/手势/按钮/表情）
  const status = useApi('/api/pet/status', { refreshMs: PET_STATUS_POLL_MS })
  const manifest = useApi('/api/pet/manifest', { refreshMs: PET_MANIFEST_POLL_MS })
  const [busy, setBusy] = React.useState('') // '' | 'start' | 'stop'

  const st = status.data || {}
  const pet = (manifest.data && manifest.data.pet) || st.manifest || {}
  // 状态两个接口都带一份：/api/pet/status 挂了也能用 /api/pet/manifest 里的 status 兜底
  const live = st && Object.keys(st).length ? st : ((manifest.data && manifest.data.status) || {})
  const running = !!live.running
  const character = live.character || {}
  const place = live.place || {}
  const lastHer = live.lastHer || null
  const gestures = Array.isArray(pet.gestures) ? pet.gestures : []
  const expressions = pet.expressions || {}
  const firstLoad = !live.running && !live.character && status.loading

  const reloadAll = () => {
    status.reload()
    manifest.reload()
  }

  // 启动前先按后端状态判断，避免面板刷新/重复点击把桌宠起两份
  const startPet = async () => {
    if (busy) return
    setBusy('start')
    try {
      const cur = await Api.get('/api/pet/status')
      const curData = (cur && cur.data) || {}
      if (cur && cur.ok && curData.running) {
        toast('桌宠已经在运行了，没有重复启动', 'info')
        reloadAll()
        return
      }
      const r = await Api.post('/api/pet/start', {})
      const d = (r && r.data) || {}
      if (!r || !r.ok || d.ok === false) {
        const why = d.error || d.message || (r && r.error) || '运行时没有响应'
        toast('启动桌宠失败：' + why, 'error')
        return
      }
      if (d.already) toast('桌宠本来就在运行，没有重复启动', 'info')
      else toast('桌宠已启动（独立桌面窗口）', 'ok')
    } catch (e) {
      toast('启动桌宠失败：' + ((e && e.message) || '未知错误'), 'error')
    } finally {
      setBusy('')
      reloadAll()
    }
  }

  const stopPet = async () => {
    if (busy) return
    const ok = await confirmDialog('关掉桌宠？', {
      detail: '桌宠是桌面上的独立小程序（WPF）；关掉后桌面上的她就不在了，聊天和记忆不受影响，随时可以再启动。',
      danger: true,
      okText: '关掉',
    })
    if (!ok) return
    setBusy('stop')
    try {
      const r = await Api.post('/api/pet/stop', {})
      const d = (r && r.data) || {}
      if (!r || !r.ok || d.ok === false) {
        const why = d.error || d.message || (r && r.error) || '运行时没有响应'
        toast('关闭桌宠失败：' + why, 'error')
        return
      }
      toast('桌宠已关闭', 'ok')
    } catch (e) {
      toast('关闭桌宠失败：' + ((e && e.message) || '未知错误'), 'error')
    } finally {
      setBusy('')
      reloadAll()
    }
  }

  return h(Card, {
    title: '桌宠',
    sub: '独立桌面程序（WPF）· 面板只做开关和状态',
    tag: 'D07 A',
    actions: h(Row, { gap: 6, wrap: false },
      h(Btn, {
        kind: 'primary',
        size: 'sm',
        disabled: !!busy || running || firstLoad,
        onClick: () => { void startPet() },
        title: running ? '桌宠已经在运行了' : '启动独立的桌面桌宠（不会重复启动）',
      }, running ? '已启动' : (busy === 'start' ? '启动中…' : '启动桌宠')),
      h(Btn, {
        kind: 'danger',
        size: 'sm',
        disabled: !!busy || !running,
        onClick: () => { void stopPet() },
        title: running ? '关掉桌面上的桌宠' : '桌宠没在运行',
      }, busy === 'stop' ? '关闭中…' : '停止'),
      h(Btn, { size: 'sm', disabled: !!busy, onClick: reloadAll, title: '重新读状态' }, '刷新'),
    ),
  },
    h(Row, { gap: 8 },
      h(Dot, { on: running, tone: running ? T.ok : T.idle, size: 8 }),
      h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } },
        firstLoad ? '读取状态…' : running ? '桌宠在运行' : '桌宠没启动'),
      running ? h(Badge, { tone: 'ok' }, '独立进程') : null,
      character.name ? h(Badge, { title: '当前角色' }, character.name) : null,
      h('span', { style: { flex: 1 } }),
      status.at ? h(Note, {}, '更新于 ' + fmtTime(status.at)) : null,
    ),
    status.error ? h(ErrorBox, { title: '读不到桌宠状态', error: status.error, onRetry: status.reload }) : null,
    manifest.error
      ? h('div', { style: { fontSize: 11.5, color: T.warn, lineHeight: 1.6 } }, '读不到桌宠形象配置：' + manifest.error + '（下面显示的是最后一份数据）')
      : null,
    firstLoad && !status.error
      ? h(Loading, { text: '正在读桌宠状态…' })
      : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10, alignItems: 'start' } },
          // 形象预览 + 她现在在干什么
          h('div', { style: { display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 } },
            h('div', { style: { width: 88, height: 88, flexShrink: 0, background: T.bg2, border: '1px solid ' + T.border, borderRadius: T.radius, overflow: 'hidden' } },
              h(Img, {
                path: pet.image || '',
                width: '100%',
                height: '100%',
                fit: 'contain',
                alt: '桌宠形象',
                title: '桌宠当前形象',
                fallback: '没有形象图',
              }),
            ),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 } },
              h('div', {
                style: { fontSize: 12.5, color: T.text, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
                title: pet.image || '',
              }, character.name || '（角色名没读到）'),
              h('div', { style: { fontSize: 11, color: T.text3, wordBreak: 'break-all' } }, '形象：' + (pet.image || '未配置')),
              h('div', { style: { fontSize: 11, color: T.text3 } },
                (place.icon ? place.icon + ' ' : '') + (place.name || '地点未知') + ' · ' + petStateText(live.state)),
            ),
          ),
          // 她的状态
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h(KV, { k: '在做什么', v: live.activity || '—' }),
            h(KV, { k: '精力', v: live.energy || '—' }),
            h(KV, { k: '状态', v: petStateText(live.state) + (live.transport ? '（' + live.transport + '）' : '') }),
          ),
          // 桌宠形象配置
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
            h(KV, { k: '桌宠尺寸', v: pet.size ? pet.size + ' px' : '—' }),
            h(KV, { k: '不透明度', v: pet.opacity === undefined ? '—' : Math.round((Number(pet.opacity) || 0) * 100) + '%' }),
            h(KV, { k: '窗口置顶', v: petBoolText(pet.alwaysOnTop) }),
            h(KV, { k: '状态气泡', v: petBoolText(pet.statusText) }),
            h(KV, { k: '手势', v: gestures.length ? gestures.map((g) => g.label || g.id).join(' / ') : '—' }),
            h(KV, { k: '表情', v: Object.keys(expressions).length ? Object.keys(expressions).length + ' 套' : '—' }),
            h(KV, { k: '桌宠按钮', v: Array.isArray(pet.buttons) && pet.buttons.length ? pet.buttons.map((b) => b.title || b.label || b.id).join(' / ') : '—' }),
          ),
        ),
    lastHer
      ? h('div', {
          style: { borderTop: '1px solid ' + T.border, paddingTop: 6, fontSize: 11.5, color: T.text2, lineHeight: 1.6, wordBreak: 'break-word' },
        }, '她最后说：' + String(lastHer.text || '').slice(0, 120) + (lastHer.at ? '（' + fmtTime(lastHer.at) + '）' : ''))
      : null,
    h(Note, {}, '桌宠是桌面上的独立小程序（WPF），浮在窗口最上层；面板里只显示开关和状态，不把它嵌进来。'),
    h(Note, {}, '刷新/切换面板不会重复启动桌宠：这个卡片只读状态，启动只发生在你点「启动桌宠」的时候，而且会先确认后端是不是已经在跑。'),
    h(Note, {}, '想改形象、大小、手势、气泡这些配置，去「设置 → 生活 → 桌宠」；这张卡片只负责开关。'),
  )
}
