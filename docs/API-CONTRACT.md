# 屏幕彼端 · API / SSE 契约（冻结版 v2）

> **状态：冻结（2026-11-14，2026-11-16 随 0.9.0 同步）** · `apiVersion = 2` · 运行时版本 `0.9.0` · 覆盖 **165 个 `/api/*` 端点 / 15 组**（其中 0.7.24 新增的 13 个向后兼容端点明细见 §13；0.8.9 补齐的 13 个、0.8.10 新增的 8 个手机门端点已并入 §5）
>
> 这份文档是「屏幕彼端」插件运行时的 **REST + SSE 对外契约**，供两类客户端使用：
> 1. DSH 桌面原生面板（本机 `127.0.0.1:8900` 直连，见 §10）；
> 2. **未来的手机端 / 第三方客户端**（D09 A / S07：本轮只冻结契约，不写手机 UI，见 §9 和 [`MOBILE-GATE.md`](./MOBILE-GATE.md)）。
>
> 对应需求表单：**M11（API/数据/手机门）、M22（契约冻结）、M23（数据模型文档）**；决策：**D02 A 直连、D09 A 冻结 REST/SSE/schema、D11 C 回环+Origin+可选 token**。
>
> **字段以代码为准**：本契约按 `runtime/server.mjs`、`runtime/memory.mjs`、`runtime/sync.mjs`、`runtime/data-store.mjs` 的实际实现整理，并在 `127.0.0.1:8900` 运行实例上只读核对了全部 GET 响应（写操作只读源码，未在真实数据上执行）。
> 机器可读版本：端点索引 [`schema/api-index.json`](./schema/api-index.json)，数据模型 JSON Schema [`schema/models.json`](./schema/models.json)。
> 标「**未验证**」的项见 §12。

---

## 0. 三份文档怎么配合

| 文档 | 面向 | 内容 |
|---|---|---|
| **API-CONTRACT.md（本文）** | 人（客户端开发者） | 版本/鉴权/错误码/SSE/图片/数据模型/兼容规则的完整说明 + 每个端点一行 |
| [`schema/api-index.json`](./schema/api-index.json) | 机器 | 165 个端点的 `method/path/auth/req/res/errors/sse/evidence` 索引；`apiVersion`、`groups`/`endpoints` 计数与本文一致 |
| [`schema/models.json`](./schema/models.json) | 机器 | 角色/消息/记忆/生活/钱包/地图/场景/同步事件等 JSON Schema（draft-07 简化版） |
| [`MOBILE-GATE.md`](./MOBILE-GATE.md) | 产品/后续手机开发 | 手机门当前状态、最小能力集、鉴权与配对预留、同步合并的后续阶段 |

**更新规则**：改任何 `/api/*` 行为时，同一提交里同步改本文 + 两个 schema 文件；破坏性改动（删字段/改语义/改错误约定）必须把 `API_VERSION` 加 1（见 §11）。

---

## 1. 快速开始

服务默认监听 `http://127.0.0.1:8900`（`LINZHI_PORT` 可改，端口被占时会自动 +1 重试；实际端口写在 `~/.dsh-companion-port.json`，原生面板通过 DSH 宿主的 `/dsh-screen-beyond/info` 或端口扫描发现）。

```bash
# 1) 先读版本与能力
curl -s http://127.0.0.1:8900/api/version

# 2) 当前状态（角色、位置、是否正在打字、钱包）
curl -s http://127.0.0.1:8900/api/status

# 3) 拉聊天历史（since = 上一条 message.id，首次传 0）
curl -s "http://127.0.0.1:8900/api/events?since=0"

# 4) 发一句话（回复是异步的，靠 /api/stream + /api/events 拿）
curl -s -X POST http://127.0.0.1:8900/api/chat \
  -H 'content-type: application/json' \
  -d '{"text":"我回来啦"}'
```

> ⚠️ 客户端**只允许**请求 `/api/*`、`/images/*`、`/models/*` 与图片资源；**不要请求任何 HTML 页面**（旧网页入口默认 410 JSON，见 §4.4 / §10）。
> `POST /api/*` 的 body 必须是合法 JSON；空 body 当作 `{}`。

---

## 2. 版本与协商（`GET /api/version`）

**这是冻结契约的入口**：客户端启动先读它，再按 `features` 决定调用哪些能力；不要按插件版本号猜能力，也不要依赖本文以外的字段。

源码实现（`runtime/server.mjs` 的 `/api/version`，`API_VERSION = 2`）：

```json
{
  "ok": true,
  "apiVersion": 2,
  "version": "0.9.0",
  "minClient": "0.9.0",
  "dataRoot": "D:\\linzhi",
  "auth": {
    "mode": "loopback",
    "tokenEndpoint": "/api/token",
    "header": "x-companion-token",
    "cookie": "companion_token",
    "allowedOrigins": ["127.0.0.1", "localhost", "::1", "dsh-app://app"]
  },
  "features": {
    "chat": true, "stream": true, "stage2d": true, "stage3d": true,
    "mapView": true, "mapEdit": true, "settings": true, "screen": true,
    "pet": true, "vmChat": true, "memory": true, "diary": true, "backup": true,
    "sync": true, "image": true, "weatherFx": true, "legacyWeb": false
  },
  "install": { "kind": "git", "legacyWebStatus": 410 },
  "schema": {
    "contract": "docs/API-CONTRACT.md",
    "apiIndex": "docs/schema/api-index.json",
    "models": "docs/schema/models.json"
  },
  "endpoints": {
    "status": "/api/status", "events": "/api/events", "chat": "/api/chat",
    "cancel": "/api/chat/cancel", "stream": "/api/stream", "stage": "/api/stage",
    "map": "/api/map", "screen": "/api/screen/info"
  }
}
```

字段语义：

| 字段 | 类型 | 说明 |
|---|---|---|
| `apiVersion` | integer | **契约版本**。当前 `2`（第一次为原生面板 + 手机门冻结）。删字段/改语义/改错误约定才 +1 |
| `version` | string | 运行时插件版本（`package.json.version`，可被 `DSH_COMPANION_VERSION` 覆盖） |
| `minClient` | string | 服务端建议的最低客户端版本（0.8.9 起等于当前版本；仍未做运行时强制校验） |
| `dataRoot` | string | 本机数据目录绝对路径。**仅本机调试用；手机/第三方客户端不得依赖** |
| `auth.mode` | `loopback` \| `token` | `token` 表示运行实例开了 API token（见 §3.3）；`loopback` 表示只跑当前的本机鉴权 |
| `features` | object | 能力开关。**新增能力只加 key，不 +apiVersion**；值为 `false` 时客户端必须降级而不是报错 |
| `install` | object | **0.8.9 新增**。`kind`: `git`（本地 git 检出）/ `link`（pnpm link）/ `npm`（npm 或插件管理器安装）/ `unknown`；`legacyWebStatus`: 旧网页入口当前返回的 HTTP 码（默认 `410`，开了 `--legacy-web` 才是 `200`）。用来判断「怎么更新」和「旧网页是否可达」，不要去猜 |
| `schema` | object | 三份契约文档相对路径 |
| `endpoints` | object | 常用端点快捷入口（只是提示，不是全部） |

> **0.8.9 的两处变化**：`features.stage3d` 由 `false` 改为 **`true`**（3D 舞台确实可用，WebGL 不可用由客户端回退 2D）；新增 `install` 字段。两者都**不改变** `apiVersion=2`，老客户端忽略新字段即可。

**版本号有三套，别混**：

| 编号 | 位置 | 当前值 | 用途 |
|---|---|---|---|
| 主 API 契约 | `GET /api/version.apiVersion` | **2** | 本文契约 |
| 同步协议 | `GET /api/sync/info.apiVersion` | `1` | 设备/事件日志协议（与主 API 独立演进） |
| 舞台载荷 | `GET /api/stage.apiVersion` | `1` | **历史遗留字段**，源码里恒为 1，不要拿它判断契约版本 |

> **已实测（2026-11-15，0.8.9 运行时）**：`127.0.0.1:8900` 的 `GET /api/version` 返回 `200`，结构含上面的 `install`，`features.stage3d=true`、`legacyWeb=false`、`auth.mode=loopback`、`install.kind=git`。`/api/version` 同样受 Origin/Host 校验（白名单 Origin 回显 ACAO，恶意 Origin 实测 403）。其余未验证项见 §12。

---

## 3. 鉴权与网络安全

所有规则都在请求进入路由前统一执行（`runtime/server.mjs` 的 `http.createServer` 顶部）。

### 3.1 网络范围

- 服务**只监听 `127.0.0.1`**，不对局域网/公网开放。
- `Host` 头必须是 `127.0.0.1` / `localhost` / `::1`，否则 **403 `forbidden host`**（`text/plain`，不是 JSON）；`Host` 为空时不校验（HTTP/1.0 场景）。
- 未来手机端要直连，必须先改监听地址并做 TLS/配对——本轮**未实现**，见 §9 与 [`MOBILE-GATE.md`](./MOBILE-GATE.md)。

### 3.2 Origin 白名单与 CORS

| 规则 | 行为 |
|---|---|
| `Origin` 为空 | 放行（命令行/同源请求） |
| `Origin` 是本机回环（`127.0.0.1` / `localhost` / `::1`，任意端口） | 放行，并回显 `access-control-allow-origin: <origin>` + `vary: Origin` |
| `Origin` 是 `dsh-app://app`（DSH 原生面板的自定义 scheme） | 放行（精确匹配，不放行其它自定义 scheme） |
| 其它 Origin | **403 `forbidden origin`**（`text/plain`） |
| `Sec-Fetch-Site: cross-site` 且 Origin 不在白名单、`Sec-Fetch-Mode` 不是 `navigate` | **403 `forbidden site`**（`text/plain`，页面导航不拦） |
| `OPTIONS` 预检 | `204`，`access-control-allow-methods: GET,POST,OPTIONS`，`access-control-allow-headers: authorization,content-type,x-sync-token,x-companion-token`，`access-control-max-age: 600` |

### 3.3 可选 API token（D11 C，默认关）

运行实例设置环境变量 `DSH_COMPANION_API_TOKEN` 后，**除 `GET /api/token` 外所有 `/api/*`** 都需要带 token：

```http
x-companion-token: <token>
# 或（页面/浏览器）cookie
Cookie: companion_token=<token>
```

- 缺失/错误 → `401 {"ok":false,"error":"缺少或错误的 API token（x-companion-token）"}`。
- CORS 预检已放行 `x-companion-token` 头（D11 C 的修复）。
- token 会写进端口文件 `~/.dsh-companion-port.json`（命令行用）并可通过 `GET /api/token` 取回（**同源/白名单 Origin + 回环**才能取，但仍不是秘密通道：手机端不要把它当安全边界）。
- **原生面板**通过 `GET /api/token` 拿 token（`00-core/api.js` 已封装）；**手机/第三方客户端**建议配对时让用户输入 token，用 `x-companion-token` header（或未来配对发放的 bearer token）携带（未来规范化，见 §9.3）。

### 3.4 同步令牌（手机同步地基）

`GET /api/sync/info`、`GET/POST /api/sync/events` 额外要求**本机同步令牌**：

```http
Authorization: Bearer <token>
# 或
x-sync-token: <token>
```

- 令牌来源：`GET /api/sync/local`（**只允许本机回环 IP**，响应里带 `token`）。
- 缺失/错误 → `401 {"ok":false,"error":"unauthorized"}`（`syncJson`，结构同上）。
- 这套令牌与 §3.3 的 API token 是**两套独立机制**，可以同时存在。

### 3.5 仅回环 IP 的接口

`GET /api/data/revisions`、`GET /api/sync/local` 额外检查 `remoteAddress`，非回环 → `403 {"ok":false,"error":"only loopback"}`。即使 Origin/Host 合法也一样。

### 3.6 本轮**没有**做的（写清楚，别让手机端误以为有）

- 没有局域网监听、没有 TLS/HTTPS。
- 没有配对流程（二维码/短码/配对接口都**尚未实现**，不要调用不存在的端点）。
- 没有设备级权限分级：拿到 token（若开启）或能访问回环，就拥有全部权限。
- 没有速率限制（除 `/api/chat`、`/api/pet/act` 的「她还在说话」429）。

---

## 4. 通用约定

### 4.1 请求

- `POST /api/*`：`Content-Type: application/json`；body 不是合法 JSON → `400 {"ok":false,"error":"请求格式不正确"}`；空 body 视为 `{}`；开头 BOM 会被剥掉。
- 请求体上限 40MB（`readBody`）；超过会抛 413，但错误体是通用文案 `{"ok":false,"error":"服务器内部错误"}`（**未实测**）。
- 查询参数都是字符串，服务端自己 `Number()` 转换；非法值多数回退默认值。

### 4.2 成功 / 失败约定

- 绝大多数接口成功返回 `{"ok":true, ...}`；失败返回 `{"ok":false,"error":"…"}`。
- 部分历史接口成功时**没有 `ok` 字段**，客户端判断成功不能只看 `ok`，要先看 HTTP 状态码与响应结构。已确认的 GET 形态：`/api/status`、`/api/events`、`/api/resources`、`/api/map`、`/api/location`、`/api/world/characters`、`/api/routine`、`/api/characters`、`/api/persona`、`/api/model`、`/api/context`、`/api/mode`、`/api/env`、`/api/token-saving`、`/api/memory`、`/api/life`、`/api/weather`、`/api/diary`、`/api/tutorial`。
- 错误文案是给人看的，**不要按文案分支**；按 HTTP 状态码 + `ok` 判断。

### 4.3 HTTP 200 + `ok:false`（业务性拒绝）

这些接口失败时仍是 `200`：

| 接口 | 条件 | 响应 |
|---|---|---|
| `POST /api/map/activate`、`POST /api/location`、`POST /api/travel/ticket` | 体力不够/夜间外出需确认/钱不够/交通方式不可用 | `{ok:false, refused:true, needsConfirm?, reason, location}` |
| `POST /api/wallet/spend` | 余额不足 | `{ok:false, result:{ok:false,reason,left}, wallet}` |
| `POST /api/diary/show` | 今天没写日记 | `{ok:false, error:"今天还没写日记"}` |
| `POST /api/space/start`、`POST /api/phone/start` | 空闲内存不足 | `{ok:false, refused:true, error, freeMB, message}` |
| `POST /api/backup/restore` | 恢复脚本失败 | `{ok:false, message, output}` |
| `GET /api/scene/activity` | 地点不存在 | `404` + `{ok:false,error}`（这个是真 404） |

### 4.4 错误码总表

| 状态码 | 何时 | 响应体 | 示例 |
|---|---|---|---|
| `200` | 成功；或 §4.3 的业务拒绝 | JSON | — |
| `400` | 坏 JSON；参数/内容不合法 | `{ok:false,error}` | `请求格式不正确`、`空消息`、`导入内容为空`、`不能删默认角色`、`备份名不合法`、`未知天气`、`没有这个配色`、`没有这张背景`、`还没有自定义背景`、`图片太大`、`不支持的图片格式`、`请上传 jpg/png/webp 图片`、`需要 png/jpeg/webp 图片`、`API Key 太短`、`图片路径不允许（只允许 data/images 下的文件）` |
| `401` | token 模式缺/错 token；同步接口缺同步令牌 | `{ok:false,error}` | `缺少或错误的 API token（x-companion-token）`、`unauthorized` |
| `403` | Host / Origin / cross-site 被拒（**text/plain**）；仅回环接口被非回环访问（JSON） | text 或 `{ok:false,error}` | `forbidden host`、`forbidden origin`、`forbidden site`、`only loopback` |
| `404` | 路径不存在；资源不存在 | `{ok:false,error}` | `not found`、`没有这个角色`、`没有这张地图`、`地点不存在`、`地点或热点不存在`、`没有生活状态`、`角色不在任何地点`、`找不到这个备份` |
| `409` | 乐观锁版本冲突；说话中切角色 | `{ok:false,error,entity?,id?,expectedRev?,currentRev?}` | `版本冲突：数据已被修改，请刷新后再试`、`她还在说话，等这一轮结束再切角色` |
| `410` | 旧网页入口（非 API；默认关闭，仅 `DSH_COMPANION_LEGACY_WEB=1` / `--legacy-web` / `config.legacyWeb=true` 时提供） | `{ok:false,error,hint,apiVersion,legacyPage}` | `网页入口已下线` |
| `413` | 请求体 > 40MB（**未实测**） | `{ok:false,error:"服务器内部错误"}` | — |
| `429` | 她还在生成 | `{ok:false,error}` | `她还在说话` |
| `500` | 服务端异常；部分接口带具体原因 | `{ok:false,error}` | `服务器内部错误` 或 `String(e.message)` |
| `501` | VM 聊天图片发送在当前运行时不可用 | `{ok:false,error}` | `当前运行时还不支持图片发送` |
| `503` | 截图类接口失败（**text/plain**） | text | `桌面内核没在运行，兜底截图也失败了`、`手机截图失败`、`手机不可用` |

服务端兜底：未捕获异常 → `500 {ok:false,error:"服务器内部错误"}`（400 时是 `请求格式不正确`）。

### 4.5 时间 / ID / 单位

- 时间：除特别标注外都是 **ms epoch 整数**（`at`、`since`、`startedAt`、`endsAt`、`lastTurnAt` 等）；日期字符串是 `YYYY-MM-DD`；同步事件的 `at`/`receivedAt` 是 **ISO 字符串**。
- 角色 id：`^[A-Za-z0-9_-]{1,40}$`（非法 id 会被忽略/回退当前角色）。
- 消息 id：**角色内自增整数**（`/api/events?since=` 的游标）；`uid` 是 UUID，跨端去重用。
- 地图/场景坐标：**0..1 归一化**（`x` 0.05..0.95 / `y` 0.08..0.92 是地点 clamp 范围；场景内角色 0.02..0.98 / 0.08..0.95）。
- 距离：米（`distanceMeters`）/ 公里（`km`）；速度：km/h；行程时间：ms 与秒（`etaSec`）。
- 金额：虚拟币「块」（number），token 用量是整数。

### 4.6 分页与 `since` 增量

**只有两处分页**，其余接口一次返回全量：

| 接口 | 游标 | 规则 |
|---|---|---|
| `GET /api/events?since=<message.id>` | 消息自增 id | 只返回 `id > since` 且非 `hidden` 的消息；**没有 limit**；服务端最多留 800 条消息（超了截到最近 600），所以 `since` 太旧会丢老消息 |
| `GET /api/sync/events?since=<seq>&limit=<1..1000>` | 同步事件 `seq` | 默认 `limit=500`；事件文件超过 8MB 轮转为 `events.jsonl.1`（旧事件不再可读） |
| `GET /api/data/revisions` | — | 全量快照，没有增量参数 |

列表上限：记忆事实 500 条/次导入、日记列表 60、备份列表 30、地图地点 40、场景热点 24/照片 12/障碍与可走区各 40、同步事件单次推送 200。

### 4.7 乐观锁 `expectedRev`

以下写接口接受可选 `expectedRev`（整数）：`POST /api/memory/import`、`/api/memory/pin`、`/api/memory/delete`、`/api/persona`、`/api/map`。

- 不传 = 保持旧行为（后写覆盖）。
- 传了且与当前版本不一致 → `409 {ok:false,error:"版本冲突：数据已被修改，请刷新后再试", entity, id, expectedRev, currentRev}`。
- 当前版本从对应 GET 响应的 `rev`（`/api/memory`、`/api/persona`）或 `GET /api/data/revisions`（`entities["<entity>:<id>"].rev`）取。
- 注意：**`POST /api/life` 没有乐观锁**，是整段浅合并。

---

## 5. 端点清单（165 个 / 15 组）

> 与 `docs/schema/api-index.json` 的 `totals` 保持一致（该文件是机器可读版）。新增端点时必须两边同时加，并跑 `npm run smoke` 里的契约一致性检查（M-401/§12.1）。

约定：**鉴权列** `api` = 回环 + Origin 白名单 +（token 模式时需 token）；`api+sync` = 另需同步令牌；`api+loopback` = 另需本机回环 IP；`api·免token` = token 模式也豁免（仅 `/api/token`）。
「主要错误」列只列业务侧常见错误；`400 请求格式不正确`、`500`、`403` 等全局规则见 §4。
**evidence**：`live` = 已在 8900 运行实例上核对响应；`source` = 只按源码整理（写操作没有在真实数据上执行）。

### 5.1 元信息 / 版本 / 状态（5 个）

启动最先用的一组。`/api/version` 是契约入口；`/api/status` 建议 4 秒轮询并做全局单例。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/version` | api | — | `ok`: boolean<br>`apiVersion`: integer=2（冻结契约版本）<br>`version`: string（运行时插件版本）<br>`minClient`: string（建议最低客户端版本，源码当前 0.7.24）<br>`dataRoot`: string（本机数据目录；手机端不得依赖）<br>`auth`: object{mode,tokenEndpoint,header,cookie,allowedOrigins}<br>`features`: object（chat/stream/stage2d/stage3d/mapView/mapEdit/settings/screen/pet/vmChat/memory/diary/backup/sync/image/weatherFx/legacyWeb）<br>`schema`: object{contract,apiIndex,models}<br>`endpoints`: object（常用端点快捷路径） | — |
| GET | `/api/token` | api·免token | — | `ok`: boolean<br>`token`: string（空字符串=未启用 token 模式） | — |
| GET | `/api/status` | api | — | `version`: string<br>`typing`: boolean（她正在生成）<br>`busy`: boolean<br>`lastTurnAt`: integer<br>`usage`: object&#124;null（最近一次模型用量）<br>`count`: integer（消息总数，含 hidden/system）<br>`setup`: object{dataRoot,apiKeyOk,characters}<br>`tokens`: tokenStats（见 models.json）<br>`model`: string<br>`modelConfig`: object{name,reasoningEffort,temperature,maxTokens,maxSteps}<br>`context`: object{historyMode,memoryInject}<br>`mode`: string（chat&#124;full）<br>`place`: currentPlace（见 models.json）<br>`character`: object{id,name,avatar}<br>`memory`: memoryStats<br>`diaryToday`: boolean<br>`energy`: integer | — |
| GET | `/api/resources` | api | — | `space`: boolean（虚拟机运行中）<br>`phone`: boolean（安卓模拟器已连接）<br>`mem`: string[]（VBoxHeadless/emulator 进程内存 '进程名:MB'） | — |
| GET | `/api/env/check` | api | — | `ok`: boolean<br>`checks`: object[]{id,label,ok,detail}<br>`hints`: string[]<br>`paths`: object{dataRoot,envDir,envPy,version} | 500 String(e.message) |

### 5.2 同步地基（设备 / 事件 / 版本）（5 个）

手机同步地基 v1：只提供设备身份、事件日志与受令牌保护的拉取/推送，**不做业务合并**。详见 [`MOBILE-SYNC.md`](./MOBILE-SYNC.md)。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/data/revisions` | api+loopback | — | `ok`: boolean<br>`version`: integer<br>`deviceId`: string<br>`updatedAt`: ISO string<br>`entities`: object（键 `<entity>:<entityId>` → {rev,updatedAt,updatedBy,file,hash}） | 403 only loopback |
| GET | `/api/sync/local` | api+loopback | — | `ok`: boolean<br>`apiVersion`: integer=1（同步协议版本）<br>`device`: object{id,name}<br>`cursor`: integer（最后 seq）<br>`eventCount`: integer<br>`eventTypes`: string[]<br>`authRequired`: boolean<br>`merge`: string（'not-implemented-yet'）<br>`token`: string（本机同步令牌，敏感） | 403 only loopback |
| GET | `/api/sync/info` | api+sync | — | `ok`: boolean<br>`apiVersion`: integer=1<br>`device`: object{id,name}<br>`cursor`: integer<br>`eventCount`: integer<br>`eventTypes`: string[]<br>`authRequired`: boolean<br>`merge`: string | 401 unauthorized |
| GET | `/api/sync/events` | api+sync | query `since`: integer（默认 0，取 seq > since）；`limit`: integer（默认 500，clamp 1..1000） | `ok`: boolean<br>`apiVersion`: integer=1<br>`events`: syncEvent[]（见 models.json） | 401 unauthorized |
| POST | `/api/sync/events` | api+sync | body `events`: syncEvent[]（也接受直接把数组当 body；最多取前 200 条） | `ok`: boolean<br>`apiVersion`: integer=1<br>`accepted`: integer<br>`cursor`: integer<br>`eventCount`: integer<br>`duplicates`: integer | 401 unauthorized |

### 5.3 聊天 / 事件 / SSE（4 个）

聊天核心。发送是异步的：`POST /api/chat` 立即返回，回复由 `/api/stream` 推流、由 `/api/events?since=` 补齐。**不要用 EventSource**（token 模式没法带 header），用 fetch 流。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/events` | api | query `since`: integer（默认 0，只返回 id > since 且 !hidden 的消息） | `messages`: message[]（见 models.json）<br>`typing`: boolean<br>`lastTurnAt`: integer<br>`usage`: object&#124;null<br>`mode`: string | — |
| POST | `/api/chat` | api | body `text`: string（可与 images 二选一）；`images`: string[]（data:image/…;base64,…，只取第一张，≤8MB） | `ok`: boolean | 400 空消息<br>400 请求格式不正确<br>429 她还在说话 |
| POST | `/api/chat/cancel` | api | — | `ok`: boolean<br>`typing`: boolean | — |
| GET | `/api/stream` | api | — | `sse`: text/event-stream；每帧只有 `data: <json>\n\n`<br>`init`: {type:'init',active:boolean,text:string}（连接时）<br>`start`: {type:'start'}<br>`delta`: {type:'delta',text:string}（每帧约 3 个字符）<br>`done`: {type:'done'}<br>`message`: {type:'message'}（系统提示帧；当前唯一发送点是低余额提醒） | — |

### 5.4 角色 / 人设（5 个）

当前激活角色作用域。切换角色会重载消息/记忆；角色名/头像不要写死，一律读接口。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/characters` | api | — | `characters`: object[]{id,name,avatar}<br>`active`: string（当前角色 id） | — |
| POST | `/api/characters` | api | body `action`: string（switch=默认 &#124; new &#124; delete；未知值按 switch）；`id`: string（switch/delete 必填）；`name`: string（new 可选，默认「新角色」） | `switch`: ok,active,characters,character{id,name,avatar}<br>`new`: ok,id,characters,active<br>`delete`: ok,characters,active | 400 不能删默认角色<br>400 至少要留一个角色<br>400 非法的角色 id<br>404 没有这个角色<br>409 她还在说话，等这一轮结束再切角色 |
| GET | `/api/persona` | api | — | `meta`: characterMeta（见 models.json）<br>`body`: string（persona.md 全文）<br>`rev`: revisionRecord&#124;null<br>`personaRev`: revisionRecord&#124;null | — |
| POST | `/api/persona` | api | body `meta`: object（浅合并进现有 meta；avatar 会被丢弃）；`body`: string（人设正文全文）；`expectedRev`: integer（可选，实体 character 的 rev） | `ok`: boolean<br>`meta`: characterMeta<br>`body`: string<br>`rev`: revisionRecord&#124;null<br>`personaRev`: revisionRecord&#124;null | 409 版本冲突：数据已被修改，请刷新后再试（附 entity/id/expectedRev/currentRev） |
| POST | `/api/avatar` | api | body `dataUrl`: string（data:image/…;base64,…，≤3MB；不传=dataUrl 为空则删除头像） | `ok`: boolean<br>`avatar`: string（/avatar.png?t=…，仅上传成功时） | 400 不支持的图片格式<br>400 图片太大 |

### 5.5 记忆 / 日记（9 个）

记忆事实卡 + 日记。写操作建议带 `expectedRev` 防止旧页面覆盖新改动。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/memory` | api | — | `stats`: memoryStats<br>`params`: memoryParams<br>`facts`: memoryFact[]（未归档）<br>`archived`: memoryFact[]<br>`diaryDates`: string[]（YYYY-MM-DD）<br>`rev`: revisionRecord&#124;null | — |
| POST | `/api/memory/import` | api | body `text`: string（≤300000 字；支持纯文本/JSON/JSONL）；`opts`: object（可选，`splitOnComma` / `perLineOnly` / `maxLen` 8..200）；`importance`: number（0..1，默认 0.5）；`pinNew`: boolean（新事实是否置顶）；`expectedRev`: integer（可选） | `ok`: boolean<br>`total`: integer<br>`lineCount`: integer<br>`added`: integer<br>`merged`: integer<br>`stats`: memoryStats<br>`preview`: object[]（前 5 条） | 400 导入内容为空<br>400 没有解析出可用记忆（附 `emptyLines`/`lineCount`）<br>409 版本冲突（附 currentRev） |
| POST | `/api/memory/import/preview` | api | body `text`: string；`opts`: object（与 import 同一套规则） | `ok`: boolean<br>`total`: integer<br>`lineCount`: integer<br>`nonEmptyLines`: integer<br>`isJson`: boolean<br>`emptyLines`: integer[]（最多 20 个行号）<br>`preview`: string[]（前 5 条） | 400 内容为空 |
| POST | `/api/memory/pin` | api | body `id`: integer（事实 id）；`expectedRev`: integer（可选） | `ok`: boolean | 409 版本冲突（附 currentRev） |
| POST | `/api/memory/delete` | api | body `id`: integer（事实 id）；`expectedRev`: integer（可选） | `ok`: boolean | 409 版本冲突（附 currentRev） |
| POST | `/api/memory/params` | api | body `halfLifeDays`: number（0.5..365）；`forgetThreshold`: number（0.01..0.9）；`reinforceBoost`: number（0..1）；`maxInjected`: integer（0..100）；`coreStrength`: number（0.1..1）；`maxPromptChars`: integer（100..5000） | `ok`: boolean<br>`params`: memoryParams | — |
| GET | `/api/diary` | api | query `date`: string（**只接受 `YYYY-MM-DD`**；不传则返回日期列表） | `dates`: string[]（不带 date 时）<br>`date`: string（带 date 时）<br>`text`: string（日记正文，可能为空）<br>`exists`: boolean（这一天到底有没有日记） | 400 日期要写成 YYYY-MM-DD |
| POST | `/api/diary/generate` | api | — | `ok`: boolean<br>`text`: string（生成失败为 ''，仍是 200） | — |
| POST | `/api/diary/show` | api | — | `ok`: boolean | 200 今天还没写日记（ok:false） |

### 5.6 舞台 / 地图 / 场景 / 地点（25 个）

舞台/地图/场景/地点。坐标都是 0..1 归一化；地图保存是「传了才改」，`places` 是整体替换。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/stage` | api | — | stagePayload（角色/地图/位置/天气/钱包/设置/动画提示；见 models.json） | — |
| GET | `/api/stage/stream` | api | — | `sse`: text/event-stream；连接即推一帧，之后每 1000ms 推一帧；内容= /api/stage 的完整 payload；没有事件名 | — |
| GET | `/api/map` | api | — | `maps`: object[]{id,name,placeCount}<br>`activeMapId`: string<br>`map`: map（含 places/roads/vehicles/image/model）<br>`transports`: object（交通方式表）<br>`longTransports`: string[]<br>`capabilities`: object（出行能力）<br>`weather`: string（当前天气 kind，注意是字符串）<br>`weathers`: object<br>`energy`: integer<br>`location`: currentPlace<br>`schedules`: object[]（含 index/place） | — |
| POST | `/api/map` | api | body `mapId`: string（默认当前地图）；`expectedRev`: integer（可选，实体 maps:<当前角色 id> 的 rev）；`name`: string（≤20 字）；`widthMeters`: number（200..20000）；`transport`: string；`theme`: town&#124;coast&#124;city&#124;forest；`displayMode`: 2d&#124;3d；`roads`: array（[[x,y],…] 折线数组）；`vehicles`: object{car?,bicycle?}；`image`: object{url}&#124;null；`model`: object{url,scale,rotationY,yOffset}&#124;null；`has3d`: boolean；`places`: place[]（整体替换；≤40 个，字段会 clamp/normalize）；`schedules`: object[]{index,place} | `ok`: boolean<br>`current`: currentPlace（保存后的位置） | 404 没有这张地图<br>409 版本冲突（附 currentRev） |
| POST | `/api/map/create` | api | body `name`: string（默认「新地图」，≤20 字） | `ok`: boolean<br>`id`: string<br>`maps`: object[]{id,name,placeCount} | — |
| POST | `/api/map/delete` | api | body `id`: string（地图 id） | `ok`: boolean | 400 至少保留一张地图 |
| POST | `/api/map/activate` | api | body `id`: string（目标地图 id）；`mode`: string（交通方式，可选）；`instant`: boolean（瞬移，不计算长途）；`confirmNight`: boolean（夜间出门确认） | `ok`: boolean<br>`location`: currentPlace（跨图时可能先返回 intercity 行程） | 200 ok:false + refused:true（needsConfirm/reason/location） |
| POST | `/api/map/import` | api | body `mapId`: string（默认当前地图）；`content`: string（JSON 数组/对象，或每行逗号/制表符分隔：名字,图标,x,y,描述,感受） | `ok`: boolean<br>`added`: integer<br>`skipped`: integer<br>`total`: integer<br>`places`: place[] | 400 JSON 解析失败 |
| POST | `/api/map/image` | api | body `mapId`: string（默认当前地图）；`dataUrl`: string（≤12MB；不传则清空 2D 底图） | `ok`: boolean<br>`url`: string（/models/map-*；清空时为空串） | 400 不支持的图片格式/图片太大 |
| GET | `/api/map/preview` | api | query `mapId`: string（默认当前地图） | `ok`: boolean<br>`map`: map（完整）<br>`activeMapId`: string<br>`maps`: object[]{id,name,placeCount,image}<br>`location`: currentPlace | 404 没有这张地图 |
| POST | `/api/place/image` | api | body `mapId`: string（默认当前地图）；`placeId`: string（必填）；`dataUrl`: string（≤6MB；不传则清空） | `ok`: boolean<br>`image`: string（/models/place-*，清空时为空串）<br>`places`: place[]（该地图全量地点） | 400 不支持的图片格式/图片太大<br>404 地点不存在 |
| POST | `/api/scene/image` | api | body `dataUrl`: string（≤12MB） | `ok`: boolean<br>`url`: string（/models/scene-*） | 400 不支持的图片格式/图片太大 |
| GET | `/api/scene/settings` | api | — | `ok`: boolean<br>`ai`: boolean<br>`photoChance`: number（0..1）<br>`minGapMinutes`: integer=5<br>`cacheMinutes`: integer=10 | — |
| POST | `/api/scene/settings` | api | body `ai`: boolean；`photoChance`: number（0..1，会被 clamp） | `ok`: boolean<br>`ai`: boolean<br>`photoChance`: number | — |
| GET | `/api/scene/activity` | api | query `character`: string（角色 id，默认当前角色）；`placeId`: string（必填）；`hotspotId`: string（可选，也可传 hotspot label） | `ok`: boolean<br>`text`: string<br>`source`: string（ai&#124;local）<br>`cached`: boolean（命中缓存时） | 404 地点不存在 |
| POST | `/api/scene/focus` | api | body `placeId`: string（传空=清除）；`hotspotId`: string（可选） | `ok`: boolean<br>`focus`: object{mapId,placeId,placeName,hotspotId,hotspotLabel,at}&#124;null | 404 地点不存在 |
| GET | `/api/world/characters` | api | — | `characters`: worldCharacter[]（见 models.json）<br>`activeMapId`: string | — |
| GET | `/api/travel/options` | api | — | `ok`: boolean<br>`from`: object{id,name}<br>`wallet`: walletMoney()<br>`options`: object[]{id,name,km,modes[]{mode,label,icon,fare,minutes,canAfford,nextDeparture,waitMinutes,delayMinutes}} | — |
| POST | `/api/travel/ticket` | api | body `mapId`: string（目标地图）；`mode`: string（coach&#124;rail&#124;plane）；`waitMinutes`: number（0..1440）；`delayMinutes`: number（0..1440） | `ok`: boolean<br>`location`: currentPlace（成功后进入 intercity 行程） | 200 ok:false + refused:true + reason + location |
| GET | `/api/routine` | api | — | `routine`: object{bands[],smart}<br>`visits`: object{placeId:{count,lastAt}}<br>`places`: object[]{id,name,icon}<br>`character`: string | — |
| POST | `/api/routine` | api | body `bands`: object[]{start,end,allowed,weights{placeId:weight}}（≤16 段，会排序/裁剪）；`smart`: boolean | `ok`: boolean<br>`routine`: object{bands,smart} | — |
| GET | `/api/location` | api | — | `location`: currentPlace（fields: mapId,mapName,placeId,name,icon,desc,feel,since,minutes,manual,reason,traveling,intercity,avatar） | — |
| POST | `/api/location` | api | body `placeId`: string（目标地点）；`mapId`: string（可选，默认当前地图）；`mode`: string（交通方式）；`instant`: boolean（瞬移）；`confirmNight`: boolean（夜间出门确认） | `ok`: boolean<br>`location`: currentPlace（行程中 traveling 有值） | 200 ok:false + refused:true（needsConfirm/reason/location） |
| GET | `/api/stage/poses` | api | — | `ok`: boolean<br>`current`: string<br>`characters`: object[]{id,poses[],current}（poses=idle/walkA/walkB/wave/stretch/sleepy/happy 子集） | 500 String(e.message) |
| POST | `/api/stage/import-poses` | api | body `charId`: string（可选，默认当前角色）；`files`: object[]{name,w,h,dataUrl}（name 必须是 7 个姿态名之一；同尺寸；png/jpeg/webp；单张 ≤8MB） | `ok`: boolean<br>`charId`: string<br>`saved`: string[]<br>`poses`: string[] | 400 角色 id 不合法 / 没有收到图片 / 不是合法 dataURL / 只支持 png/jpg/webp / 超过 8MB / 缺少宽高信息 / 所有姿态图必须同尺寸 / 文件名要叫 idle…happy |

### 5.7 生活 / 天气 / 日常（20 个）

生活模拟与天气。`/api/life`（生活配置）与 `/api/life/settings`（生活模拟设置）是两个不同对象，别混。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/life` | api | — | `life`: lifeConfig（见 models.json：enabled/proactive*/quiet*/diary*/schedules/activities…） | — |
| POST | `/api/life` | api | body `patch`: object（任意 life 字段，浅合并；没有字段校验） | `ok`: boolean<br>`life`: lifeConfig（合并后的完整对象） | — |
| POST | `/api/life-tick` | api | — | `ok`: boolean<br>`place`: currentPlace | — |
| POST | `/api/proactive/test` | api | — | `ok`: boolean<br>`text`: string（生成的主动消息） | 500 生成失败 / String(e.message) |
| GET | `/api/life/settings` | api | — | `ok`: boolean<br>`settings`: lifeSimSettings（见 models.json） | — |
| POST | `/api/life/settings` | api | body `enabled`: boolean；`minEventGapMin`: number（5..720）；`maxDaily`: number（0..100）；`quietStart`: number（0..23）；`quietEnd`: number（0..23）；`photoChance`: number（0..1） | `ok`: boolean<br>`settings`: lifeSimSettings | — |
| GET | `/api/life/state` | api | query `character`: string（角色 id，默认当前角色） | `ok`: boolean<br>`state`: lifeState（见 models.json） | 404 角色不在任何地点 |
| GET | `/api/life/states` | api | — | `ok`: boolean<br>`states`: lifeState[] + {name,avatar} | — |
| POST | `/api/life/act` | api | body `characterId`: string（可选）；`placeId`: string（必填）；`hotspotId`: string（可选） | `ok`: boolean<br>`state`: lifeState | 404 地点或热点不存在 |
| POST | `/api/life/position` | api | body `characterId`: string（可选）；`x`: number（0..1）；`y`: number（0..1） | `ok`: boolean<br>`state`: lifeState | 404 没有生活状态 |
| POST | `/api/life/tick` | api | query `character`: string（角色 id，可选） | `ok`: boolean<br>`state`: lifeState | 500 String(e.message) |
| POST | `/api/life/social` | api | — | `ok`: boolean<br>`result`: object（随机社交事件结果） | 500 String(e.message) |
| POST | `/api/life/test-image` | api | body `characterId`: string（可选）；`imagePrompt`: string（≤800 字，默认「日常手机美食照片…」）；`withIdentity`: boolean（是否带角色头像做参考）；`message`: string（≤120 字配文） | `ok`: boolean<br>`image`: string（/images/img-*）<br>`text`: string（配文） | 500 生图失败原因 |
| GET | `/api/weather` | api | — | `mode`: real&#124;manual<br>`manual`: string（手动 kind）<br>`kind`: string（sunny/cloudy/rain/snow/hot/cold/windy）<br>`label`: string<br>`icon`: string<br>`temp`: number&#124;null<br>`city`: string&#124;null<br>`source`: real&#124;manual<br>`weathers`: object<br>`fx`: object | — |
| POST | `/api/weather` | api | body `mode`: real&#124;manual；`manual`: string（weather kind）；`refresh`: boolean（真实天气强制刷新） | `ok`: boolean<br>`mode`: string<br>`kind`: string<br>`temp`: number&#124;null<br>`city`: string&#124;null<br>`source`: string | — |
| GET | `/api/weatherfx` | api | — | `ok`: boolean<br>`fx`: object（{kind:{type:'image'&#124;'video',url,opacity}}）<br>`kinds`: string[]（7 种天气） | — |
| POST | `/api/weatherfx` | api | body `kind`: string（天气 kind，必填）；`type`: image&#124;video；`url`: string；`opacity`: number（0.05..1）；`clear`: boolean（清除该天气特效） | `ok`: boolean<br>`fx`: object（当前 fx 表） | 400 未知天气 |
| POST | `/api/weatherfx/upload` | api | body `kind`: string（天气 kind）；`dataUrl`: string（≤20MB；png/jpeg/webp/gif） | `ok`: boolean<br>`fx`: object（该天气的 fx 项） | 400 未知天气/不支持的图片格式/图片太大 |
| GET | `/api/watch-screen` | api | — | `ok`: boolean<br>`watch`: object{enabled,minMinutes,maxMinutes,nextAt} | — |
| POST | `/api/watch-screen` | api | body `enabled`: boolean；`minMinutes`: number（5..120）；`maxMinutes`: number（10..240） | `ok`: boolean<br>`watch`: object{enabled,minMinutes,maxMinutes,nextAt} | — |

### 5.8 经济 / 钱包（6 个）

钱包/经济。注意 §4.3 的 200+ok:false；`realBalance` 来自 DeepSeek 余额接口，可能为 null/旧值。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/economy` | api | — | `ok`: boolean<br>`economy`: economy（见 models.json）<br>`realBalance`: object&#124;null（DeepSeek 余额）<br>`balanceAlert`: object{enabled,thresholdRmb,cooldownMin,lastAt}<br>`wallet`: walletSummary | — |
| POST | `/api/economy` | api | body `initialBalance`: number；`dailyIncome`: number；`wagePerHour`: number；`mealCost`: number；`entertainmentCost`: number；`tokenBudget`: number；`tokensPerYuan`: number；`enabled`: boolean；`moneyType`: virtual&#124;token；`tokenMode`: boolean | `ok`: boolean<br>`economy`: economy<br>`wallet`: walletSummary | — |
| POST | `/api/wallet/spend` | api | body `amount`: number（正数）；`item`: string（花钱的理由） | `ok`: boolean（=花费是否成功）<br>`result`: object（成功 {ok:true,left,why}；失败 {ok:false,reason,left}）<br>`wallet`: walletSummary | — |
| GET | `/api/balance-alert` | api | — | `ok`: boolean<br>`alert`: object{enabled,thresholdRmb,cooldownMin,lastAt}<br>`balance`: object（DeepSeek 余额） | — |
| POST | `/api/balance-alert` | api | body `enabled`: boolean；`thresholdRmb`: number（≥0）；`cooldownMin`: number（1..10080） | `ok`: boolean<br>`alert`: object | — |
| POST | `/api/balance-alert/test` | api | — | `ok`: boolean<br>`total`: number<br>`threshold`: number<br>`text`: string | 500 String(e.message) |

### 5.9 设置 / 模型 / 环境 / 外观（36 个）

设置类。密钥类字段只写不读（`apiKeySet` 布尔）；数值字段会被 clamp。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/model` | api | — | `model`: modelConfig{name,reasoningEffort,temperature,maxTokens,maxSteps}<br>`usage`: object&#124;null | — |
| POST | `/api/model` | api | body `name`: string；`reasoningEffort`: low&#124;medium&#124;high&#124;max；`temperature`: number（0..1.5）；`maxTokens`: integer（200..8000）；`maxSteps`: integer（4..60） | `ok`: boolean<br>`model`: modelConfig | — |
| POST | `/api/model/key` | api | body `key`: string（长度 ≥10；只写不读） | `ok`: boolean | 400 API Key 太短<br>500 保存失败 |
| GET | `/api/context` | api | — | `context`: contextConfig{historyMode,memoryInject}<br>`historyKeep`: integer=10<br>`summary`: object{text,upto} | — |
| POST | `/api/context` | api | body `historyMode`: full&#124;short&#124;off&#124;compact&#124;minimal；`memoryInject`: integer（2..20） | `ok`: boolean<br>`context`: contextConfig | — |
| GET | `/api/mode` | api | — | `override`: auto&#124;chat&#124;full<br>`detected`: object{screen,phone,detected}<br>`effective`: chat&#124;full | — |
| POST | `/api/mode` | api | body `override`: auto&#124;chat&#124;full | `ok`: boolean<br>`override`: string<br>`detected`: object<br>`effective`: string | — |
| GET | `/api/env` | api | — | `env`: envConfig{pc,space,phone,confirmDanger,selfStart}<br>`resources`: object{space,phone,mem} | — |
| POST | `/api/env` | api | body `pc`: off&#124;gui&#124;code；`space`: off&#124;gui&#124;code；`phone`: off&#124;gui&#124;code；`confirmDanger`: boolean；`selfStart`: allow&#124;deny | `ok`: boolean<br>`env`: envConfig | — |
| POST | `/api/env/start-all` | api | — | `ok`: boolean<br>`message`: string | — |
| POST | `/api/env/install-adbkeyboard` | api | — | `ok`: boolean<br>`steps`: string[]（install/ime enable/ime set/show_ime 结果） | 500 没找到 ADBKeyboard.apk / 手机没开机 |
| GET | `/api/image/config` | api | — | `ok`: boolean<br>`config`: imageConfig{provider,baseURL,model,size,watermark,enabled,apiKeySet} | — |
| POST | `/api/image/config` | api | body `provider`: string；`baseURL`: string；`model`: string；`size`: string；`watermark`: boolean；`enabled`: boolean；`apiKey`: string（只写） | `ok`: boolean<br>`config`: imageConfig | — |
| GET | `/api/token-saving` | api | — | `saving`: object{dynamicTools,compressImage,batchActions} | — |
| POST | `/api/token-saving` | api | body `dynamicTools`: boolean；`compressImage`: boolean；`batchActions`: boolean | `ok`: boolean<br>`saving`: object | — |
| GET | `/api/chat-style` | api | — | `ok`: boolean<br>`style`: object{noParens} | — |
| POST | `/api/chat-style` | api | body `noParens`: boolean | `ok`: boolean<br>`style`: object{noParens} | — |
| GET | `/api/ui-theme` | api | — | `ok`: boolean<br>`current`: string<br>`themes`: object[]{id,name,colors} | — |
| POST | `/api/ui-theme` | api | body `id`: string（themes[].id） | `ok`: boolean<br>`current`: string<br>`themes`: object[] | 400 没有这个配色 |
| GET | `/api/panel-theme` | api | — | `ok`: boolean<br>`current`: object{mode,accent}<br>`modes`: string[]<br>`accents`: string[] | — |
| POST | `/api/panel-theme` | api | body `mode`: follow&#124;light&#124;dark（可选）；`accent`: string（accents[] 里的 id，可选） | `ok`: boolean<br>`current`: object{mode,accent} | 400 没有这个配色模式<br>400 没有这个强调色 |
| GET | `/api/voice/settings` | api | — | `ok`: boolean<br>`settings`: voiceConfig{enabled,provider,voice,speed,pitch,format,maxChars,endpoint,method,headers,apiKeyRef}<br>`providers`: object[]{id,name,needsEndpoint}<br>`defaults`: voiceConfig<br>`cache`: object{count,total,removed}<br>`character`: string<br>`hasKey`: boolean | — |
| POST | `/api/voice/settings` | api | body `enabled`: boolean?；`provider`: sapi&#124;http?；`voice`: string?；`speed`: number(0.5..2)?；`maxChars`: number(20..2000)?；`endpoint`: string?；`method`: POST&#124;PUT?；`headers`: object?；`apiKeyRef`: string（只接受 `env:` / `file:`，其它置空）?；`characterId`: string?（写了就存每角色覆盖） | `ok`: boolean<br>`settings`: voiceConfig | — |
| POST | `/api/voice/tts` | api | body `text`: string（≤4000，内部再按 `maxChars` 截断） | `ok`: boolean<br>`audio`: string（`/voice/audio/<file>`）<br>`cached`: boolean<br>`provider`: sapi&#124;http<br>`duration`: number?（wav 可算）<br>`error`: string（ok=false 时） | 400 没有要念的文字<br>200 + `ok:false` 合成失败 |
| POST | `/api/voice/preview` | api | body `text`: string?（默认「你好，我是<角色名>…」） | 同 `/api/voice/tts` | — |
| POST | `/api/voice/cleanup` | api | — | `ok`: boolean<br>`cache`: object{count,total,removed} | — |
| GET | `/api/watch-screen` | api | — | `ok`: boolean<br>`watch`: object{enabled,voice,minMinutes,maxMinutes,quietStart,quietEnd,nextAt,lastAt}<br>`voiceEnabled`: boolean<br>`autoVoiceActive`: boolean<br>`debug`: object{checkedAt,why} | — |
| POST | `/api/watch-screen` | api | body `enabled`: boolean?；`voice`: boolean?；`minMinutes`: number(5..120)?；`maxMinutes`: number(10..240)?；`quietStart`/`quietEnd`: number(0..23)? | `ok`: boolean<br>`watch`: object | — |
| GET | `/api/chat-bg` | api | — | `ok`: boolean<br>`current`: string<br>`options`: object[]{id,name,url} | — |
| POST | `/api/chat-bg` | api | body `id`: string（options[].id 或 custom） | `ok`: boolean<br>`current`: string<br>`options`: object[] | 400 还没有自定义背景<br>400 没有这张背景 |
| POST | `/api/chat-bg/upload` | api | body `image`: string（data:image/jpeg&#124;jpg&#124;png&#124;webp;base64,…，≤10MB） | `ok`: boolean<br>`current`: string<br>`options`: object[] | 400 请上传 jpg/png/webp 图片<br>400 图片太大（最大 10MB） |
| GET | `/api/chat-bg/custom` | api | — | `binary`: 图片二进制（image/jpeg&#124;png&#124;webp） | 404 no custom background（text/plain） |
| POST | `/api/preview` | api | body `text`: string（用户台词，默认「在吗」） | `ok`: boolean<br>`text`: string（她的预览回复） | — |
| GET | `/api/tutorial` | api | — | `text`: string（tutorial.md 全文 Markdown） | — |
| GET | `/api/paint` | api | — | `ok`: boolean<br>`paint`: object{enabled,image}（image 为空串=用内置底） | — |
| POST | `/api/paint` | api | body `enabled`: boolean?；`dataUrl`: string?（≤10MB，上传自定义背景）；`image`: string?（只接受 /models/ /assets/ /images/ 开头的受控路径）；`clearImage`: boolean? | `ok`: boolean<br>`paint`: object{enabled,image} | 400 不支持的图片格式/图片太大<br>500 String(e.message) |

> 分组边界说明：本文 §5.7 与 §5.9 的划分和 `api-index.json` 的 `life` / `settings` 组不完全相同（例如 `watch-screen` 在索引里归 `life`，在本文放在「设置」）。**端点总数以 §5 标题为准**，分组只是可读性，机器核对按路径集合做，不按分组计数。

### 5.10 她的屏幕 / 手机 / 环境进程（9 个）

她的屏幕/手机。**面板禁止内嵌 iframe**：`spaceUrl` 交给系统浏览器；截图接口返回二进制，不是 JSON。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/screen/info` | api | — | `ok`: boolean<br>`spaceUrl`: string（noVNC 地址，交给系统浏览器打开）<br>`pc`: boolean=true<br>`phone`: boolean=true | — |
| GET | `/api/screen/pc` | api | — | `binary`: PNG/JPEG 截图 | 503 桌面内核没在运行，兜底截图也失败了（text/plain） |
| GET | `/api/screen/phone` | api | — | `binary`: PNG 截图 | 503 手机截图失败 / 手机不可用（text/plain） |
| GET | `/api/screen/space/status` | api | — | `ok`: boolean<br>`vm`: boolean<br>`http`: boolean（真实链路：x11vnc+websockify+6080）<br>`chain`: object&#124;null<br>`healing`: boolean<br>`url`: string（noVNC） | — |
| POST | `/api/screen/space/ensure` | api | — | `ok`: boolean<br>`vm`: boolean<br>`http`: boolean<br>`ensured`: string&#124;null；VM 没开时返回 {ok:false,starting:true,vm:false,http:false,message} | — |
| POST | `/api/space/start` | api | — | `ok`: boolean<br>`starting`: boolean<br>`message`: string；内存不足时 {ok:false,refused:true,error,freeMB,message} | 500 String(e.message) |
| POST | `/api/space/stop` | api | — | `ok`: boolean<br>`stopping`: boolean<br>`message`: string | 500 String(e.message) |
| POST | `/api/phone/start` | api | — | `ok`: boolean<br>`starting`: boolean<br>`message`: string；内存不足时 ok:false+refused | 500 String(e.message) |
| POST | `/api/phone/stop` | api | — | `ok`: boolean<br>`stopping`: boolean<br>`message`: string | 500 String(e.message) |

### 5.11 VM 聊天（虚拟机里的聊天软件）（6 个）
VM（虚拟机）里的聊天软件控制。`/check`、`/send` 会真的操作虚拟机，属于高成本操作。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/vm-chat/settings` | api | — | `ok`: boolean<br>`settings`: vmChatSettings（enabled/checkMessages/autoStart/idleShutdown/checkIntervalMin/targetContact/unreadScan/watchdog/sendImages + 运行附加字段） | — |
| POST | `/api/vm-chat/settings` | api | body `enabled`: boolean；`checkMessages`: boolean；`autoStart`: boolean；`idleShutdown`: boolean；`checkIntervalMin`: number（2..1440）；`targetContact`: string（≤60 字）；`unreadScan`: boolean；`watchdog`: boolean；`sendImages`: boolean | `ok`: boolean<br>`settings`: vmChatSettings | — |
| GET | `/api/vm-chat/status` | api | — | `ok`: boolean<br>`status`: vmChatStatus{running,apps[],last} | 500 String(e.message) |
| POST | `/api/vm-chat/wake` | api | — | `ok`: boolean（是否唤醒成功）<br>`running`: boolean | 500 String(e.message) |
| POST | `/api/vm-chat/check` | api | — | `ok`: boolean<br>`result`: object（VM_CHAT.checkAndReply 结果：unread/recent/sent/requiresLogin…） | 500 String(e.message) |
| POST | `/api/vm-chat/send` | api | body `text`: string；`imagePath`: string（可选，只允许 <数据根>/data/images 下的文件名） | `ok`: boolean<br>`result`: object（发送结果：sentAt/verify/analysis…） | 400 图片路径不允许（只允许 data/images 下的文件）<br>501 当前运行时还不支持图片发送<br>500 String(e.message) |

### 5.12 桌宠（独立 WPF 进程）（11 个）

桌宠是独立 WPF 进程，面板只做开关/状态。`/api/pet/status` 适合高频轮询（桌宠 700ms 级）。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/pet` | api | — | `ok`: boolean<br>`running`: boolean<br>`pid`: integer<br>`pet`: petConfig | — |
| POST | `/api/pet` | api | body `enabled`: boolean；`image`: string；`size`: number；`opacity`: number；`statusText`: boolean；`alwaysOnTop`: boolean；`gestures`: object[]；`buttons`: object[]；`expressions`: object | `ok`: boolean<br>`pet`: petConfig<br>`running`: boolean<br>`action`: string（saved&#124;started&#124;start-failed&#124;stopped） | — |
| POST | `/api/pet/image` | api | body `dataUrl`: string（png/jpeg/webp，≤8MB） | `ok`: boolean<br>`image`: string（<数据根>/pet/avatar-custom.<ext> 绝对路径） | 400 需要 png/jpeg/webp 图片 / 图片太大（8MB 以内）<br>500 String(e.message) |
| POST | `/api/pet/start` | api | — | `ok`: boolean<br>`running`: boolean<br>`pid`: integer<br>`already`: boolean（可选） | 500 缺少 runtime/pet/pet.ps1 / String(e.message) |
| POST | `/api/pet/stop` | api | — | `ok`: boolean<br>`running`: boolean | — |
| POST | `/api/pet/act` | api | body `action`: look&#124;chat&#124;gesture；`gestureId`: string（`gestures[].id`）；`prompt`: string（自定义提示词） | `ok`: boolean<br>`action`: string<br>`prompt`: string | 400 缺少 prompt<br>429 她还在说话 |
| GET | `/api/pet/manifest` | api | — | `ok`: boolean<br>`pet`: petConfig<br>`status`: petStatus（同 /api/pet/status） | — |
| GET | `/api/pet/status` | api | — | petStatus（见 models.json） | — |
| GET | `/api/pet/avatar` | api | — | `binary`: 头像图片（png/jpeg/webp） | 404 no avatar（text/plain） |
| GET | `/api/pet/cache` | api | — | `ok`: boolean<br>`dir`: string<br>`count`: integer<br>`bytes`: integer<br>`removable`: integer<br>`removableBytes`: integer<br>`current`: object（角色 → 当前素材 stamp） | — |
| POST | `/api/pet/cache/clean` | api | — | `ok`: boolean<br>`removed`: integer<br>`removedBytes`: integer<br>`stats`: object（同 `/api/pet/cache`） | 500 String(e.message) |

> `/api/pet/cache*` 是 0.8.11 的桌宠立绘缓存清理入口：只处理 `<数据根>/data` 与 `<数据根>` 下的 `sprite-*.png`，保留当前 stamp 和最近 10 分钟文件。

### 5.13 备份 / 恢复（5 个）

备份/恢复。恢复会覆盖当前数据，必须二次确认；恢复前会自动再备份一次，恢复后要重启 DSH 让运行时重新加载。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| POST | `/api/backup` | api | — | `ok`: boolean<br>`name`: string（新建的备份名 backup-YYYYMMDD-HHMMSS）<br>`dir`: string（备份目录）<br>`message`: string | 500 备份失败原因 |
| POST | `/api/backup/delete` | api | body `name`: string（backup-YYYYMMDD-HHMMSS.zip） | `ok`: boolean<br>`name`: string<br>`removedBytes`: integer | 400 备份名不合法<br>404 找不到这个备份<br>500 删除失败：String(e.message) |
| GET | `/api/backup/list` | api | — | `ok`: boolean<br>`dir`: string（备份目录绝对路径）<br>`backups`: object[]{name,size,at}（最多 30 条，倒序） | 500 String(e.message) |
| POST | `/api/backup/inspect` | api | body `name`: string（backup-YYYYMMDD-HHMMSS.zip） | `ok`: boolean<br>`zipMB`: number<br>`at`: integer<br>`hasManifest`: boolean<br>`backup`: object{fileCount,pluginFiles,dataFiles,dataMB,characters[]}<br>`current`: object{characters[]}<br>`onlyInBackup`: string[]<br>`onlyNow`: string[]<br>`configOverwritten`: boolean | 400 备份名不合法<br>404 找不到这个备份<br>500 String(e.message) |
| POST | `/api/backup/restore` | api | body `name`: string（backup-YYYYMMDD-HHMMSS.zip） | `ok`: boolean<br>`message`: string<br>`safetyBackup`: string（恢复前自动留的当前状态备份名）<br>`output`: string（恢复脚本输出尾部 ≤1500 字） | 400 备份名不合法<br>404 找不到这个备份<br>500 安装包缺少 scripts/restore.ps1 / String(e.message) |

> `/api/backup/inspect` 是**只读差异预览**（读 zip 里的 `manifest.json`，不写盘），用于恢复前告诉用户「会覆盖掉什么、哪些角色会多出来 / 消失」。备份属于桌面端能力，手机端不要调。

### 5.14 聊天软件直连 / 插件更新 / 余额刷新（13 个）

这一组是 0.7.24 新增、`apiVersion` 仍为 2 的向后兼容端点。**明细只在 §13 维护一份**（避免两处各写一份然后走样），这里只占位说明它计入总数。

| 能力 | 端点 | 明细 |
|---|---|---|
| OneBot 11 直连（设置/状态/朋友/发送/测试/上报） | `/api/direct-chat/*`（9 个） | [§13](#13-0724-新增端点向后兼容) |
| 插件更新（检查/执行/设置） | `/api/update/*`（3 个） | [§13](#13-0724-新增端点向后兼容) |
| 真实余额强制刷新 | `POST /api/balance/refresh`（1 个） | [§13](#13-0724-新增端点向后兼容) |

> 手机端**不依赖**这一组：直连、更新、余额刷新都是桌面端能力；写进契约只是为了「数得清、机器能索引」。

### 5.15 手机连接（局域网 + TLS + 配对 + 设备凭证）（8 个）

桌面端为手机客户端准备的那一层（0.8.10）。**主服务仍然只听 `127.0.0.1`**；只有显式开启后，才额外在 `0.0.0.0:8920`（默认）起一个 **HTTPS 网关**。网关只做四件事：认证、授权、限流、审计，然后把请求原样转发给回环主服务——业务逻辑不复制，权限收紧不会和业务走样。

| 方法 | 路径 | 鉴权 | 入参 | 出参要点 | 主要错误 |
|---|---|---|---|---|---|
| GET | `/api/mobile-gate/status` | api（回环） | — | `enabled`<br>`port`<br>`tls`（恒 true）<br>`fingerprint`<br>`addresses`: object[]{iface,ip,url}<br>`allow`: string[]<br>`devices`: object[]{id,name,scope,createdAt,lastSeenAt,revokedAt,lastIp}<br>`requests`/`denied` | 500 手机门模块不可用 |
| POST | `/api/mobile-gate/enable` | api（回环） | body `enabled`: boolean（默认 true）；`port`: integer（1024..65535，默认 8920）；`tls`: boolean（传 false 直接 400） | `ok`<br>`port`<br>`host`<br>`fingerprint`<br>`addresses`<br>`enabled` | 400 不允许明文：手机连接必须走 TLS<br>500 端口被占用 / 证书加载失败 |
| POST | `/api/mobile-gate/pair-code` | api（回环） | — | `ok`<br>`code`: string（6 位，一次性）<br>`expiresAt`: integer<br>`ttlMs`: integer | 500 同时最多 5 个未使用配对码 |
| POST | `/api/mobile-gate/pair` | 配对码（HTTPS 网关；回环也可，便于调试） | body `code`: string；`deviceName`: string（≤40 字）；`scope`: chat&#124;readonly | `ok`<br>`deviceId`<br>`token`: string（**只返回这一次**）<br>`fingerprint`<br>`allow`: string[] | 401 配对码不对/过期/已用过<br>429 配对尝试太频繁（同 IP 5 次 / 5 分钟） |
| GET | `/api/mobile-gate/self` | 设备令牌（**只在 HTTPS 网关上**） | — | `device`: object{id,name,scope}<br>`version`<br>`fingerprint` | 401 没配对/令牌失效 |
| GET | `/api/mobile-gate/devices` | api（回环） | — | `devices`: object[]（脱敏，不含摘要） | — |
| POST | `/api/mobile-gate/revoke` | api（回环） | body `deviceId`: string；或 `all`: boolean=true | `ok`<br>`devices`: object[]<br>`revoked`: integer（all 时） | 200 ok:false 没有这台设备 |
| GET | `/api/mobile-gate/audit` | api（回环） | query `limit`: integer（1..200，默认 50） | `entries`: object[]{at,type,deviceId?,name?,ip?,method?,path?,reason?,fingerprint?} | — |

**手机端能做什么**（网关的放行表；`status.allow` 与配对结果里的 `allow` 都是这一份）：`GET` `/api/version`、`/api/status`、`/api/events`、`/api/stream`、`/api/characters`、`/api/persona`、`/api/stage`、`/api/stage/stream`、`/api/location`、`/api/life/state`、`/api/life/states`、`/api/economy`、`/api/diary`、`/api/memory`、`/api/world/characters`；`POST` `/api/chat`、`/api/chat/cancel`；以及静态图片/语音（`/images/*`、`/models/*`、`/avatar.png`、`/voice/audio/*`）。另外 `/api/mobile-gate/self` 对已配对设备开放（只回它自己）。

**手机网页版（0.8.11）**：网关还在根路径直接提供一页手机网页，浏览器打开 `https://<地址>:<端口>/` 即可用，不用装 App：

| 路径 | 类型 | 说明 |
|---|---|---|
| `/`、`/index.html` | text/html | 手机页（配对 + 聊天 + 状态）。**公开**（任何人可加载），但限流 120 次/分钟/IP；带 `Content-Security-Policy: default-src 'self'`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`；**页面里不含任何令牌** |
| `/app.css`、`/app.js` | text/css、text/javascript | 同上，同源静态资源 |

页面内做配对（调 `POST /api/mobile-gate/pair`），令牌存在该页面的 `localStorage`；页面顶部常驻「🧪 手机端 · 正在研究（内部测试版）」标识。**注意**：网页版只是众多形态之一，不是最终产品形态。

**默认拒绝**：设置（`/api/model`、`/api/env`、`/api/paint`…）、备份/恢复、她的屏幕/手机、桌宠、VM 聊天、地图编辑 —— 手机一律 403（`手机端没有这个权限：<method> <path>`），并记 `perm.deny` 审计。

**红线**：
- 不提供明文模式；`tls:false` 直接 400。**没有 TLS 就不允许离开回环**。
- 不要把 8920 做路由器端口转发或公网暴露：这是**局域网内**的方案（MOBILE-GATE §4.4）。
- 令牌只在配对响应里出现一次，服务端只存 `sha256`；审计日志里没有明文令牌。
- 撤销立即生效（每次请求都查内存里的设备表），不需要重启。
- 配对码只在内存里，进程重启即失效；一次性、5 分钟过期、同 IP 5 次/5 分钟限流。

---

## 6. SSE 契约

服务端有两条 SSE（Server-Sent Events）流，格式相同：`Content-Type: text/event-stream; charset=utf-8`，`Cache-Control: no-cache`，`Connection: keep-alive`。

**帧格式只有一种**：

```
data: {"type":"delta","text":"你回来"}\n\n
```

- 没有 `event:` 命名事件，没有 `id:` 事件 id，没有 `retry:`，**没有心跳帧**。
- 每条 `data:` 后面是**单行 JSON**；空行分隔帧。
- 断线不会自动重连（服务端不发 retry），客户端必须自己重连并补齐状态。

### 6.1 `GET /api/stream`（聊天流式）

| 帧 | 时机 | 载荷 |
|---|---|---|
| `init` | 连接建立时立刻发一次 | `{"type":"init","active":<bool>,"text":<string>}`（当前是否在流式、已流出的文字，用于重连续接） |
| `start` | 她开始生成一段回复 | `{"type":"start"}` |
| `delta` | 生成过程中 | `{"type":"delta","text":"<约 3 个字符>"}`，约每 14ms 一帧 |
| `done` | 一段回复流完 | `{"type":"done"}` |
| `message` | 系统提示（**当前唯一发送点：低余额提醒**；她发新消息不会发这个帧） | `{"type":"message"}`（无其它字段，收到后应用 `/api/events?since=` 拉取） |

示例（连上时）：

```
data: {"type":"init","active":false,"text":""}
```

**客户端建议**：

1. 用 `fetch` 读流自己按 `\n\n` 切帧、`JSON.parse` 每帧 `data:` 后内容（浏览器 `EventSource` 不能带自定义 header，token 模式下会 401；原生客户端已封装 `Api.stream`）。
2. 收到 `start` 显示打字态，`delta` 追加流式气泡，`done` 清掉流式气泡并用 `/api/events?since=<lastId>` 拉正式消息（消息带 `uid`，可去重）。
3. 重连后先读 `init`：`active=true` 时把 `text` 作为已有流式内容，避免重复显示。
4. 没有任何事件时也要按 1~2 秒轮询 `/api/events?since=` 兜底（聊天历史是标准来源，SSE 只是加速）。

### 6.2 `GET /api/stage/stream`（舞台状态快照）

- 连接后**立刻**推一帧，之后每 **1000ms** 推一帧。
- 每帧都是**完整**的 `stagePayload`（与 `GET /api/stage` 同结构，见 §8.7）。
- 语义是「整帧替换」：直接覆盖本地状态，不做增量合并。
- 不需要事件名；断开后重新连即可，服务端有 1 秒缓存。

```bash
curl -N http://127.0.0.1:8900/api/stage/stream
# data: {"ok":true,"apiVersion":1,"serverTime":1794663467455,"character":{...},"map":{...},...}
```

> 移动端/省流客户端可以不用 SSE，直接 `GET /api/stage` 轮询（1~2 秒）成本相近。

---

## 7. 图片与静态资源

### 7.1 上传约定（data URL）

所有图片上传都是「JSON 里放 data URL 字符串」，正则形如 `^data:image/(png|jpeg|jpg|webp|gif);base64,(.+)$`（个别接口更严，见下表）：

```json
{ "dataUrl": "data:image/png;base64,iVBORw0KGgo..." }
```

| 接口 | 字段 | 大小上限 | 结果 URL |
|---|---|---|---|
| `POST /api/chat` | `images[0]` | 8MB | `/models/chat-*.png` |
| `POST /api/avatar` | `dataUrl` | 3MB | `/avatar.png?t=<ms>`（存为角色 `avatar.bin`） |
| `POST /api/scene/image` | `dataUrl` | 12MB | `/models/scene-*.{png,jpg,webp}` |
| `POST /api/map/image` | `dataUrl` | 12MB | `/models/map-*.{…}` |
| `POST /api/place/image` | `dataUrl` | 6MB | `/models/place-*.{…}` |
| `POST /api/weatherfx/upload` | `dataUrl` | 20MB | `/models/wxfx-<kind>-*.{…}` |
| `POST /api/pet/image` | `dataUrl` | 8MB | `<数据根>/pet/avatar-custom.<ext>`（绝对路径，不是 URL） |
| `POST /api/chat-bg/upload` | `image` | 10MB | 存 `<数据根>/data/chat-bg-custom.<ext>`，通过 `GET /api/chat-bg/custom` 读 |

两类 URL 不要混：

- **上传文件** → `<数据根>/models/` → URL `/models/…`
- **AI 生成的图**（`send_image` 工具、`/api/life/test-image`）→ `<数据根>/data/images/` → URL `/images/…`

### 7.2 静态资源路径

| 路径 | 内容 | 备注 |
|---|---|---|
| `GET /models/*` | `<数据根>/models/` 优先，回退 `runtime/models/` | 场景图、模型 `.glb/.gltf`、上传图；`..` 会被清掉 |
| `GET /images/*` | `<数据根>/data/images/` | AI 生成图；只取 basename |
| `GET /avatar.png?c=<角色 id>` | 指定角色头像；不带 `c` = 当前角色 | 无头像 404 |
| `GET /default-avatar.png` | 通用默认头像 | 404 表示没配置 |
| `GET /pet-sprite/<表情>.png` | 桌宠/舞台立绘（`idle/pat/rub/look`…） | 按当前角色目录查找并回退 default |
| `GET /api/pet/avatar` | 当前角色头像（JSON 接口的二进制版） | 无头像 404 text |
| `GET /chat-bg/<id>.jpg`、`/chat-bg.jpg` | 网页版聊天背景 | 原生面板用自己的背景 |
| `GET /official-map.jpg` | 官方地图底图 | 地图 `image.url` 默认值 |
| `GET /models/scenes/<地点>.jpg` | 13 个内置地点内部场景图 | 由 `place.scene.background` 引用 |
| `GET /voice/audio/<file>` | `<数据根>/voice/audio/` | 语音合成产物；文件名只接受 `40 位 sha1 + .wav/.mp3/.ogg/.m4a/.webm`，其它 404 |

### 7.3 缓存

- 图片接口基本是 `cache-control: no-store`；`/models/*`、`/vendor/*`、`/voice/audio/*` 是 `public, max-age=3600`（语音是 `604800`）；`/images/*`、`/avatar.png`、`/api/pet/avatar` 是 `no-store`；`/chat-bg/*`、`/official-map.jpg` 是 `public, max-age=86400`。
- 头像/角色列表会在 URL 带 `?t=<mtime/时间戳>` 做防缓存；客户端换图后自己加时间戳。
- 舞台/地图/场景图片路径约束：`place.image` 只接受 `/models/` 开头；`place.scene.background` 只接受 `/models/`、`/assets/`、`/images/` 开头；不符合会被**静默置空**（不是报错）。

### 7.4 聊天里的图片消息

- 消息对象上 `image` 字段是 URL（`/models/…` 或 `/images/…`），文本字段可能是 `[图片]` 占位。
- 图片不进模型上下文（服务端只把文字喂给模型）；客户端按普通 URL 渲染即可。

---

## 8. 数据模型

JSON Schema 见 [`schema/models.json`](./schema/models.json)（draft-07 简化版，`#/definitions/<name>`）。这里给字段速查和落盘位置。

### 8.0 数据根与文件布局

数据根默认 `%USERPROFILE%\.dsh-companion`（本机实际为 `D:\linzhi`，由 `LINZHI_ROOT` 指定）：

```
<数据根>/
  config.json                 设置类配置（模型/上下文/经济/生活/宠物/主题/图片反馈…）
  data/world.json             世界状态（地图/位置/worlds/activeMapId）
  data/characters/<角色id>/
    meta.json                 角色元数据
    persona.md                人设正文
    avatar.bin                头像
    messages.json             聊天记录（[{id,uid,role,text,at,image?,hidden?}]）
    summary.json              上下文摘要 {text,upto}
    routine.json              作息表
    state.json                体力 {energy,updatedAt}
    wallet.json               钱包 {balance,usedTokens,lastIncomeAt,lastWageAt}
    visits.json               地点访问统计
    life-state.json           生活模拟状态
    memory/facts.json         记忆事实卡
    diary/YYYY-MM-DD.md       日记
  data/images/                AI 生成图（/images/*）
  models/                     上传图与 .glb 模型（/models/*）
  sync/device.json            本机设备身份（deviceId/token，敏感）
  sync/events.jsonl           追加式事件日志
  sync/revisions.json         实体版本表
  api-key.txt                 DeepSeek Key（仅本机，可 DPAPI 加密）
  image-api-key.txt           图片反馈 Key（仅本机）
  pet.json                    用户自定义桌宠配置（优先级最高）
  backups/                    备份 zip
```

> 文件布局是**实现细节**：手机/第三方客户端只能通过 API 访问，**不得直接读写文件或依赖路径**（§9.2）。原生面板同样只走 API。

### 8.1 角色（role / character）

- 列表项：`{id, name, avatar}`；`GET /api/characters` 返回 `{characters, active}`。
- 元数据：`characterMeta`（name/userCall/relation/examples/traits/model/sprite/chibi/age/license/travelPref，见 models.json）。
- 人设正文：`GET /api/persona.body`（Markdown 全文）；写入用 `POST /api/persona`。
- 「role」在聊天里指消息的 `role`（`user`/`her`/`system`），不是角色实体。

### 8.2 消息（message）

```json
{ "id": 267, "uid": "4c4e2f50-…", "role": "her", "text": "（偏头）…", "at": 1794662800413 }
```

- `role`：`user`（用户）/ `her`（她）/ `system`（历史遗留，正常聊天不产生）。
- `image`：可选；用户上传是 `/models/…`，AI 生成是 `/images/…`。
- `hidden:true`：内部提示消息，不进 `/api/events`。
- `id` 角色内自增（轮询游标）；`uid` 跨端去重（手机同步用）。

### 8.3 记忆（memory）

- 事实卡：`memoryFact`（text/importance/strength/pinned/archived/tags/hitCount…）；相似事实自动合并强化，强度按半衰期衰减，低于阈值归档。
- 参数：`memoryParams`（halfLifeDays/forgetThreshold/reinforceBoost/maxInjected/coreStrength/maxPromptChars）。
- 统计：`memoryStats`（total/live/archived/core/strongest）。
- 日记：`<数据根>/data/characters/<id>/diary/YYYY-MM-DD.md`，`GET /api/diary` 读取。

### 8.4 生活（life）

三个容易混的对象：

| 对象 | 接口 | 内容 |
|---|---|---|
| 生活配置 `lifeConfig` | `GET/POST /api/life` | 开关、主动消息区间、免打扰时段、日记时间、作息表 `schedules[]`、活动池 `activities[]` |
| 生活模拟设置 `lifeSimSettings` | `GET/POST /api/life/settings` | enabled/minEventGapMin/maxDaily/quietStart/quietEnd/photoChance（会被 clamp） |
| 生活状态 `lifeState` | `GET /api/life/state(s)` | 当前行为（sleep/read/study/eat/coffee/phone/look/idle）、热点、场景内坐标、走位路径、体力、起止时间 |

### 8.5 钱包与经济

- `economy`：总开关、初始/每日收入、工资、饭钱娱乐钱、币种（`virtual`/`token`）、token 预算、交通价目表。
- `walletSummary`：`balance`（她的虚拟余额）、`spendable`、`tokenMode`、`remainingTokens`、`usedTokens`、`dailyUsed`、`tokenBudget`、`moneyType`、`realRmb`（真实人民币，可能 null）。
- `tokenStats`：`/api/status.tokens`、`/api/pet/status.tokens` 用的摘要（同上 + `deepseekBalance`）。

### 8.6 地图 / 地点 / 场景

```
map = { id, name, places[], widthMeters, transport, theme, model?, image?,
        displayMode, roads?, vehicles?, has2d, has3d }
place = { id, name, icon, x, y, desc, feel, image?, scene? }
scene = { background, characters[], hotspots[], photos[], obstacles[], walkable[], mode, model3d }
```

- 坐标全部 0..1 归一化；地图高度按 `widthMeters * 0.64` 推算。
- `roads` 是折线数组的数组：`[[[x,y],[x,y],…], …]`（保存时也接受 `{x,y}` 点对象）。
- `vehicles`：`{car?, bicycle?}`，`url` 必须 `/models/` 开头，`scale` 0.05..20。
- `scene.hotspots`：`{id?, label, x, y, action?}`；`action` 是行为提示（sleep/read/study/eat/coffee/phone/look），缺省按 label 猜。
- `scene` 的 `background` 只接受 `/models/`、`/assets/`、`/images/` 开头，否则场景整体失效（null）。

### 8.7 舞台载荷（stagePayload）

`GET /api/stage` 与 `/api/stage/stream` 的完整结构：

```
{ ok, apiVersion(=1，历史遗留), serverTime,
  character{id,name,avatar,sprite,chibi,model,age,license},
  map{id,name,theme,widthMeters,places[],model,image,displayMode,roads,vehicles,has2d,has3d},
  location{state, placeId, placeName, icon, since, minutes, traveling, intercity, avatar},
  weather{kind,label,icon,temp,city,source,fx},
  energy, wallet, settings{weatherMode,smartRoutine,smartLife,locationFree}, animationHint }
```

`animationHint` 取值：`sleeping`（家里且 23 点~7 点）、`idle`、`walking`（同图移动中）、`riding`（跨图行程中）。

### 8.8 同步（sync event / revision / device）

- 事件：`{id(uuid), seq(单调递增), at(ISO), deviceId, type, entity, entityId, payload}`；`type` 当前包括 `message.append`、`character.meta.upsert`、`character.switch`、`maps.replace`、`location.set`、`economy.set`、`life.set`（以及 `balance.low`）。
- 版本表：`entities["<entity>:<entityId>"] = {rev, updatedAt, updatedBy, file, hash}`；已知实体：`messages`、`memory-facts`、`character`、`persona`、`maps`、`place`、`road`、`location`、`economy`、`life`、`diary`。
- 设备：`sync/device.json` = `{version, deviceId, deviceName, token, createdAt}`；`token` 只从 `GET /api/sync/local` 取。
- **事件日志只是「发生了什么」，不是最终状态**；合并/冲突策略未实现（`merge: "not-implemented-yet"`）。

### 8.9 其它设置对象

`modelConfig`、`contextConfig`、`imageConfig`（apiKey 只写）、`envConfig`（pc/space/phone 权限）、`petConfig`、`petStatus`、`vmChatSettings`、`vmChatStatus`、`weatherPayload`、`routinePayload`、`backupItem`、`screenSpaceStatus` 都在 [`schema/models.json`](./schema/models.json) 里有 schema。

---

## 9. 未来手机 / 第三方客户端兼容规则（D09 A、S07）

本轮**不做手机 UI**，只冻结契约（详见 [`MOBILE-GATE.md`](./MOBILE-GATE.md)）。手机/第三方客户端接入时遵守以下规则，保证「后端不用重写」。

### 9.1 只依赖契约

- 启动读 `GET /api/version`：`apiVersion >= 2` 才继续；按 `features.*` 判断能力（如 `features.stage3d === false` 就不要渲染 3D）。
- 端点/字段/错误语义以本文 + `schema/api-index.json` + `schema/models.json` 为准。
- 未知字段一律忽略（服务端会加字段，不会因为客户端不认识就失败）；未知端点不要猜。

### 9.2 明确**禁止依赖**的东西（DSH 专属 / 实现细节）

| 禁止 | 原因 | 应改为 |
|---|---|---|
| `dsh-app://app` Origin、DSH 宿主 `/dsh-screen-beyond/info`、DSH 插件 API/插槽 | 只属于 DSH 桌面宿主 | 直接用运行时 base URL（未来手机是局域网地址） |
| 旧网页 `/`、`/map`、`/stage`、`/model`、`/settings`、`/screen` | 默认 410，删除计划中 | 只用 `/api/*` 与图片 |
| `config.json`/`data/characters/**` 等文件路径、`dataRoot` | 实现细节，随时可能换存储 | 只用 API 字段 |
| `/api/token` 当作安全凭证通道 | 本机回环即可取；未来要正式配对 | 用配对/令牌流程（预留，§9.4） |
| 具体错误文案、内部排序、`hidden`/`system` 消息的细节 | 不是契约 | 按 HTTP 状态码 + `ok` + 结构判断 |
| 依赖 `window`/iframe/浏览器存储 | 手机端形态不同 | 纯 HTTP/SSE 客户端 |

### 9.3 客户端实现规则

1. **消息同步**：先 `GET /api/events?since=0` 拉历史；之后 `since=<最后一条 message.id>` 增量轮询（建议 1~2 秒，页面隐藏暂停）；SSE 只做加速，SSE 断了必须回落到轮询。
2. **发送**：`POST /api/chat {text?, images?}`；返回 200 只代表「已排队」，回复异步生成（看 `typing`/SSE）；`429` 表示她还在说，等 `done` 再发。
3. **去重**：本地按 `uid` 去重（`id` 是角色内自增，切角色会从 1 开始）。
4. **图片**：`image` 可能是 `/models/…` 或 `/images/…` 两类相对路径，统一拼 base URL；不存在的图给占位，不阻塞文字。
5. **错误**：网络错误和 `ok:false` 都必须有 UI 错误态；`409` 提示刷新后重试；`401` 引导重新配对/token；`403` 说明来源不被允许。
6. **SSE**：只解析 `data:` 帧；用 fetch 流而不是 EventSource（需要 token header 时）。
7. **长文本/大响应**：`/api/events` 一次可能很大（历史全量），首屏后只拉增量；`/api/tutorial` 是整篇 Markdown。
8. **轮询合并**：`/api/status` 是所有页面共享的单一状态源，别在每个组件各开一份。

### 9.4 手机门预留（本轮只冻结，不实现）

- **鉴权/配对**：现有基础是「本机设备身份 + 同步令牌」（§3.4）与可选 API token（§3.3）。正式手机方案（局域网绑定、二维码/短码配对、TLS）**尚未实现**；`/api/version.auth` 是未来协商入口，客户端要能保存并携带 token。
- **最小能力集**：聊天 / 角色 / 状态 / 图片 → 端点清单见 [`MOBILE-GATE.md`](./MOBILE-GATE.md)。
- **同步/合并**：事件日志（`seq` 游标）、实体版本（`rev`）、消息 `uid` 已经为多端准备；合并策略、冲突提示、快照都**未实现**。手机阶段第一版应先只读，再推事件，最后做冲突合并。

### 9.5 冻结规则（本契约约定，服务端当前没有运行时校验）

- **加字段**：不 +`apiVersion`；客户端必须忽略未知字段。
- **加端点 / 加 `features` 开关**：不 +`apiVersion`。
- **删字段 / 改字段语义 / 改错误约定**：`API_VERSION` +1，并更新本文与两个 schema。
- **弃用**：先标记 deprecated，至少保留一个大版本，再删。
- 客户端不得因为 `minClient`/文档版本不同而拒绝工作；以 `apiVersion` 与 `features` 为准。

---

## 10. 原生面板（DSH 桌面客户端）专用说明

- **直连** `http://127.0.0.1:<运行时端口>/api/*`（D02 A）；端口发现走 DSH 宿主 `/dsh-screen-beyond/info`，失败再端口扫描（`00-core/api.js` 已实现）。
- **0 个 iframe / 0 个 HTML 页面请求**（M01/N01 验收）；旧网页入口默认 410（§4.4）。
- **CORS**：`Origin: dsh-app://app` 已被放行；预检放行 `x-companion-token`（D11 C）。
- **SSE**：用 fetch 流（`Api.stream`），不要 `EventSource`。
- **她的屏幕**：`GET /api/screen/info` 拿 `spaceUrl`，用系统浏览器打开（`Api.openExternal`），面板内只放截图（`/api/screen/pc`、`/api/screen/phone`）。
- **图片**：`Api.imgUrl` 处理 token 模式（blob URL）；不要直接拼 `<img src>` 绕鉴权。
- 原生面板不依赖 `dataRoot`/文件布局；「关于」页可以展示 `GET /api/version` 与 `GET /api/status.setup`。

---

## 11. 契约变更流程

1. 改 `runtime/server.mjs` 的 `/api/*` 行为时，同一提交更新：本文端点表 + `schema/api-index.json` + `schema/models.json`。
2. **机器核对（已落地，不用手工跑）**：`npm run smoke` 里有「契约一致性」一组检查，自动做四件事——
   - `api-index.json` 的 `totals.endpoints/groups` == 实际条目数；
   - 本文 §5 标题里的「N 个 / M 组」== `api-index.json` 的计数（这就是 0.8.6 之前「文档写 128、索引写 141」那类漂移的兜底）；
   - `api-index.json` 里每个 `path` 都能在 `runtime/server.mjs` 里找到同名路径字面量（防「文档写了、代码没有」）；
   - `models.json` 能解析，且 `x-runtime-version` 与 `package.json.version` 一致。

   下面这段是从前手工核对用的写法，保留作参考（现在由 `scripts/smoke-test.mjs` 承担，逻辑等价、不需要 python）：

```bash
# 历史做法：从 server.mjs 提取 (method, path)，与 api-index.json 的 method/path 求差集
python - <<'PY'
import json, re
src = open('runtime/server.mjs', encoding='utf-8').read()
routes = set()
for ln in src.split('\n'):
    m = re.search(r"url\.pathname\s*(?:===|\.startsWith\()\s*'([^']+)'", ln)
    if not m or not m.group(1).startswith('/api/'): continue
    if m.group(1) == '/api/': continue
    method = 'GET' if "'GET'" in ln else ('POST' if "'POST'" in ln else 'ANY')
    routes.add((method, m.group(1)))
idx = json.load(open('docs/schema/api-index.json', encoding='utf-8'))
docs = {(e['method'], e['path']) for g in idx['groups'] for e in g['endpoints']}
print('missing in docs:', sorted(routes - docs))
print('missing in src :', sorted(docs - routes))
PY
```

3. 破坏性改动：`API_VERSION` +1，按 §9.5 规则通知所有客户端。
4. 契约评审：改动涉及 SSE、鉴权、错误码、数据模型时，至少两人 review（Lead + 契约负责人）。

---

## 12. 未验证 / 已知缺口 / 待复核

**证据等级**：`api-index.json` 里每个端点带 `evidence`：`live`（在 8900 运行实例只读核对过响应）或 `source`（只读源码整理，写操作没有在真实数据上执行）。

### 12.1 未在运行实例上验证的项

| 项 | 现状 | 说明 |
|---|---|---|
| token 模式（`DSH_COMPANION_API_TOKEN`） | **未验证（401 路径）** | 运行实例未开 token；401 文案/header 名按源码整理 |
| 请求体 > 40MB 的 413 | **未验证** | 只按 `readBody` 代码推断，错误体是通用 500 文案 |
| `POST /api/sync/events` 成功路径 | **未执行** | 只读代码：按 id 去重、最多 200 条、返回 accepted/cursor/duplicates |
| 所有 POST 写操作的**成功**响应 | **未执行** | 遵守「只读」约束，没有在真实数据上写；字段按源码整理（写操作会真实改数据，测试请用副本数据根） |
| `/api/screen/space/ensure` 的「启动中」分支 | **未验证** | 按源码整理 |
| `/api/screen/phone` 截图成功路径 | **未验证** | 模拟器未启动；失败分支按源码整理（`503 text/plain`） |
| `/api/backup/restore` 真数据恢复 | **未验证** | HANDOVER 也注明「未在真数据上执行验证」；恢复前必须备份 |
| `/api/vm-chat/send` 图片发送成功路径 | **未验证** | 依赖 VM 内环境，501 分支已按源码整理 |
| 手机端 | **未实现** | 只冻结契约；监听、配对、TLS、合并都没有实现（§3.6 / §9.4） |

### 12.2 已知不一致 / 设计缺口（以代码为准，文档如实记录）

- `GET /api/stage` 载荷里的 `apiVersion` 字段恒为 `1`（历史遗留），与 `GET /api/version.apiVersion = 2` 不一致；客户端只用后者。
- `/api/life` POST 是整段浅合并、**无字段校验、无 expectedRev**；客户端只发要改的字段。
- `/api/map` 的 `places` 是**整体替换**：编辑前必须 GET 完整数组，否则丢字段/场景/热点。
- `/api/events` 没有 `limit`，且服务端消息只保留 800 条（超了截到 600）；「30 轮不丢消息」的验收标准靠的是轮询 + SSE + 持久化，不是无限历史。
- `sync/events.jsonl` 超过 8MB 轮转为 `.1`，更早的事件不可读；同步游标不可回退。
- 同步**没有合并**：`POST /api/sync/events` 只是存储+去重；`merge: not-implemented-yet`。
- 服务不监听局域网、无 TLS；**不要把 8900 暴露到公网**。
- 若干接口（`/api/screen/pc`、`/api/screen/phone`、`/api/pet/avatar`、`/api/chat-bg/custom`）成功返回二进制、失败返回 text/plain，不是 JSON —— 客户端要按 Content-Type 分支。
- `/api/env/start-all` 内存不足时**静默跳过**（返回 ok:true 但没启动），要靠 `/api/resources` 判断结果。

### 12.3 本次核对结论

- 源码路由 **154** 个；`api-index.json` 的 `totals`（`groups: 14` / `endpoints: 154`）与本文 §5 标题计数一致。0.8.9 起这条由 `npm run smoke` 的契约一致性检查自动核对，而且是**双向**的：代码里的每条 `/api` 路由必须在索引里、索引里每条路径必须在本文里、本文 §5 标题的数字必须等于索引计数。0.7.24 那 13 个的明细仍只在 §13。
- `GET /api/version` 在 0.8.9 运行实例实测 `200`：`apiVersion=2`、`version=0.8.9`、`minClient=0.8.9`、`features` 17 项（`stage3d=true`、`legacyWeb=false`）、`install={kind:"git",legacyWebStatus:410}`、`schema`/`auth`/`endpoints` 与 §2 一致；带白名单 Origin 回显 ACAO，恶意 Origin 实测 403。
- 旧网页入口 `/`、`/map` 实测 `410` JSON：`{ok:false,error:"网页入口已下线",hint,apiVersion:2,legacyPage}`（新源码默认关闭，D08/S02）。
- 所有**返回 JSON 的 GET 端点**已在 `127.0.0.1:8900` 只读实测，包括 `/api/status`、`/api/events`、`/api/map`、`/api/stage`、`/api/economy`、`/api/pet/status`、`/api/env/check`、`/api/data/revisions`、`/api/sync/local` 等；例外：`/api/sync/events`、`/api/sync/info` 未带令牌（实测 401）。
- 二进制接口：`/api/pet/avatar` 实测 `200 image/png`，`/api/screen/pc` 实测 `200 image/jpeg`，`/api/chat-bg/custom` 实测 `404`（`no custom background`，非 JSON）；`/api/screen/phone` 未实测（模拟器未启动）。
- 403/404/400/409/401 错误约定已实测（Host/Origin/bad JSON/空消息/版本冲突/同步无令牌/未知端点）。
- CORS 预检与回显已实测（`Origin: http://127.0.0.1:52908`）。
- SSE `/api/stream` 的 `init` 帧、`/api/stage/stream` 的 1 秒全量快照已实测。

---

## 附录 A：与既有文档的关系

- [`INTERFACES.md`](./INTERFACES.md)：第一版「用户可接入格式」（图片反馈/语音/服装/地点内部/记忆导入/多角色/3D 载具）。那些**用户侧格式**仍然有效；接口字段/版本以本文为准。
- [`MOBILE-SYNC.md`](./MOBILE-SYNC.md)：手机同步地基（设备身份/事件日志/revisions/expectedRev），本文 §3.4、§4.7、§8.8 是它的契约化版本。
- [`NATIVE-CLIENT-ARCH.md`](./NATIVE-CLIENT-ARCH.md)：原生面板的实现契约（文件边界/构建方式/共享 API），本文是它引用的服务端契约。
- [`MOBILE-GATE.md`](./MOBILE-GATE.md)：手机门（D09 A）的当前状态与最小能力集。

---

## 13. 0.7.24 新增端点（向后兼容）

> 这些是 0.7.24 新增的能力，`apiVersion` 仍为 2（只加不改）。端点表以本节 + `schema/api-index.json` 为准（api-index 增加了 `direct-chat-update` 组）。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/balance/refresh` | 强制刷新 DeepSeek 真实余额（4 秒内合并重复请求），返回 `{ok,balance,realRmb,at}` |
| POST | `/api/direct-chat/settings` / GET | OneBot 直连设置读写（`enabled/apiBase/token/userId/selfId/autoReply/sendImages/fallbackVm/replyPrefix/timeoutMs`） |
| GET | `/api/direct-chat/status`（`?force=1`） | 探活 OneBot（`get_login_info`），返回延迟/登录账号；5 秒缓存 |
| GET | `/api/direct-chat/friends` | `get_friend_list`（桥不支持时 `ok:false`） |
| POST | `/api/direct-chat/send` | 真发私聊（`send_private_msg`；`text` / `imagePath`） |
| POST | `/api/direct-chat/test` | 探活；`sendTest:true` 时顺带发一条测试消息 |
| POST | `/api/direct-chat/event` | OneBot 11 HTTP 上报入口（只处理私聊、messageId 去重、只收配置的对方 QQ 号） |
| GET | `/api/update/check`（`?force=1`） | 检查 npm registry 新版本（15 分钟缓存；同时报 git 仓库/安装方式/工作区是否干净） |
| POST | `/api/update/apply` | git 检出且工作区干净时 `git pull --ff-only`；成功后运行时自动退出等宿主重启。npm/DSH 安装返回 `manual` 提示 |
| GET/POST | `/api/update/settings` | 自动更新设置（`autoCheck/autoApply/allowPrerelease`） |
| POST | `/api/vm-chat/open` | 只切换虚拟机聊天会话（`contact` + 可选 `row` 手动坐标；不发消息） |

**语义边界**
- 直连只处理**私聊**；群聊不做（避免她在群里乱说话）。
- 直连入站需要填「对方 QQ 号」（`userId`）才会自动回复，避免给陌生人生成回复浪费 token。
- 自动更新不触碰用户的 DSH profile：npm/DSH 管理的安装只提示，不执行 `npm i`。
- `POST /api/update/apply` 成功且 `needRestart=true` 时，运行时会 2 秒后 `process.exit(0)`，由宿主拉起新代码；客户端应预期连接短暂断开。
