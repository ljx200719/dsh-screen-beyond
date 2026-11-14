# 手机门 · 只冻结契约，不做手机 UI（D09 A / S07）

> **状态：契约已冻结（2026-11-14）** · 对应表单：**S07（手机端现在不做，只冻结 API/数据契约）**、**D09 A（冻结 REST/SSE 契约 + JSON schema + 版本号）**、**M11（API/数据/手机门）**、**M23（数据模型文档）**。
>
> 一句话：**手机端现在不做 UI，也不做手机 App**；本轮只把后端契约、数据模型、版本号、鉴权与配对入口冻结好，保证以后手机只写客户端、**不重写后端**。

---

## 1. 现在的结论

| 项 | 决定 |
|---|---|
| 手机 UI | **不做**（本轮桌面原生面板优先，D12 一次性大版本） |
| 手机形态 | 后续做 **DSH Go 原生插件适配层**，不另做独立 App（表单 §9） |
| 本轮交付 | `docs/API-CONTRACT.md`（契约）、`docs/schema/api-index.json`（端点索引）、`docs/schema/models.json`（数据模型）、本文（手机门） |
| 后端改动 | 只加 `GET /api/version`、CORS 预检补 header、旧网页 410；业务 API 全部保留（S03） |
| 手机最小能力集 | **聊天 / 角色 / 状态 / 图片**（本文 §3） |
| 同步/合并 | **留给手机阶段**（本文 §5）：现在已有事件日志与版本号地基，但没有合并 |

**验收口径（M11）**：第三方/未来手机客户端**只按文档**就能完成「聊天 + 读取角色 + 看状态 + 显示/发送图片」，且**不依赖任何 DSH 专属字段/路径**。

---

## 2. 现在有什么 / 没有什么（别假设）

### 2.1 已有（可以依赖）

- ✅ **主 API 契约 v2**：`apiVersion = 2`，`docs/API-CONTRACT.md` + `docs/schema/api-index.json`（128 个端点）+ `docs/schema/models.json`。
- ✅ **版本与能力协商**：`GET /api/version` → `{ok, apiVersion, version, minClient, features, schema, auth, endpoints}`。
- ✅ **鉴权基础**：只监听回环 + Host/Origin 白名单 + 可选 API token（`x-companion-token` / `companion_token` cookie）；SSE 支持 fetch 流。
- ✅ **多端数据地基**：消息 `uid`（UUID）、同步事件 `seq`/`id`、实体 `rev`/`expectedRev` 乐观锁（409）、`sync/device.json` 设备身份与令牌。
- ✅ **聊天数据**：历史轮询（`since` 游标）、异步回复（SSE 流式 + 轮询补齐）、图片消息。
- ✅ **状态数据**：位置/行为/天气/钱包/精力（`/api/stage`、`/api/location`、`/api/life/state`、`/api/economy`）。

### 2.2 没有（本轮不要假设有，也别找不存在的端点）

- ❌ 手机 UI / 手机 App / DSH Go 适配层。
- ❌ 局域网监听、HTTPS/TLS、公网访问、端口穿透。
- ❌ 配对接口（二维码/短码/配对端点**都不存在**，§4 只是预留设计）。
- ❌ 多端合并、冲突提示、离线队列、快照、加密传输。
- ❌ 手机专用接口（手机复用桌面同一套 `/api/*`）。

---

## 3. 手机端最小能力集（P0）

### 3.1 启动与版本协商

```http
GET /api/version
```

- `apiVersion >= 2` 才继续；`apiVersion` 更大时按「向后兼容」处理（未知字段忽略，见 §6）。
- 按 `features` 判断能力：`features.chat`、`features.image` 必须为 true；`features.stage3d` 当前为 false（手机端本来也不做 3D）。
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
- 3D 舞台（`features.stage3d = false`，桌面端也只做 2D，D03 B）。
- 设置全量（模型 Key/环境/VM/备份恢复）——高风险管理操作留在桌面端。
- 她的屏幕（noVNC）、桌宠、VM 聊天控制——手机端不做。
- 备份/恢复、数据目录管理——桌面端做。

---

## 4. 鉴权与配对预留（**设计预留，本轮不实现**）

### 4.1 为什么现在手机连不上

服务**只监听 `127.0.0.1`**（§3.1 API-CONTRACT）：手机不在本机回环内，当前网络层就不通。所以「手机能连」本身是下一阶段的事，本轮只把鉴权形状留好，避免以后改后端。

### 4.2 现有可复用的机制

| 机制 | 现状 | 手机阶段可复用点 |
|---|---|---|
| 回环 + Host/Origin 白名单 | 已实现（`docs/API-CONTRACT.md` §3.1/3.2） | 局域网绑定时 Origin/Host 规则需要扩展（新地址段） |
| 可选 API token | 已实现：`x-companion-token` header 或 `companion_token` cookie；`GET /api/token` 取 | 手机端保存 token 后随请求携带；不要依赖 cookie |
| 同步令牌 + 设备身份 | 已实现：`sync/device.json`、`/api/sync/local`（仅回环，返回 token）、`Authorization: Bearer`/`x-sync-token` | 未来可作为「设备凭证」基础 |
| 版本协商 | `GET /api/version.auth` | 手机端从这里判断鉴权模式与 header 名 |
| 真实余额/token 限额 | 已实现（经济系统） | 手机阶段可做流量/成本控制 |

### 4.3 预留设计（**尚未实现，不要调用不存在的端点**）

> 以下是给手机阶段的设计约束，不是当前 API。真正实现时：新增端点 → 更新 `API-CONTRACT.md` + `api-index.json` + `models.json` → 按契约规则升 `apiVersion`。

1. **局域网绑定**：桌面端显式开启「允许手机连接」（默认关），只监听指定网卡/端口；需要同时扩 Host/Origin 白名单（不能用现在的回环白名单）。
2. **首次配对**：桌面端展示一次性短码/二维码 → 手机提交短码 → 服务端校验后返回**设备凭证**（一次性 + 可撤销）。
3. **凭证存储**：手机存到系统安全存储；请求带 `Authorization` 风格 header（建议与现有 `x-companion-token` 对齐或新增 bearer，实现时在 `/api/version.auth` 里公布）。
4. **传输加密**：必须 TLS（自签证书 + 首次信任，或桌面端生成 CA）；**没有 TLS 不允许离开本机回环**。
5. **权限最小化**：手机默认只有 §3 的只读+聊天权限；设置/环境/VM/备份等接口在局域网模式下应默认拒绝。
6. **撤销/轮换**：桌面端能列出已配对设备并一键撤销；每台设备独立 token。
7. **审计**：配对/失败登录/敏感操作留本地日志（不含明文 token）。

### 4.4 现在的安全红线

- **不要把 8900 直接暴露到公网/路由器端口转发**——没有 TLS、没有配对、没有速率限制。
- 不要把 `sync/device.json`、`~/.dsh-companion-port.json`、`api-key.txt` 发给别人。
- 手机阶段之前，任何「远程陪伴」方案都不在本工程范围内。

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
