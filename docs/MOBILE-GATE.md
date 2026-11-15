# 手机门 · 契约 + **桌面侧已实现**（2026-11-15 更新）

> **状态：桌面侧已落地（0.8.10 网关 / 0.8.11 网页版）；手机端整体仍是「研究阶段」，不是成品**。对应表单：**S07**、**D09 A**、**M11**、**M23**。
>
> 一句话：**手机 App 还没写**；「让手机连得上、只能干该干的事」这一半在桌面端做完了，并且额外提供了一个**手机浏览器网页版**（0.8.11）——手机上打开地址就能聊天，不用装 App。**网页版顶部常驻「正在研究（内部测试版）」标识**，功能会变。

> **术语（0.8.10 起全项目统一，别再混）**
> - **「她的手机」** = 她用的 **Android 模拟器**（Waydroid / `DSH_Phone`，在面板「屏幕」页），是桌面端功能。
> - **「手机连接 / 手机端」** = **你自己手上的手机**连到这台电脑（本文 §4 / `API-CONTRACT §5.15` / 设置里的「手机连接」卡片）。
> - 搜索「手机」时先分清是哪一个：修复清单里的 F-015（启动按钮/内存单位）说的是**前者**。

---

## 1. 现在的结论

| 项 | 决定 |
|---|---|
| 手机 UI / App | **仍未做**（桌面面板优先） |
| 手机形态 | 待定（DSH Go 适配层 / 独立 App / 手机浏览器），见任务清单 M-D01 |
| 桌面对接层（局域网 + TLS + 配对 + 权限 + 限流 + 审计） | ✅ **已实现 0.8.10**：`runtime/mobile-gate.mjs` + `§5.15` 8 个端点 + 面板「手机连接」卡片 |
| 手机网页版（浏览器直接开，不用装 App） | ✅ **已实现 0.8.11**：`runtime/mobile-web/`（index.html / app.css / app.js），网关根路径提供；**标着「正在研究」** |
| 手机原生 App / DSH Go 适配层 | ❌ 仍未做（见 §4.5 的两种做法与结论） |
| 出门也能连（不在同一个 Wi-Fi） | ⚠️ **靠虚拟局域网**（Tailscale / ZeroTier）：网关绑 `0.0.0.0`，证书 SAN 自动包含 100.x 地址；**不做公网端口转发** |
| 手机最小能力集 | **聊天 / 角色 / 状态 / 图片**（本文 §3） |
| 同步/合并 | **仍然留给手机阶段**（本文 §5）：事件日志与版本号地基已有，但没有合并 |

**验收口径（M11）**：未来手机客户端只按文档就能完成「配对 + 聊天 + 读取角色 + 看状态 + 显示/发送图片」，且不依赖任何 DSH 专属字段/路径；桌面侧已经能通过 §5.15 的 8 个端点满足它。

---

## 2. 现在有什么 / 没有什么（别假设）

### 2.1 已有（可以依赖）

- ✅ **主 API 契约 v2**：`apiVersion = 2`，`docs/API-CONTRACT.md` + `docs/schema/api-index.json`（**162 个端点 / 15 组**）+ `docs/schema/models.json`；三者一致性由 `npm run smoke` 双向核对。
- ✅ **版本与能力协商**：`GET /api/version` → `{ok, apiVersion, version, minClient, features, install, mobileGate, schema, auth, endpoints}`。
- ✅ **回环鉴权基础**：只监听回环 + Host/Origin 白名单 + 可选 API token（`x-companion-token` / cookie）。
- ✅ **手机连接（0.8.10）**：显式开启后额外监听 `0.0.0.0:8920` 的 **HTTPS**（自签证书 + SHA-256 指纹）；**一次性 6 位配对码**（5 分钟、内存里）换**设备令牌**（服务端只存 sha256）；**权限白名单**（手机只能聊天 + 只读，设置/环境/VM/备份/截图一律 403）；**限流**（配对 5 次/5 分钟、聊天 20 次/分钟、读 300 次/分钟）；**审计**（`mobile-gate/audit.jsonl`，不含明文令牌）；设备可单台撤销、立即生效。
- ✅ **多端数据地基**：消息 `uid`、同步事件 `seq`/`id`、实体 `rev`/`expectedRev`（409）、`sync/device.json`。
- ✅ **聊天数据**：历史轮询（`since` 游标）、SSE 流式、图片消息、停止/打字态。

### 2.2 没有（别假设有，也别找不存在的端点）

- ❌ 手机 UI / App / DSH Go 适配层。
- ❌ 公网访问 / 端口穿透 / 云中转（**故意不做**，见 §4.4）。
- ❌ 多端合并、冲突提示、离线队列、快照（§5.2 仍在）。
- ❌ 手机专用接口（手机复用桌面同一套 `/api/*`，只是被网关限定了白名单）。
- ❌ 设备级细粒度权限（目前只有 `chat` 与 `readonly` 两档）。

---

## 3. 手机端最小能力集（P0）

### 3.1 启动与版本协商

```http
GET /api/version
```

- `apiVersion >= 2` 才继续；`apiVersion` 更大时按「向后兼容」处理（未知字段忽略，见 §6）。
- 按 `features` 判断能力：`features.chat`、`features.image` 必须为 true；`features.stage3d` 0.8.9 起为 **true**（桌面端有 3D），但手机端仍按「不做 3D」处理——这是取舍，不是能力缺失，见 §3.7。
- 拿 `auth.mode` 判断是否需要 token；手机连接方式在 §4。
- 版本不匹配时给用户明确提示（升级客户端 / 升级插件），不要静默降级。

### 3.2 聊天（P0，核心）

| 能力 | 端点 | 说明 |
|---|---|---|
| 全局状态 | `GET /api/status` | 角色、位置、`typing`（她是否在生成）、`mode`；建议 4 秒轮询并共享 |
| 历史 / 增量 | `GET /api/events?since=<最后一条 message.id>` | 首次 `since=0`；只返回 `id > since` 且非 `hidden` 的消息 |
| 发送 | `POST /api/chat` `{text?, images?:[dataUrl]}` | 200 = 已排队；回复异步生成 |
| 停止 | `POST /api/chat/cancel` | 中断当前生成 |
| 流式 | `GET /api/stream`（SSE） | `init / start / delta / done / message`；断线回落到轮询 |
| 图片 | `POST /api/chat` 的 `images[0]`（≤8MB dataUrl） | 只取第一张；图片消息 `image` 字段是 URL |

聊天流程（手机端按这个顺序实现）：

1. `GET /api/version` → 检查 `features.chat`。
2. `GET /api/status` → 初始化角色/位置/`typing`。
3. `GET /api/events?since=0` → 首屏历史；记住最后一条 `message.id`。
4. 增量：`GET /api/events?since=<lastId>` 轮询（1~2 秒，后台暂停） + `GET /api/stream` SSE 加速；断线重连后先用 `since` 补齐。
5. 发送：失败保留输入并提示；`429` 表示她还在说话，等 `done`/`typing=false` 再发。
6. 去重：本地按 `message.uid` 去重（`id` 是角色内自增，切角色会从 1 开始）。
7. 停止：`typing=true` 时显示停止按钮 → `POST /api/chat/cancel`。

**不要**：用 `EventSource`（token 模式带不了 header）；把 `/api/events` 当无限历史（服务端最多留 800 条，超了截到 600）；按消息文案判断角色（用 `role` 字段）。

### 3.3 角色（P0，V1 只读即可）

| 能力 | 端点 | 说明 |
|---|---|---|
| 角色列表 | `GET /api/characters` | `{characters:[{id,name,avatar}], active}` |
| 当前角色 | `GET /api/status.character` | `{id,name,avatar}` |
| 人设与人设正文 | `GET /api/persona` | `meta`（名字/称呼/关系/示例/性格）、`body`（Markdown 人设） |
| 切换角色 | `POST /api/characters {action:'switch', id}` | 手机 V1 可选；说话中会 409 |

手机 V1 **不做**人设编辑（`POST /api/persona`）、头像上传（`POST /api/avatar`）——这些留给桌面端；手机只读展示。

### 3.4 状态（P0）

| 能力 | 端点 | 说明 |
|---|---|---|
| 舞台状态（推荐） | `GET /api/stage` | 角色/位置/行为/天气/钱包/精力/动画提示，一次拿全；手机端不需要 `stage/stream` |
| 当前位置 | `GET /api/location` | 地点名/描述/感受/停留时间/行程进度 |
| 她在做什么 | `GET /api/life/state` | 行为（睡觉/看书/写作业/吃饭…）、热点、开始/结束时间 |
| 钱包 | `GET /api/economy` | `wallet`（虚拟余额/token 模式/真实余额） |
| 所有角色 | `GET /api/world/characters` | 多角色世界状态（同图/同处） |

展示建议：状态用文字（地点名、行为名、天气），**不要把 `energy` 数值直出**——桌面端也是用「精力很足/有点累」这类文案（`/api/pet/status.energy` 已经是文字版）。

### 3.5 图片（P0）

| 能力 | 端点/路径 | 说明 |
|---|---|---|
| 显示聊天图片 | 消息 `image` 字段 | 相对路径，两类：`/images/…`（AI 生成）、`/models/…`（上传） |
| 显示头像 | `/avatar.png?c=<角色 id>`、`/api/pet/avatar` | 后者是二进制；无头像 404 |
| 发送图片 | `POST /api/chat {images:[dataUrl]}` | data URL；≤8MB；只取第一张 |
| 静态资源 | `GET /images/*`、`GET /models/*` | 拼 base URL 即可；失败给占位、不阻塞文字 |

### 3.6 最小能力集 → 端点清单（手机门验收表）

| 能力 | 端点 | 验收（M11） |
|---|---|---|
| 版本协商 | `GET /api/version` | 能判断 `apiVersion/features`，不匹配有提示 |
| 聊天-历史 | `GET /api/events?since=` | 连续聊天 30 轮不丢消息（SSE + 轮询 + uid 去重） |
| 聊天-发送 | `POST /api/chat` | 文字与图片都能发；失败可重试 |
| 聊天-停止/打字态 | `POST /api/chat/cancel`、`GET /api/status.typing`、`/api/stream` | 能显示打字态并停止 |
| 角色 | `GET /api/characters`、`GET /api/persona`、`GET /api/status` | 切换角色不串数据；角色名不写死 |
| 状态 | `GET /api/stage`（或 location/life/economy） | 显示她在哪/在干嘛/天气/钱包 |
| 图片 | 消息 `image`、`/images/*`、`/models/*`、`/avatar.png` | 大图不白屏；失败占位可重试 |

### 3.7 手机 V1 **不做**（留给后续或永远不做）

- 地图编辑（拖动地点/热点/障碍/可走区）——桌面端 D04 B 已覆盖。
- 3D 舞台：桌面端有（`features.stage3d = true`），手机端 V1 不做（性能/范围取舍，D03 B 只约束桌面端）。
- 设置全量（模型 Key/环境/VM/备份恢复）——高风险管理操作留在桌面端。
- 她的屏幕（noVNC）、桌宠、VM 聊天控制——手机端不做。
- 备份/恢复、数据目录管理——桌面端做。

---

## 4. 鉴权与配对（**桌面侧已实现 0.8.10**）

### 4.1 现在手机怎么连

主服务**仍然只听 `127.0.0.1`**。只有在桌面面板「设置 → VM → 手机连接」里点开启后，才会**另起**一个 HTTPS 监听（默认 `0.0.0.0:8920`，自签证书）。手机：

1. 同一 Wi-Fi 下填面板显示的那个 `https://<局域网 IP>:8920`；
2. 首次连接对一下面板上的**证书指纹**（SHA-256）；
3. 用面板生成的**6 位配对码**调 `POST /api/mobile-gate/pair` 换**设备令牌**（只返回一次）；
4. 之后每个请求带 `Authorization: Bearer <设备令牌>`。

关掉开关 → 监听关闭，外部立刻断；已配对设备的令牌保留，下次开启仍可用（想彻底作废就「撤销」）。

### 4.2 实现细节（对得上 §5.15 契约）

| 机制 | 现状（0.8.10） |
|---|---|
| 局域网监听 | 默认关；开启后只听 `0.0.0.0:8920`（可改端口，**不能改明文**）；状态写回 `config.mobileGate`，重启自动恢复 |
| 传输加密 | **强制 TLS**：RSA-2048 自签、SHA-256、SAN=本机局域网 IP + 主机名；`tls:false` 直接 400；证书落在 `<数据根>/mobile-gate/`，快到期自动换 |
| 首次配对 | 一次性 6 位短码（内存、5 分钟、同 IP 5 次/5 分钟限流）；换设备令牌（服务端只存 sha256） |
| 权限最小化 | 白名单放行：聊天 + 只读（§3.6 最小能力集）＋图片/语音静态资源；设置/环境/VM/备份/截图/桌宠一律 403 |
| 限流 | 配对 5 次/5 分钟（每 IP）、发消息 20 次/分钟（每设备）、读 300 次/分钟、静态 600 次/分钟 |
| 撤销/轮换 | 面板列设备 + 单台撤销（每请求查内存表，立刻生效）+ 全部撤销 |
| 审计 | `<数据根>/mobile-gate/audit.jsonl`：cert.create / gate.start|stop / paircode.issue / pair.ok|fail / pair.ratelimited / auth.fail / perm.deny / rate.limited / device.revoke / proxy.fail；**不含明文令牌**，面板可查看最近 20 条 |
| 网关职责 | 只做认证/授权/限流/审计，然后把请求原样转发给回环主服务（含 SSE）——**业务逻辑不复制** |

### 4.3 与最初预留设计的差异（如实记）

1. **配对方式是短码，不是二维码**（二维码可后续加，短码已经够用且不依赖相机权限）。
2. **设备权限只有两档**（`chat` / `readonly`），没有逐接口配置——按最小能力集把不需要的接口直接排除更简单也更安全。
3. **没有独立 CA**：自签 + 首次指纹信任，避免在用户机器上装根证书。
4. **没有 `apiVersion` 升级**：新增端点/字段属于向后兼容（§9.5 规则）。

### 4.4 安全红线

- **不要把 8900 或 8920 做路由器端口转发 / 公网暴露**：这是局域网方案；要远程是另一套安全模型。
- 不要把 `mobile-gate/tls-key.pem`、`mobile-gate/devices.json`、`sync/device.json`、`~/.dsh-companion-port.json`、`api-key.txt` 发给别人。
- 设备令牌泄露 → 立刻在面板撤销（不用重启）。

---

## 5. 同步与合并（留给手机阶段）

### 5.1 已经落下的地基（可以复用）

| 结构 | 位置 | 已实现 |
|---|---|---|
| 设备身份 | `<数据根>/sync/device.json` | `deviceId` 稳定 + 本机 token |
| 事件日志 | `<数据根>/sync/events.jsonl` | `{id, seq, at, deviceId, type, entity, entityId, payload}`；`seq` 单调递增 |
| 拉/推事件 | `GET/POST /api/sync/events` | 按 `id` 去重、追加、返回游标；**不做合并** |
| 实体版本 | `<数据根>/sync/revisions.json`、`GET /api/data/revisions` | 每实体 `rev/updatedAt/updatedBy/hash` |
| 会话保护 | `expectedRev` | 版本不一致 → `409`（`/api/memory/*`、`/api/persona`、`/api/map`） |
| 消息去重 | `message.uid`（UUID） | 跨端消息去重 |
| 当前事件类型 | `message.append`、`character.meta.upsert`、`character.switch`、`maps.replace`、`location.set`、`economy.set`、`life.set` | 见 `/api/sync/info.eventTypes` |

### 5.2 还没实现（手机阶段再做）

- **事件应用/合并（merge）**：`POST /api/sync/events` 只是「存起来 + 去重」，不会把远端事件变成当前状态（`merge: "not-implemented-yet"`）。
- **冲突检测与提示**：现在只有 `expectedRev` 的硬冲突 409，没有「两边都改过 → 弹合并」的 UI/策略。
- **快照/基线**：没有定期快照，没有「从某版本开始重建」的能力。
- **离线队列**：没有离线操作队列和重放。
- **加密传输**：没有 TLS。
- **多端在线状态/推送**：没有；只有事件游标，手机要自己轮询。

### 5.3 分阶段建议（按顺序，别跳）

| 阶段 | 目标 | 需要先完成 |
|---|---|---|
| P1 只读远程 | 同一 Wi-Fi 下手机只读：聊天历史/角色/状态 | 局域网绑定 + 配对 + TLS + 权限最小化（§4.3） |
| P2 单端写 | 手机能发聊天消息（写入事件日志） | 事件应用（至少 `message.append` 的幂等应用） |
| P3 双向合并 | 两边都能改，冲突可提示/可回滚 | 实体级 `rev` 应用、冲突策略、恢复前自动备份两边 |
| P4 离线优先 | 手机本地引擎 + 本地数据 + 联网合并 | P3 完成 + 快照/基线 + 离线队列 |

> 手机 V1 不要假设「推了事件就会自动同步」——当前只是存储+去重。

---

## 6. 未来手机客户端的兼容规则（摘要，全文见 API-CONTRACT §9）

1. **只依赖契约**：`GET /api/version` + `API-CONTRACT.md` + 两个 schema；按 `apiVersion`/`features` 判断，不按插件版本号猜。
2. **未知字段一律忽略**；新增字段/端点/feature 不升 `apiVersion`；删除/改语义才升。
3. **禁止依赖 DSH 专属**：`dsh-app://app` Origin、DSH 宿主路由、DSH 插件 API/插槽、iframe、HTML 页面、`dataRoot`/文件布局、具体错误文案、`/api/token` 作为安全边界。
4. **只请求 `http(s)://<运行时>/api/*` 与图片资源**；旧网页入口默认 410，不要请求。
5. **时间/ID 语义**：ms epoch 整数、`YYYY-MM-DD` 日期、ISO 同步事件；`message.id` 角色内自增、`message.uid` 去重、`seq` 同步游标。
6. **错误处理**：网络错误与 `ok:false` 都要有 UI 错误态；`409` 刷新重试、`401` 重新配对/token、`403` 提示来源被拒。
7. **SSE 只解析 `data:` 帧**（无 `event:`/`id:`/心跳），断线重连 + `since` 补齐。
8. **图片两类 URL**：`/images/…`（AI 生成）、`/models/…`（上传）；加载失败给占位，不阻塞文字。

---

## 7. 手机门验收清单（未来手机端的 Definition of Done）

- [ ] 只按 `API-CONTRACT.md` + `api-index.json` + `models.json` 实现，没有读源码/猜字段。
- [ ] 客户端代码/配置里没有 DSH 专属路径/Origin/字段依赖（`grep dsh-app`、`grep /dsh-screen-beyond` 为空）。
- [ ] 不请求任何 HTML 页面、不嵌 iframe。
- [ ] `GET /api/version` 版本协商通过；`features` 缺能力时降级不崩溃。
- [ ] 聊天：连续 30 轮不丢消息；SSE 断线后靠 `since` 补齐；`429`/`409` 有正确提示。
- [ ] 角色：切换角色不串数据；角色名/头像来自接口。
- [ ] 状态：显示位置/行为/天气/钱包；`energy` 不直出数值。
- [ ] 图片：显示两类图片 URL；发送 dataUrl 图片；失败占位可重试。
- [ ] 鉴权：token 模式能带 header；401 有重新配对/输入 token 的引导。
- [ ] 同步：明确知道当前「推事件不合并」，不把 `POST /api/sync/events` 当同步完成。

---

## 8. 与本轮其他文档的关系

| 文档 | 关系 |
|---|---|
| [`API-CONTRACT.md`](./API-CONTRACT.md) | 完整契约（本文是它的手机门摘要 + 最小能力集） |
| [`schema/api-index.json`](./schema/api-index.json) | 端点索引（手机端可直接生成客户端代码骨架） |
| [`schema/models.json`](./schema/models.json) | 数据模型（角色/消息/记忆/生活/钱包/地图/同步事件） |
| [`MOBILE-SYNC.md`](./MOBILE-SYNC.md) | 同步地基 v1（设备身份/事件日志/revisions/expectedRev），本文 §5 是它的后续路线 |
| [`NATIVE-CLIENT-ARCH.md`](./NATIVE-CLIENT-ARCH.md) | 桌面原生面板实现契约（手机端不复用它的文件结构，只复用 API） |
| [`NATIVE-REWRITE-FORM.md`](./NATIVE-REWRITE-FORM.md) | 需求与决策（S07、D09 A、M11） |

---

## 9. 本轮明确不做（防止范围蔓延）

- 不做手机 UI、不做手机 App、不做 DSH Go 适配层。
- 不改服务监听地址、不加 TLS、不加配对端点。
- 不实现事件合并/冲突处理/离线队列。
- 不为了手机改现有业务 API 的字段语义（S03：全部业务 API 保留原样）。
- 手机端测试数据/真机联调不在本轮验收内。
