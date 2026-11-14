# 屏幕彼端 v0.9.0 —— 3D 舞台回归 + 真实写操作验收

> 0.8.0 完成了「桌面端原生化」（iframe → DSH 原生 React 面板）。0.9.0 把 **3D 舞台**加回来，并且第一次对**真实数据**跑了一遍写操作验收（不是只跑 mock）。
> 需求：[docs/NATIVE-REWRITE-FORM.md](docs/NATIVE-REWRITE-FORM.md)（D03 已按 2026-11-14 追加决策改为「3D 加进本版本」）· 验收：[docs/NATIVE-REWRITE-DONE.md](docs/NATIVE-REWRITE-DONE.md)

## 新增：原生 3D 舞台（原 `/model` 的能力回到面板）

- 舞台标签和聊天分屏都支持 **2D / 3D 切换**（`localStorage: companionStage3D` 记住选择；地图 `displayMode=3d` 时默认 3D）。
- 3D 场景移植自原 `model.html`：海面/沙滩/岛屿地形、河流与桥、`map.roads` 三层土路、按 place id 变体的低模建筑 + canvas 名牌、程序化小鲸角色（配置了 GLB 模型时加载 GLB）、载具、行程路径线、昼夜/天气色调。
- 相机：拖动旋转、滚轮/双指缩放（限位）、轻点地点 → raycast → `POST /api/location` 让她过去；hover 变 pointer；行程中相机跟随。
- 引擎加载不走 importmap：three 从本机运行时 `/vendor/three.module.min.js` 动态 `import()`；GLTFLoader / BufferGeometryUtils 用「fetch 源码 → 改写裸导入为运行时绝对 URL → blob import」，按需加载（没配 GLB 就不加载）。
- **失败可回退**：WebGL 不可用 / 引擎加载失败 / 上下文丢失 → 中文 toast + 自动切回 2D + HUD 显示「3D 不可用」原因，不白屏；卸载时释放 renderer/geometry/material/texture 并 forceContextLoss，反复切换不泄漏。

## 真实数据写操作验收（第一次真跑）

用真实运行时（`D:\linzhi` 数据）逐项「写 → 读回 → 还原」，**73/73 通过**；面板 UI 里也真点了保存和导入。覆盖：

- 设置：聊天风格、省 token、上下文、模型温度、人设关系、生活心跳、VM 检查间隔、场景活动、低余额提醒、自动看屏幕、环境自启、记忆遗忘参数 —— 全部写后读回一致、还原后与基线完全一致。
- 记忆：文本导入 2 条 → 列表可查 → 逐条删除 → 消失（API 与面板导入框各验一次）。
- 地图：过期 `expectedRev` → 409 版本冲突；正确 rev 保存 → 读回坐标变化 → 其它 13 个地点/场景字段**零丢失** → 还原后与基线**深度相等**。
- 聊天：真发一条消息 → 用户消息落库 → 收到她的真实回复（「收到，这条我不当回事啦。」）→ 再发一条并点「停止」→ cancel 后回到空闲。
- 角色切换：切到另一个角色再切回，消息/记忆不串。
- 备份：创建新备份（79MB zip）出现在列表；**用真实备份跑恢复**（`restore.ps1 -Zip`），恢复后重启运行时、聊天气泡回到备份时点（测试消息被清理掉）。
- 桌宠：停止 → 状态 false → 启动 → 状态 true。
- 屏幕：stop（savestate）→ 状态 false → start → 状态 true → ensure 修复链路（x11vnc/websockify/6080 全 true）。
- VM：状态/wake 可用；`send` 的图片路径白名单拦截（400）。**没有**对真实 QQ 会话发测试消息（避免误发到群），发文字/图片链路仍是「代码路径 + 模拟」验收。

## 真机验证中发现并修掉的问题

| 问题 | 原因 | 修复 |
|---|---|---|
| 面板重开后「标签高亮但内容空白」 | 标签持久化在 localStorage，重挂载时只把 chat 标成已打开 | 初始 `opened` 带上持久化标签；非法标签回退 chat |
| 单个标签渲染异常会整页白屏 | 没有错误边界 | 加 `SbcViewBoundary`，每个标签单独兜底 + 重试 |
| 备份恢复点了没反应 / 恢复后还是旧聊天记录 | ① `/api/backup/restore` 传 `-Zip`，但 `restore.ps1` 只认 `-BackupDir`；② 脚本是 UTF-8 无 BOM，Windows PowerShell 5.1 按 ANSI 解码导致中文串解析失败；③ 恢复期间宿主已把运行时重新拉起，新实例加载的是旧数据 | ① `restore.ps1` 支持 `-Zip`（解压到临时目录，结束清理）；② 两个 `.ps1` 补 UTF-8 BOM；③ 复制完再停一次运行时，让宿主按新数据重启 |
| 关屏后立刻点「启动」会一直显示启动中 | `saveState` 尚未落盘时 `startvm` 失败 | `start_screen.ps1` 先等 `saving/restoring` 结束，再重试 `startvm`（最多 5 次）并校验 running |
| 3D 切换时底图首帧「加载失败」 | 见 0.8.0 记录（已修） | — |

## 验证

| 项 | 结果 |
|---|---|
| `npm run smoke:server`（隔离实例） | 45/45 |
| `npm run smoke:client`（加载构建产物） | 38/38 |
| `npm run lint` | 0 error |
| 真实数据写操作验收 | **73/73**（上面清单，全部带还原） |
| DSH 面板真机 | 原生面板六标签正常；聊天/舞台分屏/地图/设置/屏幕/关于；**3D 舞台在面板里真实渲染**（点 3D → 低模小岛 → 点「车站」她真的移动到车站） |
| 独立浏览器（真实 React + 真实数据） | 3D 渲染、拖动旋转、滚轮缩放、点地点移动都验证过 |

## 升级注意

- 版本变更后运行时会自动重启；**DSH 面板需刷新页面/重启 DSH** 才加载新的 `lib/client.js`。
- 3D 舞台依赖本机运行时的 `/vendor/three.module.min.js`（插件自带，不联网）。
- 恢复备份后运行时会被重启两次（一次在复制前、一次在复制后），十几秒内自动回来。
- 手机端仍未做（按需求）；发布（npm/GitHub）按你要求暂缓。
