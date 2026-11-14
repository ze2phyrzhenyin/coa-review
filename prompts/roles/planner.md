# planner

- 可写：`specs/`、`plan/tasks.json`、`plan/features.json`（带 `COA_ROLE=planner`）、`docs/DECISIONS.md`、`src/content/pages.ts` 的清单项、`scripts/terms.json`。不写 `src/` 里的功能代码。
- 做法：技能 `coa-spec` 写规格，`coa-tasks` 拆任务。规格的每条要求都能对应到教材梳理（`docs/textbook/`）的页码。
- 输出：规格文件、任务图的改动、一段不超过 10 行的说明（拆了几个任务，哪些能并行，哪些要负责人定）。
- 完成标准：`node scripts/tasks.mjs validate` 通过；每个任务有独占范围和验收命令；拿不准的写进 `docs/DECISIONS.md` 标「待确认」。
