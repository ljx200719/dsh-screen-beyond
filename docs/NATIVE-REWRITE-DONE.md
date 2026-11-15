# 桌面原生化 · 验收记录（0.7.24）

> 需求与决策：[`NATIVE-REWRITE-FORM.md`](NATIVE-REWRITE-FORM.md)（D01–D12 / M01–M28 / S01–S08；2026-11-14 追加：3D 加进本版本）
> 实现契约：[`NATIVE-CLIENT-ARCH.md`](NATIVE-CLIENT-ARCH.md)
> 发布说明：[`../RELEASE-0.7.24.md`](../RELEASE-0.7.24.md)、[`../RELEASE-0.7.24.md`](../RELEASE-0.7.24.md)
> 任务状态：[`NATIVE-REWRITE-TASKS.csv`](NATIVE-REWRITE-TASKS.csv)

这份记录回答三件事：**做了什么、怎么验证的、哪些没验证**。不要把它当成「全部通过」的盖章。

---

## 1. 最终验收清单（对应表单 §6）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DSH 面板打开后不加载 `chat.html/map.html/settings.html/stage.html/model.html` | ✅ | 产物静态检查（`smoke:client`：「不请求旧 HTML 页面」「不含 iframe」）；运行时这些路径默认 410 |
| 2 | 聊天可发文字/图片，有历史、打字态、停止/重试 | ✅ 真机真实数据 | 真发消息 → 落库 → 收到她的真实回复；再发一条点「停止」→ cancel 后回空闲；真机面板里图片消息正常显示 |
| 3 | 2D 舞台正常；3D 有资源可渲染、无资源/失败明确回退，不白屏 | ✅ 真机 | 2D：真机截图；3D：DSH 面板点 3D → 低模小岛真实渲染 → 点「车站」她真的移动到车站；WebGL 失败/引擎加载失败自动回退 2D 并给中文原因 |
| 4 | 地图可以查看地点/角色/旅行；编辑达到所选范围（B：基础编辑） | ✅ 真实数据 | 过期 `expectedRev` → 409；保存 → 读回坐标变化 → 其它地点/场景零丢失 → 还原后与基线深度相等 |
| 5 | 设置保存、读失败不覆盖、危险操作有确认 | ✅ 真实数据 + UI | 11 组设置「写→读回→还原」全通过；面板 UI 里真点「保存」改名并还原；危险操作走 `confirmDialog`（导入记忆真机弹确认框） |
| 6 | 屏幕按钮只打开外部浏览器 | ✅ 真机 | DSH 面板点「打开她的屏幕」→ 浏览器新标签打开 noVNC；面板渲染树无 iframe |
| 7 | VM 聊天设置和状态可用 | ✅ 设置/状态 | 9 项设置写入读回；`/api/vm-chat/status`、`wake` 实测；`send` 图片路径白名单 400 实测。⚠️ 没有对真实 QQ 会话发测试消息（避免误发群），发送链路仍是代码路径+离线测试验收 |
| 8 | 旧网页删除后 API、数据、备份、恢复仍正常 | ✅ | 旧网页 410 后 API 正常；备份创建 + `restore.ps1 -Zip` 真实恢复 + 重启加载新数据全流程跑通 |
| 9 | 手机 API 文档/示例可读，未来客户端不需要改后端 | ✅ | `API-CONTRACT.md`（154 端点 / 14 组，2026-11-15 校正；当时为 128）+ `docs/schema/api-index.json` + `docs/schema/models.json` + `MOBILE-GATE.md`；三者一致性由 `npm run smoke` 双向核对 |
| 10 | 备份、发布、回滚路径明确 | ✅ | `scripts/backup.ps1` / `restore.ps1`（含 `-Zip`、BOM、重启时序）；发布按用户要求暂缓 |

---

## 2. 验证

### 2.1 自动化（可复跑）

```bash
npm run check         # 语法：server / client 产物 / lib/index.js
npm run lint          # 0 error
npm run smoke:server  # 45/45（隔离实例、临时数据目录，不动真实数据）
npm run smoke:client  # 38/38（把 lib/client.js 在 Node 里挂载：迷你 React + 假 DOM + 假 fetch）
```

`smoke:server`：`/api/version` 契约、旧网页默认 410、`LEGACY_WEB=1` 恢复旧网页、CORS 预检放行 `x-companion-token`、token 模式 401、恶意 Origin 403、DSH origin 放行、DPAPI 加密、备份列表、经济不阻塞。
`smoke:client`：产物加载与 `apply()` 三处注册、AppShell 六标签渲染、无 iframe、不请求 HTML、聊天历史渲染与发送请求 body、舞台地点渲染、地图名/地点、屏幕 window.open noVNC、关于页版本信息。

### 2.2 真实数据写操作验收（0.7.24，真实运行时 `D:\linzhi`）

方式：每项「写 → 读回 → 还原 → 再读回」，还原后与基线比对；测试前已跑 `scripts/backup.ps1`。
结果：**73/73 通过**。

| 组 | 项 | 结果 |
|---|---|---|
| 设置（11 组） | 聊天风格 / 省 token / 上下文 memoryInject / 模型温度 / 人设 relation / 生活 heartbeatMin / VM checkIntervalMin / 场景 photoChance / 低余额提醒 / 自动看屏幕 / 环境 selfStart | 写后读回一致，还原后与基线完全一致 |
| 记忆 | 文本导入 2 条 → 列表可查 → 逐条删除 → 消失；面板导入框（真机 UI）也验了一遍并清理 | ✅ |
| 地图 | 过期 expectedRev → 409；正确 rev 保存 → 坐标读回变化 → 其它 13 地点/场景零丢失 → 还原深度相等 | ✅ |
| 聊天 | 真发消息 → 落库 → 收到真实回复；再发一条 → 3 秒后 cancel → 回到空闲 | ✅ |
| 角色 | 切到另一个角色再切回，消息/记忆不串 | ✅ |
| 备份 | 新建备份出现在列表；用真实备份跑 `/api/backup/restore`（`restore.ps1 -Zip`）→ 运行时重启 → 数据回到备份点（测试消息被清掉） | ✅ |
| 桌宠 | stop → 状态 false → start → 状态 true | ✅ |
| 屏幕 | stop（savestate）→ 状态 false → start → 状态 true → ensure 修复链路（x11vnc/websockify/6080 全 true） | ✅ |
| VM | 状态/wake 可读可用；`send` 图片路径白名单 400 | ✅（未对真实 QQ 会话发测试消息） |
| 面板 UI 写入 | 设置→角色：改名字 → 点「保存」→ 服务端读回新名字 → 改回 → 保存 → 读回旧名字 | ✅ |
| 记忆 UI 导入 | 数据页导入框粘贴 → 确认框「导入」→ 服务端出现 2 条 → 清理 | ✅ |

### 2.3 真实渲染验证

- **DSH 桌面端本体**：左侧栏「屏幕彼端」→ 原生面板；聊天（真实历史/蓝色用户气泡/头像/图片）、舞台分屏、地图、设置、**3D 舞台（WebGL 真实渲染 + 点地点移动）**、屏幕页（真实 noVNC 状态 + 手机截图）。
  截图：`%USERPROFILE%\AppData\Local\dsh-desktop\screenshots\2026-11-14\` 下 `capture_591396_20261114_224750_515463.png`（3D 舞台）、`..._224552_271978.png`（聊天+分屏舞台）等
- **独立浏览器（真实 React + 真实 `lib/client.js` + 真实运行时数据）**：六标签逐个点开；3D 渲染、拖动旋转、滚轮缩放、点地点移动；点「打开她的屏幕」在浏览器新标签打开 noVNC（不是 iframe）。

### 2.4 真机验证中发现并修掉的问题

| 问题 | 原因 | 修复 |
|---|---|---|
| 用户气泡白底白字、主按钮不可见 | DSH 当前版本把 `--dsw-alias-brand-primary` 别名成 `--dsw-alias-label-primary`（深色主题近白） | 强调色改固定品牌蓝 `#3b82f6`（`T.accent`），中性色仍用主题 token |
| 聊天头像/图片显示「重试」 | 几十条消息各自 `<img>` 直连运行时，重复请求 + 大图并发导致部分加载失败 | `Api.imgUrl` 统一 fetch→blob（缓存 + 同 key 去重），失败才退回直链 |
| 舞台底图首帧「加载失败」 | `<img src="">` 首帧触发 error | 拿到图片地址后才渲染 `<img>` |
| 面板重开后「标签高亮但内容空白」 | 标签持久化在 localStorage，重挂载时只把 chat 标成已打开 | 初始 `opened` 带上持久化标签；非法标签回退 chat |
| 单个标签渲染异常整页白屏 | 没有错误边界 | `SbcViewBoundary`：每个标签单独兜底 + 重试 |
| 备份恢复点了没反应/恢复后仍是旧记录 | `-Zip` 参数不存在；脚本 UTF-8 无 BOM 被 PowerShell 5.1 按 ANSI 解析；复制期间宿主已重启运行时 | `-Zip` 支持 + BOM + 复制完再停一次运行时 |
| 关屏后立刻点启动一直「启动中」 | `savestate` 未落盘时 `startvm` 失败 | `start_screen.ps1` 等 `saving/restoring` 结束再重试 `startvm` |

### 2.5 0.7.24 新增能力验收（3D / 直连 / 自动更新 / 余额刷新 / VM 通道）

| 能力 | 验证方式 | 结果 |
|---|---|---|
| 3D 舞台 | 真实 DSH 面板点「3D」→ 低模小岛 WebGL 渲染；点「车站」→ `/api/location` 真移动；浏览器里拖动旋转/滚轮缩放 | ✅ |
| 聊天直连（OneBot 11） | 适配器 45 项假 OneBot 服务自测；线上端点实测：`/api/direct-chat/settings` 200（19ms，状态 5s 缓存）、未启动桥时返回中文原因；本机没有 OneBot 实现，**没有真桥端到端** | ✅ 代码/接口层，⚠️ 真桥未验 |
| 插件自动更新 | 模块 123 条断言 + 真实 git e2e（%TEMP% 临时 origin）；线上 `/api/update/settings`、`/api/update/check` 实测 200（latest=0.7.23、current=0.7.24、gitRepo=true、gitDirty=true） | ✅（真实仓库 apply 被 dirty 安全拒绝，符合设计） |
| 余额刷新 | `POST /api/balance/refresh` 实测 200/109ms 返回真实余额；状态接口 + 面板「刷新」按钮接入 | ✅ |
| 虚拟机通道补强 | `/api/vm-chat/open` 手动坐标切到 aedo 会话；`/api/vm-chat/send` 手动 composer 坐标真发测试消息，aedo 回「收到」；视觉通道加超时（本机 DeepSeek 文本模型不支持图片 → 明确中文错误，不再挂 6 分钟） | ✅ 手动坐标路径；⚠️ 视觉识别在本机不可用（需要多模态模型） |

**0.7.24 新增端点 13 个**（向后兼容，`apiVersion` 仍 2）：`/api/balance/refresh`、`/api/vm-chat/open`、`/api/direct-chat/{settings,status,friends,send,test,event}`、`/api/update/{check,apply,settings}`。契约见 `API-CONTRACT.md` §13 + `schema/api-index.json`（141 端点 / 14 组）。

**0.7.24 二次追加验证（2026-11-15 凌晨）**

| 项 | 方式 | 结果 |
|---|---|---|
| 旧记忆迁移 | 真实数据：`data/memory/facts.json`（10 条）→ 当前角色 memory/，旧文件改名 `.migrated`；旧日记 2026-11-10 一并迁入 | ✅ 面板「记忆」显示 10 条，统计 live=10 / archived=0 / 日记 4 篇 |
| 记忆衰减 bug | 代码修复（decayedAt 幂等）+ 真实数据修复后重启核对 | ✅ API stats live=10，不再每次调用掉到 0 |
| 置顶/取消置顶 | 真实数据 API 往返（fact id=1，带 expectedRev） | ✅ core 0→1→0 |
| 记忆管理 UI | 真实 DSH 面板截图：记忆标签有核心/普通/归档列表与每条置顶/删除按钮 | ✅ 渲染正常（UI 点击在本机受桌面宠物窗口遮挡/焦点影响，没做成一次机器点击） |
| 设置页崩溃修复 | 真实面板：修复前「设置渲染失败：check is not defined」；修复 + 热重载后设置页正常渲染 | ✅ |
| 内嵌虚拟屏幕 | 真实 DSH 面板屏幕标签：noVNC iframe 直接显示她的虚拟机桌面（QQ 窗口可见），无需外部浏览器 | ✅ |
| 地图时段权重 | 真实面板地图标签：8 个时段、13 个地点权重输入、最近去过提示渲染正常；真实数据保存往返 band0 家权重 30→31→30（已还原） | ✅ |
| token 模式 | 第二临时实例（8911/独立数据目录）：无 token 401、/api/token 引导、header/cookie/SSE 全通 10/10 | ✅ |
| 手机起停 | start → 18s 内 `emulator-5554` 在线（Android 16）；stop → 模拟器进程 0、adb 无设备 | ✅ |
| 破坏性恢复 | 用 backup-20261115-015116 真实 restore：插件+数据恢复、运行时自动拉起、恢复后记忆 10/日记 4 完整 | ✅ |
| 记忆删除按钮 | 真实点击「删除」→ 确认弹窗真实弹出；根因修复（读取不再改 revision + 前端 409 重试）后接口回归通过：3 次 GET rev 稳定、带 expectedRev 删除 200 | ✅（面板刷新后复测） |
| OneBot 直连真实桥 | 用本机 SnowLuma（OneBot 11，127.0.0.1:3000）当测试桥：测试连接拿到在线账号；发测试消息真到对方 QQ；对方 QQ 回消息经 webhook 到运行时、她自动回复真回对方 QQ（截图确认） | ✅ |
| 作息地点下拉 | 真实面板生活标签：每行有「（不指定）+ 当前地图地点」下拉，保存 payload 带 place（离屏断言）；真实 POST 未改动用户配置 | ✅ 渲染+离屏，⚠️ 真实落库未做 |

**真实 VM 通道测试记录**（2026-11-14 23:11，用户授权「所有测试的都可以发给aedo」）：
- `targetContact=aedo` → `POST /api/vm-chat/open {contact:"aedo", row:{x:266,y:265}}` → QQ 会话切到 aedo（截图确认）
- `POST /api/vm-chat/send {text:"（测试消息）…", composer:{x:500,y:750}, skipVerify:true}` → 消息出现在右侧气泡
- aedo 回复「收到」；随后把 `targetContact`、`unreadScan` 还原为空/false
- 发现并修掉：视觉请求没有超时（DeepSeek 文本模型不支持图片时会挂 6 分钟）→ 45s/30s 超时 + 明确中文错误；并加了手动坐标快通道（`row` / `composer` / `skipVerify`）

---

## 3. 模块 → 文件对照

| 模块 | 文件 | 说明 |
|---|---|---|
| 外壳 | `src/client/50-app/app.js` | 标签/状态条/断线重连/分屏/错误边界/全局 Toast+Dialog 宿主；关于页含 3D 引擎自检 |
| 核心 | `src/client/00-core/{const,api,format,store,ui,hooks}.js` | 运行时发现/API 客户端/token/图片 blob 缓存/SSE；主题 token；UI 原语；hooks |
| 聊天 | `src/client/10-chat/chat.js` | 历史/增量/流式/停止/图片/重试/切角色 |
| 3D 舞台 | `src/client/20-stage/three3d.js` | ThreeStage + 场景构建/相机交互/资源释放 + vendor ESM 加载器（blob 改写依赖） |
| 舞台 2D/集成 | `src/client/20-stage/stage.js` | 2D 渲染 + 2D/3D 切换 + 点击地点 + compact 分屏 |
| 地图 | `src/client/20-stage/map.js` | 查看 + 基础编辑 + 保存回读 |
| 设置 | `src/client/30-settings/*.js` | 外壳 + 7 个分类卡片 |
| 屏幕/桌宠 | `src/client/40-screen/{screen,pet}.js` | 外部浏览器 + 截图卡；桌宠开关/状态 |
| 构建 | `scripts/build-client.mjs` | `src/client/**` → `lib/client.js`（单文件工厂，19 个片段） |
| 冒烟 | `scripts/{smoke-test,client-smoke,check-source}.mjs` | 服务端隔离冒烟 / 客户端产物冒烟 / 源码语法检查 |

服务端改动（`runtime/server.mjs`）：
1. 新增 `GET /api/version`（冻结契约入口）；
2. CORS 预检放行 `x-companion-token`、加 `access-control-max-age`；
3. 旧网页页面默认 410（`--legacy-web` / `DSH_COMPANION_LEGACY_WEB=1` / `config.legacyWeb` 开启）。
其余业务 API 保持原样（S03）。

---

## 4. 未验证 / 已知边界（如实）

> 这一节的展开版（每条含「验到哪一步 / 没验什么 / 怎么自己验 / 风险」）在 [`UNVERIFIED.md`](./UNVERIFIED.md)。

1. **VM 聊天「发送消息」链路没有对真实 QQ 会话发测试**：只验证了设置、状态、wake、图片路径白名单。真发文字/图片会进入真实会话（可能误发到群），留给人工在需要时点。
2. **面板部分交互只做了人眼抽查**：拖分界线、文件选择器、导出下载、Modal 细节、3D 触摸手势没有逐项操作验证（3D 拖动/滚轮/点地点在浏览器里验证过）。
3. **token 模式**（`DSH_COMPANION_API_TOKEN`）：CORS 预检与 401 用隔离实例覆盖；面板在 token 模式下的端到端（图片 blob / SSE header）未实测。
4. **手机端不做**（S07/D09）：只冻结 REST/SSE/schema，鉴权与配对是预留（见 `MOBILE-GATE.md`）。
5. **`/api/stage` 的 `apiVersion` 仍是 1**：历史字段，主契约以 `/api/version` 的 `apiVersion: 2` 为准。
6. **旧网页源码保留**（S06）：`runtime/*.html` 还在，默认不对外提供；调试用 `npm run start:legacy-web`。
7. **发布（M28）暂缓**：按用户要求没做 npm publish / git push，产物与说明已就绪。

---

## 5. 回滚

1. `scripts/backup.ps1` 产出的备份（插件 `lib/runtime/src/scripts/examples/docs` + 数据目录 + `config.json`）。
2. 代码回滚：`git` 回到对应提交，或 `scripts/restore.ps1 -Zip <备份.zip>`（会重启运行时两次并加载恢复后的数据）。
3. 运行时数据不需要迁移；新旧版本读写同一份数据格式。
