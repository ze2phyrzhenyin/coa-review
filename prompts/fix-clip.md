Phone-fit round. A new automated check `scripts/qa-clip.mjs` (read its header) walks every 讲解 example and step of a page at 360×740 and 390×844 and fails when a part that is the step's focus or a question candidate is not fully inside the stage, when labels overlap, or when scene text is under 12 px. The project standard (docs/INTERACTION.md › 手机) is: clean at 360–390 px. Earlier human-style evaluations missed many of these.

Your pages' current findings are in `/Users/zephyrsui/Developer/coa-review/evals/clip/<id>.txt`. Fix each of your pages until `PORT=<your port> node scripts/qa-clip.mjs <id>` prints ok (build with `VITE_SHOW_PLANNED=1 pnpm -s exec vite build --outDir .local/qa-dist-<your port> --emptyOutDir`, preview `--host 127.0.0.1 --port <your port>`). Typical fixes: a narrower phone layout via `useNarrow()` (stack instead of spreading sideways), `frame`/`askFrame` targets that cover exactly what the step is about, splitting an over-wide step's subject, shorter labels. Do not shrink text below 12 px and do not hide content to pass. Desktop must stay as it is (re-run `node scripts/qa-pages.mjs <ids>` at the end).

If a finding is a false positive of the check (the part really is fully visible, or it is not the subject of the step), do not contort the page: list it with a screenshot path in `plan/progress/<your task id>.md` under 「qa-clip 误报」.

Same scope as your page task (your page folders + your progress file). One browser at a time; never pkill browsers; every script needs a hard timeout. Stop your preview and delete your build dir at the end. No git state changes.

Final reply ≤ 60 words: per page — clean / remaining count / false positives reported.
