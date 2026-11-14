/**
 * 全站共用的术语表。术语卡（src/app/TermCard.tsx）从这里取一句定义和教材页码。
 * 定义用自己的话写，一句，不超过 70 字；记号写成 S_f1、2^6 这样，显示时排成上下标。
 * ref 是教材（戴志涛、白中英《计算机组成原理》第七版）的页码；page 是本站讲它的页面编号。
 * 用法见 docs/DESIGN.md「术语卡」。
 */
export interface GlossaryEntry {
  /** 术语本身，也是查找用的键。 */
  term: string;
  /** 页面里可能出现的别的写法，查找时也认。 */
  aka?: string[];
  def: string;
  /** 教材页码，如 'p37–38'。 */
  ref: string;
  /** 本站讲这个术语的页面编号。 */
  page?: string;
}

export const glossary: GlossaryEntry[] = [
  // 第 2 章：变形补码与溢出
  { term: '真值', def: '带正负号直接写出来的数，如 −0011。和它相对的是机器里的编码，叫机器数。', ref: 'p24', page: '2-overflow' },
  { term: '机器数', aka: ['机器码'], def: '数在机器里的编码，正负号也用 0、1 表示，如 [x]补。', ref: 'p24' },
  { term: '定点整数', def: '小数点固定在最低位右边的数，只有整数部分。最左一位是符号位。', ref: 'p24–25' },
  { term: '补码', aka: ['[x]补'], def: '正数照写，负数写成「模加上这个数」。这样减法可以当加法做，符号位也直接参加运算。', ref: 'p25' },
  { term: '模', def: '一组位能表示的状态总数。n 位数值加 1 位符号的定点整数补码，模是 2^(n+1)；超出模的进位丢掉，值不变。', ref: 'p25' },
  { term: '符号位', def: '机器数里表示正负的位，0 为正，1 为负，放在数值位左边。', ref: 'p24' },
  { term: '数值位', def: '符号位右边表示数的大小的那些位。', ref: 'p24' },
  {
    term: '变形补码',
    aka: ['[x]变补'],
    def: '用两个符号位的补码：正数写 00，负数写 11。两个符号位都参加相加，结果的两个符号位不同就是溢出。',
    ref: 'p37–38',
    page: '2-overflow',
  },
  { term: '溢出', def: '运算结果超出了这个位数能表示的范围，留下的位和正确的结果不同。', ref: 'p37', page: '2-overflow' },
  { term: '正溢', def: '结果大于能表示的最大正数。只有两个正数相加（或正数减负数）才会发生。', ref: 'p37', page: '2-overflow' },
  { term: '负溢', def: '结果小于能表示的最小负数。只有两个负数相加（或负数减正数）才会发生。', ref: 'p37', page: '2-overflow' },
  {
    term: 'S_f1、S_f2',
    aka: ['S_f1', 'S_f2', '最高符号位', '第二符号位'],
    def: '变形补码结果的两个符号位。S_f1 是最高符号位，溢出时也表示结果的正负；S_f2 是紧挨数值位的那一位。',
    ref: 'p38',
    page: '2-overflow',
  },
  { term: '溢出标志 V', aka: ['V'], def: '判溢出电路的输出，V = 1 表示溢出。变形补码里 V = S_f1 ⊕ S_f2。', ref: 'p38', page: '2-overflow' },
  {
    term: 'C_0、C_f',
    aka: ['C_0', 'C_f'],
    def: 'C_0 是最高数值位送进符号位的进位，C_f 是符号位再送出去的进位。单符号位判法：V = C_f ⊕ C_0。',
    ref: 'p38',
    page: '2-overflow',
  },
  { term: '异或', aka: ['⊕', '按位加'], def: '两位不同得 1，相同得 0，记作 ⊕。教材也叫逻辑异、按位加。', ref: 'p55' },

  // 第 3 章：cache 逐次访问
  { term: 'cache', def: '放在 CPU 和主存之间的小而快的存储器，存着主存里正在用的那些块的副本。', ref: 'p100', page: '3-cache-run' },
  { term: '块', def: '主存和 cache 之间一次搬运的单位。主存一侧叫块，记 B_j，j 是块号。', ref: 'p102', page: '3-cache-run' },
  { term: '行', def: 'cache 里能放下一块的位置，记 L_i。同样大小的数据，在主存一侧叫块，在 cache 一侧叫行。', ref: 'p102', page: '3-cache-run' },
  { term: '块号', def: '主存块的编号 j。按字编址时，块号等于地址除以每块的字数后取整。', ref: 'p102–103', page: '3-cache-run' },
  { term: '字地址', def: '地址最低的一段，指出要的字是块里的第几个字。', ref: 'p102', page: '3-cache-run' },
  { term: '标记', def: '每一行都存着的一段地址，记下这一行装的是主存哪一块。访问时拿地址里的标记来比，相同才算命中。', ref: 'p102', page: '3-cache-run' },
  { term: '行号', def: '直接映射时地址中间的一段，等于块号 j mod m，指出这一块只能放在哪一行。', ref: 'p103–104', page: '3-cache-run' },
  { term: '组号', def: '组相联时地址中间的一段，等于块号 j mod u，指出这一块只能放进哪一组。', ref: 'p105', page: '3-cache-run' },
  {
    term: '区号',
    aka: ['区内块号'],
    def: '教材的图把主存按 cache 的行数分区。直接映射时，区号就是标记，区内块号就是行号。',
    ref: 'p104',
    page: '3-cache-run',
  },
  { term: '直接映射', def: '每个主存块只能放进一个固定的行，行号 i = j mod m（m 是行数）。不用选，也就不需要替换算法。', ref: 'p103', page: '3-cache-run' },
  { term: '全相联映射', aka: ['全相联'], def: '主存块可以放进 cache 的任意一行。比标记时要和所有行比。', ref: 'p102', page: '3-cache-run' },
  {
    term: '组相联映射',
    aka: ['组相联', '路组相联'],
    def: 'cache 分成 u 组，块只能放进第 j mod u 组，组内哪一行都行。每组 v 行就叫 v 路组相联。',
    ref: 'p105',
    page: '3-cache-run',
  },
  { term: '命中', def: '要访问的字所在的块已经在 cache 里，直接在 cache 里读写。', ref: 'p100', page: '3-cache-run' },
  { term: '缺失', aka: ['未命中'], def: '要访问的块不在 cache 里，先从主存把整块调进来。', ref: 'p100', page: '3-cache-run' },
  { term: '命中率', aka: ['h'], def: 'cache 完成的访问次数占总访问次数的比例，h = N_c / (N_c + N_m)。', ref: 'p101' },
  { term: '替换算法', def: '要调入新块而能放的行都满了时，决定换出哪一行的规则。', ref: 'p108', page: '3-cache-run' },
  {
    term: 'LRU',
    aka: ['近期最少使用'],
    def: '近期最少使用：换出最久没被访问的那一行。教材用行计数器做：命中的行清零，其余加 1，换出计数最大的。',
    ref: 'p108',
    page: '3-cache-run',
  },
  { term: '行计数器', aka: ['计数器'], def: '每行一个，替换算法靠它比较各行的使用情况。直接映射用不上它。', ref: 'p108–109', page: '3-cache-run' },
  { term: '写回法', def: '写的时候只改 cache，并把这一行的修改位置 1；这一行被换出时才写回主存。', ref: 'p109', page: '3-cache-run' },
  { term: '修改位', def: '每行一位，为 1 表示这一行改过，和主存里的那一块不一样了，换出前要先写回。', ref: 'p109', page: '3-cache-run' },
  { term: '按字编址', def: '每个地址对应一个字，地址加 1 就是下一个字。', ref: 'p72' },

  // 第 5 章：指令周期
  { term: '指令周期', def: '取出一条指令并把它执行完所用的时间，由若干个 CPU 周期组成。', ref: 'p153', page: '5-cycle' },
  { term: 'CPU 周期', aka: ['机器周期'], def: '也叫机器周期，通常取从主存读出一个指令字的最短时间。取指正好占一个 CPU 周期。', ref: 'p153', page: '5-cycle' },
  { term: '节拍', aka: ['T1–T4', '时钟周期', '节拍脉冲'], def: '处理操作的最小时间单位。教材的模型机一个 CPU 周期分 T1、T2、T3、T4 四个节拍。', ref: 'p153', page: '5-cycle' },
  { term: '取指周期', def: '每条指令的第一个 CPU 周期：按 PC 从指存取出指令送进 IR，PC 加 1，再对操作码译码。', ref: 'p10、p154', page: '5-cycle' },
  { term: '执行周期', def: '取指之后完成这条指令本身操作的 CPU 周期，不同指令的个数不同。', ref: 'p10、p155', page: '5-cycle' },
  { term: '电位信号', def: '在整个 CPU 周期里一直保持的电平，用来打开通路，如 RD(D)、C1。', ref: 'p164', page: '5-cycle' },
  { term: '脉冲信号', aka: ['打入'], def: '只在某个节拍里出现一下的信号，把总线上已经稳定的数打入寄存器，如 T3 的 LDDR。', ref: 'p164', page: '5-cycle' },
  { term: '三态门', def: '输出除了 0 和 1 还有高阻。门关着时等于从总线上断开，所以一条总线上同一时刻只开一道门。', ref: 'p60', page: '5-cycle' },
  { term: 'DBUS', aka: ['数据总线'], def: '模型机的数据总线。除取指外，数和地址都经它传送，一次只能传一个值。', ref: 'p156', page: '5-cycle' },
  { term: '指存、数存', aka: ['指存', '数存'], def: '模型机有两个存储器：指存放指令，数存放数据。取指走 ABUS(I) 和 IBUS，不占 DBUS。', ref: 'p151', page: '5-cycle' },
  { term: 'PC', aka: ['程序计数器'], def: '程序计数器，存着下一条要取的指令在指存里的地址，每取一条加 1。', ref: 'p151', page: '5-cycle' },
  { term: 'IR', aka: ['指令寄存器'], def: '指令寄存器，存着正在执行的指令，分操作码和地址码两段。', ref: 'p151', page: '5-cycle' },
  { term: 'AR', aka: ['数据地址寄存器'], def: '数据地址寄存器，存着要访问的数存单元的地址，经 ABUS(D) 送到数存。', ref: 'p151', page: '5-cycle' },
  { term: 'DR', aka: ['数据缓冲寄存器'], def: '数据缓冲寄存器，先接住 DBUS 上的数，再送进通用寄存器。', ref: 'p151', page: '5-cycle' },
  { term: 'PSWR', aka: ['程序状态字寄存器'], def: '程序状态字寄存器，存运算结果的标志，如进位。', ref: 'p151', page: '5-cycle' },
  { term: '通用寄存器', aka: ['R0–R3'], def: 'R0、R1、R2、R3，存操作数和结果。用哪一个由指令里的寄存器字段决定。', ref: 'p151', page: '5-cycle' },
  { term: '操作码、地址码', aka: ['操作码', '地址码'], def: '指令分两段：操作码说做什么，地址码给出操作数或它的地址。', ref: 'p127' },
  { term: '指令译码器', def: '读 IR 里的操作码，认出是哪一条指令，交给操作控制器。', ref: 'p151', page: '5-cycle' },
  { term: '操作控制器', def: '按指令和节拍发出各个控制信号，让数据通路一步步动起来。', ref: 'p152', page: '5-cycle' },
  { term: 'ALU', def: '算术逻辑运算部件，做加、取反这类运算，结果经 C1 送上 DBUS。', ref: 'p150', page: '5-cycle' },
];

const index = new Map<string, GlossaryEntry>();
for (const entry of glossary) for (const key of [entry.term, ...(entry.aka ?? [])]) if (!index.has(key)) index.set(key, entry);

/** 按术语或别名查。 */
export function findTerm(key: string): GlossaryEntry | undefined {
  return index.get(key.trim());
}
