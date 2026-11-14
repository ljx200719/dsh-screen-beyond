// 00-core/store.js —— 极简全局状态 + Toast / 对话框（原生面板里没有 UI 库，全部自己做）

function createStore(initial) {
  let state = initial
  const subs = new Set()
  return {
    get() { return state },
    set(next) {
      state = typeof next === 'function' ? next(state) : next
      subs.forEach((fn) => { try { fn(state) } catch (e) {} })
      return state
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    },
  }
}

function useStore(store) {
  const [snap, setSnap] = React.useState(store.get)
  React.useEffect(() => store.subscribe(setSnap), [store])
  return snap
}

// ── Toast ───────────────────────────────────────────────────────────
const ToastStore = createStore([])
let toastSeq = 0

function toast(text, kind) {
  const id = ++toastSeq
  const item = { id, text: String(text || ''), kind: kind || 'info' }
  ToastStore.set((list) => list.concat(item).slice(-4))
  setTimeout(() => {
    ToastStore.set((list) => list.filter((x) => x.id !== id))
  }, kind === 'error' ? 4200 : 2400)
  return id
}

// ── 对话框（危险操作必须二次确认，M05 验收要求）────────────────────
// DialogStore 存的是一个队列：每个对话框是 Promise 的 resolve 载体。
const DialogStore = createStore([])
let dialogSeq = 0

function pushDialog(spec) {
  return new Promise((resolve) => {
    const id = ++dialogSeq
    const entry = Object.assign({ id }, spec, {
      resolve(value) {
        DialogStore.set((list) => list.filter((x) => x.id !== id))
        resolve(value)
      },
    })
    DialogStore.set((list) => list.concat(entry))
  })
}

// await confirmDialog('关掉她的屏幕？', { detail:'…', danger:true, okText:'关掉' }) → true/false
function confirmDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'confirm',
    title: o.title || '请确认',
    text: String(text || ''),
    detail: o.detail || '',
    danger: !!o.danger,
    okText: o.okText || '确定',
    cancelText: o.cancelText || '取消',
  }).then((v) => v === true)
}

// await alertDialog('已保存')  /  alertDialog('失败了', { danger:true })
function alertDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'alert',
    title: o.title || '提示',
    text: String(text || ''),
    detail: o.detail || '',
    danger: !!o.danger,
    okText: o.okText || '知道了',
  }).then(() => true)
}

// 输入框对话框（少数场景用，比如新建地图/导入名字）
function promptDialog(text, opts) {
  const o = opts || {}
  return pushDialog({
    kind: 'prompt',
    title: o.title || '请输入',
    text: String(text || ''),
    detail: o.detail || '',
    value: o.value === undefined ? '' : String(o.value),
    placeholder: o.placeholder || '',
    okText: o.okText || '确定',
    cancelText: o.cancelText || '取消',
  })
}
