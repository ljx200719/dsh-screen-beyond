// 30-settings/settings.js —— 设置外壳（分类标签 + 各标签卡片）
//
// 结构：顶部标签条（角色/生活/记忆/环境/模型/数据/VM）→ 可滚动内容区。
// 每个标签只负责内容；滚动与 padding 在外壳这里统一处理。
//
// 组件归属（跨文件契约，名字固定，不要改）：
//   · SettingsRoleTab / SettingsMemoryTab           → settings-core.js（本团队：settings-a）
//   · SettingsLifeTab / SettingsEnvTab              → settings-life.js（本团队：settings-a）
//   · SettingsModelTab / SettingsDataTab / SettingsVmTab → settings-model.js / settings-data.js / settings-vm.js（settings-b）
//
// 约定：不写 import/export；颜色只走 T.*；本文件不发任何请求（各卡片自己读接口）；
// 标签切走不卸载（保留未保存的编辑），首次点开才挂载（省请求）。

const STG_TABS = [
  { key: 'role', label: '角色', icon: '🎭' },
  { key: 'life', label: '生活', icon: '🕐' },
  { key: 'memory', label: '记忆', icon: '🧠' },
  { key: 'env', label: '环境', icon: '🖥️' },
  { key: 'model', label: '模型', icon: '⚙️' },
  { key: 'data', label: '数据', icon: '💾' },
  { key: 'vm', label: 'VM', icon: '💻' },
]

// 还没写好的标签给个明确占位（构建期不会报错；实现者写好文件后自动生效）
function stgShellMissing(label) {
  return h(Card, { title: label, sub: '这个标签还在实现中' },
    h(Note, {}, '该标签的卡片由另一位实现者负责，文件写好并通过构建后会自动出现在这里。'),
  )
}

// 标签 key → 组件。用 typeof 保护跨文件引用：对方文件还没实现/改名时不会白屏
function stgShellTabBody(key) {
  if (key === 'role') return h(SettingsRoleTab, {})
  if (key === 'life') return h(SettingsLifeTab, {})
  if (key === 'memory') return h(SettingsMemoryTab, {})
  if (key === 'env') return h(SettingsEnvTab, {})
  if (key === 'model') return typeof SettingsModelTab === 'function' ? h(SettingsModelTab, {}) : stgShellMissing('模型')
  if (key === 'data') return typeof SettingsDataTab === 'function' ? h(SettingsDataTab, {}) : stgShellMissing('数据')
  if (key === 'vm') return typeof SettingsVmTab === 'function' ? h(SettingsVmTab, {}) : stgShellMissing('VM')
  return stgShellMissing(key)
}

function SettingsView(props) {
  ensureUiStyle()
  const [tab, setTab] = useLocal('companionSettingsTab', 'role')
  // 首次点开才挂载；之后切走保持挂载，避免丢掉未保存的编辑
  const [opened, setOpened] = React.useState(() => ({ role: true }))
  const current = STG_TABS.some((t) => t.key === tab) ? tab : 'role'
  const openTab = React.useCallback((key) => {
    setTab(key)
    setOpened((prev) => (prev[key] ? prev : Object.assign({}, prev, { [key]: true })))
  }, [setTab])

  return h('div', {
    style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: T.bg, color: T.text, fontFamily: T.font },
  },
    // 头部：标题 + 说明 + 运行时刷新
    h('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '9px 14px 6px', borderBottom: '1px solid ' + T.border, background: T.bg1, flexShrink: 0,
      },
    },
      h('span', { style: { fontSize: 14, fontWeight: 600, color: T.text } }, '设置'),
      h('span', { style: { fontSize: 11.5, color: T.text2 } }, '每个卡片独立保存，只提交改动过的字段'),
      h('span', { style: { flex: 1 } }),
      h(Btn, {
        size: 'sm', kind: 'ghost', title: '刷新运行时状态（顶部状态条 / 钱包）',
        onClick: () => { try { pollStatusOnce() } catch (e) {} },
      }, '刷新状态'),
    ),
    // 标签条
    h('div', {
      style: { padding: '8px 14px 0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    },
      h(Tabs, { value: current, items: STG_TABS, onChange: openTab }),
    ),
    // 内容区（滚动 + padding 统一在这里）
    h('div', {
      className: 'sbc-scroll',
      style: { flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', padding: '12px 14px 20px' },
    },
      STG_TABS.map((t) => {
        if (!opened[t.key] && t.key !== current) return null
        return h('div', {
          key: t.key,
          style: {
            display: t.key === current ? 'flex' : 'none',
            flexDirection: 'column',
            gap: 12,
            minWidth: 0,
          },
        }, stgShellTabBody(t.key))
      }),
    ),
  )
}
