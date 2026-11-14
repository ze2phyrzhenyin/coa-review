---
name: coa-engine
description: 写或改 src/engines 下的一个引擎：纯函数，输出 Trace，带性质测试、参照对拍和固定用例。做任何计算、仿真、出答案的逻辑时使用。不用于界面。
---
1. 读规格和 `docs/textbook/` 对应章。步骤顺序、名称、表格版式跟教材。教材没讲的不加。
2. 读 `src/engines/trace.ts`。用 `TraceBuilder`：每一步只写 `title`（做了什么）、`why`（为什么能发生，用到哪条规则）、`ref`（教材页码）和对状态的修改，变化列表自动算出。
3. 状态是纯数据。位置的路径就是场景和页面引用它的 id，定了就别改名。
4. 粒度：同一拍里拆开讲的小步用 `explain`，真实的节拍、访问、CPU 周期、指令各用自己的层级。
5. 预测题 `ask` 只放在有辨别力的步骤，答案取自引擎的状态。
6. `trace.table` 是学生在纸上写的那张表，每行指回一步。`trace.result` 是题目要求的量。
7. 测试必须有：`validateTrace` 为空；同样参数得到同样的 Trace；规格里的性质（fast-check）；与朴素参照实现对拍；`evals/golden` 的固定用例。参照实现和性质最好由 tester 另写。
8. 文字用自己的话。跑 `node scripts/check-arch.mjs`、`node scripts/lint-terms.mjs src/engines/<名>`、`node scripts/check-originality.mjs`。
