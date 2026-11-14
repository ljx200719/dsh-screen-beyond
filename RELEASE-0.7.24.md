# 屏幕彼端 v0.7.24

> 版本号说明：npm 上已发布的最新版是 **0.7.23**。这次桌面端原生重写、3D 舞台、聊天直连、自动更新等改动统一发布为 **0.7.24**（内部草稿曾写 0.8.0 / 0.9.0，已按要求回退到 0.7 线）。
> 需求与决策：[docs/NATIVE-REWRITE-FORM.md](docs/NATIVE-REWRITE-FORM.md) · 实现契约：[docs/NATIVE-CLIENT-ARCH.md](docs/NATIVE-CLIENT-ARCH.md) · 验收记录：[docs/NATIVE-REWRITE-DONE.md](docs/NATIVE-REWRITE-DONE.md) · API：[docs/API-CONTRACT.md](docs/API-CONTRACT.md)

## 1. 桌面端原生化（去 iframe）

- DSH 左侧栏「屏幕彼端」打开的是 **DSH 原生 React 面板**：聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于。只请求本机运行时的 `/api/*`、`/models/*` 和图片/SSE，**不再请求任何 HTML 页面、0 个 iframe**。
- 旧网页 `/`、`/map`、`/settings`、`/stage`、`/model`、`/screen` 默认 410（调试用 `--legacy-web` / `DSH_COMPANION_LEGACY_WEB=1` / `config.legacyWeb` 临时恢复）。
- 运行时新增 `GET /api/version`（apiVersion=2、minClient=当前版本、features/schema/auth 说明），业务 API 契约不变。

## 2. 3D 舞台

- 舞台标签与聊天分屏都支持 **2D / 3D 切换**（记住选择；地图 `displayMode=3d` 时默认 3D）。
- 低模小岛：海/沙滩/河/桥、`map.roads` 三层土路、13 个地点的建筑与 canvas 名牌、程序化小鲸角色（配了 GLB 时加载 GLB）、载具、行程路径线、昼夜/天气色调；拖动旋转、滚轮/双指缩放、轻点地点 → `POST /api/location` 让她过去。
- three 从插件自带 `runtime/vendor/` 动态加载（不联网、不用 importmap）；GLTFLoader/BufferGeometryUtils 用「fetch 源码 → 改写裸导入为运行时绝对地址 → blob import」，只在真有 GLB 时才加载。
- WebGL 不可用 / 引擎加载失败 / 上下文丢失 → 中文提示 + 自动回退 2D，不白屏；卸载释放 renderer/geometry/material/texture 并 forceContextLoss。

## 3. 聊天软件直连（OneBot 11，可选）

- 设置 · VM 页新增「聊天软件直连」卡片：**插件只连你自己跑的 OneBot 11 实现**（HTTP API），不内置、不捆绑、不绑定任何具体桥（不做 SnowLuma 绑定）。
- 能力：探活（`get_login_info`）、发文字/图片（`send_private_msg`）、私聊入站（桥 HTTP 上报 `/api/direct-chat/event`，或 `get_friend_msg_history` 轮询兜底）、自动回复、回复前缀、失败按设置回退虚拟机通道。
- 安全边界：只处理私聊；只接受配置的对方 QQ 号；messageId 去重；没填对方 QQ 号不自动回复（省 token）。
- 面板上有「测试连接」「发测试消息」按钮。直连可随时关闭，原来的虚拟机看屏幕通道照常可用。

## 4. 插件自动更新

- 关于页新增「插件更新」卡片：显示当前/最新版本、安装方式、git 仓库状态；「检查更新」（15 分钟缓存）、「立即更新」。
- 本地链接安装（插件目录是 git 检出）且工作区干净时，一键更新 = `git pull --ff-only`，成功后运行时自动退出、宿主用新代码重启。
- npm / DSH 插件管理器管理的安装**只给更新指引**，不擅自改用户 profile。
- 默认自动检查（启动 + 每 6 小时），自动安装默认关闭。

## 5. token / 余额刷新更快

- 真实余额：每轮对话结束立刻刷一次（4 秒内合并）+ 后台 60 秒一次；`POST /api/balance/refresh` 供面板「刷新」按钮强制查询。
- 面板钱包轮询 30s → 10s；她说完话（typing true→false）自动刷新状态和余额；标签栏的「刷新」按钮现在会强制去 DeepSeek 查余额。

## 6. 虚拟机聊天通道（保留 + 补强）

- 新增 `POST /api/vm-chat/open`：按会话名切换会话（只点会话行，不发消息）；支持手动 `row` 坐标快通道。
- 视觉识别加了超时（45s/30s），视觉模型不可用时返回明确中文原因，不再把请求挂 6 分钟。
- `POST /api/vm-chat/send` 支持 `composer`（手动输入框坐标）和 `skipVerify`，视觉模型不可用时也能发。

## 7. 真实数据验收（0.8/0.9 草稿阶段已完成，本版延续）

- 自动 smoke：服务端 45/45、客户端产物 38/38、lint 0 error。
- 真实写操作：设置 11 组、记忆导入/删除、地图保存/409/回读/还原、真实聊天收发与停止、角色切换、备份创建与**真实恢复**、桌宠启停、屏幕停/启动/修复 —— **73/73 通过**（全部带还原）。
- **虚拟机通道真发消息到 QQ 联系人 aedo**：切换会话 → 发测试消息 → aedo 回复「收到」，面板侧 `last` 记录正常；事后把 `targetContact` 还原为空。
- 真机修掉：面板重开后标签高亮但内容空白、单标签异常整页白屏、备份恢复 `-Zip`/BOM/重启时序、关屏后立刻启动卡「启动中」、VM 视觉请求无超时。

## 8. 升级与注意

- 版本变化后宿主会自动重启运行时；DSH 面板需刷新页面/重启 DSH 才加载新的 `lib/client.js`。
- 3D、直连、更新都依赖本机运行时（3D vendor 自带，不联网；直连需要你自己的 OneBot；更新检查需要能访问 npm registry）。
- 手机端仍未做（按需求）；发布按用户要求暂缓。
- 自动更新的两个前置：① npm 上要先有更高的正式版本；② 插件目录要是**干净**的 git 检出（有未提交改动时 apply 会安全拒绝）。
