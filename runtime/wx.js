// CompanionWeatherFx：地图/舞台的天气表现
// 默认效果：canvas 粒子（雨/雪/风）+ 渐变（热/冷/晴）
// 自定义：用户可上传图片/GIF/视频替换任意天气的表现
(function () {
  'use strict'
  let hostEl = null, canvas = null, ctx = null, raf = 0, current = null, customEl = null
  let parts = []
  let last = 0

  function ensureHost(host) {
    hostEl = host
    if (canvas && canvas.parentNode === hostEl) return
    stop()
    canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1'
    hostEl.appendChild(canvas)
    ctx = canvas.getContext('2d')
    resize()
  }

  function resize() {
    if (!canvas || !hostEl) return
    const r = hostEl.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1)))
    canvas.height = Math.max(1, Math.round(r.height * (window.devicePixelRatio || 1)))
    if (ctx) ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0)
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    parts = []
    if (customEl && customEl.parentNode) customEl.parentNode.removeChild(customEl)
    customEl = null
    if (canvas && canvas.parentNode) {
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }

  function clear() {
    stop()
    current = null
  }

  function addCustom(cfg) {
    const el = document.createElement(cfg.type === 'video' ? 'video' : 'img')
    if (cfg.type === 'video') {
      el.src = cfg.url; el.autoplay = true; el.loop = true; el.muted = true; el.playsInline = true
    } else {
      el.src = cfg.url
    }
    el.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;z-index:2;opacity:' + (Number(cfg.opacity) || 1)
    hostEl.appendChild(el)
    customEl = el
  }

  function makeParticles(kind, w, h) {
    const n = Math.round((w * h) / (kind === 'rain' ? 420 : kind === 'snow' ? 900 : 600))
    const arr = []
    for (let i = 0; i < Math.max(20, Math.min(700, n)); i++) {
      if (kind === 'rain') arr.push({ x: Math.random() * w, y: Math.random() * h, len: 12 + Math.random() * 22, speed: 700 + Math.random() * 900, a: 0.10 + Math.random() * 0.22 })
      else if (kind === 'snow') arr.push({ x: Math.random() * w, y: Math.random() * h, r: 0.8 + Math.random() * 2.2, speed: 22 + Math.random() * 55, a: 0.5 + Math.random() * 0.5, sway: Math.random() * Math.PI * 2 })
      else arr.push({ x: Math.random() * w, y: Math.random() * h, len: 40 + Math.random() * 120, speed: 120 + Math.random() * 260, a: 0.03 + Math.random() * 0.07 })
    }
    return arr
  }

  function draw(kind, w, h, dt) {
    ctx.clearRect(0, 0, w, h)
    if (kind === 'rain') {
      ctx.strokeStyle = 'rgba(170,205,255,0.55)'
      ctx.lineWidth = 1.1
      ctx.beginPath()
      for (const p of parts) {
        ctx.globalAlpha = p.a
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + p.len * 0.28, p.y + p.len)
        p.x += p.len * 0.28 * 0.5; p.y += p.speed * dt
        if (p.y > h + 20) { p.y = -20; p.x = Math.random() * w }
        if (p.x > w + 20) p.x = -20
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    } else if (kind === 'snow') {
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      for (const p of parts) {
        ctx.globalAlpha = p.a
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
        p.y += p.speed * dt
        p.sway += dt * 1.4
        p.x += Math.sin(p.sway) * 14 * dt
        if (p.y > h + 5) { p.y = -5; p.x = Math.random() * w }
      }
      ctx.globalAlpha = 1
    } else if (kind === 'windy') {
      ctx.strokeStyle = 'rgba(200,230,255,0.5)'
      ctx.lineWidth = 1.2
      for (const p of parts) {
        ctx.globalAlpha = p.a
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.quadraticCurveTo(p.x + p.len * 0.5, p.y - 6, p.x + p.len, p.y)
        ctx.stroke()
        p.x += p.speed * dt
        if (p.x > w + p.len) { p.x = -p.len; p.y = Math.random() * h }
      }
      ctx.globalAlpha = 1
    }
  }

  function animate(now) {
    if (!ctx) return
    const w = canvas.width / (window.devicePixelRatio || 1)
    const h = canvas.height / (window.devicePixelRatio || 1)
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    if (parts.length === 0) parts = makeParticles(current, w, h)
    draw(current, w, h, dt)
    raf = requestAnimationFrame(animate)
  }

  function staticTint(kind, w, h) {
    ctx.clearRect(0, 0, w, h)
    if (kind === 'sunny') {
      const g = ctx.createRadialGradient(w * 0.82, h * 0.1, 0, w * 0.82, h * 0.1, Math.max(w, h) * 0.55)
      g.addColorStop(0, 'rgba(255,235,160,0.20)'); g.addColorStop(1, 'rgba(255,235,160,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    } else if (kind === 'hot') {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, 'rgba(255,120,40,0.14)'); g.addColorStop(0.6, 'rgba(255,80,20,0.05)'); g.addColorStop(1, 'rgba(255,80,20,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    } else if (kind === 'cold') {
      const g = ctx.createLinearGradient(0, 0, 0, h)
      g.addColorStop(0, 'rgba(150,210,255,0.16)'); g.addColorStop(1, 'rgba(150,210,255,0)')
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
    }
  }

  function set(host, kind, fx) {
    if (!host) return
    ensureHost(host)
    const k = kind || 'sunny'
    const cfg = fx && fx[k]
    // 已应用过相同天气+宿主则跳过
    if (current === k && !cfg && !customEl) return
    stop()
    current = k
    if (cfg && cfg.url) { addCustom(cfg); return }
    if (k === 'rain' || k === 'snow' || k === 'windy') {
      parts = []
      last = 0
      raf = requestAnimationFrame(animate)
    } else {
      const r = hostEl.getBoundingClientRect()
      canvas.width = Math.max(1, Math.round(r.width * (window.devicePixelRatio || 1)))
      canvas.height = Math.max(1, Math.round(r.height * (window.devicePixelRatio || 1)))
      ctx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0)
      staticTint(k, r.width, r.height)
    }
  }

  window.addEventListener('resize', () => { resize(); if (current && parts.length) parts = [] })

  window.CompanionWeatherFx = { set: set, clear: clear }
})()
