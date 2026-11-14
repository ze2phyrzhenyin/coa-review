# 3-cache-perf：命中率、平均访问时间、访问效率引擎

困惑：h、t_a、e、r 怎么互相求。学完能按例 3.4 的顺序正向求 e 和 t_a，由 t_a 反求 h，由 e 反求 h；能算二级 cache 的总 CPI（例 3.8）。
教材依据：3.6.1，p101–102，式(3.4)–(3.6)，例 3.4；习题 9、10（p122–123）；3.6.5 例 3.8（p110）。解析书分析题 13（p41）先求 t_a 的顺序。
代码：`src/engines/cacheperf/model.ts`，入口 `run(params)`；另有 `validateParams`、`compute(params)`（各量的数值）、`generate(seed)`。

## 参数（按 `kind` 分四种）

| `kind` | 其余参数 | 求 |
|---|---|---|
| `正向` | `nc`、`nm`（次数，非负整数，和 > 0）或 `h`（0–1）；`tc`、`tm`（ns，0 < tc < tm）；`order` 为 `例3.4`（缺省）或 `先求ta` | h、r、e、t_a |
| `由ta求h` | `tc`、`tm`、`ta`（tc ≤ ta ≤ tm，tc < tm） | h、r、e |
| `由e求h` | `e`（1/r ≤ e ≤ 1）和 `r`（> 1），或 `e` 和 `tc`、`tm` | h（给了 tc 再求 t_a） |
| `二级cache` | `clockGHz`、`baseCpi`、`memoryNs`、`l1Miss`、`l2Ns`、`l2Miss`（缺失率写小数，0 ≤ l2Miss ≤ l1Miss ≤ 1） | 两种 CPI 和性能比 |

## 要求

1. 公式只用教材的：h = Nc/(Nc+Nm)（3.4）；t_a = h·t_c + (1−h)·t_m（3.5）；r = t_m/t_c，e = t_c/t_a = 1/[r + (1−r)h]（3.6）。
2. `正向` 的 `例3.4` 顺序：h → r → e（用 1/[r+(1−r)h]）→ t_a = t_c/e。`先求ta` 顺序：h → t_a（式 3.5）→ e = t_c/t_a → r。给 `h` 时第一步写出给定值。
3. `由ta求h`：由式 (3.5) 解出 h = (t_m − t_a)/(t_m − t_c) → r → e = t_c/t_a。
4. `由e求h`：没给 r 时先求 r → 由 e = 1/[r+(1−r)h] 解出 h = (r − 1/e)/(r − 1) → 给了 t_c 时 t_a = t_c/e。
5. `二级cache`（例 3.8 的顺序）：时钟周期 = 1/clockGHz ns → 主存缺失损失 = memoryNs × clockGHz 个周期 → 只有一级时 CPI = baseCpi + l1Miss × 主存损失 → 二级缺失损失 = l2Ns × clockGHz 个周期 → 两级时 CPI = baseCpi + l1Miss × 二级损失 + l2Miss × 主存损失 → 性能比 = 一级 CPI ÷ 两级 CPI。
6. 每求一个量一步，全部 `explain`；状态的键与 `result` 相同，该量从 null 变成数值。给定的量（如 `由e求h` 的 r）只列在条件里，不算一步。`why` 写出代入的数。
7. 显示：h、r、CPI、性能比最多 4 位小数去掉末尾 0；e 和缺失率写百分数，1 位小数，去掉末尾 0；时间带 ns。`why` 里算式写不尽时用「≈」，`result` 和解题表只写数值。
8. `table` 列为 量 | 公式 | 代入 | 结果，每个量一行，指回该步。`result` 的键：`正向`、`由ta求h`、`由e求h` 用 h、r、e、t_a 中求出的那些；`二级cache` 用 时钟周期、主存缺失损失、一级CPI、二级缺失损失、两级CPI、性能比。
9. `compute` 返回不经格式化的数值，键与 `result` 相同，页面判分用它。
10. 预测题：`正向` 的 e 步问「e 是多少」（数字，答案为百分数去掉 %，1 位小数）。

## 场景

- WHEN Nc = 1900、Nm = 100、t_c = 50、t_m = 250 THEN h = 0.95，r = 5，e = 83.3%，t_a = 60 ns。
- WHEN 同一组数用 `先求ta` THEN t_a 先于 e 求出，数值相同。
- WHEN t_c = 40、t_m = 200、t_a = 50 THEN h = 0.9375。
- WHEN 例 3.8 的数 THEN 主存损失 500 周期，一级 CPI 11，二级损失 25 周期，两级 CPI 4，性能比 2.75。
- WHEN t_a 小于 t_c THEN `run` 抛出错误。

## 性质

1. 正向求出的 e 与 t_c/t_a 相等（误差 1e−9），t_a 在 [t_c, t_m] 内。
2. 正向求出的 t_a 代回 `由ta求h` 得到原来的 h；e 代回 `由e求h` 也得到原来的 h。
3. 两种顺序得到相同的数值。
4. 二级 cache 时，l1Miss × l2Ns ≤ (l1Miss − l2Miss) × memoryNs 则两级 CPI 不大于一级 CPI。
5. 同样的参数得到同样的 Trace，`validateTrace` 为空。

固定用例：`evals/golden/cacheperf-book.json`：例 3.4（p101–102）、习题 9、10（自行推算）、例 3.8（p110）、本站自拟 4750/250/20/120。
不做：逐级累加的平均访问时间模型（习题 22、解析书分析题 15），TLB 的有效访问时间（见 3-vm-addr）。

## 待确认

- 例 3.8 的性能比书上写约 2.8，这里给 2.75，页面按 2 位有效数字也接受 2.8。
