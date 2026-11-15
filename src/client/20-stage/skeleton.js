// 20-stage/skeleton.js —— 2D 角色「姿态帧 + 变换」动画
//
// 为什么不用骨骼：我们只有 AI 生成的单张立绘，没有按关节画好的分层零件。
// 硬切图拼骨骼会在旋转时错位/露缝/散架（实测多轮都失败）；DSH 生态里成熟的桌宠插件
// （如 dsh-dfy）也不是手搓骨骼，而是「分层/多姿态素材 + CSS 变换 + 预渲染动作」。
// 这里采用同样思路：同一角色生成 7 个标准姿态帧（站立/走路两帧/挥手/伸懒腰/困/开心），
// 站立时做呼吸缩放，走路时两帧交替 + 上下起伏 + 轻微倾斜——不会散架。
//
// 素材：/skeleton-assets/<角色>/poses/poses.json + <姿态>.png（1200x1800 画布，脚底对齐）
// 换角色：替换 poses/ 下的图与 poses.json 即可；加载失败回退头像图。

const SKELETON_CHAR_ID = 'xiaojing'
const SKELETON_POSE_PREFIX = '/skeleton-assets/' + SKELETON_CHAR_ID + '/'
const SKELETON_SWITCH_KEY = 'sbc-2d-skeleton'
const SKELETON_POSES = ['idle', 'walkA', 'walkB', 'wave', 'stretch', 'sleepy', 'happy']
const SKELETON_FALLBACK_RIG = { canvas: [1200, 1800], baseY: 1700, poses: {} }

let skeletonRigPromise = null
let skeletonBaseCache = ''
const skeletonImages = {}

function skeletonBaseSync() {
  try { if (Runtime && Runtime.cachedBase) skeletonBaseCache = String(Runtime.cachedBase) } catch (e) {}
  return skeletonBaseCache
}
function skeletonAssetUrl(rel) {
  const base = skeletonBaseSync()
  return base ? String(base).replace(/\/$/, '') + SKELETON_POSE_PREFIX + rel : SKELETON_POSE_PREFIX + rel
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
        return fetch(skeletonAssetUrl('poses/poses.json'), { cache: 'no-store' })
          .then((r) => (r && r.ok ? r.json() : null))
          .then((j) => (j && j.canvas ? j : SKELETON_FALLBACK_RIG))
          .catch(() => SKELETON_FALLBACK_RIG)
      })
  }
  return skeletonRigPromise
}
// 预加载姿态图（blob URL，带 token 的接口）
function skeletonPoseUrl(name) {
  const key = name
  if (!skeletonImages[key]) {
    skeletonImages[key] = Api.imgUrl(SKELETON_POSE_PREFIX + 'poses/' + name + '.png')
      .catch(() => '')
  }
  return skeletonImages[key]
}

function PoseAvatar(props) {
  const p = props || {}
  const height = Math.max(24, Number(p.size) || 96)
  const [rig, setRig] = React.useState(null)
  const [enabled, setEnabled] = React.useState(skeletonEnabled())
  const [urls, setUrls] = React.useState({})
  const imgRef = React.useRef(null)
  const anim = React.useRef({ t: Math.random() * 6, walkPhase: 0, movingUntil: 0, dir: 1, lastX: null, tick: 0 })

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
    let alive = true
    const out = {}
    Promise.all(SKELETON_POSES.map((n) => skeletonPoseUrl(n).then((u) => { if (u) out[n] = u }).catch(() => {})))
      .then(() => { if (alive) setUrls(Object.assign({}, out)) })
    return () => { alive = false }
  }, [])
  React.useEffect(() => {
    const a = anim.current
    if (typeof p.moving === 'boolean') a.movingUntil = p.moving ? Date.now() + 600000 : 0
    const x = Number(p.x)
    if (p.x != null && Number.isFinite(x)) {
      if (a.lastX == null) a.lastX = x
      else if (Math.abs(x - a.lastX) > 0.0004) {
        a.dir = x > a.lastX ? 1 : -1
        a.lastX = x
        if (typeof p.moving !== 'boolean') a.movingUntil = Date.now() + 1400
      }
    }
  }, [p.moving, p.x])

  const canvasRatio = rig && rig.canvas ? rig.canvas[0] / rig.canvas[1] : 1200 / 1800
  const cssW = height * canvasRatio

  React.useEffect(() => {
    if (!enabled || !urls['idle']) return
    const rafFn = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
    if (!rafFn) return
    const cancelFn = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : function () {}
    let raf = 0, last = 0
    const frame = (now) => {
      if (!last) last = now
      const dt = Math.min(0.08, (now - last) / 1000)
      last = now
      const a = anim.current
      const el = imgRef.current
      if (el) {
        const moving = a.movingUntil && Date.now() < a.movingUntil
        if (moving) {
          a.walkPhase += dt
          const idx = Math.floor(a.walkPhase * 6) % 2 === 0 ? 'walkA' : 'walkB'
          if (el.dataset.pose !== idx) {
            el.dataset.pose = idx
            el.src = urls[idx] || urls.idle || ''
          }
          const bob = -2.0 * Math.abs(Math.sin(a.walkPhase * Math.PI * 6))
          const tilt = 1.1 * Math.sin(a.walkPhase * Math.PI * 6)
          el.style.transform = 'translateY(' + bob.toFixed(2) + 'px) rotate(' + (a.dir > 0 ? tilt : -tilt).toFixed(2) + 'deg)'
        } else {
          a.t += dt
          if (el.dataset.pose !== 'idle') {
            el.dataset.pose = 'idle'
            el.src = urls.idle || ''
          }
          const b = Math.sin(a.t * 1.6)
          const sy = 1 + 0.006 * b
          const ty = -0.5 * b
          const rot = 0.35 * Math.sin(a.t * 0.8)
          el.style.transform = 'translateY(' + ty.toFixed(2) + 'px) scaleY(' + sy.toFixed(4) + ') rotate(' + rot.toFixed(2) + 'deg)'
        }
        el.style.transformOrigin = '50% 92%'
      }
      raf = rafFn(frame)
    }
    raf = rafFn(frame)
    return () => cancelFn(raf)
  }, [enabled, urls, canvasRatio])

  const hasPose = !!(enabled && urls['idle'])
  return h('span', {
    title: p.title || p.name || undefined,
    style: {
      position: 'relative', display: 'inline-block', width: hasPose ? cssW : height,
      height: height, flexShrink: 0, verticalAlign: 'bottom', pointerEvents: 'none',
      overflow: 'visible',
    },
  },
    hasPose
      ? h('img', {
          ref: imgRef,
          src: urls['idle'],
          alt: p.name || '',
          draggable: false,
          style: { width: '100%', height: '100%', display: 'block', objectFit: 'contain', transition: 'none', willChange: 'transform' },
        })
      : h(Avatar, { path: p.path, name: p.name, size: p.fallbackSize || 30 }),
  )
}

const SkeletonAvatar = PoseAvatar
