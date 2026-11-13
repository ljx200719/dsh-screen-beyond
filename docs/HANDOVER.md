# 屏幕彼端（dsh-screen-beyond）交接记录

> 记录时间：2026-11-13  
> 当前源码版本：**0.7.13**  
> 交接对象：接手插件维护、测试、发布的人  
> 原则：本文件不含任何 API Key、密码、Git token 明文。

---

## 0. 一句话

`dsh-screen-beyond` 是一个“住在屏幕彼端的角色”插件：包含角色聊天、人设、记忆、日记、生活作息、地图、2D/3D 舞台、桌宠、她自己的 Linux 虚拟屏幕、Android 手机，以及 0.7.x 新增的“虚拟机社交软件聊天通道”。

---

## 1. 当前发布状态

| 项目 | 状态 |
|---|---|
| 源码版本 | **0.7.20** |
| Git main | `63d0cd1` |
| Git tag | `v0.7.20` |
| GitHub Release | `https://github.com/ljx200719/dsh-screen-beyond/releases/tag/v0.7.20` |
| npm latest | **0.7.20**（提交后需等 npm 审核可见） |
| npm 0.7.13 | 已上线 |
| npm 0.7.14 | 已上线但有金额显示 bug（勿用，等 0.7.16） |
| npm 0.7.15 | 审核中 |
| npm 0.7.16 | 已发布但有 forbidden site 回归（勿用） |
| npm 0.7.17 | 已发布但含 CSP 白屏问题（勿用） |
| npm 0.7.18 | 已发布但桌宠属性悬停修复不完整（勿用） |
| npm 0.7.19 | 已发布（属性面板常显版） |
| 发布产物 | `F:\屏幕彼端\发布产物\` |
| 最新备份 | 见 `D:\dsh-companion\backups\` 最新 `backup-*.zip` |
| 当前运行服务 | `http://127.0.0.1:8900` |

> 2026-11-13：第二轮全量修复随 **0.7.20** 提交（npm 审核中 / GitHub Release 已建），摘要见 §8.6，完整清单见 `docs/FIXES-2026-11-13.md`。

### 产物

- `dsh-screen-beyond-0.7.20.tgz`
- `dsh-screen-beyond-0.7.20.zip`
- `RELEASE-0.7.20.md`
- 源码目录已初始化 git，工作区干净

### 发布注意

- npm 曾经出现 **staged**：发布命令返回成功，但版本短时间不可见、不可重发。
- 处理方式：不反复重发同一版本，等它完成或发新版本号。
- `0.7.12` 曾进入 staged，后来可见；`0.7.13` 作为重新发布版本，现已上线。
- Git 凭据由 Windows Git Credential Manager 管理，不要写明文密码或 token。
- `0.7.14` 为 2026-11-13 审查修复版：安全（Origin 校验/路径穿越）、稳定性（运行时版本校验/生活模拟/桌宠）、前端与备份恢复修复，详见 `docs/FIXES-2026-11-13.md`。
- `0.7.15` 修复 `0.7.14` 的每日收入 `const` 赋值崩溃（经济/桌宠金额异常），并让插件在版本不一致时能自愈重启旧运行时。
- `0.7.16` 第二轮全量修复：账目（全局 token 账本/集中记账/换 Key 重置）、安全（Host/Sec-Fetch-Site/CSP、按键白名单）、稳定（回合取消/看门狗/上下文预算/异常兜底/sync 轮转）、设置-地图-舞台-看屏幕体验、VM 聊天功能补齐；详见 §8.6。
- **npm 新版本需要平台审核**：`publish` 返回成功不代表立即可见，`npm view` 暂看不到 latest 属正常，不要重复重发同一版本（等审核或发新版本号）。

---

## 2. 三种运行形态

| 形态 | 依赖 | 能力 |
|---|---|---|
| 纯聊天 | Node 18+、DeepSeek API Key | 聊天、人设、记忆、日记、地图/舞台、图片 |
| DSH 插件 · 无虚拟机 | DSH 0.2.x | 在纯聊天基础上作为侧栏插件运行 |
| DSH 插件 · 虚拟机 | DSH + VirtualBox + Android 模拟器 | 增加 Linux 虚拟屏幕、Android 手机、电脑控制、VM 聊天 |

关键设计：**没有虚拟机也必须能聊天、记记忆、发图、看地图/舞台**；虚拟机只增加“她自己的屏幕/手机/社交软件”。

---

## 3. 功能总表

### 3.1 角色与聊天

- 多角色：任意角色，不写死小鲸/小克
- 角色目录：
  - `meta.json`：名字、称呼、关系、外观、性格
  - `persona.md`：人设
  - `avatar.bin`：头像
  - `life-state.json` / `life-memory.json`
  - 每个角色独立聊天记录、记忆、日记
- 角色切换会切换人设、记忆、日记和聊天记录
- 聊天：短句、口语、主动消息、被动回复
- 图片消息：用户发图、角色发图
- 用户只发图片没文字时的策略：
  - 先描述看到什么
  - 再问“怎么了 / 发生什么了”
  - 不直接替用户回答
- 瞥屏幕策略：
  - 只描述看到什么
  - 不替用户操作、不直接回答
  - 等用户后续接话
- 记忆、日记、上下文摘要、token 预算、零花钱/经济系统

### 3.2 生活模拟

- 服务端持久化 `life-state.json`
- 真实时间行为：睡觉、吃饭、写作业、发呆、看书等
- 行为结束由 AI 决定下一步；失败回退本地规则
- 地点/热点/世界状态
- 主动事件判断、聊天消息、记忆记录
- 多角色同地点互动基础版
- 角色位置、路径、精力、心情
- `GET /api/life/state`、`/api/life/states`、`/api/life/settings` 等

### 3.3 地图、场景、舞台

- 多地图：内置 13 个地点 × 2 张地图
- 地图编辑：改名、新建、删除、导入、预览
- 地点：
  - 热点
  - 照片
  - 障碍
  - 可走区域
- 场景编辑器：
  - 背景图
  - 热点编辑
  - 照片 URL
  - 障碍画笔
  - 可走区域画笔
  - 2D/3D 切换
  - 3D 模型路径
- 同地点多角色头像横向分开；地图页有「👥 分开头像 / 收起头像」按钮
- 2D 舞台 + 3D 舞台（内置 three.js 预览）
- 内部场景 3D 接口：
  - `scene.mode: "3d"`
  - `scene.model3d: { url, scale, rotationY }`
  - 客户端 `window.DSH_SCENE_3D.register(fn)`
  - 没有注册渲染器时显示接口提示，不影响 2D

### 3.4 交通与跨地图

- 长途汽车 / 高铁 / 飞机
- 同地图移动即时；跨地图 30–150 分钟
- 车站 UI：目的地、距离、交通方式、票价、耗时
- 购票后进入 traveling
- 等待/晚点展示与实际购票时间一致
- 端点：
  - `GET /api/travel/options`
  - `POST /api/travel/ticket`

### 3.5 虚拟机社交软件聊天（重点）

详细文档：`docs/VM-CHAT.md`

能力：

- 主动消息可优先走虚拟机
- 自动唤醒 `DSH-Space`
- 动态检测社交软件：
  - `/usr/share/applications/*.desktop`
  - Categories：Network / Chat / InstantMessaging / Browser
  - 名称/可执行文件关键词
  - **不把 QQ 写死**
- AI 看虚拟机截图：
  - 选择应用
  - 看当前会话
  - 识别最近消息
  - 找输入框/发送按钮
  - 生成回复
- 冷启动：
  - 没运行就自动启动
  - 等 SSH/VNC/桌面
  - 没有可见聊天窗口时自动打开应用
  - 应用用 `setsid` 启动，SSH 断开不会杀掉
- 只认可见窗口，避免隐藏小窗口误判
- 登录/扫码验证识别：
  - 返回 `requiresLogin: true`
  - 不在登录页乱发消息
- 先查消息再行动：
  - 主动消息发送前先检查当前会话
  - 需要回先回
  - 再发主动消息
- 消息回写插件聊天页：
  - 用户消息
  - 自动回复
  - 按角色去重
- 设置：
  - VM 聊天开关
  - 看消息开关
  - 检查间隔
  - 发完自动存档关闭
  - 检测虚拟机
- 运行参数：
  - `DSH_COMPANION_VM`：虚拟机名
  - `DSH_COMPANION_VBOX`：VBoxManage 路径
  - `DSH_COMPANION_ENV` / `DSH_COMPANION_PY`：环境脚本目录/Python
- 应用兼容启动配置：
  - QQ 使用软件渲染和网络兼容参数
  - 其它应用走 `gtk-launch`
  - 这只是启动兼容，不是把业务逻辑绑定 QQ

### 3.6 她的屏幕 / 手机 / 电脑

- Linux 虚拟屏幕：`DSH-Space`，noVNC `http://127.0.0.1:6081/vnc.html`
- Android 模拟器：`DSH_Phone`，ADB 5554
- 电脑窗口控制：桌面内核 `pc` 工具
- 所有角色共享同一套屏幕/手机/电脑（已决定不做每角色独立屏幕；见 `docs/SCREEN-ISOLATION.md`）

### 3.7 图片

- 图片生成 provider：Seedream
- 聊天图片消息
- 角色照片/自拍类事件使用 `avatar.bin` 作为参考图
- 场景背景图 13 张内置
- 图片反馈开关、概率滑杆
- 图片失败不影响文字消息

### 3.8 数据、备份、同步

- 数据根：默认 `%USERPROFILE%\.dsh-companion`；本机配置为 `D:\linzhi`
- 备份脚本：
  `scripts/backup.ps1 -OutRoot ... -PluginDir ... -DataRoot ...`
- 恢复脚本：
  `scripts/restore.ps1 -BackupDir ...`
- 数据版本：`/api/data/revisions`
- 同步骨架：`/api/sync/*`、事件日志、设备令牌
- **注意**：手机/电脑离线独立 + 联网合并尚未实现；目前只有同步协议地基

---

## 4. 关键文件地图

```text
dsh-screen-beyond/
├─ package.json                 版本、npm 元数据
├─ cordis.patch.yml             DSH 插件注入
├─ lib/index.js                 DSH 客户端/宿主入口
├─ runtime/
│  ├─ server.mjs                主服务端（聊天/生活/地图/场景/VM API）
│  ├─ vm-chat.mjs               虚拟机社交软件通道
│  ├─ scenes.mjs                内置场景/热点映射
│  ├─ chat.html                 聊天页
│  ├─ map.html                  地图/场景/交通/VM 设置
│  ├─ settings.html             设置页
│  ├─ stage.html                2D 舞台
│  ├─ model/3D 舞台页面         3D 预览
│  ├─ screen.html               看屏幕
│  ├─ data-store.mjs            数据层
│  ├─ sync.mjs                  同步骨架
│  ├─ models/scenes/*.jpg       13 张场景图
│  ├─ models/*.glb              角色/演示模型
│  └─ vendor/                   three.js、GLTFLoader
├─ docs/
│  ├─ VM-CHAT.md                虚拟机聊天
│  ├─ 3D-INTERFACE.md           3D 接口
│  ├─ LIFE-SIM.md               生活模拟设计
│  ├─ ROADMAP.md                旧路线图（部分已完成项未更新）
│  ├─ INTERFACES.md             API 说明
│  ├─ MOBILE-SYNC.md            多端同步设计
│  └─ SCREEN-ISOLATION.md       屏幕隔离决定
├─ scripts/
│  ├─ backup.ps1
│  └─ restore.ps1
├─ start-pure-chat.cmd / .sh
└─ RELEASE-*.md
```

---

## 5. 主要 API

### 聊天 / 角色

- `GET /api/status`
- `GET /api/events?since=`
- `POST /api/chat`
- `GET /api/characters`
- `POST /api/characters`（switch/new/delete）
- `GET/POST /api/persona`
- `GET/POST /api/model`
- `GET/POST /api/context`
- `GET /api/memory`
- `GET /api/diary`
- `GET /api/economy`

### 地图 / 场景 / 舞台

- `GET /api/map`
- `POST /api/map/create|delete|activate|import`
- `GET /api/map/preview`
- `GET/POST /api/scene/settings`
- `GET/POST /api/scene/focus`
- `GET /api/scene/image`
- `GET /api/routine`
- `GET /api/weather`
- `GET /api/stage`
- `GET /api/stage/stream`
- `GET /api/model`（3D 舞台）
- `GET /api/screen/info`

### 生活

- `GET /api/life`
- `GET /api/life/state`
- `GET /api/life/states`
- `GET/POST /api/life/settings`
- `POST /api/life/act`
- `POST /api/life/position`
- `POST /api/life/tick`
- `POST /api/life/social`
- `POST /api/life-tick`

### 交通

- `GET /api/travel/options`
- `POST /api/travel/ticket`

### 虚拟机聊天

- `GET/POST /api/vm-chat/settings`
- `GET /api/vm-chat/status`
- `POST /api/vm-chat/wake`
- `POST /api/vm-chat/check`
- `POST /api/vm-chat/send`

### 同步 / 数据

- `GET /api/sync/info`（需要设备令牌）
- `GET /api/sync/events`
- `GET /api/sync/local`
- `GET /api/data/revisions`
- `POST /api/backup`

---

## 6. 虚拟机聊天流程

```text
主动事件/看消息触发
        ↓
检查 vmChat.enabled
        ↓
VM 是否运行？
  否 → VBoxManage startvm DSH-Space --type headless
        → 等 SSH/VNC/桌面就绪
        ↓
检测可见窗口和社交应用
        ↓
没有聊天窗口 → 启动检测到的应用
        ↓
截图 + 多模态 AI 看屏幕
        ↓
登录/扫码验证？
  是 → requiresLogin，禁止发送
  否 ↓
当前会话最近消息
        ↓
有用户消息且需要回 → 输入框坐标 → 点击 → 粘贴 → 回车
        ↓
回写插件聊天页（用户消息 + 角色回复，按角色去重）
        ↓
发主动消息（如有）
        ↓
根据设置：保持运行 / savestate
```

### 关键限制

- 原生 QQ 没有公开消息 API，读取依赖截图 + 视觉
- 冷启动/验证后需要用户扫码，插件不能绕过
- 当前会话靠 AI 识别，不能扫描所有未读会话
- 图片发送未接
- 不同社交软件 UI 不同，实际能力要逐个验证

---

## 7. 测试记录

测试日期：2026-11-13  
测试环境：Windows 11 + Node 24 + DSH + VirtualBox DSH-Space + QQ（LinuxQQ 3.2.32）

### 已通过

- Node 语法：
  - `runtime/server.mjs`
  - `runtime/vm-chat.mjs`
  - `runtime/scenes.mjs`
  - `lib/index.js`
  - 地图页内联脚本
- API GET 扫描：
  - 状态、角色、地图、生活、场景、旅行、经济、记忆、日记、设置、VM 设置/状态、事件
  - 全部目标接口 200
  - 无目标接口 500
- 页面：
  - `/` 聊天
  - `/map` 地图
  - `/settings` 设置
  - `/stage` 2D 舞台
  - `/screen` 看屏幕
  - `/model` 3D 舞台
  - 桌面 1600 宽、手机 390 宽
  - 页面控制台无报错
  - 无失败请求
- 地图：
  - 同地点头像按钮
  - 3D 场景 mock 渲染器
- 角色：
  - 小鲸 ↔ 小克切换
  - 聊天/生活状态不串
- 纯聊天：
  - 独立 8901 端口启动
  - 默认角色
  - 页面和 API 正常
- 虚拟屏幕：
  - VM 启动/存档
  - noVNC
  - QQ 登录/扫码
  - 软件渲染启动
  - 社交应用检测（QQ、Firefox 等）
  - 主动发送 `虚拟机自动发送测试`
  - 用户回复
  - 看最近消息
  - 自动回复
  - 聊天页回写
  - 冷启动自动启动 QQ（停在扫码验证页时返回 `requiresLogin`）
- 场景资源：
  - 13 张场景图 HTTP 200

### 未覆盖

- 其它操作系统（Linux/macOS 宿主）
- 其它虚拟机实现（Hyper-V/VMware）
- 其它社交软件实际发送
- 图片从宿主机发进聊天软件
- 长时间运行/多角色并发压力
- 真实手机客户端
- npm 审核机制

---

## 8. Bug 表单

### 8.1 已修复

| ID | 严重度 | 版本 | 模块 | 现象 | 根因 | 修复 |
|---|---|---|---|---|---|---|
| BUG-001 | 中 | 0.7.7 | 车站 | 按钮显示等待/晚点，购票时又随机一次 | 展示和购票各自取随机 | 购票沿用 UI 展示的 `waitMinutes/delayMinutes` |
| BUG-002 | 中 | 0.7.7 | 地图 | 画笔层盖住顶部关闭/完成按钮 | 画笔层 z-index 高于工具栏 | 顶部工具栏提高到 20 |
| BUG-003 | 中 | 0.7.7 | 图片 | 调整主动发图概率只改场景设置 | 没有同步 `lifeSim.photoChance` | 同时写场景和生活设置 |
| BUG-004 | 中 | 0.7.9 | 地图 | 同地点头像分开按钮不显示/分组不对 | 分组没有算当前角色 | 当前角色 + 同处角色一起分组 |
| BUG-005 | 高 | 0.7.11 | VM 聊天 | 虚拟机主动消息在聊天页看不到 | 写入插件记录时标了 `hidden` | 改为正常可见消息 |
| BUG-006 | 高 | 0.7.11 | VM 聊天 | 自动回复没有回写聊天页 | 检查流程只发 QQ，不调 `addMessage` | 检查结果回写用户消息 + 回复 |
| BUG-007 | 高 | 0.7.12 | VM 聊天 | 冷启动/主动发送后 QQ 被 SSH 断开杀死 | `nohup ... &` 在 PTY 关闭时被回收 | 改用 `setsid -f` |
| BUG-008 | 中 | 0.7.12 | VM 聊天 | 隐藏小窗口被当成聊天窗口 | 窗口检测包含不可见窗口 | 增加 `--onlyvisible` |
| BUG-009 | 中 | 0.7.12 | VM 聊天 | 点击坐标固定按 1280×800 算 | 分辨率写死 | 通过 `space_ctl.py res` 动态读取 |
| BUG-010 | 高 | 0.7.12 | VM 聊天 | 登录/扫码验证页被当成聊天页 | 只看“有没有窗口” | 识别验证文案，返回 `requiresLogin` |
| BUG-011 | 中 | 0.7.12 | VM 聊天 | 切换角色后消息去重会串 | 全局 `lastUserText` | 改为按角色 `lastUserByChar` |
| BUG-012 | 中 | 0.7.11/12 | VM 聊天 | AI 看屏幕偶发不返回 JSON | 长提示词推理占满 token | 短提示重试 + 解析容错 |
| BUG-013 | 高 | 0.7.12 | 发布 | npm 0.7.12 返回成功但版本不可见 | npm staged 窗口 | 不重复重发同一版本，0.7.13 重新发布 |
| BUG-014 | 中 | 0.7.12 | Git | 源码目录没有 git 仓库，GitHub 停在 0.6.7 | 一直只发压缩包，从未 init/commit/push | 初始化、同步、提交、打 tag、推送 |
| BUG-015 | 低 | 0.7.12 | 角色 | pet sprite 无当前角色时回退 `xiaojing` | 角色默认值写死 | 回退 `default`，不绑定具体角色 |
| BUG-016 | 低 | 0.7.12 | VM 聊天 | `space res` 输出 `1280 800` 解析失败 | 正则只认 `x` | 同时支持空格/`x` |
| BUG-017 | 中 | 0.7.12 | VM 聊天 | 社交软件检测输出被 4KB 截断 | `runPy` 输出上限 | 检测端先过滤，只返回候选应用 |

### 8.2 未修复 / 待决策

| ID | 严重度 | 模块 | 现象 | 影响 | 建议 |
|---|---|---|---|---|---|
| OPEN-001 | 高 | VM 聊天 | 冷启动后可能要求扫码验证 | 无法自动发送，卡片停在验证页 | UI 展示二维码/提醒；`requiresLogin` 已有，需要客户端提示 |
| OPEN-002 | 高 | VM 聊天 | 只读当前会话，不扫描所有未读 | 群聊/其他联系人消息可能漏 | 扫描未读角标，按优先级切换会话 |
| OPEN-003 | 高 | VM 聊天 | 图片不能发送 | 只能文字 | 宿主机图片传 VM，剪贴板/文件发送 |
| OPEN-004 | 中 | VM 聊天 | 无应用健康守护 | QQ 崩溃后不自动重启 | 加 watchdog + 重启 + 重新打开会话 |
| OPEN-005 | 中 | VM 聊天 | 目标会话靠“最后会话” | 可能发错人 | 增加目标联系人配置/白名单 |
| OPEN-006 | 中 | VM 聊天 | 不同软件 UI 未适配 | 只能保证 QQ 实测 | 浏览器 DOM/AT-SPI/适配器层 |
| OPEN-007 | 中 | 自动化 | AI 坐标点击受布局影响 | 布局变化容易失败 | 优先 accessibility/selector，坐标仅兜底 |
| OPEN-008 | 中 | 部署 | VM 依赖 `D:\dsh-env` / VirtualBox | 换机要重新准备 | 文档化 env 安装；保持 bundled env 回退 |
| OPEN-009 | 中 | 跨平台 | 未在非 Windows 宿主测试 | 不保证 | 至少 Linux 宿主 + 纯聊天模式测试 |
| OPEN-010 | 中 | 图片 | 只有 Seedream 实测 | 换 provider 可能不兼容 | 明确 provider 支持矩阵 |
| OPEN-011 | 中 | 模型 | 只保证 DeepSeek | 换模型工具循环/推理字段可能异常 | 固定已验证模型，其它标注未验证 |
| OPEN-012 | 低 | 3D | 只有接口，没有内置渲染器 | 3D 场景要外部实现 | 提供示例 renderer/资源管线 |
| OPEN-013 | 低 | 场景 | 只有矩形障碍/可走区域，无撤销/多边形 | 精细布局受限 | 笔刷、网格、撤销 |
| OPEN-014 | 低 | 骨骼 | 行为只有位置/计时，无动作动画 | 睡觉/吃饭只是站着 | 接骨骼资源和动作状态机 |
| OPEN-015 | 低 | 同步 | 无手机/电脑离线合并 | 多端只能远程访问 | 按 `docs/MOBILE-SYNC.md` 分期做 |

### 8.3 Bug 提单模板

接手后新增问题请按这个格式：

```text
ID：
日期：
版本/commit：
环境（系统/模型/VM/浏览器）：
严重度：致命/高/中/低
模块：
复现步骤：
预期：
实际：
日志/截图路径：
根因（初步）：
修复方案：
验证结果：
是否回归：
```

---

### 8.4 2026-11-13 审查修复（0.7.14 → 0.7.15）

> 完整清单与验证证据见 `docs/FIXES-2026-11-13.md`。

| 分类 | 修复内容 | 验证 |
|---|---|---|
| 环境 | 清理早期「林芝运行时」开机自启项/旧实例/调试计划任务；端口文件恢复 8900 + 0.7.13 | 页面全 200，`/info` ok:true |
| 安全 | `/api/*` 与 SSE 增加 Origin 校验（非回环 403、回环回显 ACAO）；角色删除与 characterId 接口白名单+路径前缀校验；JSON 读取剥 BOM | 恶意 Origin 403；穿越删除 400 |
| 稳定性 | 插件健康检查校验版本+数据根（旧运行时会停掉重启）；`lifeTick` const 修复；`petRunning` 去同步子进程；`readBody` Buffer/413；wallet 字段保留；备份结果真实返回；`historyMode` 三端对齐；travel/memory 参数 clamp | 隔离冒烟 15/15 |
| 前端 | map 二次编辑丢数据/请求风暴/空热点崩溃/XSS 面；chat 吞输入/图片限额/防连点；settings 默认值回写/权限弹回/非法 hash；model/stage 高频泄漏与增量渲染；screen 电源按钮/noVNC 恢复 | 内联脚本语法全过 |
| 桌宠 | 切换角色不再重复下载/全尺寸解码：sprite 缓存命中、WebClient 下载、DecodePixelWidth、位图缓存、头像版本缓存 | pet.log：切换加载 6~10ms（此前约 1~2s） |
| 脚本 | `restore.ps1` 恢复改目录内容合并（原写法生成 lib\lib 等于没恢复）；backup 补 data/images、screens、pet；ps1 存 UTF-8 BOM | Parser 0 错误 |

### 8.5 仍未处理

设置页脏检查重构、map 道路草稿/编辑器坐标基准/未保存覆盖、model WebGL 兜底与相机自适应、VM 聊天图片发送、`confirmDanger` 白名单化、API 一次性 token、`image-api-key.txt` 明文迁 DPAPI、`events.jsonl` 轮转；`runtime/assets/pet/xiaojing|xiaoke-*` 旧资源仍按角色名命名（代码已能回退）。
### 8.6 2026-11-13 第二轮全量修复（0.7.16）

> 完整清单与验证证据见 `docs/FIXES-2026-11-13.md` 第十节。

| 分类 | 修复内容 |
|---|---|
| 账目 | token 用量改为全局账本 `data/token-usage.json`（切角色一致）；所有模型调用集中记账（此前生活/日记/记忆/VM 视觉不记）；换 API Key 重置"今日消耗"基准；金额文案区分真实余额/今日约/虚拟零花 |
| 安全 | Host 头与 DNS rebinding、`Sec-Fetch-Site: cross-site` 拒绝、CSP `frame-ancestors`；`space` 按键白名单（服务端+脚本层 shlex）；危险命令黑名单扩充；`avatar.png?c=` 白名单 |
| 稳定 | `/api/chat` 回合总超时（5min）+ `/api/chat/cancel` + typing 看门狗；说话中禁止切角色（409）；上下文图片最多 4 张/24MB；进程级异常兜底；`sync/events.jsonl` 8MB 轮转；economy/vm-chat-status/stage-stream 缓存 |
| 体验 | 设置页脏检查/危险确认/读失败禁存/数字校验/按钮防重入；地图保存 roads/脏标记/场景节流/隐藏暂停/坐标 3:2；舞台 WebGL 兜底/包围盒/双指缩放；看屏幕手机页签真图、启动轮询 90s、pc 截图内核缺失时兜底；桌宠高 DPI 不回屏外 |
| VM 聊天 | 联系人白名单、未读扫描、图片发送（SFTP+剪贴板）、应用健康守护、发送后校验、登录提示、SSH 密码 `DSH_COMPANION_SSH_PASS` 可配 |
| 工程 | `package.json` engines/`npm run check`；ROADMAP 过时说明；数据根旧覆盖源归档 |

**仍未处理（已知限制）**：`api-key.txt`/`image-api-key.txt` 仍是明文（未接 DPAPI）；`config.json` 仍单文件全量写；备份/恢复仍无 UI 入口；`runtime/assets/pet/xiaojing|xiaoke-*` 资源仍按角色名命名（代码已可回退）；端口文件仍是全局单例；VM 聊天发送/图片链路需登录 QQ 后才能真机验证；无 ESLint/自动化测试/CI。### 8.7 2026-11-13 0.7.17 热修（forbidden site + 她的屏幕黑屏）

- **页面全黑 "forbidden site"（回归，P0）**：0.7.16 的安全加固无条件拒绝 `Sec-Fetch-Site: cross-site`，把 DSH 面板 iframe 加载运行时页面的导航请求也拦了。修复：只拦"没有可放行 Origin 的脚本类跨站请求"，页面导航放行，本机回环 Origin 的 fetch 正常放行并回 CORS 头。
- **她的屏幕全黑（P0）**：VM 内 `x11vnc` 掉线（websockify 还在）时，旧的 TCP 6081 探测仍报"正常"，noVNC 打开就是黑屏；虚拟机闲置后 DPMS 关屏也会全黑。修复：`/api/screen/space/status` 改读 VM 内真实链路（x11vnc/websockify/6080，5s 缓存）；`ensure` 后按链路判定成功；启动看护 60s 巡检真实链路、断了自动修；`ensure` 时关闭 DPMS/屏保；看屏幕页恢复后自动重载 noVNC 画面。
- 账目修复（全局 token 账本/集中记账/换 Key 重置）与 0.7.16 相同，不受影响。
### 8.8 2026-11-13 收尾（0.7.17 本地后继，未发布）

- **面板白屏彻底修复**：删掉 `Content-Security-Policy: frame-ancestors`（Electron 宿主来源会把 iframe 拦成纯白），并去掉 iframe `loading=lazy`；真实浏览器 iframe 嵌入实测正常渲染。
- **VM 聊天视觉识别修复（P1）**：deepseek 推理模型偶尔把 token 全花在 reasoning_content 上、content 为空（finish_reason=length），导致「AI 没有看懂屏幕」。`chatCompletion()` 遇到空 content+length 自动加预算重试一次；vm-chat 解析同时兜底 reasoning_content，并把视觉调用预算提到 3600/3000。实测 analysis 恢复（app=QQ、未读会话 3 条、composer 位置可识别）。
- **VM 聊天登录页保护（P0）**：新增 `requiresLogin` 判定（无当前会话/无 recent/note 含登录扫码验证码）与 `validPoint()`（0,0 视为无效坐标）；停在扫码页时发送/发图直接拒绝。实测：两次发送都返回「虚拟机聊天停在登录/扫码页」，截图确认没有误输入任何文字。
- **可选 API token**（默认关，`DSH_COMPANION_API_TOKEN`）：开启后 `/api/*` 需 `x-companion-token` 或页面 cookie；HTML 响应下发 HttpOnly cookie；端口文件带 token；面板 client.js 自动取 token（`/api/token`）。
- **可选 DPAPI 密钥加密**（默认关，`DSH_COMPANION_ENCRYPT_KEYS=1`）：新增 `runtime/env/dpapi.ps1`（UTF-8 stdin/stdout 已处理），`readSecretFile/writeSecretFile` 读写 `api-key.txt` / `image-api-key.txt`，启动时自动迁移明文；中文密钥往返测试通过。
- **备份恢复 UI**：`GET /api/backup/list` + `POST /api/backup/restore`（校验 `backup-YYYYMMDD-HHMMSS.zip`，复用 `scripts/restore.ps1`）；设置页新增备份列表与「恢复」（两次确认）。**恢复流程未在真数据上执行验证**。
- **工程化**：新增 `scripts/smoke-test.mjs`（隔离实例：6 页 + 安全矩阵 + token 模式 + DPAPI 加密，22/22 通过）、`eslint.config.mjs` 与 `lint`/`smoke` 脚本（eslint 依赖未安装，本机无 npm）。
- **小修**：设置页图片配置保存不再整页重绘（不冲掉未保存模型参数）；桌宠换形象改静默重启（去掉双重确认）；地图删除无入口死函数。
- **页面渲染检查**：headless Edge 截图 map/model/stage/screen/settings 均有内容（settings 已含备份区）；chat 页在 headless 下截图超时，但真实 Edge iframe 嵌入测试已确认聊天 UI 正常。
- 已知未做：eslint 依赖未安装；恢复未实测；VM 聊天发送/图片需登录 QQ 后真机验证；`config.json` 仍单文件；npm 未发布（等用户指示）。
- **eslint**：`pnpm add -D eslint` 已装（9.39.5，本地 node_modules，不随包发布）；`npm run lint`（本机需用 node 直接跑 `node node_modules/eslint/bin/eslint.js runtime lib scripts`，因为 PATH 里没有 node）；配置里 no-undef 关闭（Node/浏览器全局混用），其余规则生效。`r`n- **桌宠 UI（2026-11-13 19:35 追加）**：去掉悬停手势 tooltip；状态面板（悬停显示）新增「余额 ¥x · 今日 ¥y」行；右侧三个按钮整体上移（btnTop 100→64）。`r`n### 8.9 2026-11-13 配置拆分 / 桌宠素材 / 低余额提醒

- **config.json 拆分 + 原子写**：设置写 `config.json`（约 5KB），世界状态（worlds/maps/map/activeMapId/location）写 `data/world.json`；两者都用 `tmp+rename` 原子落盘并做内容变更去抖。旧单文件在启动时自动迁移（迁移前已备份 `config.pre-split-*.json`）。实测迁移后地图 2 张、位置 canteen 正常，config.json 86KB → 5KB。
- **桌宠素材目录化**：`runtime/assets/pet/<角色>/<idle|look|pat|rub>.png` + `default/` 兜底；服务端按 新目录 → default → 旧命名 的顺序解析，老安装不受影响。实测 `/pet-sprite/idle.png` 返回新目录素材。
- **桌宠金额不再直接显示**：隐藏金额胶囊（tokenPill），把真实余额 / 今日消耗 / 今日 token / 零花放进「状态」文字的悬浮提示里。
- **低余额主动提醒**：新增 `CONFIG.balanceAlert`（enabled / thresholdRmb 默认 5 / cooldownMin 默认 360 / lastAt）。后台每 10 分钟检查一次真实余额，低于阈值时她主动发一条提醒消息（有冷却防刷屏，force 可绕过）；设置页「经济」卡片新增开关、阈值、冷却输入与「保存」「发一条测试」按钮。实测阈值临时设为 100 时提醒消息成功写入聊天（role=her），随后恢复阈值 5。
- **备份脚本**增加 `data/world.json`。
### 8.10 2026-11-13 0.7.18 发布（含桌面端收尾）

- **桌宠属性面板悬停修复**：WPF 透明窗口里 `Canvas` 无背景不参与命中测试，悬停空白区收不到鼠标事件；窗口内容改为 alpha=1 近透明背景（肉眼不可见但可命中），整个窗口悬停都会显示属性面板（名字/地点/活动/精力/余额）。
- **桌宠 UI**：移除悬停手势 tooltip（摸摸头 · 搓一搓 · 戳一下 · 看屏幕）；右侧三个按钮上移（100→64）；余额/今日消耗移入属性面板，不再常显。
- **eslint**：`pnpm add -D eslint`（9.39.5，本地 node_modules，不随包发布）；`no-undef` 关闭后 lint 0 error / 55 warning（unused-vars）。
- **配置拆分**：`config.json`（约 5KB）+ `data/world.json`（约 81KB），原子写 + 内容去抖，启动自动迁移旧单文件；备份脚本包含 world.json。
- **低余额提醒**：`CONFIG.balanceAlert`（默认阈值 5 元、冷却 360 分钟），后台 10 分钟检查，低于阈值她主动发消息；设置页经济卡片可改阈值/冷却并有测试按钮。
- **交接文件**：`屏幕彼端-交接报告-2026-11-13.docx`、源码包、npm 包、数据备份（均在 `F:\屏幕彼端\发布产物\`）。
### 8.11 2026-11-13 0.7.19 桌宠属性面板修复

- **问题**：0.7.18 里给透明窗口内容加了 alpha=1 背景并绑定 MouseEnter/Leave，但 WPF `AllowsTransparency` 的命中测试在部分环境仍不可靠，悬停大概率收不到事件 → 属性面板不显示（用户反馈"依然没有"）。
- **修复**：属性面板改为**默认常显**（名字/地点/活动/精力/余额），悬停只做高亮（opacity 1 ↔ 0.86）；再加 `GetCursorPos + GetWindowRect` 每 120ms 光标轮询兜底，不依赖 WPF 鼠标事件。
- **验证**：pet.log 记录 `hover True/False` 与面板状态（Visible/Opacity/5 个胶囊/left=12 top=80）；截图确认桌宠左侧常显「小鲸 / 🛒 超市 / 玩游戏 / 精力不足 / 余额 ¥6.56 · 今日 ¥…」。
### 8.12 2026-11-13 0.7.20 桌宠属性按钮

- 属性面板（名字/地点/活动/精力/余额）默认常显，悬停高亮加深。
- 右侧按钮新增第 4 个「属性」：点击显示/隐藏属性面板（`Toggle-AttrPanel`，隐藏时忽略悬停自动显示）。
- 截图确认：桌宠右侧为 chat / look / 大小 / 属性 四个按钮，左侧属性胶囊常显（小鲸 / 🛒 超市 / 玩游戏 / 精力很足 / 余额 ¥6.23 · 今日 ¥…）。
## 9. 接下来计划

### P0：虚拟机聊天闭环

1. **登录验证 UX**
   - 把 `requiresLogin` 显示在设置/状态栏
   - 提供刷新二维码/打开 VNC 的入口
   - 验证页暂停自动发送，避免误点
2. **未读扫描**
   - 读聊天列表未读角标
   - 按未读/最近联系人选择会话
   - 处理群聊和多个联系人
3. **图片发送**
   - 宿主机生成图片 → SFTP 到 VM → 剪贴板/文件发送
   - 发送前确认目标会话
4. **应用健康守护**
   - 检测进程/窗口消失
   - 自动重启应用
   - 失败后回退插件聊天页
5. **目标联系人配置**
   - 设置里配置“和谁聊”
   - 白名单，避免发错

### P1：通用性与稳定性

- 应用适配器接口：
  - `detect()`
  - `open()`
  - `readRecent()`
  - `send()`
  - `requiresLogin()`
- 优先 accessibility/DOM，截图坐标只兜底
- 浏览器网页聊天适配
- 消息水位持久化，重启不重复回复
- 长任务取消/超时/并发锁
- 服务器与本机环境解耦：env 自动探测、失败可诊断
- 增加自动化测试脚本（不依赖真实 QQ）

### P2：内容与表现

- 骨骼动画 / 行为动作资源
- 热点内置图片
- 3D 场景内置 renderer 示例
- 场景编辑器图层/撤销/多边形
- 独立场景事件频率
- 角色多参考图/固定形象控制

### P3：多端

- 手机/电脑离线独立 + 联网合并
- 冲突合并 UI
- 设备身份/事件日志正式客户端

---

## 10. 运行与恢复

### 纯聊天

```powershell
cd F:\屏幕彼端\插件最新版\dsh-screen-beyond
.\start-pure-chat.cmd
# 或
$env:LINZHI_PORT='8900'
node runtime\server.mjs
```

### DSH 插件

```powershell
dsh plugin --profile desktop add link:F:\屏幕彼端\插件最新版\dsh-screen-beyond
# 或 npm
dsh plugin --profile desktop add dsh-screen-beyond
```

### 备份

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  F:\屏幕彼端\插件最新版\dsh-screen-beyond\scripts\backup.ps1 `
  -OutRoot D:\dsh-companion\backups `
  -PluginDir F:\屏幕彼端\插件最新版\dsh-screen-beyond `
  -DataRoot D:\linzhi
```

### 恢复

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File `
  F:\屏幕彼端\插件最新版\dsh-screen-beyond\scripts\restore.ps1 `
  -BackupDir D:\dsh-companion\backups\backup-YYYYMMDD-HHMMSS
```

### 发布

```powershell
# 构建
npm pack
# 发布前确认版本、README、RELEASE
npm publish --access public
# git
git add -A
git commit -m "Release vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin main
git push origin vX.Y.Z
```

注意：

- 全局代理 `127.0.0.1:7890` 可能没开；GitHub 直接连接可用
- 发布 npm 后检查 `npm view dsh-screen-beyond version`
- 若返回 staged/不可见，不要反复重发同一版本
- Git 凭据由 GCM 管理

---

## 11. 接手须知（重要）

1. **不要写死角色**
   - 不要在小鲸/小克/具体 ID 上写业务逻辑
   - 用 `listCharacters()`、`charDir(id)`、`meta.json`、`persona.md`
2. **改代码前先备份**
   - `scripts/backup.ps1`，输出到 `D:\dsh-companion\backups`
3. **不要提交/发送密钥**
   - API Key、QQ 密码、Git token 不进聊天记录、不进仓库、不进长期记忆
4. **虚拟机是可选能力**
   - 没有 VM 时，插件其它功能必须正常
   - VM 失败时回退插件聊天页，不静默丢消息
5. **消息同步**
   - VM 通道和插件聊天页要一致
   - 去重按角色，不要用全局状态
6. **版本约束**
   - 当前 0.7.x；不要擅自跳 0.8
7. **模型约束**
   - 已验证 DeepSeek；其它 OpenAI 兼容模型未验证
8. **图片约束**
   - 图片失败不能阻塞文字
   - 角色参考图只在人像/自拍提示时使用
9. **发布**
   - 先 git，再 npm
   - 检查 GitHub Release 资产
   - staged 状态不要重复重发同版本

---

## 12. 常用路径

| 用途 | 路径 |
|---|---|
| 源码 | `F:\屏幕彼端\插件最新版\dsh-screen-beyond` |
| 发布产物 | `F:\屏幕彼端\发布产物` |
| 数据根 | `D:\linzhi` |
| 备份 | `D:\dsh-companion\backups` |
| 环境脚本 | `D:\dsh-env` |
| 虚拟屏幕 | `DSH-Space`，SSH 2222，VNC 6081 |
| 安卓手机 | `DSH_Phone`，ADB 5554 |
| 本地服务 | `http://127.0.0.1:8900` |

---

## 13. 本次交接结论

- 核心功能闭环已完成
- 虚拟机聊天从“只能看”推进到“能发、能看最近消息、能回、能回写聊天页”
- Git / GitHub Release / npm 0.7.13 已发布
- 剩余问题主要是外部账号验证、跨应用适配、图片发送和高级内容资源，不是聊天核心链路阻塞
- 下一接手人优先做 P0：登录验证 UX、未读扫描、图片发送、应用健康守护
- **0.7.14（2026-11-13）**：审查修复版已发布，补齐 §8.4/§8.5；剩余优化项见 `docs/FIXES-2026-11-13.md` 第五节
- **0.7.15（2026-11-13）**：紧急修复 0.7.14 的每日收入崩溃（经济/桌宠金额），并补强插件"版本不一致自动重启旧运行时"；npm 审核中
