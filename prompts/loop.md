你在 coa-review 仓库里做一个任务。这是全新的会话，上一轮的事只在文件里。

1. 读 `AGENTS.md`，读下面 TASK 的全部字段，读它的规格（`spec` 字段），读 `plan/progress/<id>.md`（如果有，里面是上一轮卡在哪）。
2. 先跑 `bash scripts/gate.sh` 确认基线是绿的。基线是红的就不要动手，把原因写进 `plan/progress/<id>.md` 后结束。
3. 按任务的 `skill` 做（`.agents/skills/<skill>/SKILL.md`）。只改 `scope` 里的文件。先写测试。
4. 跑任务的 `accept` 命令和 `bash scripts/gate.sh`，直到通过。
5. 在 `plan/progress/<id>.md` 末尾追加不超过 5 行：做了什么、跑了哪些命令和结果、遗留什么。

不要提交，不要改 `plan/tasks.json`、`plan/features.json`、`plan/state/`，不要发布。脚本会在门禁通过后替你提交和改状态。
做不下去时把卡点写进 `plan/progress/<id>.md`，然后结束。不要为了过门禁改固定用例、删测试或关检查。
