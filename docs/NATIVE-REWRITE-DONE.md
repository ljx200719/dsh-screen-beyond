# 桌面原生化 · 验收记录（0.8.0）

> 需求与决策：[`NATIVE-REWRITE-FORM.md`](NATIVE-REWRITE-FORM.md)（D01–D12 / M01–M28 / S01–S08）
> 实现契约：[`NATIVE-CLIENT-ARCH.md`](NATIVE-CLIENT-ARCH.md)
> 发布说明：[`../RELEASE-0.8.0.md`](../RELEASE-0.8.0.md)
> 任务状态：[`NATIVE-REWRITE-TASKS.csv`](NATIVE-REWRITE-TASKS.csv)

这份记录回答三件事：**做了什么、怎么验证的、哪些没验证**。不要把它当成「全部通过」的盖章。

---

## 1. 最终验收清单（对应表单 §6）

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | DSH 面板打开后不加载 `chat.html/map.html/settings.html/stage.html/model.html` | ✅ | 产物静态检查（`smoke:client`：「不请求旧 HTML 页面」「不含 iframe」）；运行时这些路径默认 410 |
| 2 | 聊天可发文字/图片，有历史、打字态、停止/重试 | ✅ 代码路径 | `smoke:client`：历史渲染 + `POST /api/chat` body 断言；`smoke:server`：`/api/chat/cancel` 200。⚠️ 真实发消息未跑（怕打扰/花钱） |
| 3 | 2D 舞台正常；3D 无资源时明确回退，不白屏 | ✅ | `smoke:client`：舞台渲染地点、无 iframe；无底图分支有明确提示+去地图页按钮。3D 本版不做（D03 B） |
| 4 | 地图可以查看地点/角色/旅行；编辑达到所选范围（B：基础编辑） | ✅ 代码路径 | `smoke:client`：地图名/地点渲染；编辑能力实现（拖钉/地点/场景/热点/障碍/可走 + 保存回读 + 409）。⚠️ 真实保存未跑 |
| 5 | 设置保存、读失败不覆盖、危险操作有确认 | ✅ 代码路径 | 各设置卡：只提交改动字段、读失败禁存、`confirmDialog`、clamp、409 重读；离线冒烟拦截 POST 断言 payload。⚠️ 真实落库未跑 |
| 6 | 屏幕按钮只打开外部浏览器 | ✅ | `smoke:client`：点「打开她的屏幕」→ `window.open` 收到 noVNC URL；屏幕渲染树无 iframe |
| 7 | VM 聊天设置和状态可用 | ✅ 代码路径 | 9 项设置 + `/api/vm-chat/status` 状态区 + 唤醒/检查/发文字/打开屏幕按钮。⚠️ 真实唤醒/发送未跑（依赖虚拟机登录态） |
| 8 | 旧网页删除后 API、数据、备份、恢复仍正常 | ✅ | `smoke:server`：旧网页 410 后 `/api/memory` 仍 200；备份脚本已覆盖 `src/`、`docs/`；数据格式未变 |
| 9 | 手机 API 文档/示例可读，未来客户端不需要改后端 | ✅ | `API-CONTRACT.md`（128 端点）+ `docs/schema/api-index.json` + `docs/schema/models.json` + `MOBILE-GATE.md` |
| 10 | 备份、发布、回滚路径明确 | ✅ | `scripts/backup.ps1` / `restore.ps1`（含新目录）；`RELEASE-0.8.0.md` 的「升级注意」；产物放 `F:\屏幕彼端\发布产物` |

---

## 2. 自动化验证（可复跑）

```bash
npm run check         # 语法：server / client 产物 / lib/index.js
npm run lint          # 0 error（warning 为既有风格与未使用变量）
npm run smoke:server  # 45/45（隔离实例、临时数据目录，不动真实数据）
npm run smoke:client  # 38/38（把 lib/client.js 在 Node 里挂载：迷你 React + 假 DOM + 假 fetch）
```

`smoke:server` 覆盖：`/api/version` 契约、旧网页默认 410、`LEGACY_WEB=1` 恢复旧网页、CORS 预检放行 `x-companion-token`、token 模式 401、恶意 Origin 403、DSH origin 放行、DPAPI 加密、备份列表、经济不阻塞。

`smoke:client` 覆盖：产物加载与 `apply()` 三处注册（侧栏/主面板/设置入口）、AppShell 六标签渲染、无 iframe、不请求 HTML、聊天历史渲染与发送请求 body、舞台地点渲染、地图名/地点、屏幕外部打开、关于页版本信息、模块入口存在性。

## 2.1 真实面板验证（2026-11-14，本机）

用两个真实渲染环境验证过：

1. **DSH 桌面端本体**：刷新/热更新后左侧栏「屏幕彼端」打开的是原生面板——
   聊天（真实历史、蓝色用户气泡、头像/图片正常）、舞台分屏（真实官方地图 + 地点钉 + 角色）、屏幕页（真实 noVNC 状态「已连接」+ 真实手机截图 + 外部浏览器按钮）。
   截图：`C:\Users\Lenovo\AppData\Local\dsh-desktop\screenshots\2026-11-14\capture_591396_20261114_220530_004703.png`、`..._220604_080482.png`
2. **独立浏览器（真实 React + 真实 lib/client.js + 真实运行时数据）**：六个标签逐个点开，
   聊天/舞台/地图/设置/屏幕/关于都正常；点「打开她的屏幕」会在浏览器新标签打开 noVNC（证明不是 iframe）。
   截图：`capture_1313612_20261114_220015...`（聊天+分屏舞台）、`..._220026`（地图）、`..._220035`（设置）、`..._220048`（屏幕）、`..._220148`（舞台）

真实面板验证中发现并修掉 3 个问题（都被自动化冒烟漏掉，属于"只有真浏览器才暴露"）：

| 问题 | 原因 | 修复 |
|---|---|---|
| 用户气泡白底白字、主按钮不可见 | DSH 当前版本把 `--dsw-alias-brand-primary` 别名成 `--dsw-alias-label-primary`（深色主题近白色），拿它当填充色就白底白字 | `T.brand` 改为固定品牌蓝 `#3b82f6`（`T.accent`），中性色仍用主题 token |
| 聊天头像/图片显示「重试」 | 几十条消息各自 `<img>` 直连运行时，重复请求 + 大图并发导致部分加载失败 | `Api.imgUrl` 统一 fetch→blob（缓存 + 同 key 去重），失败才退回直链 |
| 舞台底图偶发「加载失败」 | `<img src="">` 在首帧触发 error 被当成底图失败 | 拿到图片地址后才渲染 `<img>` |

---

## 3. 模块 → 文件对照

| 模块 | 文件 | 说明 |
|---|---|---|
| 外壳 | `src/client/50-app/app.js` | 标签、状态条、断线重连、分屏、全局 Toast/Dialog 宿主 |
| 核心 | `src/client/00-core/{const,api,format,store,ui,hooks}.js` | 运行时发现/API 客户端/token/图片/SSE；主题 token；UI 原语；hooks |
| 聊天 | `src/client/10-chat/chat.js` | 历史/增量/流式/停止/图片/重试/切角色 |
| 舞台 | `src/client/20-stage/stage.js` | 2D 渲染 + 点击地点 + compact 分屏 |
| 地图 | `src/client/20-stage/map.js` | 查看 + 基础编辑 + 保存回读 |
| 设置 | `src/client/30-settings/*.js` | 外壳 + 7 个分类卡片 |
| 屏幕/桌宠 | `src/client/40-screen/{screen,pet}.js` | 外部浏览器 + 截图卡；桌宠开关/状态 |
| 构建 | `scripts/build-client.mjs` | `src/client/**` → `lib/client.js`（单文件工厂） |
| 冒烟 | `scripts/{smoke-test,client-smoke,check-source}.mjs` | 服务端隔离冒烟 / 客户端产物冒烟 / 源码语法检查 |

服务端只为原生化做了 3 处改动（`runtime/server.mjs`）：
1. 新增 `GET /api/version`（冻结契约入口）；
2. CORS 预检放行 `x-companion-token`、加 `access-control-max-age`；
3. 旧网页页面默认 410（`--legacy-web` / `DSH_COMPANION_LEGACY_WEB=1` / `config.legacyWeb` 开启）。
其余业务 API 保持原样（S03）。

---

## 4. 未验证 / 已知边界（如实）

1. **真实写操作没在真实数据上跑**：发消息、保存地图/设置、移动角色、备份/恢复、VM 唤醒/发送、屏幕/手机/桌宠启停。都做了「拦截写请求 + 断言 payload」的离线覆盖，但**服务端真实落库效果需要人工点一遍**。
   - 建议顺序：先 `scripts/backup.ps1` 备份 → 改一条设置 → 刷新看是否还在 → 地图拖一个钉保存 → 刷新确认。
2. **真实面板视觉/手感未人眼验收**：布局、滚动、拖动、Modal、文件选择器、导出下载、confirm 弹层。离线渲染只保证逻辑不崩。
3. **token 模式**（`DSH_COMPANION_API_TOKEN`）：CORS 预检与 401 已用隔离实例覆盖；面板里图片 blob / SSE header 路径的**端到端**未在 token 模式下实测。
4. **3D 舞台不在本版本**（D03 B）。有 3D 资源的地图只显示 2D + 提示；`/model` 旧入口已下线。
5. **手机端不做**（S07 / D09）：只冻结 REST/SSE/schema，鉴权与配对是预留（见 `MOBILE-GATE.md`），没有实现。
6. **`/api/stage` 的 `apiVersion` 仍是 1**：历史字段，主契约以 `/api/version` 的 `apiVersion: 2` 为准。
7. **旧网页源码保留**（S06）：`runtime/*.html` 还在，默认不对外提供；调试用 `npm run start:legacy-web`。

---

## 5. 回滚

1. `scripts/backup.ps1` 产出的备份（插件 `lib/runtime/src/scripts/examples/docs` + 数据目录 + `config.json`）。
2. 代码回滚：`git` 回到 0.7.23 对应提交，或 `scripts/restore.ps1 -BackupDir <备份目录>`。
3. 运行时数据不需要迁移；新旧版本读写同一份数据格式。
