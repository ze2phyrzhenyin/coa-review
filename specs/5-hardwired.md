# 5-hardwired 硬布线控制信号的逻辑表达式（引擎 `src/engines/hardwired/model.ts`）

困惑：LDDR=M2·T3·(MOV+ADD)+M3·T3·LAD 是怎么写出来的。学完能对模型机任一个控制信号，从指令周期流程里找出所有发它的（节拍电位、节拍脉冲、指令），写出逻辑表达式；也能反过来检查一个式子漏了哪拍、多了哪拍。

教材依据：5.5，p177–179（C=f(Im,Mi,Tk,Bj)、式(5.1)、图 5.30、例 5.3）；解析书 设11（同样的写法）。流程取自 `src/engines/cpu` 的 `flow()`（规格 `specs/5-cycle.md`）。梳理见 `docs/textbook/ch04-05.md`「(c) 硬布线控制器」。

## 要求

1. 入口 `run({ signal, instructions?, names? })` 推表达式；`runReverse({ expression, signal?, instructions?, names? })` 反查；另有 `signals`、`occurrences`、`expression`、`parseExpression`、`pointsOfExpression`、`pointsOfSignal`、`equivalent`、`generate(seed)`。
2. 指令集缺省为图 5.30 的 MOV、LAD、ADD、STO、JMP；可选模型机的任意几条（还有 NOT、AND）。信号名可选教材或解析书。
3. M1 是取指周期，M2、M3 是执行周期；每条指令的周期数、每拍的微操作和信号一律取自 `flow()`，引擎不另写一份。
4. 通用寄存器的信号写成 Rx、Ry（指令里第一个、第二个寄存器）：教材 LDRx、LDRy，解析书 SRx、SRy、LRx、LRy（图 5.30 的记法）。
5. 电位信号（`flow()` 的 hold）只与 M，脉冲信号（pulse）与 M·T（p179）。同一个 M 或 M·T 的指令相或放进括号，按指令集的顺序；所有指令都有的项不写指令；各项按 M、T 的先后排。
6. `run` 的步（都是 `explain`）：判断电位还是脉冲；每条指令一步，写出在哪个 M·T、做什么，或者不发；合并；最后写出表达式并问学生（文本，判分用 `equivalent`）。
7. `runReverse`：表达式里 · * × 是与，+ 是或，可以加括号；只认 M1–M3、T1–T4 和指令名。顶层每一项一步，列出它为 1 的（指令·M·T）和那一拍做的事；给了信号时再一步，逐拍对照流程图，列出漏掉和多出的节拍。电位信号算四拍都有效。
8. 状态：`run` 为 `signal`、`kind`、`marks`、`scanning`、`terms`、`expression`；`runReverse` 为 `terms`、`matches`、`missing`、`extra`。
9. `trace.table`：`run` 为 节拍电位｜节拍脉冲｜指令｜项，每行指回第一次找到这一项的那一步；`runReverse` 为 项｜指令｜节拍｜这一拍的操作。
10. `result`：`run` 为信号、类型、表达式；`runReverse` 为有效节拍数，给了信号再加一致、漏掉、多出。
11. 不认识的符号、括号不配对、指令集为空或重复、信号在指令集里不出现，必须抛出错误。

## 场景

- WHEN 求 LDDR THEN `M2·T3·(MOV+ADD)+M3·T3·LAD`；求 LDPC THEN `M1·T4+M2·T4·JMP`；求 RD(D) THEN `M3·LAD`。
- WHEN 反查 `M2·T3·ADD+M3·T3·LAD` 对照 LDDR THEN 漏掉 MOV·M2·T3。
- WHEN 反查 `M3·STO` 对照 WE(D) THEN 多出 T1、T2、T4 三拍（脉冲信号忘了与 T）。
- WHEN 指令集只有 MOV、ADD，求 WE(D) THEN 抛出错误。

## 性质

1. 任意指令子集、每个信号，表达式与直接读 `evals/golden/cpu-cycles.json` 信号栏的参照相同。
2. 推出的式子求值后为 1 的节拍正好是流程图上发这个信号的节拍；去掉任一项就不一致。
3. 电位信号的各项不含 T，脉冲信号的各项都含 T。
4. `validateTrace` 为空；同参数同 Trace。

## 固定用例

`evals/golden/hardwired-cases.json`：例 5.3 的十个式子（p179）、五个反查例子、方框图的方框数和 LAD 各框的信号。

## 不做

有限状态机版（表 5.2，另做）、结果反馈 Bj（模型机没有条件转移）、跳过 M3 的不定长节拍、逻辑化简到与非门、解析书 设11 的累加器机。

## 待确认

- 例 5.3 只写了十个信号；C1、C2、C3 和寄存器选择也按同样的规则推出，书上没有给式子。
- 取指 T4 同时有 LDPC 和 PC+1（例 5.3、表 5.2），与 `flow()` 一致。
