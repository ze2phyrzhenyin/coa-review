You are the evaluator for a Chinese review website for 计算机组成原理 (textbook 白中英第七版), project `/Users/zephyrsui/Developer/coa-review`. You did not build these pages; judge independently and strictly — a real problem fails the page even if the rest is good.

Read: `prompts/roles/evaluator.md`, `.agents/skills/coa-look/SKILL.md`, `docs/INTERACTION.md` (all sections, incl. 「形象、直观、有趣」「易懂、专业、美观」 and the 10-point motion standard), `docs/DESIGN.md`, `plan/features.json` (the `accept` list — 11 items), and for each page its spec `specs/<id>.md` and the matching chapter digest in `docs/textbook/`. Do not read page source except to find selectors.

Build once: `VITE_SHOW_PLANNED=1 pnpm -s exec vite build --outDir .local/qa-dist-$PORT --emptyOutDir`, preview `--host 127.0.0.1 --port $PORT`. Playwright via `launch()` from `scripts/qa-lib.mjs`; ONE browser at a time (the Mac is shared); 390×844 and 1280×800; light, plus dark for two key steps per page. Never `pkill` browsers — close only your own.

Per page, in this order:
1. FIRST export everything the page shows a student (every 讲解 step of every example: title, why, changes, questions/options; the conclusion; 需要先会; 常见错误; the solution table; 练习 instructions) to `evals/look/<id>/steps.md` (overwrite) — a student reviewer reads only that file.
2. Walk every step; each question type once right and once wrong (the wrong answer must be acted out in the scene); reload mid-way; back-step; browser Back/Forward; fresh context from the URL; 试一试 with edge and invalid values; one 练习 with a deliberate mistake (grading must point at the right place; hint must be true); 弄坏它; each 常见错误; reduced motion.
3. Correctness: recompute two steps by hand from the textbook digest.
4. Judge the metaphor/vividness, clarity, notation/typesetting, visual quality and phone legibility from screenshots you open yourself.
Write `evals/look/<id>/report-b1.md` with Bash (Chinese): one line per accept item (通过/不通过 + evidence; mark the student item 「另行判定」), then problems ranked 高/中/低 with exact reproduction steps. Screenshots `evals/look/<id>/b1-*.png`, ≤ 10 per page (JPEG-quality small PNGs; disk is tight).

Do not edit src/ or plan/features.json. Kill your preview server and delete `.local/qa-dist-$PORT` at the end. No git state changes.

Final reply ≤ 200 words: per page — pass/fail on the non-student items and its 高/中 problems.
