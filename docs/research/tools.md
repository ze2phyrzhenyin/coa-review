# 工具现状调研：AI 开发框架所依赖的各家行为

调研日期：2026-11-14。本机：Claude Code 2.1.325、codex-cli 0.169.0；Gemini CLI、Cursor、OpenCode 未安装，只读了文档。

读法说明：

- 每条结论都来自当天抓取的官方页面原文（Markdown 源或页面正文），不凭记忆。
- Claude Code 文档（code.claude.com）和 Codex 文档页面本身不标日期，「日期/版本」一栏写抓取日和页内标注的最低版本号。
- Codex 文档已整体迁到 `learn.chatgpt.com/docs`，`developers.openai.com/codex/*` 全部 308 跳转过去，下面的链接用跳转后的地址。
- 标「本机实测」的条目是文档没写、在本机用最小命令核对的结果，只对当前版本成立。
- 「未验证」= 打不开、文档没写、或两处文档说法不一致。

## 1. Agent Skills 开放标准

- `SKILL.md` 必须以 YAML frontmatter 开头，必填只有 `name` 和 `description`，可选 `license`、`compatibility`、`metadata`、`allowed-tools`（实验性），一共六个字段. [来源](https://agentskills.io/specification), 抓取 2026-11-14（规范仓库最近推送 2026-11-04）. 采用: 跨工具共享的 skill 只写这六个字段。
- `name` 1–64 字符，只允许小写字母、数字、连字符，不能以连字符开头或结尾，不能有 `--`，且必须与所在目录名相同. [来源](https://agentskills.io/specification), 抓取 2026-11-14. 采用: 目录名即 skill 名，写进门禁检查。
- `description` 1–1024 字符，要同时写「做什么」和「什么时候用」；`compatibility` 最多 500 字符；`metadata` 是字符串到字符串的映射. [来源](https://agentskills.io/specification), 抓取 2026-11-14. 采用: 触发条件写在 `description` 前半句，各家截断时先丢后半句。
- 目录约定是 `SKILL.md` 加可选的 `scripts/`（可执行代码）、`references/`（按需读的文档）、`assets/`（模板和静态资源），其他文件也允许. [来源](https://agentskills.io/specification), 抓取 2026-11-14. 采用: 按此布局。
- 渐进加载分三层：启动时只加载所有 skill 的 `name` 和 `description`（约 100 token），激活时读入整个 `SKILL.md` 正文（建议 5000 token 以内、500 行以内），`scripts/` 等文件用到才读. [来源](https://agentskills.io/specification), 抓取 2026-11-14. 采用: 长内容拆到 `references/`，引用只做一层。
- 引用 skill 内文件用相对 skill 根目录的路径，校验工具是 `skills-ref validate ./my-skill`. [来源](https://agentskills.io/specification), 抓取 2026-11-14. 未验证: `skills-ref` 没有在本机装过和跑过。
- 规范不规定 skill 放在哪里；`<project>/.agents/skills/` 和 `~/.agents/skills/` 是各家通行的互通约定，实现指南建议客户端同时扫自家目录和这两个路径，项目级覆盖用户级. [来源](https://agentskills.io/client-implementation/adding-skills-support), 抓取 2026-11-14. 采用: skill 实体放 `.agents/skills/`。
- 直接读 `.agents/skills` 的有 Codex、Gemini CLI、Cursor、OpenCode（各自文档见第 3、4 节）；Claude Code 不读，只读 `.claude/skills`. [来源](https://code.claude.com/docs/en/skills), 抓取 2026-11-14 + 本机实测 2.1.325. 采用: 给 Claude Code 单独做链接，见第 2 节。
- agentskills.io 的客户端清单页是脚本渲染，抓到的正文为空. [来源](https://agentskills.io/clients), 抓取 2026-11-14. 未验证: 官方清单没读到，上一条按各工具自己的文档汇总。

## 2. Claude Code

### 指令文件

- Claude Code 从 v2.1.277 起原生读 `AGENTS.md`，默认规则是「工作目录及其上级没有任何 `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md` 时才读」，一旦有其中之一就只读 `CLAUDE.md`. [来源](https://code.claude.com/docs/en/memory#agents-md), 抓取 2026-11-14，要求 v2.1.277+. 采用: 见下一条的取舍。
- 原生读取时会加载工作目录及所有上级目录里的每个 `AGENTS.md`；不读 `AGENTS.local.md`、`AGENTS.override.md` 和 `.agents/` 下的任何东西. [来源](https://code.claude.com/docs/en/memory#when-claude-code-reads-agents-md), 抓取 2026-11-14. 不采用（原生读取）: 本机 `~/Developer/AGENTS.md` 存在，原生模式会把它一起读进来，而 Codex 从 git 根开始找、读不到它，两边指令会不一致。
- `CLAUDE.md` 里写 `@AGENTS.md` 仍然有效，官方明确保留这种写法，且不会重复加载；相对路径按「包含 import 的那个文件」解析，递归最多四层，代码块和反引号里的 `@` 不解析. [来源](https://code.claude.com/docs/en/memory#import-additional-files), 抓取 2026-11-14. 采用: 项目根放 `CLAUDE.md`，第一行 `@AGENTS.md`，下面只写 Claude 专属内容。
- 想两者都读可把 **Project instructions** 设为 `claude-md-and-agents-md`，但这个设置只在 `~/.claude/settings.json`、`--settings` 文件、managed settings 里生效，项目级 settings 里会被忽略. [来源](https://code.claude.com/docs/en/memory#choose-which-instruction-files-load), 抓取 2026-11-14. 不采用: 不能随仓库下发。
- `CLAUDE.md` 的加载顺序是从文件系统根到工作目录依次拼接，子目录里的 `CLAUDE.md` 在 Claude 读写该目录文件时才加载，`CLAUDE.local.md` 排在同级 `CLAUDE.md` 之后. [来源](https://code.claude.com/docs/en/memory#how-claude-md-files-load), 抓取 2026-11-14. 采用: 根目录一份即可，本项目不分子目录。
- 通过设置原生读到的 `AGENTS.md` 不触发 `InstructionsLoaded` hook，`--add-dir` 目录里的 `AGENTS.md` 也不加载；经 `CLAUDE.md` import 的则照常. [来源](https://code.claude.com/docs/en/memory#where-agents-md-differs-from-claude-md), 抓取 2026-11-14. 采用: 又一个用 import 的理由。

### Skills

- 项目 skill 路径是 `.claude/skills/<skill-name>/SKILL.md`，个人是 `~/.claude/skills/`；从启动目录向上找到仓库根，文档全文没有 `.agents/skills`. [来源](https://code.claude.com/docs/en/skills#choose-where-skills-load), 抓取 2026-11-14. 采用: Claude 侧只认 `.claude/skills`。
- 文档写明 `.claude/skills/` 里的单个 `<skill-name>` 条目可以是指向别处目录的 symlink，多处指向同一目标只加载一次. [来源](https://code.claude.com/docs/en/skills#choose-where-skills-load), 抓取 2026-11-14. 采用: 这是有文档依据的写法。
- 整个 `.claude/skills` 目录做成指向 `../.agents/skills` 的 symlink，文档没有写. [来源](https://code.claude.com/docs/en/skills#choose-where-skills-load), 本机实测 2.1.325（`claude -p --output-format stream-json` 的 init 事件里列出了该 skill；只有 `.agents/skills` 而没有 `.claude/skills` 时列表为空）. 未验证（文档层面）: 实测可用，但升级后要靠门禁复查。
- 同名时个人 skill 压过项目 skill（enterprise > personal > project）. [来源](https://code.claude.com/docs/en/skills#resolve-skills-that-share-a-name), 抓取 2026-11-14. 采用: 项目 skill 一律加项目前缀，避免被 `~/.claude/skills` 里的同名 skill 顶掉。
- Claude Code 的 frontmatter 全部可选，并在标准六字段之外加了 `when_to_use`、`disable-model-invocation`、`user-invocable`、`context: fork`、`agent`、`paths`、`hooks`、`model`、`effort` 等；不认识的字段静默忽略；`description` 加 `when_to_use` 在列表里超过 1,536 字符会被截断. [来源](https://code.claude.com/docs/en/skills#frontmatter-reference), 抓取 2026-11-14. 不采用（扩展字段）: 共享 skill 不写扩展字段，上传 claude.ai 或走 Skills API 时多一个字段就硬报错。
- `-p` 模式下可以在提示词里写 `/skill-name` 触发 skill. [来源](https://code.claude.com/docs/en/headless#create-a-commit), 抓取 2026-11-14. 采用: 循环执行器可直接点名 skill。

### 子代理 `.claude/agents/*.md`

- 文件是 YAML frontmatter 加正文（正文即系统提示词），必填只有 `name` 和 `description`；多词字段用 camelCase，写错的字段静默忽略. [来源](https://code.claude.com/docs/en/sub-agents#frontmatter-reference), 抓取 2026-11-14. 采用: 字段名照表抄。
- 现有字段：`tools`、`disallowedTools`、`model`（`sonnet`/`opus`/`haiku`/`fable`/完整 ID/`inherit`）、`permissionMode`、`maxTurns`、`skills`、`mcpServers`、`hooks`、`memory`、`background`、`omitClaudeMd`（v2.1.271+）、`effort`、`isolation`、`color`、`initialPrompt`、`autoCompactWindow`（v2.1.296+）、`experimental`. [来源](https://code.claude.com/docs/en/sub-agents#frontmatter-reference), 抓取 2026-11-14. 采用: 用 `tools`、`model`、`maxTurns`、`skills`、`isolation` 这几个。
- `isolation: worktree` 让子代理在临时 git worktree 里跑，无改动时自动清理；`worktree.baseRef` 默认 `"fresh"`，从远端默认分支拉（没有 remote 时回退到本地 `HEAD`），设为 `"head"` 才固定从当前 `HEAD` 拉. [来源](https://code.claude.com/docs/en/worktrees#choose-the-base-branch), 抓取 2026-11-14. 采用: 只给会改文件的并行角色开，并在项目 settings 里设 `"worktree": {"baseRef": "head"}`，加了 remote 之后行为也不变。
- `skills` 字段把整个 skill 正文预先注入子代理；子代理启动时不带主会话历史，但会带上主会话加载的 `CLAUDE.md` 层级（含按项目指令加载的 `AGENTS.md`）. [来源](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup), 抓取 2026-11-14. 采用: 角色专属规则放 skill，通用规则留在 `AGENTS.md`。
- 主会话处于 `acceptEdits`、`auto`、`bypassPermissions` 时，子代理的 `permissionMode` 被忽略，跟主会话走. [来源](https://code.claude.com/docs/en/sub-agents#permission-modes), 抓取 2026-11-14. 不采用（靠 `permissionMode` 做只读）: 只读角色用 `tools` 白名单实现。
- 子代理默认在后台运行，并且默认可以再派生子代理，最多到主会话以下三层；从 `tools` 里去掉 `Agent` 可禁止派生. [来源](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents), 抓取 2026-11-14. 采用: 审查类角色写 `disallowedTools: Agent`。
- 同名子代理的优先级是 managed > `--agents` > `.claude/agents/` > `~/.claude/agents/` > 插件，和 skill 相反，项目级压过个人级. [来源](https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope), 抓取 2026-11-14. 采用: 角色名不用加前缀。

### Hooks

- hooks 写在 `.claude/settings.json` 的 `hooks` 下，三层结构：事件 → matcher 组 → handler；各级 settings 的 hooks 是合并而不是覆盖，也会在子代理里触发. [来源](https://code.claude.com/docs/en/hooks#configuration), 抓取 2026-11-14. 采用: 项目级写进仓库。
- 现有事件：`SessionStart`、`Setup`、`InstructionsLoaded`、`UserPromptSubmit`、`UserPromptExpansion`、`MessageDisplay`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`PostToolBatch`、`PermissionDenied`、`Notification`、`SubagentStart`、`SubagentStop`、`TaskCreated`、`TaskCompleted`、`Stop`、`StopFailure`、`TeammateIdle`、`ConfigChange`、`CwdChanged`、`DirectoryAdded`、`FileChanged`、`WorktreeCreate`、`WorktreeRemove`、`PreCompact`、`PostCompact`、`PreModelSwitch`、`PostModelSwitch`、`SessionEnd`、`Elicitation`、`ElicitationResult`. [来源](https://code.claude.com/docs/en/hooks#hook-events), 抓取 2026-11-14. 采用: 只用 `PreToolUse`、`PostToolUse`、`Stop`、`SessionStart`。
- matcher 只含字母、数字、`_`、`-`、空格、`,`、`|` 时按精确名匹配（`Edit|Write`），含其他字符时当作不加锚的 JavaScript 正则（`Edit.*` 会同时匹配 `NotebookEdit`）；`"*"`、`""` 或省略表示全匹配；`Stop`、`UserPromptSubmit` 等事件不支持 matcher. [来源](https://code.claude.com/docs/en/hooks#matcher-patterns), 抓取 2026-11-14. 采用: 工具名用 `Edit|Write`、`Bash` 这种精确写法。
- handler 有 `if` 字段，值是一条权限规则（如 `"Bash(git *)"`、`"Edit(*.ts)"`），只在工具类事件上生效，不能组合多条；对 Bash 是尽力而为，解析不了命令时照样执行 hook. [来源](https://code.claude.com/docs/en/hooks#common-fields), 抓取 2026-11-14. 采用: 用 `"if": "Bash(git commit *)"` 缩小触发面，脚本里再自查一次命令。
- 退出码语义：0 成功；2 是阻断，stderr 作为原因交给 Claude；其他非零码是「非阻断错误」，动作照常执行。退出码 1 不会拦住任何东西. [来源](https://code.claude.com/docs/en/hooks#exit-code-output), 抓取 2026-11-14. 采用: 门禁脚本失败一律 `exit 2`。
- `exit 2` 能阻断的事件包括 `PreToolUse`、`UserPromptSubmit`、`Stop`、`SubagentStop`、`PreCompact`、`TaskCompleted` 等；`PostToolUse` 不能阻断，只是把 stderr 给 Claude 看. [来源](https://code.claude.com/docs/en/hooks#exit-code-2-behavior-per-event), 抓取 2026-11-14. 采用: 拦截放 `PreToolUse`，反馈放 `PostToolUse`。
- handler 的 `"onFailure": "block"` 让脚本缺失、超时、非 0/2 退出码都按阻断处理；不设时路径写错的策略 hook 会放行一切. [来源](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails), 要求 v2.1.295+. 采用: 两个策略 hook 都加。
- JSON 输出：`PreToolUse` 用 `hookSpecificOutput.permissionDecision`（`allow`/`deny`/`ask`/`defer`）加 `permissionDecisionReason`，顶层 `decision`/`reason` 对这个事件已弃用；`Stop`、`PostToolUse`、`UserPromptSubmit` 等仍用顶层 `{"decision":"block","reason":"…"}`；通用字段有 `continue`、`stopReason`、`systemMessage`. [来源](https://code.claude.com/docs/en/hooks#decision-control), 抓取 2026-11-14. 采用: 脚本只用退出码，不混用 JSON。
- `Stop` hook 连续阻断八次且中间没有工具调用会被强制放行，脚本应检查输入里的 `stop_hook_active`. [来源](https://code.claude.com/docs/en/hooks-guide#stop-hook-hits-the-block-cap), 抓取 2026-11-14. 采用: 用 `Stop` 做收尾检查时照做。
- 脚本路径用 `${CLAUDE_PROJECT_DIR}`；进入 worktree 后它仍指向主检出，当前目录要读输入 JSON 的 `cwd`. [来源](https://code.claude.com/docs/en/hooks#reference-scripts-by-path), 抓取 2026-11-14. 采用: 门禁在 `cwd` 里跑，脚本本身从 `${CLAUDE_PROJECT_DIR}` 取。
- handler 类型有 `command`、`http`、`mcp_tool`、`prompt`、`agent`（实验性）；`command` 默认超时 600 秒. [来源](https://code.claude.com/docs/en/hooks#hook-handler-fields), 抓取 2026-11-14. 采用: 只用 `command`。

### 权限

- 规则格式是 `Tool` 或 `Tool(specifier)`，放在 `permissions.allow` / `ask` / `deny`；判定顺序固定为 deny → ask → allow，先命中者生效，allow 不能在 deny 里开例外. [来源](https://code.claude.com/docs/en/permissions#manage-permissions), 抓取 2026-11-14. 采用: deny 只写确定不要的。
- Bash 规则按整条命令文本匹配，`*` 匹配任意文本，`Bash(git diff *)` 的空格有意义；复合命令的每个子命令都要被允许. [来源](https://code.claude.com/docs/en/permissions#wildcard-patterns), 抓取 2026-11-14. 采用: 允许项写到子命令一级。
- 文件规则只有 `Read(path)` 和 `Edit(path)` 生效，`Write(path)`、`Glob(path)`、`Grep(path)` 带路径的写法不匹配；路径是 gitignore 语法，`/path` 相对 settings 所在项目根，`//path` 才是绝对路径，`./path` 相对当前目录. [来源](https://code.claude.com/docs/en/permissions#read-and-edit), 抓取 2026-11-14. 采用: 用 `Read(/.env)`、`Edit(/.env)`。
- `Read` deny 同时挡住同一路径的 Edit 和 Write（v2.1.228+），也覆盖 Bash 里能识别的 `cat`、`sed`、重定向等，但挡不住自己开文件的脚本. [来源](https://code.claude.com/docs/en/permissions#what-read-and-edit-rules-cover), 抓取 2026-11-14. 采用: `.env` 用 deny 规则加 hook 两层，不指望单层。
- 权限模式是 `default`（别名 `manual`）、`acceptEdits`、`plan`、`auto`、`dontAsk`、`bypassPermissions`. [来源](https://code.claude.com/docs/en/permissions#permission-modes), 抓取 2026-11-14. 采用: 无人值守用 `acceptEdits` 加 allow 清单。

### 无头模式

- `claude -p` 成功退出码 0，失败非零；`--output-format` 取 `text`/`json`/`stream-json`，`json` 的文本结果在 `result` 字段. [来源](https://code.claude.com/docs/en/headless), 抓取 2026-11-14. 采用: 循环执行器用 `json` 加 `jq -r '.result'`。
- 以下参数都在现行 CLI 参考里：`--max-turns`（仅 print 模式，默认不限）、`--max-budget-usd`、`--permission-mode`、`--allowedTools`、`--disallowedTools`、`--tools`、`--append-system-prompt`、`--append-system-prompt-file`、`--model`、`--json-schema`、`--settings`、`--setting-sources`、`--mcp-config`、`--strict-mcp-config`. [来源](https://code.claude.com/docs/en/cli-reference#cli-flags), 抓取 2026-11-14. 采用: 命令行见文末。
- `-p` 下没人能批准的调用直接被拒；`--permission-prompts none`（v2.1.259+）还会告诉 Claude 不要重试并移除 `AskUserQuestion`. [来源](https://code.claude.com/docs/en/headless#turn-off-permission-prompts-in-unattended-runs), 要求 v2.1.259+. 采用: 循环里加上。
- 不加 `--bare` 时，`-p` 会像交互会话一样加载 hooks、skills、子代理、MCP、`CLAUDE.md`，而且对从未信任过的目录也不弹信任确认；`--bare` 全部跳过并且不用订阅登录，需要 `ANTHROPIC_API_KEY`. [来源](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode), 抓取 2026-11-14. 不采用（`--bare`）: 循环正需要这些 hooks 和 skills。

### Worktree、后台代理、agent teams

- `claude --worktree <name>`（`-w`）在 `<repo>/.claude/worktrees/<name>` 建 worktree，分支名 `worktree-<name>`，可配 `-p`；官方建议把 `.claude/worktrees/` 加进 `.gitignore`，gitignore 的文件（如 `.env`）用 `.worktreeinclude` 带过去. [来源](https://code.claude.com/docs/en/worktrees), 抓取 2026-11-14. 采用: 并行任务用它，`.gitignore` 加一行。
- 后台会话用 `claude --bg "<prompt>"` 启动、`claude agents` 管理，属于 research preview，且 `--bg` 不能和 `-p` 同用. [来源](https://code.claude.com/docs/en/agent-view), 抓取 2026-11-14. 不采用: 循环执行器走 `-p`，更好脚本化。
- agent teams 仍是实验功能，默认关闭，需 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`，并且 `-p` 模式下不会派生队友. [来源](https://code.claude.com/docs/en/agent-teams), 抓取 2026-11-14. 不采用: 无头循环用不上，用子代理。

## 3. Codex CLI

### AGENTS.md

- 发现顺序：先读全局 `~/.codex/AGENTS.override.md`，没有才读 `~/.codex/AGENTS.md`；再从项目根（通常是 git 根）一路走到当前目录，每个目录按 `AGENTS.override.md`、`AGENTS.md`、`project_doc_fallback_filenames` 的顺序最多取一个文件；从根到叶拼接，靠后的优先. [来源](https://learn.chatgpt.com/docs/agent-configuration/agents-md), 抓取 2026-11-14. 采用: 项目根一份 `AGENTS.md`。
- 按文档，项目范围从项目根开始往下找，根以上的目录不读，所以 `~/Developer/AGENTS.md` 对 Codex 不可见. [来源](https://learn.chatgpt.com/docs/agent-configuration/agents-md), 抓取 2026-11-14；本机用 `codex debug prompt-input` 只核对了「项目根的 `AGENTS.md` 被读入」，没有在带上级 `AGENTS.md` 的目录里测. 采用: 与 Claude 侧用 `CLAUDE.md` import 的做法配合，两边看到同一份。
- 大小上限由 `project_doc_max_bytes` 控制，默认 32 KiB. [来源](https://learn.chatgpt.com/docs/agent-configuration/agents-md), 抓取 2026-11-14. 未验证: 这页说是「合并后总量」，高级配置页和配置参考说是「每个 `AGENTS.md` 读取的最大字节数」，两处说法不一致；`AGENTS.md` 控制在 32 KiB 以内即可回避。
- 项目根判定默认看 `.git`，可用 `project_root_markers` 改. [来源](https://learn.chatgpt.com/docs/config-file/config-advanced#project-root-detection), 抓取 2026-11-14. 采用: 默认值够用。

### Skills

- 文档列出的发现路径只有 `.agents/skills`（从当前目录到仓库根逐级）、`$HOME/.agents/skills`、`/etc/codex/skills` 和内置 skill，支持 symlink 的 skill 目录；同名不合并，两个都会出现. [来源](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills), 抓取 2026-11-14. 采用: 项目 skill 放 `.agents/skills/`。
- `~/.codex/skills` 不在现行文档的路径表里，但本机 0.169.0 仍在加载它（`codex debug prompt-input` 的 skill 根目录列表里有 `~/.codex/skills`）. [来源](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills), 本机实测 0.169.0. 未验证: 属于文档未写的遗留行为；项目级 `.codex/skills` 文档没提，也没测。
- 初始列表含每个 skill 的名字、描述和文件路径，预算默认是上下文窗口的 2%，超了先缩短描述再丢 skill；`skills.max_context_tokens` 可调，上限 10,000. [来源](https://learn.chatgpt.com/docs/build-skills), 抓取 2026-11-14. 采用: 描述把触发词放最前。
- 显式调用用 `$skill-name` 或 `/skills`；可选的 `agents/openai.yaml` 里 `policy.allow_implicit_invocation: false` 可关掉自动触发. [来源](https://learn.chatgpt.com/docs/build-skills#optional-metadata), 抓取 2026-11-14. 不采用（`openai.yaml`）: 先不加工具专属文件。

### 配置、信任、profile

- 支持项目级 `.codex/config.toml`（从项目根到当前目录逐级加载，近者优先），只有项目被信任时才加载；不信任时项目的 `.codex/` 整层（配置、hooks、rules）都跳过. [来源](https://learn.chatgpt.com/docs/config-file/config-basic), 抓取 2026-11-14. 采用: 项目里放 `.codex/config.toml`，README 写明首次要信任。
- 项目级配置里这些键被忽略并在启动时告警：`openai_base_url`、`chatgpt_base_url`、`model_provider`、`model_providers`、`notify`、`profile`、`profiles`、`otel` 等. [来源](https://learn.chatgpt.com/docs/config-file/config-advanced#project-config-files-codexconfigtoml), 抓取 2026-11-14. 采用: 项目配置只放 sandbox、MCP、hooks。
- 优先级从高到低：CLI 参数和 `-c` → 项目 `.codex/config.toml` → `--profile` 文件 → `~/.codex/config.toml` → 云端托管默认 → `/etc/codex/config.toml` → 内置默认. [来源](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence), 抓取 2026-11-14. 采用: 循环执行器用 CLI 参数钉死关键项。
- profile 已改成独立文件 `~/.codex/<name>.config.toml`，用 `--profile <name>` 选；0.134.0 起不再读 `config.toml` 里的 `[profiles.<name>]`，顶层 `profile = "…"` 也不支持. [来源](https://learn.chatgpt.com/docs/config-file/config-advanced#profiles), 0.134.0+；本机 `codex exec --help` 一致. 不采用: profile 在用户目录，不能随仓库走。
- 信任可以用 `codex exec --trust` 持久保存；`~/.codex/config.toml` 的 `[projects."<path>"] trust_level = "untrusted"` 可显式标记不信任. [来源](https://learn.chatgpt.com/docs/agent-approvals-security), 抓取 2026-11-14；`--trust` 见本机 `codex exec --help` 0.169.0. 未验证: `--trust` 在官方参数表里的说明没读到（参数表是脚本渲染），只见于本机帮助。

### Sandbox 和审批

- sandbox 模式三种：`read-only`、`workspace-write`、`danger-full-access`，参数 `--sandbox`/`-s`，配置键 `sandbox_mode`. [来源](https://learn.chatgpt.com/docs/config-file/config-reference), 抓取 2026-11-14. 采用: 循环用 `workspace-write`。
- 审批策略现在只有 `on-request`、`never` 和 `{ granular = {…} }`；`untrusted` 已下线（留在配置里可能导致启动失败），`on-failure` 已弃用；参数 `--ask-for-approval`/`-a`. [来源](https://learn.chatgpt.com/docs/agent-approvals-security#migrate-from-the-retired-untrusted-approval-policy), 抓取 2026-11-14. 采用: 交互用 `on-request`，无头用 `never`。
- `workspace-write` 下 `.git`、`.agents`、`.codex`、`.aws` 仍是只读，默认没有网络. [来源](https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots), 抓取 2026-11-14. 采用: 循环里不让 Codex 自己 `git commit`，提交由外层脚本在门禁通过后做；它也改不了 `.agents/skills`。
- 全放开是 `--dangerously-bypass-approvals-and-sandbox`（别名 `--yolo`）. [来源](https://learn.chatgpt.com/docs/agent-approvals-security#common-sandbox-and-approval-combinations), 抓取 2026-11-14. 不采用: 本机不是隔离环境。
- 沙箱外命令的放行规则在 `.codex/rules/*.rules`（Starlark 的 `prefix_rule`），标注为实验性，项目级同样要信任后才加载. [来源](https://learn.chatgpt.com/docs/agent-configuration/rules), 抓取 2026-11-14. 不采用: 实验性，先不依赖。

### `codex exec`

- `--full-auto` 已不支持，官方要求改用 `--sandbox workspace-write`，或用 `--approve-for-me` 把审批交给自动审查. [来源](https://learn.chatgpt.com/docs/non-interactive-mode#permissions-and-safety), 抓取 2026-11-14；本机 0.169.0 的 `codex exec --help` 里确实没有 `--full-auto`. 采用: 脚本里不能再写 `--full-auto`。
- `codex exec` 默认是 read-only sandbox；进度走 stderr，stdout 只有最终消息；`--json` 把 stdout 变成 JSONL 事件流（`thread.started`、`turn.completed`、`item.*`、`error` 等）. [来源](https://learn.chatgpt.com/docs/non-interactive-mode), 抓取 2026-11-14. 采用: `--json` 落盘做日志。
- `-o`/`--output-last-message <path>` 写最终消息到文件，`--output-schema <file>` 约束最终输出为 JSON Schema；官方建议 CI 里 `--json` 和 `--output-last-message` 一起用. [来源](https://learn.chatgpt.com/docs/developer-commands?surface=cli#flag-combinations-and-safety-tips), 抓取 2026-11-14. 采用: 两个都用。
- 其他现行参数：`-m/--model`、`-C/--cd`、`--skip-git-repo-check`、`--ephemeral`、`--ignore-user-config`、`--ignore-rules`、`-p/--profile`、`--add-dir`、`--worktree`、`-c key=value`；提示词可从 stdin 读（`codex exec -`），续跑用 `codex exec resume --last`. [来源](https://learn.chatgpt.com/docs/non-interactive-mode), 抓取 2026-11-14 + 本机 `codex exec --help` 0.169.0. 未验证（部分）: 官方 CLI 参考的参数表是脚本渲染、Markdown 里没有，完整清单以本机帮助为准。
- `codex exec` 没有 `-a/--ask-for-approval` 参数（该参数在顶层 `codex` 上），无头下要设审批策略用 `-c approval_policy=…`. [来源](https://learn.chatgpt.com/docs/config-file/config-reference), 本机 `codex exec --help` 0.169.0. 采用: 显式写 `-c 'approval_policy="never"'`。

### Hooks、notify、子代理

- Codex 现在有正式的 hooks（`features.hooks` 默认开、标 Stable），配置在 `<repo>/.codex/hooks.json` 或 `config.toml` 的 `[hooks]`，结构和 Claude Code 相同（事件 → matcher → handler）. [来源](https://learn.chatgpt.com/docs/hooks), 抓取 2026-11-14. 采用: 两边共用同一批 hook 脚本。
- 事件有 `SessionStart`、`SessionEnd`、`SubagentStart`、`SubagentStop`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PreModelRequest`、`PostModelRequest`、`PreCompact`、`PostCompact`、`UserPromptSubmit`、`Stop`、`Interrupt`. [来源](https://learn.chatgpt.com/docs/hooks), 抓取 2026-11-14. 采用: 用 `PreToolUse` 和 `Stop`。
- 非托管 hook 必须先在 `/hooks` 里按内容哈希审核并信任才会运行，改了就要重审；无头场景可加 `--dangerously-bypass-hook-trust`. [来源](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks), 抓取 2026-11-14. 采用: 人先在 TUI 里信任一次；脚本内容稳定后少改。
- `PreToolUse` 的 matcher 是正则；shell 命令匹配 `Bash`，文件编辑走 `apply_patch`（matcher 也可写 `Edit` 或 `Write`），两者的内容都在 `tool_input.command`；阻断可用 `exit 2` 加 stderr，或 `hookSpecificOutput.permissionDecision: "deny"`；`permissionDecision: "ask"` 尚不支持. [来源](https://learn.chatgpt.com/docs/hooks#pretooluse), 抓取 2026-11-14. 采用: 共用脚本要同时处理 `tool_input.file_path`（Claude）和 `tool_input.command` 里的补丁文本（Codex）。
- 只支持 `command` 和 `mcp_tool` 两种 handler，`prompt`、`agent` 会被解析但跳过；官方提醒工具 hook 是护栏而不是完整的强制边界. [来源](https://learn.chatgpt.com/docs/hooks#config-shape), 抓取 2026-11-14. 采用: 真正的边界靠 sandbox。
- `notify = ["python3", "/path/to/notify.py"]` 在 `agent-turn-complete` 时调外部程序，只能写在用户级配置. [来源](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications), 抓取 2026-11-14. 不采用: 项目级无效。
- 子代理默认开启（`multi_agent` 标 Stable），内置 `default`、`worker`、`explorer`；自定义代理是 `.codex/agents/*.toml`，必填 `name`、`description`、`developer_instructions`，可设 `model`、`model_reasoning_effort`；sandbox、审批、MCP 一律继承父会话，代理文件改不了. [来源](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), 抓取 2026-11-14. 采用: 角色在 `.codex/agents/` 各写一份 TOML，正文与 `.claude/agents/` 同源。
- 子代理在 `codex exec` 无头运行里是否会被派生，文档只写了「需要新审批的动作会失败」，没有正面说明. [来源](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls), 抓取 2026-11-14. 未验证: 没有实测。

## 4. Gemini CLI、Cursor、OpenCode

- Gemini CLI 默认读 `GEMINI.md`（`~/.gemini/GEMINI.md`、工作区及上级目录、按需的子目录），要读 `AGENTS.md` 需在 `settings.json` 里设 `context.fileName`，支持 `@file.md` import. [来源](https://geminicli.com/docs/cli/gemini-md/), Last updated 2026-06-18. 采用: 仓库放 `.gemini/settings.json`，内容 `{"context":{"fileName":["AGENTS.md","GEMINI.md"]}}`；未安装，未运行。
- Gemini CLI 支持 Agent Skills，工作区级读 `.gemini/skills/` 或别名 `.agents/skills/`，用户级读 `~/.gemini/skills/` 或 `~/.agents/skills/`，同级里 `.agents/skills/` 优先. [来源](https://geminicli.com/docs/cli/skills/), Last updated 2026-04-30. 采用: `.agents/skills/` 直接可用。
- Cursor 读 `.cursor/rules/*.mdc`（必须 `.mdc`，纯 `.md` 被忽略），也读项目根和子目录的 `AGENTS.md`. [来源](https://cursor.com/docs/rules), 抓取 2026-11-14，页面无日期. 采用: 只靠 `AGENTS.md`，不另写 `.cursor/rules`。
- Cursor 支持 Agent Skills，读 `.agents/skills/`、`.cursor/skills/`、`~/.agents/skills/`、`~/.cursor/skills/`，并兼容 `.claude/skills/`、`.codex/skills/` 及其用户级目录. [来源](https://cursor.com/docs/skills), 抓取 2026-11-14，页面无日期. 采用: `.agents/skills/` 直接可用；`.claude/skills` 的链接可能让同一 skill 出现两次，未验证是否去重。
- OpenCode 读 `AGENTS.md`（从当前目录向上找），没有时回退到 `CLAUDE.md`；全局是 `~/.config/opencode/AGENTS.md`. [来源](https://opencode.ai/docs/rules/), 抓取 2026-11-14，该地址跳转到 `/v1/docs/rules/`. 未验证: 跳到了 v1 路径，是否还有更新版本的规则页没有确认。
- OpenCode 支持 Agent Skills，读 `.opencode/skills`，并兼容 `.claude/skills`、`.agents/skills` 及对应的全局目录. [来源](https://opencode.ai/docs/skills/), 抓取 2026-11-14，页面无日期. 采用: `.agents/skills/` 直接可用。

## 5. MCP 项目级配置与浏览器驱动

- Claude Code 的项目级 MCP 配置是项目根的 `.mcp.json`，顶层键 `mcpServers`，每个 server 写 `command`/`args`/`env`（stdio）或 `type: "http"` 加 `url`；支持 `${VAR}` 展开. [来源](https://code.claude.com/docs/en/mcp#project-scope), 抓取 2026-11-14. 采用: 需要 MCP 时用它。
- 交互会话里首次使用 `.mcp.json` 的 server 要批准；`claude -p` 不弹确认，直接加载. [来源](https://code.claude.com/docs/en/mcp#project-scope), 抓取 2026-11-14. 采用: 无头循环不想带某个 server 时用 `--strict-mcp-config`。
- Codex 的等价物是 `config.toml` 里的 `[mcp_servers.<name>]` 表（`command`、`args`、`env`，或 `url`），可写在 `~/.codex/config.toml` 或受信任项目的 `.codex/config.toml`；命令行是 `codex mcp add <name> -- <command>`. [来源](https://learn.chatgpt.com/docs/extend/mcp), 抓取 2026-11-14. 采用: 需要时写进项目 `.codex/config.toml`。
- Playwright 官方现在的说法：编码代理（点名 Claude Code、GitHub Copilot）优先用 `playwright-cli` 加 skills，理由是不往上下文里塞大块工具 schema 和可访问性树；MCP 留给需要持续浏览器状态的探索式、长时间自主流程. [来源](https://playwright.dev/docs/getting-started-cli), 抓取 2026-11-14；仓库 [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli) v0.1.24（2026-11-10）. 采用: 代理看页面用 `playwright-cli`，不把 Playwright MCP 写进 `.mcp.json`。
- `microsoft/playwright-mcp` 仍在维护，README 开头自己写了同样的取舍，并把编码代理指向 CLI. [来源](https://github.com/microsoft/playwright-mcp), v0.0.85（2026-11-09）. 不采用: 本项目是编码代理加测试的场景；Codex 的 MCP 文档仍把它列在「常用 server」里，没有给出相反的推荐。
- 安装是 `npm install -g @playwright/cli@latest`，或作为项目依赖 `npm install -D @playwright/cli@latest` 后用 `npx playwright cli`；skill 用 `playwright-cli install --skills` 安装，加 `-g` 装到 `~/.claude/skills`，加 `--skills=agents` 装到 `~/.agents/skills`. [来源](https://playwright.dev/docs/getting-started-cli), 抓取 2026-11-14. 未验证: 不带 `-g` 时装到项目的哪个目录文档没写明，也没有在本机跑过。
- 回归测试仍用 `@playwright/test` 本身（`npx playwright test`），上面两种只是让代理临时操作浏览器. [来源](https://playwright.dev/docs/getting-started-cli), 抓取 2026-11-14. 采用: 门禁里只跑 Vitest 和 `playwright test`。

## 对本项目的落地建议

下面的命令按官方示例写成 `npm run` / `npx`。仓库里已经有 `pnpm-lock.yaml`，落地时换成 `pnpm run` / `pnpm exec`，权限规则里的前缀（如 `Bash(npm run *)`）也要跟着换，否则匹配不上。

### 目录

```
AGENTS.md                      # 唯一的共享指令，控制在 32 KiB 以内
CLAUDE.md                      # 第一行 @AGENTS.md，其余只写 Claude 专属内容
.agents/skills/<name>/SKILL.md # skill 实体；<name> 带项目前缀
.claude/skills -> ../.agents/skills
.claude/agents/<role>.md
.claude/settings.json          # permissions + hooks
.claude/hooks/*.sh
.codex/config.toml             # sandbox、MCP；项目需被信任
.codex/hooks.json              # 调用同一批 .claude/hooks 脚本
.codex/agents/<role>.toml
.gemini/settings.json          # {"context":{"fileName":["AGENTS.md","GEMINI.md"]}}
```

- `.claude/skills` 整目录链接在 2.1.325 上实测可用，但文档只承诺单个条目链接。门禁里加一条检查：`.claude/skills/<name>/SKILL.md` 对每个 `.agents/skills/<name>` 都能读到。如果哪次升级后失效，退回文档写明的做法：`ln -s ../../.agents/skills/<name> .claude/skills/<name>`。来源：[skills](https://code.claude.com/docs/en/skills#choose-where-skills-load)。
- 文档写明 Edit、Write 拒绝穿过文件 symlink 写入（讲的是 `CLAUDE.md` 链到 `AGENTS.md` 的情形）；目录链接下是否同样拒绝没有验证。改 skill 时路径统一写 `.agents/skills/...`，两种情况都不受影响。来源：[memory](https://code.claude.com/docs/en/memory#agents-md)。
- `.gitignore` 增加 `.claude/worktrees/`。来源：[worktrees](https://code.claude.com/docs/en/worktrees)。
- 当前仓库在 `master` 分支且还没有提交，git worktree 需要至少一个提交作起点，先做首个提交再用 `--worktree` 或 `isolation: worktree`。

### `CLAUDE.md`

照官方「Share one file with other coding tools」一节的写法（来源：[memory](https://code.claude.com/docs/en/memory#agents-md)）：

```text
@AGENTS.md

## Claude Code

- 改 skill 时编辑 .agents/skills/ 下的文件。
```

### 共享 skill 的 frontmatter

只用标准六字段（来源：[specification](https://agentskills.io/specification)）：

```markdown
---
name: coa-gate
description: 运行本项目的提交前门禁（类型检查、Vitest、Playwright）。在准备 git commit、或用户说「跑门禁」时使用。
---
```

### 子代理 frontmatter

由官方 `code-reviewer` 示例和 `refactorer` 示例改写（来源：[sub-agents](https://code.claude.com/docs/en/sub-agents#write-subagent-files)、[worktrees](https://code.claude.com/docs/en/worktrees#isolate-subagents-with-worktrees)）。只读角色：

```markdown
---
name: reviewer
description: 审查当前改动的正确性和可维护性。实现完成后、提交前使用。
tools: Read, Glob, Grep, Bash
disallowedTools: Agent
model: sonnet
maxTurns: 30
skills:
  - coa-review
---

你是代码审查者。只读，不改文件。逐条给出问题、位置和修改建议。
```

会改文件、需要并行的角色加一行隔离：

```markdown
---
name: implementer
description: 按任务说明实现一个独立切片并跑通相关测试。
tools: Read, Glob, Grep, Bash, Edit, Write
model: sonnet
maxTurns: 60
isolation: worktree
---
```

配套在 `.claude/settings.json` 里写 `"worktree": {"baseRef": "head"}`。默认值 `"fresh"` 在有 remote 时从远端默认分支拉，看不到本地未推送的工作。

### `.claude/settings.json`

`.env` 用 deny 规则和 hook 两层拦；`git commit` 前跑门禁。结构取自官方「Block edits to protected files」、`if` 字段示例和 `onFailure` 示例（来源：[hooks-guide](https://code.claude.com/docs/en/hooks-guide#block-edits-to-protected-files)、[hooks](https://code.claude.com/docs/en/hooks#block-the-action-when-a-hook-fails)、[permissions](https://code.claude.com/docs/en/permissions#read-and-edit)）：

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run *)",
      "Bash(npx vitest *)",
      "Bash(npx playwright test *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(git log *)"
    ],
    "deny": [
      "Read(/.env)",
      "Read(/.env.local)",
      "Edit(/.env)",
      "Edit(/.env.local)"
    ]
  },
  "worktree": { "baseRef": "head" },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/protect-files.sh",
            "onFailure": "block"
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git commit *)",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/pre-commit-gate.sh",
            "timeout": 600,
            "statusMessage": "提交前门禁",
            "onFailure": "block"
          }
        ]
      }
    ]
  }
}
```

`.claude/hooks/protect-files.sh`（官方示例，保护列表改成本项目的；`.env.example` 放行）：

```bash
#!/bin/bash
INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$(basename "$FILE_PATH")" in
  .env|.env.local)
    echo "Blocked: $FILE_PATH 是受保护文件" >&2
    exit 2
    ;;
esac
exit 0
```

`.claude/hooks/pre-commit-gate.sh`（由官方 `no-rm.sh` 改写；在输入 JSON 的 `cwd` 里跑，worktree 里也对）：

```bash
#!/bin/bash
input=$(cat)
command=$(jq -r '.tool_input.command // empty' <<<"$input")
case "$command" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

cd "$(jq -r '.cwd' <<<"$input")" || exit 2
if ! out=$(npm run --silent gate 2>&1); then
  echo "Blocked: 门禁未通过，先修复再提交" >&2
  echo "$out" | tail -n 40 >&2
  exit 2
fi
exit 0
```

两个脚本都要 `chmod +x`。失败必须 `exit 2`，退出码 1 不拦截。

### `.codex/hooks.json`

结构取自 Codex 官方示例，路径按官方建议从 git 根解析（来源：[hooks](https://learn.chatgpt.com/docs/hooks#config-shape)）。首次需要在 Codex TUI 的 `/hooks` 里信任。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$(git rev-parse --show-toplevel)/.claude/hooks/pre-commit-gate.sh\"",
            "timeout": 600,
            "statusMessage": "提交前门禁"
          }
        ]
      }
    ]
  }
}
```

Codex 的文件编辑走 `apply_patch`，路径在 `tool_input.command` 的补丁文本里，上面的 `protect-files.sh` 读不到；要在 Codex 侧也拦 `.env`，需另写一个从补丁头里取路径的脚本。Codex 的 `workspace-write` 沙箱本身不保护 `.env`。

### `.codex/config.toml`

来源：[config-basic](https://learn.chatgpt.com/docs/config-file/config-basic)、[agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security#configuration-in-configtoml)。

```toml
approval_policy = "on-request"
sandbox_mode = "workspace-write"
```

沙箱默认无网络。Playwright 测试要访问本机 dev server，是否受影响没有实测；受影响时加 `[sandbox_workspace_write]` 下的 `network_access = true`。

### 循环执行器的一轮：Claude Code

由官方「Auto-approve tools」「Create a commit」「Turn off permission prompts in unattended runs」三个示例组合（来源：[headless](https://code.claude.com/docs/en/headless)、[cli-reference](https://code.claude.com/docs/en/cli-reference#cli-flags)）：

```bash
claude -p "$(cat prompts/iterate.md)" \
  --permission-mode acceptEdits \
  --permission-prompts none \
  --allowedTools "Bash(npm run *),Bash(npx vitest *),Bash(npx playwright test *),Bash(git status *),Bash(git diff *),Bash(git log *),Bash(git add *),Bash(git commit *)" \
  --append-system-prompt-file prompts/loop-system.md \
  --max-turns 60 \
  --model sonnet \
  --output-format json \
  > .local/loop/claude-iter.json

jq -r '.result' .local/loop/claude-iter.json
```

- 退出码非零即本轮失败。
- `git commit` 会触发上面的门禁 hook，所以这里可以放行它。
- 要隔离到 worktree 时加 `--worktree <name>`。

### 循环执行器的一轮：Codex

由官方 `codex exec --sandbox workspace-write`、`cat prompt.txt | codex exec -`、`--json` 配 `--output-last-message` 三处组合（来源：[non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode)、[developer-commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli#flag-combinations-and-safety-tips)；参数名另用本机 `codex exec --help` 0.169.0 核对）：

```bash
codex exec - \
  --sandbox workspace-write \
  -c 'approval_policy="never"' \
  --json \
  -o .local/loop/codex-last.md \
  < prompts/iterate.md \
  > .local/loop/codex-events.jsonl

npm run --silent gate && git add -A && git commit -m "loop: iteration"
```

- 不要写 `--full-auto`，已被移除。
- `.git` 在沙箱里只读，提交放在 Codex 退出之后由脚本做，顺带保证门禁一定跑过。
- 没有模型参数时用配置里的默认模型；要指定就加 `-m <model>`。

### 浏览器

代理需要看真实页面时用 `playwright-cli`（来源：[getting-started-cli](https://playwright.dev/docs/getting-started-cli)）：

```bash
npm install -D @playwright/cli@latest
npx playwright cli --help
```

不在 `.mcp.json` 里配置 Playwright MCP。回归测试照常是 `npx playwright test`。
