# 交接

2026-11-14 上午。负责人额度用尽前的状态，下次从这里接着做。

## 已完成

- `docs/PLAN.md`：开发计划，57 个页面，三批。
- `docs/textbook/*.md`：白中英第七版分章梳理（记号、算法、模型机、题型）。教材和解析书的文本在 `.local/textbook/`（不进仓库）。
- `docs/research/tools.md`、`methods.md`：工具规范和开发方法调研。`oss.md`（开源项目）调研当时还在跑，看文件是否存在。
- `docs/INTERACTION.md`：交互、3D 场景、动效标准。
- `src/engines/trace.ts`：Trace 契约和通用校验，测试通过。
- 最小站点外壳（`src/app`、`src/main.tsx`、`src/content/pages.ts`）。
- 门禁：`bash scripts/gate.sh`（约 2 秒）、`bash scripts/gate.sh --build`（约 7 秒），都通过。
- `scripts/tasks.mjs`、`loop.sh`、`fanout.sh`、`release.sh` 已写，`loop.sh` 和 `fanout.sh` 还没实际跑过。
- `.agents/skills/no-ai-flavor` 已复制，`.claude/skills` 软链接已建。

## 现状（2026-11-15 18:35）

- 线上 https://coa.zhaoyang.fr ：版本 `20261115T173129Z-9f951e8`，24 页（三个样板页加一批 21 页），都过了独立验收。回滚 `bash scripts/release.sh rollback`。公开仓库 https://github.com/ze2phyrzhenyin/coa-review 。
- 一批还差两页没上线：`6-serial`、`5-flow`。作者已按 `evals/look/final-recheck.md` 修好，等独立复核；通过后把 `plan/features.json` 的 `passes` 和 `src/content/pages.ts` 的 `live` 置 true 再发布。
- 二批 30 页还没开始（`docs/PLAN.md`）。做法照一批：引擎和规格 → 独立测试 → 页面 → 验收 → 发布。
- 负责人后加的要求都在 `docs/INTERACTION.md`：形象直观有趣、易懂、专业、美观、去 AI 味；场景和控制条在所有步骤里位置固定（qa-pages 会查）。
- 新增检查：`scripts/qa-clip.mjs`（手机 360–390 px 每步主体完整入画；`--strict` 只作参考）、qa-pages 的位置固定检查、门禁按线上构建再查一遍导航。
- 验收的教训：只看桌面和 390 px 的人工验收会漏掉 360 px 裁切和「手机上少内容」；作者会为了过检查删内容，要单独做手机与桌面一致性复查（`evals/look/final-parity.md`）。
- 低优先级遗留见 `evals/look/final-recheck.md`、各页 `report-b3.md`；共用答题纸的合并计划在 `plan/progress/T101.md`。
- Codex 仍未登录（`codex login`）。

## 框架验收（11-14，在临时副本里做，没动本仓库的提交记录）

| 项目 | 结果 |
|---|---|
| 门禁拦得住：禁用词、非教材术语、引擎用随机数、抄教材原文、越权改验收清单、侧栏换页重建 | 六项都报错，改回后全绿 |
| `fanout.sh`：两个无依赖任务各开 worktree 并行，再按依赖顺序合并 | Claude Code 那一路完成并合并；合并后主干门禁通过 |
| `loop.sh`：串行领剩下两个任务 | Claude Code 依次完成 T002、T003，`gate.sh --build` 通过 |
| Codex | 没跑成：登录凭证失效（token_revoked）。需要负责人在终端运行 `codex login` |
| 新会话只读 `AGENTS.md` 能说出怎么运行、测试、加任务 | 能，五问都答对 |

验收中发现并修掉的问题：bash 变量后紧跟全角字符（门禁现在会查）；主干上的占位状态文件让合并失败；空跑也被标成完成（现在必须有范围内改动并通过任务自己的验收命令）；worktree 删掉后日志丢失；引擎没登录时被记成任务失败（现在直接停下并提示）；文件名前缀的范围写法。

## 还没做

1. （已完成）框架：`AGENTS.md`、`CLAUDE.md`、hooks、`.codex/`、7 个角色、10 个项目技能、`docs/STYLE.md`、`DECISIONS.md`、`RESEARCH.md`、`BORROWED.md`。
2. Codex 重新登录后，用 `bash scripts/loop.sh --engine codex --task <id>` 跑一个小任务，补上 Codex 的验收。
3. 仓库还没有任何提交（负责人没要求提交）。`fanout.sh` 需要先有一个提交。
4. 0.1 版：三个样板页（`5-cycle`、`3-cache-run`、`2-overflow`），先做 `5-cycle` 验证 3D 场景在手机上的清晰度和流畅度。
5. 部署：`coa.zhaoyang.fr` 的 DNS 记录、rex-ovh 的 nginx 站点和证书都还没建，域名前缀等负责人确认。

## 已核实的工具事实

- `codex exec` 没有 `--full-auto`，用 `--sandbox workspace-write -c 'approval_policy="never"'`；Codex 沙箱里 `.git` 只读，提交由脚本在外面做。
- macOS 没有 `timeout`，`loop.sh` 用 perl 的 alarm。
- `vite preview` 要加 `--host 127.0.0.1`，否则只听 IPv6。
- bash 里变量后面紧跟全角字符要写成 `${VAR}`。
- Playwright 固定 1.65.0，复用本机已装的浏览器。
