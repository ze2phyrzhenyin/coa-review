# 5-spacetime 时空图与性能指标（引擎 `src/engines/pipeline/spacetime.ts`）

困惑：时空图怎么画，周期数怎么数。学完能给 k、n、Δt（或各段时间）画出时空图，写出 Tk、Ck、Tp 的代入过程。

教材依据：5.6.1，p183–186（图 5.33、图 5.35，Tk、Ck、Tp 公式）；例 5.4，p186–187；习题 13，p202。梳理见 `docs/textbook/ch04-05.md`「流水线」。

## 要求

1. 入口 `runSpacetime(params)`；`spacetimeFigures(params)` 只算数；`generateSpacetime(seed)` 出题。
2. 参数：段数 k（2–8）、条数 n（1–24）、段名（缺省 k=4 为 IF ID EX WB，k=5 为 IF ID EX MEM WB，其余 S1…Sk）；时钟周期 `dt` 与各段时间 `stageTimes`（可带缓冲寄存器延时 `latch`）必须给且只给一个；画法 `layout` 为「段为行」或「指令为行」。
3. 时钟周期：等长时就是 Δt；不等长时必须是 max{τi}+τl（p185）。
4. 第一步定时钟周期（`explain`）；然后每个时钟周期一步（`cycle`），第 i 条在第 t 个周期处在第 t−i+1 段；`state.phase` 标填充、稳定、排空（图 5.35）。
5. 之后三步 `explain`：Tk=k+(n−1)；Ck；Tp=n/(Tk·τ)，单位 MIPS，并说出最大吞吐率 1/τ（p186）。
6. Ck：等长时 n·k/Tk，写成「40/12 ≈ 3.33」；不等长时非流水时间取各段时间之和乘 n（例 5.4 不含缓冲寄存器），并给出单个任务的加速比 Στi/τ（例 5.4 的口径）。
7. 状态：`clock`、`cycle`、`grid[段][周期]`（指令号或 null）、`done`、`phase`、`figures`。
8. `trace.table`：段为行时第一列是段名，从上到下 WB…IF（纵轴自下而上，图 5.33）；指令为行时每行一条指令，格里填段名（表 5.3）。每行指回该段或该指令第一次出现的周期步。
9. `result`：时钟周期、Tk、流水用时、非流水用时、加速比Ck、吞吐率Tp、最大吞吐率；不等长时加单个任务的加速比。
10. 预测题：第 k 个周期结束时完成几条（n ≥ 2）、Tk、Ck（两位小数）。

## 场景

- WHEN k=5、n=8、Δt=100 ns THEN Tk=12，Ck「40/12 ≈ 3.33」，Tp ≈ 6.67 MIPS。
- WHEN 各段 70/60/90/80 ns、τl=10 ns THEN 时钟周期 100 ns，单个任务的加速比 3。
- WHEN k=3、n=5 THEN 七个周期的阶段依次是 填充、填充、稳定、稳定、稳定、排空、排空。
- WHEN 同时给 dt 和 stageTimes THEN 抛出错误。

## 性质

1. Tk=k+n−1，与逐周期挪动的参照一致，每一格相同。
2. 每条指令在每段恰好出现一次；最后 done=n。
3. 等长时 Ck<k（n=1 时 Ck=1），n 增大 Ck 严格增大。
4. `validateTrace` 为空；同参数同 Trace。

## 固定用例

`evals/golden/pipeline-spacetime.json`：习题 13 的数值（五段、8 条、100 ns）、图 5.33(c)、例 5.4 两问、一个自出的三段例子。

## 不做

超标量（图 5.33(d)、例 5.7，留给 5-superscalar）、非线性流水线、效率 E（书里没有）。

## 待确认

- 解析书 析16 把 Ck 算成 40/16=2.5，与教材公式不符；按教材写 40/12。
- 各段时间不等时，非流水时间不含缓冲寄存器（照例 5.4 的 300 ns）。
