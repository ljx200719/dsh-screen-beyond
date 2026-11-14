# RELEASE 0.7.25（源码，已提交 npm 审核）

> 版本线：0.7.x（0.7.23 = npm 已发布版；0.7.24 = 桌面端原生化/3D/直连/自动更新；0.7.25 = 记忆删除修复）

## 1. 修复：面板里「删除记忆」没反应（重要）

- **现象**：设置 → 记忆 → 删除一条记忆，确认后界面无变化；置顶/取消置顶同样无效。
- **根因**：`GET /api/memory` 每次都会执行 `decay()` 并保存（`f.decayedAt = now` 无条件更新），导致数据 revision 每次读取都 +2。面板加载时拿到 `expectedRev`，点删除时早已过期 → 服务端 `guardRev` 一律返回 409「版本冲突」；前端只重读数据、不重试，看起来就是"删除没用"。
- **修复**：
  - `runtime/memory.mjs` `decay()`：只有衰减幅度 ≥ 0.02 或归档状态变化时才落盘，读取不再改 revision；
  - `src/client/30-settings/settings-data.js`：记忆置顶/删除遇到 409 时自动重读并重试一次，用户无感。
- **回归**：连续 3 次 `GET /api/memory` revision 稳定（853/853/853）；导入临时记忆（rev 854）→ 带 expectedRev 删除 → 200、记忆数 11→10；smoke 45/45 + 39/39。

## 2. 本版同时包含（0.7.24 内容）

- 桌面端原生化（DSH 原生 React 面板替换 iframe 网页壳）、3D 舞台、聊天软件直连（OneBot 11，不捆绑桥）、插件自动更新、余额刷新提速；
- 详细见 `RELEASE-0.7.24.md` 与 `docs/UNVERIFIED.md`。

## 5. 2D 骨骼角色接入（2026-11-15，AI 贴图，已进客户端）

地图和 2D 舞台上的她不再是「一张图平移」，而是一个有骨骼的角色：

- 新增 `src/client/20-stage/skeleton.js`：DOM 骨骼（hips/chest/head/arms/legs/hair/tail）+ 程序化 idle/walk 动画（呼吸、眨眼不可用但走路有手脚摆动和身体起伏），方向自动翻转，接入了 `map.js` 与 `stage.js`；
- 贴图用 AI 按当前角色「小鲸」生成全身参考图后切分成 9 层（head / hairBack / torso / armL / armR / skirt / legL / legR / tail），放在 `examples/2d-skeleton-demo/assets/`；
- 运行时新增 `/skeleton-assets/` 静态路由：顾客可以只换图/改 rig.json 就换成自己的角色（优先数据目录 `skeleton-assets/`），**不用改代码**；
- 兼容：拉不到 rig/图片失败时自动回退原来的头像图片。
- 还没做的：眨眼/表情（脸是整张图）、爬坡/遮挡、换装（目前只有一套衣服的贴图）。

## 4. 研究分支：自写 QQ 桥 MVP 打通（2026-11-15 凌晨，未集成）

现成 OneBot 实现被清掉之后（NapCat 下架 / Lagrange 停服 / LLOneBot 收费），用「**官方 QQ 客户端内存注入**」路线做了个自写桥的研究原型：QQ 9.9.37 便携副本 + 开源注入器 TzdInjectorNTQQ（LGPL-3.0，**零文件修改**）+ 自建 OneBot 11 子集 HTTP 桥（`127.0.0.1:3010`）。

- 实测：插件「测试连接」返回芝芝/1ms；插件「发测试消息」真到 aedo；aedo 回消息 → 桥收 → 运行时生成回复 → 桥真发回 aedo，**完整闭环**（03:47~03:51）。
- 限制：DOM 级实现（QQ 改界面会失效）、每次启动 QQ 需重新注入、需要 Java、仅单聊文本、注入类工具仍有账号风险；未做自启/自恢复。
- 详见 `docs/SELF-BRIDGE-RESEARCH.md` 与 `docs/self-bridge/`；实验文件都在 `F:\onebot`，可整目录删除。

## 3. 已知 / 未验

- 面板需要刷新一次才能加载 0.7.25 的前端代码（服务端修复对旧面板也生效）。
- QQ 直连桥：官方生态停更/收费，自写注入方案预研中（卡在 QQ 9.9.37 文件校验），详见 `docs/UNVERIFIED.md` U13；直连卡片已标注「目前在研究」。
- 其余未验证项见 `docs/UNVERIFIED.md`。
