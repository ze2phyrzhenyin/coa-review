# 计组复习

计算机组成原理复习网站，面向上海师范大学本科生。教材：戴志涛、白中英《计算机组成原理》第七版，第 1–6、8 章。静态站点，中文界面。接手先读 `docs/HANDOFF.md`。

## 命令

- `pnpm dev` → http://localhost:4630
- `pnpm test`（Vitest，`src/**/*.test.ts`），`pnpm typecheck`，`pnpm lint:copy`
- `bash scripts/gate.sh`：快门禁，约 2 秒。类型、单测、结构、术语、文案、原创、任务图。
- `bash scripts/gate.sh --build`：再加构建、导航检查、逐页检查，约 10 秒。交付页面前必跑。
- `node scripts/qa-pages.mjs <页面编号>`：只查一页（先起预览，`PORT=` 指向它）。
- `node scripts/tasks.mjs list|ready|show <id>|claim <id>|done <id>|block <id> "原因"|scope <id>|validate`
- `bash scripts/loop.sh [--engine claude|codex] [--task T003]`：循环执行，一轮一个任务，门禁通过由脚本提交。
- `bash scripts/fanout.sh [--engines claude,codex] [--jobs 2]`：范围不重叠的任务各开一个 worktree 并行，再按依赖顺序合并。
- `bash scripts/release.sh [rollback|status]`：发布到 rex-ovh。要负责人同意才跑。

## 目录

- `docs/PLAN.md` 计划和 57 个页面；`docs/INTERACTION.md` 交互、3D 场景、动效标准；`docs/STYLE.md` 文字；`docs/DECISIONS.md` 决定和待确认；`docs/RESEARCH.md`、`docs/BORROWED.md` 调研和借用。
- `docs/textbook/*.md` 教材分章梳理：记号、算法步骤、模型机、题型。写任何内容前先读对应章。教材原文在 `.local/textbook/`（不进仓库）。
- `specs/` 规格，一个页面或引擎一份；`_engine-contract.md`、`_player-contract.md`、`_scene-contract.md` 是公共约定。
- `plan/tasks.json` 任务图（只有 planner 改）；`plan/state/<id>.json` 状态；`plan/progress/<id>.md` 交接；`plan/features.json` 页面验收清单。
- `src/engines/<名>/` 引擎：纯函数，参数进，Trace 出。`src/engines/trace.ts` 是契约。
- `src/lib/` 纯函数工具。`src/scene/` 3D 部件库（three.js）。`src/player/` 逐步播放器。
- `src/pages/<编号>/index.tsx` 页面，默认导出一个组件，按目录名自动登记。`src/content/pages.ts` 页面清单。
- `src/app/` 外壳、路由、网址状态。
- `evals/golden/` 固定用例（教材例题的数值、手算的小例子）。只增不改。
- `.agents/skills/` 技能（`.claude/skills` 是指向它的软链接，改技能改前者）。`prompts/roles/` 角色。

## 规则

### 内容

- 记号、术语、算法步骤跟教材一致，不跟 RISC-V 或 CS:APP 的讲法。差别列在各章梳理的「与通用讲法的差异」。术语表 `scripts/terms.json`，门禁会查。
- 题目、讲解、图都是原创，用自己的话和自己的数。教材只引页码。门禁会拿文字和教材扫描文本比对。
- 答案只由引擎算出。页面、文案里不手写答案和中间结果。解析书有错，不能当标准答案。
- 教材没讲的（Booth、单周期数据通路、有效位、缺失分类等）默认不出现。

### 引擎

- 纯 TypeScript：不引用 preact，不碰浏览器对象，不用 `Math.random` 和当前时间。随机出题的种子作为参数传入。
- 用 `TraceBuilder` 产生 Trace，测试里对输出跑 `validateTrace`，必须为空。
- 每个引擎的测试要有：小规模穷举或 fast-check 性质、与独立写的朴素参照实现对拍、`evals/golden` 里的固定用例。参照实现和性质由 tester 角色在另一个会话里只看规格写，不看引擎代码。

### 页面

- 一页讲一个困惑，三部分：讲解、试一试、练习。结构和验收条件见 `plan/features.json` 的 `accept`。
- 场景、解题表、提示、判分都读同一份 Trace。画面只由当前步的状态决定。
- 交互、场景、动效按 `docs/INTERACTION.md`。做界面的人交付前在真实浏览器里看手机和桌面两种宽度的截图。
- 手机优先：360–390 px 不横向滚动，触控目标不小于 44 px，输入框文字不小于 16 px。

### Navigation

- 侧栏只挂载一次，换页不重建；点哪一项，侧栏位置不动，当前项可见。直接打开深层页面时当前项自动进入视野。
- 标签页、步数、参数、所选例题都写进网址（`src/app/url-state.ts` 的 `useParam`）。刷新、分享、返回，回到同一画面。
- `scripts/qa-navigation.mjs` 检查这几条，`gate.sh --build` 必跑，发布后对线上再跑一次。

### 文字

- 按 `.agents/skills/no-ai-flavor`（先读 `SKILL.md` 和 `references/design.md`）和 `docs/STYLE.md`。`pnpm lint:copy` 的 error 清零，warn 逐条看。
- 页面只有一个标题，是学生会问的那句话，不带问号；侧栏用名词短名。

## 怎么干活

1. 需求先写成规格（技能 `coa-spec`），再拆进任务图（`coa-tasks`）。任务写明独占的文件范围。
2. 领任务：`node scripts/tasks.mjs claim <id>`。只改范围内的文件；范围外的需要写进 `plan/progress/<id>.md`。
3. 引擎用 `coa-engine`，页面用 `coa-page`，题目用 `coa-problems`，其余用 `coa-implement`。先写测试。
4. `bash scripts/gate.sh` 通过后 `node scripts/tasks.mjs done <id>`，在 `plan/progress/<id>.md` 写不超过 5 行：做了什么、怎么验证的、遗留什么。
5. 写和审分开：审查（`coa-review`）、页面验收（`coa-look`）由另一个会话做，只拿 diff 和规格，不拿实现者的解释。
6. 页面验收通过后，evaluator 才把 `plan/features.json` 里的 `passes` 置为 true 并写 `evidence`；之后才能把 `pages.ts` 里的 `live` 置为 true。

并行时一个任务一个 worktree，范围互不重叠，合并串行。默认并行 2 条。

## 坑

- macOS 没有 `timeout`；`vite preview` 要 `--host 127.0.0.1`；bash 里变量后面紧跟全角字符要写 `${VAR}`（门禁会查）。
- `claude -p` 在没被信任过的目录里会忽略 `.claude/settings.json` 的权限和 hooks。仓库在已信任的 `~` 下面才生效；别处的副本里，门禁只靠 `loop.sh` 自己跑。
- Playwright 固定 1.65.0，复用本机已装的浏览器，不要升级。无头浏览器跑 WebGL 要加 `--use-angle=metal --ignore-gpu-blocklist --enable-gpu`。测试浏览器必须静音。
- 不随手加依赖。
- `codex exec` 没有 `--full-auto`；Codex 沙箱里 `.git` 只读，提交由 `loop.sh` 在外面做。
- 个人目录里的同名技能会盖住项目技能，所以项目技能都带 `coa-` 前缀（`no-ai-flavor` 两处内容相同）。
- 引擎目录里不放 `.tsx`。`evals/golden` 里已有的文件不许改，只能新增。

## 不许做

- 不经负责人同意：提交到远端、发布、改 DNS、动服务器。
- 不改 `.env`、密钥、`.local/textbook/`。
- 不为了过门禁改固定用例、删测试、把检查关掉。
- 不搬教材原文和原题。
