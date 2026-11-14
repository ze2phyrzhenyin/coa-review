# 3-cache-run 页面

- 做了：`src/pages/3-cache-run/` 四个标签（讲解、试一试、练习、弄坏它，网址参数 `t`）。讲解是直接映射例题 读9 写10 读8 读26 读11 读9：块 5 被块 13 换出（带写回）后再访问又缺失。台面固定：4 行、每块 2 字、地址 5 位；主存画成 4×4 板（行是区，列是区内块号）。在定位步前加了「块 j 放在哪一行」点选题（答案取自引擎的 `access.candidates`），命中/缺失用台面上的两块牌点选。试一试：`map`、`rep`、`seq`，下方是 5 种组合的命中次数和 h（引擎算）。练习：种子 `q`，答题纸是 memory 部件，填写栏压在答题纸下方，判分 `grade()` 比引擎解题表，指出第一处错的行，可跳到试一试里那次访问。弄坏它：`into` 选错行，`break-trace.ts` 用引擎的 splitAddress 排一段 Trace，演找不到和错命中。
- 验证：`vitest src/pages/3-cache-run`（10 项）、`tsc --noEmit`、lint-copy、lint-terms、`qa-pages.mjs 3-cache-run` 都过；截图 `.local/shots/cache-*.png`（`.local/qa-cache-shots.mjs`、`.local/qa-cache-flow.mjs`）。
- 遗留：组相联、全相联带计数器时台面比桌面舞台宽，镜头跟焦点走，不是全景；手机上点选行时有的行在画面外（播放器已把选项列成按钮兜底）；没有写 `plan/features.json`，`live` 未动。

## 给场景库和播放器的请求

1. Player 的 `names` 只管路径名，值原样显示：`写回 false → true`。希望加 `values?: (path, value) => string`。
2. 答错时想按学生的答案演后果（例如点错行就进「弄坏它」那一段），需要 `onWrong(ask, value)` 或允许页面接管分支。现在「弄坏它」只能用页面上的按钮选行。
3. `bus` 没有驱动时总是写「没有部件驱动」，主存与 cache 之间的块传送通路上不合适；希望能关掉这行字或自定义。
4. `memory` 只能整行加框（`active`），想单独框一个格子（主存板上当前的块），现在借用 `changedCells` 的强调色。
5. 移动的值从部件中心出发、落到部件中心；希望 `Move` 能指定 memory 的格子（`from: 'mem.3.1'`），块从主存板上它自己的格子出发。
6. 窄屏上点选题的全部候选装不进画面时（4 行 cache 约 12 单位宽），镜头能否放宽下限，或沿候选行平移。
