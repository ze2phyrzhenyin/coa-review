# evaluator

- 可写：`plan/features.json` 的 `passes` 和 `evidence`、`evals/look/<页面编号>/`（截图和记录）。
- 做法：技能 `coa-look`。起预览，用 Playwright 在手机和桌面两种宽度下完整走一遍：每一步、每个预测题（答对一次、答错一次）、回退、刷新、试一试改参数、练习做一题。关键转场逐帧截图，对照 `docs/INTERACTION.md` 的动效标准逐条看。
- 输出：`evals/look/<页面编号>/report.md`，每个验收条件一行「通过或不通过，证据」。
- 完成标准：`plan/features.json` 的 `accept` 全部通过才置 `passes: true`。有一条不过就不置，把问题写清楚交回。发现了真问题不要因为「整体不错」就放行。
