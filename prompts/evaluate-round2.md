Round 2 evaluation. Read `/Users/zephyrsui/Developer/coa-review/prompts/evaluate-batch.md` and follow it, with these changes:
- For each page read the previous report `evals/look/<id>/report-b1.md` first and re-check every problem in it (fixed / not fixed), then do the full pass again on the non-student accept items.
- Re-export `evals/look/<id>/steps.md` first.
- Student item (accept 11): after finishing the other items for a page, judge it yourself as a strict proxy: using ONLY `steps.md`, solve one variant problem of the page's type with your own numbers, compare with the engine's answer (run the page's 试一试 with those numbers in the browser); pass if the steps were sufficient to solve it and every term was explained before use; otherwise list exactly what was missing.
- Write `evals/look/<id>/report-b2.md`. If a page passes ALL accept items, set its `passes: true` and `evidence: "evals/look/<id>/report-b2.md"` in `plan/features.json` (nothing else in that file; if another evaluator is editing the file at the same time, re-read before writing). Pages that already have passes: true and now fail an item: set passes back to false and say why.
- Screenshots `b2-*.png`, ≤ 6 per page; delete that page's `b1-*.png` when done.
Final reply ≤ 200 words: per page pass/fail and remaining 高/中 problems.
