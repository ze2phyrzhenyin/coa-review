---
name: coa-look
description: 在真实浏览器里验收一个页面：功能、手机、回退、网址、动效逐帧。页面任务做完后由 evaluator 使用；implementer 自查时也可以用。
---
1. 构建并起预览：`VITE_SHOW_PLANNED=1 pnpm -s exec vite build --outDir .local/qa-dist && pnpm -s exec vite preview --outDir .local/qa-dist --host 127.0.0.1 --port <端口>`。
2. 自动项：`PORT=<端口> node scripts/qa-pages.mjs <编号>` 和 `node scripts/qa-navigation.mjs`。
3. 手动项用 Playwright 脚本做，手机 390×844 和桌面 1280×800 各一遍，截图存 `evals/look/<编号>/`：
   - 从头走到尾，每一步截一张稳定后的图。
   - 每个预测题答对一次、答错一次，看答错时有没有演后果和指路。
   - 中途刷新、回退、复制网址到新窗口，画面是否相同。
   - 试一试：改参数，改成边界值和非法值。
   - 练习做一题，故意错一步，看指出的是不是那一步。
   - 关键转场取 5 帧（0、25、50、75、100%），对照 `docs/INTERACTION.md` 动效标准的 10 条逐条写结论。
   - 系统设为减少动态效果再走一遍。
4. 打开截图看：手机上的字读得清吗，任何一步停下来像不像一张排好版的插图。
5. 导出页面给学生看的全部文字，交给 student 角色做变式题。
6. 写 `evals/look/<编号>/report.md`：`plan/features.json` 的每条 `accept` 一行，通过或不通过加证据。全部通过才把 `passes` 置为 true，`evidence` 写报告路径。
