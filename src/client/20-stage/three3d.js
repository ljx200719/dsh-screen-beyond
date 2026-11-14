// 20-stage/three3d.js —— 3D 舞台（把 runtime/model.html 的 three.js 场景搬进原生面板）
//
// 契约：function ThreeStage(props)
//   props.data        GET /api/stage 的载荷（stage.js 的 useApi 每 2.5s 轮询一次）
//   props.compact     聊天分屏里的小尺寸（阴影分辨率 / 像素比降一档）
//   props.onPickPlace (place) => void，点击地点标记/建筑时调用，由 stage.js 发 POST /api/location
//   props.onFail      (reason: string) => void，WebGL/three 不可用时调用；stage.js 收到后切回 2D 并 toast
//
// 为什么不能直接 import：
//   · 源文件是「单文件工厂的片段」（scripts/build-client.mjs 拼成 lib/client.js），禁止 import/export；
//   · DSH 面板里注入 importmap 不可靠，所以 three 用运行时绝对地址动态 import；
//   · GLTFLoader / BufferGeometryUtils 里有裸导入（'three'、'../utils/BufferGeometryUtils.js'），
//     桌面端页面里没有 importmap 可解析，因此：fetch 源码 → 把每个 import 说明符改写成运行时绝对地址
//     （GLTFLoader 依赖的 BufferGeometryUtils 也走同一套，递归生成 blob URL） → blob: import。
//     只有「真的要加载某个 GLB」时才去取 GLTFLoader（真实数据里没有 GLB 时不产生额外请求）。
//   · 失败一律不抛到 React 外面：ThreeStage 统一 catch → props.onFail(中文原因)，绝不白屏。
//
// 卸载清理（M08「切换不泄漏」）：cancelAnimationFrame、renderer.dispose()/forceContextLoss()、
// 遍历 scene 释放 geometry/material/texture、移除 pointer/wheel/resize/contextlost 监听、断开 ResizeObserver。

// ─────────────────────────── A. vendor ESM 加载 ───────────────────────────

const SBC3D_VENDOR_THREE = 'three.module.min.js'
const SBC3D_VENDOR_GLTF = 'addons/loaders/GLTFLoader.js'

let sbc3dThreePromise = null
let sbc3dGltfPromise = null
const sbc3dBlobUrls = new Map() // vendor 源码绝对地址 → Promise<blob: URL>
const sbc3dModules = new Map() // vendor 源码绝对地址 → Promise<module>

// 运行时地址：面板刚挂载时 Runtime.baseSync() 可能还是 ''（还没发现端口），
// 这里统一用「先 await Runtime.base()，再落盘到绝对地址」。
function sbc3dVendorBase() {
  const b = Runtime.baseSync() || DEFAULT_BASE
  return String(b).replace(/\/+$/, '')
}

function sbc3dVendorUrl(rel) {
  return sbc3dVendorBase() + '/vendor/' + String(rel || '').replace(/^\/+/, '')
}

// import 说明符 → 运行时绝对地址；认不出来的（第三方裸包名）返回 ''，原样保留由浏览器报错。
function sbc3dResolveImport(spec, importerUrl) {
  const s = String(spec || '')
  if (!s) return ''
  if (s === 'three') return sbc3dVendorUrl(SBC3D_VENDOR_THREE)
  if (s.indexOf('three/') === 0) return sbc3dVendorUrl(s.slice(6))
  if (s.charAt(0) === '.') {
    try { return new URL(s, importerUrl).href } catch (e) { return '' }
  }
  return ''
}

async function sbc3dFetchText(url) {
  const r = await fetch(url, { cache: 'default' })
  if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status))
  return await r.text()
}

// 把源码里每个 import 说明符换成运行时绝对地址 / 依赖模块的 blob URL。
// 只处理「from 'x'」「import('x')」「import 'x'」三种形态，不认识的说明符原样保留。
async function sbc3dRewriteImports(code, importerUrl) {
  const re = /\b(?:from\s*|import\s*\(\s*|import\s+)(['"])([^'"\r\n]+)\1/g
  const jobs = []
  let m = re.exec(code)
  while (m) {
    jobs.push({ start: m.index, end: re.lastIndex, quote: m[1], spec: m[2] })
    m = re.exec(code)
  }
  if (!jobs.length) return code
  let out = ''
  let last = 0
  for (const job of jobs) {
    const abs = sbc3dResolveImport(job.spec, importerUrl)
    if (!abs) continue
    // three 自身是完整模块（没有 import），直接给地址；其它 addon 递归处理成 blob URL。
    const depUrl = abs === sbc3dVendorUrl(SBC3D_VENDOR_THREE) ? abs : await sbc3dBlobUrlFor(abs)
    const head = code.slice(job.start, job.end - job.spec.length - 2) // 去掉引号和 spec，保留 "from " / "import(" 等
    out += code.slice(last, job.start) + head + job.quote + depUrl + job.quote
    last = job.end
  }
  out += code.slice(last)
  return out
}

// vendor 源码 → 依赖改写后的 blob: URL（同一地址只做一次，失败不缓存，允许重试）
async function sbc3dBlobUrlFor(url) {
  const hit = sbc3dBlobUrls.get(url)
  if (hit) return hit
  const task = (async () => {
    const src = await sbc3dFetchText(url)
    const rewritten = await sbc3dRewriteImports(src, url)
    return URL.createObjectURL(new Blob([rewritten], { type: 'text/javascript' }))
  })()
  sbc3dBlobUrls.set(url, task)
  try {
    return await task
  } catch (e) {
    sbc3dBlobUrls.delete(url)
    throw e
  }
}

async function sbc3dImportVendor(rel) {
  const url = sbc3dVendorUrl(rel)
  const hit = sbc3dModules.get(url)
  if (hit) return hit
  const task = (async () => {
    if (rel === SBC3D_VENDOR_THREE) return await import(url)
    const blobUrl = await sbc3dBlobUrlFor(url)
    return await import(blobUrl)
  })()
  sbc3dModules.set(url, task)
  try {
    return await task
  } catch (e) {
    sbc3dModules.delete(url)
    throw e
  }
}

// three 主模块（Promise 缓存；失败清缓存，下次挂载可重试）
function sbc3dLoadThree() {
  if (sbc3dThreePromise) return sbc3dThreePromise
  sbc3dThreePromise = (async () => {
    try { await Runtime.base() } catch (e) {}
    const mod = await sbc3dImportVendor(SBC3D_VENDOR_THREE)
    if (!mod || !mod.WebGLRenderer || !mod.Scene || !mod.PerspectiveCamera) throw new Error('模块内容不完整')
    return mod
  })()
  sbc3dThreePromise.catch(() => { sbc3dThreePromise = null })
  return sbc3dThreePromise
}

// GLTFLoader 按需加载（只有 map.model / 角色模型 / 载具模型是 GLB 时才需要）
function sbc3dLoadGltfLoader() {
  if (sbc3dGltfPromise) return sbc3dGltfPromise
  sbc3dGltfPromise = (async () => {
    const mod = await sbc3dImportVendor(SBC3D_VENDOR_GLTF)
    if (!mod || typeof mod.GLTFLoader !== 'function') throw new Error('模块内容不完整')
    return mod.GLTFLoader
  })()
  sbc3dGltfPromise.catch(() => { sbc3dGltfPromise = null })
  return sbc3dGltfPromise
}

// ─────────────────────────── B. 小工具 ───────────────────────────

const sbc3dAspectCache = new Map() // 图片地址 → 宽高比（0 = 认识这个地址但还没量出来）

function sbc3dImageAspect(url) {
  const v = Number(sbc3dAspectCache.get(String(url || '')))
  return v > 0.05 ? v : 0
}

// 量一次底图真实宽高比（世界高 = 世界宽 / 宽高比；官方地图是 2496x1664）
function sbc3dMeasureImage(url, onReady) {
  const key = String(url || '')
  if (!key || sbc3dAspectCache.has(key)) return
  sbc3dAspectCache.set(key, 0)
  try {
    Api.imgUrl(key).then((src) => {
      if (!src) return
      const img = new Image()
      img.onload = () => {
        const ar = (Number(img.naturalWidth) || 0) / (Number(img.naturalHeight) || 1)
        if (ar > 0.05) sbc3dAspectCache.set(key, ar)
        try { if (typeof onReady === 'function') onReady() } catch (e) {}
      }
      img.onerror = () => {}
      img.src = src
    }).catch(() => {})
  } catch (e) {}
}

// 面板主题里的品牌蓝（T.accent 是固定色值，可以直接给 canvas / WebGL 用）
function sbc3dAccent() {
  const v = String((T && T.accent) || '')
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : '#3b82f6'
}

// 世界尺寸：model.html 用固定 120x77；这里按 map.widthMeters 等比换算（2000m ≈ 120 世界单位），
// 高度按底图宽高比推（没有底图时用 1000/640 兜底），保证 3D 里的方位和 2D 底图一致。
const SBC3D_WORLD_BASE = 120
const SBC3D_ASPECT_FALLBACK = 1000 / 640
function sbc3dWorldWidth(widthMeters) {
  const m = Number(widthMeters)
  const w = (SBC3D_WORLD_BASE * (Number.isFinite(m) && m > 0 ? m : 2000)) / 2000
  return clampNum(w, 80, 240, SBC3D_WORLD_BASE)
}

// ─────────────────────────── C. 场景（一个世界一个实例）───────────────────────────

// 创建整个 3D 世界。同步完成 renderer/scene/相机/灯光/交互/渲染循环的搭建；
// WebGL 不可用会抛带中文原因的 Error（由 sbc3dBoot 捕获 → onFail）。
// 返回：{ update(data), dispose(), canvas }
function sbc3dCreateWorld(host, opts, THREE) {
  const o = opts || {}
  if (!host || typeof host.appendChild !== 'function') throw new Error('3D 容器不存在')
  const compact = !!o.compact
  const doc = host.ownerDocument || (typeof document !== 'undefined' ? document : null)
  if (!doc) throw new Error('当前环境没有 DOM')
  const win = doc.defaultView || (typeof window !== 'undefined' ? window : null)

  // ── renderer（WebGL 不可用 → 中文原因）──
  let renderer = null
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
  } catch (e) {
    throw new Error('当前环境不支持 WebGL（显卡/浏览器限制），3D 舞台不可用')
  }
  if (!renderer || !renderer.domElement) throw new Error('WebGL 初始化失败，3D 舞台不可用')
  const canvas = renderer.domElement
  const dprCap = compact ? 1.5 : 2
  try { renderer.setPixelRatio(Math.min(Number(win && win.devicePixelRatio) || 1, dprCap)) } catch (e) {}
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.25
  canvas.style.display = 'block'
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.touchAction = 'none'
  canvas.style.cursor = 'grab'
  host.appendChild(canvas)

  const state = {
    data: null,
    worldKey: '',
    townKey: '',
    placesKey: '',
    terrainKey: '',
    envKey: '',
    vehiclesKey: '',
    charKey: '',
    pathKey: '',
    groundKey: '',
    groundToken: 0,
    official: false,
    showTown: false,
    envToken: 0,
    vehiclesToken: 0,
    charToken: 0,
    worldW: 0,
    worldH: 0,
    running: true,
    raf: 0,
    camReady: false,
    pointers: new Map(),
    dragging: false,
    lastX: 0,
    lastY: 0,
    pinch: 0,
    pinching: false,
    pressX: 0,
    pressY: 0,
    pressAt: 0,
    hoverDirty: false,
    hoverAt: 0,
    pointerInside: false,
    yaw: 0.9,
    pitch: 0.72,
    dist: 100,
    zoomTouched: false,
    maxDist: 320,
    envRadius: 0,
    charRadius: 0,
    fitApplied: 0,
    clock: null,
    mixer: null,
    charActions: [],
    activeCharAction: null,
    desiredCharClip: 'Idle',
    carMode: false,
    bikeMode: false,
  }

  // ── 场景 / 相机 / 灯光（色调与 model.html 一致）──
  const scene = new THREE.Scene()
  scene.fog = new THREE.Fog(0x1a2c3a, 140, 320)
  scene.background = new THREE.Color(0x0d1a24)
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
  camera.position.set(0, 90, 100)

  const hemi = new THREE.HemisphereLight(0xdceeff, 0x2a3a2a, 1.0)
  scene.add(hemi)
  const dir = new THREE.DirectionalLight(0xfff4e0, 2.3)
  dir.position.set(40, 70, 25)
  dir.castShadow = true
  dir.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048)
  dir.shadow.camera.left = -90
  dir.shadow.camera.right = 90
  dir.shadow.camera.top = 90
  dir.shadow.camera.bottom = -90
  dir.shadow.camera.near = 1
  dir.shadow.camera.far = 220
  dir.shadow.bias = -0.0005
  scene.add(dir)
  const ambient = new THREE.AmbientLight(0x445566, 0.65)
  scene.add(ambient)

  // ── 资源释放（材质缓存：程序化小镇共用材质，重建分组时只释放 geometry）──
  const matCache = new Map()
  const sharedMats = new Set()

  function disposeMaterial(m, keep) {
    if (!m || (keep && keep.has(m))) return
    for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) {
      try { if (m[k]) m[k].dispose() } catch (e) {}
    }
    try { m.dispose() } catch (e) {}
  }

  function disposeObject(obj, keep) {
    if (!obj || typeof obj.traverse !== 'function') return
    obj.traverse((node) => {
      try { if (node.geometry) node.geometry.dispose() } catch (e) {}
      const ms = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
      for (const m of ms) disposeMaterial(m, keep)
    })
  }

  function disposeChildren(group, keep) {
    if (!group) return
    for (const child of group.children.slice()) disposeObject(child, keep)
    try { group.clear() } catch (e) {}
  }

  function mat(color, rough, metal) {
    const key = String(color) + '|' + (rough === undefined ? 0.86 : rough) + '|' + (metal === undefined ? 0.02 : metal)
    if (!matCache.has(key)) {
      const m = new THREE.MeshStandardMaterial({
        color,
        roughness: rough === undefined ? 0.86 : rough,
        metalness: metal === undefined ? 0.02 : metal,
      })
      matCache.set(key, m)
      sharedMats.add(m)
    }
    return matCache.get(key)
  }

  // ── 场景分组（和 model.html 一一对应）──
  const basePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(190, 130),
    new THREE.MeshStandardMaterial({ color: 0x163447, roughness: 1, metalness: 0.02 })
  )
  basePlane.rotation.x = -Math.PI / 2
  basePlane.position.y = -0.55
  basePlane.receiveShadow = true
  scene.add(basePlane)

  const townGroup = new THREE.Group()
  scene.add(townGroup)
  const terrainGroup = new THREE.Group()
  scene.add(terrainGroup)
  const markerGroup = new THREE.Group()
  scene.add(markerGroup)
  const envGroup = new THREE.Group()
  scene.add(envGroup)
  const vehicleGroup = new THREE.Group()
  vehicleGroup.visible = false
  scene.add(vehicleGroup)
  const charGroup = new THREE.Group()
  scene.add(charGroup)

  let ground = null
  let grid = null
  let roadMeshes = []
  let carGroup = null
  let bikeGroup = null
  let routeLine = null
  let charModel = null
  let fallbackBody = null
  let spritePlane = null

  // 地点拾取：markerGroup / townGroup / envGroup 里挂了 userData.sbc3dPlaceId 的对象可点
  const placesById = new Map()
  const markerById = new Map()

  // ── 坐标换算：地图归一化 0~1 → 世界坐标 ──
  function toWorld(x, y, out) {
    const v = out || new THREE.Vector3()
    const px = Number(x)
    const py = Number(y)
    return v.set(
      ((Number.isFinite(px) ? px : 0.5) - 0.5) * state.worldW,
      0,
      ((Number.isFinite(py) ? py : 0.5) - 0.5) * state.worldH
    )
  }

  // ── 文字名牌（canvas 生成，不额外请求图片）──
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }

  function labelSprite(text, icon) {
    const cw = 256
    const chh = 128
    const c = doc.createElement('canvas')
    c.width = cw
    c.height = chh
    const ctx = c.getContext('2d')
    if (ctx) {
      ctx.fillStyle = 'rgba(10,17,24,0.82)'
      roundRect(ctx, 12, 30, 232, 68, 16)
      ctx.fill()
      ctx.strokeStyle = sbc3dAccent()
      ctx.lineWidth = 4
      roundRect(ctx, 12, 30, 232, 68, 16)
      ctx.stroke()
      ctx.fillStyle = '#e3ecf5'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      let size = 40
      const label = String(icon || '') + (icon ? ' ' : '') + String(text || '')
      for (; size > 18; size -= 2) {
        ctx.font = 'bold ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif'
        if (ctx.measureText(label).width <= 210) break
      }
      ctx.fillText(label, cw / 2, 64)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.needsUpdate = true
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false })
    const sp = new THREE.Sprite(m)
    sp.scale.set(8.5, 4.2, 1)
    return sp
  }

  // ── 地面 / 网格 / 程序化十字路 ──
  const themeColors = { town: 0x1d3a33, coast: 0x14425c, city: 0x22303c, forest: 0x1b3325 }

  function buildGround(theme, imageUrl) {
    const key = String(theme) + '|' + String(imageUrl || '')
    if (key === state.groundKey) return
    state.groundKey = key
    // 换地面就作废上一张底图的异步加载（避免旧图挂到新地面材质上）
    const token = ++state.groundToken
    if (ground) {
      scene.remove(ground)
      disposeObject(ground)
      ground = null
    }
    const geo = new THREE.PlaneGeometry(state.worldW, state.worldH)
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })
    if (!imageUrl) material.color.set(themeColors[theme] || themeColors.town)
    ground = new THREE.Mesh(geo, material)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.01
    ground.receiveShadow = true
    scene.add(ground)
    if (imageUrl) {
      // token 模式下底图必须走 Api.imgUrl（blob），不能直接拼字符串
      Api.imgUrl(imageUrl).then((src) => {
        if (!src || token !== state.groundToken || !ground) return
        const loader = new THREE.TextureLoader()
        loader.load(src, (tex) => {
          if (token !== state.groundToken || !ground) { try { tex.dispose() } catch (e) {} return }
          try {
            tex.colorSpace = THREE.SRGBColorSpace
            material.map = tex
            material.color.set(0xffffff)
            material.needsUpdate = true
          } catch (err) {
            try { tex.dispose() } catch (e2) {}
          }
        }, undefined, () => {})
      }).catch(() => {})
    }
    if (!grid) {
      grid = new THREE.GridHelper(state.worldW, 24, 0x2a3a44, 0x22303a)
      grid.position.y = 0
      scene.add(grid)
    }
    for (const r of roadMeshes) { scene.remove(r); disposeObject(r) }
    roadMeshes = []
    const roadMat = new THREE.MeshStandardMaterial({ color: 0x2a3a44, roughness: 0.9 })
    const road1 = new THREE.Mesh(new THREE.PlaneGeometry(state.worldW, 7), roadMat)
    road1.rotation.x = -Math.PI / 2
    road1.rotation.z = 0.05
    road1.position.set(0, 0.01, 0)
    scene.add(road1)
    const road2 = new THREE.Mesh(new THREE.PlaneGeometry(6, state.worldH), roadMat)
    road2.rotation.x = -Math.PI / 2
    road2.position.set(0, 0.01, 6)
    scene.add(road2)
    roadMeshes = [road1, road2]
  }

  // ── 低模小镇：每个地点一栋按 id 变化的建筑（移植 model.html 的 13 种）──
  function box(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color))
    m.position.set(x, y, z)
    m.castShadow = true
    m.receiveShadow = true
    return m
  }

  function roof(w, h, d, color, x, y, z) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.72, h, 4), mat(color, 0.78))
    m.rotation.y = Math.PI / 4
    m.position.set(x, y, z)
    m.castShadow = true
    return m
  }

  function tree(x, z, s) {
    const scale = s === undefined ? 1 : s
    const g = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15 * scale, 0.22 * scale, 1.2 * scale, 6), mat(0x86613e, 1))
    trunk.position.y = 0.6 * scale
    g.add(trunk)
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.95 * scale, 2.2 * scale, 7), mat(0x6f9f63, 0.95))
    crown.position.y = 2.1 * scale
    crown.castShadow = true
    g.add(crown)
    g.position.set(x, 0.08, z)
    return g
  }

  function addWindow(g, x, y, z, w, h, c) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w === undefined ? 0.55 : w, h === undefined ? 0.7 : h, 0.1), mat(c === undefined ? 0x35566f : c, 0.35, 0.08))
    m.position.set(x, y, z)
    g.add(m)
  }

  function door(g, x, z, c) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.25, 0.12), mat(c === undefined ? 0x75543b : c))
    m.position.set(x, 0.68, z)
    g.add(m)
  }

  function bench(g, x, z, ry) {
    const b = new THREE.Group()
    b.add(box(1.8, 0.12, 0.55, 0x9a744a, 0, 0.42, 0))
    b.add(box(1.8, 0.45, 0.12, 0x9a744a, 0, 0.68, -0.24))
    for (const dx of [-0.65, 0.65]) b.add(box(0.12, 0.45, 0.12, 0x6f5942, dx, 0.22, 0))
    b.position.set(x, 0, z)
    b.rotation.y = ry || 0
    g.add(b)
  }

  function buildTown(places) {
    const key = JSON.stringify((places || []).map((p) => [p.id, p.x, p.y]))
    if (key === state.townKey) return
    state.townKey = key
    disposeChildren(townGroup, sharedMats)
    for (const p of places || []) {
      const v = toWorld(p.x, p.y)
      const g = new THREE.Group()
      g.position.set(v.x, 0.02, v.z)
      g.userData.sbc3dPlaceId = String(p.id)
      g.add(box(4.6, 0.16, 4.0, 0xcab693, 0, 0.08, 0))
      const id = String(p.id)
      if (id === 'home') {
        g.add(box(4.2, 2.2, 3.6, 0xe5d3b5, 0, 1.1, 0))
        g.add(roof(4.2, 1.8, 3.6, 0x8e5d4b, 0, 3.0, 0))
        g.add(box(0.28, 1.7, 0.28, 0x9a7a58, 1.15, 3.2, -0.5))
        door(g, -0.65, 1.84)
        addWindow(g, 1.1, 1.5, 1.86)
        addWindow(g, -0.9, 1.5, -1.86)
        for (let i = 0; i < 2; i++) g.add(tree(-2.5 + i * 5.2, 2.2 + i, 0.8))
      } else if (id === 'school') {
        g.add(box(7.4, 4.2, 5.4, 0xe6d9c0, 0, 2.1, 0))
        g.add(roof(7.4, 2.0, 5.4, 0x587b99, 0, 5.3, 0))
        g.add(box(3.8, 1.8, 1.8, 0xdfd2b8, -4.8, 1.0, 0.8))
        g.add(box(1.6, 5.6, 1.6, 0xf2e8d5, 0, 2.8, 2.6))
        const clock = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), mat(0x465e74, 0.4))
        clock.position.set(0, 4.6, 3.42)
        g.add(clock)
        for (let i = 0; i < 6; i++) addWindow(g, -2.5 + (i % 3) * 2.5, 1.8 + Math.floor(i / 3) * 1.5, 2.72, 0.8, 0.8, 0x507693)
        g.add(tree(-4.5, -3.2, 1))
        g.add(tree(4.5, -3.2, 1))
      } else if (id === 'library') {
        g.add(box(5.2, 3.4, 4.2, 0xe3dbc9, 0, 1.7, 0))
        g.add(roof(5.2, 1.6, 4.2, 0x70859e, 0, 4.1, 0))
        for (const x of [-1.8, 1.8]) g.add(box(0.45, 2.4, 0.45, 0xd8c7a5, x, 1.2, 2.05))
        door(g, 0, 2.12)
        g.add(tree(-3.2, 1.5, 0.85))
        const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x7d8da0, 0.8))
        dome.position.y = 4.8
        g.add(dome)
      } else if (id === 'cafe') {
        g.add(box(3.9, 2.6, 3.4, 0xe6cfb2, 0, 1.3, 0))
        g.add(roof(3.9, 1.4, 3.4, 0xa55e4f, 0, 3.1, 0))
        g.add(box(3.0, 0.18, 0.95, 0xc98d72, 0, 2.0, 2.15))
        door(g, -0.8, 1.92)
        for (const x of [1.3, -1.4]) {
          const table = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 16), mat(0xf2e8d8))
          table.position.set(x, 0.78, 2.8)
          g.add(table)
          const umb = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.55, 10), mat(0xe0a45f, 0.8))
          umb.position.set(x, 1.55, 2.8)
          g.add(umb)
        }
      } else if (id === 'park') {
        const fountain = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 0.35, 24), mat(0x9ec8d8, 0.5))
        fountain.position.y = 0.22
        g.add(fountain)
        const water = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 24), mat(0x72b6cf, 0.3))
        water.position.y = 0.42
        g.add(water)
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          g.add(tree(Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0.9 + (i % 2) * 0.2))
        }
        bench(g, -4.2, 0.5, Math.PI / 2)
        bench(g, 4.2, 0.5, -Math.PI / 2)
      } else if (id === 'canteen') {
        for (let i = 0; i < 3; i++) {
          const x = -2.5 + i * 2.5
          g.add(box(2.2, 1.4, 1.8, 0xe6d0aa, x, 0.7, 0))
          g.add(roof(2.2, 0.9, 1.8, i === 1 ? 0xd27e5e : 0x90a56d, x, 1.9, 0))
          door(g, x, 0.94)
        }
        g.add(box(3.2, 0.18, 1.2, 0xc49a68, 0, 0.7, 2.0))
      } else if (id === 'market') {
        for (let i = 0; i < 2; i++) {
          const x = -2.2 + i * 4.4
          g.add(box(3.2, 1.2, 2.1, 0xe0c49d, x, 0.6, 0))
          g.add(roof(3.2, 1.0, 2.1, i ? 0x8c9f75 : 0xc37c63, x, 1.8, 0))
          g.add(box(3.4, 0.18, 1.0, 0xf0e3cb, x, 1.45, 1.35))
        }
        g.add(box(1.2, 0.7, 1.2, 0xa7754f, 2.9, 0.35, 0.2))
        g.add(box(1.2, 0.7, 1.2, 0x9b805b, -2.9, 0.35, 0.2))
      } else if (id === 'hospital') {
        g.add(box(5.8, 3.4, 4.6, 0xf0ebe2, 0, 1.7, 0))
        g.add(box(6.2, 0.22, 5.0, 0xb8ccd4, 0, 3.5, 0))
        g.add(box(1.0, 0.24, 0.1, 0xc25552, 0, 2.5, 2.36))
        g.add(box(0.24, 1.0, 0.1, 0xc25552, 0, 2.5, 2.36))
        door(g, 0, 2.34, 0x59727d)
        for (const x of [-1.8, 1.8]) addWindow(g, x, 2.0, 2.33, 0.7, 0.8)
      } else if (id === 'bank') {
        g.add(box(4.8, 4.0, 4.2, 0xe9dfd0, 0, 2.0, 0))
        g.add(box(5.3, 0.28, 4.6, 0xb69b6d, 0, 4.15, 0))
        g.add(box(4.8, 0.4, 0.5, 0xd8bd91, 0, 4.5, 2.2))
        for (const x of [-2.4, 2.4]) g.add(box(0.35, 3.0, 0.35, 0xd8c4a2, x, 1.5, 2.2))
        door(g, 0, 2.42, 0x786044)
      } else if (id === 'mall') {
        g.add(box(7.0, 5.0, 5.4, 0xc8d1c7, 0, 2.5, 0))
        g.add(box(7.4, 0.24, 5.8, 0x7f9394, 0, 5.1, 0))
        g.add(box(4.4, 0.9, 0.15, 0x557d8a, 0, 3.8, 2.73))
        for (let i = 0; i < 4; i++) addWindow(g, -2.4 + i * 1.6, 2.0, 2.72, 0.9, 1.0, 0x7095a1)
        door(g, 0, 2.76, 0x4f6670)
      } else if (id === 'station') {
        g.add(box(8.4, 0.3, 5.2, 0xc7b89d, 0, 0.15, 0))
        g.add(box(8.8, 0.25, 5.6, 0x4f7d93, 0, 3.1, -1.0))
        for (const x of [-3.6, 3.6]) g.add(box(0.16, 3.0, 0.16, 0x50606a, x, 1.55, -1.0))
        for (const z of [-2.8, 2.8]) g.add(box(8.2, 0.16, 0.18, 0x9d8c72, 0, 0.32, z))
        for (const z of [-2.9, 2.9]) g.add(box(10.5, 0.16, 0.34, 0x4e5556, 0, 0.36, z))
        bench(g, -2.5, 1.5)
        bench(g, 2.5, 1.5)
      } else if (id === 'riverside') {
        for (let i = 0; i < 6; i++) g.add(tree(-3 + i * 1.2, -2 + (i % 3) * 2.2, 0.8 + (i % 2) * 0.25))
        bench(g, -2, 0.2, 0.4)
        bench(g, 2.2, -0.2, -0.4)
      } else if (id === 'bookstore') {
        g.add(box(4.4, 2.8, 3.8, 0xd9d0bc, 0, 1.4, 0))
        g.add(roof(4.4, 1.4, 3.8, 0x7b8c9b, 0, 3.2, 0))
        g.add(box(2.8, 0.28, 0.15, 0x8d6a45, 0, 2.4, 2.12))
        door(g, 0, 2.02)
        addWindow(g, 1.2, 1.6, 1.96, 0.6, 0.7)
      } else {
        g.add(box(4.2, 2.4, 3.8, 0xe2d2b8, 0, 1.2, 0))
        g.add(roof(4.2, 1.9, 3.8, 0x9a5d4d, 0, 2.95, 0))
      }
      const signColors = {
        bank: 0xd4b26a, cafe: 0xc97a5d, market: 0x9cb07b, mall: 0x6e8e9c, bookstore: 0x8b7ac4,
        hospital: 0xe4e0d7, school: 0x5d7fa8, library: 0x7d8da0, station: 0x4f7d93, canteen: 0xd27e5e, home: 0x9a5d4d,
      }
      if (signColors[id]) g.add(box(1.9, 0.36, 0.12, signColors[id], 0, 3.35, 2.17))
      townGroup.add(g)
    }
    townGroup.visible = true
  }

  // ── 官方 3D 地形：海岛 + 沙滩边 + 河 + 用户画的道路 + 桥 + 装饰（移植 model.html）──
  function worldP(u, v) {
    return new THREE.Vector3((u - 0.5) * state.worldW, 0, (v - 0.5) * state.worldH)
  }

  function ribbon(points, width, color, y, rough, opacity) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p.x, y, p.z)))
    const segs = Math.max(10, Math.floor(curve.getLength() / 3))
    const pos = []
    const idx = []
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const p = curve.getPoint(t)
      const tan = curve.getTangent(t)
      const nx = -tan.z
      const nz = tan.x
      const len = Math.hypot(nx, nz) || 1
      pos.push(p.x + (nx * width) / 2, y, p.z + (nz * width) / 2)
      pos.push(p.x - (nx * width) / 2, y, p.z - (nz * width) / 2)
      if (i < segs) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    geo.setIndex(idx)
    geo.computeVertexNormals()
    const op = opacity === undefined ? 1 : opacity
    const m = new THREE.MeshStandardMaterial({
      color,
      roughness: rough === undefined ? 0.9 : rough,
      side: THREE.DoubleSide,
      transparent: op < 1,
      opacity: op,
    })
    const mesh = new THREE.Mesh(geo, m)
    mesh.receiveShadow = true
    return mesh
  }

  function buildOfficialTerrain(map) {
    const places = map.places || []
    const key = JSON.stringify(places.map((p) => [p.id, p.x, p.y])) + JSON.stringify(map.vehicles || {}) + JSON.stringify(map.roads || [])
    if (key === state.terrainKey) return
    state.terrainKey = key
    disposeChildren(terrainGroup, sharedMats)

    const sea = new THREE.Mesh(
      new THREE.PlaneGeometry(state.worldW * 2, state.worldH * 2.4),
      new THREE.MeshStandardMaterial({ color: 0x4f9fb8, roughness: 0.32, metalness: 0.04 })
    )
    sea.rotation.x = -Math.PI / 2
    sea.position.y = -1.0
    sea.receiveShadow = true
    terrainGroup.add(sea)

    const boundary = [
      [0.015, 0.16], [0.08, 0.045], [0.24, 0.02], [0.42, 0.035], [0.58, 0.05], [0.72, 0.1],
      [0.84, 0.2], [0.91, 0.36], [0.87, 0.55], [0.78, 0.72], [0.66, 0.86], [0.5, 0.93],
      [0.32, 0.9], [0.16, 0.8], [0.05, 0.64], [0.01, 0.42],
    ]
    const landShape = new THREE.Shape()
    boundary.forEach((uv, i) => {
      const w = worldP(uv[0], uv[1])
      if (i === 0) landShape.moveTo(w.x, w.z)
      else landShape.lineTo(w.x, w.z)
    })
    landShape.closePath()
    const sandShape = new THREE.Shape()
    boundary.forEach((uv, i) => {
      const w = worldP(0.5 + (uv[0] - 0.5) * 1.035, 0.5 + (uv[1] - 0.5) * 1.035)
      if (i === 0) sandShape.moveTo(w.x, w.z)
      else sandShape.lineTo(w.x, w.z)
    })
    sandShape.closePath()
    const sand = new THREE.Mesh(new THREE.ExtrudeGeometry(sandShape, { depth: 0.85, bevelEnabled: false }), mat(0xe5d2a5, 0.95))
    sand.rotation.x = Math.PI / 2
    sand.position.y = -0.06
    sand.receiveShadow = true
    terrainGroup.add(sand)
    const land = new THREE.Mesh(new THREE.ExtrudeGeometry(landShape, { depth: 0.8, bevelEnabled: false }), mat(0x9cbd7e, 0.98))
    land.rotation.x = Math.PI / 2
    land.position.y = 0.02
    land.receiveShadow = true
    terrainGroup.add(land)

    const riverU = [
      [0.02, 0.2], [0.1, 0.27], [0.18, 0.32], [0.25, 0.4], [0.26, 0.5],
      [0.31, 0.59], [0.39, 0.66], [0.47, 0.71], [0.56, 0.75], [0.68, 0.79],
    ]
    const riverPts = riverU.map((uv) => worldP(uv[0], uv[1]))
    terrainGroup.add(ribbon(riverPts, 3.8, 0xd5c39b, 0.12))
    terrainGroup.add(ribbon(riverPts, 2.5, 0x69b6cb, 0.15, 0.28))
    const riverSamples = []
    {
      const rc = new THREE.CatmullRomCurve3(riverPts)
      for (let i = 0; i <= 48; i++) riverSamples.push(rc.getPoint(i / 48))
    }

    // 道路：用户在 2D 地图上画好的折线（map.roads），3D 里铺成带边的土路
    const userRoads = Array.isArray(map.roads) ? map.roads : []
    const userRoadPaths = []
    function drawUserRoad(points) {
      if (!points || points.length < 2) return
      terrainGroup.add(ribbon(points, 2.35, 0xb99c71, 0.185, 0.9))
      terrainGroup.add(ribbon(points, 1.55, 0xe0cfa9, 0.2, 0.95))
      terrainGroup.add(ribbon(points, 0.1, 0xf1e5ce, 0.205, 0.8))
    }
    for (const line of userRoads) {
      if (!Array.isArray(line) || line.length < 2) continue
      const pts = line
        .map((pt) => worldP(Number(pt[0]), Number(pt[1])))
        .filter((p) => !isNaN(p.x) && !isNaN(p.z))
      if (pts.length < 2) continue
      drawUserRoad(pts)
      userRoadPaths.push(pts)
    }
    // 跨河的路自动补桥
    function segInter(a, b, c, d) {
      const r = { x: b.x - a.x, z: b.z - a.z }
      const s = { x: d.x - c.x, z: d.z - c.z }
      const den = r.x * s.z - r.z * s.x
      if (Math.abs(den) < 1e-6) return null
      const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / den
      const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / den
      if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) return null
      return { x: a.x + r.x * t, z: a.z + r.z * t }
    }
    const bridgePts = []
    for (const path of userRoadPaths) {
      for (let i = 0; i < path.length - 1; i++) {
        for (let j = 0; j < riverSamples.length - 1; j++) {
          const hit = segInter(path[i], path[i + 1], riverSamples[j], riverSamples[j + 1])
          if (!hit || bridgePts.some((q) => Math.hypot(q.x - hit.x, q.z - hit.z) < 9)) continue
          bridgePts.push(hit)
          const dx = path[i + 1].x - path[i].x
          const dz = path[i + 1].z - path[i].z
          const br = new THREE.Group()
          br.position.set(hit.x, 0.34, hit.z)
          br.rotation.y = -Math.atan2(dz, dx)
          br.add(box(5.2, 0.18, 3.2, 0x9a744a, 0, 0, 0))
          for (const z of [-1.45, 1.45]) br.add(box(5.5, 0.1, 0.14, 0x7c5a3d, 0, 0.65, z))
          for (const x of [-2.3, 2.3]) br.add(box(0.14, 0.8, 3.2, 0x6f5238, x, 0.2, 0))
          terrainGroup.add(br)
        }
      }
    }

    // 不妨碍道路/建筑的空地装饰：树、灌木、花、石头（确定性散布，不用随机数，重建也不闪）
    function landAt(x, z) {
      const u = 0.5 + x / state.worldW
      const v = 0.5 + z / state.worldH
      let inside = false
      for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
        const xi = boundary[i][0]
        const yi = boundary[i][1]
        const xj = boundary[j][0]
        const yj = boundary[j][1]
        if (((yi > v) !== (yj > v)) && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) inside = !inside
      }
      return inside
    }
    const decorFoot = {
      home: [5.2, 4.8], school: [10, 7.6], library: [7, 6.2], cafe: [6.2, 5.2], canteen: [9, 4.2],
      market: [9, 5.2], hospital: [7.6, 6.4], bank: [6.8, 6.2], mall: [9, 7.4], station: [11, 7.2], bookstore: [6.2, 5.4],
    }
    function nearPlace(x, z, pad) {
      for (const p of places) {
        const foot = decorFoot[p.id]
        if (!foot) continue
        const w = worldP(p.x, p.y)
        if (Math.abs(x - w.x) < foot[0] / 2 + pad && Math.abs(z - w.z) < foot[1] / 2 + pad) return true
      }
      return false
    }
    function nearPolyline(x, z, path, pad) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i]
        const b = path[i + 1]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const len2 = dx * dx + dz * dz || 1
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
        if (Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)) < pad) return true
      }
      return false
    }
    function nearAnyRoad(x, z, pad) {
      for (const path of userRoadPaths) {
        if (path.length > 1 && nearPolyline(x, z, path, pad)) return true
      }
      return false
    }
    const decorSpots = []
    for (let gx = -state.worldW / 2.5; gx <= state.worldW / 2.5; gx += 7) {
      for (let gz = -state.worldH / 2.5; gz <= state.worldH / 2.5; gz += 6) {
        const jx = ((gx * 13 + gz * 7) % 5) - 2
        const jz = ((gx * 5 + gz * 11) % 5) - 2
        const x = gx + jx
        const z = gz + jz
        if (!landAt(x, z)) continue
        if (nearPlace(x, z, 4.5) || nearAnyRoad(x, z, 3.8)) continue
        if (nearPolyline(x, z, riverPts, 3.2)) continue
        decorSpots.push({ x, z })
      }
    }
    let di = 0
    for (const s of decorSpots) {
      if (di % 3 === 0) terrainGroup.add(tree(s.x, s.z, 0.62 + (di % 4) * 0.08))
      else if (di % 3 === 1) {
        const bush = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.95, 6), mat(0x5f8f5a, 0.95))
        bush.position.set(s.x, 0.38, s.z)
        terrainGroup.add(bush)
      } else {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 5), mat([0xe6a3b6, 0xf1d17a, 0xd98776][di % 3], 0.85))
        fl.position.set(s.x, 0.26, s.z)
        terrainGroup.add(fl)
      }
      di++
      if (di > 60) break
    }
    for (let i = 0; i < 5; i++) {
      const s = decorSpots[(i + 9) % Math.max(1, decorSpots.length)]
      if (!s) break
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5, 0), mat(0x8d8b80, 0.95))
      rock.position.set(s.x, 0.3, s.z)
      rock.scale.setScalar(0.7 + i * 0.05)
      terrainGroup.add(rock)
    }
    terrainGroup.visible = true
  }

  // ── 地点名牌（都挂在 markerGroup；点击/悬浮走 raycast）──
  function buildPlaces(places) {
    const key = JSON.stringify((places || []).map((p) => [p.id, p.x, p.y, p.name, p.icon]))
    if (key === state.placesKey) return
    state.placesKey = key
    disposeChildren(markerGroup)
    placesById.clear()
    markerById.clear()
    for (const p of places || []) {
      const v = toWorld(p.x, p.y)
      const sp = labelSprite(p.name, p.icon ? String(p.icon) : '')
      sp.position.set(v.x, 8.8, v.z)
      sp.userData.sbc3dPlaceId = String(p.id)
      markerGroup.add(sp)
      placesById.set(String(p.id), p)
      markerById.set(String(p.id), sp)
    }
    markerGroup.visible = true
  }

  // ── 地图模型（map.model.url 是用户导入的 GLB；失败就退回程序化地形）──
  function buildEnv(map) {
    const model = map.model || null
    const key = model && model.url ? 'glb|' + model.url + '|' + (model.scale || 1) + '|' + (model.rotationY || 0) + '|' + (model.yOffset || 0) : 'proc'
    if (key === state.envKey) return
    state.envKey = key
    const token = ++state.envToken
    disposeChildren(envGroup, sharedMats)
    if (!model || !model.url) {
      envGroup.visible = false
      state.envRadius = 0
      return
    }
    sbc3dLoadGltfLoader().then((GLTFLoader) => {
      if (token !== state.envToken) return
      return new GLTFLoader().loadAsync(String(model.url)).then((gltf) => {
        if (token !== state.envToken) { disposeObject(gltf.scene); return }
        const obj = gltf.scene
        obj.scale.setScalar(Number(model.scale) || 1)
        obj.rotation.y = ((Number(model.rotationY) || 0) * Math.PI) / 180
        obj.position.y = Number(model.yOffset) || 0
        obj.traverse((node) => {
          if (node.isMesh) {
            node.castShadow = true
            node.receiveShadow = true
          }
        })
        envGroup.add(obj)
        envGroup.visible = true
        const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3())
        state.envRadius = Math.max(size.x, size.z) / 2
        updateSceneFit()
      })
    }).catch((e) => {
      if (token !== state.envToken) return
      state.envRadius = 0
      updateSceneFit()
      // 模型没加载出来：把程序化地面/网格放回来，至少不是一片空
      if (ground) ground.visible = true
      if (grid) grid.visible = true
      if (basePlane) basePlane.visible = true
      for (const r of roadMeshes) r.visible = true
      notice('地图模型加载失败，已用程序化地形：' + ((e && e.message) || e))
    })
  }

  // ── 相机/阴影自适应（用户导入大模型时把可视范围放大）──
  function updateSceneFit() {
    const r = Math.max(state.envRadius, state.charRadius)
    if (!(r > 0.001)) {
      if (state.fitApplied !== 0) {
        state.fitApplied = 0
        state.maxDist = 320
        if (!state.zoomTouched) state.dist = 100
        camera.far = 500
        camera.updateProjectionMatrix()
        const sr0 = 90
        dir.shadow.camera.left = -sr0
        dir.shadow.camera.right = sr0
        dir.shadow.camera.top = sr0
        dir.shadow.camera.bottom = -sr0
        dir.shadow.camera.far = 220
        dir.shadow.camera.updateProjectionMatrix()
        dir.position.set(40, 70, 25)
        scene.fog.near = 140
        scene.fog.far = 320
      }
      return
    }
    if (Math.abs(r - state.fitApplied) < 0.01) return
    state.fitApplied = r
    state.maxDist = Math.max(320, Math.min(3000, r * 2.2))
    if (!state.zoomTouched) state.dist = Math.min(state.maxDist, Math.max(100, r * 1.6))
    camera.far = Math.max(500, state.dist * 3)
    camera.updateProjectionMatrix()
    const sr = Math.min(240, Math.max(90, r * 1.2))
    dir.shadow.camera.left = -sr
    dir.shadow.camera.right = sr
    dir.shadow.camera.top = sr
    dir.shadow.camera.bottom = -sr
    dir.shadow.camera.far = Math.max(220, sr * 3)
    dir.shadow.camera.updateProjectionMatrix()
    dir.position.set(sr * 0.44, sr * 0.78, sr * 0.28)
    scene.fog.near = Math.max(140, r * 1.4)
    scene.fog.far = Math.max(320, r * 3.2)
  }

  // ── 载具：默认低模汽车/自行车；map.vehicles 配了 GLB 就换成用户的模型 ──
  function vehicleCar() {
    const g = new THREE.Group()
    g.add(box(3.4, 0.7, 1.7, 0xc96f5b, 0, 0.65, 0))
    g.add(box(1.75, 0.55, 1.4, 0xe6d7bd, -0.15, 1.2, 0))
    g.add(box(3.0, 0.16, 1.55, 0x7c3e35, 0, 0.98, 0))
    for (const x of [-1.05, 1.05]) {
      for (const z of [-0.72, 0.72]) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), mat(0x30383b, 0.75))
        wh.rotation.z = Math.PI / 2
        wh.position.set(x, 0.34, z)
        g.add(wh)
      }
    }
    for (const z of [-0.6, 0.6]) g.add(box(0.14, 0.16, 0.28, 0xffe2a8, 1.6, 0.75, z))
    return g
  }

  function vehicleBike() {
    const g = new THREE.Group()
    const dark = mat(0x3b4148, 0.65)
    const metal = mat(0x9da7aa, 0.4, 0.4)
    const seat = mat(0x6a4b38, 0.9)
    for (const z of [-0.72, 0.72]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.055, 6, 16), metal)
      wheel.rotation.y = Math.PI / 2
      wheel.position.set(0, 0.5, z)
      g.add(wheel)
    }
    function tube(a, b, r, material) {
      const av = new THREE.Vector3(a[0], a[1], a[2])
      const bv = new THREE.Vector3(b[0], b[1], b[2])
      const d = bv.clone().sub(av)
      const len = d.length()
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), material || dark)
      m.position.copy(av.clone().add(bv).multiplyScalar(0.5))
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
      g.add(m)
    }
    tube([0, 0.5, -0.72], [0, 0.62, 0.25], 0.045)
    tube([0, 0.62, 0.25], [0, 0.5, 0.72], 0.045)
    tube([0, 0.5, 0.72], [0, 0.5, 0.15], 0.045)
    tube([0, 0.62, 0.25], [0, 0.95, 0.12], 0.04)
    tube([-0.25, 0.95, 0.12], [0.25, 0.95, 0.12], 0.035)
    g.add(box(0.28, 0.06, 0.38, seat, 0, 0.98, -0.08))
    return g
  }

  function ensureVehicles(map) {
    const key = JSON.stringify(map.vehicles || {})
    if (key === state.vehiclesKey) return
    state.vehiclesKey = key
    const token = ++state.vehiclesToken
    disposeChildren(vehicleGroup, sharedMats)
    const cfg = map.vehicles || {}
    function makeGroup(kind) {
      const g = new THREE.Group()
      g.visible = false
      const c = cfg[kind]
      const tag = labelSprite(kind === 'car' ? '汽车' : '自行车', '')
      tag.scale.set(3.4, 1.7, 1)
      tag.position.set(0, kind === 'car' ? 3.3 : 2.6, 0)
      if (c && c.url) {
        sbc3dLoadGltfLoader().then((GLTFLoader) => {
          if (token !== state.vehiclesToken) return
          return new GLTFLoader().loadAsync(String(c.url)).then((gltf) => {
            if (token !== state.vehiclesToken) { disposeObject(gltf.scene); return }
            const obj = gltf.scene
            obj.scale.setScalar(Number(c.scale) || 1)
            obj.rotation.y = Number(c.rotationY) || 0
            obj.position.y = 0.12
            g.add(obj)
          })
        }).catch((e) => {
          notice('载具模型加载失败，已用默认模型：' + ((e && e.message) || e))
          g.add(kind === 'car' ? vehicleCar() : vehicleBike())
        })
      } else {
        g.add(kind === 'car' ? vehicleCar() : vehicleBike())
      }
      g.add(tag)
      vehicleGroup.add(g)
      return g
    }
    carGroup = makeGroup('car')
    bikeGroup = makeGroup('bicycle')
    vehicleGroup.visible = false
  }

  // ── 角色：GLB → sprite/live2d 立绘 → 程序化小鲸（model.html 同款）──
  function clearChar() {
    disposeChildren(charGroup, sharedMats)
    state.charRadius = 0
    if (state.mixer) {
      try { state.mixer.stopAllAction() } catch (e) {}
      state.mixer = null
    }
    charModel = null
    fallbackBody = null
    spritePlane = null
    state.charActions = []
    state.activeCharAction = null
    updateSceneFit()
  }

  function buildChibi(character) {
    const g = new THREE.Group()
    const cp = (character && character.chibi) || {}
    const dressCol = Number(cp.dress) || 0x7fa9df
    const hairCol = Number(cp.hair) || 0x5d7fc4
    const skinCol = Number(cp.skin) || 0xffe4cf
    const accentCol = Number(cp.accent) || 0x4f72b8
    const blue = mat(dressCol, 0.8)
    const hair = mat(hairCol, 0.85)
    const skin = mat(skinCol, 0.9)
    const dress = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.8, 12), blue)
    dress.position.y = 1.0
    dress.castShadow = true
    g.add(dress)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.78, 16, 12), skin)
    head.position.y = 2.35
    head.castShadow = true
    g.add(head)
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.86, 16, 12), hair)
    hairCap.position.y = 2.58
    hairCap.scale.y = 0.82
    g.add(hairCap)
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), mat(accentCol, 0.8))
      ear.position.set(s * 0.9, 2.25, -0.05)
      ear.rotation.z = s * 0.55
      g.add(ear)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), mat(0x273a5a, 0.4))
      eye.position.set(s * 0.28, 2.38, 0.72)
      g.add(eye)
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.85, 8), skin)
      arm.position.set(s * 0.72, 1.55, 0.1)
      arm.rotation.z = s * 0.35
      g.add(arm)
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.1, 8), mat(hairCol, 0.75))
    tail.position.set(0, 0.95, -1.0)
    tail.rotation.x = 1.0
    g.add(tail)
    const tag = labelSprite((character && character.name) || '她', '')
    tag.scale.set(5.5, 2.75, 1)
    tag.position.set(0, 4.6, 0)
    g.add(tag)
    g.scale.setScalar(1.25)
    return g
  }

  function buildChar(character) {
    const model = (character && character.model) || { type: 'none', url: '', scale: 1 }
    const key = [
      model.type, model.url || '', model.scale || 1, model.rotationY || 0,
      (character && character.id) || '', JSON.stringify((character && character.chibi) || {}),
      (character && character.name) || '',
    ].join('|')
    if (key === state.charKey) return
    state.charKey = key
    const token = ++state.charToken
    clearChar()
    const scale = Number(model.scale) || 1
    const type = String(model.type || 'none')

    const blob = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32 })
    )
    blob.rotation.x = -Math.PI / 2
    blob.position.y = 0.02
    charGroup.add(blob)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.4, 4.2, 32),
      new THREE.MeshBasicMaterial({ color: sbc3dAccent(), transparent: true, opacity: 0.7, side: THREE.DoubleSide })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    charGroup.add(ring)

    const makeFallback = () => {
      fallbackBody = new THREE.Group()
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.4, 4, 6, 12), new THREE.MeshStandardMaterial({ color: 0x5f8fe8, roughness: 0.5 }))
      body.position.y = 3.4
      fallbackBody.add(body)
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 16), new THREE.MeshStandardMaterial({ color: 0xffe9dc, roughness: 0.6 }))
      head.position.y = 7.2
      fallbackBody.add(head)
      charGroup.add(fallbackBody)
    }
    const addSprite = (url, height) => {
      const t = new THREE.TextureLoader()
      Api.imgUrl(String(url)).then((src) => {
        if (!src || token !== state.charToken) return
        t.load(src, (tex) => {
          if (token !== state.charToken) { try { tex.dispose() } catch (e) {} return }
          try {
            tex.colorSpace = THREE.SRGBColorSpace
            const m = new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false })
            const sp = new THREE.Sprite(m)
            const aspect = tex.image && tex.image.width && tex.image.height ? tex.image.width / tex.image.height : 1
            sp.scale.set(height * aspect, height, 1)
            sp.position.y = height * 0.55
            charGroup.add(sp)
            spritePlane = sp
          } catch (e) { makeFallback() }
        }, undefined, () => { if (token === state.charToken && !spritePlane) makeFallback() })
      }).catch(() => { if (token === state.charToken && !spritePlane) makeFallback() })
    }

    if (type === '3d' && model.url) {
      sbc3dLoadGltfLoader().then((GLTFLoader) => {
        if (token !== state.charToken) return
        return new GLTFLoader().loadAsync(String(model.url)).then((gltf) => {
          if (token !== state.charToken) { disposeObject(gltf.scene); return }
          gltf.scene.traverse((node) => { if (node.isMesh) node.castShadow = true })
          charModel = gltf.scene
          charModel.scale.setScalar(scale)
          charModel.rotation.y = Number(model.rotationY) || 0
          const box3 = new THREE.Box3().setFromObject(charModel)
          charModel.position.y = -box3.min.y
          charGroup.add(charModel)
          const size = box3.getSize(new THREE.Vector3())
          state.charRadius = Math.max(size.x, size.y, size.z) * 1.2
          updateSceneFit()
          const clips = gltf.animations || []
          if (clips.length) {
            state.mixer = new THREE.AnimationMixer(charModel)
            state.charActions = clips.map((clip) => state.mixer.clipAction(clip))
            playCharClip(state.desiredCharClip || 'Idle')
          }
        })
      }).catch((e) => {
        if (token !== state.charToken) return
        makeFallback()
        notice('角色模型加载失败，已用兜底形象：' + ((e && e.message) || e))
      })
      return
    }
    if ((type === 'sprite' || type === 'live2d') && model.url) {
      addSprite(model.url, 9 * scale)
      return
    }
    // 无 3D 模型：用原 3D 舞台的程序化小鲸（比头像白板好看）；造不出来时用胶囊兜底
    try {
      charGroup.add(buildChibi(character))
      updateSceneFit()
    } catch (e) {
      makeFallback()
    }
  }

  function playCharClip(name, manual) {
    if (manual) state.desiredCharClip = String(name || 'Idle')
    const want = String(name || state.desiredCharClip || 'Idle').toLowerCase()
    if (!state.charActions || !state.charActions.length) return
    let action = state.charActions.find((a) => String((a.getClip && a.getClip().name) || '').toLowerCase() === want)
    if (!action) action = state.charActions.find((a) => String((a.getClip && a.getClip().name) || '').toLowerCase() === 'idle') || state.charActions[0]
    if (!action || action === state.activeCharAction) return
    if (state.activeCharAction) state.activeCharAction.fadeOut(0.18)
    action.reset().fadeIn(0.18).play()
    state.activeCharAction = action
  }

  // ── 行程路径线 ──
  function drawPath(path) {
    const key = path && path.length > 1 ? path.length + '|' + JSON.stringify(path[0]) + '|' + JSON.stringify(path[path.length - 1]) : ''
    if (key === state.pathKey) return
    state.pathKey = key
    if (routeLine) {
      scene.remove(routeLine)
      disposeObject(routeLine)
      routeLine = null
    }
    if (!path || path.length < 2) return
    const pts = path.map((p) => {
      const v = toWorld(p.x, p.y)
      v.y = 0.3
      return v
    })
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const m = new THREE.LineDashedMaterial({ color: 0x7db7ff, dashSize: 2.4, gapSize: 1.2 })
    routeLine = new THREE.Line(geo, m)
    routeLine.computeLineDistances()
    scene.add(routeLine)
  }

  // ── 角色世界坐标（行程中按时间插值，和 2D 舞台的 stageTravelProgress 同一套算法）──
  const charPosTmp = new THREE.Vector3()
  function characterWorldPos(out) {
    const v = out || new THREE.Vector3()
    const data = state.data
    if (!data || !data.location) return v.set(0, 0, 0)
    const loc = data.location
    const places = (data.map && data.map.places) || []
    if (loc.state === 'stationary') {
      const at = places.find((x) => String(x.id) === String(loc.placeId)) || { x: 0.5, y: 0.5 }
      return toWorld(at.x, at.y, v)
    }
    if (loc.state === 'intercity') return toWorld(0.5, 0.2, v)
    const t = loc.traveling
    if (loc.state === 'traveling' && t && t.path && t.path.length > 1) {
      const path = t.path
      const prog = clampNum((Date.now() - Number(t.startedAt || 0)) / Math.max(1, Number(t.durationMs) || 1), 0, 1)
      let total = 0
      const segs = []
      for (let i = 0; i < path.length - 1; i++) {
        const d = Math.hypot(Number(path[i].x) - Number(path[i + 1].x), Number(path[i].y) - Number(path[i + 1].y))
        segs.push(d)
        total += d
      }
      let target = total * prog
      for (let i = 0; i < segs.length; i++) {
        if (target <= segs[i] || i === segs.length - 1) {
          const r = segs[i] ? clampNum(target / segs[i], 0, 1) : 1
          const nx = Number(path[i].x) + (Number(path[i + 1].x) - Number(path[i].x)) * r
          const ny = Number(path[i].y) + (Number(path[i + 1].y) - Number(path[i].y)) * r
          return toWorld(nx, ny, v)
        }
        target -= segs[i]
      }
    }
    return toWorld(0.5, 0.2, v)
  }

  // ── 昼夜 / 天气色调（复用 model.html 的思路）──
  function applyDaylight(data) {
    const h = new Date().getHours() + new Date().getMinutes() / 60
    const phase = h >= 5 && h < 7 ? 'dawn' : h >= 7 && h < 17 ? 'day' : h >= 17 && h < 19.5 ? 'dusk' : 'night'
    const wxKind = String((data.weather && data.weather.kind) || 'sunny')
    const skies = { rain: 0x1a2531, snow: 0x2a3640, sunny: 0x0d1a24, hot: 0x2a1a12, cold: 0x16222e, windy: 0x19232c, cloudy: 0x141d26 }
    const todSkies = { dawn: 0x3a2a3a, day: 0x0d1a24, dusk: 0x2a1a24, night: 0x05070f }
    let sky = skies[wxKind] === undefined ? 0x0d1a24 : skies[wxKind]
    if (phase === 'night') sky = 0x05070f
    else if (phase === 'dawn' || phase === 'dusk') {
      try {
        sky = new THREE.Color(sky).lerp(new THREE.Color(todSkies[phase]), 0.45).getHex()
      } catch (e) { sky = todSkies[phase] }
    }
    scene.background = new THREE.Color(sky)
    if (scene.fog) scene.fog.color.set(sky)
    const dayFactor = phase === 'day' ? 1 : phase === 'dawn' || phase === 'dusk' ? 0.7 : 0.35
    hemi.intensity = phase === 'day' ? 1.0 : phase === 'night' ? 0.35 : 0.68
    ambient.intensity = phase === 'day' ? 0.65 : phase === 'night' ? 0.22 : 0.45
    const wet = wxKind === 'rain' || wxKind === 'snow'
    dir.intensity = (wet ? 1.5 : wxKind === 'sunny' ? 2.4 : 2.0) * dayFactor
  }

  // ── 按地图重建底座（地面 + 各分支的可见性），世界尺寸/底图变了才跑 ──
  //   地形/建筑/名牌/地图模型不在这里建：它们每次轮询都按自己的 key 去重（见 apply），
  //   这样在地图编辑器里拖动地点、加地点、画道路时 3D 也会跟着变。
  function rebuildBase(map, env, aspect) {
    state.worldW = sbc3dWorldWidth(map.widthMeters)
    state.worldH = state.worldW / (aspect > 0.05 ? aspect : SBC3D_ASPECT_FALLBACK)
    state.groundKey = ''
    state.townKey = ''
    state.placesKey = ''
    state.terrainKey = ''
    state.envKey = ''
    state.pathKey = ''
    state.vehiclesKey = ''
    state.charKey = ''
    state.official = !!map.official3d
    state.showTown = false
    if (grid) { scene.remove(grid); disposeObject(grid); grid = null }

    if (env) {
      // 用户导入的 3D 地图模型：程序化地面/道路全部让位
      buildGround(map.theme, '')
      if (ground) ground.visible = false
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = false
      terrainGroup.visible = false
      townGroup.visible = false
    } else if (map.official3d) {
      buildGround(map.theme, '')
      if (ground) ground.visible = false
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = false
      terrainGroup.visible = true
      state.showTown = true
    } else if (map.imageUrl) {
      // 普通 2D 底图：铺成地面贴图（建筑会跟画好的底图重复，所以不建程序化小镇）
      buildGround(map.theme, map.imageUrl)
      if (ground) ground.visible = true
      if (grid) grid.visible = false
      for (const r of roadMeshes) r.visible = false
      basePlane.visible = true
      terrainGroup.visible = false
      townGroup.visible = false
    } else {
      buildGround(map.theme, '')
      if (ground) ground.visible = true
      if (grid) grid.visible = true
      for (const r of roadMeshes) r.visible = true
      basePlane.visible = true
      terrainGroup.visible = false
      townGroup.visible = true
      state.showTown = true
    }
  }

  // ── 主更新：/api/stage 每次轮询都会调；只有变化的部分重建 ──
  function apply(data) {
    if (!state.running) return
    if (!data || !data.map) return
    state.data = data
    const map = data.map || {}
    const loc = data.location || {}
    const imageUrl = map.image && map.image.url ? String(map.image.url) : ''
    const official3d = imageUrl.indexOf('official-map') >= 0
    const envModel = map.model && map.model.url ? map.model : null
    const aspect = official3d ? 1.5 : sbc3dImageAspect(imageUrl)
    if (!official3d && imageUrl && !sbc3dAspectCache.has(imageUrl)) {
      // 第一次见到这张底图：先量宽高比，量出来后再重建一次（只多一次）
      sbc3dMeasureImage(imageUrl, () => { if (state.data) apply(state.data) })
    }
    const worldKey = [
      map.id, map.name, map.theme, map.widthMeters, imageUrl,
      official3d ? 'official' : 'plain', envModel ? 'env' : 'noenv', aspect,
    ].join('|')
    const normMap = {
      places: Array.isArray(map.places) ? map.places : [],
      roads: Array.isArray(map.roads) ? map.roads : [],
      vehicles: map.vehicles || {},
      theme: map.theme,
      widthMeters: map.widthMeters,
      official3d,
      imageUrl,
      model: envModel,
    }
    if (worldKey !== state.worldKey) {
      state.worldKey = worldKey
      rebuildBase(normMap, !!envModel, aspect)
    }
    // 这些函数内部都有 key 去重：数据没变就是空操作；地点/道路被编辑过就会重建
    if (state.official) buildOfficialTerrain(normMap)
    if (state.showTown) buildTown(normMap.places)
    buildPlaces(normMap.places)
    buildEnv(normMap)
    applyDaylight(data)
    ensureVehicles(map)
    buildChar(data.character || {})

    // 载具：只有出行方式是 car/bike 时显示
    const mode = String((loc.traveling && loc.traveling.mode) || '')
    state.carMode = loc.state === 'traveling' && /car|taxi|drive|auto/.test(mode)
    state.bikeMode = loc.state === 'traveling' && /bike|bicycle|cycle/.test(mode)
    if (carGroup) carGroup.visible = state.carMode
    if (bikeGroup) bikeGroup.visible = state.bikeMode
    vehicleGroup.visible = state.carMode || state.bikeMode
    charGroup.visible = !(state.carMode || state.bikeMode)

    drawPath(loc.state === 'traveling' && loc.traveling ? loc.traveling.path : null)
    state.desiredCharClip = loc.state === 'traveling' ? 'Walk' : 'Idle'
    playCharClip(state.desiredCharClip)
    if (!state.camReady) resetCameraToChar()
  }

  // ── 相机：跟随 + 拖动旋转 + 滚轮/双指缩放 ──
  const camTarget = new THREE.Vector3()
  const camPosTmp = new THREE.Vector3()
  const focusTmp = new THREE.Vector3()
  const prevTmp = new THREE.Vector3()

  function clampDist(d) {
    return Math.min(state.maxDist, Math.max(30, d))
  }

  function cameraPositionFor(target, out) {
    const cp = Math.cos(state.pitch)
    return out.set(
      target.x + Math.sin(state.yaw) * cp * state.dist,
      target.y + 6 + Math.sin(state.pitch) * state.dist,
      target.z + Math.cos(state.yaw) * cp * state.dist
    )
  }

  function resetCameraToChar() {
    const p = characterWorldPos(charPosTmp)
    p.x += 1.6
    p.z += 2.6
    camTarget.copy(p)
    charGroup.position.copy(p)
    cameraPositionFor(camTarget, camera.position)
    camera.lookAt(camTarget.x, camTarget.y + 5, camTarget.z)
    state.camReady = true
  }

  function pointerNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect()
    const w = Math.max(1, rect.width)
    const h = Math.max(1, rect.height)
    return {
      x: ((clientX - rect.left) / w) * 2 - 1,
      y: -(((clientY - rect.top) / h) * 2 - 1),
    }
  }

  const raycaster = new THREE.Raycaster()

  function placeIdOf(object) {
    let node = object
    while (node) {
      if (node.userData && node.userData.sbc3dPlaceId) return String(node.userData.sbc3dPlaceId)
      node = node.parent
    }
    return ''
  }

  // 点击/悬浮命中的地点：先 raycast（名牌 + 建筑），没中就按屏幕距离找最近名牌（更好点）
  function pickPlaceAt(clientX, clientY) {
    const ndc = pointerNdc(clientX, clientY)
    raycaster.setFromCamera(ndc, camera)
    const roots = []
    if (markerGroup.visible) roots.push(markerGroup)
    if (townGroup.visible) roots.push(townGroup)
    if (envGroup.visible) roots.push(envGroup)
    let hits = []
    try { hits = raycaster.intersectObjects(roots, true) } catch (e) { hits = [] }
    for (const hit of hits) {
      const id = placeIdOf(hit.object)
      if (id && placesById.has(id)) return placesById.get(id)
    }
    // 兜底：名牌投影到屏幕，60px 内算点中（名牌是 sprite，raycast 已经能中，这里给更宽容的手感）
    const rect = canvas.getBoundingClientRect()
    let best = null
    let bestD = 60
    markerById.forEach((sp, id) => {
      if (!sp) return
      const v = sp.position.clone().project(camera)
      if (v.z > 1) return
      const sx = rect.left + ((v.x + 1) / 2) * rect.width
      const sy = rect.top + ((1 - v.y) / 2) * rect.height
      const d = Math.hypot(sx - clientX, sy - clientY)
      if (d < bestD) { bestD = d; best = id }
    })
    if (best && placesById.has(best)) return placesById.get(best)
    return null
  }

  function updateHover(clientX, clientY) {
    if (!state.pointerInside || state.dragging) return
    let hit = null
    try { hit = pickPlaceAt(clientX, clientY) } catch (e) { hit = null }
    canvas.style.cursor = hit ? 'pointer' : 'grab'
  }

  // 指针交互。双击缩放不处理（和 model.html 一致：拖动旋转、滚轮缩放）。
  const pointerState = { x: 0, y: 0 }

  function onPointerDown(e) {
    try { canvas.setPointerCapture(e.pointerId) } catch (err) {}
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (state.pointers.size === 1) {
      state.dragging = true
      state.pinching = false
      state.lastX = e.clientX
      state.lastY = e.clientY
      state.pressX = e.clientX
      state.pressY = e.clientY
      state.pressAt = Date.now()
      canvas.style.cursor = 'grabbing'
    } else {
      state.dragging = false
      state.pinching = true
      state.pinch = pinchDistance()
    }
  }

  function pinchDistance() {
    const it = state.pointers.values()
    const a = it.next().value
    const b = it.next().value
    if (!a || !b) return 0
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function onPointerMove(e) {
    if (!state.pointers.has(e.pointerId)) {
      // 没按着：只更新 hover（限制在 canvas 区域里，避免鼠标在别处也做射线检测）
      let inside = false
      try {
        const rect = canvas.getBoundingClientRect()
        inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom
      } catch (err) { inside = false }
      state.pointerInside = inside
      pointerState.x = e.clientX
      pointerState.y = e.clientY
      if (inside) state.hoverDirty = true
      return
    }
    state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    pointerState.x = e.clientX
    pointerState.y = e.clientY
    if (state.pointers.size >= 2) {
      const d = pinchDistance()
      if (state.pinch > 0 && d > 0) {
        state.dist = clampDist(state.dist * (state.pinch / d))
        state.zoomTouched = true
      }
      state.pinch = d
      return
    }
    if (!state.dragging) return
    state.yaw -= (e.clientX - state.lastX) * 0.005
    state.pitch = Math.min(1.35, Math.max(0.18, state.pitch - (e.clientY - state.lastY) * 0.004))
    state.lastX = e.clientX
    state.lastY = e.clientY
    canvas.style.cursor = 'grabbing'
  }

  function onPointerUp(e) {
    const wasDragging = state.dragging
    const moved = Math.hypot(e.clientX - state.pressX, e.clientY - state.pressY)
    const quick = Date.now() - state.pressAt < 700
    state.pointers.delete(e.pointerId)
    try {
      if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
    } catch (err) {}
    if (state.pointers.size === 1) {
      const next = state.pointers.values().next().value
      state.dragging = true
      state.lastX = next.x
      state.lastY = next.y
      state.pinch = 0
      return
    }
    state.dragging = false
    state.pinching = false
    state.pinch = 0
    canvas.style.cursor = 'grab'
    // 轻点（不是拖拽）→ 点地点
    if (wasDragging && quick && moved < 6 && typeof o.onPick === 'function') {
      let place = null
      try { place = pickPlaceAt(e.clientX, e.clientY) } catch (err) { place = null }
      if (place) {
        try { o.onPick(place) } catch (err) {}
      }
    }
  }

  function onPointerLeave() {
    state.pointerInside = false
    canvas.style.cursor = 'grab'
  }

  function onWheel(e) {
    if (e.preventDefault) e.preventDefault()
    state.dist = clampDist(state.dist + (e.deltaY > 0 ? 8 : -8))
    state.zoomTouched = true
  }

  // 上下文丢失：6 秒还没恢复就认输，交给 stage.js 切回 2D（不留下一个黑画布）
  let contextLostTimer = 0
  function onContextLost(e) {
    if (e && e.preventDefault) e.preventDefault()
    notice('3D 上下文丢失，正在尝试恢复…')
    try { win.clearTimeout(contextLostTimer) } catch (err) {}
    contextLostTimer = win.setTimeout(() => {
      let lost = false
      try {
        const ctx = renderer.getContext && renderer.getContext()
        lost = !!(ctx && ctx.isContextLost && ctx.isContextLost())
      } catch (err) { lost = true }
      if (!lost) return
      if (typeof o.onFail === 'function') {
        try { o.onFail('WebGL 上下文丢失且恢复失败') } catch (err) {}
      }
    }, 6000)
  }

  function onContextRestored() {
    try { win.clearTimeout(contextLostTimer) } catch (e) {}
    contextLostTimer = 0
    notice('')
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  canvas.addEventListener('pointerleave', onPointerLeave)
  canvas.addEventListener('wheel', onWheel, { passive: false })
  canvas.addEventListener('webglcontextlost', onContextLost)
  canvas.addEventListener('webglcontextrestored', onContextRestored)
  // 指针跑到 canvas 外面再松开也要收尾（否则会一直处于拖拽态）
  const winTarget = win || canvas
  winTarget.addEventListener('pointerup', onPointerUp)
  winTarget.addEventListener('pointercancel', onPointerUp)
  winTarget.addEventListener('pointermove', onPointerMove)

  // rAF 兜底（极端环境下 win 上没有这两个方法时也不至于抛）
  const requestFrame = win && typeof win.requestAnimationFrame === 'function'
    ? (fn) => win.requestAnimationFrame(fn)
    : (typeof requestAnimationFrame === 'function' ? (fn) => requestAnimationFrame(fn) : (fn) => setTimeout(fn, 16))
  const cancelFrame = win && typeof win.cancelAnimationFrame === 'function'
    ? (id) => win.cancelAnimationFrame(id)
    : (typeof cancelAnimationFrame === 'function' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id))

  // ── 尺寸自适应 ──
  let ro = null
  function resize() {
    const w = Math.max(1, Math.round(Number(host.clientWidth) || 0))
    const h = Math.max(1, Math.round(Number(host.clientHeight) || 0))
    try {
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    } catch (e) {}
  }
  resize()
  try {
    if (typeof win.ResizeObserver === 'function') {
      ro = new win.ResizeObserver(resize)
      ro.observe(host)
    } else if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(resize)
      ro.observe(host)
    }
  } catch (e) { ro = null }
  const resizeFallback = !ro
  if (resizeFallback) winTarget.addEventListener('resize', resize)
  // host 尺寸可能首帧是 0（还没 layout 完），下一帧再量一次
  try { requestFrame(() => resize()) } catch (e) {}

  // ── 动画循环 ──
  const clock = new THREE.Clock()
  state.clock = clock
  const charFollowTmp = new THREE.Vector3()

  function frame() {
    if (!state.running) return
    state.raf = requestFrame(frame)
    const hidden = typeof doc.hidden === 'boolean' && doc.hidden
    let delta = 0
    try { delta = Math.min(Number(clock.getDelta()) || 0, 0.1) } catch (e) { delta = 0.016 }
    if (hidden) return
    const data = state.data
    if (data) {
      // 相机跟着她；站到建筑前侧，避免小鲸被建筑盖住
      const p = characterWorldPos(charFollowTmp)
      p.x += 1.6
      p.z += 2.6
      focusTmp.copy(p)
      camTarget.lerp(focusTmp, 0.08)
      cameraPositionFor(camTarget, camPosTmp)
      camera.position.lerp(camPosTmp, 0.1)
      camera.lookAt(camTarget.x, camTarget.y + 5, camTarget.z)

      const charTarget = characterWorldPos(charPosTmp)
      charTarget.x += 1.6
      charTarget.z += 2.6
      prevTmp.copy(charGroup.position)
      charGroup.position.lerp(charTarget, 0.12)
      vehicleGroup.position.copy(charGroup.position)

      const traveling = !!(data.location && data.location.state === 'traveling')
      if (traveling) {
        const dx = charGroup.position.x - prevTmp.x
        const dz = charGroup.position.z - prevTmp.z
        if (Math.abs(dx) + Math.abs(dz) > 0.0005) {
          const targetYaw = Math.atan2(dx, dz)
          let cur = charGroup.rotation.y
          let d = targetYaw - cur
          while (d > Math.PI) d -= Math.PI * 2
          while (d < -Math.PI) d += Math.PI * 2
          charGroup.rotation.y = cur + d * 0.15
        }
        charGroup.position.y = Math.abs(Math.sin(Date.now() / 160)) * 0.35
      } else {
        charGroup.position.y *= 0.9
      }
    }
    if (state.mixer) {
      try { state.mixer.update(delta) } catch (e) {}
    }
    try { renderer.render(scene, camera) } catch (e) {}
    const now = Date.now()
    if (state.hoverDirty && now - state.hoverAt > 110) {
      state.hoverDirty = false
      state.hoverAt = now
      updateHover(pointerState.x, pointerState.y)
    }
  }
  state.raf = requestFrame(frame)

  // ── 提示信息（不致命：模型加载失败之类）──
  let lastNotice = ''
  function notice(msg) {
    const text = String(msg || '')
    if (text === lastNotice) return
    lastNotice = text
    if (typeof o.onNotice === 'function') {
      try { o.onNotice(text) } catch (e) {}
    }
  }

  // ── 卸载：把所有监听/GPU 资源都清掉（M08 切换不泄漏）──
  function dispose() {
    if (!state.running) return
    state.running = false
    try { win.clearTimeout(contextLostTimer) } catch (e) {}
    try { if (state.raf) cancelFrame(state.raf) } catch (e) {}
    state.raf = 0
    if (ro) {
      try { ro.disconnect() } catch (e) {}
      ro = null
    }
    if (resizeFallback) {
      try { winTarget.removeEventListener('resize', resize) } catch (e) {}
    }
    try {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      winTarget.removeEventListener('pointerup', onPointerUp)
      winTarget.removeEventListener('pointercancel', onPointerUp)
      winTarget.removeEventListener('pointermove', onPointerMove)
    } catch (e) {}
    state.pointers.clear()
    if (state.mixer) {
      try { state.mixer.stopAllAction() } catch (e) {}
      state.mixer = null
    }
    // 遍历整个 scene，几何/材质/贴图一次性释放（用 Set 去重，共享材质只释放一次）
    const geos = new Set()
    const mats = new Set()
    const texs = new Set()
    try {
      scene.traverse((node) => {
        if (node.geometry) geos.add(node.geometry)
        const ms = node.material ? (Array.isArray(node.material) ? node.material : [node.material]) : []
        for (const m of ms) {
          if (!m) continue
          mats.add(m)
          for (const k of ['map', 'normalMap', 'emissiveMap', 'alphaMap']) {
            if (m[k]) texs.add(m[k])
          }
        }
      })
    } catch (e) {}
    geos.forEach((g) => { try { g.dispose() } catch (e) {} })
    texs.forEach((t) => { try { t.dispose() } catch (e) {} })
    mats.forEach((m) => { try { m.dispose() } catch (e) {} })
    matCache.clear()
    sharedMats.clear()
    try { renderer.setAnimationLoop && renderer.setAnimationLoop(null) } catch (e) {}
    try { renderer.dispose() } catch (e) {}
    // 主动丢上下文：面板里反复切 2D/3D 时，靠这个避免浏览器 WebGL 上下文数量上限
    try { if (renderer.forceContextLoss) renderer.forceContextLoss() } catch (e) {}
    try { if (canvas.parentNode) canvas.parentNode.removeChild(canvas) } catch (e) {}
  }

  return {
    update: apply,
    dispose,
    canvas,
    // 供自测/排查用：世界尺寸（真实数据下可核对换算）
    size: () => ({ w: state.worldW, h: state.worldH }),
  }
}

// ─────────────────────────── D. 引导 + React 组件 ───────────────────────────

// 加载 three → 建世界。任何一步失败都 reject 一个带中文原因的 Error（ThreeStage 统一转 onFail）。
async function sbc3dBoot(host, opts) {
  const THREE = await sbc3dLoadThree()
    .catch((e) => { throw new Error('3D 引擎加载失败：' + ((e && e.message) || e)) })
  if (!THREE) throw new Error('3D 引擎加载失败')
  return sbc3dCreateWorld(host, opts, THREE)
}

function ThreeStage(props) {
  const p = props || {}
  const compact = !!p.compact
  const hostRef = React.useRef(null)
  const worldRef = React.useRef(null)
  const propsRef = React.useRef(p)
  propsRef.current = p
  const dataRef = React.useRef(p.data || null)
  dataRef.current = p.data || null
  const [phase, setPhase] = React.useState('boot') // boot | ready | failed
  const [notice, setNotice] = React.useState('')

  React.useEffect(() => {
    let alive = true
    let world = null
    const host = hostRef.current
    const fail = (e) => {
      if (!alive) return
      setPhase('failed')
      const reason = (e && e.message) || String(e || '') || '3D 舞台初始化失败'
      const cb = propsRef.current.onFail
      if (typeof cb === 'function') {
        try { cb(reason) } catch (err) {}
      }
    }
    const boot = async () => {
      try {
        if (!host) throw new Error('3D 容器还没挂上')
        const w = await sbc3dBoot(host, {
          compact,
          onPick: (place) => {
            const cb = propsRef.current.onPickPlace
            if (typeof cb === 'function' && place) {
              try { cb(place) } catch (e) {}
            }
          },
          onNotice: (msg) => { if (alive) setNotice(String(msg || '')) },
        })
        if (!alive) {
          try { w.dispose() } catch (e) {}
          return
        }
        world = w
        worldRef.current = w
        try { w.update(dataRef.current) } catch (e) {}
        setPhase('ready')
      } catch (e) {
        fail(e)
      }
    }
    boot()
    return () => {
      alive = false
      worldRef.current = null
      if (world) {
        try { world.dispose() } catch (e) {}
        world = null
      }
    }
  }, [])

  // 数据轮询：/api/stage 每 2.5s 换一个新对象，update 内部按 key 去重，只重建变化的部分
  React.useEffect(() => {
    const w = worldRef.current
    if (!w) return
    try { w.update(p.data || null) } catch (e) {}
  }, [p.data])

  const overlayText = phase === 'boot' ? '3D 舞台加载中…' : ''

  return h('div', {
    style: {
      position: 'absolute', inset: 0, overflow: 'hidden',
      background: '#0b141d',
      borderRadius: compact ? 8 : 12,
    },
  },
    h('div', {
      ref: hostRef,
      style: { position: 'absolute', inset: 0 },
    }),
    overlayText
      ? h('div', {
          style: {
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', background: 'rgba(8,13,20,.72)', color: 'rgba(215,222,232,.82)',
            fontSize: compact ? 11 : 12.5, lineHeight: 1.7, textAlign: 'center', padding: 12,
          },
        }, overlayText)
      : null,
    notice
      ? h('div', {
          style: {
            position: 'absolute', left: 8, right: 8, bottom: 8, pointerEvents: 'none',
            background: 'rgba(8,13,20,.78)', border: '1px solid rgba(245,158,11,.55)',
            borderRadius: 8, padding: '3px 8px', fontSize: 10.5, lineHeight: 1.5,
            color: '#f2d7a0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          },
          title: notice,
        }, notice)
      : null,
    !compact && !notice
      ? h('div', {
          style: {
            position: 'absolute', right: 8, bottom: 8, pointerEvents: 'none',
            fontSize: 10, color: 'rgba(215,222,232,.55)', textShadow: '0 1px 3px rgba(0,0,0,.8)',
            whiteSpace: 'nowrap',
          },
        }, '拖动旋转 · 滚轮缩放 · 点地点让她去')
      : null,
  )
}
