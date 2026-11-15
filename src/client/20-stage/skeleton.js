// 20-stage/skeleton.js —— 2D 角色「姿态帧 + 变换」动画（按角色分素材，绝不串角色）
//
// 为什么不用骨骼：我们只有 AI 生成的单张立绘，没有按关节画好的分层零件。硬切图拼骨骼
// 在旋转时会错位/露缝/散架（多轮实测失败）。DSH 生态里成熟插件（dsh-dfy 等）用的是
// 「多姿态素材 + CSS 变换 + 预渲染动作」，本文件采用同样思路。
//
// 素材解析顺序（关键：不会拿别的角色的图）：
//   1) 当前角色 id（/api/status → character.id），取 /skeleton-assets/<id>/poses/
//   2) 该角色没有姿态素材 → 直接用它自己的立绘（Avatar 组件，path 由调用方传入）
//   —— 始终不用别的角色的姿态图兜底，所以导入新角色不会「串成小鲸」。
//
// 「2D 表现」开关：localStorage sbc-2d-skeleton = '0' 关闭，回退到立绘。

const SKELETON_SWITCH_KEY = 'sbc-2d-skeleton'
const SKELETON_POSES = ['idle', 'walkA', 'walkB', 'wave', 'stretch', 'sleepy', 'happy']

let skeletonBaseCache = ''
let skeletonCharIdCache = { id: '', at: 0 }
const skeletonRigCache = {}
const skeletonPoseCache = {}

function skeletonBaseSync() {
  try { if (Runtime && Runtime.cachedBase) skeletonBaseCache = String(Runtime.cachedBase) } catch (e) {}
  return skeletonBaseCache
}
function skeletonEnabled() {
  try { return localStorage.getItem(SKELETON_SWITCH_KEY) !== '0' } catch (e) { return true }
}
function setSkeletonEnabled(on) {
  try { localStorage.setItem(SKELETON_SWITCH_KEY, on ? '1' : '0') } catch (e) {}
  try { if (typeof window !== 'undefined') window.dispatchEvent(new Event('sbc-skeleton-changed')) } catch (e) {}
}
function skeletonAssetUrl(charId, rel) {
  const base = skeletonBaseSync()
  const prefix = '/skeleton-assets/' + encodeURIComponent(String(charId || 'xiaojing')) + '/'
  return base ? String(base).replace(/\/$/, '') + prefix + rel : prefix + rel
}
// 当前角色 id（/api/status.character.id），20 秒缓存；拿不到就空
function skeletonCharId() {
  const now = Date.now()
  if (skeletonCharIdCache.id && now - skeletonCharIdCache.at < 20000) return Promise.resolve(skeletonCharIdCache.id)
  return Promise.resolve()
    .then(() => Api.get('/api/status'))
    .then((r) => {
      const j = r && r.json
      const id = j && j.character && j.character.id ? String(j.character.id) : ''
      skeletonCharIdCache = { id, at: Date.now() }
      return id
    })
    .catch(() => skeletonCharIdCache.id || '')
}
// 某角色的姿态描述（poses.json）；没有返回 null（调用方回退立绘）
function skeletonRig(charId) {
  const key = String(charId || '')
  if (!key) return Promise.resolve(null)
  if (skeletonRigCache[key]) return skeletonRigCache[key]
  const base = skeletonBaseSync()
  const dir = (base ? String(base).replace(/\/$/, '') : '') + '/skeleton-assets/' + encodeURIComponent(key) + '/poses/'
  skeletonRigCache[key] = fetch(dir + 'poses.json', { cache: 'no-store' })
    .then((r) => (r && r.ok ? r.json() : null))
    .then((j) => (j && j.poses && Object.keys(j.poses).length ? j : null))
    .catch(() => null)
  return skeletonRigCache[key]
}
function skeletonPoseUrl(charId, name) {
  const key = String(charId || '') + '/' + name
  if (!skeletonPoseCache[key]) {
    skeletonPoseCache[key] = Api.imgUrl('/skeleton-assets/' + encodeURIComponent(String(charId)) + '/poses/' + name + '.png')
      .catch(() => '')
  }
  return skeletonPoseCache[key]
}

function PoseAvatar(props) {
  const p = props || {}
  const height = Math.max(24, Number(p.size) || 96)
  const [charId, setCharId] = React.useState('')
  const [rig, setRig] = React.useState(null)
  const [enabled, setEnabled] = React.useState(skeletonEnabled())
  const [urls, setUrls] = React.useState({})
  const imgRef = React.useRef(null)
  const anim = React.useRef({ t: Math.random() * 6, phase: 0, movingUntil: 0, dir: 1, lastX: null })

  React.useEffect(() => {
    let alive = true
    skeletonCharId()
      .then((id) => { if (!alive) return null; setCharId(id); return id ? skeletonRig(id) : null })
      .then((r) => { if (alive) setRig(r || null) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  React.useEffect(() => {
    const onChange = () => setEnabled(skeletonEnabled())
    try { window.addEventListener('sbc-skeleton-changed', onChange) } catch (e) {}
    return () => { try { window.removeEventListener('sbc-skeleton-changed', onChange) } catch (e) {} }
  }, [])
  React.useEffect(() => {
    if (!charId || !rig) { setUrls({}); return }
    let alive = true
    const out = {}
    const names = Object.keys(rig.poses || {}).filter((n) => SKELETON_POSES.indexOf(n) >= 0)
    Promise.all(names.map((n) => skeletonPoseUrl(charId, n).then((u) => { if (u) out[n] = u }).catch(() => {})))
      .then(() => { if (alive) setUrls(Object.assign({}, out)) })
    return () => { alive = false }
  }, [charId, rig])
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

  const ratio = rig && rig.canvas ? rig.canvas[0] / rig.canvas[1] : 1200 / 1800
  const cssW = height * ratio
  const idleUrl = urls['idle'] || ''

  React.useEffect(() => {
    if (!enabled || !idleUrl) return
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
        el.style.transformOrigin = '50% 92%'
        const moving = a.movingUntil && Date.now() < a.movingUntil
        if (moving && urls['walkA'] && urls['walkB']) {
          a.phase += dt
          const pose = Math.floor(a.phase * 6) % 2 === 0 ? 'walkA' : 'walkB'
          if (el.dataset.pose !== pose) {
            el.dataset.pose = pose
            el.src = urls[pose] || idleUrl
          }
          const bob = -2.0 * Math.abs(Math.sin(a.phase * Math.PI * 6))
          const tilt = 1.1 * Math.sin(a.phase * Math.PI * 6)
          el.style.transform = 'translateY(' + bob.toFixed(2) + 'px) rotate(' + (a.dir > 0 ? tilt : -tilt).toFixed(2) + 'deg)'
        } else {
          a.t += dt
          if (el.dataset.pose !== 'idle') {
            el.dataset.pose = 'idle'
            el.src = idleUrl
          }
          const b = Math.sin(a.t * 1.6)
          el.style.transform = 'translateY(' + (-0.5 * b).toFixed(2) + 'px) scaleY(' + (1 + 0.006 * b).toFixed(4) + ') rotate(' + (0.35 * Math.sin(a.t * 0.8)).toFixed(2) + 'deg)'
        }
      }
      raf = rafFn(frame)
    }
    raf = rafFn(frame)
    return () => cancelFn(raf)
  }, [enabled, idleUrl, urls])

  const hasPose = !!(enabled && idleUrl)
  return h('span', {
    title: p.title || p.name || undefined,
    style: {
      position: 'relative', display: 'inline-block', width: hasPose ? cssW : height,
      height: height, flexShrink: 0, verticalAlign: 'bottom', pointerEvents: 'none', overflow: 'visible',
    },
  },
    hasPose
      ? h('img', {
          ref: imgRef, src: idleUrl, alt: p.name || '', draggable: false,
          style: { width: '100%', height: '100%', display: 'block', objectFit: 'contain', willChange: 'transform' },
        })
      : h(Avatar, { path: p.path, name: p.name, size: p.fallbackSize || 30 }),
  )
}

const SkeletonAvatar = PoseAvatar
