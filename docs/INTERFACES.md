# 屏幕彼端 · 第一批开放接口

这份文档先定义「用户可以自己接入」的边界。当前已落地的是**图片反馈、记忆导入、地点内部基础版、多角色同图基础版**；语音、服装先给契约，后续版本按这个契约实现，不改用户侧格式。

## 1. 图片反馈

已实现，配置位置：设置 → 模型 → 图片反馈。

```json
{
  "provider": "seedream | openai-compat | http",
  "baseURL": "https://ark.cn-beijing.volces.com/api/v3",
  "model": "doubao-seedream-5-0-pro-260628",
  "size": "1024x1024",
  "apiKey": "只写入本机，读取时只返回是否已配置"
}
```

生图请求统一为 `POST {baseURL}/images/generations`：

```json
{
  "model": "...",
  "prompt": "...",
  "size": "1024x1024",
  "response_format": "b64_json",
  "watermark": false
}
```

响应至少要包含以下任意一种：

```json
{ "data": [{ "b64_json": "..." }] }
```

或：

```json
{ "data": [{ "url": "https://..." }] }
```

角色想发图时调用工具 `send_image`：

```json
{ "prompt": "四叶草特写，午后草地", "caption": "我找到四叶草了", "size": "1024x1024" }
```

图片会保存到 `<数据目录>/data/images/`，聊天里显示为图片消息。

## 2. 语音（待实现，接口先定）

每个角色有独立的 `voice.json`：

```json
{
  "provider": "http | command | local",
  "endpoint": "http://127.0.0.1:9880/tts",
  "model": "用户自己的音色 ID",
  "voice": "用户自定义音色参数",
  "speed": 1.0,
  "pitch": 0,
  "format": "mp3",
  "apiKey": "可选，只保存在本机"
}
```

- `http`：POST `endpoint`，请求体至少包含 `{ text, voice, speed, pitch }`，返回音频文件或 `{ "url": "..." }`。
- `command`：执行用户命令，提供 `{text}` 给 stdin 或环境变量，stdout 输出音频路径。
- `local`：调用本机 TTS（edge-tts / SAPI / 其它），用户可替换实现。
- 不允许固定几个音色限制用户；界面只负责保存/测试用户自己的配置。

## 3. 服装（待实现，2D 优先）

角色目录下 `outfits.json`：

```json
{
  "outfits": [
    {
      "id": "raincoat",
      "name": "雨衣",
      "layers": [
        { "slot": "body", "image": "outfits/raincoat-body.png" },
        { "slot": "face", "image": "outfits/raincoat-face.png" }
      ],
      "weather": ["rain"],
      "occasions": ["go_out"],
      "model": { "color": "#5b7fd1", "accessory": "hood" }
    }
  ]
}
```

- 2D：按 slot 叠加图层，底图 + 衣服 + 表情。
- 3D：先支持换色和配件；完整换装后续做。
- 用户可以通过本地目录或 HTTP 提供 `outfits.json` 和图片，路径相对角色目录。

## 4. 地点内部（基础版已实现）

地图地点增加 `scene`：

```json
{
  "id": "cafe",
  "name": "咖啡店",
  "scene": {
    "background": "/models/scenes/cafe.png",
    "characters": [{ "slot": "counter", "x": 0.62, "y": 0.72 }],
    "hotspots": [
      { "id": "menu", "label": "看菜单", "x": 0.3, "y": 0.6, "action": "look_menu" }
    ]
  }
}
```

- 点击地图地点会先打开详情卡：地点描述、感受、当前在场角色。
- 有 `scene.background` 时显示「进入内部」：背景图 + 在场角色 + 可点击热点。
- 背景路径只接受 `/models/`、`/assets/`、`/images/` 开头；热点暂时只弹提示，具体 action 后续接。
- 小鱼镇 13 个地点已内置 AI 绘制的「星露谷式俯视」场景图，放在 `runtime/models/scenes/<id>.jpg`。
- 地图页「地点列表」每个地点有「内部场景」按钮，可填背景图、上传本地图片、编辑热点、填活动照片。
- 打开场景会写 `sceneFocus`，聊天提示词会带上地点/热点；场景内角色悬浮可查看活动。
- 活动文案优先用 AI（全局至少间隔 5 分钟，同一角色/地点/热点缓存 10 分钟），没有可用模型时回退本地文案。
- `scene.photos` 可配置活动照片；主动消息有低概率附图（90 分钟冷却）。
- 场景内角色可以拖动摆放，位置写入该地点的 `scene.characters`，下次打开仍保留。
- 角色在场景里会自动走动：按行为停留（睡觉夜间 6–9 小时、看书 30–90 分钟、写作业 45–120 分钟、吃饭 20–45 分钟等），行为结束才换热点；位置会保存。
- 顶部会显示当前行为（例如「小鲸：睡觉 · 到 07:19」）；点热点会把角色移到热点旁、切换行为并写入 `sceneFocus`。
- 场景顶部「✏️ 布局」可以拖动热点位置，保存到 `scene.hotspots`。
- 场景 AI 活动可在右侧地图设置开关；开启时全局至少间隔 5 分钟，同角色/地点/热点缓存 10 分钟。
- 地图页新增 `👁 看其他地图` 只读预览；预览里可一键「让她直接过去」（`instant`，不计算长途）。

场景相关接口：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/scene/activity?character=&placeId=&hotspotId=` | 返回角色在场景里的活动文案；AI 低频 + 缓存 |
| POST | `/api/scene/focus` | 设置当前场景/热点，聊天提示词会带上；传空 placeId 清除 |
| POST | `/api/scene/image` | 上传场景背景图（dataUrl），返回 `/models/...` 地址 |
| GET | `/api/map/preview?mapId=` | 只读预览任意地图（含完整 places），不移动角色 |
- 点击地图上的地点钉也会打开详情卡；拖动仍然调整位置，不会误触。

## 5. 记忆导入

已实现，设置 → 记忆 → 导入记忆。

支持：

- 纯文本：一行一条，自动去重、按句号拆分。
- Markdown：忽略 `#`、`-` 等标记。
- JSON：字符串数组，或 `{memories|facts|messages|data|items|list}` 数组；对象支持 `text` / `content`。
- JSONL：逐行 JSON。

导入后进入事实卡，参与后续聊天注入；重复内容会合并并提升清晰度。


## 6. 多角色同图（基础版已实现）

服务端：

```http
GET /api/world/characters
```

返回所有角色当前的世界状态：

```json
{
  "characters": [
    {
      "id": "xiaojing",
      "name": "小鲸",
      "avatar": "/avatar.png?c=xiaojing&t=...",
      "mapId": "map-main",
      "mapName": "小鱼镇",
      "placeId": "cafe",
      "placeName": "咖啡店",
      "x": 0.53,
      "y": 0.27,
      "state": "stationary",
      "transport": "",
      "etaSec": 0,
      "sameMap": true,
      "samePlace": false,
      "isActive": true
    }
  ],
  "activeMapId": "map-main"
}
```

- `x` / `y` 是地图归一化坐标；跨城时为空。
- `sameMap`：和当前激活角色是否在同一张地图。
- `samePlace`：和当前激活角色是否在同一地点。
- 地图页会显示同图其他角色的头像图钉和「角色」列表。
- 点角色可查看状态、切换过去、切换并打开聊天。
- 同一地点时，聊天提示词会加入「这里还有：xxx」，让当前角色知道其他角色在场。
- 不同地图的角色仍会出现在「角色」列表里，只是不会画到当前地图上。

## 7. 3D 载具模型接口

`map.vehicles` 可把默认低模汽车/自行车替换成用户自己的 GLB/GLTF。模型文件请放在数据目录 `models/` 下，通过 `/models/<文件名>.glb` 引用。

```json
{
  "vehicles": {
    "car": { "url": "/models/my-car.glb", "scale": 1.0, "rotationY": 0 },
    "bicycle": { "url": "/models/my-bike.glb", "scale": 1.0, "rotationY": 0 }
  }
}
```

- `url` 必须以 `/models/` 开头，否则会被忽略
- `scale` 范围 0.05–20
- `rotationY` 单位为弧度
- 可选 `x` / `y` 为地图归一化坐标（0–1），用于指定停放点
- 未配置的载具继续使用内置低模汽车/自行车
- 通过 `POST /api/map` 提交 `{ "vehicles": { ... } }` 即可保存到当前地图
