---
name: coa-implement
description: 领一个任务，在它的文件范围内做完：先测试，再实现，跑门禁，写交接。引擎用 coa-engine，页面用 coa-page，题目用 coa-problems；其余任务用这个。
---
1. 读 `AGENTS.md`、任务（`node scripts/tasks.mjs show <id>`）、规格、`plan/progress/<id>.md`。
2. 先跑 `bash scripts/gate.sh`，基线不绿不动手。
3. 只改 `scope` 里的文件。需要范围外的改动，写进 `plan/progress/<id>.md` 当作请求。
4. 先写测试，再写实现。
5. 给人看的文字先读 `.agents/skills/no-ai-flavor/SKILL.md`。
6. 跑任务的 `accept` 和 `bash scripts/gate.sh`，再跑 `node scripts/tasks.mjs scope <id>`。
7. 在 `plan/progress/<id>.md` 追加不超过 5 行：做了什么、跑了什么命令和结果、遗留什么。
