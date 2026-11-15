// 20-stage/skeleton.js —— 2D 骨骼角色（网格蒙皮，Live2D 式）
//
// 为什么是网格而不是切图：AI 出的单张立绘没有「按关节画好的零件」，硬切会在旋转时
// 互相错位/露缝/散架（试过，失败）。行业做法（Spine/Live2D）对单张图是：整图做网格 +
// 骨骼权重驱动顶点变形——头发、身体、四肢永远是同一张连续贴图，物理上不可能分开。
//
// 数据：/skeleton-assets/<角色>/rig-mesh.json（骨骼线段、权重半径、网格数、贴图尺寸）
// 贴图：/skeleton-assets/<角色>/body.png（透明背景，高度约 1000px）
// 顾客自定义：换 body.png + 改 rig-mesh.json 的关节坐标即可；加载失败自动回退头像图。

const SKELETON_CHAR_ID = 'xiaojing'
const SKELETON_ASSET_PREFIX = '/skeleton-assets/' + SKELETON_CHAR_ID + '/'
const SKELETON_SWITCH_KEY = 'sbc-2d-skeleton'
const SKELETON_RIG_FALLBACK = {
  texture: 'body.png',
  size: [534, 1000],
  grid: [26, 38],
  bones: {
    hips: { parent: null, p0: [267, 600], p1: [267, 550] },
    spine: { parent: 'hips', p0: [267, 470], p1: [267, 410] },
    head: { parent: 'spine', p0: [267, 400], p1: [267, 200] },
    armUL: { parent: 'spine', p0: [155, 445], p1: [131, 520] },
    armLL: { parent: 'armUL', p0: [125, 545], p1: [83, 615] },
    armUR: { parent: 'spine', p0: [379, 445], p1: [403, 520] },
    armLR: { parent: 'armUR', p0: [409, 545], p1: [451, 615] },
    thighL: { parent: 'hips', p0: [222, 700], p1: [222, 840] },
    shinL: { parent: 'thighL', p0: [222, 845], p1: [222, 960] },
    thighR: { parent: 'hips', p0: [312, 700], p1: [312, 840] },
    shinR: { parent: 'thighR', p0: [312, 845], p1: [312, 960] },
    hairL: { parent: 'head', p0: [160, 420], p1: [118, 660] },
    hairR: { parent: 'head', p0: [374, 420], p1: [416, 660] },
  },
  sigma: {
    hips: 190, spine: 190, head: 190, armUL: 95, armUR: 95, armLL: 88, armLR: 88,
    thighL: 88, thighR: 88, shinL: 88, shinR: 88, hairL: 105, hairR: 105,
  },
}

let skeletonRigPromise = null
let skeletonBaseCache = ''

function skeletonBaseSync() {
  try { if (Runtime && Runtime.cachedBase) skeletonBaseCache = String(Runtime.cachedBase) } catch (e) {}
  return skeletonBaseCache
}
function skeletonUrl(rel) {
  const base = skeletonBaseSync()
  return base ? String(base).replace(/\/$/, '') + SKELETON_ASSET_PREFIX + rel : SKELETON_ASSET_PREFIX + rel
}
function skeletonEnabled() {
  try { return localStorage.getItem(SKELETON_SWITCH_KEY) !== '0' } catch (e) { return true }
}
function setSkeletonEnabled(on) {
  try { localStorage.setItem(SKELETON_SWITCH_KEY, on ? '1' : '0') } catch (e) {}
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('sbc-skeleton-changed')) } catch (e) {}
}
function skeletonRig() {
  if (!skeletonRigPromise) {
    skeletonRigPromise = Promise.resolve()
      .then(() => (typeof Runtime !== 'undefined' && Runtime && Runtime.base ? Runtime.base() : skeletonBaseSync()))
      .catch(() => skeletonBaseSync())
      .then((base) => {
        if (base) skeletonBaseCache = String(base)
        return fetch(skeletonUrl('rig-mesh.json'), { cache: 'no-store' })
          .then((r) => (r && r.ok ? r.json() : null))
          .then((j) => (j && j.bones && j.grid ? j : SKELETON_RIG_FALLBACK))
          .catch(() => SKELETON_RIG_FALLBACK)
      })
  }
  return skeletonRigPromise
}

// 动作：返回 { 骨骼名: 角度(度), 骨骼名Y: 像素偏移, bob }
function meshMotion(kind, t, phase) {
  const o = {}
  if (kind === 'walk') {
    const p = phase
    const s = Math.sin(p), s2 = Math.sin(p + Math.PI)
    const liftL = Math.max(0, s), liftR = Math.max(0, s2)
    o.thighLY = -liftL * 34
    o.thighRY = -liftR * 34
    o.shinL = liftL * 20
    o.shinR = -liftR * 20
    o.thighL = 2
    o.thighR = -2
    o.armUL = 7 + s * 6
    o.armUR = -7 - s * 6
    o.spine = s2 * 1.2
    o.head = -s2 * 1.3
    o.hairL = s * 2.2
    o.hairR = s * 2.2
    o.bob = -7 * Math.abs(Math.sin(2 * p))
  } else if (kind === 'wave') {
    o.armUR = -58
    o.armLR = -22
    o.head = -3
    o.hairR = -2
  } else if (kind === 'stretch') {
    o.armUL = 38
    o.armUR = -38
    o.armLL = 8
    o.armLR = -8
    o.head = 3
    o.bob = -6
  } else if (kind === 'sleepy') {
    o.head = 6
    o.spine = 3
    o.armUL = 2
    o.armUR = -2
    o.bob = 4
  } else if (kind === 'happy') {
    const b = Math.abs(Math.sin(t * 5))
    o.bob = -10 * b
    o.armUL = 20 * b
    o.armUR = -20 * b
    o.head = -2
  } else {
    const b = Math.sin(t * 1.6)
    o.spine = b * 0.9
    o.head = -0.7 - b * 0.5
    o.armUL = 5 + b * 1.2
    o.armUR = -5 - b * 1.2
    o.armLL = 2
    o.armLR = -2
    o.hairL = 1.2 * Math.sin(t * 0.9)
    o.hairR = -1.2 * Math.sin(t * 0.9 + 0.7)
  }
  return o
}

function meshWeightGrid(rig) {
  const [GX, GY] = rig.grid
  const TW = rig.size[0], TH = rig.size[1]
  const names = Object.keys(rig.bones)
  const verts = []
  for (let j = 0; j <= GY; j++) {
    for (let i = 0; i <= GX; i++) verts.push([(TW * i) / GX, (TH * j) / GY])
  }
  const weights = verts.map((v) => {
    const arr = names.map((n) => {
      const b = rig.bones[n]
      const a0 = b.p0, a1 = b.p1 || b.p0
      const abx = a1[0] - a0[0], aby = a1[1] - a0[1]
      const apx = v[0] - a0[0], apy = v[1] - a0[1]
      const len2 = abx * abx + aby * aby || 1
      let tt = (apx * abx + apy * aby) / len2
      tt = Math.max(0, Math.min(1, tt))
      const px = a0[0] + abx * tt, py = a0[1] + aby * tt
      const d = Math.hypot(v[0] - px, v[1] - py)
      const sg = rig.sigma[n] || 100
      return Math.exp(-((d / sg) * (d / sg)))
    })
    const idx = arr.map((w, i) => [w, i]).sort((a, b) => b[0] - a[0]).slice(0, 3)
    const sum = idx.reduce((s, x) => s + x[0], 0) || 1
    return idx.map(([w, i]) => [i, w / sum])
  })
  return { names, verts, weights, GX, GY }
}

function MeshAvatar(props) {
  const p = props || {}
  const height = Math.max(24, Number(p.size) || 96)
  const [rig, setRig] = React.useState(null)
  const [texUrl, setTexUrl] = React.useState('')
  const [enabled, setEnabled] = React.useState(skeletonEnabled())
  const canvasRef = React.useRef(null)
  const animRef = React.useRef({ t: Math.random() * 10, phase: 0, movingUntil: 0, dir: 1, lastX: null })

  React.useEffect(() => {
    let alive = true
    skeletonRig().then((r) => { if (alive) setRig(r) })
    return () => { alive = false }
  }, [])
  React.useEffect(() => {
    const onChange = () => setEnabled(skeletonEnabled())
    try { window.addEventListener('sbc-skeleton-changed', onChange) } catch (e) {}
    return () => { try { window.removeEventListener('sbc-skeleton-changed', onChange) } catch (e) {} }
  }, [])
  React.useEffect(() => {
    if (!rig) return
    let alive = true
    Api.imgUrl(SKELETON_ASSET_PREFIX + String(rig.texture || 'body.png'))
      .then((u) => { if (alive && u) setTexUrl(u) })
      .catch(() => {})
    return () => { alive = false }
  }, [rig])
  React.useEffect(() => {
    const a = animRef.current
    if (typeof p.moving === 'boolean') a.movingUntil = p.moving ? Date.now() + 600000 : 0
    const x = Number(p.x)
    if (p.x != null && Number.isFinite(x)) {
      if (a.lastX == null) a.lastX = x
      else if (Math.abs(x - a.lastX) > 0.0004) {
        a.dir = x > a.lastX ? 1 : -1
        a.lastX = x
        if (typeof p.moving !== 'boolean') a.movingUntil = Date.now() + 1600
      }
    }
  }, [p.moving, p.x])

  const ratio = rig && rig.size[1] ? rig.size[0] / rig.size[1] : 0.53
  const cssW = height * ratio

  React.useEffect(() => {
    if (!rig || !texUrl || !enabled) return
    const rafFn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    if (!rafFn) return
    const cancelFn = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : function () {}
    const cv = canvasRef.current
    if (!cv) return
    // 内部渲染分辨率：高度 420（够清楚又不贵）
    const RH = 420
    const RW = Math.round(RH * ratio)
    cv.width = RW
    cv.height = RH
    const ctx = cv.getContext('2d')
    const sk = RH / rig.size[1]
    const W2 = RW, H2 = RH
    const tex = new Image()
    tex.src = texUrl
    const grid = meshWeightGrid(rig)
    const idxOf = {}
    grid.names.forEach((n, i) => { idxOf[n] = i })
    let order = []
    const visit = (n) => {
      if (!rig.bones[n] || order.includes(n)) return
      const par = rig.bones[n].parent
      if (par) visit(par)
      order.push(n)
    }
    Object.keys(rig.bones).forEach(visit)

    let raf = 0, last = 0
    const frame = (now) => {
      if (!last) last = now
      const dt = Math.min(0.06, (now - last) / 1000)
      last = now
      const a = animRef.current
      const moving = a.movingUntil && Date.now() < a.movingUntil
      if (moving) a.phase += dt * 7.6
      else a.t += dt
      const angles = meshMotion(moving ? 'walk' : 'idle', a.t, a.phase)

      // 骨骼世界变换
      const world = {}
      for (const n of order) {
        const b = rig.bones[n]
        const local = angles[n] || 0
        const shift = angles[n + 'Y'] || 0
        if (!b.parent) {
          world[n] = { x: b.p0[0], y: b.p0[1] + (angles.bob || 0) + shift, ang: local }
        } else {
          const pw = world[b.parent]
          const pb = rig.bones[b.parent]
          const dx = b.p0[0] - pb.p0[0], dy = b.p0[1] - pb.p0[1]
          const rad = (pw.ang * Math.PI) / 180
          world[n] = {
            x: pw.x + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: pw.y + dx * Math.sin(rad) + dy * Math.cos(rad) + shift,
            ang: pw.ang + local,
          }
        }
      }
      // 蒙皮
      const V = grid.verts
      const def = new Float32Array(V.length * 2)
      for (let i = 0; i < V.length; i++) {
        let x = 0, y = 0
        for (const [bi, w] of grid.weights[i]) {
          const n = grid.names[bi]
          const b = rig.bones[n]
          const Wm = world[n]
          const rad = (Wm.ang * Math.PI) / 180
          const cos = Math.cos(rad), sin = Math.sin(rad)
          const dx = V[i][0] - b.p0[0], dy = V[i][1] - b.p0[1]
          x += w * (Wm.x + dx * cos - dy * sin)
          y += w * (Wm.y + dx * sin + dy * cos)
        }
        def[i * 2] = x * sk
        def[i * 2 + 1] = y * sk
      }
      // 画三角形
      ctx.clearRect(0, 0, W2, H2)
      ctx.imageSmoothingEnabled = true
      const GX = grid.GX, GY = grid.GY
      for (let j = 0; j < GY; j++) {
        for (let i = 0; i < GX; i++) {
          const i00 = j * (GX + 1) + i, i10 = i00 + 1
          const i01 = (j + 1) * (GX + 1) + i, i11 = i01 + 1
          drawTri(ctx, tex, V, def, [i00, i10, i01], sk)
          drawTri(ctx, tex, V, def, [i10, i11, i01], sk)
        }
      }
      raf = rafFn(frame)
    }
    raf = rafFn(frame)
    return () => cancelFn(raf)
  }, [rig, texUrl, enabled, ratio])

  const hasRig = !!(rig && texUrl && enabled)
  return h('span', {
    title: p.title || p.name || undefined,
    style: {
      position: 'relative', display: 'inline-block', width: hasRig ? cssW : height,
      height: height, flexShrink: 0, verticalAlign: 'bottom', pointerEvents: 'none',
      transform: animRef.current.dir < 0 ? 'scaleX(-1)' : 'none',
    },
  },
    hasRig
      ? h('canvas', {
          ref: canvasRef,
          width: 10, height: 10,
          style: { width: '100%', height: '100%', display: 'block' },
        })
      : h(Avatar, { path: p.path, name: p.name, size: p.fallbackSize || 30 }),
  )
}

// 画一个纹理映射三角形（源：贴图坐标；目标：内部渲染像素）
function drawTri(ctx, tex, V, def, idx, sk) {
  const s0 = V[idx[0]], s1 = V[idx[1]], s2 = V[idx[2]]
  const d0 = [def[idx[0] * 2], def[idx[0] * 2 + 1]]
  const d1 = [def[idx[1] * 2], def[idx[1] * 2 + 1]]
  const d2 = [def[idx[2] * 2], def[idx[2] * 2 + 1]]
  // Sd * M = Dd  =>  M = inverse(Sd) * Dd
  const s11 = s1[0] - s0[0], s12 = s2[0] - s0[0]
  const s21 = s1[1] - s0[1], s22 = s2[1] - s0[1]
  const det = s11 * s22 - s12 * s21
  if (Math.abs(det) < 1e-6) return
  const inv00 = s22 / det, inv01 = -s12 / det
  const inv10 = -s21 / det, inv11 = s11 / det
  const d11 = d1[0] - d0[0], d12 = d2[0] - d0[0]
  const d21 = d1[1] - d0[1], d22 = d2[1] - d0[1]
  const m00 = inv00 * d11 + inv01 * d21
  const m01 = inv00 * d12 + inv01 * d22
  const m10 = inv10 * d11 + inv11 * d21
  const m11 = inv10 * d12 + inv11 * d22
  const tx = d0[0] - (m00 * s0[0] + m01 * s0[1])
  const ty = d0[1] - (m10 * s0[0] + m11 * s0[1])
  // 目标三角形向外扩 3%，避免网格接缝
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3
  const ex = (pt) => [cx + (pt[0] - cx) * 1.03, cy + (pt[1] - cy) * 1.03]
  const q0 = ex(d0), q1 = ex(d1), q2 = ex(d2)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.lineTo(q2[0], q2[1]); ctx.closePath()
  ctx.clip()
  ctx.setTransform(m00, m10, m01, m11, tx, ty)
  ctx.drawImage(tex, 0, 0)
  ctx.restore()
}

const SkeletonAvatar = MeshAvatar
