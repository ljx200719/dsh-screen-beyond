# 2D 骨骼系统 + 桌宠生动化/换装 · 设计草案（2026-11-15 凌晨）

> 状态：**设计 + 可运行原型**（未集成进插件）。前置：桥的研究已完成（见 `SELF-BRIDGE-RESEARCH.md`）。
> 改动前已备份：`D:\linzhi\backups\backup-20261115-035319.zip`（35 MB，含角色数据）+ 插件副本。

---

## 0. 现在是什么样（问题）

| 位置 | 现状 | 问题 |
|---|---|---|
| 地图 / 2D 舞台 | 角色是一个 `<img>`（`Avatar`/`sprite` 路径），位置用 `left/top` 百分比 + CSS 过渡 | 只有一张静态图；「走路」只是整张图平移，没有手脚动作；换方向只能翻转整图 |
| 桌宠 | 独立 WPF 桌面程序（`/api/pet/start|stop` 控制），按 pet manifest 显示图片/手势/表情/按钮 | 本质是几张图片切换，表情/动作靠换图；没有骨骼、没有换装、互动只有按钮 |

目标：
1. **2D 骨骼系统**：地图/舞台上她是一个有骨骼的角色，走路/待机/挥手等是骨骼动画（程序化生成，不依赖逐帧图）。
2. **桌宠生动化 + 互动 + 换装**：同一套骨骼引擎驱动桌宠；点击/拖拽/靠近有反应，能换衣服/发型/配饰。

---

## 1. 2D 骨骼系统设计

### 1.1 技术选型：DOM + CSS transform（推荐）

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **DOM 嵌套 + CSS transform** | 和现有 React 客户端同栈、无新依赖、GPU 合成、调试直观、分层换装天然 | 骨骼多时 DOM 节点多（本设计约 20~30 个/角色，够用） | ✅ 推荐 |
| Canvas2D 自绘 | 渲染完全可控 | 要用位图/图集，换装/换色要重绘；和现有 `<img>` 体系割裂 | 备选 |
| Spine / DragonBones 运行时 | 成熟 | 运行时许可 + 资产格式绑定，第三方素材难配 | ✗ |
| three.js 2D | 已有 vendor | 为 2D 引 3D 引擎太重 | ✗ |

### 1.2 骨骼层级（约 18 根）

```
root(位置/朝向)
└ hips(髋)
  ├ spine → chest → neck → head
  │            ├ armL(upper)→foreL→handL
  │            └ armR(upper)→foreR→handR
  ├ thighL → shinL → footL
  └ thighR → shinR → footR
+ 附件骨：hairBack / hairFront / skirt / accessory
```

每个骨骼节点 = 一个 `<div>`，`transform-origin` 在关节处，`transform: rotate(angle) translate(...)`；子骨骼相对父骨骼定位。角色根节点负责整体位置（x/y 百分比，和现有地图坐标一致）和朝向（`scaleX(±1)`）。

### 1.3 部件（parts）与换装

部件是挂在骨骼上的图片（PNG 分层或内联 SVG），按 `zIndex` 排层：

| 槽位 | 说明 | 可换 |
|---|---|---|
| `body` | 身体/腿 | 肤色变体 |
| `hairBack` / `hairFront` | 后发/前发 | ✅ 发型 |
| `face` | 表情（眼/嘴可分开） | ✅ 表情包 |
| `top` / `bottom` / `shoes` | 衣服 | ✅ 服装 |
| `accessory` | 发饰/耳饰/手持 | ✅ 配饰 |
| `pet` 附加 | 尾巴等 | ✅ |

**数据格式（草案）**：

```jsonc
// rig.json
{
  "version": 1,
  "size": { "w": 120, "h": 220 },          // 角色画布尺寸
  "bones": [
    { "name": "hips",  "parent": null,  "x": 60, "y": 140 },   // 相对角色坐标
    { "name": "chest", "parent": "hips", "x": 0, "y": -30 },
    { "name": "head",  "parent": "neck", "x": 0, "y": -18 }
    // ...
  ],
  "parts": [
    { "slot": "body", "bone": "hips", "img": "body.png", "z": 10 },
    { "slot": "top",  "bone": "chest", "img": "top.png",  "z": 20 },
    { "slot": "hairFront", "bone": "head", "img": "hair_a.png", "z": 50 }
  ],
  "clips": {
    "idle": { "loop": true, "duration": 2.4, "tracks": { "chest": [[0,0],[1.2,2],[2.4,0]], "head": [[0,0],[1.2,-1.5],[2.4,0]] } },
    "walk": { "loop": true, "duration": 0.72, "tracks": {
      "thighL": [[0,-18],[0.18,12],[0.36,-18]], "thighR": [[0,12],[0.18,-18],[0.36,12]],
      "shinL": [[0,10],[0.18,0],[0.36,10]], "armL": [[0,10],[0.18,-12],[0.36,10]]
    } }
  }
}
```

**关键点**：
- 关键帧只存**角度（度）**，渲染时线性/正弦插值；`walk` 里再叠加一个身体上下起伏（`hips.y` 用 sin）→ 不用逐帧图。
- 朝向：根节点 `scaleX` 翻转；左右腿/手在翻转后自动对称。
- 走路速度联动：地图移动速度 → 步行周期时长（步频 ≈ 速度 / 步长）；停下时切 `idle`（呼吸、眨眼）。
- 过渡：clip 切换做 0.15s 交叉淡化（角度插值），避免跳帧。

### 1.4 接入地图/2D 舞台（改动面）

1. 新增 `src/client/20-stage/skeleton.js`：`SkeletonAvatar({ charId, pose, direction, speed, outfit })` 组件 + 动画循环（`requestAnimationFrame`，只在可见时跑）。
2. `map.js`：`h(Avatar, ...)` → `h(SkeletonAvatar, ...)`；有 `rig` 用骨骼，没有则回退现有 `<img>`（兼容旧数据）。
3. `stage.js`：2D 分支同样替换；3D 分支不动。
4. 后端：`/api/world/characters` / `/api/stage` 增加 `rig`、`outfit` 字段（缺省不下发，前端回退）。
5. 资源：先支持「程序化 SVG 部件」（无素材也能跑），后续接用户上传的 PNG 分层（`pet` manifest 已有图片路径机制可复用）。
6. 性能：一个地图最多显示十几个角色；骨骼 DOM 约 20 节点/角色，rAF 每帧改 18 个 transform，CPU 可忽略；离屏/隐藏暂停。

### 1.5 分阶段

- **P0（原型）**：独立 HTML 原型（见 `examples/2d-skeleton-demo/index.html`），验证骨骼层级 + walk/idle 程序化动画 + 换装/换色 + 点击反应。
- **P1**：抽成 `skeleton.js` 接入 2D 舞台/地图，无 rig 数据时回退图片。
- **P2**：角色/服装素材管线（分层 PNG 上传、槽位映射、缩略图、预览）。
- **P3**：动作库扩展（坐、挥手、抱枕、睡、跑、跳），动作与聊天/日程联动（她心情差时走路慢等）。

---

## 2. 桌宠生动化 / 互动 / 换装

### 2.1 形态选择

| 方案 | 说明 | 结论 |
|---|---|---|
| 保留 WPF，从 exe 内画骨骼 | 要重写渲染层，WPF 里做骨骼动画麻烦 | ✗ |
| **WPF 壳 + WebView2 渲染**（推荐） | WPF 继续负责窗口/置顶/穿透/托盘，画面换成内嵌本地 HTML，直接复用 2D 骨骼引擎；交互用 `postMessage` 桥 | ✅ |
| 完全换成 Electron 窗口 | 多一个 Electron（几百 MB） | ✗ |

### 2.2 互动设计

- **待机**：呼吸（胸骨微动）、眨眼（表情层定时切换）、偶尔转头看鼠标方向、换重心站姿。
- **点击**：点头 → 「嗯？」气泡；摸头（头顶区域）→ 眯眼蹭手；戳脸 → 鼓脸；点脚 → 跳一下。
- **拖拽**：抓起时手脚轻微摆动 + 落地小跳；拖到屏幕边缘会「扶边」。
- **靠近鼠标**：视线跟随（头部骨骼转向鼠标），距离很近会后退半步（怕痒）。
- **时间/状态**：早上困（动作慢半拍、打哈欠）、晚上困（站着打瞌睡）、开心（走路蹦跳）。
- **对话**：气泡显示 runtime 给的短句（复用 `/api/pet/manifest` 的表情/台词机制 + 主动消息）。
- **换装 UI**：右键桌宠 → 衣柜；或面板「桌宠」卡片里加衣柜入口；换装即时生效并写回角色配置。

### 2.3 换装系统

- 槽位：`hair`（发型）、`top`、`bottom`、`shoes`、`accessory`、`face`（表情）；每件 = 一组部件图 + 可染色区域。
- **套装**：一套 = 槽位到部件映射 + 主色；保存为 `outfits.json`，可命名/收藏/随机。
- **染色**：部件图用 SVG `currentColor`/CSS `filter` 或预先准备的色板变体；简单版先做「主色替换」。
- **与地图一致**：同一份 outfit 同时作用于地图小人、2D 舞台和桌宠（数据在角色配置里，三端都读）。

### 2.4 技术要点

- WebView2 内 HTML 页面通过 `window.chrome.webview.postMessage` 与 WPF 通信：`{type:'pose'|'say'|'drag'|'outfit'}`。
- 点击穿透：WPF 窗口 `WS_EX_TRANSPARENT` 只在「不交互区域」开，角色身体区域响应点击（用骨骼包围盒判断，发给 WPF）。
- 省电：桌宠不可见/被遮挡时暂停 rAF；静置 30s 降帧到 15fps。

---

**已验证**：原型截图见 `examples/2d-skeleton-demo/screenshots/map-idle.png`（地图模式静止）与 `pet-mode.png`（桌宠模式 + 双马尾 + 换装）。用无头 Chrome 渲染检查过：骨骼层级、脸部/裙摆/腿脚位置、换装与模式切换都正常显示。
## 3. 原型（本次已写）

`examples/2d-skeleton-demo/index.html`：单文件、无依赖、无外部素材（用内联 SVG 形状当部件），演示：

1. 骨骼层级 + 程序化 `walk`/`idle` 动画（可切换、可调速度）；
2. 方向翻转、地图式移动（点地面走过去）；
3. 换装：上衣/裙子/发型/发色切换，实时生效；
4. 桌宠模式：点击不同部位有不同反应 + 台词气泡；
5. 所有参数集中在一个 `RIG` / `OUTFITS` 常量里，便于后续搬进插件。

打开方式：浏览器直接打开该 HTML；或面板里用「关于 → 打开示例」链接（后续再加）。

---

## 3.5 已落地到插件（2026-11-15 凌晨，P1 第一版）

- 新增 `src/client/20-stage/skeleton.js`：`SkeletonAvatar` 组件（DOM 骨骼 + 程序化 idle/walk + 方向翻转 + 自动回退头像），已接入 `map.js`（地图角色）与 `stage.js`（2D 舞台上的她）。
- 贴图由 AI 按当前实例角色「小鲸」生成并切片：`examples/2d-skeleton-demo/assets/`（head/hairBack/torso/armL/armR/skirt/legL/legR/tail 九层 + `rig.json`）。
- 运行时新增静态路由 `/skeleton-assets/`（优先读数据目录 `skeleton-assets/<角色>/`，其次读插件自带 assets）——**顾客换贴图不用改代码**。
- 内置一份 rig 常量（拉不到 rig.json 时用），任何一张图加载失败 → 自动回退原来的头像图片，不会白屏。

### 怎么换成自己的角色/贴图
1. 画分层图（透明 PNG，同一张画布、正面站姿对齐），文件名与现有同名即可直接覆盖；
2. 想挪关节：把 `rig.json` 放数据目录 `skeleton-assets/xiaojing/rig.json`（`bones` 是关节坐标、`parts.box` 是贴图位置、`parts.pivot` 是支点），刷新面板生效；
3. 想加动作：改 `skeleton.js` 里的 `skeletonMotion()`（idle/walk 的角度函数）。

## 4. 风险 / 待定

- **素材**：真实角色需要分层立绘；没有素材时用程序化占位（原型已证明流程）。
- **DOM 骨骼数量**：角色多时 DOM 节点多，需要离屏暂停；必要时降级为单张图。
- **桌宠壳改造**：WPF + WebView2 需要验证系统 WebView2 运行时可用（Win10/11 一般已装）。
- **地图走路与寻路**：现有 walkable 区域是点集，骨骼角色需要「路径跟随 + 步频同步」，P1 实现。
- 所有改动前先备份（已备份）；回退只需恢复 backup 或 git 回滚。

