# 屏幕彼端 0.8.9（2026-11-15）

> 依据 `docs/屏幕彼端-0.8.6-修复清单-2026-11-15.docx`（原始测试报告快照，不改它）执行；
> 进度以 `docs/屏幕彼端-0.8.6-修复清单-2026-11-15.csv` 的「状态」列为准（本版已更新）。
> 25 项：P1 5 项、P2 10 项、P3 10 项。F-023/F-024 之前已完成，本次复查仍成立。

## 一句话结论

**23 项待修全部落地**：15 项能自动验的进了冒烟（服务端 87 项 / 客户端产物 41 项，全绿），
8 项是"看得见"的视觉/交互项（3D 舞台、noVNC、标签避让、主题对比度等）——代码改完并通过静态回归，
但**真实浏览器里的观感、真实虚拟机的画面，本次没有截图复核**（见文末「没验的部分」）。

## P1（5 项）

| 编号 | 结论 | 改了什么 |
|---|---|---|
| F-001 | ✅ | `settings-direct.js` 四个 Toggle 传的是 `value`，而 `Toggle` 只认 `checked` → 一律显示为关。四个都改成 `checked`；顺手把同文件 `UpdateCard` 里同样传错的 2 个 Toggle 一起改掉（共 6 处），并全局审计：其余 40+ 处 Toggle 都正确用 `checked`。 |
| F-002 | ✅ | 新增 `cleanupCharacterAssets()`：删角色时一并清 `runtime/skeleton-assets/<id>`、`poses.json`、`assets/pet/<id>`、`<id>-*.png`、老的 `sprite-<id>-*`。所有删除都先 `path.resolve` 再比对根目录前缀（跑不出根目录），且内置素材 `default/xiaojing/xiaoke` 永不删。`/api/stage/poses` 只列"还活着的角色"，不再返回 ghost。 |
| F-003 | ✅ | 3D 场景补 **天空穹顶**（背面渲染 + 顶点色垂直渐变）与**远海水面**，雾色改用地平线色 → 任意旋转/缩放都不再出现纯黑空域与水面硬边；相机改为**按岛的包围盒二分求距离**自动取景（不再固定 `dist=100`），并限制注视点在岛内；底部帮助文字允许换行、不再右侧被裁。 |
| F-004 | ✅ | 角色优先用**她自己的立绘**做 billboard（服务端新增 `character.standee`：先找 `skeleton-assets/<id>/poses/idle.*`，再退 `meta.sprite` 整图），拿不到才回退程序化小鲸；名牌按实际包围盒抬到头顶上方（原来固定 `y=4.6` 正压头上）；地点名牌改为每 140ms 一次屏幕空间布局：近的优先占位、重叠让位、贴边裁半的不画。 |
| F-005 | ✅ | noVNC 内嵌参数把 `view_clip=true`（裁掉视口外 = 右侧时间被裁 + 左侧多一条）改成 `view_clip=0`，`resize=scale` 走 contain；画面层与工具条分层（新增工具条：连接状态点 / 重连 / 全屏 / 收起），画布黑底居中，iframe 去边框、禁滚动条；新增**全屏**（`requestFullscreen` + Esc 退出）。 |

## P2（7 项）

| 编号 | 结论 | 改了什么 |
|---|---|---|
| F-006 | ✅ | 导入角色卡后调 `reloadAll()`（persona + `/api/characters` 双刷新），列表 chip、当前角色名、页头同时更新；失败不动任何数据（服务端拒绝即中止）。 |
| F-007 | ✅ | 选方案 A：`restoreCharacterWorld()` 在角色没有世界数据时**直接把默认世界写进去**（13 地点 + `official-map.jpg` + home 起点），不再依赖 `loadMaps()` 的兜底；地图/舞台"没有底图"的空状态本来就有「去地图页加底图」按钮，复查保留。 |
| F-008 | ✅ | 2D：新增 `visibleLabels` 布局——按「当前地点 > 靠上 > 靠左」排优先级，名字盒子互相碰撞就只留图标，会出画布的名字不画；角色标签 z-index 高于地点标签。3D：见 F-004 的屏幕空间布局。 |
| F-009 | ✅ | `/api/version` 的 `features.stage3d` 改为 `true`（3D 舞台确实可用，只在 WebGL 不可用时回退 2D）；新增 `install.kind`（`git`/`link`/`npm`/`unknown`，由 updater 的 `detectInstallKind` 实测，git 检出不再被当成 npm）与 `install.legacyWebStatus`；关于页新增「安装方式」「3D 舞台（features.stage3d）」「旧网页入口 HTTP 410」三行；更新卡片在"本地版比 npm 新"时显示 `本地版比 npm 新（0.8.9 > 0.8.1）`，不再同时说"最新 0.8.1"和"已是最新"；关于页旧网卡片明确写 410（不是 506）。 |
| F-010 | ✅ | 根因是 `petCharId()` 固定先返回 `xiaojing`。改为**只跟随当前角色**；`/pet-sprite/<name>` 在角色没有自己素材时回退到**她自己的头像**（不再借别人的图）；`pet.ps1` 下载失败也回退她的头像而不是保持上一帧；`/api/pet/status` 增加 `character.petCharId` 便于排查。 |
| F-011 | ✅ | 面板配色切换改为**每次成对提交 `{mode, accent}`** 并用服务端回读值立即生效 → 切深浅不会再丢强调色；深色 `text2/text3` 各提亮一档、边框从 .12/.22 提到 .14/.26；浅色 `text2/text3` 压深、边框从 .10/.20 提到 .16/.30，玻璃层次保留。 |
| F-012 | ✅ | 角色卡顶部操作条加哨兵 + IntersectionObserver：滚动后收成只留保存按钮的一条（并给「↑ 顶部」），不再整块不透明底色吃掉下面的卡片标题；sticky 条改玻璃底 + 下阴影；设置内容区加 `scroll-padding-top`，切子页自动回顶。 |

## P3（8 项）

| 编号 | 结论 | 改了什么 |
|---|---|---|
| F-013 | ✅ | 常显的「■ 停止」是**语音停止**那个 chip（生成中的回复停止按钮本来就是条件渲染的）。新增 `useVoicePlaying()`（`sbcAudioPlay/sbcAudioStop` 派发 start/stop 事件），只有真的在播放时才显示；空闲不显示、播放中点了立刻停并有反馈。 |
| F-014 | ✅ | `ui.js` 新增 `Skeleton` / `SkeletonRows`（含 shimmer 关键帧）；生活页「现在在做什么」首帧渲染骨架 + 「正在读她现在在做什么…」，不再先闪一个假的空状态。 |
| F-015 | ✅ | 环境开关：运行中禁用对应「启动」并把文案改成「屏幕运行中 / 手机运行中」；**手机（Waydroid）跑在她的 Linux 屏幕里**，屏幕没开时「启动手机」禁用并提示先开屏幕；内存由服务端统一成 `memItems:[{name,mb}] + memTotalMB`，前端统一 `fmtMemMB`（≥1024MB 走 GB 一位小数）并显示合计。 |
| F-016 | ✅ | 角色卡新增可选 `avatar`（data URL，导出时用 canvas 缩成 128px JPEG，约 7~15KB，导出前问一次"带不带头像"）；导入时校验只认 `data:image/*;base64`（不联网、不认路径），人设导入成功后再单独走 `/api/avatar`；没头像的卡给明确提示与上传引导。 |
| F-017 | ✅ | README 首屏改为「当前版本 0.8.9」，并写明**版本号唯一来源是 `package.json`**、关于页读 `/api/version` 同一份；0.7.24/0.7.25 小节标注为历史记录。 |
| F-018 | ✅ | 直连卡片：`connected` 由 `/api/direct-chat/status` 推导，未连接时「发测试消息」`disabled` 且 `title` 说明原因；「测试连接 / 发测试消息」新增**就地反馈徽标**（loading 闪烁点 / 成功 / 失败 + 原因）；未连接时给 4 步操作指引（填地址→跑桥→测试→看日志）。 |
| F-019 | ✅ | `start-bridge.ps1` 重写：**明确写出需要人工点 3 个系统确认框**（自动点击器降级为"尽力而为"，其失败不再影响主流程）；注入后校验三件事——`bridge.log` 有没有 `boot-probe`（桥代码是否真进了 QQ 进程）、3010 是否在监听、`get_login_info` 是否通；输出「桥自检」表，失败以退出码 1 结束并给排查顺序。桥侧 `bridge-core.js` 启动时补写 `boot-probe` 日志。 |
| F-020 | ✅ | `/api/backup` 现在回报新建的备份名，面板把新备份**就地把插进列表**再对一次服务端；新增 `POST /api/backup/inspect`（只读）读 zip 里的 `manifest.json`，恢复前展示差异预览（文件数/数据大小/备份与当前的角色集合、只有备份有的、只有现在有的、config 会被覆盖）；恢复前**自动再备份一次**当前状态并在完成提示里给出名字；备份/恢复过程有状态文案。 |
| F-021 | ✅ | 拆句规则可配置（按行+句号/加逗号/只按行；单条最长 8~200 字，服务端与前端同一套规则）；新增 `POST /api/memory/import/preview`（只读）返回条数/行数/前 5 条/解析不出内容的行号；导入失败也返回行号，前端 toast 里直接列出来。 |
| F-022 | ✅ | 日记卡片加日期选择器（原生 `type=date`，`max=今天`）+ 前一天/后一天/今天 + 保留最近 30 天快捷 chips；`GET /api/diary?date=` 服务端校验 `YYYY-MM-DD`（顺带堵住 `/api/diary?date=../config` 的路径拼接），返回 `exists`，无日记时明确显示「这一天没有日记（她那天没写）」。 |
| F-023 | ✅ 已完成（复查） | `start-pure-chat` 零引用（README 只有一句历史说明），`assets/pure-chat.png` 已删除，`screenshots.json` 无 pure-chat。 |
| F-024 | ✅ 已完成（复查） | 源码/面板不再出现「纯聊天模式」；`lib/client.js` 本次已重新构建。 |
| F-025 | ✅ 已定案（方案 B） | 旧 HTML 不删（`--legacy-web` 调试要对照），但**不提供给用户**：默认一律 410、面板无入口、`/api/version.install.legacyWebStatus` 如实报 410/200。发行包沿用 `files` 含整个 `runtime/`，因此仍带旧 HTML —— 这是有意取舍，要彻底剔除需另起一次"方案 A"改动。README 已写清。 |

## 验证

| 项 | 结果 |
|---|---|
| 服务端隔离冒烟（临时数据根/随机端口） | **103/103 通过**（原有 53 项 + 34 项 F-001..F-022 回归 + 16 项契约一致性/静态回归） |
| 原生客户端产物冒烟 | **41/41 通过** |
| eslint | **0 error**（64 warning，均为既有风格项） |
| 编码体检 `check-encoding` | 通过（142 文件；两个改过的 `.ps1` 已补回 UTF-8 BOM） |
| 新增的服务端回归 | F-002 删除清理/ghost、F-007 新角色 13 地点+底图、F-009 stage3d/install、F-020 备份名/列表/inspect/非法名、F-021 预览/规则/行号、F-022 任意日期/坏日期 |
| 新增的产物回归 | F-001/F-003/F-004/F-005/F-008/F-009/F-013/F-014/F-016/F-018/F-020/F-021/F-022 的关键代码特征（防回退） |
| 新增的契约一致性（双向） | api-index totals == 实际条目数；§5 标题 == api-index 计数；**代码每条 `/api` 路由 ⊂ 索引**；**索引每条路径 ⊂ 文档**；`/api/version.install` 与 `models.json stagePayload.character.standee/hasPoses` 在位；models 版本 == package.json |

## 顺手补齐的契约（同一提交）

做手机端任务清单时发现契约和代码已经各说各的，一并修掉：

| 问题 | 修法 |
|---|---|
| `API-CONTRACT.md` §5 标题写「128 个 / 13 组」，`api-index.json` 是 141 / 14 | 纠正为 **154 个 / 14 组**，三处（文档标题、§0 对照表、§12.3）统一 |
| 整个「聊天直连（OneBot）+ 插件更新」组（13 个端点）在文档里没有位置 | 补 §5.14（指向 §13 的明细，不复制两份）；§5 标题与小节计数同步 |
| 11 个端点**代码里有、索引里没有**：`/api/stage/poses`、`/api/stage/import-poses`、`/api/panel-theme`(×2)、`/api/paint`(×2)、`/api/voice/settings`(×2)、`/api/voice/tts`、`/api/voice/preview`、`/api/voice/cleanup` | 全部写进 `api-index.json`（141 → 154）；§5.9 补 `/api/paint` 两行 |
| 0.8.9 自己新增的 `backup/inspect`、`memory/import/preview` 没进契约 | 补进 `api-index.json` 与 §5.5/§5.13，并补 `install`、`exists`、`cleaned`、`standee/hasPoses`、`opts/lineCount` 等字段 |
| `MOBILE-GATE.md` 说 `features.stage3d=false`、桌面端也只做 2D | 改成 stage3d=true，手机端不做 3D 是**取舍**不是能力缺失 |
| 契约漂移以后还会再发生 | 冒烟里加**双向**一致性检查（见上表最后一行）；文档 §11 从「建议手工跑 python」改成「已由 `npm run smoke` 保证」 |

> 说明：`api-index.json` 的分组边界与文档 §5 不是逐组一一对应（例如 `watch-screen` 索引里归 `life`、文档里放「设置」）。已在 §5.9 写明：**端点总数以 §5 标题为准**，机器核对按**路径集合**做，不按分组计数——这样分组调整不会误报。

## 没验的部分（如实写）
- **视觉观感没有截图复核**：3D 舞台（黑域/海面硬边/取景/标签避让）、noVNC contain 与全屏、深浅主题对比度、sticky 收起动画 —— 这些都在**真实浏览器/真实虚拟机**里才能看到，本次只做到"代码改完 + 静态与接口回归通过"。验收清单里对应的截图对比项需要你实际打开面板看一眼。
- **桌宠跟随（F-010）** 没有真的重启桌宠窗口验证：`pet.ps1` 的解析与回退链已改并语法校验，`/pet-sprite` 回退头像有服务端路径保证，但"切小克后桌宠立刻换图"要实际切一次角色看。
- **一键导入姿态图 → 3D 立绘** 的整链没有跑真图（冒烟里是直接写 `poses.json` 造数据）；真实图片的宽高比/透明边表现需要看一眼。
- **QQ 桥（F-019）** 没有重跑真实注入：脚本逻辑、`boot-probe` 日志、三态自检已改，但"3 个确认框 + 3010 真监听"必须你在本机跑一次才能确认。
- **备份恢复的真实覆盖** 没有执行（只验了 inspect 读 manifest 与非法名拒绝）：恢复会覆盖真实数据，按约定要你自己按下那个按钮。
