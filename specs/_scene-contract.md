# 场景约定

`src/scene/`：桌面教具风格的三维部件库，直接用 three.js（0.187），不依赖 preact。规则见 `docs/INTERACTION.md`（先读「形象、直观、有趣」「易懂、专业、美观」）。部件样张：`/5-cycle?demo=parts`（`g=` 选组，浅色深色跟系统）。

## 做一页的顺序（照三个样板页：`2-overflow`、`3-cache-run`、`5-cycle`）

1. 读引擎规格和 Trace 的状态。场景只读状态，不在页面里算答案。
2. `src/pages/<id>/scene.ts`：`SceneSpec`（部件、连线）+ `bindTable` + `moves(step)` + `names`、`values`。窄屏另排一套位置（`useNarrow()`），390 宽时字不小于 12 像素。
3. 主题选一个比喻（INTERACTION 的表），优先用内置部件；不够时在 `parts.ts` 里用 `definePart` 写页面自带部件（见下）。
4. 编排：起因（门、信号：`shape: 'level'`）→ 移动 → 落定（寄存器盖板、回弹）；一批一个主角，其余自动变淡。
5. `Player` 给 `question`（第 0 步）、`conclusion`、`needs`、`mistakes`（两三条，每条能演）、`convention`、`onWrong`、`askFrame`、必要时 `frame`。
6. 讲解、试一试、练习三栏，状态都进网址。在浏览器里看 390 和 1280、浅色深色，逐帧看一次转场，`bash scripts/gate.sh --build` 绿。

## 文件

- 不引用 three.js，页面可以直接用：`index.ts`（入口）、`types.ts`（SceneSpec、各部件属性、Move、Binding、Pose）、`pose.ts`（`bindTable`、`from`、`poseAt`、`frameAt`、`revealedRows`、`hashPose`）、`theme.ts`（颜色、字体、尺寸、时长，浅色深色各一套，只在这里定义）、`rich.ts`（上下标解析）。
- 三维运行时，只能用 `loadRuntime()` 动态加载：`stage.ts`、`view.ts`、`kit.ts`、`motion.ts`、`sound.ts`、`define.ts`、`parts/*`。打包后是单独的 `runtime-*.js`（gzip 约 110 kB），外壳不含 three.js。

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
- `moves(step)` 返回 `Move[]`：`{ value, from, to, via?: 连线 id[], ink?, phase?, arc?, shape? }`。`shape: 'level'`（电位，扁平长条）、`'pulse'`（脉冲，窄高尖块）是控制信号，`value` 写信号名；到达时接收的部件按这一步的属性原地变（门落下），同一部件还收值时以值落下为准（脉冲和值同一批到，盖板合上）。值从 `from` 的值牌出发，升到线的上方沿 `via` 走，落到 `to` 的值牌；进出总线时沿导轨走；`arc` 且没有 `via` 时抬高再落下。`from`、`to` 可写存储阵列的一个格子 `'mem.3.1'`。`phase` 相同的一起走，大的等前一批落下再走。不给 `moves` 时值牌原地翻面。部件的 `delay`（毫秒）让一排部件原地翻面时逐个错开。
- 连线有 `via` 时，两端朝最近的拐点出线，便于把几条线汇到一条公共走线上（模型机的寄存器出线）。

## 部件和属性

所有部件都认 `focus`（垫一张深色纸）、`changed`（强调色）、`pickable`（四个角）、`hidden`；前三个由播放器按当前步填。

| kind | 属性 | 说明 |
|---|---|---|
| `register` | `name` `value` `ink?` `width?` | 实体块上斜立着值牌，左上是名牌；有值落进来（`'land'`）时顶上的盖板掀开再合上 |
| `bus` | `name` `length` `value` `drivers?` `ink?` `tileAt?` `showDriver?` `idleText?` | 导轨。`value` 为空表示没有部件驱动；`drivers` 是数组或用顿号隔开的字符串，两个以上画成冲突。`tileAt` 可以随状态变（值牌停在驱动者正对的地方），牌旁写「X 驱动」 |
| `gate` | `name` `open` `dir?` `ink?` `states?` | 三态门，尖指向 `dir`（n s e w）。导通时转到与线对齐并落下，关断时横过来抬起。`open` 接受布尔值或 `'1'` |
| `memory` | `name` `columns[{title,width?,ink?}]` `rows: string[][]` `labels?` `active?` `cell?` `changedCells?` `open?` | 行列格子。`active` 框一整行，`cell` 框一格，`changedCells` 标强调色，格子写 `'行.列'`；`open`（行号或数组）像抽屉一样拉出来 |
| `bits` | `name?` `bits` `pitch?` `carry?` `group?` `from?` | 翻片，白面 0 深色面 1，其余字符（空格）是空槽。多位同时变时逐位错开 30 毫秒。`carry` 是产生进位的列，进位牌跳到左边一列。点到某一位时点选带上位号（翻位片作答） |
| `token` | `value` `at` `via?` `ink?` | 停在 `at` 指的部件上，`at` 变了沿 `via` 走过去 |
| `sheet` | `title?` `columns` `rows` `shown` `current?` | 答题纸。不绑定时自动取 `trace.table`，按当前步填到第几行 |
| `label` | `text` `size?` `tone?` `weight?` `plate?` `mono?` | 一行字；`plate` 为真时画在小牌上 |
| `chip` | `name` `label?` `pins[{id,name,side,value?,lines?,at?,ink?}]` `selected?` `width?` `depth?` | 存储芯片，四边伸出几束引脚（地址、数据、CS、WE），每束旁一张名牌和读数；`selected` 时从板上抬起。连线接引脚 `'U1.cs'` |
| `decoder` | `inputs` `input?` `enableName?` `enable?` `outputs?` `outputNames?` `active?` `low?` `name?` | n–2^n 译码器，左输入、右一列输出 `Y_0…`、前面使能端；`active` 由引擎给，那根输出的名牌翻成强调色。引脚 `'D.y3'`、`'D.in0'`、`'D.en'` |
| `grid` | `columns` `rows` `cells[行][列]` `current?` `changedCells?` `bubbles?` `cellWidth?` `tones?` `name?` | 时空格：空格是槽，填上翻成白牌，同列从上往下错开；`bubbles` 的格子放空泡（停顿）；`current` 框一列。`'P.行.列'` 可作移动的起落点 |
| `track` | `length` `span[起,止]` `lanes` `segments[{lane,from,to,text?,ink?,high?}]` `markers?[{at,text,lane?}]` `ticks?` `now?` `connect?` `name?` | 时间轴：一块正对屏幕立着的板（横平竖直），一条道一行，第 0 条在最上；新的一段从左往右长出来；标记是短线加小牌；`now` 是一根竖线；`connect` 在一段结束、另一条道同一时刻开始处画进入、返回的竖线。占地按 `道数 × 1.25 + 0.5` 深，板立在前沿 |
| `signal` | `from` `to` `text` `on?` `ink?` `via?` `offset?` `labelAt?` `heads?` | 两个部件之间带箭头、带名字的线（BR、BG、BS）。端点同连线写法，可接引脚；`on` 时实色从起点走到终点；`offset` 错开几根平行线；`text` 为空不立牌。`position` 不用，写 `[0, 0]` |
| `dial` | `size` `pointer` `from?` `dir?` `marks?[[格,字]]` `seam?` `crossed?` `sectors?` `radius?` `ink?` `name?` | 刻度盘（模 2^n 一圈，0 在正上方顺时针）：从 `from` 转到 `pointer`，转过的画成弧；越过 `seam` 且 `crossed` 时接缝亮起、崩一下。`sectors` 是节拍盘，`pointer` 那格亮，`-1` 都不亮 |
| `balance` | `left` `right` `leftName?` `rightName?` `tilt(-1/0/1)` `name?` | 天平：哪边沉哪边落下，摆一下停住 |
| `conveyor` | `slots` `items` `inLabel?` `outLabel?` `slotWidth?` `name?` | 传送带（a 进 c 出）：按字认出谁挪到哪；新的从 a 端落进，c 端的掉下去，往 a 端回的抬起来从上面过。一行里的字不能重复 |
| `stack` | `cards[{title,note?}]` `width?` `name?` | 一叠程序卡：新卡落下压住，被压住的只露出写着断点的一条；返回时最上面那张被抽走 |
| `compare` | `left` `right` `leftName?` `rightName?` `result('match'/'mismatch'/'')` `name?` | 两张卡并排比：一致靠拢扣上写「=」，不一致碰一下弹开写「≠」 |

每个部件是一个小类，`update(props, animate)`，`animate` 取 `false`、`'flip'`（原地翻面）、`'land'`（有值落进来，旧值的牌升起淡出，落定回弹一下）。更新后的画面只取决于 `props`。门、标签、信号线、节拍盘是「起因」（`cause = true`）：前进时先变，值再走。

## 页面自带部件

`src/scene/define.ts`：`definePart('<页面编号>:<名字>', (kit, id, position, props) => new MyPart(…))`。部件类继承 `Part<P>`，同内置部件一样写 `apply(next, previous, animate)`，可以覆盖 `bounds()`、`focusBox()`、`anchor()`、`port()`、`pin(name)`、`cellAnchor(r, c)`；文字用 `TextPlane`、`Card`（`kit.texts` 里的字自动参加 12 像素和压字检查，`bounds()` 决定镜头和点选按钮）。部件必须如实报三样：`footprint`（底座的宽和深）、`faceWidth`、`faceHeight`（立着的牌或板的宽和高，从 `face` 的原点往上算）。镜头、点选按钮和候选框（等学生点选时的四个角）都按它们算：板高超过底座进深的 1.25 倍时，候选框画在板的平面上，从底座围到板顶；否则贴在台面上围着占地。形状特别的覆盖 `pickFrame()`。`define.ts` 一处导出 `Part`、`Card`、`TextPlane`、几何、`rebound`、`burst`、缓动、`sizes`、`timing`。它引用 three.js，只在 `kinds` 加载的模块里用：

```ts
// src/pages/6-arbiter/parts.ts
import { Mesh } from 'three';
import { Part, definePart, blockGeometry, solid } from '../../scene/define';
class Baton extends Part<{ at: number }> {
  constructor(kit, id, position, props) { super(kit, id, position); this.group.add(solid(new Mesh(blockGeometry(0.3, 0.2, 1.2), kit.mats.accent))); this.update(props, false); }
  protected apply(next) { this.group.position.x = this.center.x + next.at * 2; }
}
definePart('6-arbiter:baton', (kit, id, position, props) => new Baton(kit, id, position, props as never));
// scene.ts：{ parts: [{ id: 'baton', kind: '6-arbiter:baton', position: [0, 0], props: { at: 0 }, describe: (p) => `授权在第 ${p.at} 个设备` }], wires: [], kinds: () => import('./parts') }
```

`describe` 是平面模式和读屏的一句读数。完整的例子：`src/player/gallery-parts.ts`（指示灯）。

## 编排和音效

- 一批移动进行时，不是这一批两头的部件的字变淡（`dim`），走完恢复。
- 落定的那一下回弹：`rebound(kit, object, amount)`；撞车：`burst(kit, parent, at)` 崩出碎片（总线冲突、刻度盘越过接缝）。减少动态效果时都不做。
- 音效：`kit.sound('flip' | 'latch' | 'click' | 'thud' | 'crash')`，WebAudio 合成，默认关，开关在播放器上（`sound.ts`）。只在落定的那一下调用。

## 画面和镜头

- 文字用系统字体画到 canvas 再贴图，始终正对屏幕。贴图按设备像素的 1.5 倍出，镜头缩放停下后重画。不下载字体。`S_f1`、`2^6`、`2^(n+2)`、`x_{i}`、`τ_l` 画成降低、升高的小字。材质和文字色另有 `ok`、`bad`（正确、错误）。码名自动排成下标：`[x]补`、`[x]原`、`[x]反`、`[x]移`、`[x]变补`、`[−y]补` 照常写就行（也可写 `[x]_补`、`[x]_{变补}`），画布和 `Rich` 都认；后面接「码、位、数、动、来、过」时当普通的词。页面上的这类文字要经过 `Rich` 才有下标。
- 三种墨色同时用线型区分：数据实线，地址双线，控制虚线。没有值走过的线是淡色，这一步有值走过的是实色。
- 渲染按需进行：没有动画和操作时不重绘。像素比最高 2。一盏带阴影的平行光加半球光，台面只接收阴影。
- 镜头：俯角 52°，视角 20°，不旋转世界。`SceneView.plan(frames, extras, poses, targets, picks)` 由播放器调用，每一步的镜头位置从第 0 步推出，回到第 n 步与第一次到时相同。场景里的字最小 0.31（`MIN_TEXT`）。缩小的下限 `legibleScale` 让这样的字是 12 像素（手机上再留 20%，抵后排的透视）。整张台面在下限以上（宽屏放宽到 0.9 倍）装得下就一直看全景；否则：点选题先把全部候选（`picks`，能带上焦点就带上）放进画面；页面用 `frame` 指定的部件放在正中，字号不变装不下时只看最后一个（收值的部件）；其余步焦点移出画面才移动，依次试 焦点加 `extras` → 焦点 → `targets`（值落下的部件）→ 其中第一个。横向装得下整张台面时不放大到左右被裁；`bits` 的左右范围按名牌只在左边算。画面不滑出台面。部件范围按那一步的属性算（`focusBox(props)`，空总线不算）。移动 760 毫秒。
- 一步里分批的移动，某一批的两头不在这一步的镜头里时，镜头和值一起出发移到落点，走完回到这一步的镜头：值不在画面外走。
- `rehearse(value, from, to)` 按学生选错的答案演一遍（两头先进画面，值飞过去、落下、轻摇，1 秒后退回）。`show(..., { frame })`、`lookAt(ids)` 临时看住指定部件。
- 学生可以拖动（方位 ±24°，鼠标另可调俯角）、双指或 ctrl 加滚轮缩放（0.6–2.4 倍）、按住 shift 拖动平移；双击复位。普通滚轮和竖向滑动留给页面。

## 转场

前进一步且有 `moves`：门和信号先动（220 毫秒）→ 值沿线走（每单位 105 毫秒，280–900 毫秒，到达前减速）→ 落进接收的部件 → 其余读数更新。后退和跳转只做原地翻面。换步时上一段动画立刻到位。系统要求减少动态效果时直接切换。

## DOM 约定

`[data-stage]` 上：学生一按换步就写 `data-settled="false"`，换步开始时写 `data-scene-hash`；最后一帧画完后写 `data-settled="true"`、`data-min-text`（画面上看得见的字里最小的字号，CSS 像素）、`data-min-text-label`（是哪一段字）和 `data-text-overlaps`（互相压住或挨着不到 3 像素的字，空表示没有）。`qa-pages` 在 390 宽时要求字号不小于 12、没有压字。画面左右边上不切半个部件（`wholeEdges`），手机上舞台贴满屏宽。摘要是目标画面全部部件属性和连线状态的 FNV-1a 摘要（8 位十六进制）。平面模式同样有这两个属性。

## 已知的限制

- 只有软件渲染或没有 WebGL2 时不建场景，播放器用平面模式。
- 候选在 14 像素下装不进画面时（例如 5-cycle 的「哪个部件接收」），靠「看其余部件」按钮分批看。
- 没有接触阴影贴图，阴影全靠一张阴影图（宽屏 2048，窄屏 1024）。
- `memory` 和 `sheet` 的列宽按字数估算，行数多时没有滚动窗口；`memory` 建议不超过 8 行。
- `token` 停在部件上时会盖住该部件自己的值牌。
- 部件的行数、位数、引脚、格子数在建好后不能变；换 Trace 时整个场景重建。`grid` 的格宽按建场景时的字估，整个 Trace 里最长的字要用 `cellWidth` 给够。
- 只在 Chromium（Metal）里看过截图，没有在真机和 Safari 上测过帧率。
