// 20-stage/stage.js —— 舞台（2D 底图 + 3D 舞台；原生实现，替代 runtime/stage.html 与 model.html）
//
// 契约：function StageView(props)；props.compact=true 表示聊天分屏里的小尺寸。
// 数据：GET /api/stage（useApi 轮询 STAGE_POLL_MS；不再自己 setInterval + 每秒重建 DOM）
//      点击地点：POST /api/location { placeId, instant:true }；被拒绝（refused）时显示 reason。
// 范围：2D（底图/地点钉/角色）+ 3D（ThreeStage，见 20-stage/three3d.js）。
//      3D 需要 WebGL；不可用时自动回退 2D 并留下说明，不白屏、不崩（M06/M07）。
//
// 静态部分（底图/地点钉）只在数据变化时重建；角色位置沿用旧网页的 left/top 百分比 + CSS
// transition，行程中平滑移动，不逐帧改写 DOM（N04）。3D 分支由 ThreeStage 自己全权接管渲染与清理。

const STAGE_MAP_ASPECT_FALLBACK = 1000 / 640

// ── 通用小工具（map.js 也复用；名字带前缀避免和别的模块撞）─────────────────
// 容器尺寸：用 callback ref 拿元素（元素可能在首帧之后才挂上，比如先加载态再有数据），
// ResizeObserver 优先、window.resize 兜底；测不到时是 0（首帧不渲染地图框）。
// 用法：const fit = sbcFitUseSize(可选的外部 refObject)；渲染时 ref: fit.ref；读 fit.size。
function sbcFitUseSize(extraRef) {
  const [el, setEl] = React.useState(null)
  const [size, setSize] = React.useState({ w: 0, h: 0 })
  const ref = React.useCallback((node) => {
    if (extraRef) extraRef.current = node || null
    setEl(node || null)
  }, [extraRef])
  // 优先 layout effect：量完再画，避免地图框先按 0 尺寸闪一帧
  const useIso = React.useLayoutEffect || React.useEffect
  useIso(() => {
    if (!el) return undefined
    const read = () => {
      const w = Math.max(0, Math.round(Number(el.clientWidth) || 0))
      const h = Math.max(0, Math.round(Number(el.clientHeight) || 0))
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }))
    }
    read()
    let ro = null
    try {
      if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(read); ro.observe(el) }
    } catch (e) { ro = null }
    window.addEventListener('resize', read)
    return () => {
      try { if (ro) ro.disconnect() } catch (e) {}
      window.removeEventListener('resize', read)
    }
  }, [el])
  return { ref, size, el }
}

// 在容器里按宽高比居中铺满（和旧 stage.html 的 fitMapView 同一套算法，底图不变形）
function sbcFitRect(size, aspect) {
  const cw = Math.max(0, Number(size && size.w) || 0)
  const ch = Math.max(0, Number(size && size.h) || 0)
  const ar = Number(aspect) > 0.05 ? Number(aspect) : STAGE_MAP_ASPECT_FALLBACK
  if (!cw || !ch) return { w: 0, h: 0, left: 0, top: 0 }
  let w = cw
  let h = w / ar
  if (h > ch) { h = ch; w = h * ar }
  return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)), left: Math.round((cw - w) / 2), top: Math.round((ch - h) / 2) }
}

// 行程进度：用 startedAt/durationMs 现算（轮询间隔里也能走），服务端 progress 兜底
function stageTravelProgress(traveling) {
  if (!traveling) return 0
  const dur = Math.max(1, Number(traveling.durationMs) || 0)
  const started = Number(traveling.startedAt) || 0
  if (started > 0 && dur > 1) return clampNum((Date.now() - started) / dur, 0, 1)
  return clampNum(traveling.progress, 0, 1)
}

// 路径上第 progress（0~1）处的点；没有路径时返回 null
function sbcPointOnPath(path, progress) {
  const pts = Array.isArray(path) ? path : []
  if (pts.length < 2) return null
  const prog = clampNum(progress, 0, 1)
  let total = 0
  const segs = []
  for (let i = 0; i < pts.length - 1; i++) {
    const d = Math.hypot(Number(pts[i].x) - Number(pts[i + 1].x), Number(pts[i].y) - Number(pts[i + 1].y))
    segs.push(d)
    total += d
  }
  if (!(total > 0)) return { x: Number(pts[0].x) || 0, y: Number(pts[0].y) || 0 }
  let target = total * prog
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const r = segs[i] ? clampNum(target / segs[i], 0, 1) : 1
      return {
        x: Number(pts[i].x) + (Number(pts[i + 1].x) - Number(pts[i].x)) * r,
        y: Number(pts[i].y) + (Number(pts[i + 1].y) - Number(pts[i].y)) * r,
      }
    }
    target -= segs[i]
  }
  return null
}

// 她此刻在画布上的位置（0~1）和头顶标签；任何异常都回退到安全坐标，避免 NaN%
function stageMarkerPos(data) {
  const loc = (data && data.location) || {}
  const map = (data && data.map) || {}
  const places = Array.isArray(map.places) ? map.places : []
  if (loc.state === 'traveling' && loc.traveling) {
    const t = loc.traveling
    const pt = sbcPointOnPath(t.path, stageTravelProgress(t)) || { x: 0.5, y: 0.5 }
    return { x: pt.x, y: pt.y, tag: String(t.modeIcon || '') + String(t.modeLabel || '') + '中', tone: T.warn }
  }
  if (loc.state === 'intercity' && loc.intercity) {
    const t = loc.intercity
    // 跨城时她"在路上"：画在地图上方（0.2 让她的头/脚不被地图框裁掉）
    return { x: 0.5, y: 0.2, tag: String(t.modeIcon || '') + String(t.modeLabel || '') + '中', tone: T.warn }
  }
  const here = loc.placeId ? places.find((p) => String(p.id) === String(loc.placeId)) : null
  if (here && Number.isFinite(Number(here.x)) && Number.isFinite(Number(here.y))) {
    return { x: Number(here.x), y: Number(here.y), tag: '在这里', tone: T.ok }
  }
  return { x: 0.5, y: 0.62, tag: '', tone: T.idle }
}

// 一天里的时间色（黄昏/夜晚给一点色调，纯 CSS 渐变，不做动画）
function stageDayTint(hour) {
  const h = Number(hour)
  if (h >= 5 && h < 7) return 'linear-gradient(180deg, rgba(255,170,120,.16), rgba(120,90,160,.08))'
  if (h >= 7 && h < 17) return ''
  if (h >= 17 && h < 19.5) return 'linear-gradient(180deg, rgba(255,120,60,.15), rgba(20,10,40,.16))'
  return 'rgba(4,8,26,.30)'
}

// 「打开地图页」：外壳没给回调时降级成提示，不请求任何 HTML 页面（M01/N01）
function stageOpenMapPage(props) {
  try {
    if (props && typeof props.onOpenMap === 'function') { props.onOpenMap(); return true }
    if (typeof window !== 'undefined') {
      if (typeof window.__sbcOpenTab === 'function') { window.__sbcOpenTab('map'); return true }
      try { window.dispatchEvent(new CustomEvent('sbc:open-tab', { detail: { tab: 'map' } })) } catch (e) {}
    }
  } catch (e) {}
  return false
}

function StageView(props) {
  const p = props || {}
  const beauty = usePaintConfig()
  const beautyBg = paintLayers(beauty.paint, beauty.imageUrl)
  const compact = !!p.compact
  const stage = useApi('/api/stage', { refreshMs: STAGE_POLL_MS })
  const data = stage.data
  const map = (data && data.map) || {}
  const loc = (data && data.location) || {}
  const character = (data && data.character) || {}
  const places = Array.isArray(map.places) ? map.places : []
  const mapImgPath = map.image && map.image.url ? String(map.image.url) : ''
  const expect2d = map.has2d !== false && !!mapImgPath
  const spritePath = character.sprite || (character.model && character.model.type === 'sprite' ? String(character.model.url || '') : '')
  const avatarPath = loc.avatar || character.avatar || ''

  const mapImg = useImage(mapImgPath)
  const spriteImg = useImage(spritePath)
  const fit = sbcFitUseSize()
  const size = fit.size

  const [aspect, setAspect] = React.useState(STAGE_MAP_ASPECT_FALLBACK)
  const [bgFailed, setBgFailed] = React.useState(false)
  const [spriteFailed, setSpriteFailed] = React.useState(false)
  const [moving, setMoving] = React.useState('')
  const [notice, setNotice] = React.useState('')
  // 2D / 3D：localStorage `companionStage3D` 是用户的显式选择（null = 没选过，按地图 displayMode 决定）
  const [mode3dPref, setMode3dPref] = useLocal('companionStage3D', null)
  // 3D 启动失败的原因（WebGL/three 不可用）：非空就强制走 2D，并在底部留一行说明
  const [fail3d, setFail3d] = React.useState('')

  // 换地图/换底图：重置比例与失败标记，按新图重新适配
  React.useEffect(() => {
    setAspect(STAGE_MAP_ASPECT_FALLBACK)
    setBgFailed(false)
  }, [mapImgPath])
  React.useEffect(() => { setSpriteFailed(false) }, [spritePath])
  // 换地图：上一次的 3D 失败结论不能带到新地图上（换张图可能就能 3D）
  React.useEffect(() => { setFail3d('') }, [map.id])

  // 这张地图有没有 3D 资源：map.has3d=true 或配了 3D 模型；其余情况 3D 开关禁用
  const can3d = !!(map.has3d === true || (map.model && map.model.url))
  const want3d = can3d && !fail3d && (mode3dPref === null ? map.displayMode === '3d' : !!mode3dPref)
  // 3D 组件由 20-stage/three3d.js 提供（同一次构建的片段）；用 typeof 兜一层：
  // 万一构建清单里漏了这个片段，面板也只是没有 3D，不会因为 ReferenceError 整页白掉。
  const has3dModule = typeof ThreeStage === 'function'
  const use3d = !!data && want3d && has3dModule

  const toggle3d = (next) => {
    if (next && !can3d) {
      toast('这张地图没有 3D 资源', 'error')
      return
    }
    if (next && !has3dModule) {
      toast('3D 模块没有打进这次构建（缺少 20-stage/three3d.js）', 'error')
      return
    }
    setFail3d('')
    setMode3dPref(!!next)
  }

  // 3D 挂了：toast 中文原因 + 自动切回 2D（不写 localStorage，保留用户偏好，方便修好后重试）
  const on3dFail = (reason) => {
    const msg = String(reason || '3D 舞台不可用')
    setFail3d(msg)
    toast('3D 舞台不可用：' + msg + '，已切回 2D', 'error')
  }

  const rect = sbcFitRect(size, aspect)
  const marker = stageMarkerPos(data)
  const traveling = (loc.state === 'traveling' && loc.traveling) || null
  const intercity = (loc.state === 'intercity' && loc.intercity) || null
  const progress = loc.state === 'traveling' && traveling ? stageTravelProgress(traveling) : (loc.state === 'intercity' && intercity ? stageTravelProgress(intercity) : 0)
  const nowHour = new Date().getHours() + new Date().getMinutes() / 60

  // 点击地点：instant 直达；被拒绝时把 reason 显示出来（refused 是 HTTP 200，必须看 data.ok）
  const goPlace = async (place) => {
    if (!place || moving) return
    if (loc.state === 'stationary' && String(loc.placeId) === String(place.id)) {
      setNotice('')
      toast('她已经在这儿了')
      return
    }
    setMoving(String(place.id))
    setNotice('')
    try {
      const r = await Api.post('/api/location', { placeId: place.id, instant: true })
      const d = r && r.ok ? (r.data || {}) : null
      if (r && r.ok && d && d.ok !== false) {
        toast('她已经到「' + (place.name || '那里') + '」了', 'ok')
        stage.reload()
        return
      }
      const reason = (d && (d.reason || d.error)) || (r && r.error) || '移动失败'
      setNotice(String(reason))
      toast(String(reason), 'error')
    } catch (e) {
      const reason = (e && e.message) || '移动失败'
      setNotice(reason)
      toast(reason, 'error')
    } finally {
      setMoving('')
    }
  }

  const openMapPage = () => {
    if (!stageOpenMapPage(p)) toast('点顶部「地图」标签，在那里可以给地图加底图')
  }

  const weatherText = data && data.weather
    ? (String(data.weather.icon || '') + ' ' + String(data.weather.label || '') +
      (data.weather.temp !== null && data.weather.temp !== undefined ? ' ' + data.weather.temp + '°C' : '')).trim()
    : ''
  const wallet = (data && data.wallet) || null
  const moneyText = wallet
    ? (wallet.tokenMode
      ? ('零花 ' + fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元')
      : (fmtMoney(wallet.spendable === undefined ? wallet.balance : wallet.spendable, 0) + ' 元'))
    : ''
  const energy = data && data.energy !== undefined && data.energy !== null ? Number(data.energy) : null
  const whereText = loc.state === 'intercity' && intercity
    ? ('前往 ' + (intercity.toMapName || '别的城市'))
    : loc.state === 'traveling' && traveling
      ? ('去 ' + (traveling.toName || '路上') + ' 的路上')
      : ((loc.icon || '') + ' ' + (loc.placeName || '不知道在哪')).trim()

  const mapViewStyle = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.w,
    height: rect.h,
    overflow: 'hidden',
    borderRadius: compact ? 8 : 12,
    border: '1px solid ' + T.border,
    background: T.bg2,
  }

  const renderPlaceholder = () => {
    const noBg = !expect2d
    return h('div', {
      style: {
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 7, padding: 16, textAlign: 'center',
      },
    },
      h('div', { style: { fontSize: compact ? 22 : 30, opacity: 0.72 } }, '🗺️'),
      h('div', { style: { fontSize: compact ? 11.5 : 13, fontWeight: 600, color: T.text2 } },
        noBg ? '当前地图没有 2D 底图' : '底图加载失败'),
      h('div', { style: { fontSize: compact ? 10 : 11.5, color: T.text3, lineHeight: 1.65, maxWidth: 330 } },
        noBg
          ? ('「' + (map.name || '这张地图') + '」还没有 2D 底图。加一张底图后她就会出现在地图上' + (can3d ? '；也可以直接切 3D 舞台看三维小镇。' : '。'))
          : '底图文件没能加载出来，可以重试一次；地点和位置数据本身是好的。'),
      h(Row, { gap: 6, style: { justifyContent: 'center' } },
        noBg ? h(Btn, { size: 'sm', kind: 'primary', onClick: openMapPage }, '去地图页加底图') : null,
        noBg ? null : h(Btn, { size: 'sm', onClick: () => { setBgFailed(false); mapImg.retry() } }, '重试加载底图'),
      ),
    )
  }

  const renderMap = () => {
    if (!expect2d || bgFailed) return renderPlaceholder()
    return [
      // 只在拿到图片地址后才渲染 <img>：src="" 的 img 会触发一次 error，
      // 那样会在首帧就被误判成「底图加载失败」（离线预览实测踩到过）。
      mapImg.src
        ? h('img', {
            key: 'bg',
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
        : null,
      h('div', {
        key: 'tint',
        style: { position: 'absolute', inset: 0, background: stageDayTint(nowHour), pointerEvents: 'none' },
      }),
      places.map((place) => {
        const here = loc.state === 'stationary' && String(place.id) === String(loc.placeId)
        const isMoving = moving === String(place.id)
        return h('button', {
          key: String(place.id),
          type: 'button',
          title: here ? ('她就在「' + String(place.name || '') + '」') : ('让' + (character.name || '她') + '去「' + String(place.name || '') + '」'),
          disabled: !!moving,
          onClick: () => goPlace(place),
          style: {
            position: 'absolute',
            left: pct(place.x),
            top: pct(place.y),
            transform: 'translate(-50%,-100%)',
            zIndex: here ? 4 : 3,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
            border: 'none', background: 'transparent', padding: 0,
            cursor: moving ? 'progress' : 'pointer',
            opacity: isMoving ? 0.45 : 1,
            fontFamily: T.font,
            maxWidth: compact ? 76 : 104,
            appearance: 'none',
          },
        },
          h('span', {
            style: {
              width: compact ? 19 : 23, height: compact ? 19 : 23, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: here ? 'rgba(47,107,216,.30)' : 'rgba(8,13,20,.74)',
              border: '1px solid ' + (here ? T.brand : T.border2),
              fontSize: compact ? 10 : 12, lineHeight: 1,
              boxShadow: '0 2px 8px rgba(0,0,0,.32)',
            },
          }, place.icon || '📍'),
          h('span', {
            style: {
              fontSize: compact ? 8.5 : 10, lineHeight: '13px',
              color: here ? T.text : T.text2,
              background: 'rgba(8,13,20,.70)', border: '1px solid ' + T.border,
              borderRadius: 999, padding: '0 5px', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
            },
          }, String(place.name || '')),
        )
      }),
      h('div', {
        key: 'me',
        style: {
          position: 'absolute', left: pct(marker.x), top: pct(marker.y),
          transform: 'translate(-50%,-100%)', zIndex: 6,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
          pointerEvents: 'none',
          transition: 'left .9s linear, top .9s linear',
        },
      },
        h(SkeletonAvatar, {
          path: avatarPath, sprite: character.sprite, name: character.name,
          moving: marker && marker.tag ? !!marker.tag : false,
          size: compact ? 64 : 118,
          fallbackSize: compact ? 30 : 44,
        }),
        marker.tag
          ? h('span', {
              style: {
                fontSize: compact ? 8.5 : 10, lineHeight: '13px', whiteSpace: 'nowrap',
                color: marker.tone,
                background: 'rgba(8,13,20,.82)',
                border: '1px solid ' + marker.tone,
                borderRadius: 6, padding: '0 5px',
              },
            }, marker.tag)
          : null,
      ),
    ]
  }

  const rootStyle = {
    flex: 1, minHeight: 0, minWidth: 0,
    display: 'flex', flexDirection: 'column',
    background: paintOn() ? 'transparent' : T.bg, color: T.text, fontFamily: T.font,
    fontSize: compact ? 11.5 : 13,
  }

  // 首屏：没有数据时给加载/错误态，不白屏
  if (!data) {
    return h('div', { style: rootStyle },
      h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: compact ? 10 : 16 } },
        stage.loading
          ? h(Loading, { text: '舞台加载中…' })
          : h(ErrorBox, { title: '舞台加载失败', error: stage.error || '没有拿到舞台数据', onRetry: stage.reload }),
      ),
    )
  }

  const headerChips = [
    h(Chip, { key: 'place', active: true, title: '她当前的地点' }, whereText),
    weatherText ? h(Chip, { key: 'wx', title: '天气' }, weatherText) : null,
    h(Chip, { key: 'time', title: '现在时间' }, fmtTime(Date.now())),
    !compact && energy !== null ? h(Chip, { key: 'energy', title: '她的精力' }, energyLabel(energy)) : null,
    !compact && moneyText ? h(Chip, { key: 'money', title: '她的零花（不是 DeepSeek 余额）' }, '💰 ' + moneyText) : null,
    // 2D / 3D 切换（viewMode）：3D 需要地图有 3D 资源且 WebGL 可用
    h(Chip, {
      key: 'mode2d',
      active: !use3d,
      onClick: () => toggle3d(false),
      title: '2D 舞台（底图 + 地点）',
    }, '2D'),
    h(Chip, {
      key: 'mode3d',
      active: use3d,
      onClick: () => toggle3d(true),
      title: can3d
        ? (fail3d ? '3D 上次没起来（' + fail3d + '），点这里重试' : '3D 舞台：拖动旋转 · 滚轮缩放 · 点地点让她去')
        : '这张地图没有 3D 资源',
      style: can3d ? undefined : { opacity: 0.45, cursor: 'not-allowed' },
    }, '3D'),
    fail3d ? h(Chip, { key: 'fail3d', tone: 'warn', title: '3D 失败原因：' + fail3d }, '3D 不可用') : null,
  ].filter(Boolean)

  const statusLine = () => {
    if (loc.state === 'traveling' && traveling) {
      return ('正在从 ' + (traveling.fromName || '上一个地点') + ' 去 ' + (traveling.toName || '目的地') +
        ' · ' + (traveling.modeIcon || '') + (traveling.modeLabel || '') +
        ' · ' + Math.round(Number(traveling.distanceMeters) || 0) + ' m' +
        ' · 剩 ' + fmtDuration(Math.max(1, Math.ceil((Number(traveling.etaSec) || 0) / 60))))
    }
    if (loc.state === 'intercity' && intercity) {
      return ('跨城：' + (intercity.fromMapName || '这里') + ' → ' + (intercity.toMapName || '目的地') +
        ' · ' + (intercity.modeIcon || '') + (intercity.modeLabel || '') +
        ' · 约 ' + fmtDuration(Math.max(1, Math.ceil((Number(intercity.etaSec) || 0) / 60))))
    }
    const mins = Number(loc.minutes) || 0
    return ('她现在在「' + (loc.placeName || '不知道在哪') + '」' + (mins > 0 ? '（已待 ' + fmtDuration(mins) + '）' : '') +
      ' · 地图：' + (map.name || '未知') + (data.animationHint === 'sleeping' ? ' · 这个点她大概在睡觉' : ''))
  }

  return h('div', { style: rootStyle },
    // 顶部 HUD：compact 只保留最必要的一行，不和外层聊天条抢位置
    compact
      ? h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 5, padding: '2px 2px 3px',
            flexShrink: 0, fontSize: 10.5, color: T.text2, whiteSpace: 'nowrap', overflow: 'hidden',
          },
        },
          h('span', { style: { color: T.text, fontWeight: 600 } }, character.name || '她'),
          h('span', { style: { color: T.text3 } }, '·'),
          h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, whereText),
          h('span', { style: { flex: 1 } }),
          weatherText ? h('span', { title: '天气' }, weatherText) : null,
          h('span', { title: '现在时间' }, fmtTime(Date.now())),
          // 分屏里用一个小胶囊切换 2D/3D（占位小，不挤掉地点）
          h(Chip, {
            key: 'mode',
            active: use3d,
            onClick: () => toggle3d(!use3d),
            title: can3d
              ? (use3d ? '切到 2D 舞台' : (fail3d ? '3D 上次没起来：' + fail3d + '，点这里重试' : '切到 3D 舞台'))
              : '这张地图没有 3D 资源',
            style: { padding: '1px 7px', fontSize: 10, lineHeight: '14px', opacity: can3d ? 1 : 0.5 },
          }, use3d ? '3D' : '2D'),
        )
      : h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
            padding: '3px 2px 7px', flexShrink: 0,
          },
        },
          h(Avatar, { path: avatarPath, name: character.name, size: 24 }),
          h('span', { style: { fontSize: 13, fontWeight: 600, color: T.text } }, character.name || '她'),
          headerChips,
          h('span', { style: { flex: 1 } }),
          h(Btn, {
            size: 'sm',
            kind: 'ghost',
            title: '刷新舞台数据（自动每 ' + Math.round(STAGE_POLL_MS / 1000) + ' 秒刷新一次）',
            disabled: stage.loading,
            onClick: () => stage.reload(),
          }, stage.loading ? '刷新中…' : '刷新'),
        ),
    // 舞台画布（测量不到尺寸时也把内容挂上：真实浏览器用 layout effect 量完再画，
    // 非浏览器/首帧下 rect 是 0，但 React 树里有内容，不会出现"空白一片"）
    h('div', {
      ref: fit.ref,
      style: Object.assign({ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', borderRadius: compact ? 8 : 12 }, beautyBg ? (beauty.paint.enabled ? { background: 'transparent' } : beautyBg) : { background: T.bg2 }),
    },
      beautyBg ? h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(120% 90% at 50% 110%, rgba(0,0,0,0) 55%, rgba(0,0,0,.35) 100%)' } }) : null,
      // 3D：ThreeStage 自己铺满容器（WebGL 画布）；失败回调在这里切回 2D
      use3d
        ? h(ThreeStage, { data, compact, onPickPlace: goPlace, onFail: on3dFail })
        : h('div', { style: mapViewStyle }, renderMap()),
      // 断线但还有旧数据：顶部细提示条，不清空舞台（不抖）
      stage.error
        ? h('div', {
            style: {
              position: 'absolute', left: 8, right: 8, top: 8, zIndex: 8,
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(239,83,80,.16)', border: '1px solid ' + T.danger,
              borderRadius: 8, padding: '3px 8px', fontSize: 10.5, color: T.text,
            },
          },
            h(Dot, { on: false, tone: T.danger }),
            h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              '运行时无响应：' + stage.error + '（显示最后一次数据）'),
            h(Btn, { size: 'sm', kind: 'ghost', onClick: () => stage.reload() }, '重试'),
          )
        : null,
    ),
    // 底部状态 / 行程进度 / 拒绝原因
    h('div', { style: { flexShrink: 0, paddingTop: compact ? 3 : 6, display: 'flex', flexDirection: 'column', gap: 3 } },
      h('div', {
        style: {
          fontSize: compact ? 10 : 11.5, color: T.text2, lineHeight: 1.5,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
        title: statusLine(),
      }, statusLine()),
      (traveling || intercity)
        ? h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('div', { style: { flex: 1, height: 4, borderRadius: 3, background: 'rgba(127,127,127,.22)', overflow: 'hidden' } },
              h('div', { style: { width: Math.round(progress * 100) + '%', height: '100%', background: T.brand } }),
            ),
            h('span', { style: { fontSize: 10, color: T.text3, whiteSpace: 'nowrap' } }, Math.round(progress * 100) + '%'),
          )
        : null,
      notice
        ? h('div', { style: { fontSize: 10.5, color: T.danger, lineHeight: 1.5 } }, '她没去：' + notice)
        : null,
      // 3D 失败：留一行说明（toast 会消失，这行一直在；点 HUD 的「3D」可重试）
      fail3d
        ? h('div', {
            title: '3D 失败原因：' + fail3d,
            style: {
              fontSize: 10.5, color: T.warn, lineHeight: 1.5,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            },
          }, '3D 舞台不可用：' + fail3d + '（已切回 2D，点上方「3D」可重试）')
        : null,
      want3d && !has3dModule
        ? h('div', { style: { fontSize: 10.5, color: T.warn, lineHeight: 1.5 } },
            '3D 模块没进这次构建：把 src/client/20-stage/three3d.js 加进构建清单后重新构建')
        : null,
    ),
  )
}
