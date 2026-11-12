/**
 * 小鱼镇 13 个内置地点的「地点内部」场景。
 *
 * 视角：星露谷式俯视 / 正交鸟瞰，角色站在地板上。
 * 背景图放在 runtime/models/scenes/<id>.jpg，通过 /models/scenes/<id>.jpg 访问。
 * 热点暂时只弹提示，后续再接具体 action。
 */
export const BUILTIN_SCENES = {
  home: {
    background: '/models/scenes/home.jpg',
    hotspots: [
      { x: 0.18, y: 0.38, label: '床' },
      { x: 0.72, y: 0.48, label: '书桌' },
      { x: 0.16, y: 0.7, label: '衣柜' },
    ],
  },
  school: {
    background: '/models/scenes/school.jpg',
    hotspots: [
      { x: 0.5, y: 0.22, label: '黑板' },
      { x: 0.5, y: 0.66, label: '课桌' },
      { x: 0.15, y: 0.45, label: '窗边' },
    ],
  },
  library: {
    background: '/models/scenes/library.jpg',
    hotspots: [
      { x: 0.18, y: 0.5, label: '书架' },
      { x: 0.5, y: 0.56, label: '阅读桌' },
      { x: 0.78, y: 0.42, label: '木梯' },
    ],
  },
  cafe: {
    background: '/models/scenes/cafe.jpg',
    hotspots: [
      { x: 0.18, y: 0.45, label: '吧台' },
      { x: 0.82, y: 0.45, label: '靠窗座位' },
      { x: 0.5, y: 0.66, label: '小圆桌' },
    ],
  },
  park: {
    background: '/models/scenes/park.jpg',
    hotspots: [
      { x: 0.5, y: 0.56, label: '喷泉' },
      { x: 0.28, y: 0.68, label: '长椅' },
      { x: 0.78, y: 0.28, label: '凉亭' },
    ],
  },
  canteen: {
    background: '/models/scenes/canteen.jpg',
    hotspots: [
      { x: 0.38, y: 0.2, label: '打饭窗口' },
      { x: 0.5, y: 0.65, label: '餐桌' },
      { x: 0.15, y: 0.55, label: '洗手池' },
    ],
  },
  market: {
    background: '/models/scenes/market.jpg',
    hotspots: [
      { x: 0.32, y: 0.45, label: '货架' },
      { x: 0.75, y: 0.66, label: '收银台' },
      { x: 0.25, y: 0.75, label: '购物篮' },
    ],
  },
  hospital: {
    background: '/models/scenes/hospital.jpg',
    hotspots: [
      { x: 0.55, y: 0.2, label: '挂号台' },
      { x: 0.55, y: 0.62, label: '候诊椅' },
      { x: 0.14, y: 0.42, label: '绿植' },
    ],
  },
  bank: {
    background: '/models/scenes/bank.jpg',
    hotspots: [
      { x: 0.55, y: 0.25, label: '柜台' },
      { x: 0.45, y: 0.66, label: '等候区' },
      { x: 0.2, y: 0.52, label: '叫号机' },
    ],
  },
  mall: {
    background: '/models/scenes/mall.jpg',
    hotspots: [
      { x: 0.5, y: 0.55, label: '中庭' },
      { x: 0.2, y: 0.32, label: '店铺' },
      { x: 0.5, y: 0.22, label: '扶梯' },
    ],
  },
  station: {
    background: '/models/scenes/station.jpg',
    hotspots: [
      { x: 0.62, y: 0.44, label: '长椅' },
      { x: 0.5, y: 0.8, label: '铁轨' },
      { x: 0.8, y: 0.4, label: '站牌' },
    ],
  },
  riverside: {
    background: '/models/scenes/riverside.jpg',
    hotspots: [
      { x: 0.6, y: 0.35, label: '石桥' },
      { x: 0.25, y: 0.62, label: '长椅' },
      { x: 0.45, y: 0.72, label: '河边' },
    ],
  },
  bookstore: {
    background: '/models/scenes/bookstore.jpg',
    hotspots: [
      { x: 0.2, y: 0.5, label: '书架' },
      { x: 0.5, y: 0.56, label: '阅读桌' },
      { x: 0.8, y: 0.3, label: '窗边' },
    ],
  },
};

export function builtinSceneFor(placeId) {
  const scene = BUILTIN_SCENES[placeId];
  return scene ? { ...scene, characters: [] } : null;
}
