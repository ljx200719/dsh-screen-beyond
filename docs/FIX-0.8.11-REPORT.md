# 0.8.11 测试报告修复记录（2026-11-16）

依据：`F:\屏幕彼端\测试报告-0.8.11\屏幕彼端-0.8.11-测试报告-2026-11-16.docx`
修改范围：`F:\屏幕彼端\插件最新版\dsh-screen-beyond`
前端改动已 `npm run build:client` 重新生成 `lib/client.js`；**DSH 面板需要刷新一次（F5 / Ctrl+R）才会载入新前端**。

## 一、本次真正改掉的

### P1-1 桌宠形象不跟随当前角色（真 bug，已修）
- 原因：`runtime/assets/pet/xiaoke/` 里的 4 张图和 `default/`（小鲸模板图）**字节完全相同**，
  所以服务端认为「她自己有素材」，一直发小鲸的图。
- 修法：`runtime/server.mjs` 新增 `petArtSig / petArtIsTemplate`，按文件内容判断——
  和 `default/` 同名图完全一致就视为模板图，不算她自己的素材：
  - `petFramesFor()` 不再把这些图当帧；
  - `/pet-sprite/<角色>/<文件>` 命中模板图直接 404；
  - `/pet-sprite/<表情>` 跳过模板图，回退到**她自己的头像**。
- 验证：切到小克后 `GET /pet-sprite/idle.png` 返回的 md5 与 `data/characters/xiaoke/avatar.bin` 一致，与小鲸模板图不一致；`/api/pet/manifest` 的 frames 为空。切回小鲸后帧动画正常。

### P1-5 地图移动没有动作（已修）
- `src/client/20-stage/stage.js`：点地点不再是瞬间传送。
  先在本机做 1.2 秒「走过去」过渡（角色位置 CSS 过渡 + `SkeletonAvatar` 的 walkA/walkB 走路帧 + 「走过去…」标签），
  再提交 `POST /api/location {instant:true}`，数据回填后再撤掉本地覆盖，不会闪回原位。

### P2-1 / P3-4 3D 没有资源只弹一个瞬逝 toast（已修）
- 舞台底部常驻一行说明：「这张地图没有 3D 资源，只能看 2D…去地图页配 3D 模型」，
  不再只靠几秒就消失的 toast；3D 胶囊本来就是灰的。

### P1-4 TTS 失败没有任何痕迹（已修一半）
- `runtime/voice.mjs`：合成失败时除了内存里挂 `voiceError`，现在**写回历史**（`persistMessage`），
  刷新/重开面板也能看到「语音没生成：原因」，不会再出现「既没音频也没解释」。

### P2-2 屏幕页手机卡放了电脑/桌面截图（已修）
- `runtime/server.mjs` 的 `/api/screen/phone`：
  - 先用 `adbDevicePresent()` 确认手机真的在跑，没跑直接 503「手机没开」；
  - 截完读 PNG 头验证是竖屏画面（宽 ≥ 高就判定不是手机画面 → 503 并说明）。
- 前端 `screen.js` 的内存统计文案同步改成「虚拟机进程占用（私有提交）」。

### P2-3 删掉当前角色后 active 掉到列表第一个（已修）
- `activateCharacter()` 记录 `CONFIG.prevCharacter`；删除当前角色时优先回到「上一次用的角色」，
  返回体新增 `switchedTo`，前端提示里能写清切到了谁。

### P2-4 关于页「506」/更新卡「未检查 / —」（已修）
- 那个「506」其实是任务号 **S06** 被读成了 HTTP 码。卡片副标题改成
  「任务 S06 已完成 · 默认 HTTP 410，不再提供给用户」，不会再被当成 506。
- 更新卡补一次 `/api/version` 兜底：安装方式不再显示「—」，最新版本没查过时显示「尚未检查（点下面「检查更新」）」。

### P2-5 内存 6/67/9 MB 数值可疑（已修统计口径）
- 之前只报 `WorkingSet64`；现在同时取工作集和**私有提交**（PrivateMemorySize64），
  以私有提交为显示值、工作集放到 tooltip，并把 VBoxSvc/VBoxSDS 也列进来；
  接口新增 `memNote` 说明「这是进程占用，不含虚拟机内部缓存」，面板上原样展示。

### P3-1 记忆删除接口不校验参数（已修）
- `/api/memory/delete` 现在：拒绝未知字段（400）、`id`/`ids` 都支持、一条都没匹配上返回 404，
  不再出现「传错字段也返回 ok 但什么都没删」。

### 3D 舞台：把小鲸的 3D 模型换回来（本次重点）
- 现象：3D 舞台底部写着「角色模型加载失败，已用兜底形象：fetch for `dsh-app://app/models/xiaojing-3d.glb` 404」。
- 根因：`src/client/20-stage/three3d.js` 里三处 `GLTFLoader.loadAsync(String(url))` 直接用相对路径。
  面板页面的 origin 是 `dsh-app://app`，所以 `/models/*.glb` 被解析成 `dsh-app://app/models/...` → 404。
  （地图模型、载具模型、角色模型三条路径都中招。）
- 修法：新增 `sbc3dResolveUrl()`，用 `Runtime.baseSync()`/`DEFAULT_BASE` 拼成运行时绝对地址
  （`http://127.0.0.1:8900/models/xiaojing-3d.glb`，服务端有 CORS 与 `model/gltf-binary`）。
- 数据：`小鲸` 的 `meta.model` 设为 `{ type:'3d', url:'/models/xiaojing-3d.glb', scale:1.25, rotationY:0 }`
  （通过 `POST /api/persona` 写入，不是手改文件）。
- 模型本身核验：glTF 2.0 / Blender 导出，88 节点、63 网格、18 材质、1 套骨骼、3 个动画
  **Idle / Walk / Wave**、约 3.2 万三角面；浏览器里 three r160 能加载并渲染（实测日志
  `glb parsed; animations=Idle,Walk,Wave` → `rendered`）。
- 设置页文案同步：模型类型不再是「3D 模型（本版不渲染）」，改成「3D 模型（GLB / glTF，3D 舞台用）」，
  地址提示写明可以填 `/models/xiaojing-3d.glb`。

### P1-3 语音输入不可用（只改了提示，能力没修）
- `chat.js` 的错误文案改成可操作：「到 DSH『插件』里确认语音插件已启用、版本和 DSH 一致；
  装好后回『设置 → 角色』点『检查 / 准备识别模型』」。
- 真正的录音链路要 DSH 侧 speech Remote 可用，插件这边改不出来。

## 二、查了但没改（附证据）

- **P1-2 桌宠窗口被裁 / 按钮不见了 / 摸头没反应**：本地实测不复现。
  窗口物理尺寸 720×660（480×440 DIP @150%），四个按钮（聊天/看屏幕/大小/属性）都在，
  立绘完整；点头部后 `pet.log` 立刻记 `gesture pat` + 切 `pat` 帧，消息数 398 → 400（提问 + 回复都有）。
  报告里的截图看起来是按 480×440 物理像素裁的窗口左上角，所以右侧按钮和立绘底部被截掉了。
- **P3-3 桌宠位置重启后重置**：`data/pet-ui.json` 里存着 `{"x":2072,"y":581}`，启动时按它恢复，
  当前窗口位置与之一致，未复现。
- **P2-6 角色卡不带头像**：0.8.9 起前端导入/导出已经带头像（`stgCoreAvatarToSmallDataUrl` / `stgCoreCardAvatar`，
  导出会问「把头像也放进角色卡？」，导入走 `/api/avatar`）。报告是用 API 等价路径导入人设，
  没走卡片路径，所以头像自然是默认。代码无需改。
- **P1-6 插件内 QQ 直连 / 自建桥**：属于外部 OneBot 桥与 QQ 注入，`3010` 不监听不在插件代码里；
  设置页已有「人工点 3 个确认框 + 看 boot-probe/listening」的指引。
- **P3-2 手机网页版真机验证**：需要真机/模拟器，本次没跑。

## 三、改动文件

```
lib/client.js                            重新构建（22 个源片段）
runtime/server.mjs                       桌宠素材判定、删角色回退、记忆删除校验、内存口径、手机截图校验
runtime/voice.mjs                        TTS 失败写回历史
src/client/20-stage/stage.js             走路过渡、3D 无资源常驻说明
src/client/20-stage/three3d.js           GLB 地址走运行时绝对地址（3D 模型换回来的关键）
src/client/30-settings/settings-core.js  3D 模型文案
src/client/30-settings/settings-direct.js 更新卡兜底
src/client/40-screen/screen.js           内存口径文案
src/client/50-app/app.js                 S06 文案
src/client/10-chat/chat.js               语音输入错误文案
```

改前原文件在本机工作区做过临时备份（不写死用户目录；备份不随发行包分发）。

## 四、验证与限制

- `node --check runtime/server.mjs`、`node scripts/build-client.mjs`（内部含 `--check`）通过；
  `scripts/smoke-test.mjs` 38/39，唯一失败是沙箱里 `spawn EPERM`（本机不允许子进程管道），与代码无关。
- 运行时已重启到新代码：`/api/resources` 已带 `memNote`、`/api/stage` 已带 `character.model`。
- **面板前端必须刷新一次**才能看到 `lib/client.js` 的新逻辑（3D 模型地址、走路过渡、关于页文案等）。
- 3D 模型的缩放（`scale: 1.25`）是按 chibi/立绘比例估的；如果觉得大了小了，
  在「设置 → 角色 → 模型地址」旁边改 `scale` 对应的字段（或改 `meta.model.scale`）。


## 五、第二轮（桌宠 / 舞台立绘）

用户反馈「桌宠和舞台立绘依然 bug」+「舞台立绘不应该是走路吗，两张图交替，现在变成抽动了」，定位到三处：

1. **桌宠缓存**：桌宠本地缓存 data/sprite-<角色>-<素材戳>-<表情>.png 只按「角色 + 素材 mtime」命名，
   服务端逻辑改对了但素材没变 → 一直用旧缓存（小鲸的图）。这次换了小克自己的素材，素材戳变了，缓存自动失效。
2. **小克没有自己的桌宠/舞台素材**：untime/assets/pet/xiaoke/ 里那 4 张图和小鲸模板图**字节相同**（历史遗留）。
   现在按她的头像生成了一套全身立绘（透明底，333×604，idle + idle0..3 呼吸帧），
   同时 pat/look 等表情图缺失时：
   - 服务端 /pet-sprite/<表情> 只对 idle 用头像兜底，其它表情返回 404；
   - 客户端 pet.ps1 收到 404 后用「同角色的 idle 图」顶上，不再跳回方形头像。
3. **舞台走路变抽动**，两个原因：
   - stage.js 里 moving: marker && marker.tag ? !!marker.tag : false —— 而站着不动时 tag 是「在这里」，
     于是一直为 true，**她站着不动也在踩腿**，看起来就是抽动。改成只在本地走路过渡 / traveling 时为 true。
   - skeleton.js 的走路帧率是 loor(phase*6)%2，按 dt 连续推算 ≈ 每秒切 6 次（速度 1.6 时更多），
     且两张图没有预加载。改成固定节拍 260ms/帧（约 3.8 次/秒，速度只影响快慢）、提前预加载两张图、
     上下起伏和左右摇摆跟着切帧走一次（一步一颠），不再像高频抖动。
   - 走路时长按距离算（0.7s ~ 1.9s），CSS 位移过渡跟着同一个时长，腿和位移对得上。

另：编辑 pet.ps1 时丢了文件头的 UTF-8 BOM，PowerShell 5.1 会按 ANSI 读 → 中文全部乱码、脚本起不来
（桌宠 unning=false）。已补回 BOM 并做了语法解析校验。
