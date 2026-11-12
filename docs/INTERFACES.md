# 屏幕彼端 · 第一批开放接口

这份文档先定义「用户可以自己接入」的边界。当前已落地的是**图片反馈**和**记忆导入**；语音、服装、地点内部场景先给契约，后续版本按这个契约实现，不改用户侧格式。

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

## 4. 地点内部（待实现）

地图地点增加 `scene`：

```json
{
  "id": "cafe",
  "name": "咖啡店",
  "scene": {
    "background": "scenes/cafe.png",
    "characters": [{ "slot": "counter", "x": 0.62, "y": 0.72 }],
    "hotspots": [
      { "id": "menu", "label": "看菜单", "x": 0.3, "y": 0.6, "action": "look_menu" }
    ]
  }
}
```

- 点击地图上的地点进入 `scene`；角色可进入同一 scene。
- 事件/动作后续由 `actions.json` 定义，不在第一批实现。

## 5. 记忆导入

已实现，设置 → 记忆 → 导入记忆。

支持：

- 纯文本：一行一条，自动去重、按句号拆分。
- Markdown：忽略 `#`、`-` 等标记。
- JSON：字符串数组，或 `{memories|facts|messages|data|items|list}` 数组；对象支持 `text` / `content`。
- JSONL：逐行 JSON。

导入后进入事实卡，参与后续聊天注入；重复内容会合并并提升清晰度。


## 3D 载具模型接口

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
