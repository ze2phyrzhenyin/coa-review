---
name: coa-tasks
description: 把规格拆成 plan/tasks.json 里的任务图：依赖、独占文件范围、验收命令。规格写完后、要并行前使用。只有 planner 用。
---
1. 一个任务一个会话能做完，产出能单独验收。常见拆法：tester 写参照实现和性质 → implementer 写引擎 → implementer 写页面 → evaluator 验收。
2. 每个任务写：`id`（T001 起顺排）、`title`、`role`、`skill`、`depends`、`scope`、`spec`、`accept`。
3. `scope` 是路径前缀，任务之间不重叠才能并行。`src/engines/cache/` 表示整个目录，`src/engines/parity/model*` 表示以这个名字开头的文件。引擎任务的范围要带上它自己的固定用例（`evals/golden/<名>-*`）和规格文件，否则 implementer 没处放固定用例。引擎一个目录一个任务；页面一个目录一个任务；公共文件（`src/scene`、`src/player`、`package.json`）单独成任务，不和别的并行。
4. `accept` 是一条能跑的命令，例如 `pnpm -s exec vitest run src/engines/cache`。
5. 跑 `node scripts/tasks.mjs validate` 和 `node scripts/tasks.mjs ready`，确认能并行的任务确实同时出现。
6. 状态不写在 tasks.json 里，用 `node scripts/tasks.mjs claim|done|block`。
