# 5-hazard 数据相关判别（引擎 `src/engines/pipeline/hazard.ts`）

困惑：RAW、WAR、WAW 怎么分。学完能对几条指令写出各自的读、写集合，用三条交集规则判断每一对的相关类型，并说出哪一对在按序五段流水线里真会读错。

教材依据：5.6.3，p189–192（RAW/WAR/WAW 的定义、表 5.4、例 5.6、例 5.7）；习题 16，p202。梳理见 `docs/textbook/ch04-05.md`「5.6.3 相关」。

## 要求

1. 入口 `runHazard({ instructions })`，2–6 条；`hazards(params)` 只算结果；`classifyPair`；`generateHazard(seed)`。
2. 指令写法按 5.6 节：三地址目标在最前（`ADD R1,R2,R3` 是 R2+R3→R1），两地址结果回到第一个寄存器（`ADD R2,R1`），`LAD R1,A` 读 M(A)，`STO M(x),R3` 写 M(x)。也可以直接给 `{ text, reads, writes }`。看不懂的写法必须抛出错误。
3. 先每条指令一步（`instruction`），写出读集合、写集合；再每一对（i<j）一步（`explain`），写出后读∩前写、后写∩前读、后写∩前写三个交集和结论；最后一步说明在五段按序流水线里哪几对会读错。
4. 类型：交集非空就算，一对可以有几种，写成「RAW、WAW」；都空写「无」。
5. 会读错：只看寄存器的 RAW；第 i 条第 i+4 个周期写回、第 j 条第 j+1 个周期读，写回的下一个周期才读得到（表 5.4，p191）；中间有别的指令再写同一个寄存器时以最近的那条为准。WAR、WAW 在按序流水线里不出错。
6. 状态：`instructions[]`（写法、含义、读、写）、`pairs[]`（i、j、三个交集、wrong）、`current`。
7. `trace.table`：指令对｜后读∩前写（RAW）｜后写∩前读（WAR）｜后写∩前写（WAW）｜相关，每行指回那一对的步。
8. `result`：每一对「I1–I2」的类型，加「会读错」。
9. 预测题：相邻的对，最多三次，选择题，选项含「无、RAW、WAR、WAW」和正确答案。

## 场景

- WHEN `ADD R1,R2,R3`、`SUB R4,R1,R5` THEN RAW，会读错。
- WHEN `STO M(x),R3`、`ADD R3,R4,R5` THEN WAR，不会读错。
- WHEN `MUL R3,R1,R2`、`ADD R3,R4,R5` THEN WAW。
- WHEN `LAD R6,B`、`MUL R6,R7` THEN RAW、WAW。

## 性质

1. 每对的类型与「箭头左读右写」的参照一致。
2. 对数等于 n(n−1)/2。
3. 「会读错」与逐拍走五段流水线的参照一致；WAR、WAW 不标读错。
4. `validateTrace` 为空；同参数同 Trace。

## 固定用例

`evals/golden/pipeline-hazard.json`：例 5.6 三组、表 5.4、例 5.7 六条的相邻对。

## 不做

资源相关和控制相关的判别（控制相关只有概念）、寄存器重命名、乱序执行下 WAR/WAW 的处理。

## 待确认

- 存储单元写成 M(x)，按名字比较；`(R3)` 这类间接地址不解析。
- 两地址的写法（例 5.7）结果在第一个寄存器，与模型机 `ADD Rx,Ry`（结果在 Ry）相反；引擎只按 5.6 节。
