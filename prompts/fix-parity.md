Phone-parity round. An independent check compared phone (390×844) with desktop (1280×800) on every page: `/Users/zephyrsui/Developer/coa-review/evals/look/final-parity.md` — read the table and the sections for YOUR pages (screenshots under `evals/look/<id>/final-*.png`).

Hard standard for this round, all three at once:
1. Phone shows everything desktop shows: every part, reading, formula, label, example, step, 常见错误 — reachable by the camera following the step or one 「看…」 pan. Nothing dropped, truncated or scrolled away with no way back (e.g. keep row labels pinned when a grid window slides).
2. Questions are answered by acting on scene parts on the phone whenever desktop does (buttons only as a secondary way); where the report says scene answering is missing at BOTH widths (e.g. bit tiles that cannot be flipped), add it at both.
3. `node scripts/qa-clip.mjs <id>` and `node scripts/qa-pages.mjs <id>` both ok (the kit agent owns qa-clip; if its rule is wrong for a case, report under 「qa-clip 误报」 in your progress file instead of dropping content).
If something truly cannot fit a 360 px frame at ≥ 12 px, show it in sequence (camera visits A then B within the step) — do not remove it.

Same scope as your page task; own port and build dir; ONE browser; never pkill; hard timeouts. No git state changes. Final reply ≤ 80 words: per page — each reported problem fixed / not fixed, and both checks' status.
