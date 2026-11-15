# 播放器约定

`src/player/Player.tsx`：把一份 Trace 接到场景上，逐步播放。规则见 `docs/INTERACTION.md`，场景部分见 `specs/_scene-contract.md`。

## 用法

```tsx
import { Player } from '../../player/Player';
<Player trace={trace} scene={scene} bind={bind} moves={moves} names={names} />
```

| 属性 | 说明 |
|---|---|
| `trace` | 引擎给的 `Trace<P, S>` |
| `scene` | `SceneSpec` |
| `bind` | `Binding<S>`，一般用 `bindTable` |
| `moves?` | `(step) => Move[]`，这一步哪个值从哪走到哪 |
| `names?` | `(path) => string`，把状态路径换成学生认识的名字，用在「变化」里 |
| `values?` | `(path, value) => string`，「变化」里值的写法（true 写成「开」）；空串和 null 已写成「空」 |
| `caption?` | `(state) => string`，舞台上方一行读数（模型机：CPU 周期、节拍、有效信号） |
| `breakIt?` | `(state, part \| null) => Breakage \| null`，弄坏它：`{ label, patch, moves, message }`。有就在舞台下方给按钮，学生点场景里对应的部件也行；演出时把 `patch` 盖在画面上（`moves` 可以是空数组，镜头不动），`message` 显示在舞台下，「恢复」收回。有待答的题时不给 |
| `onWrong?` | `(ask, value, state, next) => Breakage \| null`，答错时页面演后果（任何题型）：把 `patch` 盖上、`moves` 走一遍，约 2.6 秒后自己退回；`message` 留在题目下的提示前面 |
| `askFrame?` | `(ask, index) => 部件 id[]`，出题时镜头看这些部件（题目问的格子、要比的式子）；候选装不下时靠「看其余部件」 |
| `flipPart?` | `(ask, index) => 部件 id \| null`，`bits` 题在这个 `bits` 部件上翻位片作答 |
| `wide?` | 宽屏上舞台占满整行、讲解排在下面（模型机这种很宽的台面） |
| `children` | 舞台上方的控件（选例题、选粒度），宽屏一排按钮，窄屏下拉框 |
| `question?` | `{ text, at: 部件 id[] }`：第 0 步的标题写这一页要回答的问题，`at` 的部件垫焦点纸，手机上镜头先看它们 |
| `conclusion?`、`needs?` | 最后一步之后的一句话结论（回答页面标题，标「结论」）；`{ href, text }[]`，舞台上方一行「需要先会」 |
| `mistakes?` | `{ text, at?, act(state) => Breakage }[]`：讲解栏末尾「常见错误」，每条写成「容易错成 X，因为 Y」；点开跳到第 `at` 步，把 `act` 的画面盖上、`moves` 走一遍，说明留在舞台下，「恢复」收回 |
| `convention?` | `(step) => string \| null`：这一步用的是本站约定而不是教材时，在「为什么」下标「本站约定」和一句说明 |

`trace`、`scene`、`bind`、`moves` 的引用要稳定（`useMemo` 或写在模块顶层），引用一变场景就重建。样板：`src/pages/5-cycle/machine.ts`（模型机，选例题 `ins`、粒度 `lv`；`/5-cycle?demo=parts` 是部件样张，`src/player/Gallery.tsx`）、`3-cache-run/scene.ts`、`2-overflow/scene.ts`。窄屏版式用 `src/app/media.ts` 的 `useNarrow()` 选（cache 两行两列，竖式收窄）。

文字：标题、为什么、变化、题面、解题表、条件里的 `S_f1`、`2^6` 由 `Rich`（`src/player/Rich.tsx`）排成 `<sub>`、`<sup>`；页面自己的文字也用它。`qa-pages` 见到没排版的记号就报错。粒度：`src/player/coarsen.ts` 的 `coarsen(trace, grain)` 把小步并成节拍、CPU 周期或指令（状态取组里最后一步，变化重算，解题表的行指向所在组），`coarseMoves` 让组里各小步的移动依次走。换粒度时停在同一时刻。

## 一步里显示什么

- 状态：场景。第 0 步是初始状态，第 n 步是 `trace.steps[n-1]` 之后的状态。
- 为什么：`step.why`，后面跟 `step.ref`。
- 变化：`step.changes` 逐条列出，旧值在前新值在后，空串写成「空」。
- 步数和粒度（讲解步、一个节拍、一个 CPU 周期、一条指令、一次访问），`trace.conditions` 原样列出。
- 解题表：`trace.table`，填到当前步为止。没有指回步骤的行跟着它前面的行出现。点已填的行跳到那一步。

## 操作

- 按钮：重置、上一步、下一步，都不小于 44 像素。窄屏（900 像素以下）单列：读数、舞台、题目、弄坏它、控制条、讲解依次排下来；控制条在文档流里，不压住文字。
- 键盘（焦点在播放器内，不在输入框里）：`→` 或空格下一步，`←` 上一步，`Home` 回到开头。打开页面时播放器自动取得焦点。
- 步数写在网址参数 `s`（`history.replaceState`），刷新和分享回到同一步。越界的值落回范围内。
- 动画没播完时再按，当前动画立刻到位。按住可以连翻。没有题目时点部件，读出它的名字和当前值。
- 图例旁「音效关／开」（`aria-pressed`）：翻片、合盖、撞车的轻微音效，WebAudio 现场合成，默认关，选择存在这台设备（`localStorage` 的 `coa:sound`，见 `src/scene/sound.ts`）。

## 答题

第 n 步的画面上，如果 `trace.steps[n].ask` 存在，就出题。不答也可以按下一步，不卡进度。

- 题目一律放在舞台正下方，不盖住任何部件。先写题面和提示，再放操作。
- 点选：`kind: 'choice'` 且每个选项都是某个可点选部件的 id 或 `name` 时，学生点场景里的部件，或用 `Tab` 走到对应的 `button[data-pick]` 按回车。不在画面上的选项在题目下另给按钮。
- 其余 `choice`：选项按钮。`number`、`text`、没给 `flipPart` 的 `bits`：输入框，文字 16 像素，回车或「确定」提交。比对在 `src/player/answers.ts`：全角先换半角；`bits` 忽略空格和下划线，`number` 按数值，`text` 不分大小写、不看空格，十六进制结尾的 H 可写可不写（16bh = 16BH）；`choice` 原样比。
- 翻位片：给了 `flipPart` 的 `bits` 题，那个部件出现空槽，点一位翻一位（空槽先变 0），题目下有同样一排位按钮，翻满后「确定」。
- 点选题的候选在 14 像素的字下装不进画面时，题目下有「看其余部件」（镜头移过去）和这些候选的按钮。
- 答对：直接前进到这一步，值走过去就是确认。
- 答错：留在原步，显示 `ask.hint`。有 `onWrong` 就按页面给的演；否则点选题按学生的答案演一遍（往后找几步，本该落到答案上的值飞到学生点的部件里，没有这样的值时飞一张写着学生答案的牌），镜头先把落点放进画面，1 秒后退回；其余题型下一步要动的部件轻摇。可以重选，也可以点「看答案」前进。
- 点选题时点了不是候选的部件：那个部件轻摇，题目下说明「在 A、B、C 里选」。有候选不在画面上时，题目下列出全部候选，答错后也不会只剩一个。回退到出题那一步，翻过的位片不留。

## DOM 约定

- 根元素 `[data-player]`：`data-step-index` 是当前步数，`tabindex="0"`，`data-mode` 是 `loading`、`scene` 或 `flat`。
- 舞台 `[data-stage]`：`data-settled`、`data-scene-hash`。里面的内容只取决于步数、窗口尺寸和答题状态；跟着部件走的控件按这一步镜头的目标位置摆，不等镜头走到。
- 每个可点选部件一个 `button[data-pick="<id>"]`，透明，盖在部件上，不小于 44 像素，不出舞台；部件不在画面上时按钮裁成看不见、点不到（`is-off`），仍可用键盘聚焦。
- `aria-live="polite"` 区域读出：答题反馈、步数、`step.title`、`step.why`、待答的题面。
- 平面模式：没有 WebGL2、只有软件渲染、运行时加载失败，或网址带 `flat=1` 时使用。没有画布：部件排成一组卡片（名字、当前值，变化用强调色），可点选的部件就是 `button[data-pick]`；步骤、文字、解题表、答题控件相同。无头浏览器不加显卡参数时走的就是这个模式（`scripts/qa-lib.mjs` 的 `launch` 在 macOS 上已加）。

## 网址状态

`src/app/url-state.ts`：`useParam(name, fallback, normal?)` 返回 `[value, set]`，`set` 接受值或 `(previous) => next`，连续调用不丢；值等于缺省值时从网址里去掉；响应 `popstate`。`normal` 把非法值换成实际用的值，并立刻改写网址（?s=999 → 最后一步）。`useIntParam(name, fallback, min, max)` 是带范围的整数版本。

## 已知的限制

- 没有「播放」和调速；2-overflow 的竖式一格一个部件，平面模式里很长；5-cycle 练习的答题纸是页面表格，不在场景里；窄屏上「为什么」排在控制条下面；换 Trace（改参数）时场景整个重建，会闪一帧。
