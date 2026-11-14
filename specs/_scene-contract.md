# 场景约定

`src/scene/`：桌面教具风格的三维部件库，直接用 three.js（0.187），不依赖 preact。规则见 `docs/INTERACTION.md`。

## 文件

- 不引用 three.js，页面可以直接用：`index.ts`（入口）、`types.ts`（SceneSpec、各部件属性、Move、Binding、Pose）、`pose.ts`（`bindTable`、`from`、`poseAt`、`frameAt`、`revealedRows`、`hashPose`）、`theme.ts`（颜色、字体、尺寸、时长，浅色深色各一套，只在这里定义）、`rich.ts`（上下标解析）。
- 三维运行时，只能用 `loadRuntime()` 动态加载：`stage.ts`、`view.ts`、`kit.ts`、`motion.ts`、`parts/*`。打包后是单独的 `runtime-*.js`（约 613 kB，gzip 158 kB），外壳不含 three.js。

## 声明一个场景

```ts
const scene: SceneSpec = {
  parts: [{ id: 'R1', kind: 'register', position: [-1.5, -2.9], props: { name: 'R1', value: '' }, pick: true }],
  wires: [{ id: 'r1-c2', from: 'R1', to: 'C2' }],
};
const bind = bindTable<State>({ R1: { value: 'reg.R1' }, C2: { open: 'ctl.C2' } });
```

- `position` 是台面坐标 `[x, z]`：x 向右，z 朝向观看的人。一个寄存器宽 2.4、深 1.2。部件不在步骤之间换位置。
- `pick: true` 的部件可点选，播放器为它生成 `button[data-pick]`。
- 连线端点写部件 id，可带边：`'DR.w'`（n 远、s 近、e 右、w 左）。不写时取朝向对方的一边；接总线时落在对方正对的位置。不在一条直线上自动走横竖折线，或用 `via: [[x, z]]` 指定拐点。`ink` 默认 `data`。
- `bindTable` 的每个属性写状态路径（`flatten` 后的字符串），或 `from(路径, (c) => 值)`，或一个函数。`c` 里有 `state`、`flat`、`index`、`step`、`changed`。写明路径，`step.focus` 和 `step.changes` 才能落到部件上。
- `moves(step)` 返回 `Move[]`：`{ value, from, to, via?: 连线 id[], ink?, phase?, arc? }`。值从 `from` 的值牌出发，升到线的上方沿 `via` 走，落到 `to` 的值牌；进出总线时沿导轨走；`arc` 且没有 `via` 时抬高再落下。`from`、`to` 可写存储阵列的一个格子 `'mem.3.1'`。`phase` 相同的一起走，大的等前一批落下再走。不给 `moves` 时值牌原地翻面。部件的 `delay`（毫秒）让一排部件原地翻面时逐个错开。
- 连线有 `via` 时，两端朝最近的拐点出线，便于把几条线汇到一条公共走线上（模型机的寄存器出线）。

## 部件和属性

所有部件都认 `focus`（垫一张深色纸）、`changed`（强调色）、`pickable`（四个角）、`hidden`；前三个由播放器按当前步填。

| kind | 属性 | 说明 |
|---|---|---|
| `register` | `name` `value` `ink?` `width?` | 实体块上斜立着值牌，左上是名牌 |
| `bus` | `name` `length` `value` `drivers?` `ink?` `tileAt?` `showDriver?` `idleText?` | 导轨。`value` 为空表示没有部件驱动；`drivers` 是数组或用顿号隔开的字符串，两个以上画成冲突。`tileAt` 可以随状态变（值牌停在驱动者正对的地方），牌旁写「X 驱动」 |
| `gate` | `name` `open` `dir?` `ink?` `states?` | 三态门，尖指向 `dir`（n s e w）。导通时转到与线对齐并落下，关断时横过来抬起。`open` 接受布尔值或 `'1'` |
| `memory` | `name` `columns[{title,width?,ink?}]` `rows: string[][]` `labels?` `active?` `cell?` `changedCells?` | 行列格子。`active` 框一整行，`cell` 框一格，`changedCells` 标强调色，格子写 `'行.列'` |
| `bits` | `name?` `bits` `pitch?` `carry?` `group?` `from?` | 翻片，白面 0 深色面 1，其余字符（空格）是空槽。多位同时变时逐位错开 30 毫秒。`carry` 是产生进位的列，进位牌跳到左边一列。点到某一位时点选带上位号（翻位片作答） |
| `token` | `value` `at` `via?` `ink?` | 停在 `at` 指的部件上，`at` 变了沿 `via` 走过去 |
| `sheet` | `title?` `columns` `rows` `shown` `current?` | 答题纸。不绑定时自动取 `trace.table`，按当前步填到第几行 |
| `label` | `text` `size?` `tone?` `weight?` `plate?` `mono?` | 一行字；`plate` 为真时画在小牌上 |

每个部件是一个小类，`update(props, animate)`，`animate` 取 `false`、`'flip'`（原地翻面）、`'land'`（有值落进来，旧值的牌升起淡出）。更新后的画面只取决于 `props`。

## 画面和镜头

- 文字用系统字体画到 canvas 再贴图，始终正对屏幕。贴图按设备像素的 1.5 倍出，镜头缩放停下后重画。不下载字体。`S_f1`、`2^6`、`2^(n+2)`、`x_{i}` 画成降低、升高的小字。
- 三种墨色同时用线型区分：数据实线，地址双线，控制虚线。没有值走过的线是淡色，这一步有值走过的是实色。
- 渲染按需进行：没有动画和操作时不重绘。像素比最高 2。一盏带阴影的平行光加半球光，台面只接收阴影。
- 镜头：俯角 52°，视角 20°，不旋转世界。`SceneView.plan(frames, extras, poses, targets, picks)` 由播放器调用，每一步的镜头位置从第 0 步推出，回到第 n 步与第一次到时相同。场景里的字最小 0.31（`MIN_TEXT`）。缩小的下限 `legibleScale` 让这样的字是 12 像素（手机上再留 20%，抵后排的透视）。整张台面在下限以上（宽屏放宽到 0.9 倍）装得下就一直看全景；否则：点选题先把全部候选（`picks`，能带上焦点就带上）放进画面；其余步焦点移出画面才移动，依次试 焦点加 `extras` → 焦点 → `targets`（值落下的部件）→ 其中第一个。横向装得下整张台面时不放大到左右被裁；`bits` 的左右范围按名牌只在左边算。画面不滑出台面。部件范围按那一步的属性算（`focusBox(props)`，空总线不算）。移动 760 毫秒。
- 一步里分批的移动，某一批的两头不在这一步的镜头里时，镜头和值一起出发移到落点，走完回到这一步的镜头：值不在画面外走。
- `rehearse(value, from, to)` 按学生选错的答案演一遍（两头先进画面，值飞过去、落下、轻摇，1 秒后退回）。`show(..., { frame })`、`lookAt(ids)` 临时看住指定部件。
- 学生可以拖动（方位 ±24°，鼠标另可调俯角）、双指或 ctrl 加滚轮缩放（0.6–2.4 倍）、按住 shift 拖动平移；双击复位。普通滚轮和竖向滑动留给页面。

## 转场

前进一步且有 `moves`：门和信号先动（220 毫秒）→ 值沿线走（每单位 105 毫秒，280–900 毫秒，到达前减速）→ 落进接收的部件 → 其余读数更新。后退和跳转只做原地翻面。换步时上一段动画立刻到位。系统要求减少动态效果时直接切换。

## DOM 约定

`[data-stage]` 上：学生一按换步就写 `data-settled="false"`，换步开始时写 `data-scene-hash`；最后一帧画完后写 `data-settled="true"`、`data-min-text`（画面上看得见的字里最小的字号，CSS 像素）和 `data-min-text-label`（是哪一段字）。`qa-pages` 在 390 宽时要求不小于 12。摘要是目标画面全部部件属性和连线状态的 FNV-1a 摘要（8 位十六进制）。平面模式同样有这两个属性。

## 已知的限制

- 只有软件渲染或没有 WebGL2 时不建场景，播放器用平面模式。
- 候选在 14 像素下装不进画面时（例如 5-cycle 的「哪个部件接收」），靠「看其余部件」按钮分批看。
- 没有接触阴影贴图，阴影全靠一张阴影图（宽屏 2048，窄屏 1024）。
- `memory` 和 `sheet` 的列宽按字数估算，行数多时没有滚动窗口；`memory` 建议不超过 8 行。
- `token` 停在部件上时会盖住该部件自己的值牌。
- 部件的行数、位数在建好后不能变；换 Trace 时整个场景重建。
- 只在 Chromium（Metal）里看过截图，没有在真机和 Safari 上测过帧率。
