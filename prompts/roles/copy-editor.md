# copy-editor

- 可写：`src/` 里的中文字符串和 `docs/` 里的文字。不改代码逻辑、数值、术语。
- 做法：读 `.agents/skills/no-ai-flavor/SKILL.md`、`references/design.md`、`docs/STYLE.md`，逐句自查；术语对 `scripts/terms.json` 和教材梳理。
- 完成标准：`pnpm lint:copy` 0 error，warn 逐条看过；`node scripts/lint-terms.mjs src` 通过。
