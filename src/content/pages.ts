/**
 * 页面清单。侧栏、首页、qa 脚本都读这里；与 docs/PLAN.md 和 plan/features.json 的编号一致
 * （scripts/tasks.mjs validate 会核对）。
 * nav 是侧栏里的短名，title 是页面唯一的标题：学生会问的那句话，不带问号。
 */
export type Batch = 'sample' | 'first' | 'second';

export interface PageMeta {
  id: string;
  chapter: number;
  nav: string;
  title: string;
  batch: Batch;
  /** 做完并通过页面验收后才置 true；未上线的页面不出现在侧栏。 */
  live: boolean;
}

export const chapters: Record<number, string> = {
  1: '计算机系统概述',
  2: '运算方法和运算器',
  3: '存储系统',
  4: '指令系统',
  5: '中央处理器',
  6: '总线系统',
  8: '输入/输出系统',
};

const p = (id: string, nav: string, title: string, batch: Batch, live = false): PageMeta => ({
  id,
  chapter: Number(id[0]),
  nav,
  title,
  batch,
  live,
});

export const pages: PageMeta[] = [
  p('1-cpi', 'CPI 与 MIPS', 'CPI、MIPS、执行时间怎么互算', 'second'),

  p('2-codes', '原码 反码 补码 移码', '−128 为什么只有补码，补码和移码差在哪', 'first'),
  p('2-overflow', '变形补码与溢出', '01 和 10 哪个是正溢，进位丢掉算不算溢出', 'sample'),
  p('2-negate', '对 2 求补器', '找第一个 1 和取反加 1 为什么是一回事', 'second'),
  p('2-ieee', 'IEEE 754', '隐藏的 1 去哪了，E 加 127 还是 128', 'first'),
  p('2-range', '浮点数表示范围', '最大负数和最小负数分别是哪个', 'second'),
  p('2-cla', '先行进位', 'C4 怎么展开，延迟怎么数', 'second'),
  p('2-mul', '阵列乘法', '补码相乘为什么先变绝对值', 'first'),
  p('2-div', '加减交替除法', '余数为负为什么不恢复，下一步反而加', 'first'),
  p('2-alu', '74181', 'S3–S0 怎么决定运算', 'second'),
  p('2-bus3', '运算器的三种结构', '单总线为什么三步，三总线为什么一步', 'second'),
  p('2-fpadd', '浮点加减', '对阶移谁，规格化往哪边移', 'first'),
  p('2-fpmul', '浮点乘除', '移码阶相加为什么要减偏移量', 'second'),
  p('2-parity', '奇偶校验', '奇校验位取 0 还是 1', 'second'),

  p('3-expand', '存储器容量扩充', '8 片芯片为什么只要 2 位片选', 'first'),
  p('3-decode', '地址分配与译码', 'ROM、RAM 各占一段地址，译码器接哪几根线', 'first'),
  p('3-endian', '大端与小端', '0x1234 在大端和小端里怎么放', 'second'),
  p('3-refresh', 'DRAM 刷新', '集中式和分散式刷新，哪段时间不能读写', 'second'),
  p('3-interleave', '交叉存储器', '读 4 个字为什么是 T+3τ', 'second'),
  p('3-cache-addr', 'cache 地址划分', '同一个地址，三种映射各切成哪几段', 'first'),
  p('3-cache-run', 'cache 逐次访问', '主存块落到哪一行，为什么被换出', 'sample'),
  p('3-cache-perf', '命中率与访问效率', 'h、ta、e、r 怎么互相求', 'first'),
  p('3-cache-write', 'cache 写策略', '写命中、写未命中时谁被改', 'second'),
  p('3-cache-l2', '多级 cache', '加了二级 cache，CPI 怎么算', 'second'),
  p('3-vm-addr', '页式地址变换', '虚地址怎么变成物理地址', 'first'),
  p('3-vm-seg', '段式与段页式', '段式为什么是相加，段页式查几次表', 'second'),
  p('3-vm-replace', '页面替换', 'FIFO 和 FIFO+LRU 的表每一列怎么填', 'first'),
  p('3-miss-combo', 'TLB、页表、cache', '三处缺失，哪些组合不可能', 'second'),

  p('4-opcode', '扩展操作码', '扩展操作码到底留几个码', 'first'),
  p('4-format', '指令格式设计', '指令格式设计题从哪下手', 'second'),
  p('4-ea', '寻址方式', '这串十六进制指令的有效地址是多少', 'first'),
  p('4-arm', 'ARM 指令编码', 'ARM 汇编怎么变成 32 位机器码', 'second'),

  p('5-cycle', '指令周期', 'LAD 为什么比 ADD 多一个 CPU 周期', 'sample'),
  p('5-flow', '方框图与控制信号', '方框图旁边的信号怎么写，哪些要带 T', 'first'),
  p('5-datapath', '数据通路设计', '换一张数据通路图怎么排微操作', 'second'),
  p('5-timing', '时序产生器', 'T1–T4 和 CPU 周期是什么关系', 'second'),
  p('5-micro', '微程序控制器', '取指微指令怎么知道下一条去哪', 'first'),
  p('5-mfield', '微指令格式', '微指令每个字段几位，控存多大', 'second'),
  p('5-maddr', '微地址转移', '分支微地址怎么分配', 'second'),
  p('5-mgroup', '微命令分组', '相容和相斥微命令怎么分组', 'second'),
  p('5-hardwired', '硬布线控制器', 'LDDR 的逻辑表达式是怎么写出来的', 'first'),
  p('5-spacetime', '流水线时空图', '时空图怎么画，周期数怎么数', 'first'),
  p('5-hazard', '数据相关', 'RAW、WAR、WAW 怎么分', 'first'),
  p('5-stall', '停顿与定向', '相关之后停几拍，定向以后呢', 'first'),
  p('5-superscalar', '超标量', '超标量的推进图怎么排', 'second'),

  p('6-arbiter', '总线仲裁', '链式查询为什么离仲裁器近的优先', 'first'),
  p('6-timing', '总线定时', '异步读里的确认在等谁', 'second'),
  p('6-serial', '带宽与串行帧', '一帧到底几位，带宽怎么算', 'first'),

  p('8-poll', '程序查询', 'CPU 在查询循环里浪费了什么', 'second'),
  p('8-intr', '单级中断', '关中断、保存断点、保存现场，谁做、先后是什么', 'first'),
  p('8-mask', '中断屏蔽字', '改屏蔽字为什么能改处理次序', 'first'),
  p('8-im', '多级中断', '执行 B 的服务程序时 IM 为什么是 111', 'second'),
  p('8-saturate', '中断饱和时间', '链上每个设备多等多少', 'second'),
  p('8-dma', 'DMA 过程', 'DMA 请求和中断请求有什么不同', 'second'),
  p('8-dma-mode', 'DMA 传送方式', '周期挪用和透明 DMA 区别在哪', 'second'),
  p('8-dma-multi', '多路型 DMA', '两个设备同时请求先服务谁', 'second'),
  p('8-io', 'I/O 系统设计', '系统里谁拖后腿', 'second'),
];

/** 侧栏里出现的页面。构建时带 VITE_SHOW_PLANNED=1（qa 用）则列出全部。 */
export const visiblePages = (): PageMeta[] =>
  import.meta.env.VITE_SHOW_PLANNED === '1' ? pages : pages.filter((page) => page.live);
