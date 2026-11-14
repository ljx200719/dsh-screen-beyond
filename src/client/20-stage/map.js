// 20-stage/map.js —— 地图查看 + 基础编辑（原生实现，替代 runtime/map.html 的核心部分）
//
// 契约：function MapView(props)
// 数据（全部直连 127.0.0.1 运行时的 /api/*，不请求任何 HTML 页面、无 iframe）：
//   GET  /api/map                         地图列表 / 当前地图 / 地点 / 交通 / 天气 / 精力 / 位置 / 作息
//   GET  /api/world/characters            各角色在这张图上的位置（x/y 0~1，轮询）
//   POST /api/map { mapId, places, expectedRev? }   保存地点（D04 B 基础编辑）
//   POST /api/map/activate                切地图（跨城，会真的移动她，可能被拒绝）
//   POST /api/map/create | /api/map/delete       新建 / 删除地图
//   POST /api/map/image | /api/scene/image       底图 / 内部场景背景图上传（dataUrl）
//   GET  /api/travel/options + POST /api/travel/ticket   跨城买票
//   GET  /api/data/revisions              保存前的版本号（expectedRev 冲突检测，409 不覆盖）
//   POST /api/location                    让她在同一张图里移动（可能被拒绝，要显示 reason）
//
// 坐标一律 0~1 归一化（地点钉、热点、障碍/可走都相对各自底图宽高），绝不把 px 当百分比（M04）。
// 地点 id 保持稳定：拖动只改 x/y，不重新生成 id；保存只提交 places，不整体覆盖地图其它字段。
// 读失败（/api/map 或 /api/data/revisions 都没拿到）时禁止保存（M05 同款要求）。

// ── 小工具（都带 map 前缀，避免和别的模块的工厂作用域撞名）──────────────
function mapCloneJson(value) {
  try { return value === undefined ? value : JSON.parse(JSON.stringify(value)) } catch (e) { return value }
}

// 把 Api.* 的返回 + 业务层 refused 统一成好判断的结构
function mapResultOf(r) {
  if (!r || !r.ok) return { ok: false, refused: false, needsConfirm: false, reason: '', error: (r && r.error) || '请求失败', status: (r && r.status) || 0 }
  const d = r.data || {}
  if (d.ok === false) {
    return {
      ok: false,
      refused: !!d.refused,
      needsConfirm: !!d.needsConfirm,
      reason: String(d.reason || d.error || '她拒绝了'),
      error: String(d.error || d.reason || '请求失败'),
      location: d.location || null,
    }
  }
  return { ok: true, refused: false, needsConfirm: false, reason: '', error: '', location: d.location || null, data: d }
}

// 保存后回读比对：确认真的落盘、且旧字段没被削掉（「刷新不丢」的自检）
function mapPlacesDiff(sent, back) {
  const list = Array.isArray(sent) ? sent : []
  const got = Array.isArray(back) ? back : []
  const problems = []
  if (got.length !== list.length) problems.push('地点数量 ' + list.length + ' → 回读 ' + got.length)
  for (const p of list) {
    const b = got.find((x) => String(x.id) === String(p.id))
    if (!b) { problems.push('回读缺少地点「' + String(p.name || p.id) + '」'); continue }
    if (String(b.name || '') !== String(p.name || '')) problems.push('「' + String(p.name || p.id) + '」名字没保存上')
    if (Number.isFinite(Number(p.x)) && Math.abs(Number(b.x) - Number(p.x)) > 1e-6) problems.push('「' + String(p.name || p.id) + '」x 坐标没按提交保存')
    if (Number.isFinite(Number(p.y)) && Math.abs(Number(b.y) - Number(p.y)) > 1e-6) problems.push('「' + String(p.name || p.id) + '」y 坐标没按提交保存')
    if (String(b.icon || '') !== String(p.icon || '')) problems.push('「' + String(p.name || p.id) + '」图标没保存上')
    const pBg = String((p.scene && p.scene.background) || '')
    const bBg = String((b.scene && b.scene.background) || '')
    if (pBg !== bBg) problems.push('「' + String(p.name || p.id) + '」内部场景背景没保存上')
    const pHot = (p.scene && Array.isArray(p.scene.hotspots)) ? p.scene.hotspots.length : 0
    const bHot = (b.scene && Array.isArray(b.scene.hotspots)) ? b.scene.hotspots.length : 0
    if (pHot !== bHot) problems.push('「' + String(p.name || p.id) + '」热点数量 ' + pHot + ' → 回读 ' + bHot)
    const pObs = (p.scene && Array.isArray(p.scene.obstacles)) ? p.scene.obstacles.length : 0
    const bObs = (b.scene && Array.isArray(b.scene.obstacles)) ? b.scene.obstacles.length : 0
    if (pObs !== bObs) problems.push('「' + String(p.name || p.id) + '」障碍数量 ' + pObs + ' → 回读 ' + bObs)
    const pWalk = (p.scene && Array.isArray(p.scene.walkable)) ? p.scene.walkable.length : 0
    const bWalk = (b.scene && Array.isArray(b.scene.walkable)) ? b.scene.walkable.length : 0
    if (pWalk !== bWalk) problems.push('「' + String(p.name || p.id) + '」可走区域数量 ' + pWalk + ' → 回读 ' + bWalk)
    const pPhotos = (p.scene && Array.isArray(p.scene.photos)) ? p.scene.photos.length : 0
    const bPhotos = (b.scene && Array.isArray(b.scene.photos)) ? b.scene.photos.length : 0
    if (pPhotos !== bPhotos) problems.push('「' + String(p.name || p.id) + '」场景照片数量 ' + pPhotos + ' → 回读 ' + bPhotos)
    const pChars = (p.scene && Array.isArray(p.scene.characters)) ? p.scene.characters.length : 0
    const bChars = (b.scene && Array.isArray(b.scene.characters)) ? b.scene.characters.length : 0
    if (pChars !== bChars) problems.push('「' + String(p.name || p.id) + '」场景角色位置数量 ' + pChars + ' → 回读 ' + bChars)
    const pMode = (p.scene && p.scene.mode === '3d') ? '3d' : '2d'
    const bMode = (b.scene && b.scene.mode === '3d') ? '3d' : '2d'
    if (pMode !== bMode) problems.push('「' + String(p.name || p.id) + '」场景视图模式 ' + pMode + ' → 回读 ' + bMode)
  }
  return problems.slice(0, 6)
}

// 地图实体的版本号（服务端 guardRev 用）；拿不到就返回 null（保存时不带 expectedRev）
async function mapReadBaseRev() {
  try {
    const r = await Api.get('/api/data/revisions')
    if (!r.ok || !r.data || !r.data.entities) return null
    const keys = Object.keys(r.data.entities).filter((k) => k.indexOf('maps:') === 0)
    if (!keys.length) return null
    const rev = Number(r.data.entities[keys[0]].rev)
    return Number.isFinite(rev) ? rev : null
  } catch (e) { return null }
}

// 角色状态文案（地图上的小人悬浮/列表用）
function mapCharStatus(c) {
  if (!c) return ''
  if (c.state === 'intercity') return '跨城旅行中' + (c.etaSec ? ' · 约 ' + Math.max(1, Math.ceil(Number(c.etaSec) / 60)) + ' 分钟' : '')
  if (c.state === 'traveling') return String(c.transport || '出行') + '中' + (c.etaSec ? ' · 约 ' + Math.max(1, Math.ceil(Number(c.etaSec) / 60)) + ' 分钟' : '')
  return '在「' + String(c.placeName || '某个地方') + '」'
}

// ── 地图画布：底图 + 地点钉（编辑模式可拖）+ 角色位置 ─────────────────
function MapCanvas(props) {
  const p = props || {}
  const map = p.map || {}
  const places = Array.isArray(p.places) ? p.places : []
  const characters = Array.isArray(p.characters) ? p.characters : []
  const location = p.location || {}
  const editMode = !!p.editMode
  const busyPlaceId = String(p.busyPlaceId || '')
  const mapImgPath = map.image && map.image.url ? String(map.image.url) : ''

  const mapImg = useImage(mapImgPath)
  const canvasRef = React.useRef(null)
  const pinRefs = React.useRef({})
  const dragRef = React.useRef(null)
  const fit = sbcFitUseSize(canvasRef)
  const size = fit.size
  const [aspect, setAspect] = React.useState(STAGE_MAP_ASPECT_FALLBACK)
  const [bgFailed, setBgFailed] = React.useState(false)

  React.useEffect(() => {
    setAspect(STAGE_MAP_ASPECT_FALLBACK)
    setBgFailed(false)
  }, [mapImgPath])

  const rect = sbcFitRect(size, aspect)

  // 编辑模式：按住地点钉拖动，过程中只改 DOM，松手才提交一次 state（N04）
  const onPinDown = (place, ev) => {
    if (!editMode) return
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    const box = canvasRef.current ? canvasRef.current.getBoundingClientRect() : null
    if (!box || !box.width || !box.height) return
    const start = { x: Number(place.x) || 0.5, y: Number(place.y) || 0.5 }
    const drag = { id: place.id, place, el: pinRefs.current[String(place.id)] || null, box, x: start.x, y: start.y, moved: false }
    dragRef.current = drag
    const move = (e) => {
      const d = dragRef.current
      if (!d) return
      const nx = clampNum((e.clientX - d.box.left) / d.box.width, 0.05, 0.95)
      const ny = clampNum((e.clientY - d.box.top) / d.box.height, 0.08, 0.92)
      if (Math.abs(nx - d.x) + Math.abs(ny - d.y) > 0.004) d.moved = true
      d.x = nx
      d.y = ny
      if (d.el) { d.el.style.left = (nx * 100) + '%'; d.el.style.top = (ny * 100) + '%' }
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const d = dragRef.current
      dragRef.current = null
      if (!d) return
      if (d.moved) { if (p.onPlaceMove) p.onPlaceMove(d.id, d.x, d.y) }
      else if (p.onPlaceClick) p.onPlaceClick(d.place)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const viewStyle = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    overflow: 'hidden',
    borderRadius: 10,
  }

  const gridStyle = {
    backgroundImage:
      'linear-gradient(rgba(127,127,127,.16) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(127,127,127,.16) 1px, transparent 1px)',
    backgroundSize: '10% 10%, 10% 10%',
    backgroundColor: T.bg2,
  }

  // 角色小人（读取 /api/world/characters；只在同一张图上画）
  const charPins = characters
    .filter((c) => c && c.sameMap && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)))
    .map((c) => h('div', {
      key: 'char-' + String(c.id),
      title: String(c.name || '她') + ' · ' + mapCharStatus(c),
      style: {
        position: 'absolute',
        left: pct(c.x),
        top: pct(c.y),
        transform: 'translate(-50%,-100%)',
        zIndex: 5,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
        pointerEvents: 'none',
        transition: 'left 1s linear, top 1s linear',
      },
    },
      h(Avatar, { path: c.avatar, name: c.name, size: c.isActive ? 30 : 24 }),
      h('span', {
        style: {
          fontSize: 9.5, lineHeight: '13px', whiteSpace: 'nowrap',
          color: c.isActive ? T.text : T.text2,
          background: 'rgba(8,13,20,.78)',
          border: '1px solid ' + (c.isActive ? T.brand : T.border),
          borderRadius: 999, padding: '0 5px',
        },
      }, String(c.name || '她')),
    ))

  return h('div', {
    ref: fit.ref,
    style: {
      position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
      background: T.bg2, borderRadius: 12, border: '1px solid ' + T.border,
    },
  },
    h('div', { style: viewStyle },
      mapImgPath && !bgFailed && mapImg.src
            ? h('img', {
                src: mapImg.src,
                alt: '',
                draggable: false,
                onLoad: (e) => {
                  const el = e.currentTarget
                  const nw = Number(el.naturalWidth) || 0
                  const nh = Number(el.naturalHeight) || 0
                  if (nw > 0 && nh > 0) setAspect(nw / nh)
                },
                onError: () => setBgFailed(true),
                style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' },
              })
            : h('div', {
                style: Object.assign({ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 16, textAlign: 'center' }, gridStyle),
              },
                h('div', { style: { fontSize: 24, opacity: 0.7 } }, '🗺️'),
                h('div', { style: { fontSize: 12.5, color: T.text2, fontWeight: 600 } },
                  mapImgPath ? '底图加载失败' : '这张地图没有 2D 底图'),
                h('div', { style: { fontSize: 11, color: T.text3, lineHeight: 1.65, maxWidth: 300 } },
                  mapImgPath
                    ? '地点钉还会按数据画出来（坐标是对的），只是底图没加载出来。'
                    : (editMode ? '编辑模式里可以点上方「上传底图」给这张地图加一张底图。' : '进入编辑模式后可以上传底图；地点坐标仍然可用。')),
                mapImgPath && bgFailed ? h(Btn, { size: 'sm', onClick: () => { setBgFailed(false); mapImg.retry() } }, '重试') : null,
              ),
          // 地点钉
          places.map((place) => {
            const here = location.state === 'stationary' && String(location.placeId) === String(place.id)
            const isBusy = busyPlaceId === String(place.id)
            return h('div', {
              key: 'pin-' + String(place.id),
              ref: (el) => { pinRefs.current[String(place.id)] = el },
              title: editMode
                ? ('拖动改「' + String(place.name || '') + '」的位置（x=' + Number(place.x || 0).toFixed(2) + ', y=' + Number(place.y || 0).toFixed(2) + '）')
                : ('点开「' + String(place.name || '') + '」详情'),
              onClick: editMode ? undefined : (() => { if (p.onPlaceClick) p.onPlaceClick(place) }),
              onPointerDown: editMode ? ((ev) => onPinDown(place, ev)) : undefined,
              style: {
                position: 'absolute',
                left: pct(place.x),
                top: pct(place.y),
                transform: 'translate(-50%,-100%)',
                zIndex: here ? 4 : 3,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                cursor: editMode ? 'grab' : 'pointer',
                opacity: isBusy ? 0.45 : 1,
                userSelect: 'none',
                maxWidth: 108,
              },
            },
              h('span', {
                style: {
                  width: 22, height: 22, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: here ? 'rgba(47,107,216,.30)' : 'rgba(8,13,20,.74)',
                  border: '1px ' + (editMode ? 'dashed ' : 'solid ') + (here ? T.brand : T.border2),
                  fontSize: 11.5, lineHeight: 1,
                  boxShadow: '0 2px 8px rgba(0,0,0,.32)',
                },
              }, place.icon || '📍'),
              h('span', {
                style: {
                  fontSize: 10, lineHeight: '14px',
                  color: here ? T.text : T.text2,
                  background: 'rgba(8,13,20,.72)', border: '1px solid ' + T.border,
                  borderRadius: 999, padding: '0 5px', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
                },
              }, String(place.name || '')),
              editMode
                ? h('span', { style: { fontSize: 8.5, lineHeight: '12px', color: T.text3, whiteSpace: 'nowrap' } },
                    Number(place.x || 0).toFixed(2) + ', ' + Number(place.y || 0).toFixed(2))
                : null,
            )
          }),
          charPins,
        ),
  )
}

// ── 地点详情（查看模式点地点钉打开）───────────────────────────────────
function MapPlaceModal(props) {
  const p = props || {}
  const place = p.place || {}
  const scene = place.scene || null
  const hotspots = scene && Array.isArray(scene.hotspots) ? scene.hotspots.length : 0
  const obstacles = scene && Array.isArray(scene.obstacles) ? scene.obstacles.length : 0
  const walkable = scene && Array.isArray(scene.walkable) ? scene.walkable.length : 0
  const people = Array.isArray(p.people) ? p.people : []
  return h(Modal, {
    open: true,
    title: (place.icon || '📍') + ' ' + String(place.name || '地点'),
    onClose: p.onClose,
    width: 480,
    footer: h(Row, { gap: 8, justify: 'flex-end' },
      h(Btn, { onClick: p.onClose }, '关闭'),
      h(Btn, { onClick: () => { if (p.onEdit) p.onEdit(place) } }, '编辑地点'),
      h(Btn, { kind: 'primary', disabled: !!p.busy, onClick: () => { if (p.onGo) p.onGo(place) } }, p.busy ? '移动中…' : '让她来这里'),
    ),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      place.image ? h(Img, { path: place.image, width: 72, height: 72, style: { borderRadius: 10 }, fallback: '图标加载失败' }) : null,
      place.desc ? h(KV, { k: '描述', v: place.desc }) : null,
      place.feel ? h(KV, { k: '她的感受', v: place.feel }) : null,
      h(Divider, {}),
      h(KV, { k: '坐标', v: 'x ' + Number(place.x || 0).toFixed(3) + ' · y ' + Number(place.y || 0).toFixed(3) + '（0~1 归一化，不是像素）' }),
      h(KV, {
        k: '内部场景',
        v: scene && scene.background
          ? ('有背景图 · 热点 ' + hotspots + ' 个 · 障碍 ' + obstacles + ' · 可走 ' + walkable + (scene.mode === '3d' ? ' · 3D 模型' : ''))
          : '没有设置',
      }),
      people.length
        ? h(KV, { k: '现在在这', v: people.map((c) => String(c.name || '')).join('、') })
        : h(Note, {}, '现在这里没有别人。'),
      h(Note, {}, '「让她来这里」会按她的出行方式走一段路（夜里/没钱可能被拒绝，会显示原因）。'),
    ),
  )
}

// ── 内部场景编辑器：背景图 / 热点 / 障碍 / 可走区域（全部 0~1 归一化）──
function MapSceneEditor(props) {
  const p = props || {}
  const scene = p.scene || null
  const sc = scene || {}
  // 保留旧字段：只改我们认识的，其余原样带回去（M04「不丢旧 fields」）
  const base = {
    background: String(sc.background || ''),
    characters: Array.isArray(sc.characters) ? sc.characters : [],
    hotspots: Array.isArray(sc.hotspots) ? sc.hotspots : [],
    photos: Array.isArray(sc.photos) ? sc.photos : [],
    obstacles: Array.isArray(sc.obstacles) ? sc.obstacles : [],
    walkable: Array.isArray(sc.walkable) ? sc.walkable : [],
    mode: sc.mode === '3d' ? '3d' : '2d',
    model3d: sc.model3d || null,
  }
  const bg = base.background
  const img = useImage(bg)
  const boxRef = React.useRef(null)
  const previewRef = React.useRef(null)
  const fileRef = React.useRef(null)
  const drawRef = React.useRef(null)
  const fit = sbcFitUseSize()
  const [aspect, setAspect] = React.useState(16 / 9)
  const [bgText, setBgText] = React.useState(bg)
  const [brush, setBrush] = React.useState('')
  const [uploading, setUploading] = React.useState(false)
  const [elError, setElError] = React.useState('')

  React.useEffect(() => { setBgText(bg); setAspect(16 / 9) }, [bg])

  const update = (patch) => {
    if (!p.onChange) return
    p.onChange(Object.assign({}, base, patch))
  }

  // 画布尺寸：按背景图比例 fit，最高 300px，避免竖图把弹窗撑爆
  const wrapW = Math.max(0, Math.round(Number(fit.size.w) || 0))
  let boxW = wrapW
  let boxH = boxW > 0 ? boxW / Math.max(0.2, Number(aspect) || 16 / 9) : 0
  if (boxH > 300) { boxH = 300; boxW = boxH * Math.max(0.2, Number(aspect) || 16 / 9) }

  // 拖框画障碍 / 可走区域：拖动过程直接改预览层，松手才写一次 state
  const onCanvasDown = (ev) => {
    if (!brush || !boxRef.current) return
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    const rect = boxRef.current.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    drawRef.current = { sx: ev.clientX, sy: ev.clientY, rect }
    const move = (e) => {
      const d = drawRef.current
      if (!d) return
      const x = Math.min(e.clientX, d.sx) - d.rect.left
      const y = Math.min(e.clientY, d.sy) - d.rect.top
      const w = Math.abs(e.clientX - d.sx)
      const h = Math.abs(e.clientY - d.sy)
      const el = previewRef.current
      if (el) {
        el.style.display = 'block'
        el.style.left = clampNum(x / d.rect.width, 0, 1) * 100 + '%'
        el.style.top = clampNum(y / d.rect.height, 0, 1) * 100 + '%'
        el.style.width = clampNum(w / d.rect.width, 0, 1) * 100 + '%'
        el.style.height = clampNum(h / d.rect.height, 0, 1) * 100 + '%'
      }
    }
    const up = (e) => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      const d = drawRef.current
      drawRef.current = null
      if (previewRef.current) previewRef.current.style.display = 'none'
      if (!d) return
      const x = Math.min(e.clientX, d.sx) - d.rect.left
      const y = Math.min(e.clientY, d.sy) - d.rect.top
      const w = Math.abs(e.clientX - d.sx)
      const h = Math.abs(e.clientY - d.sy)
      if (w / d.rect.width < 0.02 || h / d.rect.height < 0.02) return
      const rectNew = {
        x: clampNum(x / d.rect.width, 0, 1),
        y: clampNum(y / d.rect.height, 0, 1),
        w: clampNum(w / d.rect.width, 0.01, 1),
        h: clampNum(h / d.rect.height, 0.01, 1),
      }
      if (brush === 'obstacle') update({ obstacles: base.obstacles.concat([rectNew]) })
      else update({ walkable: base.walkable.concat([rectNew]) })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  // 拖动热点改位置
  const onHotspotDown = (idx, ev) => {
    if (ev.button && ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const box = boxRef.current ? boxRef.current.getBoundingClientRect() : null
    if (!box || !box.width || !box.height) return
    const cur = base.hotspots[idx] || {}
    const drag = { x: clampNum(cur.x, 0.02, 0.98), y: clampNum(cur.y, 0.05, 0.95), moved: false, el: ev.currentTarget }
    const move = (e) => {
      const nx = clampNum((e.clientX - box.left) / box.width, 0.02, 0.98)
      const ny = clampNum((e.clientY - box.top) / box.height, 0.05, 0.95)
      if (Math.abs(nx - drag.x) + Math.abs(ny - drag.y) > 0.002) drag.moved = true
      drag.x = nx
      drag.y = ny
      if (drag.el) { drag.el.style.left = (nx * 100) + '%'; drag.el.style.top = (ny * 100) + '%' }
    }
    const up = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      if (!drag.moved) return
      update({ hotspots: base.hotspots.map((h, i) => (i === idx ? Object.assign({}, h, { x: drag.x, y: drag.y }) : h)) })
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  }

  const setHotspotLabel = (idx, label) => {
    update({ hotspots: base.hotspots.map((h, i) => (i === idx ? Object.assign({}, h, { label: String(label || '').slice(0, 40) }) : h)) })
  }
  const addHotspot = () => {
    update({ hotspots: base.hotspots.concat([{ id: 'hs-' + Date.now().toString(36), label: '新热点', x: 0.5, y: 0.5, action: '' }]) })
  }
  const delHotspot = (idx) => { update({ hotspots: base.hotspots.filter((x, i) => i !== idx) }) }
  const delObstacle = (idx) => { update({ obstacles: base.obstacles.filter((x, i) => i !== idx) }) }
  const delWalk = (idx) => { update({ walkable: base.walkable.filter((x, i) => i !== idx) }) }

  // 服务端只接受 /models/、/assets/、/images/ 开头的背景图；这里先挡一次，免得保存后回读才报错
  const applyBg = () => {
    const url = String(bgText || '').trim()
    if (url && !/^\/(models|assets|images)\//.test(url)) {
      setElError('背景图路径要以 /models/、/assets/ 或 /images/ 开头（也可以直接上传）')
      return
    }
    setElError('')
    update({ background: url })
  }
  const clearBg = async () => {
    const hasMore = base.hotspots.length || base.obstacles.length || base.walkable.length
    if (hasMore) {
      const yes = await confirmDialog('清除背景图？', {
        detail: '服务端要求内部场景必须有背景图；清空后保存，热点 / 障碍 / 可走区域会一起被清掉。',
        danger: true,
        okText: '清除',
      })
      if (!yes) return
    }
    setBgText('')
    setElError('')
    update({ background: '' })
    toast('已清除背景（保存地点/地图后才写入服务端）')
  }

  const onPickFile = async (file) => {
    if (!file) return
    setUploading(true)
    setElError('')
    try {
      const read = await Api.readFileAsDataUrl(file, 8 * 1024 * 1024)
      if (!read.ok) { setElError(read.error || '读取图片失败'); return }
      const r = await Api.upload('/api/scene/image', { dataUrl: read.dataUrl })
      const d = r && r.ok ? (r.data || {}) : null
      if (d && d.ok !== false && d.url) {
        update({ background: String(d.url) })
        toast('背景图已上传（点「保存地点」再保存地图才写进数据）', 'ok')
      } else {
        setElError((d && d.error) || (r && r.error) || '上传失败')
      }
    } catch (e) {
      setElError((e && e.message) || '上传失败')
    } finally {
      setUploading(false)
    }
  }

  const rectDiv = (rectLike, idx, kind) => h('div', {
    key: kind + '-' + idx,
    title: '点一下删除这个' + (kind === 'obstacle' ? '障碍' : '可走区域'),
    onPointerDown: (ev) => { ev.stopPropagation() },
    onClick: (ev) => {
      ev.stopPropagation()
      if (kind === 'obstacle') delObstacle(idx)
      else delWalk(idx)
      toast('已删除' + (kind === 'obstacle' ? '障碍' : '可走区域'))
    },
    style: {
      position: 'absolute',
      left: pct(rectLike.x),
      top: pct(rectLike.y),
      width: pct(rectLike.w),
      height: pct(rectLike.h),
      background: kind === 'obstacle' ? 'rgba(239,83,80,.22)' : 'rgba(34,197,94,.18)',
      border: '1px dashed ' + (kind === 'obstacle' ? T.danger : T.ok),
      borderRadius: 3,
      cursor: 'pointer',
    },
  })

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
    h('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
      h('span', { style: { fontSize: 12, color: T.text2, flexShrink: 0 } }, '背景图'),
      h('span', { style: { flex: 1, minWidth: 140 } }, h(TextInput, {
        value: bgText,
        placeholder: '/models/scenes/xxx.jpg（也可以直接上传）',
        onChange: setBgText,
        onEnter: applyBg,
      })),
      h(Btn, { size: 'sm', onClick: applyBg }, '应用'),
      h(Btn, { size: 'sm', disabled: uploading, onClick: () => { if (fileRef.current) fileRef.current.click() } }, uploading ? '上传中…' : '上传'),
      h(Btn, { size: 'sm', kind: 'danger', onClick: clearBg }, '清除'),
      h('input', {
        type: 'file',
        accept: 'image/*',
        ref: fileRef,
        style: { display: 'none' },
        onChange: (e) => {
          const f = e.target.files && e.target.files[0]
          e.target.value = ''
          if (f) onPickFile(f)
        },
      }),
    ),
    elError ? h('div', { style: { fontSize: 11, color: T.danger, lineHeight: 1.6 } }, elError) : null,
    // 场景画布：热点可拖、障碍/可走可拖框画
    h('div', { ref: fit.ref, style: { width: '100%', minHeight: 1 } },
      boxW > 0
        ? h('div', {
            ref: boxRef,
            onPointerDown: onCanvasDown,
            style: {
              position: 'relative',
              width: boxW,
              height: boxH,
              margin: '0 auto',
              borderRadius: 10,
              border: '1px solid ' + T.border,
              overflow: 'hidden',
              background: T.bg2,
              cursor: brush ? 'crosshair' : 'default',
              touchAction: 'none',
              userSelect: 'none',
            },
          },
            img.src && bg && !img.error
              ? h('img', {
                  src: img.src,
                  alt: '',
                  draggable: false,
                  onLoad: (e) => {
                    const el = e.currentTarget
                    const nw = Number(el.naturalWidth) || 0
                    const nh = Number(el.naturalHeight) || 0
                    if (nw > 0 && nh > 0) setAspect(nw / nh)
                  },
                  style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' },
                })
              : h('div', { style: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, textAlign: 'center', fontSize: 11, color: T.text3 } },
                  bg ? '背景图加载失败（路径要 /models/ 开头）' : '还没有背景图：上传或填入 /models/ 地址后，这里会显示她的内部场景'),
            base.walkable.map((it, i) => rectDiv(it, i, 'walkable')),
            base.obstacles.map((it, i) => rectDiv(it, i, 'obstacle')),
            base.hotspots.map((hs, i) => h('div', {
              key: 'hs-pin-' + String(hs.id || i),
              title: '拖动改位置 · 热点「' + String(hs.label || '') + '」',
              onPointerDown: (ev) => onHotspotDown(i, ev),
              style: {
                position: 'absolute',
                left: pct(hs.x),
                top: pct(hs.y),
                transform: 'translate(-50%,-100%)',
                zIndex: 4,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                cursor: 'grab', userSelect: 'none',
              },
            },
              h('span', { style: { fontSize: 12, lineHeight: '15px', background: 'rgba(8,13,20,.82)', border: '1px solid ' + T.brand, borderRadius: 999, padding: '0 5px', color: T.text, whiteSpace: 'nowrap' } }, String(hs.label || '热点')),
              h('span', { style: { fontSize: 8.5, lineHeight: '11px', color: T.text3, whiteSpace: 'nowrap' } }, Number(hs.x || 0).toFixed(2) + ', ' + Number(hs.y || 0).toFixed(2)),
            )),
            h('div', { ref: previewRef, style: { position: 'absolute', display: 'none', border: '1px dashed ' + T.brand, background: 'rgba(47,107,216,.18)', pointerEvents: 'none' } }),
          )
        : null,
    ),
    h(Row, { gap: 6 },
      h(Chip, { active: brush === 'obstacle', onClick: () => setBrush(brush === 'obstacle' ? '' : 'obstacle') }, '🧱 画障碍'),
      h(Chip, { active: brush === 'walkable', onClick: () => setBrush(brush === 'walkable' ? '' : 'walkable') }, '🚶 画可走'),
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', onClick: () => { update({ obstacles: [] }); toast('已清空障碍（保存后才生效）') }, disabled: !base.obstacles.length }, '清空障碍'),
      h(Btn, { size: 'sm', onClick: () => { update({ walkable: [] }); toast('已清空可走区域（保存后才生效）') }, disabled: !base.walkable.length }, '清空可走'),
    ),
    h(Note, {}, '在背景图上拖一个框 = 新增；点已有框删除。障碍 ' + base.obstacles.length + ' 个 · 可走 ' + base.walkable.length + ' 个 · 坐标按背景图宽高 0~1 记录' + (brush ? '（当前正在画' + (brush === 'obstacle' ? '障碍' : '可走区域') + '）' : '') + '。'),
    h(Divider, {}),
    h(Row, { gap: 6 },
      h('span', { style: { fontSize: 12.5, fontWeight: 600, color: T.text } }, '热点'),
      h(Btn, { size: 'sm', onClick: addHotspot }, '+ 热点'),
      h('span', { style: { flex: 1 } }),
      h(Note, {}, '热点是场景里可点的位置（例如床/书桌），拖动图上的标签可改坐标'),
    ),
    base.hotspots.length
      ? base.hotspots.map((hs, i) => h('div', { key: 'hs-row-' + String(hs.id || i), style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { width: 22, flexShrink: 0, fontSize: 10.5, color: T.text3 } }, '#' + (i + 1)),
          h('span', { style: { flex: 1, minWidth: 80 } }, h(TextInput, { value: hs.label || '', placeholder: '热点名字', onChange: (v) => setHotspotLabel(i, v) })),
          h('span', { style: { width: 92, flexShrink: 0, textAlign: 'right', fontSize: 10, color: T.text3 } },
            Number(hs.x || 0).toFixed(2) + ', ' + Number(hs.y || 0).toFixed(2)),
          h(Btn, { size: 'sm', kind: 'danger', onClick: () => delHotspot(i) }, '删'),
        ))
      : h(Note, {}, '还没有热点。'),
  )
}

// ── 地点编辑（名字/图标/描述/感受 + 内部场景）─────────────────────────
function MapPlaceEditor(props) {
  const p = props || {}
  const initial = p.place || {}
  const [form, setForm] = React.useState(() => mapCloneJson(initial))
  const setField = (key, value) => setForm((f) => Object.assign({}, f || {}, { [key]: value }))
  const onSave = () => {
    const name = String(form.name || '').trim().slice(0, 20)
    if (!name) { toast('地点名字不能为空', 'error'); return }
    const next = Object.assign({}, form, {
      name,
      icon: String(form.icon || '').trim().slice(0, 4) || '📍',
      desc: String(form.desc || '').slice(0, 80),
      feel: String(form.feel || '').slice(0, 80),
      scene: form.scene || null,
    })
    if (p.onSave) p.onSave(next)
  }
  return h(Modal, {
    open: true,
    title: '编辑地点 · ' + String(initial.name || ''),
    onClose: p.onClose,
    width: 700,
    footer: h(Row, { gap: 8, justify: 'flex-end' },
      h(Btn, { onClick: p.onClose }, '取消'),
      h(Btn, { kind: 'primary', onClick: onSave }, '保存到草稿'),
    ),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 9 } },
      h(Row, { gap: 8, style: { alignItems: 'flex-start' } },
        h('div', { style: { width: 190, flexShrink: 0 } }, h(Field, { label: '名字（最多 20 字）' },
          h(TextInput, { value: form.name || '', placeholder: '地点名字', onChange: (v) => setField('name', String(v || '').slice(0, 20)) }))),
        h('div', { style: { width: 110, flexShrink: 0 } }, h(Field, { label: '图标（emoji）' },
          h(TextInput, { value: form.icon || '', placeholder: '📍', onChange: (v) => setField('icon', String(v || '').slice(0, 4)) }))),
        h('div', { style: { flex: 1, minWidth: 120, fontSize: 10.5, color: T.text3, lineHeight: 1.6, paddingTop: 18 } },
          '位置由地图上的钉决定：拖动钉即可改 x/y（0~1 归一化）。当前 x=' +
          Number(form.x || 0).toFixed(3) + ' · y=' + Number(form.y || 0).toFixed(3)),
      ),
      h(Field, { label: '描述', hint: '地图/详情里看到的一句话（≤80 字）' },
        h(TextArea, { rows: 2, value: form.desc || '', placeholder: '这是个什么地方', onChange: (v) => setField('desc', String(v || '').slice(0, 80)) })),
      h(Field, { label: '她的感受', hint: '她对这个地方的感觉，会参与生活模拟（≤80 字）' },
        h(TextArea, { rows: 2, value: form.feel || '', placeholder: '在这里她会觉得……', onChange: (v) => setField('feel', String(v || '').slice(0, 80)) })),
      h(Divider, {}),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
        h('div', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, '内部场景（2D）'),
        h(Note, {}, '「进入内部」时看到的画面。背景图上传后先存在 /models/ 下，点「保存到草稿」→ 再「保存」才会写进地图数据。'),
      ),
      h(MapSceneEditor, {
        scene: form.scene,
        placeName: form.name,
        onChange: (sc) => setField('scene', sc),
      }),
    ),
  )
}

// ── 旅行（跨城买票：/api/travel/options + /api/travel/ticket）──────────
function MapTravelModal(props) {
  const p = props || {}
  const opts = useApi('/api/travel/options')
  const [busy, setBusy] = React.useState('')
  const [err, setErr] = React.useState('')
  const d = opts.data || {}
  const from = d.from || {}
  const wallet = d.wallet || {}
  const options = Array.isArray(d.options) ? d.options : []

  const fmtDepart = (ms) => {
    const n = Number(ms) || 0
    if (!n) return ''
    try { return new Date(n).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' }
  }

  const buy = async (option, mode) => {
    if (busy) return
    const modeLabel = String(mode.label || mode.mode || '')
    const fare = Number(mode.fare) || 0
    const yes = await confirmDialog('买「' + modeLabel + '」去「' + String(option.name || '') + '」的票？', {
      detail: '票价 ' + (fare ? fare + ' 块' : '免费') + ' · 约 ' + (mode.minutes === undefined ? '?' : mode.minutes) + ' 分钟' +
        (mode.waitMinutes ? ' · 还要等 ' + mode.waitMinutes + ' 分钟' : '') +
        (mode.delayMinutes ? ' · 晚点 ' + mode.delayMinutes + ' 分钟' : ''),
      okText: '买票',
    })
    if (!yes) return
    setBusy(String(option.id) + ':' + String(mode.mode))
    setErr('')
    try {
      const r = await Api.post('/api/travel/ticket', {
        mapId: option.id,
        mode: mode.mode,
        waitMinutes: Number(mode.waitMinutes) || 0,
        delayMinutes: Number(mode.delayMinutes) || 0,
      })
      const res = mapResultOf(r)
      if (!res.ok) {
        setErr(res.reason || res.error || '买票失败')
        toast(res.reason || res.error || '买票失败', 'error')
        return
      }
      toast('票买好了，她出发去「' + String(option.name || '') + '」', 'ok')
      if (p.onDone) p.onDone()
    } catch (e) {
      setErr((e && e.message) || '买票失败')
    } finally {
      setBusy('')
    }
  }

  return h(Modal, {
    open: true,
    title: '🚉 旅行 · 跨城买票',
    onClose: p.onClose,
    width: 640,
    footer: h(Row, { gap: 8, justify: 'flex-end' }, h(Btn, { onClick: p.onClose }, '关闭')),
  },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
      opts.error && !opts.data
        ? h(ErrorBox, { title: '旅行选项读取失败', error: opts.error, onRetry: opts.reload })
        : null,
      opts.loading && !opts.data ? h(Loading, { text: '正在查班次…' }) : null,
      opts.data
        ? h('div', { style: { fontSize: 12, color: T.text2, lineHeight: 1.7 } },
            '从「' + String(from.name || '当前地图') + '」出发 · 她的余额 ' + fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 块 · 买票后她会自己坐车过去，到站跟你说。')
        : null,
      err ? h(ErrorBox, { title: '买票失败', error: err, onRetry: () => setErr('') }) : null,
      options.length
        ? options.map((option) => h(Card, {
            key: String(option.id),
            title: String(option.name || option.id),
            sub: '约 ' + String(option.km === undefined ? '?' : option.km) + ' km',
            tag: '目的地',
          },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              (Array.isArray(option.modes) ? option.modes : []).map((mode) => h('button', {
                key: String(mode.mode),
                type: 'button',
                disabled: !!busy || mode.canAfford === false,
                title: mode.canAfford === false ? '余额不够' : ('买「' + String(mode.label || '') + '」票'),
                onClick: () => buy(option, mode),
                className: 'sbc-btn',
                style: {
                  display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
                  border: '1px solid ' + (mode.canAfford === false ? T.border : T.border2),
                  borderRadius: 9, background: 'rgba(127,127,127,.06)',
                  color: T.text, padding: '7px 10px', cursor: (busy || mode.canAfford === false) ? 'default' : 'pointer',
                  opacity: (busy || mode.canAfford === false) ? 0.55 : 1,
                  fontFamily: T.font, fontSize: 12.5,
                },
              },
                h('span', { style: { fontSize: 15 } }, String(mode.icon || '🚌')),
                h('span', { style: { fontWeight: 600, flexShrink: 0 } }, String(mode.label || mode.mode || '')),
                h('span', { style: { color: T.text2, flexShrink: 0 } }, (mode.minutes === undefined ? '?' : mode.minutes) + ' 分钟'),
                h('span', { style: { color: mode.fare ? T.warn : T.ok, flexShrink: 0 } }, mode.fare ? (mode.fare + ' 块') : '免费'),
                h('span', { style: { flex: 1, minWidth: 0, color: T.text3, fontSize: 11, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                  (mode.canAfford === false ? '余额不够 · ' : '') +
                  (mode.waitMinutes ? '等 ' + mode.waitMinutes + ' 分钟 · ' : '') +
                  (mode.delayMinutes ? '晚点 ' + mode.delayMinutes + ' 分钟 · ' : '') +
                  (mode.nextDeparture ? fmtDepart(mode.nextDeparture) + ' 发车' : '')),
                h(Btn, { size: 'sm', kind: 'primary', disabled: !!busy || mode.canAfford === false }, busy === String(option.id) + ':' + String(mode.mode) ? '买票中…' : '买票'),
              )),
            ),
          ))
        : (opts.data ? h(Empty, { icon: '🚉' }, '没有别的城市可以去（当前只有一张地图）。') : null),
    ),
  )
}

// ── 主视图：地图查看 + 基础编辑（D04 B）────────────────────────────────
function MapView(props) {
  const p = props || {}
  const mapApi = useApi('/api/map')
  const worldApi = useApi('/api/world/characters', { refreshMs: 5000 })
  const data = mapApi.data
  const map = (data && data.map) || {}
  const maps = (data && Array.isArray(data.maps)) ? data.maps : []
  const serverPlaces = Array.isArray(map.places) ? map.places : []
  const characters = (worldApi.data && Array.isArray(worldApi.data.characters)) ? worldApi.data.characters : []
  const location = (data && data.location) || {}
  const activeMapId = data ? String(data.activeMapId || '') : ''

  const [selMapId, setSelMapId] = React.useState('')
  const [editMode, setEditMode] = React.useState(false)
  const [editMapId, setEditMapId] = React.useState('')
  const [draftPlaces, setDraftPlaces] = React.useState(null)
  const [dirty, setDirty] = React.useState(false)
  const [baseRev, setBaseRev] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState('')
  const [saveInfo, setSaveInfo] = React.useState('')
  const [busyPlaceId, setBusyPlaceId] = React.useState('')
  const [mapBusy, setMapBusy] = React.useState('')
  const [actionError, setActionError] = React.useState('')
  const [viewPlace, setViewPlace] = React.useState(null)
  const [editingPlace, setEditingPlace] = React.useState(null)
  const [travelOpen, setTravelOpen] = React.useState(false)
  const imageInputRef = React.useRef(null)

  const mapSelectValue = selMapId || activeMapId
  const places = editMode && Array.isArray(draftPlaces) ? draftPlaces : serverPlaces
  const readFailed = !!mapApi.error
  const canSave = editMode && !!draftPlaces && dirty && !saving && !readFailed && !!data

  React.useEffect(() => {
    if (activeMapId) setSelMapId(activeMapId)
  }, [activeMapId])

  // 跨城到达 / 别的页面切了地图：编辑中的草稿属于旧地图，直接退出，避免覆盖新地图
  React.useEffect(() => {
    if (!editMode) return
    const id = data && data.map ? String(data.map.id || '') : ''
    if (id && editMapId && id !== editMapId) {
      setEditMode(false)
      setEditMapId('')
      setDraftPlaces(null)
      setDirty(false)
      setSaveError('')
      setSaveInfo('')
      toast('地图已经切换，编辑模式已退出', 'error')
    }
  }, [editMode, editMapId, data])

  // 非编辑状态低频刷新（旅行到达 / 天气 / 精力）；编辑中不自动刷新，避免冲掉草稿
  useInterval(() => { mapApi.reload() }, 15000, !editMode)

  const readRev = async () => {
    const rev = await mapReadBaseRev()
    setBaseRev(rev)
    return rev
  }

  const startEdit = async () => {
    if (!data || !data.map) { toast('地图还没读出来，先刷新', 'error'); return }
    if (readFailed) { toast('地图数据读取失败，修好读取再编辑（读失败禁止保存）', 'error'); return }
    setDraftPlaces(mapCloneJson(serverPlaces))
    setEditMapId(String(data.map.id))
    setEditMode(true)
    setDirty(false)
    setSaveError('')
    setSaveInfo('')
    setActionError('')
    await readRev()
  }

  const cancelEdit = async () => {
    if (dirty) {
      const yes = await confirmDialog('放弃这次未保存的地图修改？', { detail: '没保存的改动会丢掉（服务端数据没动过）。', danger: true, okText: '放弃' })
      if (!yes) return
    }
    setEditMode(false)
    setEditMapId('')
    setDraftPlaces(null)
    setDirty(false)
    setSaveError('')
    setSaveInfo('')
    setEditingPlace(null)
    mapApi.reload()
  }

  const toggleEdit = async () => {
    if (editMode) { await cancelEdit(); return }
    await startEdit()
  }

  const movePlace = (placeId, x, y) => {
    setDraftPlaces((prev) => {
      const list = Array.isArray(prev) ? prev : mapCloneJson(serverPlaces)
      return list.map((it) => (String(it.id) === String(placeId)
        ? Object.assign({}, it, { x: clampNum(x, 0.05, 0.95), y: clampNum(y, 0.08, 0.92) })
        : it))
    })
    setDirty(true)
  }

  // 从查看/列表进入某个地点的编辑：必要时自动进编辑模式
  const startEditPlace = async (place) => {
    if (!place) return
    if (readFailed) { toast('地图数据读取失败，修好读取再编辑（读失败禁止保存）', 'error'); return }
    let list = editMode && Array.isArray(draftPlaces) ? draftPlaces : null
    if (!list) {
      list = mapCloneJson(serverPlaces)
      setDraftPlaces(list)
      setEditMapId(String((data && data.map && data.map.id) || ''))
      setEditMode(true)
      setDirty(false)
      setSaveError('')
      setSaveInfo('')
      readRev()
    }
    const cur = list.find((it) => String(it.id) === String(place.id)) || place
    setEditingPlace(mapCloneJson(cur))
    setViewPlace(null)
  }

  const commitPlace = (next) => {
    if (!next) return
    setDraftPlaces((prev) => {
      const list = Array.isArray(prev) ? prev : mapCloneJson(serverPlaces)
      return list.map((it) => (String(it.id) === String(next.id) ? next : it))
    })
    setDirty(true)
    setEditingPlace(null)
    setSaveInfo('')
    toast('已更新到草稿，点「保存」写入服务端')
  }

  const saveDraft = async () => {
    if (!data || !data.map || !draftPlaces || saving) return
    if (readFailed) { setSaveError('地图数据读取失败，禁止保存（先点「刷新」重试读取）'); return }
    setSaving(true)
    setSaveError('')
    setSaveInfo('')
    try {
      const sent = mapCloneJson(draftPlaces)
      const body = { mapId: String(data.map.id), places: sent }
      if (baseRev !== null && baseRev !== undefined) body.expectedRev = baseRev
      const r = await Api.post('/api/map', body)
      if (!r.ok) {
        let msg = r.error || '保存失败'
        if (r.status === 409) msg = msg + '（本次没有覆盖任何东西；点「重新读取地图」后再改）'
        setSaveError(msg)
        toast(msg, 'error')
        return
      }
      const d = r.data || {}
      if (d.ok === false) { setSaveError(d.error || '保存失败'); return }
      // 回读验证：真的落盘了吗？旧字段还在吗？（「刷新不丢」的自检）
      const back = await Api.get('/api/map')
      if (!back.ok) {
        setSaveError('已提交，但回读失败：' + (back.error || '') + '（点「重新读取地图」确认）')
        return
      }
      const fresh = back.data || {}
      if (!fresh.map || String(fresh.map.id) !== String(body.mapId)) {
        setSaveError('回读到的不是同一张地图，先不要继续编辑，点「重新读取地图」')
        return
      }
      const problems = mapPlacesDiff(sent, fresh.map.places)
      mapApi.setData(fresh)
      setDraftPlaces(mapCloneJson(fresh.map.places || []))
      setDirty(false)
      if (problems.length) {
        setSaveError('保存后回读不一致（服务端可能规范化了字段）：' + problems.join('；'))
        toast('保存后回读不一致，请看提示', 'error')
        return
      }
      setSaveInfo('已保存，回读确认 ' + ((fresh.map.places || []).length) + ' 个地点（刷新不会丢）')
      toast('地图已保存', 'ok')
      await readRev()
    } catch (e) {
      setSaveError((e && e.message) || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const reloadMap = async () => {
    setSaveError('')
    setSaveInfo('')
    mapApi.reload()
    worldApi.reload()
    await readRev()
  }

  // 同图移动：/api/location（不是瞬移，会按出行方式走；夜里/没钱会被拒绝）
  const goPlace = async (place) => {
    if (!place || busyPlaceId) return false
    if (location.state === 'stationary' && String(location.placeId) === String(place.id)) {
      setViewPlace(null)
      toast('她已经在这儿了')
      return true
    }
    setBusyPlaceId(String(place.id))
    setActionError('')
    try {
      let r = await Api.post('/api/location', { placeId: String(place.id) })
      let res = mapResultOf(r)
      if (!res.ok && res.refused && res.needsConfirm) {
        const yes = await confirmDialog(res.reason || '她有点犹豫，确定让她去吗？', { detail: '确定就让她去，她会跟你报备。', okText: '让她去' })
        if (!yes) return false
        r = await Api.post('/api/location', { placeId: String(place.id), confirmNight: true })
        res = mapResultOf(r)
      }
      if (!res.ok) {
        const msg = res.reason || res.error || '出行失败'
        setActionError(msg)
        toast(msg, 'error')
        return false
      }
      setViewPlace(null)
      toast('她出门了：前往「' + String(place.name || '') + '」', 'ok')
      mapApi.reload()
      worldApi.reload()
      return true
    } catch (e) {
      const msg = (e && e.message) || '出行失败'
      setActionError(msg)
      toast(msg, 'error')
      return false
    } finally {
      setBusyPlaceId('')
    }
  }

  // 切地图 = 跨城旅行（/api/map/activate；可能被拒绝/需要确认）
  const switchMap = async (nextId) => {
    const id = String(nextId || '')
    setSelMapId(id)
    const back = () => setSelMapId(activeMapId)
    if (!data || !id || id === activeMapId) { back(); return }
    if (mapBusy) { back(); return }
    if (editMode) {
      toast('先退出编辑模式再切地图', 'error')
      back()
      return
    }
    const target = maps.find((m) => String(m.id) === id) || {}
    const yes = await confirmDialog('让她去「' + String(target.name || id) + '」？', {
      detail: '这是跨城移动：要买票/等车，路上要几分钟，到了会自动切到那张地图。只想看看别的地图可以点「取消」。',
      okText: '出发',
    })
    if (!yes) { back(); return }
    setMapBusy('switch')
    setActionError('')
    try {
      let r = await Api.post('/api/map/activate', { id })
      let res = mapResultOf(r)
      if (!res.ok && res.refused && res.needsConfirm) {
        const again = await confirmDialog(res.reason || '她有点犹豫，确定让她去吗？', { okText: '让她去' })
        if (!again) { back(); return }
        r = await Api.post('/api/map/activate', { id, confirmNight: true })
        res = mapResultOf(r)
      }
      if (!res.ok) {
        const msg = res.reason || res.error || '切换地图失败'
        setActionError(msg)
        toast(msg, 'error')
        back()
        return
      }
      toast('票买好了，她出发去「' + String(target.name || id) + '」了', 'ok')
      // 跨城是"在路上"，地图要等她到了服务端才切；先保留下拉显示当前地图
      back()
      mapApi.reload()
    } catch (e) {
      const msg = (e && e.message) || '切换地图失败'
      setActionError(msg)
      toast(msg, 'error')
      back()
    } finally {
      setMapBusy('')
    }
  }

  const newMap = async () => {
    if (mapBusy || saving) return
    if (editMode) { toast('先退出编辑模式再新建地图', 'error'); return }
    const name = await promptDialog('新地图叫什么？', { title: '新建地图', detail: '新地图会带一套默认地点和 2D 底图。', placeholder: '例如：安溪镇' })
    if (!name || !String(name).trim()) return
    const nm = String(name).trim().slice(0, 20)
    setMapBusy('create')
    try {
      const r = await Api.post('/api/map/create', { name: nm })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '创建失败', 'error'); return }
      toast('已创建「' + nm + '」', 'ok')
      await reloadMap()
      if (d.id) {
        const go = await confirmDialog('现在让她搬去「' + nm + '」吗？', { detail: '不搬也可以，之后在地图下拉里随时能切。', okText: '现在过去' })
        if (go) {
          const r2 = await Api.post('/api/map/activate', { id: d.id, instant: true })
          const res2 = mapResultOf(r2)
          if (!res2.ok) toast(res2.reason || res2.error || '切换失败', 'error')
          await reloadMap()
        }
      }
    } catch (e) {
      toast((e && e.message) || '创建失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const delMap = async () => {
    if (mapBusy || saving || !data || !data.map) return
    if (maps.length <= 1) { toast('至少保留一张地图', 'error'); return }
    if (editMode) { toast('先退出编辑模式再删地图', 'error'); return }
    const yes = await confirmDialog('删除「' + String(data.map.name || '') + '」这张地图？', {
      detail: '地图和地点会一起删掉，不能撤销；至少会保留一张地图。',
      danger: true,
      okText: '删除',
    })
    if (!yes) return
    setMapBusy('delete')
    try {
      const r = await Api.post('/api/map/delete', { id: data.map.id })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '删除失败', 'error'); return }
      toast('已删除这张地图', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '删除失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const renameMap = async () => {
    if (mapBusy || saving || !data || !data.map) return
    const name = await promptDialog('地图叫什么？', { title: '改地图名', value: String(data.map.name || ''), placeholder: '最多 20 字' })
    if (!name || !String(name).trim()) return
    setMapBusy('rename')
    try {
      const r = await Api.post('/api/map', { mapId: data.map.id, name: String(name).trim().slice(0, 20) })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '改名失败', 'error'); return }
      toast('已改名', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '改名失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const uploadMapImage = async (file) => {
    if (!file || !data || !data.map || mapBusy) return
    setMapBusy('image')
    setActionError('')
    try {
      const read = await Api.readFileAsDataUrl(file, 8 * 1024 * 1024)
      if (!read.ok) { toast(read.error || '读取图片失败', 'error'); return }
      const r = await Api.upload('/api/map/image', { mapId: data.map.id, dataUrl: read.dataUrl })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '上传失败', 'error'); return }
      toast('底图已上传', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '上传失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const clearMapImage = async () => {
    if (!data || !data.map || mapBusy) return
    const yes = await confirmDialog('清除这张地图的 2D 底图？', { detail: '只清底图，地点和坐标都会保留。', danger: true, okText: '清除' })
    if (!yes) return
    setMapBusy('image')
    try {
      const r = await Api.upload('/api/map/image', { mapId: data.map.id, dataUrl: '' })
      const d = r && r.ok ? (r.data || {}) : null
      if (!d || d.ok === false) { toast((d && d.error) || (r && r.error) || '清除失败', 'error'); return }
      toast('底图已清除', 'ok')
      await reloadMap()
    } catch (e) {
      toast((e && e.message) || '清除失败', 'error')
    } finally {
      setMapBusy('')
    }
  }

  const peopleOf = (placeId) => characters.filter((c) => c && c.sameMap && String(c.placeId) === String(placeId) && c.state === 'stationary')

  const rootStyle = {
    flex: 1, minHeight: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
    background: T.bg, color: T.text, fontFamily: T.font, fontSize: 13,
    padding: 10, gap: 8, boxSizing: 'border-box',
  }

  if (!data) {
    return h('div', { style: rootStyle },
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 16 } },
        mapApi.loading
          ? h(Loading, { text: '地图加载中…' })
          : h(ErrorBox, { title: '地图加载失败', error: mapApi.error || '没有拿到地图数据', onRetry: () => { mapApi.reload(); worldApi.reload() } }),
      ),
    )
  }

  const locationText = location.state === 'intercity' && location.intercity
    ? ('她正在跨城：' + String(location.intercity.fromMapName || '这里') + ' → ' + String(location.intercity.toMapName || '目的地') +
      ' · ' + String(location.intercity.modeIcon || '') + String(location.intercity.modeLabel || '') +
      ' · 约 ' + Math.max(1, Math.ceil((Number(location.intercity.etaSec) || 0) / 60)) + ' 分钟')
    : location.state === 'traveling' && location.traveling
      ? ('她在路上：' + String(location.traveling.fromName || '') + ' → ' + String(location.traveling.toName || '') +
        ' · ' + String(location.traveling.modeIcon || '') + String(location.traveling.modeLabel || '') +
        ' · 约 ' + Math.max(1, Math.ceil((Number(location.traveling.etaSec) || 0) / 60)) + ' 分钟')
      : ('她在「' + String(location.name || location.placeName || '不知道在哪') + '」' +
        (Number(location.minutes) > 0 ? '（已待 ' + Number(location.minutes) + ' 分钟）' : '') +
        ' · 这张地图：' + String(map.name || '') + '（' + serverPlaces.length + ' 个地点）')

  const currentIntercity = location.state === 'intercity' && location.intercity ? location.intercity : null
  const currentTraveling = location.state === 'traveling' && location.traveling ? location.traveling : null
  const journeyProgress = currentIntercity
    ? stageTravelProgress(currentIntercity)
    : (currentTraveling ? stageTravelProgress(currentTraveling) : 0)

  return h('div', { style: rootStyle },
    // 顶部工具条：地图切换 / 状态 / 编辑 / 旅行 / 刷新
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0 } },
      h('span', { style: { width: 210, flexShrink: 0 } }, h(Select, {
        value: mapSelectValue,
        disabled: !!mapBusy || editMode,
        title: editMode ? '先退出编辑模式再切地图' : '切换地图（跨城会真的移动她）',
        options: maps.map((m) => ({ value: String(m.id), label: String(m.name || m.id) + '（' + (m.placeCount || 0) + ' 个地点）' })),
        onChange: switchMap,
      })),
      h(Badge, { tone: map.has2d ? 'ok' : 'warn', title: '这张地图有没有 2D 底图' }, map.has2d ? '2D 底图' : '没有 2D 底图'),
      map.has3d ? h(Badge, { title: '这张地图有 3D 资源；本版客户端只做 2D（D03 B / M07）' }, '有 3D 资源 · 本版显示 2D') : null,
      dirty ? h(Badge, { tone: 'warn', title: '有改动还没保存' }, '未保存') : null,
      h('span', { style: { flex: 1 } }),
      h(Btn, { size: 'sm', disabled: mapApi.loading || !!mapBusy, onClick: () => { reloadMap() } }, mapApi.loading ? '刷新中…' : '刷新'),
      h(Btn, { size: 'sm', kind: editMode ? 'primary' : 'ghost', disabled: !!mapBusy || readFailed, onClick: toggleEdit, title: readFailed ? '地图读取失败，禁止编辑/保存' : '' },
        editMode ? '完成编辑' : '编辑地图'),
      h(Btn, { size: 'sm', disabled: !!mapBusy, onClick: () => setTravelOpen(true) }, '🚉 旅行'),
    ),
    // 编辑工具条
    editMode
      ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: '6px 8px', borderRadius: 10,
            border: '1px solid ' + (dirty ? T.warn : T.border), background: 'rgba(127,127,127,.07)',
          },
        },
          h('span', { style: { fontSize: 11.5, color: T.text2 } },
            dirty ? '有未保存的修改：拖动地点钉 / 编辑地点后点「保存」写到服务端' : '编辑模式：拖动地图上的地点钉改坐标，点地点列表可改名字/内部场景'),
          h('span', { style: { flex: 1 } }),
          h(Btn, {
            size: 'sm', kind: 'primary', disabled: !canSave, onClick: saveDraft,
            title: readFailed ? '地图读取失败，禁止保存' : (dirty ? '保存地点到服务端' : '没有要保存的修改'),
          }, saving ? '保存中…' : '保存'),
          h(Btn, { size: 'sm', disabled: saving, onClick: () => { imageInputRef.current && imageInputRef.current.click() } }, mapBusy === 'image' ? '上传中…' : '上传底图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: clearMapImage }, '清除底图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: newMap }, '新建地图'),
          h(Btn, { size: 'sm', disabled: saving || !!mapBusy, onClick: renameMap }, '改名'),
          h(Btn, { size: 'sm', kind: 'danger', disabled: saving || !!mapBusy || maps.length <= 1, onClick: delMap }, '删除地图'),
          h(Btn, { size: 'sm', onClick: cancelEdit, disabled: saving }, '退出编辑'),
          h('input', {
            type: 'file', accept: 'image/*', ref: imageInputRef, style: { display: 'none' },
            onChange: (e) => {
              const f = e.target.files && e.target.files[0]
              e.target.value = ''
              if (f) uploadMapImage(f)
            },
          }),
        )
      : null,
    // 读失败 / 保存失败 / 出行失败：都给出可重试的错误态（N03）
    readFailed
      ? h(ErrorBox, { title: '地图读取失败（已禁止保存）', error: mapApi.error || '读不到地图数据', onRetry: () => { mapApi.reload(); worldApi.reload() } })
      : null,
    saveError
      ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 } },
          h('span', { style: { flex: 1, minWidth: 0 } }, h(ErrorBox, { title: '保存失败', error: saveError, onRetry: saving ? undefined : saveDraft })),
          h(Btn, { size: 'sm', onClick: reloadMap }, '重新读取地图'),
        )
      : null,
    actionError
      ? h(Row, { gap: 8, style: { flexShrink: 0 } },
          h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: T.danger, lineHeight: 1.6 } }, actionError),
          h(Btn, { size: 'sm', onClick: () => setActionError('') }, '知道了'),
        )
      : null,
    // 主体：左地图 + 右信息/地点列表
    h('div', { style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', gap: 10 } },
      h('div', { style: { flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 } },
        h(MapCanvas, {
          map: map,
          places: places,
          characters: characters,
          location: location,
          editMode: editMode,
          busyPlaceId: busyPlaceId,
          onPlaceClick: (place) => setViewPlace(place),
          onPlaceMove: movePlace,
        }),
        // 底部状态行（位置 / 行程进度 / 保存回读结果）
        h('div', { style: { flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 } },
          h('div', { style: { fontSize: 11.5, color: T.text2, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, title: locationText }, locationText),
          journeyProgress > 0
            ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                h('div', { style: { flex: 1, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
                  h('div', { style: { width: Math.round(journeyProgress * 100) + '%', height: '100%', background: T.brand } })),
                h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap' } }, Math.round(journeyProgress * 100) + '%'),
                h(Btn, { size: 'sm', onClick: () => { mapApi.reload(); worldApi.reload() } }, '刷新进度'),
              )
            : null,
          saveInfo
            ? h('div', { style: { fontSize: 10.5, color: T.ok, lineHeight: 1.5 } }, saveInfo)
            : null,
        ),
      ),
      h('div', {
        className: 'sbc-scroll',
        style: { width: 300, flexShrink: 0, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
      },
        // 当前状态 / 角色位置
        h(Card, {
          title: '当前状态',
          tag: editMode ? '编辑中' : '',
          actions: h(Btn, { size: 'sm', onClick: () => { worldApi.reload(); mapApi.reload() } }, '刷新'),
        },
          h('div', { style: { fontSize: 11.5, color: T.text2, lineHeight: 1.7 } }, locationText),
          currentIntercity || currentTraveling
            ? h(Note, {}, '跨城/赶路要几分钟；到了之后点「刷新」就能看到新地图。')
            : null,
          h(Divider, {}),
          worldApi.error
            ? h(Row, { gap: 8 }, h('span', { style: { flex: 1, minWidth: 0, fontSize: 11, color: T.danger } }, '角色位置读取失败：' + worldApi.error),
                h(Btn, { size: 'sm', onClick: () => worldApi.reload() }, '重试'))
            : (characters.length
              ? characters.map((c) => h(Row, { key: String(c.id), gap: 6, style: { alignItems: 'flex-start' } },
                  h(Avatar, { path: c.avatar, name: c.name, size: 22 }),
                  h('span', { style: { flex: 1, minWidth: 0, fontSize: 11.5, color: T.text2, lineHeight: 1.6 } },
                    h('span', { style: { color: c.isActive ? T.text : T.text2, fontWeight: c.isActive ? 600 : 400 } }, String(c.name || '')),
                    h('br'),
                    (c.sameMap ? mapCharStatus(c) : ('在「' + String(c.mapName || '别的城市') + '」' + (c.state === 'intercity' ? ' · 跨城中' : '')))),
                ))
              : h(Note, {}, '没有读到角色位置。')),
        ),
        // 地点列表
        h(Card, {
          title: '地点',
          tag: places.length + ' 个',
          actions: h(Btn, {
            size: 'sm',
            disabled: readFailed,
            title: editMode ? '新增地点（会先创建在中间，再拖动定位）' : '进入编辑模式后可新增地点',
            onClick: () => {
              if (!editMode) { startEdit(); return }
              setDraftPlaces((prev) => {
                const list = Array.isArray(prev) ? prev.slice() : mapCloneJson(serverPlaces)
                list.push({
                  id: 'p-' + Date.now().toString(36),
                  name: '新地点',
                  icon: '📍',
                  x: 0.5,
                  y: 0.5,
                  desc: '',
                  feel: '',
                  image: null,
                  scene: null,
                })
                return list
              })
              setDirty(true)
              toast('已新增「新地点」（草稿），拖动定位后点保存')
            },
          }, editMode ? '+ 新增地点' : '编辑'),
        },
          places.length
            ? places.map((place) => {
                const here = String(location.placeId) === String(place.id) && location.state === 'stationary'
                const count = peopleOf(place.id).length
                return h('button', {
                  key: String(place.id),
                  type: 'button',
                  className: 'sbc-btn',
                  title: editMode ? ('编辑「' + String(place.name || '') + '」') : ('查看「' + String(place.name || '') + '」'),
                  onClick: () => { if (editMode) startEditPlace(place); else setViewPlace(place) },
                  style: {
                    display: 'flex', alignItems: 'center', gap: 7, width: '100%',
                    border: '1px solid ' + (here ? T.brand : T.border),
                    background: here ? 'rgba(47,107,216,.10)' : 'rgba(127,127,127,.05)',
                    borderRadius: 9, padding: '6px 8px', cursor: 'pointer',
                    color: T.text, textAlign: 'left', fontFamily: T.font,
                  },
                },
                  h('span', { style: { fontSize: 15, flexShrink: 0 } }, place.icon || '📍'),
                  h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 } },
                    h('span', { style: { fontSize: 12.5, color: here ? T.text : T.text, fontWeight: here ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                      String(place.name || '') + (here ? ' · 她现在在这' : '')),
                    h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                      Number(place.x || 0).toFixed(2) + ', ' + Number(place.y || 0).toFixed(2) +
                      (count ? ' · 这里 ' + count + ' 人' : '') +
                      (place.desc ? ' · ' + String(place.desc) : '')),
                  ),
                  h('span', { style: { fontSize: 10, color: T.text3, flexShrink: 0 } }, editMode ? '编辑' : '详情'),
                )
              })
            : h(Empty, { icon: '📍' }, '这张地图还没有地点。编辑模式下可以新增。'),
        ),
        // 旅行入口
        h(Card, { title: '旅行入口', tag: '跨城' },
          h(Note, {}, '跨城去别的地图：先到车站买票，班次/票价由服务端算。也可以直接在地图下拉里切换（会真的移动她）。'),
          h(Row, { gap: 6 },
            h(Btn, { size: 'sm', kind: 'primary', disabled: !!mapBusy, onClick: () => setTravelOpen(true) }, '打开旅行面板'),
            h(Btn, { size: 'sm', disabled: !!mapBusy, onClick: () => switchMap(maps.find((m) => String(m.id) !== activeMapId) ? maps.find((m) => String(m.id) !== activeMapId).id : '') }, '直接换城市'),
          ),
        ),
        // 编辑说明
        editMode
          ? h(Card, { title: '基础编辑说明', tag: 'D04 B' },
              h(Note, {}, '· 拖动地图上的地点钉 = 改 x/y（0~1 归一化），松开鼠标才记一次；'),
              h(Note, {}, '· 点地点列表「编辑」= 改名字/图标/描述/感受 + 内部场景（背景图、热点、障碍、可走区域）；'),
              h(Note, {}, '· 所有改动先存草稿，点「保存」才会 POST /api/map 写服务端；保存后会回读比对，确认刷新不丢；'),
              h(Note, {}, '· 读不到地图数据时保存按钮会被禁用（读失败禁存）。'),
            )
          : null,
      ),
    ),
    // 弹层
    viewPlace
      ? h(MapPlaceModal, {
          place: viewPlace,
          people: peopleOf(viewPlace.id),
          busy: !!busyPlaceId,
          onClose: () => setViewPlace(null),
          onGo: goPlace,
          onEdit: startEditPlace,
        })
      : null,
    editingPlace
      ? h(MapPlaceEditor, {
          place: editingPlace,
          onClose: () => setEditingPlace(null),
          onSave: commitPlace,
        })
      : null,
    travelOpen
      ? h(MapTravelModal, {
          onClose: () => setTravelOpen(false),
          onDone: () => { setTravelOpen(false); mapApi.reload(); worldApi.reload() },
        })
      : null,
  )
}
