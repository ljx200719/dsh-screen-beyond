# 屏幕彼端 0.8.3（2026-11-15）

## 新增：她说话（语音 / TTS，第一版最小闭环）

- **设置 → 角色 → 语音**：总开关 / 声音来源 / 音色 / 语速 / 单条最长 / 试听。
- **聊天页输入区**多了 `🔊 语音开`、`🔈 自动读 / 手点读`、`■ 停止`。打开总开关后她的每条回复带一条语音。
- **新消息默认自动读出来**（`🔈 自动读`）：她的话一到就出声，不用点。历史消息不自动读，只在你点消息上的 `🔊 播放语音` 时播；关掉「自动读」就全部回到手点。
- **默认声音：Windows 自带语音（SAPI）**。离线、免 Key、装上就能用；本机实测 zh-CN 音色可用，单句合成约 0.4 秒（含 PowerShell 启动），音频 7.9 秒 / 348KB。
- **文本清洗**：Markdown、代码块、链接、括号动作旁白、emoji 都不念；超过「单条最长」按句子边界截断。
- **缓存**：同文本 + 同音色 + 同参数不重复合成，存 `<数据根>/voice/audio/`，上限 200MB / 2000 条，超了删最旧。
- **失败不影响文字**：合成失败只在消息下显示一行「语音没生成：原因」，文字照常。

## 留给用户的口子（这一版的重点）

- 声音来源可切到 **自建 / 云端 TTS 服务（HTTP）**：约定 `POST {text,voice,speed,pitch,format}` → 直接回音频二进制（mp3/wav/ogg）。
  自己跑的 GPT-SoVITS `api_v2`、CosyVoice、OpenAI 兼容接口、云厂商 TTS 都能接，**插件不认具体模型，只转发文本**。
- 密钥只存**引用**：`env:变量名` / `file:路径`。明文不进配置、不进日志、不进消息。
- 每角色覆盖文件 `<数据根>/voice/characters/<角色Id>.json` 已支持（接口保留，界面第一版不提供）。
- **不做**训练 / 微调 / 克隆：想练自己的音色在外面练，练完用 HTTP 口子接进来。

## 未做 / 未验证

- **Edge TTS 没接**：本机实测 `wss://speech.platform.bing.com/...` 在握手阶段就被关（1006）；通用 WSS 回显正常，说明是对方拒绝（不是本机网络）。等能验证再补，不作为默认。
- ASR（你说话）、双向语音、主动看屏幕语音：仍在计划里，0.8.4+。
- 语音开关和播放器的**真人观感**需要重载 DSH 后自己确认（冒烟只覆盖到「按钮渲染出来」和「接口合成/缓存/路径安全」）。

## 接口

```text
GET  /api/voice/settings   → { ok, settings, providers, defaults, cache, hasKey }
POST /api/voice/settings   → 局部更新（enabled/provider/voice/speed/maxChars/endpoint/apiKeyRef…）
POST /api/voice/tts        → { text } → { ok, audio, cached, provider, duration }
POST /api/voice/preview    → 试听固定一句话
POST /api/voice/cleanup    → 清缓存（按上限自动清理，也可手动触发）
GET  /voice/audio/<file>   → 音频（只允许 40 位 hash + 白名单扩展名）
```

`/api/events` 新增 `voiceRev` + `voiceUpdates`：语音是**异步**挂到消息上的，面板按 rev 增量补，不用重拉历史。
