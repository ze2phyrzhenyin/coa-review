# no-ai-flavor

去掉文案和界面里的 AI 味。一个 skill 加一个检查脚本。

```
no-ai-flavor/
  SKILL.md              规则。也是可以直接粘贴的提示词
  references/
    design.md           版式和视觉
    fr-en.md            法语和英语特有的说法
    sources.md          每条规则的出处，以及没收的部分
  scripts/
    lint-copy.mjs       检查脚本（中、法、英）
    phrases.json        词表，分 error 和 warn
    selftest.mjs        自测
    fixtures/           自测用的两页样例：截图原样、改后
```

## 安装

Claude Code，所有项目都用：

```
cp -R no-ai-flavor ~/.claude/skills/
```

只给一个项目用：放到项目里的 `.claude/skills/no-ai-flavor/`。

装好后说「去 AI 味」「检查一下 AI 味」，或者输入 `/no-ai-flavor`。

claude.ai：设置里的 Skills 上传这个 zip。

Codex、Cursor、ChatGPT 等：把 `SKILL.md` 正文（开头两条 `---` 之间的部分不要）放进 `AGENTS.md`、规则文件或对话开头。

## 检查脚本

Node 18 以上，没有依赖。

```
node scripts/lint-copy.mjs dist            # 扫构建产物；不写路径时自动找 dist 或 src
node scripts/lint-copy.mjs src --strict    # warn 也算失败
node scripts/lint-copy.mjs page.html --json
node scripts/selftest.mjs                  # 改了词表或规则后跑
```

| 参数 | 作用 |
|---|---|
| `--lang zh,fr` | 只查这几种语言（默认中、法、英） |
| `--allow 词1,词2` | 这些词不算（产品名、菜名） |
| `--off 规则 id` | 关掉某条规则，比如 `layout.subtitle` |
| `--quiet` | 只显示 error |

项目根目录可以放 `.copylint.json`：

```json
{
  "allow": ["Oasis", "jus de passion"],
  "ignore": ["src/legal/"],
  "off": ["zh.steps2"],
  "phrases": { "zh": { "error": ["项目里不想再看到的说法"] } }
}
```

接进项目：把 `scripts/lint-copy.mjs` 和 `phrases.json` 复制到项目的 `scripts/`，`package.json` 加 `"lint:copy": "node scripts/lint-copy.mjs dist"`，构建后跑。

它查得到的：词、句式、符号、标题下的短说明、眉标类名。查不到的：颜色、字体、动效、卡片，这些要看页面。
