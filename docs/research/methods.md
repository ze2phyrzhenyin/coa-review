# AI 开发方法调研

调研日期 2026-11-14。目标项目：Vite + TypeScript + Preact 静态教学站，计算机组成原理的确定性模拟引擎，Vitest + Playwright，由 Claude Code 2.1.x 和 Codex CLI 循环、并行开发。

标记说明：

- 「未验证」：厂商营销内容、页面没有发布日期、或不同来源互相冲突的说法。官方文档页没有发布日期，按规则标「未验证（无日期）」，内容是 2026-11-14 读到的版本。
- 「窗口外」：发布时间早于 2026-02，超出 6 到 9 个月范围，因为是后续方法的出处而保留。
- 读取方式：openai.com 和 medium.com 直接抓取返回 403，这两篇正文经 r.jina.ai 阅读代理读取。GitHub 的 star 数和最近推送日期由 `gh api` 在 2026-11-14 读取。
- 只列了实际打开过的页面。搜索结果里出现但没打开的说法没有写进结论。

## 1. Spec 驱动开发

- 先写 spec 再让 agent 写代码有用，重型 SDD 工具对中小改动过重，spec 写了 agent 也可能不照做。[Böckeler, martinfowler.com](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)，2025-10-15，窗口外。证据：作者实测 Kiro、spec-kit、Tessl；Kiro 给一个小 bug 生成 4 个用户故事和 16 条验收标准；spec-kit 生成大量重复 Markdown；原话 "I'd rather review code than all these markdown files"。失败模式：评审负担转移到 Markdown；agent 无视已有代码重复造类；同一份 spec 多次生成结果不同。采用：只取 spec-first，每个主题一份短 spec，不做 spec-as-source。

- OpenSpec 的 Requirement + Scenario 格式适合当验收标准的写法；Spec Kit 和 BMAD 的整套流程不装。[OpenSpec](https://github.com/Fission-AI/OpenSpec)（74.8k star，2026-11-14 仍在推送）、[spec-kit](https://github.com/github/spec-kit)（149.7k star）、[BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)（55.4k star，README 写 v6.12 稳定、v7 alpha 预计 2026-11 中旬发布）。证据：OpenSpec 用 `### Requirement:` 加 SHALL 语句，`#### Scenario:` 加 WHEN / THEN，变更放 `openspec/changes/<name>/`（proposal.md、design.md、tasks.md、spec 增量），归档后并入 `openspec/specs`。star 数只说明流行度，三个仓库都没有给出效果数据。失败模式：OpenSpec README 自己评价 Spec Kit "Thorough but heavyweight"；BMAD 主线正在换代。采用格式，不采用工具链：`docs/spec/<topic>.md` 手写 Requirement / Scenario，不引入 `/speckit-*`、`/openspec-*` 命令。

- 有 spec 的流程合并率高约 10 个百分点，收益集中在功能类和多文件任务。[Uvik SDD Benchmark](https://uvik.net/spec-driven-development-benchmark/)，运行 2026-10-15，更新 2026-11-02，「未验证」：外包公司自办，题目和代码不公开，单团队单模型。证据：50 个 Python 工单，合并率 Spec Kit 80%、Kiro 82%、BMAD 82%、OpenSpec 84%、无 spec 72%，重复运行的噪声带为 ±10 个百分点；功能类和数据管道类最好的 spec 组 90% 对 60%，bug 修复、重构、补测试基本没有差别；覆盖 8 项清单中 6 项以上的 spec 合并率 89.3% 对 60.0%；spec 阶段中位 18 分钟，BMAD 28 分钟。失败模式：差距接近噪声带；固定 45 分钟时间盒。未验证：只当弱信号，支持「功能任务写 spec，修 bug 不写」。

- 验收标准写成「对任意输入都成立」的性质，可以直接变成 property-based test。[Kiro blog, Aaron Eline](https://kiro.dev/blog/property-based-testing/)，2025-11-17，窗口外。证据：示例把 "no two directions are ever green at the same time" 转成不变量，用 Hypothesis 生成输入并收缩反例；二叉搜索树示例收缩到两个只含 0 的单节点树，暴露 union 处理重复值的 bug。无量化数据。失败模式：原文 "Property testing can't guarantee your program is absent of bugs"；失败可能来自代码、性质或 spec，需要人选改哪一个。采用：引擎 spec 每条 Requirement 后列 1 到 3 条性质，用 fast-check 落地。

## 2. Ralph 循环

- Ralph 的核心是外层 bash 循环：每轮全新上下文、读同一份 spec 和计划文件、只做一件事、靠测试和类型检查挡住坏输出、把学到的写回文件。[ghuntley.com/ralph](https://ghuntley.com/ralph/)，2025-07-14，窗口外；[everything is a ralph loop](https://ghuntley.com/loop/)，2026-01-17。证据：`while :; do cat PROMPT.md | claude-code ; done`；作者自述一份 5 万美元合同的 MVP 花了 297 美元（转述他人 iMessage，「未验证」）。2026 年的文章坚持单仓库单进程，原话 "performs one task per loop"，并要求人看着循环跑。失败模式（作者自述）：醒来发现代码库编译不过，要 `git reset --hard`；重复实现同一功能；占位实现；spec 自相矛盾浪费大量时间；不建议用于已有代码库。采用：循环形状照搬，每个任务一个全新会话；不采用无人值守通宵跑，先保证 gate 可信。

- 官方 `ralph-loop` 插件在同一个会话里用 Stop hook 重喂同一条 prompt，和 Huntley 的「每轮全新上下文」冲突。[claude-plugins-official/plugins/ralph-loop](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/ralph-loop)，最近提交 2026-10-26。证据：README 原话 "The loop happens inside your current session"；`--completion-promise` 是精确字符串匹配；README 自己建议 "Always rely on `--max-iterations` as your primary safety mechanism"。README 的 Real-World Results 三条照抄 Huntley 的说法，「未验证」。失败模式：上下文一直累积；完成标记由模型自己输出。不采用：外层循环用 shell 脚本驱动 `claude -p` 和 Codex 的非交互模式。社区实现 [snarktank/ralph](https://github.com/snarktank/ralph)（22.2k star，最近推送 2026-02-02）、[ralph-orchestrator](https://github.com/mikeyobrien/ralph-orchestrator)（3.2k star）只核对了元数据，没读实现。

- Claude Code 现在自带「做到条件满足为止」：`/goal` 每轮结束后由另一个小模型判断条件，Stop hook 可以跑脚本硬性拦截。[goal 文档](https://code.claude.com/docs/en/goal.md)、[best practices](https://code.claude.com/docs/en/best-practices)，「未验证（无日期）」。证据：`/goal` 的评估器 "does not call tools, so it can only judge what Claude has already surfaced in the conversation"；支持 `claude -p "/goal …"`；条件里可写 `or stop after 20 turns`。best practices 把 "Tell Claude to keep going, loop until done" 列为可以停掉的旧做法，理由是容易造成过度工作。失败模式：评估器只看对话，模型说「测试通过」它就信；连续几轮没有工具调用会停下。采用：完成判定用 Stop hook 跑 gate 脚本，`/goal` 只作单任务会话内的补充。

## 3. 实验室的长时间自主开发做法

- 初始化 agent 加编码 agent：第一轮把需求展开成 JSON 功能清单和进度文件，之后每轮只做一个功能。[Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)，2025-11-26，窗口外。证据：claude.ai 克隆项目的清单有 200 多条，字段为 category、description、steps、passes，编码 agent 只能改 `passes`，prompt 原话 "It is unacceptable to remove or edit tests"；选 JSON 是因为模型不太会乱改；每轮开场固定为 `pwd`、读 git log 和进度文件、读清单选最高优先级未完成项、跑 `init.sh` 加一次端到端冒烟。无成功率数据。失败模式：只跑单元测试或 `curl` 就标完成；Puppeteer MCP 看不到浏览器原生 alert；文章自己说单 agent 还是多 agent 更好 "still unclear"。采用：`features.json` 加「只能改 passes」规则，由 gate 用 diff 检查强制；会话开场流程写进任务 prompt。

- planner / generator / evaluator 三角色把结果质量提上去，成本是单 agent 的 20 倍以上；模型变强后其中一部分可以拆掉。[Anthropic, Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)，2026-03-24。证据：同一 prompt，单 agent 20 分钟 9 美元，核心功能不能用；完整 harness 6 小时 200 美元。Opus 4.6 版本 3 小时 50 分 124.70 美元，其中 QA 三轮合计约 10 美元。evaluator 用 Playwright 点真实页面，每条标准有硬阈值。换到 Opus 4.6 后去掉了 sprint 和逐 sprint 评分，保留 planner 和末尾 evaluator。原话 "every component in a harness encodes an assumption about what the model can't do on its own"。失败模式：evaluator 开箱即用时会先发现问题再说服自己放行，测试流于表面，要读它的日志反复调 prompt；小的布局问题和深层功能 bug 漏检；generator 留桩。采用：planner 和独立 evaluator；不采用 sprint 合同逐轮谈判。每加一个组件写明它假设模型做不到什么，换模型时复查。

- OpenAI 的 Codex 团队把仓库当成唯一事实来源：`AGENTS.md` 约 100 行只当目录，知识放 `docs/`，架构规则用自定义 lint 强制，报错文本里写修法。[Harness engineering](https://openai.com/index/harness-engineering/)，2026-02-11（日期取自搜索结果，正文经代理读取）；[Run long horizon tasks with Codex](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex)，「未验证（无日期）」。证据：5 个月约 100 万行、约 1,500 个 PR，3 人起步后到 7 人，人均每天 3.5 个 PR，零手写代码；应用可按 worktree 启动，agent 通过 Chrome DevTools Protocol 看 DOM 快照和截图；曾每周五花 20% 时间清理 "AI slop"，后来改成后台任务按 golden principles 扫描并提小 PR。长程实验：GPT-5.3-Codex 连续约 25 小时、约 1,300 万 token、约 3 万行，靠 `prompt.md`（目标、非目标、Done when）、`plans.md`（里程碑加验证命令）、`implement.md`（运行手册）、`documentation.md`（状态和决策日志）四个文件。失败模式：大而全的 `AGENTS.md` "rots instantly"；agent 复制仓库里已有的坏模式；原文提醒这套做法 "should not be assumed to generalize without similar investment"；长程实验自述 "not perfect or production-ready"。采用：`AGENTS.md` 当目录、带修复提示的自定义检查、每个任务的 Done when 和验证命令、定期清理任务。不采用它的「最小阻塞合并」，见第 4 节。

- Cursor 让上百个 agent 写同一个代码库的经验：平级自协调和锁失败，分成只规划的 planner 和只执行的 worker 才跑得动。[Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)，2026-01-14；[Towards self-driving codebases](https://cursor.com/blog/self-driving-codebases)，2026-02-05；[Continually improving our agent harness](https://cursor.com/blog/continually-improving-agent-harness)，2026-04-30。证据：用共享文件加锁时 20 个 agent 的吞吐相当于 2 到 3 个；浏览器项目约一周、峰值每小时约 1,000 次提交；集中的 integrator 成为瓶颈后被去掉；"Constraints work better than reminders"，"No TODOs, no partial implementations" 比提醒「把事做完」有效；给具体范围（"Generate 20-100 tasks"）比「多生成」有效。4 月的文章说随模型变强已拆掉多数早期护栏，并按原因分类工具错误。失败模式：没有层级时 agent 回避难任务、只做安全小改动；一个角色兼任过多会乱；第一版浏览器的架构长不成完整浏览器，作者归因于 "a failure of the initial specification"；要求每次提交 100% 正确会让系统串行化，所以他们接受小的错误率再统一修。采用：planner 不写代码、worker 不知道全局、约束式措辞。不采用：接受红色主干换吞吐，本项目规模用不着。

## 4. 任务图与 worktree 并行

- Claude Code 自带四种并行方式，适用面不同；Codex 官方只建议用 worktree 隔离和 subagent 做有界工作。[worktrees](https://code.claude.com/docs/en/worktrees.md)、[sub-agents](https://code.claude.com/docs/en/sub-agents.md)、[workflows](https://code.claude.com/docs/en/workflows.md)、[agent teams](https://code.claude.com/docs/en/agent-teams)、[Codex best practices](https://learn.chatgpt.com/guides/best-practices)，均「未验证（无日期）」。证据：`claude -w <name>` 在 `.claude/worktrees/<name>/` 建 worktree 和 `worktree-<name>` 分支，`.worktreeinclude` 复制被忽略的小文件，subagent 可设 `isolation: worktree`；同会话并发 subagent 上限默认 20；workflow 默认最多 16 个并发 agent、单次最多 1,000 个，超过 25 个或预计 150 万 token 会提示；agent teams 是实验功能，建议 3 到 5 个队友、每人 5 到 6 个任务，`-p` 和 Agent SDK 下不会生成队友，不支持恢复会话。失败模式：`claude -p --worktree` 不会自动清理 worktree；worktree 里没有依赖，要重装；agent teams 文档自述任务状态会滞后、两个队友改同一文件会互相覆盖；Codex 的 Stop hook 要先人工信任才会执行。采用：外层脚本为每个任务建 worktree；审查和扇出式检查用 subagent 或 workflow。不采用：agent teams 做实现。

- 16 个并行 Claude 写出能编译 Linux 内核的 C 编译器，没有编排 agent，只靠 git 和锁文件；作者的精力主要花在测试和反馈环境上。[Carlini, Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)，2026-02-05。证据：近 2,000 个会话、约两周、API 费用略低于 2 万美元、约 10 万行 Rust；agent 往 `current_tasks/` 写锁文件认领任务，做完后拉取、合并、推送、删锁；测试输出只打印几行，细节写日志，错误行以 `ERROR` 开头方便 grep；`--fast` 跑 1% 或 10% 的确定性抽样；原话 "Most of my effort went into designing the environment around Claude"。失败模式：所有 agent 撞上同一个 bug 并互相覆盖修复，16 个不比 1 个快，后来用 GCC 当参照把问题切开才恢复并行；新功能经常弄坏旧功能，后期补了 CI；"it is easy to see tests pass and assume the job is done"。采用：任务认领用文件、输出精简的测试脚本、抽样快测、每个任务先跑回归。

- 多个 agent 协作比各做各的成功率低，不同 agent 之间的 PR 冲突率是同一 agent 的两倍。[CooperBench, arXiv 2601.13295](https://arxiv.org/abs/2601.13295)，2026-01-19；[AI Agent Pull Requests on GitHub, arXiv 2607.04697](https://arxiv.org/abs/2607.04697)，2026-07-06（只读了两篇的摘要页）。证据：CooperBench 600 多个任务，协作时成功率平均低 30%，原因是消息含糊且不及时、不守承诺、对对方计划预期错误；PR 研究覆盖 33,596 个 PR、2,807 个仓库，文本冲突率跨 agent 41.7%、同 agent 19.8%，近 42% 的冲突是结构性的（modify/delete、add/add）。失败模式：只统计 git 报告的文本冲突，语义冲突没算；跨 agent 样本只有 122 个仓库。采用：任务之间不靠对话协调，任务图里声明每个任务独占的文件范围；Claude Code 和 Codex 不同时改同一批文件；合并串行，rebase 后重跑 gate。

- 社区编排器变动太快，合并策略在高吞吐团队那里也没有定论；本项目用一份 JSON 任务图加 git 就够。[Gas Town: from Clown Show to v1.0](https://steve-yegge.medium.com/gas-town-from-clown-show-to-v1-0-c239d9a407ec)，2026-04-03；[Danjou, Steve Yegge Deleted the Wrong Thing](https://julien.danjou.info/blog/steve-yegge-deleted-the-wrong-thing)，2026-08-18；[Anthropic, Redesigning source control](https://www.anthropic.com/engineering/redesigning-source-control)，2026-10-13。证据：Yegge 自述 Beads 0.x 的 SQLite + JSONL 双向同步带来 "tons of merge conflicts"，换成 Dolt 才稳定；Gas Town 发 1.0 的同一篇文章里已进入维护模式，在推继任者 Gas City；[vibe-kanban](https://github.com/BloopAI/vibe-kanban)（28.7k star）README 顶部写着 "Vibe Kanban is sunsetting"；[claude-task-master](https://github.com/eyaltoledano/claude-task-master)（28.4k star）最近推送 2026-04-28；[claude-squad](https://github.com/smtg-ai/claude-squad) 8.8k star。Anthropic 的合并变更从 2026-05 的每天约 2,500 个涨到 9 月的 3 万多个，放弃合并队列，改成合并后和部署前测试。Yegge 取消主干门禁、一次落 120 到 150 个提交的做法只见于 Danjou 的转述，Danjou 自称卖合并队列，这一条「未验证」。失败模式：单个共享状态文件在多 agent 写入时冲突或丢更新；工具停更。不采用 Gas Town、Beads、vibe-kanban、task-master。合并前跑 gate 保留，本项目提交量远低于那些团队，一次 gate 的成本低。

## 5. 写与审分离、验证

- 审查要由没看过实现过程的上下文来做，验证者只看成品；让写的人自评，或者把同一任务再丢给 subagent，都换不来更好的结果。[Claude Code best practices](https://code.claude.com/docs/en/best-practices)，「未验证（无日期）」；[math-olympiad 插件 README](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/math-olympiad)，无日期；[Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)，2026-03-24。证据：`/code-review` 在全新 subagent 里审 diff；示例审查 agent 只给 `tools: Read, Grep, Glob`；文档提醒审查 prompt 要写 `skip style`，因为 "A reviewer that's asked to find problems will always find something"，全照改会多出抽象层和无用测试。math-olympiad README：验证者 "sees only the clean proof, never the reasoning trace"，自报 18 题解出 17 题、0 误报；它引用的「自验证 85.7% 在人工评分下低于 5%」出自 arXiv 2503.21934，原论文没打开，「未验证」。Anthropic 原话：把独立 evaluator 调严 "far more tractable"，但它仍然 "inclined to be generous towards LLM-generated outputs"。失败模式：审查者过度报告；LLM 审 LLM 偏宽。采用：实现和审查分属不同会话，最好不同工具（Claude Code 写则 Codex 审，反过来也行）；审查只对照 spec 报影响正确性的缺口。

- 让 agent 先写测试并确认它失败，再写实现。[Willison, Red/green TDD](https://simonwillison.net/guides/agentic-engineering-patterns/red-green-tdd/)，「未验证（无日期）」。证据：无数据，理由是先看到红能证明测试确实覆盖了新行为，否则测试可能本来就能过；提示词只要 "Use red/green TDD"。失败模式：同一个 agent 写测试又写实现时，测试会贴着实现写。采用：引擎任务 prompt 固定要求红绿流程；性质测试和参照实现由另一个会话只看 spec 写。

- 确定性逻辑的两层额外压力：property-based testing 找没想到的输入，mutation testing 查测试有没有真的在断言。[Anthropic Frontier Red Team, property-based testing](https://www.anthropic.com/research/property-based-testing)，2026-01-14；[Thoughtworks Radar, mutation testing](https://www.thoughtworks.com/radar/techniques/mutation-testing)，Adopt，2026-11 条目；[alexop.dev](https://alexop.dev/posts/mutation-testing-ai-agents-vitest-browser-mode/)，2026-01-13。证据：agent 给 100 多个 Python 包写 Hypothesis 性质，产出 984 份 bug 报告，抽查 50 份有 56% 是真 bug，评分最高的一档 86% 有效，NumPy 等 3 个补丁被合并；有一次性质通过只是因为测试包在 try/except 里。Radar 指出 agent 可以在循环里自己改代码、跑测试做变异，但全量太慢，应限定在核心包或只跑增量。alexop 记录 "Stryker doesn't work with Vitest's browser mode"，手工变异一个设置模块 13 个变异体存活 8 个（38%）。失败模式：近一半 PBT 报告是误报，对错要人裁决；变异测试耗时；alexop 没有给补测试后的分数。采用：`src/engines/**` 用 fast-check，失败时打印种子和收缩后的反例；Stryker 只跑引擎目录，在 Node 环境的 Vitest 下增量运行，阈值在第一次基线后再定。Stryker 的 Vitest runner 本次没有核对，搭建时先验证。UI 目录不做变异测试。

- UI 要让 agent 真的操作页面再判定完成；给编码 agent 用 Playwright CLI 比 MCP 省上下文。[Playwright CLI](https://playwright.dev/agent-cli/introduction)、[Playwright Test Agents](https://playwright.dev/docs/test-agents)，均「未验证（无日期）」；另见第 3 节 Anthropic 两篇和 OpenAI 一篇。证据：CLI 每条命令后把可访问性树快照存成文件，元素带引用号；官方对比表写 CLI 的 token 成本更低，理由是 "concise CLI output avoids loading large tool schemas into the model context"，没有给数字。`npx playwright init-agents --loop=claude|codex` 生成 planner、generator、healer 三个测试 agent。Anthropic 的 evaluator 用 Playwright 点页面发现了只在拖拽端点放砖块、路由顺序导致 422 等问题。搜索里出现的「省 40 倍 token」来自第三方，没有打开核对，「未验证」。失败模式：healer 认为功能坏了会把测试标为 skip；视觉判断漏掉小的布局问题；截图对比对字体和动画敏感。采用：每个功能一条 Playwright e2e，用 role 和 label 定位，断言页面显示的数值等于引擎输出；少量稳定状态做截图对比，固定视口，关动画；evaluator 会话用 Playwright CLI 走一遍再翻 `passes`。不采用：无人值守的 healer。

## 6. 非 LLM 产品的评测门禁

- 必须每次发生的事放进 hook，其余留给模型判断；Claude Code 和 Codex 的 Stop hook 都能用退出码 2 把 agent 挡回去，所以可以共用一个 gate 脚本。[Claude Code best practices](https://code.claude.com/docs/en/best-practices)、[Codex hooks](https://learn.chatgpt.com/codex/hooks)，均「未验证（无日期）」。证据：Claude Code 文档把指令分成模型可自行取舍的（prompt、`CLAUDE.md`、skill）和工具本身强制执行的（hook、deny 规则）；示例 `pnpm tsc --noEmit 1>&2 || exit 2`；连续 8 次被挡且中间没有工具调用会强制结束；`--bare` 会跳过 hook；`PreToolUse` hook 可按路径阻止编辑。Codex 文档："You can also use exit code `2` and write the continuation reason to `stderr`"，仓库级配置在 `<repo>/.codex/hooks.json`。失败模式：hook 太多会误触发且要维护，文档建议强制集合保持很小；Codex 的 hook 改动后要重新信任，否则被跳过；`prompt` 和 `agent` 类型的 hook 仍是模型判断。采用：`scripts/gate.sh` 是唯一门禁，两个工具的 Stop hook 都调它；保护文件（golden trace、`features.json` 的非 `passes` 字段、spec）用 `PreToolUse` 加 gate 里的 diff 检查双重拦截；循环脚本不要用 `--bare`。

- gate 的输出是写给 agent 看的：短，带修法，细节进日志。[OpenAI Harness engineering](https://openai.com/index/harness-engineering/)，2026-02-11；[Anthropic, Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)，2025-09-11，窗口外；[Carlini](https://www.anthropic.com/engineering/building-c-compiler)，2026-02-05。证据：OpenAI "Because the lints are custom, we write the error messages to inject remediation instructions into agent context"；Anthropic "prompt-engineer your error responses to clearly communicate specific and actionable improvements"；Carlini 的 harness 只打印几行摘要并预先算好统计。都没有对照数据。失败模式：整屏测试输出灌进上下文；报错没有说下一步做什么。采用：gate 每个失败项一行，格式为检查名、文件、怎么修、日志路径；自定义检查包括引擎目录不得引用 DOM 和 UI、题目数据必须能被引擎重算。

- 正确性靠独立参照来判，LLM 评审只管可读性。教学内容正确性没有找到教育类站点的一手工程文章，下面是从相邻领域搬过来的做法。[Carlini](https://www.anthropic.com/engineering/building-c-compiler)，2026-02-05；[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)，2026-01-09。证据：Carlini 用 GCC 当 oracle，大部分文件交给 GCC、随机一部分交给自己的编译器，失败时换回去定位；他的结论是验证器必须几乎不出错，否则 agent 会去解错的问题。evals 一文：能用代码判的就用代码判；LLM 评审要用人工标注校准，给它 "Unknown" 选项，每个维度一个独立评审；从 20 到 50 个真实失败案例起步；回归集通过率应接近 100%。失败模式：参照实现和被测实现出自同一个上下文时会犯同样的错；LLM 评审不稳定；只查最终答案会放过步骤错误。采用：每个引擎配一份独立会话写的朴素参照实现做差分测试；教材例题整理成逐步状态的 golden trace；题目存成数据（参数、答案、步骤），gate 用引擎和参照实现各算一遍；讲解文字里的数字从引擎输出生成，或由脚本重算比对。

## 7. 上下文工程与记忆

- `AGENTS.md` 要短，只写模型从代码里读不出来的东西；它到底能不能提高成功率，两份带数据的来源结论相反，「未验证」。[ETH Zurich, Evaluating AGENTS.md, arXiv 2602.11988](https://arxiv.org/abs/2602.11988)，2026-02-12，v3 2026-09-29（只读了摘要页）；[Vercel, AGENTS.md outperforms skills in our agent evals](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)，2026-01-27；[Claude Code memory 文档](https://code.claude.com/docs/en/memory.md)，「未验证（无日期）」；[HumanLayer, Writing a good CLAUDE.md](https://www.humanlayer.dev/blog/writing-a-good-claude-md)，2025-11-25，窗口外。证据：ETH 在 SWE-bench 类任务上发现上下文文件 "does not generally improve task success rates"，推理成本平均增加 20% 以上，仓库概览没有帮助，指令本身会被遵守。Vercel 在 Next.js 16 新 API 的评测里，`AGENTS.md` 放 8KB 文档索引通过率 100%，基线 53%。Claude Code 文档建议每个文件 200 行以内；OpenAI 约 100 行；HumanLayer 根文件不到 60 行。两份数据不矛盾的读法：训练数据里没有的知识和非标准做法值得写，概览不值得。失败模式：`/init` 生成的概览式文件增加成本；指令多了遵守率下降。采用：`AGENTS.md` 控制在 100 行内，内容为命令、文档索引、非标准规则、被纠正过两次以上的事。

- 一份 `AGENTS.md` 两个工具共用；流程放 skill，必须知道的事实放 `AGENTS.md`，必须发生的动作放 hook。[Claude Code memory](https://code.claude.com/docs/en/memory.md)、[skills](https://code.claude.com/docs/en/skills.md)、[Codex best practices](https://learn.chatgpt.com/guides/best-practices)，均「未验证（无日期）」；[Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)，2026-01-27。证据：Claude Code v2.1.277 起在没有 `CLAUDE.md` 时直接读 `AGENTS.md`，子目录的 `AGENTS.md` 在读到该目录文件时加载；Codex 也按目录层级读，"If there's a more specific file closer to your current directory, that guidance wins"。skill 启动时只加载描述（1,536 字符截断），正文调用时才加载，建议 `SKILL.md` 不超过 500 行；压缩后每个 skill 只保留前 5,000 token。Vercel 测到 skill 在 56% 的用例里没有被调用，默认配置下通过率和基线一样是 53%。失败模式：仓库里一旦有 `CLAUDE.md` 或 `CLAUDE.local.md`，Claude Code 默认不再读 `AGENTS.md`；skill 不触发。采用：仓库只放 `AGENTS.md`，在 `src/engines/`、`src/ui/`、`content/` 各放一份子目录 `AGENTS.md`；skill 只装步骤性流程，例如新增引擎主题、新增题目、发版。Claude Code 的 skill 在 `.claude/skills`，Codex 在 `.agents/skills`，要两边各放或做链接。

- 记忆只写环境里看不到的东西，一条一个文件，定期对照事实清理；「只记失败」这类固定写回规则会降低效果。[Anthropic, The components of agent memory](https://www.anthropic.com/engineering/components-of-agent-memory)，2026-11-06；[Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)，2025-09-29，窗口外。证据：CL-Bench 上有记忆的 Opus 5 平均得分 0.564 升到 0.828；加一条「只记录失败」的规则，记忆收益下降 0.234（Opus 5）和 0.150（Opus 4.7）；多个 agent 写同一个共享文件，57 条事实丢了 41 条，改成每份合同一页后全部保留；Sonnet 3.7 玩 Pokémon 写了 413 个文件拿 1 个徽章，Fable 5 约 10 个文件拿 4 个；一条记错的笔记让 agent 三次绕回老路，用原始记录核对后才走通；Claude Code 只加载记忆索引前 200 行或 25KB。失败模式：错误笔记长期存在；过度记录后把步数花在整理笔记上；并发覆盖。Claude Code 的 auto memory 只在本机，Codex 读不到。采用：项目知识写进仓库 `docs/`；每个任务一份交接文件，决策日志追加写；并行任务不共写同一个进度文件；每周跑一次文档清理任务，对照代码删改过期条目。

- 任务边界处开新会话，任务中途靠自动压缩；为省上下文专门设计的中途重置在当前模型上不需要了。[Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps)，2026-03-24；[Claude Code best practices](https://code.claude.com/docs/en/best-practices)，「未验证（无日期）」；[Cursor, Scaling agents](https://cursor.com/blog/scaling-agents)，2026-01-14。证据：Anthropic 在 Sonnet 4.5 上必须整段重置上下文，到 Opus 4.5 改成一个连续会话加自动压缩；Claude Code 文档把「上下文窗口是主要约束」列入过时建议，同时保留 "`/clear` between unrelated tasks"；Cursor 仍说 "We still need periodic fresh starts to combat drift and tunnel vision"。三者在「任务之间要清」上一致，在「任务之内要不要重置」上随模型而变，这一点「未验证」。失败模式：一个会话装多个无关任务，后面的任务为前面的历史付费；压缩可能丢掉口头约定。采用：一个任务一个会话，约定写进文件。

## 推荐的工作方式

保留的文件：

1. `AGENTS.md`，100 行内：安装、单测、gate 命令，`docs/` 索引，非标准规则。不建 `CLAUDE.md`。三个子目录各一份短的。
2. `docs/spec/<topic>.md`，每个主题一份（cache 映射、流水线、二进制运算等）：Requirement 用「必须」句，Scenario 用 WHEN / THEN，每条附 1 到 3 条「对任意输入」的性质，附教材例题和页码。spec 由 owner 审过才进任务图。
3. `tasks/graph.json`：任务 id、依赖、独占的文件 glob、对应的 spec 条目、验收命令。只有 planner 会话能改。每个任务的状态写在 `tasks/state/<id>.json`，一任务一文件。
4. `features.json`：面向用户的功能，字段 category、description、steps、passes。worker 只能改 `passes`，gate 用 diff 强制。
5. `docs/progress/<id>.md` 交接文件（做了什么、跑过的命令和输出、遗留问题），`docs/decisions.md` 追加式决策日志，`docs/lessons/<topic>.md`。
6. `scripts/gate.sh`，唯一门禁。`.claude/settings.json` 和 `.codex/hooks.json` 的 Stop hook 都调它，失败退出码 2，每个失败项一行并带修法。

循环形状：外层 shell 脚本从任务图取一个依赖已完成、文件范围不与在跑任务重叠的任务；建 worktree；起一个全新的非交互会话，带轮数或预算上限；会话开场读 `AGENTS.md`、该任务的 spec 条目和上一份交接文件，先跑一次 gate 确认基线是绿的；红绿 TDD 做完一个任务；Stop hook 跑 gate；通过后另起一个只读审查会话，用另一个工具，只对照 spec 报正确性缺口；脚本串行 rebase、重跑 gate、合并、删 worktree。同一任务失败两次标记 blocked，写明卡点，换下一个，等人看。Codex 非交互命令的具体参数本次没有核对，搭建时先确认。

分开的角色：planner（写 spec 和任务图，不写代码，高档模型，owner 批准）；implementer；参照实现和性质测试的作者（只看 spec，不看引擎代码，与 implementer 不同会话，最好不同工具）；reviewer（只读）；UI evaluator（用 Playwright CLI 操作构建产物）；内容复算者（只看题面）。

背压：

- (a) 确定性引擎：纯函数，不碰 DOM，gate 里用自定义检查禁止引擎目录引用 UI。`tsc` strict；教材例题做成逐步状态的 golden trace，文件受 `PreToolUse` hook 保护；fast-check 性质，例如命中数加缺失数等于访问数、组相联在路数为 1 时与直接映射逐步一致、定点运算与 BigInt 参照结果一致、无冒险程序的周期数等于指令数加级数减 1；与朴素参照实现做差分；Stryker 只跑引擎目录，增量运行，基线出来后定阈值。
- (b) 交互 UI：UI 状态只从引擎 trace 派生。每个 `features.json` 条目一条 Playwright e2e，用 role 和 label 定位，断言显示值等于引擎输出；手机和桌面两个视口；少量稳定状态做截图对比。功能翻 `passes` 之前由 evaluator 会话实际操作一遍并留下截图和命令输出。
- (c) 中文讲解和题库：题目存成数据，gate 用引擎和参照实现各算一遍答案和步骤。讲解里的数字由引擎在构建时生成，写死的数字由脚本重算比对。每道题再由一个全新会话只看题面独立求解，答案机械比对，不一致的进人工队列。术语对照 `docs/textbook` 的术语表做 lint，文风用 owner 的 no-ai-flavor lint。LLM 评审只评「讲清楚没有」，一个维度一个评审，带「不确定」选项，先用 owner 标过的 20 到 50 段校准，之后 owner 抽查。

并行度：gate 可信之前只跑 1 条循环。之后 3 条，按引擎、UI、内容分道，文件范围互不重叠；上限 4 到 5 条，再多就卡在串行合并和人工审查上。Claude Code 和 Codex 可以各占一道，不同时碰同一个任务。每个 worktree 用独立端口和独立的 Playwright 输出目录。

不采用：

- Spec Kit、BMAD、Kiro 的整套流程：Markdown 太多，评审负担超过收益。
- 官方 `ralph-loop` 插件：同一会话累积上下文，完成标记由模型自己说。
- agent teams 做实现：实验功能，`-p` 下不可用，文档自述状态滞后和文件覆盖。
- Gas Town、Beads、vibe-kanban、task-master：换代、停更或要额外的数据库，一份 JSON 加 git 能覆盖本项目的需要。
- 先合并后修的主干策略：只在每天上百到上万次提交时才划算。
- 无人值守的 Playwright healer：会把它认为坏掉的测试标 skip。
- 用 LLM 评审当正确性门禁：偏宽，不稳定。
- `/init` 生成的概览式 `AGENTS.md` 和「只记失败」的记忆规则：前者有成本增加 20% 的测量，后者有收益下降的测量。
- 逐 sprint 的合同谈判和逐轮评分：Anthropic 换到 Opus 4.6 后自己拆掉了。
