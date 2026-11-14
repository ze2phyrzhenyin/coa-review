# 场景约定

`src/scene/`：桌面教具风格的三维部件库，直接用 three.js（0.187），不依赖 preact。规则见 `docs/INTERACTION.md`。

## 文件

- 不引用 three.js，页面可以直接用：`index.ts`（入口）、`types.ts`（SceneSpec、各部件属性、Move、Binding、Pose）、`pose.ts`（`bindTable`、`from`、`poseAt`、`frameAt`、`revealedRows`、`hashPose`）、`theme.ts`（颜色、字体、尺寸、时长，浅色深色各一套，只在这里定义）。
- 三维运行时，只能用 `loadRuntime()` 动态加载：`stage.ts`、`view.ts`、`kit.ts`、`motion.ts`、`parts/*`。打包后是单独的 `runtime-*.js`（约 609 kB，gzip 157 kB），外壳不含 three.js。

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
- `moves(step)` 返回 `Move[]`：`{ value, from, to, via?: 连线 id[], ink?, phase? }`。值从 `from` 的值牌出发，升到线的上方沿 `via` 走，落到 `to` 的值牌；进出总线时沿导轨走。`phase` 相同的一起走，`phase` 大的等前一批落下再走（例如 指存→IBUS 之后 IBUS→IR）。不给 `moves` 时值牌原地翻面。
- 连线有 `via` 时，两端朝最近的拐点出线，便于把几条线汇到一条公共走线上（模型机的寄存器出线）。

## 部件和属性

所有部件都认 `focus`（垫一张深色纸）、`changed`（强调色）、`pickable`（四个角）、`hidden`；前三个由播放器按当前步填。

| kind | 属性 | 说明 |
|---|---|---|
| `register` | `name` `value` `ink?` `width?` | 实体块上斜立着值牌，左上是名牌 |
| `bus` | `name` `length` `value` `drivers?` `ink?` `tileAt?` `showDriver?` | 导轨。`value` 为空表示没有部件驱动；`drivers` 是数组或用顿号隔开的字符串，两个以上画成冲突。`tileAt` 可以随状态变（值牌停在驱动者正对的地方），牌旁写「X 驱动」 |
| `gate` | `name` `open` `dir?` `ink?` `states?` | 三态门，尖指向 `dir`（n s e w）。导通时转到与线对齐并落下，关断时横过来抬起。`open` 接受布尔值或 `'1'` |
| `memory` | `name` `columns[{title,width?,ink?}]` `rows: string[][]` `labels?` `active?` `changedCells?` | 行列格子。`changedCells` 写 `'行.列'` |
| `bits` | `name?` `bits` `carry?` `group?` `from?` | 翻片，白面 0 深色面 1。多位同时变时逐位错开 30 毫秒。`carry` 是产生进位的列，进位牌跳到左边一列 |
| `token` | `value` `at` `via?` `ink?` | 停在 `at` 指的部件上，`at` 变了沿 `via` 走过去 |
| `sheet` | `title?` `columns` `rows` `shown` `current?` | 答题纸。不绑定时自动取 `trace.table`，按当前步填到第几行 |
| `label` | `text` `size?` `tone?` `weight?` `plate?` `mono?` | 一行字；`plate` 为真时画在小牌上 |

每个部件是一个小类，`update(props, animate)`，`animate` 取 `false`、`'flip'`（原地翻面）、`'land'`（有值落进来，旧值的牌升起淡出）。更新后的画面只取决于 `props`。

## 画面和镜头

- 文字用系统字体画到 canvas 再贴图，始终正对屏幕。贴图按设备像素的 1.5 倍出，镜头缩放停下后重画。不下载字体。
- 三种墨色同时用线型区分：数据实线，地址双线，控制虚线。没有值走过的线是淡色，这一步有值走过的是实色。
- 渲染按需进行：没有动画和操作时不重绘。像素比最高 2。一盏带阴影的平行光加半球光，台面只接收阴影。
- 镜头：俯角 52°，视角 20°，不旋转世界。`SceneView.plan(frames, extras, poses, targets)` 由播放器调用，每一步的镜头位置从第 0 步按规则推出，所以回到第 n 步与第一次到时相同：整张台面装得下且每单位不少于约 44 像素（窄屏 50，允许小 12%）时一直看全景；否则焦点移出画面才移动，依次试：焦点加 `extras`（等作答时下一步要动的部件）→ 焦点 → `targets`（值最后落下的部件）→ 其中第一个。字最多缩到 0.84 倍，画面不滑出台面。部件的范围按那一步的属性算（`focusBox(props)`，空着的总线不算）。移动 760 毫秒，先加速后减速。
- `SceneView.rehearse(value, from, to)`：按学生选错的答案演一遍（镜头先把两头放进画面，值飞过去、落下、部件轻摇，1 秒后退回）。`show(..., { frame })` 临时看住指定部件（弄坏它用）。
- 学生可以拖动（方位 ±24°，鼠标另可调俯角）、双指或 ctrl 加滚轮缩放（0.6–2.4 倍）、按住 shift 拖动平移；双击复位。普通滚轮和竖向滑动留给页面。
- `Stage.frame(ids)` 可单独使用：焦点不在画面里才移动。

## 转场

前进一步且有 `moves`：门和信号先动（220 毫秒）→ 值沿线走（每单位 105 毫秒，280–900 毫秒，到达前减速）→ 落进接收的部件 → 其余读数更新。后退和跳转只做原地翻面。换步时上一段动画立刻到位。系统要求减少动态效果时直接切换。

## DOM 约定

`[data-stage]` 上：学生一按换步就写 `data-settled="false"`（不等页面重新渲染）；最后一帧画完后写 `data-settled="true"` 和 `data-scene-hash`（目标画面全部部件属性和连线状态的 FNV-1a 摘要，8 位十六进制）。平面模式同样有这两个属性。

## 已知的限制

- 只有软件渲染或没有 WebGL2 时不建场景，播放器用平面模式。
- 演后果只对点选题做：值飞向学生点的部件。填数题答错只有提示。
- 粒度较粗（CPU 周期、指令）时，镜头只看住这一段的落点，前面几批移动可能发生在画面外。
- 没有接触阴影贴图，阴影全靠一张阴影图（宽屏 2048，窄屏 1024）。
- `memory` 和 `sheet` 的列宽按字数估算，行数多时没有滚动窗口；`memory` 建议不超过 8 行。
- `token` 停在部件上时会盖住该部件自己的值牌。
- 部件的行数、位数在建好后不能变；换 Trace 时整个场景重建。
- 只在 Chromium（Metal）里看过截图，没有在真机和 Safari 上测过帧率。
