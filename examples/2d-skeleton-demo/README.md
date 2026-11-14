# 2D 骨骼角色原型（单文件可跑）

> 对应设计文档：`docs/2D-SKELETON-PET-DESIGN.md`
> 这是**独立原型**，还没有接进插件；打开 `index.html` 即可看效果。

## 打开

双击 `index.html`（任意现代浏览器），或：

```powershell
Start-Process 'F:\屏幕彼端\插件最新版\dsh-screen-beyond\examples\2d-skeleton-demo\index.html'
```

## 能看什么

- **地图模式**：点地面，她会走过去（`walk` 程序化骨骼动画：腿/手臂摆动、身体起伏、方向自动翻转），停下切 `idle`（呼吸、眨眼、偶尔转头）。
- **换装**：上衣颜色、裙/裤、直发/双马尾、发色，实时生效（对应设计里的槽位系统）。
- **桌宠模式**：点头 → 蹭蹭/爱心；点脸 → 鼓脸；点手臂 → 击掌；点身体 → 抬头回应；都有台词气泡。
- **URL 参数**（方便截图/分享状态）：
  `?mode=pet&twin=1&pants=1&top=%238ad3b0&hair=%23c9b6f2&walk=1&say=...`

## 截图

- `screenshots/map-idle.png`：地图模式静止态
- `screenshots/pet-mode.png`：桌宠模式 + 双马尾 + 换装

## 核心实现（对应设计文档）

- **骨骼**：DOM 嵌套 div，每个骨骼一个节点，`transform-origin` 在关节，父骨骼带动子骨骼；
- **部件**：挂在骨骼上的绝对定位元素（原型用 CSS/SVG 形状代替真实立绘，真实素材换成 `<img>` 即可）；
- **动画**：`requestAnimationFrame` 里按相位算角度（walk 用 sin，idle 用呼吸/眨眼），不是逐帧图；
- **换装**：CSS 变量 + 类切换替换部件/颜色；真实版本换成部件图路径映射；
- **数据入口**：`RIG`/`OUTFITS` 常量集中在 JS 顶部，后续搬进插件时替换为接口下发。

## 已知简化

- 部件是程序化形状，不是真实分层立绘；
- 走路是水平移动 + 相位动画，没有寻路/坡道/遮挡；
- 桌宠壳（WPF + WebView2）还没接，这里只是渲染层原型。
