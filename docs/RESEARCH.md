# 调研

2026-11-14，三个调研子 agent 的结果。每条的链接和日期在分文件里：`docs/research/tools.md`、`methods.md`、`oss.md`。下面是采用情况和我抽查过的事实。

## 抽查过的事实

| 事实 | 怎么查的 | 结果 |
|---|---|---|
| `codex exec` 没有 `--full-auto` | 本机 `codex exec --help`（0.169.0） | 属实 |
| `claude` 有 `--permission-prompts`、`-w/--worktree`、`--max-budget-usd` | 本机 `claude --help`（2.1.325） | 属实；帮助里没有 `--max-turns`，循环脚本改用限时 |
| 第七版没有 Booth | 在教材和解析书全文里搜 | 属实 |
| 教材 cache 最低字段叫字地址、没有有效位、有 FIFO+LRU | 在教材全文里搜 | 属实 |
| 溢出用变形补码，除法是加减交替，舍入有 0 舍 1 入 | 在教材全文里搜 | 属实 |

## 采用

- 一份 `AGENTS.md`，`CLAUDE.md` 用 `@AGENTS.md` 引入；技能放 `.agents/skills`，`.claude/skills` 软链接过去。
- 每个任务一个全新会话的外层循环；计划、状态、交接都在文件里。
- 写和审分开；参照实现和性质测试由另一个会话只看规格写。
- 任务独占文件范围，一任务一个 worktree，串行合并，合并后主干再跑门禁。
- 页面验收清单 `plan/features.json`，只许改 `passes` 和 `evidence`。
- 一个门禁脚本，Claude Code 和 Codex 的 hook 都调它；拦截用退出码 2。
- 确定性引擎用 fast-check 性质、参照对拍、固定用例做背压；界面用 Playwright 逐页检查和截图审看。
- 依赖尽量少：preact、three；测试用 vitest、fast-check、Playwright。

## 不采用

见 `docs/DECISIONS.md` D10 和 `docs/research/methods.md` 末尾。

## 未验证

各分文件里标了「未验证」的条目没有采用为依据。`loop.sh` 里 Claude Code 和 Codex 的无人值守参数还没有实际跑过一轮。
