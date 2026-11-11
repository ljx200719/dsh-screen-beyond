# 屏幕彼端 · Screen Beyond

> 一个住在屏幕另一端的 AI 小伙伴。她能聊天、记事、过日子，也能拥有自己的屏幕和手机。

## 一句话简介

**中文**：住在屏幕另一端的 AI 小伙伴：人设、记忆、日记、生活作息、地图舞台、桌面桌宠，以及她自己的虚拟屏幕和安卓手机；纯聊天模式可脱离 DSH 独立运行。早期版本，可能还有一些奇怪的小 bug，欢迎反馈。

**English**：An AI companion who lives on the other side of your screen: persona, memory, diary, daily routines, maps and a stage, a desktop pet, and her own virtual screen and Android phone. The chat-only mode runs standalone without DSH. Early release — a few odd bugs may remain; reports are welcome.

## 两种用法

- **纯聊天（独立运行）**：不需要 DSH。Node.js 18+ + DeepSeek API Key，双击 `start-pure-chat.cmd`，浏览器打开 `http://127.0.0.1:8900/`。聊天、人设、记忆、日记、生活、地图/舞台等页面都可以用。
- **完整版（DSH 插件）**：作为 DSH（DeepSeek Harness）插件安装，在 DSH 侧边栏里使用；她的虚拟屏幕、安卓手机等完整环境需要 DSH 和对应虚拟机/模拟器。

## 功能

- **人设**：名字、称呼、关系、性格滑块、头像、Live2D/3D 模型；多角色各自独立记忆与聊天记录。
- **记忆与日记**：重要的事会记住，带遗忘、强化、置顶、归档；每天一篇日记。
- **生活**：自己的作息表、活动池、心跳、安静时段、主动聊天、按天气/体力/记忆智能安排。
- **聊天**：文字 + 图片、逐字流式、主动消息；顶部显示剩余 token 和今日已用；可开「无括号模式」。
- **地图与舞台**：地点拖拽/增删、自绘道路、2D 底图、3D 模型、2D/3D 舞台。
- **桌宠**：默认用她的头像，可换自己的图；点气泡展开半透明聊天，点眼睛让她看你的屏幕；摸头/戳一戳等互动可在 `pet.json` 自定义。
- **她自己的环境**：虚拟屏幕、安卓手机、你的电脑三种工具；虚拟屏幕/手机需要完整环境。
- **Token 代币**：可以用剩余 token 当钱，也可以使用虚拟货币。

## 安装

### 纯聊天（不需要 DSH）

1. 解压发布包
2. 双击 `start-pure-chat.cmd`（需要 Node.js 18+）
3. 打开 `http://127.0.0.1:8900/`
4. 没有 API Key 时，在 设置 → 模型 里填 DeepSeek API Key

### DSH 插件

```bash
dsh plugin --profile <profile> add link:<解压后的目录>
# 发布到 npm 后也可以用包名安装
```

然后重启 DSH，左侧栏出现「屏幕彼端」。

## 早期版本

这是刚发布的第一版，功能很多、环境组合也很多，难免还有一些奇怪的小 bug。
遇到问题欢迎带日志反馈；给我一点时间，会慢慢修。谢谢包容。

## 许可

MIT License。商用、修改、再发布都可以，保留版权和许可声明即可。

## 链接

- 仓库：`https://github.com/<owner>/dsh-screen-beyond`（发布时替换）
- 更新：见 GitHub Releases
