# 屏幕彼端 v0.8.0 —— 桌面端原生化（去 iframe）

> 大版本：保留 Node 运行时和全部业务 API，**只把桌面端前端从 iframe 网页改成 DSH 原生 React 面板**。
> 需求与决策：[docs/NATIVE-REWRITE-FORM.md](docs/NATIVE-REWRITE-FORM.md) · 实现契约：[docs/NATIVE-CLIENT-ARCH.md](docs/NATIVE-CLIENT-ARCH.md)

## 一句话

DSH 左侧栏「屏幕彼端」打开的是**原生面板**（聊天 / 舞台 / 地图 / 设置 / 屏幕 / 关于），**0 个 iframe、0 个 HTML 页面请求**，只连本机运行时的 `/api/*`、`/models/*` 和图片。

## 主要变化

### 面板外壳（M01）
- 原生 React 面板，`lib/client.js` 由 `src/client/**` 多文件源码构建（`npm run build:client`）。
- 顶部状态：角色头像/名字/所在地/精力/零花/模式 + 刷新；断线红色提示条 + 一键重连；运行时没起来时给错误态和重试。
- 打开的标签保持挂载（切走不丢状态）；聊天标签支持 2D 舞台分屏（拖动调宽 20%–85%、双击回 50%、放大、隐藏，宽度持久化）。

### 聊天（M02–M05 / M09）
- 历史 + `since` 增量轮询（页面隐藏自动暂停）、逐字流式、打字态、停止。
- 图片消息（失败占位+重试、点击大图）、图片上传（6MB 限制、预览、可移除）。
- 发送成功才清空，失败保留原文并给重试；断线提示；切角色作废在途请求、重拉历史，不串数据。

### 2D 舞台（M06 / M07）
- 底图按原图比例贴合、地点钉、她的位置（sprite 优先，失败回退头像）、行程插值/进度、天气与时间、精力与零花。
- 点击地点直达（`POST /api/location`），被拒绝时显示原因；没有 2D 底图时明确提示并引导去地图页。
- 本次**只做 2D**（决策 D03 B）；有 3D 资源的地图只给提示，不做 3D 渲染。

### 地图查看 + 基础编辑（M10 / M11）
- 地图列表/切换（跨城会确认）、地点与角色位置、点击地点、旅行购票。
- 基础编辑：拖地点钉、改地点（名字/图标/描述/感受/内部场景）、场景背景图上传、热点增删改、障碍/可走区域拖框画。
- 保存 `POST /api/map {mapId, places, expectedRev}`：只提交 places、409 版本冲突不覆盖、保存后再 GET 回读校验（不一致会明确报错）。

### 设置（M13–M16）
- 角色/人设（角色切换/新建/删除、头像、人设正文、说话示例、性格开关、效果预览、角色卡导入导出）、上下文注入、经济/低余额提醒。
- 生活（现在在做什么、作息表、活动池、心跳/主动消息/日记、生活模拟、场景活动、天气表现、桌宠）。
- 环境（两种权限级别、危险确认、自启、环境自检、自动看她屏幕、占用提示）。
- 模型（推理等级、模型参数、API Key 只提交不回显、图片反馈、聊天风格、省 token、上下文档位、用量）。
- 数据/记忆（统计、置顶、删除、导入、遗忘参数、日记、备份列表/一键备份/恢复双重确认、数据修订、版本、教程）。
- VM 聊天（9 项设置 + 运行状态 + 唤醒/立即检查/发测试文字 + 打开她的屏幕）。
- 统一：只提交改动字段、读失败禁存、前后端一致 clamp、危险操作 `confirmDialog`、成功 toast、409 冲突重读。

### 屏幕 / 桌宠（M17–M19）
- 她的屏幕走**系统浏览器**（`/api/screen/info` 取 noVNC 地址后 `window.open`），面板里不嵌网页；`Alt+S` 同。
- 她的手机/你的电脑以截图卡显示（可暂停、失败占位重试）；启动/关闭屏幕与手机都要确认，内存不足时显示后端原因。
- 桌宠保持独立 WPF 进程：面板只做启动/停止/状态，启动前先查后端状态，不会因面板刷新重复启动。

### API / 数据 / 手机门（M22–M24）
- 新增 `GET /api/version`：`apiVersion: 2`、版本、`features` 能力清单、鉴权说明、schema 路径。
- 新增 [docs/API-CONTRACT.md](docs/API-CONTRACT.md)（128 个端点逐行契约 + 错误码 + SSE + 数据模型）、`docs/schema/api-index.json`、`docs/schema/models.json`、[docs/MOBILE-GATE.md](docs/MOBILE-GATE.md)。
- 数据零迁移：角色、消息、记忆、生活、地图数据格式不变。

### 安全（D11 C）
- 本机回环 + Host/Origin 白名单不变；可选 `DSH_COMPANION_API_TOKEN` 继续可用。
- CORS 预检补放行 `x-companion-token`，token 模式下面板（跨源 127.0.0.1:DSH 端口）可以正常带 header；图片和 SSE 在 token 模式下也走带 header 的 fetch（不再依赖 cookie）。

### 发布形态（M27 / S02 / S06 / S08）
- 旧网页入口 `/`、`/map`、`/settings`、`/stage`、`/model`、`/screen` **默认返回 410**（JSON 说明），源码保留作开发对照。
- 调试旧网页：`npm run start:legacy-web`（或环境变量 `DSH_COMPANION_LEGACY_WEB=1`）。
- `start-pure-chat.cmd/.sh` 删除（纯聊天独立版正式废弃，S08）；`npm start` 只作运行时/API 调试。
- 备份/恢复脚本补上新目录（`src/`、`docs/`），备份仍覆盖 lib/runtime/scripts/examples/docs/src + 数据目录。

## 验证

| 项 | 结果 |
|---|---|
| `node --check`（server/client/lib） | 通过 |
| `npm run lint` | 0 error / 41 warning（既有风格与未使用变量） |
| `npm run smoke:server`（隔离实例，45 项） | **45/45 通过**（含 /api/version、旧网页 410、LEGACY_WEB=1 恢复、CORS 预检 token、token 模式 401、DPAPI） |
| `npm run smoke:client`（加载构建产物，38 项） | **38/38 通过**（apply 注册 3 处、六标签渲染、无 iframe、不请求 HTML、聊天 POST、屏幕 window.open noVNC） |
| 本机真实运行时 | `/api/version` 200（apiVersion=2）；旧网页 410；`/api/*` 正常 |
| **真实 DSH 面板** | 左侧栏「屏幕彼端」打开原生面板：聊天（真实历史/蓝色用户气泡/头像/图片）、舞台分屏（真实地图+地点+角色）、屏幕页（真实 noVNC 状态「已连接」+ 手机截图 + 外部浏览器）都正常 |
| **独立浏览器（真实 React + 真实产物 + 真实数据）** | 六个标签逐个验过；点「打开她的屏幕」在浏览器新标签打开 noVNC（不是 iframe） |

真实面板验证中发现并修复的 3 个问题（只有真浏览器能暴露）：

1. **用户气泡白底白字**：DSH 当前版本 `--dsw-alias-brand-primary` 等于 `--dsw-alias-label-primary`（深色主题近白），拿它当填充色就白底白字。→ 强调色改为固定品牌蓝 `#3b82f6`，中性色继续用主题 token。
2. **聊天头像/图片显示「重试」**：几十条消息各自直连图片，重复请求导致部分失败。→ 图片统一 fetch→blob（缓存 + 去重），失败才退回直链。
3. **舞台底图偶发「加载失败」**：`<img src="">` 首帧触发 error。→ 拿到地址后才渲染 `<img>`。

## 已知未验证 / 边界

- 所有**写操作**（真实发消息、保存地图/设置、移动角色、备份恢复、VM 唤醒/发送、屏幕/手机/桌宠启停）没有在真实数据上跑：代码路径用「拦截 POST 断言 payload」的离线冒烟覆盖，真实落库需人工点一遍（建议先 `scripts/backup.ps1`）。
- 真实面板的**部分交互**（拖分界线、Modal、文件选择器、导出下载、confirm 弹层）是人眼看过的布局，但没有逐项操作验证。
- 3D 舞台不在本版本（决策 D03 B）；手机端不动（只冻结契约）。
- `/api/stage` 载荷里的 `apiVersion` 仍是 1（历史字段，主契约以 `/api/version` 的 `apiVersion: 2` 为准）。

## 升级注意

- 版本号变更后运行时会按既有机制自动重启；**DSH 面板需要刷新页面/重启 DSH** 才会加载新的 `lib/client.js`。
- 数据目录、API、环境脚本不需要迁移；如需回滚，用 `scripts/backup.ps1` 的备份 + `scripts/restore.ps1`。
