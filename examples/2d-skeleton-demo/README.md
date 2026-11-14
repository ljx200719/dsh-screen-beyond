# 小鲸 · 2D 骨骼角色（真实 AI 贴图 + rig.json）

> 对应设计文档：`docs/2D-SKELETON-PET-DESIGN.md`
> 这套素材已经接进插件（地图 / 2D 舞台），这里是可以单独打开看效果的预览页。

## 怎么打开

`index.html` 用 `fetch` 读 `assets/rig.json`，`file://` 下会被浏览器拦，需要起一个静态服务：

```powershell
# 在 examples/2d-skeleton-demo 目录
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -Command "cd 'F:\屏幕彼端\插件最新版\dsh-screen-beyond\examples\2d-skeleton-demo'; python -m http.server 8099"
# 然后浏览器打开 http://127.0.0.1:8099/index.html
```

## 能看什么 / 能调什么

- **待机 / 走路**：程序化骨骼动画（走路有手脚摆动、身体起伏；待机有呼吸、尾巴/头发轻摆）；
- **朝向**：左右翻转；
- **衣服染色**：演示换装的一半（真换装 = 换 torso/skirt 的贴图）。

## 文件

| 文件 | 说明 |
|---|---|
| `assets/*.png` | 9 层贴图：head / hairBack / torso / armL / armR / skirt / legL / legR / tail |
| `assets/rig.json` | 骨骼（`bones` 关节坐标）+ 部件（`parts.box` 贴图位置、`parts.pivot` 支点）+ 层级（`z`） |
| `index.html` | 预览页（和插件里 `src/client/20-stage/skeleton.js` 同一套骨骼数学） |

## 换成你自己的角色

1. 画 9 层透明 PNG（同一张画布、正面站姿、关节处对齐），**同名覆盖** `assets/` 里的文件；
2. 关节位置/贴图位置不对 → 改 `rig.json`（或把改好的 `rig.json` 放到数据目录的 `skeleton-assets/xiaojing/` 下）；
3. 想让插件里也生效：把贴图 + `rig.json` 放到 `<数据目录>\skeleton-assets\xiaojing\`（优先于插件自带），刷新面板即可。

## 已知简化

- 脸是整张图（做不了眨眼/表情切换，要靠换 head 贴图）；
- 走路是原地相位动画，水平移动由地图位置驱动；
- 换装目前只有一套衣服（染色靠 CSS filter 演示），真换装需要多套贴图。
