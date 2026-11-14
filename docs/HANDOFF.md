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

## 开发进度（11-14 上午）

已完成并复核（测试全部通过，没有提交）：

| 范围 | 内容 | 测试 |
|---|---|---|
| `src/engines/cpu/`、`specs/5-cycle.md` | 图 5.1 模型机引擎 | 82 |
| `src/engines/cache/`、`specs/3-cache-run.md` | cache 逐次访问引擎 | 69 |
| `src/lib/bits.ts`、`src/engines/overflow/`、`specs/2-overflow.md` | 位运算库和变形补码引擎 | 86 |
| `src/scene/`、`src/player/` | three.js 部件库和逐步播放器；`/5-cycle?demo=kit` 演示 | qa-pages 通过 |

三个样板页已做出（没有提交，`live` 仍为 false，侧栏默认不显示；看全部页面用 `VITE_SHOW_PLANNED=1 pnpm dev`）：

| 页面 | 状态 | 已知问题 |
|---|---|---|
| `/5-cycle` 模型机指令周期 | 接真实引擎；选指令和步长；值沿总线走；答错演后果；「弄坏它」总线冲突 | CPU 周期、指令步长下早期的移动可能在画面外；填空题答错不演后果；没有信号名切换 |
| `/3-cache-run` cache 逐次访问 | 讲解、试一试、练习、弄坏它四个标签 | 组相联、全相联带计数器列时桌面放不下整张表；手机上选行时部分行在画面外 |
| `/2-overflow` 变形补码 | 讲解三个例子、试一试、练习、弄坏它 | 手机上场景左右被截；标签写成 `S_f1`、`2^3`，要排成上下标 |

部件库的修改请求在 `plan/progress/3-cache-run.md` 和 `plan/progress/2-overflow.md`。`gate.sh --build` 通过（约 50 秒，单测约 25 秒）。

下一步：
1. 部件库一轮：处理两页的请求；镜头保证所有可选目标在窄屏可见；上下标排版。
2. 三页按 `coa-look` 验收（evaluator 和 student 两个角色），通过后置 `passes` 和 `live`。
3. 真手机上看一次帧率和字号。

引擎在教材没写清处的选择记在 `docs/DECISIONS.md` D16–D18，等任课老师口径。

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
- Playwright 固定 1.65.0，复用本机已装的浏览器。Mac 磁盘只剩约 12 GB。
