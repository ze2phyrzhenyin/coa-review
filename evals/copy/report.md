# 去 AI 味：文案检查报告（2026-11-15）

范围：`src/pages/**`、`src/engines/**`、`src/app/**`、`src/player/**`、`src/content/glossary.ts`、`src/content/pages.ts`、`index.html`、`README.md` 里学生看得见的字。`3-cache-run`、`5-cycle` 两个目录只写了建议，没有动文件。

现有文字大部分已经是平实的写法，所以改动不多。只改措辞，没有改事实、数、记号、术语、键名和测试标识。

## 数量

- 改了 25 个文件、36 处字符串。
- 建议未落地：`evals/copy/pending-3-cache-run.md` 4 条，`evals/copy/pending-5-cycle.md` 3 条。
- 没有改任何测试期望，没有动 `evals/golden/`。

改过的文件：`src/content/glossary.ts`；引擎 `cpu/model.ts`、`hardwired/flow.ts`、`ieee/model.ts`、`overflow/model.ts`、`serial/model.ts`；页面 `2-ieee/break.ts`、`2-ieee/lesson.ts`、`2-mul/break.ts`、`2-overflow/scene.ts`、`3-cache-addr/index.tsx`、`3-cache-perf/scene.ts`、`3-vm-addr/scene.ts`、`3-vm-replace/index.tsx`、`3-vm-replace/scene.ts`、`4-ea/scene.ts`、`5-flow/scene.ts`、`5-micro/scene.ts`、`5-spacetime/index.tsx`、`5-spacetime/scene.ts`、`5-stall/index.tsx`、`5-stall/quiz.tsx`、`6-arbiter/index.tsx`、`6-arbiter/scene.ts`、`8-intr/scene.ts`。

## 改前 → 改后（15 例）

1. `glossary.ts` 操作控制器：按指令和节拍发出各个控制信号，让数据通路一步步动起来。→ 按指令和节拍发出各个控制信号。
2. `glossary.ts` 访问效率：越接近 1，说明平均起来越接近只访问 cache。→ e 越接近 1，t_a 越接近 t_c。
3. `glossary.ts` 物理地址、有效地址：主存单元真正的地址 → 主存单元的地址（有效地址同样去掉「真正的」）。
4. `2-overflow/scene.ts`：S_f1 才是结果真正的符号。→ 结果的符号看 S_f1。
5. `2-mul/break.ts`：…按无符号读，比绝对值大了一截。→ 负数补码的数值位按无符号读是 2^N − |x|，阵列拿到的不是绝对值。
6. `2-ieee/break.ts`：…比原来大 1，数整整变成 2 倍。→ …比原来大 1，数变成 2 倍。
7. `2-ieee/break.ts`：存的时候拿掉、读的时候补上，两头配对。→ 存的时候拿掉、读的时候补上。
8. `4-ea/scene.ts`：硬件不会报错，程序只是悄悄算错了。→ 硬件不报错，程序算出的结果是错的。
9. `engines/cpu/model.ts`（两条提示）：想一想访问数存时，地址由哪个寄存器保持。→ 看访问数存时地址由哪个寄存器保持。
10. `5-flow/scene.ts`：…总线上的值是乱的，打入 AR、DR 的都不对。方框数必须等于 DBUS 要送数的次数。→ …总线上的值不确定，打入 AR、DR 的都不对。
11. `engines/serial/model.ts`：一秒里排了「波特率」那么多个位，每一位占的时间是波特率的倒数。→ 一秒传的位数等于波特率，每一位占的时间是它的倒数。
12. `5-spacetime/index.tsx`：时空图画完，下面三个数就能直接读出来。→ 总周期数、加速比、吞吐率都从时空图上读。
13. `6-arbiter/index.tsx`：…却总在坏点停下；这就是链式查询「对电路故障敏感」的意思（教材 p212）。→ …却总在坏点停下。链式查询对电路故障敏感（教材 p212）。
14. `3-cache-perf/scene.ts` 结论：删掉开头的「四个量靠三条式子连着：」，直接从 h = N_c/(N_c + N_m) 写起。
15. `3-vm-addr/scene.ts` 最后一步的「为什么」：删掉收尾的「每一行都可以照解题表的版式写在卷子上。」

另有一处不是措辞：`5-stall/index.tsx:40` 去掉了「下一个周期」外面的加粗标签（规则：段落里不加粗）。

## 留下的 warn（107 条，改前 110）

- `common.arrow` 69 条：都是记号。数据通路（`PC → ABUS(I) → 指存`）、寄存器传送（`R1×R3→R2`）、微命令名（`R1→X`）、参数值（`十进制→机器数`）、处理次序（`L2→L0→L3→L1`）、「旧值 → 新值」。`src/player/demo-trace.ts` 的 3 条也是传送记号。
- `common.spaced-dash` 19 条：地址范围、位范围、时间范围（`0000H–1FFFH`、「尾数第 a–b 位」）。
- `zh.steps2` 14 条：都是真实的操作次序（先位扩展再字扩展、先访存取地址再访存取操作数、先按 OP 再按 Cy 修改、写回法先写回再调入等）。
- `zh.colon-slogan` 4 条：`P1：用 OP 修改`、`脉冲：与 M·T` 是表里的标签，两条「弄坏它：…」是按钮名。
- `common.deco` 1 条：`3-vm-replace/scene.ts:68`「（✓ 是命中）」是窄屏表格的图例。

## 有意没改的

- 「127，不是 128」「是存放 EA 的单元，不是 EA」「丢进位和溢出是两回事」：否定的那一半是学生真会犯的错。最后一句还被 `src/engines/overflow/model.test.ts:45` 按原文断言。
- 引擎 `ask.prompt` 里的问号：是真的提问，页面场景按其中的子串匹配，显示时已去掉问号。
- `src/content/pages.ts` 的页面标题：是学生问的那句话，没有改。
- `src/player/Gallery.tsx`：开发用的部件陈列页，学生看不到，没有改。

## 被固定用例卡住的字符串

没有。要改的字符串都不在 `evals/golden/` 里。

## 遗留

- `evals/look/2-mul/steps.md:1062`、`evals/look/2-overflow/steps.md:617` 的验收记录还引着改前的两句话，没有动。
- 两份 pending 建议要等那两个目录的修改结束后再落地。

## 检查结果

- `pnpm -s exec vitest run`（全量）通过。
- `node scripts/lint-copy.mjs src`：0 error，107 warn。
- `node scripts/lint-terms.mjs src`：terms ok。
- `node scripts/check-originality.mjs`：originality ok。
- `pnpm -s exec tsc --noEmit`：通过。
- 没有在浏览器里看页面，改动只涉及字符串。
