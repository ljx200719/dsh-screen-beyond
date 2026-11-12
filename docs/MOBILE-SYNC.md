# 手机端同步地基（v1）

> 当前只是**地基**：设备身份、事件日志、受令牌保护的同步 API。  
> **还没有**多端合并、冲突提示、手机 App、局域网绑定和加密传输。

## 已落下的结构

### 1. 本机设备身份

首次启动会在数据目录下生成：

`sync/device.json`

```json
{
  "version": 1,
  "deviceId": "uuid",
  "deviceName": "电脑名",
  "token": "本机同步令牌",
  "createdAt": "ISO 时间"
}
```

- `deviceId` 稳定，不会每次启动变化
- `token` 只在本机读写；`GET /api/sync/local` 只允许 `127.0.0.1` 取回
- 不要把 `device.json` 发到公开场合

### 2. 追加式事件日志

`sync/events.jsonl`，一行一个事件：

```json
{
  "id": "uuid",
  "seq": 1,
  "at": "ISO 时间",
  "deviceId": "uuid",
  "type": "message.append",
  "entity": "message",
  "entityId": "42",
  "payload": {}
}
```

- `seq` 单调递增，是以后的同步游标
- `id` 稳定，用于去重
- 目前记录的事件：
  - `message.append`
  - `character.meta.upsert`
  - `character.switch`
  - `maps.replace`
  - `location.set`
  - `economy.set`
  - `life.set`

事件不是最终状态；真正的状态合并、快照和冲突处理还没有实现。

### 数据层配套

`runtime/data-store.mjs` 现在统一接管 JSON 读写：

- 先写临时文件再替换，避免中途断电/崩溃留下半个 JSON
- 消息、记忆、日记、人设正文、角色元数据、地图、地点、道路、位置、经济、生活、头像等关键实体写入时记录 `rev`
- 新消息/记忆带稳定 `uid`；历史数据加载时补齐
- revision 表在 `sync/revisions.json`
- 本机只读接口：`GET /api/data/revisions`（仅 127.0.0.1）

人设、地图、记忆导入/置顶/删除支持可选 `expectedRev`：

```json
{ "expectedRev": 3, "meta": {} }
```

版本不一致返回 `409`，并携带 `currentRev`；不传 `expectedRev` 时保持旧行为。

这层不改变现有文件布局，后续可以逐步替换成 SQLite / CRDT，而不需要改所有页面。

### 3. 同步 API

所有 `/api/sync/info`、`/api/sync/events` 都要带本机令牌：

```http
Authorization: Bearer <token>
# 或
x-sync-token: <token>
```

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/sync/local` | **仅本机回环**；返回设备信息 + token |
| GET | `/api/sync/info` | 设备、游标、事件数 |
| GET | `/api/sync/events?since=0&limit=500` | 从游标后拉事件 |
| POST | `/api/sync/events` | 推送其他设备事件，按事件 id 去重后追加；**不做业务合并** |

示例：

```bash
TOKEN=$(curl -s http://127.0.0.1:8900/api/sync/local | jq -r .token)
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:8900/api/sync/info
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8900/api/sync/events?since=0"
```

## 当前边界

- 服务仍只监听 `127.0.0.1`，手机还不能直接连
- 没有手机客户端；只有协议
- 没有合并策略：`POST /api/sync/events` 只是存储和去重
- 没有每实体 revision / 冲突检测 / 覆盖前备份 UI
- 没有 TLS；**不要把 8900 直接暴露到公网**

## 下一步（按顺序）

1. ~~给主要可变实体加 `rev` / `updatedAt`~~（已完成：消息、记忆、日记、人设正文、地图/地点/道路等）
2. 把 `expectedRev` 用到前端保存流程，真正阻止旧页面覆盖新改动
3. 做拉取/推送的增量同步，先支持同一 Wi-Fi 下手机只读
4. 加首次配对（二维码/令牌）和局域网绑定
5. 做冲突检测：只有同一条数据两边都改过才弹合并；覆盖前自动备份两边
6. 最后再做真正的离线独立使用和双向合并

## 为什么现在不继续

完整多端同步需要：稳定 ID、事件游标、认证、并发保护、冲突策略、备份恢复。  
先只落数据层和协议，可以在不拖慢地图/服装/多角色的前提下，避免以后大规模重写写数据路径。
