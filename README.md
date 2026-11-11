# 屏幕彼端 · dsh-screen-beyond

一个住在屏幕另一端的 AI 小伙伴。她有**自己的虚拟屏幕和安卓手机**、有自己的生活作息、记忆和日记，会聊天、会想找你、会花钱，也会心疼你的 token。

> **纯聊天可以脱离 DSH 独立运行**：Node 18+ 和 DeepSeek API Key 就能在浏览器里见到她。
> **完整版需要 DSH**：接入她的虚拟屏幕和安卓手机，才需要装 DSH 和对应环境。
>
> ⚠️ 早期版本：可能还有一些奇怪的小 bug，欢迎反馈，见谅。

---

## 两种形态

- **纯聊天版**：只有人设、记忆、日记、生活作息、聊天界面，任何设备都能用，不占额外资源。
- **完整版**：她拥有自己的 Linux 桌面（可看/可点/可打字）和自己的安卓手机（可看/可点/可滑/可打字）。插件会自动检测环境：检测到就进完整版，没有就纯聊天版。

## 功能

- **人设卡**：名字、称呼、关系、性格滑块、头像、Live2D/3D 模型、年龄、驾照、出行偏好；可多角色，各自独立记忆/日记/聊天记录。
- **记忆**：自己记重要的事，带遗忘（半衰期）、强化、置顶、归档；可手动增删改、调遗忘速度。
- **日记**：每天一篇，她能自己读给你听。
- **生活**：自己的作息表、活动池、心跳、安静时段、智能安排（按天气/体力/记忆调整）。
- **聊天**：文字 + 图片（她能看懂）、逐字流式、她可以主动找你；顶部显示剩余 token / 今日已用（悬浮看明细）。
- **无括号模式**：开启后她说话不再用括号表示动作/表情（设置 → 模型 → 聊天风格）。
- **地图 + 舞台**：地点可拖拽/增删/导入、自绘道路、2D 底图、3D 模型（.glb/.gltf）、2D/3D 舞台切换。
- **出行**：按年龄/驾照/体力/天气/钱自己选交通方式；未成年夜间出门要确认并报备；跨城长途。
- **天气日夜**：手动或真实定位天气，雨/雪/风/热/冷特效，可自己上传素材替换；日夜自动切换。
- **经济**：虚拟货币（初始余额/每日零花/时薪/饭钱/娱乐）或 **Token 实时代币**（钱 = 剩余 token，汇率可设）；余额和剩余 token 在聊天、地图、舞台、设置里都能看到。
- **自己的环境**：屏幕 / 手机 / 你的电脑三种工具；权限分「关闭 / 仅鼠标键盘 / 代码控制」；一键启动/关闭环境、内存占用提示、她自己能否开机的开关、危险操作确认。
- **给开发者**：`GET /api/stage` 状态 JSON、`GET /api/stage/stream` SSE，可自己写渲染器（Live2D / 3D / 自绘地图）。

## 安装

当前版本：0.5.7。

### 纯聊天：独立运行（不需要 DSH）

需要 **Node.js 18+** 和一个 **DeepSeek API Key**（也可在启动后的 设置 → 模型 里填）。

1. 解压本包到任意目录
2. Windows 双击 `start-pure-chat.cmd`；Linux/macOS 运行 `sh start-pure-chat.sh`（或命令行运行 `node runtime/server.mjs`）
3. 浏览器打开 `http://127.0.0.1:8900/`

此时只有聊天、人设、记忆、日记、生活、地图/舞台等页面；她的虚拟屏幕和手机等完整环境需要下面的 DSH 安装。
纯聊天模式在聊天页顶部会显示「🧩 可独立运行」。

### 完整版：作为 DSH 插件安装

插件依赖 DSH 0.2.x（桌面/网页均可）。

```bash
# 从本地目录安装（当前推荐）
dsh plugin --profile <profile> add link:<插件目录>
```

> `dsh-screen-beyond` 尚未发布到 npm；在发布前，`dsh plugin add dsh-screen-beyond` 会失败，请先用上面的本地 `link:` 方式，或下载 GitHub Release 的压缩包。

装好后重启一次 DSH，左侧栏出现「屏幕彼端」。

> 安装完成后第一次打开是「纯聊天版」，可直接用；想要屏幕/手机看下面的「环境」。

## 模型兼容性（请先看）

**本插件只验证过 DeepSeek 模型**（默认 `deepseek-flash`）。换用其它 OpenAI 兼容模型时，工具循环、`reasoning_content` 回传等细节可能不兼容，可能表现为工具调用失败、报 400 或回复异常——**这部分我们不做适配，也不承诺可用**。

## 桌宠（桌面上的她）

设置 → 生活 → 「🐾 桌宠」开启后，桌面上会出现一个置顶的小桌宠：

- **默认形象 = 她的头像**；设置 → 生活 →「换形象」可以传自己的 PNG/JPG/WebP，也可以直接编辑 `pet.json` 的 `image`（支持本地路径或 URL）
- **显示大致状态**：她在哪、在干嘛、精力怎么样，5 秒刷新一次；下方显示剩余 token / 今日已用（悬浮看完整数字）
- **和她说话**：点 💬 打开小聊天窗（或右键 → 和她说话）
- **看你的屏幕**：点 👀（或右键 → 看看我的屏幕），她会用 pc 工具看一眼你的屏幕再回你
- **摸头/戳一戳**：默认有「摸摸头」「戳一下」两个区域；点她会发一句提示给她，她会有反应（回复会显示在桌宠气泡里）

### 个性化（不会锁死）

桌宠的行为写在数据目录的 `pet.json`（完整示例：`runtime/pet/pet.example.json`）：

```json
{
  "image": "avatar",
  "size": 180,
  "gestures": [
    { "id": "pat", "label": "摸摸头",
      "hit": { "x": 0.15, "y": 0.08, "w": 0.7, "h": 0.42 },
      "prompt": "（你摸了摸她的头）", "bubble": "唔…" }
  ],
  "buttons": [
    { "id": "chat", "label": "💬", "action": "chat" },
    { "id": "look", "label": "👀", "action": "look" }
  ]
}
```

- `hit` 是相对图片的命中区域（0~1），换自己的桌宠形象后可以按自己的图重新画区域
- `prompt` 会作为一条用户消息发给她；`bubble` 是立刻显示的短文字
- `buttons` 里支持 `chat` / `look` / `prompt`（自定义一句 prompt）；想加“喂糖”“搓一搓”都只改 JSON，不用改代码

## 环境（可选，完整版）

只支持 Windows（桌面自动化用到 Win32）。需要：

1. **VirtualBox** + 一个 Linux 虚拟机（Debian 桌面版，建议 8G 内存 / 40G 磁盘），SSH 转发到本机 `2222`，用户 `dsh`，密码 `DshSpace2026`（可在插件配置里改）
2. 虚拟机内：`x11vnc` + `websockify`（noVNC），宿主机端口 `6081`
3. **安卓模拟器**：Android AVD，推荐 **Android 16 / API 36、1080×1920**（示例叫 `DSH_Phone`），`adb` 可用。目前只验证过这个 AVD，**真机未适配**；Waydroid 也能跑但截图慢，不推荐

虚拟机/模拟器**都开着会占内存**（屏幕约 2~6 GB、手机约 2~4 GB）。设置 → 环境 里有一键启动/关闭和内存提示；「她自己能开机」关掉（默认）时，她不会自己启动环境。

> ✅ 设置 → 环境 → **「开始自检」**会逐项检查：辅助脚本、Python(paramiko)、VirtualBox、虚拟机、SSH/VNC、模拟器、ADBKeyboard、ffmpeg，并给出缺什么。
>
> 📦 插件包自带 `runtime/env/` 模板脚本和 ADBKeyboard.apk；如果本机没有 `D:\dsh-env`，会自动用随包目录。路径因机器而异，必要时用 `DSH_COMPANION_ENV` / `DSH_COMPANION_PY` / `DSH_COMPANION_ADB` / `DSH_COMPANION_ANDROID_SDK` / `DSH_COMPANION_EMULATOR` 覆盖。
>
> ⌨️ 手机中文输入：手机开机后，设置 → 环境 → **「安装 ADBKeyboard」** 一键装好并切换到该输入法；没装时只能输入英文/数字。

详细图文步骤见插件内 **设置 → 教程**，或直接打开运行时页面 `http://127.0.0.1:8900/`（默认端口）。

## 配置

`cordis.patch.yml`：

```yaml
- insert:
    - id: dsh-screen-beyond
      name: dsh-screen-beyond
      config:
        port: 8900                 # 运行时端口（被占会自动 +1 找空闲）
        autoStart: true            # 是否自动拉起运行时
        # dataRoot: 'D:\你的数据目录'   # 可选；默认 %USERPROFILE%\.dsh-companion
        # envDir: 'D:\dsh-env'      # 可选；完整版辅助脚本所在目录
```

也可以不改安装包，直接在本机放一个覆盖文件 `%USERPROFILE%\.dsh-companion.json`：

```json
{ "dataRoot": "D:\\你的数据目录", "envDir": "D:\\dsh-env" }
```

运行时/宿主会自动读取它（优先级低于插件配置里的显式值）。`dataRoot` 下结构：

```
<dataRoot>/
  config.json
  data/characters/<角色id>/{meta.json, persona.md, messages.json, memory/, diary/, routine.json, state.json, wallet.json, visits.json, avatar.bin}
  models/        # 导入的 2D 底图/地点图/3D 模型
  data/screens/  # 截图缓存
```

备份：设置 → 数据 → 立即备份（或 `scripts/backup.ps1`），备份落在数据目录的 `backups/` 下；恢复用 `scripts/restore.ps1 -BackupDir <备份目录>`。

## 运行时页面

运行时是一个独立 Node 服务（默认 `http://127.0.0.1:8900`）：

- `/` 聊天 · `/map` 地图 · `/stage` 2D 舞台 · `/model` 3D 舞台 · `/settings` 设置 · `/screen` 看屏幕
- 快捷键：聊天页 `Alt+S` 打开看屏幕

## 给开发者

- 聊天：`POST /api/chat {text, images?}`；事件轮询 `GET /api/events?since=`；逐字流 `GET /api/stream`
- 状态：`GET /api/stage`、`GET /api/stage/stream`
- 记忆/日记/地图/经济/环境等 REST 接口见插件内教程「给开发者」一节或运行时源码 `server.mjs`

## 测试

`tests/` 是开发时用的自动化脚本（需要运行时在 8900 跑着，且会消耗少量 token）：

```powershell
python tests/full_test.py     # 页面/API/出行/经济/地图/记忆/日记/角色
python tests/full_test2.py    # space/phone/pc 工具与屏幕接口
python tests/her_test.py      # 让她自己测：space/phone/pc/记忆/日记/花钱/code
```

## 已知限制

- Windows only（屏幕/手机/电脑工具）；纯聊天版跨平台。
- 手机适配：只验证过 Android 16 / API 36 的 AVD `DSH_Phone`（1080×1920）；真机/其它安卓版本未测试。
- 手机中文输入通过 ADBKeyboard 广播实现（插件里可一键安装）；没装时只能输出英文/数字。
- 旧版 Waydroid 的截图可能很慢，推荐用安卓模拟器。
- 3D 舞台内置 three.js，性能取决于显卡；卡就先用 2D。
- `reasoning_effort` 等模型参数依 DeepSeek API 可用性而定。
- 模型兼容性：只保证 DeepSeek；其它 OpenAI 兼容模型未测试、不做适配。
- 完整版辅助脚本模板在 `runtime/env/`，但里面的虚拟机名/SDK 路径需要按本机情况修改；可以先跑「环境自检」看缺什么。
- 默认数据目录是 `%USERPROFILE%\.dsh-companion`；升级/重装插件不会覆盖这里。

## 许可

MIT（插件代码）。示例角色/素材如需二次分发请保留原作者署名：默认人设卡「小鲸」为本项目原创示例；历史示例「大肥鱼」来自 [dsh-persona-dafeiyu](https://github.com/huaizhuanghub/dsh-persona-dafeiyu)（MIT，作者 huaizhuanghub）。

## 开发者入口

- `GET /api/stage`：角色状态 JSON
- `GET /api/stage/stream`：SSE 状态流
- 市场简介见 [`STORE.md`](./STORE.md)

---

## 早期版本说明

这是刚发布的第一版，功能很多、环境组合也很多，难免还有一些奇怪的小 bug。
遇到问题欢迎带日志反馈；给我一点时间，会慢慢修。谢谢包容。
