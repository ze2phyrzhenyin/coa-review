# 5-cycle 模型机指令周期（引擎 `src/engines/cpu`）

困惑：LAD 为什么比 ADD 多一个 CPU 周期。学完后，学生拿到模型机的一条指令，能排出每个 CPU 周期里谁上总线、谁接收、发什么信号。

教材依据：5.1–5.2 节，p150–162（图 5.1、图 5.5–5.13、图 5.15）；节拍 p178 图 5.30；信号名 p179 例 5.3、p181 表 5.2；解析书 p85–86 图 5.14–5.17。梳理见 `docs/textbook/ch04-05.md`「模型机」。

## 要求

1. 机器必须是图 5.1 的结构：PC、IR、AR、DR、R0–R3、PSWR、ALU，指存和数存分开，总线 ABUS(I)、IBUS、DBUS、ABUS(D)，三态门 C1（ALU 输出）、C2（通用寄存器输出）、C3（IR 地址码）（p150）。
2. 取指必须走 PC → ABUS(I) → 指存 → IBUS → IR，不占 DBUS；PC 每次加 1（p154）。
3. DBUS 同一时刻必须只有一个驱动者：C1、C2、C3、数存读出端四者至多开一个（p156）。
4. 运算结果和数存读出的数必须经 DR 才进通用寄存器；访存地址必须先进 AR（p156–157）。
5. 指令必须按教材的写法和含义：`MOV Rx,Ry`（Ry→Rx）、`NOT Rx,Ry`（Ry 取反→Rx）、`LAD Rx,A`（数存 A 号单元→Rx）、`ADD Rx,Ry`（Rx+Ry→Ry）、`STO Rx,(Ry)`（Rx→数存 (Ry) 号单元）、`JMP A`（A→PC）。`format`、`meaning` 给出写法和箭头含义，页面两样都显示。
6. CPU 周期数必须是：MOV、NOT、ADD、JMP 两个，LAD、STO 三个（p161）。
7. 每条指令的微操作必须按教材圈号的顺序，一个微操作一步；节拍按图 5.30：取指 T1 送地址、T3 打入 IR、T4 PC+1；执行周期电位信号从 T1 起保持，T3 打入 DR 或写数存，T4 打入 AR、PC、通用寄存器。完整序列以 `evals/golden/cpu-cycles.json` 为准。
8. 步分三层：`instruction`（一条指令开始）、`cycle`（一个 CPU 周期开始，上个周期的电位信号撤掉、总线空出）、微操作。同一节拍里的第一个微操作是 `beat`，其余是 `explain`；译码是 `explain`，不占节拍（p161）。
9. 每步必须有 `title`（谁到谁）、`why`（有效的控制信号，这次传送为什么现在能做）、`ref`（教材页码）、`focus`（全部变化的位置加通路上的部件 id）。
10. 状态必须是纯数据：`reg`、`decoder`、`sel`、`alu`、`bus.*.{value,driver}`、`gate`、`imem`、`dmem`、`signals.{level,pulse}`、`timing.{instruction,addr,cycle,cycleNo,cycles,beat}`、`halted`。没装入过的寄存器和空着的总线是 null。
11. `names` 必须能在两套信号名之间切换：教材 RD(I)、LDIR、PC+1、LDPC、LDDR、LDAR、RD(D)、WE(D)、LDR0–LDR3；解析书 IR/W̄=1、SIR、SPC、SDR、SAR、DR/W̄=1、DR/W̄=0、SR0–SR3、LR0–LR3、+、SPSW。某一套里没有名字的信号不列，只在 `why` 里用话说明。两套名字下机器的行为必须相同。
12. `trace.table` 的列必须是「CPU 周期｜节拍｜操作｜控制信号」：每条指令一行标题，每个微操作一行，电位信号直接写，脉冲信号注节拍，如 `LDDR(T3)`；每行指回对应的步。
13. 预测题只放在：LAD、STO、ADD 的 CPU 周期数；取指走哪条总线；LAD 地址进 AR、数据进 DR（在第三个 CPU 周期之前问）；ALU 结果进 DR；ADD 的目标寄存器；STO 开哪个三态门、数据由数存接收；JMP 地址进 PC。同一种题一份 Trace 只问一次，答案取自引擎。
14. 停机：PC 指到没有指令的单元，或执行满 `limit` 条（默认 16，上限 64）。末尾必须有一步停机，撤掉信号。
15. `checkTransfer(state, {bus, driver})` 必须在总线已有另一个驱动者时返回 `conflict`、两个驱动者和它们的值，并用一句话说明真实硬件的后果；没有出口的部件返回 `no-path`；不改状态。
16. 字长 8 位，数和地址 0–255；数存没列出的单元读出 0。非法参数（空程序、PC 指着空单元、越界、重复地址、未知指令）必须抛出说明原因的错误。
17. 样例程序 `sampleParams()` 必须用自己的地址和数，覆盖 LAD、ADD、STO、JMP、MOV，LAD 紧挨 ADD。

## 场景

- WHEN 运行 `LAD R0,9` THEN 依次是取指、执行一（C3 开，9 上 DBUS，T4 打入 AR）、执行二（数存读出上 DBUS，T3 打入 DR，T4 打入 R0），共 3 个 CPU 周期。
- WHEN 运行 `ADD R0,R1` THEN 执行周期只有一个：选 R0、R1，ALU 加，C1 开，T3 打入 DR 并存标志，T4 打入 R1。
- WHEN 运行 `STO R1,(R3)` THEN 两个执行 CPU 周期都开 C2，第一个送 R3 的地址进 AR，第二个送 R1 的数，T3 写数存，DR 不变。
- WHEN 运行 `JMP 37` THEN 取指时 PC 加 1，执行周期 T4 被 37 盖掉。
- WHEN ALU 的结果在 DBUS 上又让 R3 上 DBUS THEN `checkTransfer` 报冲突，驱动者是 ALU 和 R3。
- WHEN 运行样例程序 THEN R0=48，R1=73，R2=73，数存 14 号单元 73，PC=38，共 12 个 CPU 周期，36 号指令没有被执行。

## 性质

1. 任意程序的最终寄存器、PC、数存、进位与朴素参照实现一致。
2. 任意一步每条总线至多一个驱动者；每个执行 CPU 周期 DBUS 恰好送一个数，取指周期 DBUS 空着。
3. `validateTrace` 为空；同样的参数得到完全相同的 Trace；回放 changes 能还原每一步。
4. 通用寄存器只在 T4 从 DR 接收；DR 只在 T3、AR 只在 T4 从 DBUS 接收；指存不变。
5. `explain` 步不换节拍，`beat` 步的节拍只往后走。

## 固定用例

- `evals/golden/cpu-cycles.json`：每条指令的 CPU 周期数、微操作顺序、两套信号名。
- `evals/golden/cpu-book-program.json`：教材表 5.1 的程序（p153–154）及图 5.6–5.13 的数值，只作测试。

## 不做

单周期数据通路、条件转移、中断和公操作里的外设请求、微程序和硬布线的逻辑表达式（留给 5-micro、5-hardwired）、其他数据通路图（5-datapath）。

## 待确认

- NOT 与 MOV：5.2.2 节正文和图 5.5–5.6 写 NOT，图 5.1、图 5.15、图 5.30、例 5.3 写 MOV。引擎两个都收，序列相同。页面默认用哪个名字，等任课教师的口径。
- MOV 的通路教材没有逐步写。引擎按「ALU 传送 → C1 → DBUS → DR」，与 NOT 相同（依据图 5.30 的 Ry→DR、DR→Rx）。
- ADD：教材 1 个执行 CPU 周期（图 5.15、5.30），解析书设计题 4 拆成 2 个（图 5.17）。引擎按教材；练习判分是否两种都认，未定。
- AND：表 5.1 列出但教材没有跟踪。引擎比照 ADD，标志只给 Z、N（C、V 置 0）。页面是否放开 AND，未定。
- PSWR：教材只说 ADD 的进位存入 PSWR。引擎同时存 C、V、Z、N；MOV、NOT 不动 PSWR。
- 取指 T4 的 LDPC：例 5.3 和表 5.2 有，解析书的取指只写 PC+1。引擎在教材名字下两个都列。
- 教材把打入通用寄存器的信号写成 LDRx、LDRy，引擎写成具体的 LDR0–LDR3。
- STO 第二个执行 CPU 周期里 AR → ABUS(D) 放在 T3 写入那一步显示；图 5.30 没有单列这个操作。
- 字长 8 位是由「10 取反得 245」推出的，教材没有明说。
