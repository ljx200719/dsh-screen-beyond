# 原生客户端架构（实现契约）

> 对应表单：`docs/NATIVE-REWRITE-FORM.md`（D01 A：DSH 原生 React；D02 A：直连 127.0.0.1 API；D03 B：只做 2D）
>
> 这份文档是**实现契约**：所有参与实现的人都按这里的文件边界、构建方式、共享 API 写代码。
> 改契约要同步改这份文档，否则后续维护会踩坑。

---

## 1. 结论先行

| 项 | 做法 |
|---|---|
| 面板形态 | DSH Client 半的一个原生 React 面板，注册到 `sidebar.panellist` + `main`，**整个面板 0 个 iframe** |
| 数据来源 | 直接 `fetch('http://127.0.0.1:<运行时端口>/api/*')`，端口由 `/dsh-screen-beyond/info` 发现，端口扫描兜底 |
| 允许的请求 | 只有 `/api/*` JSON、`/models/*` 与图片、`/api/stream`（fetch 流式 SSE）。**不请求任何 HTML 页面** |
| 屏幕 | 调 `/api/screen/info` 拿 noVNC 地址，`window.open` 交给系统浏览器；面板内只用截图（`/api/screen/pc`、`/api/screen/phone`） |
| 旧网页 | 源码保留（调试用），运行时默认不再对外提供页面（`DSH_COMPANION_LEGACY_WEB=1` 才开）；详见 §7 |
| 3D | 0.7.24 起支持（D03 追加改为 A）：three 从运行时 `/vendor` 动态加载；GLTFLoader/BufferGeometryUtils 用「fetch 源码→改裸导入→blob import」；WebGL/加载失败自动回退 2D |

## 2. 文件边界

```
src/client/                 源码（不发布到 npm，只有 lib/client.js 会发布）
  00-core/
    const.js                主题 token（T）、常量、能量/金额文案
    api.js                  Runtime（发现/端口/token/fetch/图片 blob/SSE 流）、Api、imgUrl、readFileAsDataUrl
    format.js               fmtTime / clamp / safeAvatarUrl / bytes / 值域工具
    store.js                createStore / useStore / ToastStore+toast / DialogStore+confirmDialog/alertDialog
    ui.js                   原生 UI 原语（Btn Chip Card Field TextInput NumInput TextArea Select Toggle
                            Slider Tabs Modal Empty Loading ErrorBox Dot Badge Avatar Img KV Divider）
    hooks.js                useRuntimeBase / useStatus / useApi / useInterval / useLocal / useImage
  10-chat/chat.js            ChatView（消息列表/发送/停止/打字态/图片/重试/历史/分屏舞台）
  20-stage/three3d.js        ThreeStage（3D 舞台：场景/相机/vendor ESM 加载/资源释放）
  20-stage/stage.js          StageView（2D/3D 舞台切换：底图/地点/角色/天气/点击地点）
  20-stage/map.js            MapView（地图查看 + 基础编辑：地点拖动/热点/障碍/可走/保存/旅行入口）
  30-settings/settings.js    SettingsView 外壳（分类标签）+ 角色/人设/上下文/经济卡片
  30-settings/settings-life.js    生活/环境/主动消息/桌宠卡片
  30-settings/settings-model.js   模型 Key/推理等级/图片/聊天风格/省 token 卡片
  30-settings/settings-data.js    记忆/备份恢复/数据目录/版本卡片
  30-settings/settings-vm.js      VM 聊天设置与状态卡片
  40-screen/screen.js        ScreenView（外部浏览器打开她的屏幕 + 电脑/手机截图 + 开关）
  40-screen/pet.js           PetCard（桌宠启动/停止/状态）
  50-app/app.js              AppShell（标签外壳/状态条/断线重连/错误态/分屏布局）+ exports.apply
scripts/build-client.mjs     把 src/client/** 按顺序拼成 lib/client.js（单文件工厂）
lib/client.js                ⚠️ 自动生成，不要手改
```

**写作用域规则（多 agent 并行时）**：每个文件只有一个负责人；不要改别人的文件。
需要新增跨模块能力时，改 `00-core/*`（Lead 负责）或在消息里说明。

## 3. 构建方式

```bash
npm run build:client     # src/client/** → lib/client.js，并跑 node --check
npm run check            # 服务端语法 + 生成后的 lib/client.js
```

- DSH 客户端半只有**一个入口文件**（`package.json` 的 `exports["./client"]` → `lib/client.js`），
  所以源码是多文件、产物是单文件工厂。
- 源文件是**普通脚本片段**，禁止 `import` / `export`（构建脚本会直接报错）。
  文件之间靠**构建顺序**共享同一个 `factory` 作用域里的 `const`：依赖在前，使用者在后。
- 允许用的外部依赖只有 `require('react')`（宿主注入）。不要引第三方包。
- `lib/client.js` 顶部有 AUTO-GENERATED 标记；改行为必须改 `src/client/**`。

构建顺序（`scripts/build-client.mjs` 的 `FILES` 数组，改顺序会 break，别乱动）：

```
00-core/const.js → 00-core/api.js → 00-core/format.js → 00-core/store.js
→ 00-core/ui.js → 00-core/hooks.js
→ 10-chat/chat.js → 20-stage/three3d.js → 20-stage/stage.js → 20-stage/map.js
→ 30-settings/settings-core.js → settings-life.js → settings-model.js → settings-data.js → settings-vm.js → settings.js
→ 40-screen/screen.js → 40-screen/pet.js
→ 50-app/app.js
```

## 4. 共享 API（00-core）

### 4.1 `Runtime` / `Api`（api.js）

```js
await Runtime.base()                 // 发现并返回 'http://127.0.0.1:<port>'（会缓存、带重试）
Runtime.baseSync()                   // 同步读缓存（可能为 ''）
await Runtime.discover(true)         // 强制重新发现（断线重连用）
Runtime.subscribe(fn)                // base 变化订阅，返回取消函数
await Runtime.token()                // 运行时开了 API token 时返回 token（默认 '')
Runtime.url(path)                    // 拼绝对地址（图片用）

const r = await Api.get('/api/status')          // → { ok, status, data, error }
const r = await Api.post('/api/chat', {text})   // → { ok, status, data, error }
await Api.upload('/api/place/image', {dataUrl}) // 同样是 POST，只是语义命名
Api.imgUrl(path) -> Promise<string>             // 图片 → 可用 <img src> 的地址（token 模式下是 blob URL）
Api.openExternal(url)                           // window.open(url, '_blank', 'noopener')
await Api.stream(onEvent, { signal })           // fetch 流式 SSE（token 模式下也能用）
readFileAsDataUrl(file, maxBytes)               // → { ok, dataUrl, error }
```

`Api.get/post` **不抛异常**：网络错误也返回 `{ ok:false, error:'…' }`。
所有调用都必须处理 `ok === false`（错误态是验收要求 N03）。

### 4.2 Hooks（hooks.js）

```js
const base = useRuntimeBase()                 // string，发现完成后更新
const { data, error, loading, reload } = useApi('/api/status', { refreshMs: 4000 })
const status = useStatus()                    // 全局单例轮询 /api/status（所有挂载点共享）
useInterval(fn, ms, enabled)                  // 页面隐藏时自动暂停
const [v, setV] = useLocal('companionStageWidth', 50)   // localStorage 持久化
const { src, error, retry } = useImage(path)  // token 感知的图片地址
```

**不要自己 setInterval 轮询 /api/status**：用 `useStatus()`，它已经是单例 + 可见性暂停 + 未变化不通知。

### 4.3 UI 原语（ui.js）

所有原语都接受 `style` 覆盖、`title` 提示，符合 DSH 主题（`T.*` 来自 const.js，用 CSS 变量实现亮/暗两套）。

```js
h(Card, { title:'角色', sub:'…', tag:'可选说明', actions: h(Btn,{...}) }, children…)
h(Field, { label:'名字', hint:'…', inline:true }, h(TextInput, { value, onChange }))
h(Btn, { children:'保存', kind:'primary'|'ghost'|'danger'|'chip', size:'sm'|'md', disabled, onClick })
h(Chip, { children:'2D', active, onClick, tone:'ok'|'warn'|'danger' })
h(Toggle, { checked, onChange, label, disabled })
h(Select, { value, onChange, options:[{value,label}] })
h(NumInput, { value, onChange, min, max, step, suffix })
h(Tabs, { value, onChange, items:[{key,label}] })      // 顶部标签条
h(Modal, { open, title, onClose, footer }, children)
h(ErrorBox, { error, onRetry })
h(Loading, { text }), h(Empty, { children })
h(Dot, { on, tone }), h(Badge, { children, tone })
h(Avatar, { path, name, size }), h(Img, { path, alt, style })
h(KV, { k, v }), h(Divider, {})
```

对话框（危险操作二次确认，M05 验收要求）：

```js
await confirmDialog('关掉她的屏幕？', { detail:'…', danger:true, okText:'关掉' })  // → boolean
await alertDialog('已保存')
```

`confirmDialog(text, opts)` / `alertDialog(text)` 是 Promise，直接 `await`；不要用 `window.confirm`。

### 4.4 主题

只允许用 `T.*`（const.js）或 DSH 自己的 `--dsw-alias-*` 变量写颜色，**不要写死深色**：
面板要能跟 DSH 亮/暗主题走。`T.brand` 是品牌色，`T.danger/warn/ok` 是状态色。

## 5. 组件契约（每个模块只暴露这些）

| 模块 | 导出（const，构建顺序保证可见） | 说明 |
|---|---|---|
| chat | `function ChatView(props)` | 自己管理消息/输入；`props.onOpenStage` 供外壳联动 |
| stage | `function StageView(props)` | `props.compact` 只读小尺寸（聊天分屏用）；点击地点调 `POST /api/location`；内部 2D/3D 切换 |
| 3D | `function ThreeStage(props)` | `props.data` = `/api/stage` 载荷，`props.onPickPlace`、`props.onFail`；WebGL/引擎失败调 onFail，由 StageView 回退 2D |
| map | `function MapView(props)` | 查看 + 基础编辑；保存成功要有提示 |
| settings | `function SettingsView(props)` | 内部分类标签，子卡片函数在本模块内 |
| screen | `function ScreenView(props)` | 一律外部浏览器，禁止在面板里嵌 iframe |
| pet | `function PetCard(props)` | 桌宠开关（设置页/屏幕页都可复用） |
| app | `function apply(ctx)` / `const inject = ['slots']` | 见 §6 |

视图组件**不接收 base 参数**：需要地址时用 `Api.*` / `useImage` / `Api.url`。

## 6. 挂载点（apply）

保持和 0.7.x 一致的三处注册，只换实现：

```js
slots.register({ name:'sidebar.panellist',  id:'companion',      order:21, label:()=>'屏幕彼端' }, PanelIcon)
slots.register({ name:'main',               key:'companion' },                        CompanionPage)
slots.register({ name:'settings.section',   id:'companion-settings', order:12, label:()=>'屏幕彼端' }, CompanionLauncher)
```

面板内部标签：聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于。
「关于」= 运行时状态 + API 版本 + 数据目录 + 旧网页调试入口说明（不链接任何 HTML 页面）。

## 7. 服务端契约（本次改动只有这些）

1. `GET /api/version`：冻结的可机读契约（`{ apiVersion, version, features, schema }`），供未来手机客户端校验；
2. CORS 预检 `access-control-allow-headers` 补 `x-companion-token`（D11 C：token 模式下面板可用）；
3. 旧网页页面（`/ /map /settings /stage /model /screen`）默认返回 **410 + 说明 JSON**，
   只有 `DSH_COMPANION_LEGACY_WEB=1` 或配置 `legacyWeb:true` 才继续提供（S02/S06/D08）；
   `/api/*`、`/models/*`、`*.png/.jpg/.glb` 等资源不受影响；
4. 其余业务 API **保持原样**（S03：全部业务 API 保留）。

## 8. 验收自查（写代码的人自己先过一遍）

- [ ] 代码里搜不到 `<iframe`（M01/N01）
- [ ] 没有硬编码角色 ID / 名字（N02），角色名一律取 `/api/status` 或角色接口
- [ ] 每个 `Api.*` 调用都有 `ok === false` 的错误态或 toast（N03）
- [ ] 轮询用 `useStatus/useApi/useInterval`，不用裸 setInterval（N04）
- [ ] 危险操作走 `confirmDialog`（M05）
- [ ] 图片加载失败有占位/重试，不阻塞文字（M09）
- [ ] 面板若在本机 DSH 里刷新看到的是新界面（构建后 `lib/client.js` 有 AUTO-GENERATED 头）
