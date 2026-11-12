# 内部场景 3D 接口

官方不做内部场景 3D，这里提供插件侧接口，3D 渲染器由外部接入。

## 场景数据

`scene` 支持：

```json
{
  "mode": "3d",
  "model3d": {
    "url": "/models/room.glb",
    "scale": 1,
    "rotationY": 0
  },
  "hotspots": [
    { "id": "desk", "label": "书桌", "x": 0.5, "y": 0.5 }
  ]
}
```

- `mode`: `2d`（默认）或 `3d`
- `model3d.url`: 只接受 `/models/` 下的 GLB/GLTF
- `hotspots` 继续用于位置/交互，3D 渲染器可以自行解释
- 服务端 `normalizeScene` 会保留 `mode` 和 `model3d`

## 客户端接口

打开 `mode: "3d"` 的场景时，客户端会创建 `#scene3dHost`，并调用：

```js
window.DSH_SCENE_3D.register((host, place) => {
  // host: DOM 容器
  // place: 完整地点对象，place.scene 是场景数据
  // 在这里初始化 Three.js / 其他 3D 引擎
});
```

内置对象：

```js
window.DSH_SCENE_3D = {
  renderer: null,
  register(fn) {},
  render(host, scene) {},
};
```

- 没有注册渲染器时，显示“3D 接口已开启，但还没有注册 3D 渲染器”。
- 3D 渲染器负责自己的相机、灯光、加载 GLB、角色/热点展示。
- 角色行为、生活状态、社交和聊天仍由插件服务端提供；3D 层只负责渲染。

## 例子

```js
window.DSH_SCENE_3D.register((host, place) => {
  // 伪代码
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  host.appendChild(renderer.domElement);
  // 加载 place.scene.model3d.url ...
});
```

## 边界

- 插件不内置 3D 引擎、不打包 Three.js
- 不负责 3D 动画资源、骨骼和碰撞
- 3D 渲染器失败时回退到提示，不阻塞 2D 地图
