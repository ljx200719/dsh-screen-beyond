# 自写 QQ 桥 · 研究记录（2026-11-15 凌晨）

> 状态：**原型打通（MVP 已验证收发闭环）**，但**没有集成进插件**，属于研究分支。
> 原则：不改 QQ 文件、不装系统服务、只用 F: 上的便携副本；所有实验文件都在 `F:\onebot`，可整目录删除。

---

## 1. 为什么自己写

2026 年 11 月前后，现成的 OneBot 实现基本被清掉：

- **NapCat**：仓库只剩 README，releases 全部消失；
- **Lagrange.OneBot**：官方签名服务 `sign.lagrangecore.org` 停服（登录直接失败）；
- **go-cqhttp v2**：签名服务要求授权头（`all sign down`）；
- **LLOneBot / LuckyLillia**：商业化，需要付费 Auth Token；
- **SnowLuma**：能用，但属于要绑定的外置桥（用户明确不想绑）。

于是走「**官方 QQ 客户端注入**」路线（和 NapCat 同思路），但只做插件需要的最小集合。

## 2. 为什么不能改 QQ 文件

QQ 9.9.37 用 **Ed25519 签名**校验核心文件：`resources/app/application.json` 和 `versions/<ver>/version.json` 里存的是 64 字节签名（不是哈希），改 `package.json` 会直接「文件已损坏，请重新安装QQ」。LiteLoaderQQNT 用的 dbghelp.dll 劫持补丁（2024 年）对 9.9.37 无效。

**结论：必须「内存注入」，不能碰文件。**

## 3. 当前方案（已跑通）

```
F:\onebot\QQ-portable            QQ 9.9.37 便携副本（从 C 盘官方安装复制，独立运行、不顶主号）
   └─ QQPortable.exe             登录她的号（芝芝 3762970669）
        └─ Java 注入器            TzdInjectorNTQQ（LGPL-3.0，JNI 远程线程注入，零文件修改）
             ├─ shell2.js         在 QQ 主进程里起调试 HTTP 服务（127.0.0.1:3057，供研究用）
             └─ bridge-core.js    在 QQ 主进程里起自建桥（127.0.0.1:3010，OneBot 11 子集）
                   ├─ 收消息：electron.webContents.executeJavaScript 读 QQ 渲染层消息 DOM
                   ├─ 发消息：executeJavaScript 往输入框写文本 + 点「发送」
                   └─ 与插件：标准 OneBot 11 HTTP（get_login_info / send_private_msg / 事件 POST）
```

插件侧不用改代码：设置 → VM → 聊天软件直连，地址 `http://127.0.0.1:3010`、token 留空、对方 QQ 号 = aedo 的号即可。

## 4. 已验证（2026-11-15 03:47 ~ 03:51 实测）

| 项目 | 结果 |
|---|---|
| 注入 QQ 9.9.37 主进程 | ✅ 注入成功，能执行任意 JS（Node v24、wrapper.node 全部内核导出可见） |
| 桥 HTTP `/get_login_info` | ✅ 返回 `3762970669 / 芝芝`，插件「测试连接」通过（1ms） |
| 插件 → 桥 → 真发消息 | ✅ 插件「发测试消息」出现在 aedo 的 QQ 聊天里（截图） |
| aedo 回消息 → 桥收 → 运行时 → 她自动回复 | ✅ 完整闭环（截图 + 日志：收 03:51:29、回 03:51:32） |
| 对文件的影响 | 无（仅内存注入；QQ 文件一个字节没改） |

证据：
- `docs/self-bridge/` 下是注入脚本与桥代码（可复现）；
- 截图：`%USERPROFILE%\AppData\Local\dsh-desktop\screenshots\2026-11-15\capture_330676_20261115_035147_414309.png`（aedo 端看到收发）；
- 日志：`F:\onebot\next\bridge.log`。

## 5. 限制（为什么还不算产品）

1. **DOM 级实现**：发消息靠操作 QQ 渲染层输入框 + 点发送，收消息靠读消息列表 DOM；QQ 更新改界面就可能失效（但不会崩，只是不工作）。
2. **需要每次启动重新注入**：注入器是内存级的，QQ 重启就没了，必须重跑 `start-bridge.ps1`。
3. **需要 Java**：注入器是 Java + JNI（JDK 解压在 `F:\onebot\next`，200MB）。
4. **只支持单聊文本**：当前固定和 aedo 的会话；图片、群聊、富媒体没做。
5. **账号风险**：注入类工具仍可能被 QQ 安全中心识别（NapCat 生态被清就是这个原因），建议只用小号。
6. **许可**：注入器 TzdInjectorNTQQ 是 LGPL-3.0（可自由使用/分发，修改其代码需开源）；本桥代码是我们自己写的。
7. **未做**：开机自启、异常自恢复、QQ 更新适配、多会话切换。

## 6. 如果要做成正式功能（后续方向）

1. **摆脱 DOM**：hook `wrapper.node` 导出的 `NodeIQQNTWrapperSession.create`，在 QQ 创建 session 时捕获 instanceId，然后 `getNTWrapperSession(id).getMsgService()` 直接收发（这是 NapCat 的做法，稳定但需要注入时机在 QQ 启动早期）。
2. **摆脱 Java**：把注入器改成一个小的 C++/C# 远程线程注入器（CreateProcess suspended + LoadLibrary），只需分发一个 exe。
3. **打包成可选组件**：插件侧增加「自建桥」开关，桥作为独立进程/服务，一键启动、失败回退 VM 通道。
4. **多会话**：监听所有会话（需要 DOM 里切换/轮询，或走原生 msgService 回调）。

## 7. 怎么启动 / 怎么清理

启动（便携 QQ 已登录的前提下）：

```powershell
powershell -ExecutionPolicy Bypass -File F:\onebot\next\start-bridge.ps1
```

然后插件里：设置 → VM → 聊天软件直连，地址填 `http://127.0.0.1:3010`，对方 QQ 号填 aedo 的号。

清理（全部可删，不影响 C 盘 QQ 和主号）：

```powershell
# 1) 关掉便携 QQ（任务管理器结束 QQPortable.exe）
# 2) 删掉整个研究目录
Remove-Item 'F:\onebot' -Recurse -Force
# 3) 插件里把「聊天软件直连」关掉即可
```

## 8. 相关文件

- `docs/self-bridge/shell2.js`：注入到 QQ 主进程的调试服务（3057）
- `docs/self-bridge/bridge-core.js`：自建桥主体（3010，OneBot 11 子集 + DOM 收发）
- `docs/self-bridge/start-bridge.ps1`：一键启动脚本
- `docs/self-bridge/sbc-eval.mjs` / `e19.js`：往注入壳里发命令的小工具
- `docs/self-bridge/sbc-uia-ok.ps1`：注入时自动点掉调试弹窗的 UIA 小脚本
- 实际运行副本：`F:\onebot\next\`（含 JDK、注入器 jar/dll、日志）
