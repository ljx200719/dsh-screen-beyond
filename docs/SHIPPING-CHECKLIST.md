# 发布前检查（0.8.9 起）

npm 包只发 `lib/`、`runtime/`、`cordis.patch.yml`、`README.md`、`LICENSE`。**用户数据目录（`<dataRoot>`，默认 `D:\linzhi`）和 `~/.dsh` 一律不进包。**

## 不能进包的东西

| 东西 | 在哪 | 为什么不能发 |
|---|---|---|
| 火山 API Key | `~/.dsh/volc-tts-token.txt` | 是**账号凭据**；发出去等于公开，别人会花你的额度，也违反火山条款 |
| 火山 App ID | `voice.json` 的 `appId` | 绑在你的账号/免费额度上，用户用自己的 App ID 才能计到自己账 |
| 运行时配置 `voice.json` | `<dataRoot>/voice.json` | 里面有 `file:C:\...` 这类**本机绝对路径**，换台机器就是坏的 |
| TTS 缓存音频 | `<dataRoot>/voice/audio/` | 用户的对话内容 |

## 代码里的约定（必须保持）

1. `VOICE_DEFAULTS.provider = 'sapi'`：开箱即用，Windows 自带语音，不需要任何 Key。
2. `appId` / `apiKeyRef` 默认为空字符串；**仓库里不出现任何真实凭据**。
3. 云端 provider 只是"没配好"（缺 Key/缺地址）时，`synth()` 自动回退到 Windows 语音，并带 `fallbackFrom` 字段——用户切了云端又没填 Key，消息也不会变哑。
4. 密钥只存引用：`apiKeyRef = env:VAR` 或 `file:<用户的路径>`，明文永远不落配置、不进日志。

## 用户想用上好听的音色

不是我们替他配，而是他自己开通：

1. 火山引擎控制台 → 豆包语音 → 语音合成 2.0 → 开通（新账号有 2 万字免费额度）
2. 新版控制台拿 **App ID** 和 **API Key**
3. 设置 → 角色 → 语音 → 声音来源选「火山引擎 · 豆包语音」，填 App ID / Key 引用 / 音色

不填也能用——用 Windows 语音。

## 发布前跑什么

```bash
npm run check   # 语法 + 编码体检 + 密钥扫描
```

- `scripts/check-encoding.mjs`：NUL / 坏 UTF-8 / JSON 解析 / CSV 列数 / `.ps1` 缺 BOM
- `scripts/check-secrets.mjs`：明文 `sk-` Key、Bearer token、`C:\Users\<名字>` 本机路径、写死的 `apiKeyRef: file:C:\...`

两条都必须绿。`check-secrets` 已经抓过一次真实问题（文档里带了本机路径和 App ID），不是摆设。

## 冒烟里盯着的用例

- `火山语音走 v3 协议（多行 base64 拼接）`：验证 `X-Api-*` 头和 `req_params` 结构
- `云端没配 Key 时自动回退 Windows 语音`：验证打包默认形态不会哑
