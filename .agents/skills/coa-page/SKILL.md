---
name: coa-page
description: 写或改 src/pages 下的一个页面：把引擎的 Trace 接到 3D 场景和播放器上，做讲解、试一试、练习三部分。做任何学生看得见的页面时使用。不在页面里写计算。
---
1. 读规格、`docs/INTERACTION.md`、`specs/_player-contract.md`、`specs/_scene-contract.md`，看一个已上线的样板页。
2. 页面在 `src/pages/<编号>/index.tsx`，默认导出组件。标题由外壳显示，页面里不再写标题和副标题。
3. 场景用 `src/scene` 的部件声明，位置固定；部件的值绑定到 Trace 状态的路径。值的移动用 `moves(step)` 说明从哪到哪走哪条线。
4. 讲解：一道完整的例题。试一试：参数写进网址（`useParam`），改了立刻重算。练习：同题型换数，随机种子在网址里，判分用引擎；最后一题是台面上的答题纸，不带动画。
5. 「弄坏它」至少一处：让学生做一个错的操作，把后果演出来。
6. 页面里不出现手写的答案和中间值。要显示的数都从 Trace 取。
7. 文字：读 `.agents/skills/no-ai-flavor/SKILL.md` 和 `docs/STYLE.md`。术语用教材的。
8. 自己看：起预览，`PORT=<端口> node scripts/qa-pages.mjs <编号>`；截手机和桌面的图打开看，按 `docs/INTERACTION.md` 的动效标准逐条过。
9. 跑 `bash scripts/gate.sh --build`。验收由 evaluator 做（`coa-look`），自己不改 `plan/features.json`。
