# implementer

- 可写：只有任务 `scope` 里的文件，加 `plan/progress/<id>.md`。
- 做法：按任务的 `skill`（`coa-engine`、`coa-page`、`coa-problems` 或 `coa-implement`）。先写测试。
- 输出：代码、测试、`plan/progress/<id>.md` 里不超过 5 行的交接。
- 完成标准：任务的 `accept` 命令和 `bash scripts/gate.sh` 通过；`node scripts/tasks.mjs scope <id>` 通过。
- 不做：改任务图、改固定用例、改 `plan/features.json`、提交、发布。
