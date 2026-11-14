// 20-stage/skeleton.js —— 2D 骨骼角色（地图 / 2D 舞台）
//
// 设计：docs/2D-SKELETON-PET-DESIGN.md
//   · 骨骼层级（hips→chest→head/arms，hips→legs/tail，chest→hairBack）+ 分层部件图；
//   · idle / walk 都是**程序化**姿态（相位算角度），不依赖逐帧图；
//   · 贴图与 rig.json 走运行时的 /skeleton-assets/，顾客可以自己换图改骨骼；
//   · 拉不到 rig.json 用下面内置的一份；任何一张图加载失败就回退原来的头像图片。
//
// 自定义方法（改完刷新面板就生效）：
//   1) 把 assets 里同名 png 换成你自己的分层图（透明背景、同一画布、姿势对齐）；
//   2) 想改关节位置/骨骼层级，就把 rig.json 放到数据目录的 skeleton-assets/xiaojing/ 下；
//   3) 部件的 pivot 是"支点在贴图里的像素坐标"，box 是"贴图在角色画布里的位置和尺寸"。

const SKELETON_CHAR_ID = 'xiaojing'
const SKELETON_ASSET_PREFIX = '/skeleton-assets/' + SKELETON_CHAR_ID + '/'
const SKELETON_RIG_BUILTIN = {
  "name": "xiaojing",
  "canvas": [
    1362,
    2244
  ],
  "bones": {
    "hips": {
      "parent": null,
      "pos": [
        681,
        1290
      ]
    },
    "chest": {
      "parent": "hips",
      "pos": [
        681,
        987
      ]
    },
    "head": {
      "parent": "chest",
      "pos": [
        661,
        909
      ]
    },
    "armL": {
      "parent": "chest",
      "pos": [
        293,
        1133
      ]
    },
    "armR": {
      "parent": "chest",
      "pos": [
        1069,
        1133
      ]
    },
    "legL": {
      "parent": "hips",
      "pos": [
        561,
        1571
      ]
    },
    "legR": {
      "parent": "hips",
      "pos": [
        801,
        1571
      ]
    },
    "hairBack": {
      "parent": "chest",
      "pos": [
        681,
        931
      ]
    },
    "tail": {
      "parent": "hips",
      "pos": [
        1090,
        1324
      ]
    }
  },
  "parts": {
    "head": {
      "file": "assets/head.png",
      "box": [
        6,
        0,
        1314,
        908
      ],
      "pivot": [
        654,
        908
      ],
      "size": [
        420,
        291
      ]
    },
    "hairBack": {
      "file": "assets/hairBack.png",
      "box": [
        27,
        908,
        1334,
        1615
      ],
      "pivot": [
        654,
        23
      ],
      "size": [
        420,
        227
      ]
    },
    "torso": {
      "file": "assets/torso.png",
      "box": [
        367,
        886,
        994,
        1290
      ],
      "pivot": [
        314,
        404
      ],
      "size": [
        420,
        270
      ]
    },
    "armL": {
      "file": "assets/armL.png",
      "box": [
        204,
        1110,
        401,
        1492
      ],
      "pivot": [
        88,
        23
      ],
      "size": [
        197,
        382
      ]
    },
    "armR": {
      "file": "assets/armR.png",
      "box": [
        960,
        1110,
        1157,
        1492
      ],
      "pivot": [
        109,
        23
      ],
      "size": [
        197,
        382
      ]
    },
    "skirt": {
      "file": "assets/skirt.png",
      "box": [
        27,
        1155,
        1334,
        1716
      ],
      "pivot": [
        654,
        11
      ],
      "size": [
        420,
        180
      ]
    },
    "legL": {
      "file": "assets/legL.png",
      "box": [
        442,
        1559,
        681,
        2232
      ],
      "pivot": [
        119,
        11
      ],
      "size": [
        239,
        673
      ]
    },
    "legR": {
      "file": "assets/legR.png",
      "box": [
        681,
        1559,
        919,
        2232
      ],
      "pivot": [
        119,
        11
      ],
      "size": [
        238,
        673
      ]
    },
    "tail": {
      "file": "assets/tail.png",
      "box": [
        994,
        1122,
        1355,
        1974
      ],
      "pivot": [
        95,
        201
      ],
      "size": [
        361,
        852
      ]
    }
  },
  "z": {
    "head": 6,
    "hairBack": 0.5,
    "torso": 4,
    "armL": 5,
    "armR": 5,
    "skirt": 3,
    "legL": 2,
    "legR": 2,
    "tail": 0.4
  }
}

let skeletonRigPromise = null
let skeletonBaseCache = ''

function skeletonBaseSync() {
  try {
    if (Runtime && Runtime.cachedBase) skeletonBaseCache = String(Runtime.cachedBase)
  } catch (e) {}
  return skeletonBaseCache
}

function skeletonRig() {
  if (!skeletonRigPromise) {
    skeletonRigPromise = Promise.resolve()
      .then(() => (typeof Runtime !== 'undefined' && Runtime && Runtime.base ? Runtime.base() : skeletonBaseSync()))
      .catch(() => skeletonBaseSync())
      .then((base) => {
        if (base) skeletonBaseCache = String(base)
        const b = base || ''
        return fetch(String(b).replace(/\/$/, '') + SKELETON_ASSET_PREFIX + 'rig.json', { cache: 'no-store' })
          .then((r) => (r && r.ok ? r.json() : null))
          .then((j) => (j && j.parts && j.bones && j.canvas ? j : SKELETON_RIG_BUILTIN))
          .catch(() => SKELETON_RIG_BUILTIN)
      })
  }
  return skeletonRigPromise
}

function skeletonAssetUrl(file) {
  const base = skeletonBaseSync()
  const rel = SKELETON_ASSET_PREFIX + String(file || '').replace(/^assets\//, '')
  return base ? String(base).replace(/\/$/, '') + rel : rel
}

// 部件名 → 挂在哪根骨骼上
const SKELETON_PART_BONE = {
  head: 'head', hairBack: 'hairBack', torso: 'chest', armL: 'armL', armR: 'armR',
  skirt: 'hips', legL: 'legL', legR: 'legR', tail: 'tail',
}

function skeletonMotion(kind, t, phase) {
  // kind: 'idle' | 'walk'；返回 { 骨骼名: 角度(度), bob: 画布像素 }
  const out = {}
  if (kind === 'walk') {
    const p = phase
    out.legL = 20 * Math.sin(p)
    out.legR = -20 * Math.sin(p)
    out.armL = -15 * Math.sin(p)
    out.armR = 15 * Math.sin(p)
    out.chest = 2.2 * Math.sin(2 * p)
    out.head = -1.8 * Math.sin(2 * p)
    out.hairBack = 1.6 * Math.sin(p + 1.2)
    out.tail = 4 * Math.sin(p * 0.9 + 0.4)
    out.bob = -14 * Math.abs(Math.sin(p))
  } else {
    const b = Math.sin(t * 1.6)
    out.legL = 0.8
    out.legR = -0.8
    out.armL = 1.6 + b * 1.1
    out.armR = -1.6 - b * 1.1
    out.chest = b * 1.1
    out.head = -0.8 - b * 0.7
    out.hairBack = 0.7 * Math.sin(t * 0.8)
    out.tail = 3 * Math.sin(t * 1.05)
    out.bob = 0
  }
  return out
}

function SkeletonAvatar(props) {
  const p = props || {}
  const height = Math.max(20, Number(p.size) || 76)
  const [rig, setRig] = React.useState(null)
  const [failed, setFailed] = React.useState(false)
  const wrapRef = React.useRef(null)
  const nodesRef = React.useRef({})
  const animRef = React.useRef({ t: Math.random() * 10, phase: Math.random() * 6, movingUntil: 0, dir: 1, lastX: null })

  React.useEffect(() => {
    let alive = true
    skeletonRig().then((r) => { if (alive) setRig(r) })
    return () => { alive = false }
  }, [])

  // 移动检测：父组件给 moving 就直接用；否则看 x 的变化（地图轮询）
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

  const k = rig ? height / rig.canvas[1] : 1
  const width = rig ? rig.canvas[0] * k : height * 0.62

  React.useEffect(() => {
    if (!rig) return
    // 骨骼拓扑顺序（父在前）
    const order = []
    const visit = (name) => {
      if (!rig.bones[name] || order.includes(name)) return
      const par = rig.bones[name].parent
      if (par) visit(par)
      order.push(name)
    }
    Object.keys(rig.bones).forEach(visit)
    const partList = Object.keys(rig.parts)
      .filter((name) => SKELETON_PART_BONE[name] && rig.bones[SKELETON_PART_BONE[name]])
      .sort((a, b) => (Number(rig.z[a]) || 0) - (Number(rig.z[b]) || 0))

    let raf = 0
    let last = 0
    const frame = (now) => {
      if (!last) last = now
      const dt = Math.min(0.06, (now - last) / 1000)
      last = now
      const a = animRef.current
      const moving = a.movingUntil && now < a.movingUntil && Date.now() < a.movingUntil
      const idleT = moving ? 0 : (a.t += dt)
      if (moving) a.phase += dt * 7.4
      const angles = skeletonMotion(moving ? 'walk' : 'idle', idleT, a.phase)

      const world = {}
      for (const name of order) {
        const bone = rig.bones[name]
        const local = angles[name] || 0
        if (!bone.parent) {
          world[name] = { x: bone.pos[0], y: bone.pos[1] + (angles.bob || 0), ang: local }
        } else {
          const pw = world[bone.parent]
          const pb = rig.bones[bone.parent]
          const dx = bone.pos[0] - pb.pos[0]
          const dy = bone.pos[1] - pb.pos[1]
          const rad = (pw.ang * Math.PI) / 180
          world[name] = {
            x: pw.x + dx * Math.cos(rad) - dy * Math.sin(rad),
            y: pw.y + dx * Math.sin(rad) + dy * Math.cos(rad),
            ang: pw.ang + local,
          }
        }
      }
      for (const name of partList) {
        const el = nodesRef.current[name]
        if (!el) continue
        const boneName = SKELETON_PART_BONE[name]
        const w = world[boneName]
        if (!w) continue
        el.style.transform = 'translate3d(' + (w.x * k).toFixed(2) + 'px,' + (w.y * k).toFixed(2) + 'px,0) rotate(' + w.ang.toFixed(2) + 'deg)'
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [rig, k])

  if (!rig || failed) return h(Avatar, { path: p.path, name: p.name, size: p.fallbackSize || 30 })

  const partList = Object.keys(rig.parts)
    .filter((name) => SKELETON_PART_BONE[name] && rig.bones[SKELETON_PART_BONE[name]])
    .sort((a, b) => (Number(rig.z[a]) || 0) - (Number(rig.z[b]) || 0))

  return h('span', {
    ref: wrapRef,
    title: p.title || p.name || undefined,
    style: {
      position: 'relative', display: 'inline-block',
      width: width, height: height, flexShrink: 0, verticalAlign: 'bottom',
      pointerEvents: 'none',
    },
  },
    h('span', {
      style: {
        position: 'absolute', left: '50%', bottom: -1,
        width: Math.max(10, width * 0.5), height: Math.max(3, height * 0.04),
        marginLeft: -Math.max(10, width * 0.5) / 2, borderRadius: '50%',
        background: 'radial-gradient(rgba(0,0,0,.42), rgba(0,0,0,0) 72%)',
        pointerEvents: 'none',
      },
    }),
    partList.map((name) => {
      const info = rig.parts[name]
      const box = info.box || [0, 0, 10, 10]
      const pivot = info.pivot || [0, 0]
      return h('span', {
        key: name,
        ref: (el) => { if (el) nodesRef.current[name] = el },
        style: {
          position: 'absolute', left: 0, top: 0, width: 0, height: 0,
          transformOrigin: '0 0', zIndex: Math.round(Number(rig.z[name]) || 0),
          pointerEvents: 'none',
        },
      },
        h('img', {
          src: skeletonAssetUrl(info.file),
          alt: '',
          draggable: false,
          onError: () => setFailed(true),
          style: {
            position: 'absolute',
            left: (-pivot[0] * k).toFixed(2) + 'px',
            top: (-pivot[1] * k).toFixed(2) + 'px',
            width: ((box[2] - box[0]) * k).toFixed(2) + 'px',
            height: ((box[3] - box[1]) * k).toFixed(2) + 'px',
            display: 'block', pointerEvents: 'none', userSelect: 'none',
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.25))',
          },
        })
      )
    })
  )
}
