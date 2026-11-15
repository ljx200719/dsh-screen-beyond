# 聊天软件直连 · 使用与改造指南（顾客版）

> 直连 = 她不用再「看虚拟机屏幕」，而是通过 **OneBot 11 HTTP 接口**直接收发 QQ 私聊。
> 插件本身**不内置、不捆绑、不启动任何桥**；桥装不装、用哪个，由你决定。风险也由桥承担。

---

## 一、两条路，选一条

### A. 你自己已有的 OneBot 11 桥（推荐，有现成的最好）

把本机任何能跑 OneBot 11 HTTP 的实现（NapCat / Lagrange / LLOneBot / 自建…）地址填进来即可。

设置路径：**设置 → VM → 聊天软件直连**

| 字段 | 说明 |
|---|---|
| 服务地址 | 如 `http://127.0.0.1:3000`（不带结尾斜杠） |
| Token | 桥要求的 access token；没有就留空 |
| 对方 QQ 号 | 只有从这个号发来的私聊才会被她处理（防止别人调戏） |
| 她的 QQ 号 | 桥登录的机器人号（可选，用来过滤她自己发的消息） |

桥需要支持这几个接口（插件只用到这些）：

- `POST /get_login_info`（测试连接）
- `POST /send_private_msg`（她发消息；body：`{user_id, message:[{type:'text',data:{text}}]}`）
- 入站消息由桥 `POST` 到运行时的 `http://127.0.0.1:8900/api/direct-chat/event`（事件格式：OneBot 11 私聊消息 JSON）

### B. 用我们写的「自建桥」（研究分支已打通，需要自己装，约 10 分钟）

背景：2026 年这批现成桥基本被清掉了——NapCat 仓库/releases 清空、Lagrange 官方签名服务停、LLOneBot 转收费。所以走「官方 QQ 客户端**内存注入**」路线做了个最小桥（和 NapCat 同思路，但**不改 QQ 文件**）。

#### B1. 需要装什么

| 东西 | 说明 |
|---|---|
| Windows + 官方 QQNT **9.9.37** | 必须是这个版本（新版可能改动内部结构；换版本请自测） |
| QQ 便携副本 | 从 `C:\Program Files\Tencent\QQNT` 整个复制到别的盘（如 `F:\onebot\QQ-portable`），**不要动 C 盘的官方 QQ** |
| Java 21（可解压版） | 注入器 `TzdInjectorNTQQ` 是 Java + JNI；解压版 JDK 即可，不用装到系统 |
| 注入器 | `ElectronInjector.jar` + `ElectronInjector_windows_x64.dll`（LGPL-3.0，开源） |
| 桥代码 | 本仓库 `docs/self-bridge/`（`shell2.js`、`bridge-core.js`、`start-bridge.ps1`、`sbc-eval.mjs`、`e19.js`） |

#### B2. 怎么跑

1. 便携副本里登录**机器人小号**（别用主号；首次登录可能要在手机上确认）；
2. 打开 PowerShell，跑：

```powershell
powershell -ExecutionPolicy Bypass -File <桥目录>\start-bridge.ps1
```

脚本会：注入调试壳（会弹出几个「线程数量 / APC提交结果 / V8 Context Found」确认框，脚本会自动点掉）→ 起桥 → 打印 `/get_login_info` 结果。

3. 插件里填：地址 `http://127.0.0.1:3010`、Token 留空、对方 QQ 号 = 你自己（aedo）的号、她的 QQ 号 = 小号；
4. 点「测试连接」→ 应显示小号昵称；点「发测试消息」→ 你自己的 QQ 会收到一条消息。

#### B3. 注意什么（重要）

- **注入类方案有风险**：QQ 更新/风控可能让它失效甚至影响账号；**只建议给小号用**，主号别用。
- **QQ 一重启，桥就没了**：需要重新跑 `start-bridge.ps1`（桥是内存里的，不是服务）。
- **只支持单个会话的文本消息**：当前固定和「对方 QQ 号」那个人的聊天窗口；图片、表情、群聊、多会话都还没做。
- 插件侧：直连失败会按设置回退虚拟机通道；不想用就把「启用直连」关掉。
- 便携副本建议放在非 C 盘，整个目录删掉即可彻底清理；官方 QQ 不受影响。

#### B4. 想继续改（给会改代码的人）

桥的所有文件都在仓库里，直接改：

| 想改什么 | 改哪里 |
|---|---|
| 对方 QQ 号 / 她的号 / 端口 / 轮询间隔 | `docs/self-bridge/bridge-core.js` 顶部 `CFG` |
| 桥监听的 OneBot 接口、事件格式 | `bridge-core.js` 里的 HTTP server 段 |
| 发消息/收消息的 DOM 选择器（QQ 改版后可能要调） | `bridge-core.js` 的 `jsSend` / `jsRead` |
| 注入器的调试服务 | `docs/self-bridge/shell2.js`（3057 端口，`/eval` 可执行任意 JS，研究用） |
| 让它支持多会话/图片/群聊 | 需要从 DOM 级升级到 `wrapper.node` 原生 API（hook `NodeIQQNTWrapperSession.create` 拿 session），参考 `docs/SELF-BRIDGE-RESEARCH.md` 第 6 节 |

---

## 二、常见问题

| 现象 | 排查 |
|---|---|
| 测试连接失败 | 桥没起：`curl http://127.0.0.1:3010/ping`；端口被占；便携 QQ 没登录 |
| 能连上但收不到消息 | 桥只读当前打开的会话：确认便携 QQ 窗口里开的是「对方 QQ 号」的聊天窗；QQ 改版导致 DOM 选择器失效 |
| 能收不能发 | 输入框/发送按钮选择器失效（同上）；或 QQ 正在输入法状态 |
| 重启电脑后失效 | 重新跑 `start-bridge.ps1`（正常现象） |
| 想彻底删掉 | 关便携 QQ → 删整个 `F:\onebot` → 插件里关掉直连 |

---

## 三、和虚拟机通道的关系

- 直连**不替代**虚拟机通道：直连关着/失败时，她仍然可以用原来的「看虚拟机屏幕 + 点击」方式聊天。
- 主动消息优先走直连、失败按设置回退（设置里有开关）。
- 两个通道都开着也可以，但同一时间只建议留一个，避免她收到同一条消息两次。

---

## 四、文件位置

- 自建桥研究记录与限制：`docs/SELF-BRIDGE-RESEARCH.md`
- 桥代码/脚本：`docs/self-bridge/`
- 实际运行目录示例：`F:\onebot\next\`（JDK、注入器、日志都在这里，可整目录删除）


## 五、限制清单（硬边界，2026-11-15）

| 限制 | 说明 | 能不能绕过 |
| --- | --- | --- |
| 只建议小号 | 注入类方案有风控/封号风险 | 不能，风险自担 |
| 内存注入、非服务 | QQ 退出/重启/更新后桥消失 | 用 `bridge-supervisor.ps1` 每 20 秒自动检测并重注入（QQ 未登录救不回） |
| QQ 文件不能改 | 9.9.37 对 application.json / version.json 有 Ed25519 签名，改就报「文件已损坏」 | 不能；只能运行时注入 |
| 单会话私聊、纯文本 | 只认固定对方 QQ；群聊/图片/文件未实现 | 需要继续开发 |
| 依赖 QQ 界面 DOM | 需要消息页可打开；QQ 改版可能让选择器失效 | 需要跟进适配 |
| 只监听 127.0.0.1 | 不暴露公网；token 可选（默认空=本机免鉴权） | 有意为之 |
| 延迟 | 入站轮询约 1.2 秒；发送串行 + 最小间隔 0.9 秒 | 可调 `bridge-core.js` 里的 pollMs / minSendGapMs |

## 六、自检与排障

1. `GET http://127.0.0.1:3010/ping` → `{ok:true, version}`（进程活着）
2. `POST http://127.0.0.1:3010/get_status` → 看 `chatWindow`、`events`、`lastError`、`lastSendAt`
3. 插件 设置→VM→聊天软件直连 → 「测试连接」→「发测试消息」
4. 掉线：跑 `bridge-supervisor.ps1`；想看日志看 `F:\onebot\next\bridge.log` 与 `bridge-supervisor.log`
5. 想开机自启：`install-supervisor.ps1` 注册登录计划任务；卸载 `schtasks /Delete /TN "SBCBridgeSupervisor" /F`

## 七、桥版本变化（0.2.0）

- 发送串行队列 + 最小间隔 + 失败重试 2 次
- 发送前自动切会话、等输入框就绪、发送后校验输入框已清空
- 收消息签名去重（10 分钟 TTL），切会话时把历史当基线，不把旧消息当新消息
- 渲染进程执行超时（8 秒）；聊天窗口重载后自动重新定位 webContents
- `/get_status` 返回自检数据；端口占用/服务异常自动重试监听
- 日志超 2MB 自动轮转
