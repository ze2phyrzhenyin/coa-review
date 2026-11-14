# 可借鉴的开源项目和库

核对日期 2026-11-14。数据来源：

- GitHub API：LICENSE 文件正文、默认分支最近一次提交、stars、主要语言。
- Gitee：仓库接口和 so.gitee.com 搜索。
- npm registry：版本、license、peerDependencies、engines。
- jsDelivr 上的发布文件：体积，整包未摇树，gzip -9。
- 项目页面和官方文档。

「未验证」表示今天没有打开到一手材料。日期是默认分支最近一次提交。

许可证分两类。可以拷代码（保留版权声明）：MIT、BSD、ISC、Apache-2.0。不能直接拷进私有仓库：GPL、LGPL、AGPL、MPL（文件级 copyleft）、CC-BY-SA、没有许可证。

## 1. 计算机组成教学工具

### 模型机、指令周期、微程序

- MARIE.js: 累加器型教学机的浏览器模拟器，寄存器组成和白中英模型机最接近。[仓库](https://github.com/MARIE-js/MARIE.js)，MIT，2026-04-15，174 stars，TypeScript + Svelte。可借: `src/marie.ts`（1313 行）的数据模型，寄存器是 PC/AC/IR/MAR/MBR/IN/OUT，每条指令是一个 `MicroStep[]`，每个微步返回带类型的 `Action`（RegisterTransfer、MemoryRead、MemoryWrite、Decode、IncrementPC 等），有 `microStepBack()` 回退和 RTL 日志面板。采用: 借数据模型，对应本站「微操作 + 控制信号」的 trace 记录；界面是 Svelte，不搬。
- WepSIM: 微程序控制的教学处理器，带中断、异常、系统调用示例。[仓库](https://github.com/wepsim/wepsim)，LGPL-3.0，2026-11-06，70 stars，JavaScript/HTML。可借: 微程序和汇编两层联动的呈现方式，中断处理的演示流程。只参考: LGPL-3.0；webpack 单体，体量大。
- emulsiV: RISC-V 精简核 Virgule 的可视化模拟器。[仓库](https://github.com/ESEO-Tech/emulsiV)，MPL-2.0，2026-10-02，341 stars，JavaScript。可借: 一条指令拆成 fetch、decode、ALU、mem/reg、PC 几步，在数据通路图上做数据传送动画。只参考: MPL-2.0 拷文件就要公开对该文件的修改。
- mpm-simulator: 图尔库大学讲义里抽象微程序机（MPM）的 React 模拟器。[仓库](https://github.com/jani-heinikoski/mpm-simulator)，没有 LICENSE 文件（README 只有 MIT 徽章），2025-02-20，2 stars，JavaScript。可借: 无。只参考: 许可证不成立，项目小。
- CPU-Electron: 中文课程设计，以一条微指令为最小单位单步执行，可回退。[仓库](https://github.com/recallfuture/CPU-Electron)，没有许可证，2019-12-26（已归档），3 stars，JavaScript（Vue 2 + Electron）。可借: 无。只参考: 没有许可证。
- VonSim: 仿 8088 的汇编教学模拟器，有 PIC 硬件中断和时钟、开关、LED、打印机外设。[仓库](https://github.com/vonsim/vonsim)，AGPL-3.0，2026-09-25，81 stars，TypeScript。可借: 中断控制器和外设的演示安排。只参考: AGPL-3.0。
- Simple 8-bit Assembler Simulator: x86 风格的 8 位机，256 字节内存。[仓库](https://github.com/Schweigi/assembler-simulator)，没有 LICENSE 文件，README 里贴了 MIT 全文（Copyright 2015 Marco Schweighauser），2015-08-20，988 stars，JavaScript。可借: 8 位 CPU、4 个通用寄存器、256 字节内存的最小规模设定；界面今天没有打开。只参考: 2015 年后没有提交，寄存器机和教材模型机不同。
- COP3000: 伟福 COP2000 实验仪的微指令级虚拟机，输出指令集表、微指令集表、程序执行跟踪结果。[仓库](https://github.com/i-Pear/COP3000)，GPL-3.0，2022-12-22，17 stars，Python。可借: 「按微指令周期逐行输出跟踪表」和本站可打印步骤表是同一种产物，可以对照它的列。只参考: GPL-3.0。
- parse_cop2000_ins_to_table: 解析 COP2000 的 INS 文件，导出指令系统表和 uM 微程序表两个 CSV。[仓库](https://github.com/WqVoon/parse_cop2000_ins_to_table)，MIT，2021-03-05，15 stars，Python。可借: 两张表的表头。只参考: 针对 COP2000 的二进制格式，和教材模型机无关。
- CPU Visual Simulator: [仓库](https://github.com/cpuvisualsimulator/cpuvisualsimulator.github.io)只有构建产物（build、index.html、manual.html、resources），没有许可证，2023-05-10，10 stars。功能「未验证」。不采用: 没有源码可读。
- nand2tetris web-ide: Hack 平台工具链的网页版。[仓库](https://github.com/nand2tetris/web-ide)，MIT（LICENSE 注明基于 Stefano Volpe 的 Nand2Tetris Tools 和 Aviv Yaish 的 NAND IDE，这两个上游的许可证未验证），2026-11-10，246 stars，TypeScript。可借: 模拟器、界面、命令行评分分包；用 `.tst` 脚本重放测试。只参考: Hack 机器和教材模型机不同。
- CPUlator: [页面](https://cpulator.01xz.net/)没有源码链接和许可证声明，按闭源处理。不采用。
- SonicRV: 林茨大学 ICS 的 RISC-V 网页模拟器。[about 页](https://sonic-rv.ics.jku.at/about)没有仓库链接和许可证，引用了一篇 IEEE Access 2026 论文。只参考: 只能看成品。

### 流水线与数据通路

- Ripes: RISC-V 可视化模拟器，带流水线时空图和 cache 模拟。[仓库](https://github.com/mortbopet/Ripes)，MIT，2026-11-11，3484 stars，C++/Qt（ripes.dk 有 WebAssembly 版）。可借: `src/pipelinediagrammodel.cpp` 的时空图模型，`src/cachesim/` 和 `docs/cache_sim.md`。采用: 读算法后用 TypeScript 重写，并拿它的网页版做人工对照；C++/Qt 代码不能直接用。
- QtRvSim: 布拉格捷克理工的 RISC-V 教学模拟器。[仓库](https://github.com/cvut/qtrvsim)，GPL-3.0，2026-10-29，651 stars，C++。可借: README 目录里的外设、中断与 CSR、系统调用章节可作讲解顺序参考。只参考: GPL-3.0。
- WebRISC-V: 五级流水线数据通路的网页模拟环境。[仓库](https://github.com/Mariotti94/WebRISC-V)，BSD-3-Clause，2026-05-25，183 stars，PHP。可借: 流水线数据通路图的画法。只参考: 服务端 PHP，和静态站不合。
- HDCPU: 中文的 RISC-V 多周期和五级流水线可视化。[仓库](https://github.com/H3MMM/HDCPU)，MIT，2026-07-13，4 stars，TypeScript（React 19 + Zustand）。可借: 数据通路由 JSON 配置驱动（`src/config/multicycle-datapath.json`、`pipeline-datapath.json`），按快照高亮部件和连线；点击历史周期回到该状态；`src/engine/__tests__` 有浮点表示和浮点运算测试。采用: 借「配置驱动数据通路图」的做法；stars 少，代码要自己读过再定。
- EECS 370 simulators: 密歇根大学课程用的网页模拟器。[页面](https://vhosts.eecs.umich.edu/370simulators/)，作者 Harrison Davis、Satish Narayanasamy，没有许可证声明和源码链接。[cache 模拟器](https://vhosts.eecs.umich.edu/370simulators/cache/simulator.html)已打开: 9 位地址，可配块大小、组数、每组块数，LRU，`ld`/`st`/`for` 指令序列，Verify Step 按钮，好坏两种二维数组遍历预设。流水线模拟器「未验证」。只参考: 没有源码。

### Cache、虚存

- UW CSE351 Cache Simulator: [页面](https://courses.cs.washington.edu/courses/cse351/cachesim/)，没有许可证声明和源码链接。可借: 参数范围（地址 4–12 位、cache 8–256 字节、块 2–8 字节、1/2/4 路、写命中和写缺失策略、LFU/LRU/随机/FIFO）；step-by-step 模式高亮变化；history 是可编辑、可粘贴的文本，用来回到某个状态。只参考: 没有源码。
- OSTEP homework: 《Operating Systems: Three Easy Pieces》配套模拟器。[仓库](https://github.com/remzi-arpacidusseau/ostep-homework)，没有 LICENSE 文件，2026-01-13，3328 stars，Python。可借: `vm-paging` 目录用 paging-linear-translate.py 出地址翻译练习，README 的 TLB 一章是让学生自己写代码；脚本内容今天没有读。只参考: 没有许可证。
- GitHub 上 JS/TS 的 cache、页表、TLB 模拟器: 2026-11-14 搜 `cache simulator`（TypeScript、JavaScript）、`tlb simulator`、`page table simulator`、`virtual memory simulator`，每个查询按 stars 看前 8–10 条，JS/TS 结果最多 3 stars；搜索结果的许可证字段里有 GPL-3.0（emavgl/JSCacheSimulator、ammoradi/cache-simulator）和 CC-BY-SA-4.0（Kim-Hammar/cache_simulator），这三个的 LICENSE 正文未读；其余大多没有许可证，包括结构较完整的 sohambagchi/cache-simulator（`src/engine` 下有 addressing、replacement、simulateStep 及测试）。不采用: 没有成熟项目，这两个引擎自己写。

### 数的表示与运算

- float-toy: IEEE 754 位模式玩具。[仓库](https://github.com/evanw/float-toy)，没有 LICENSE 文件，README 也没写许可证，2020-01-26，199 stars，JavaScript。可借: 点位格翻转，十六进制和十进制输入框同步，16/32/64 位三行并排。只参考: 没有许可证。
- float.exposed: [页面](https://float.exposed/)，页脚 Copyright © 2026 Bartosz Ciechanowski，页面只加载 `Float.js`，没有仓库链接和许可证。可借: half/bfloat/float/double 切换；位模式、在有效数与指数范围里的位置、二进制和十进制求值式、精确十进制值、到相邻可表示数的差。只参考。
- integer.exposed: [页面](https://integer.exposed/)，Wizard Zines 的项目，没有仓库链接。可借: 8/16/32/64 位宽；`+`、`-`、`<<`、`>>`、`>>>`、`~` 操作；有符号、无符号、二进制、十六进制四个读数。只参考。第三方重写 [doekman/integer.exposed](https://github.com/doekman/integer.exposed) 没有许可证。
- ieee754-visualization: [仓库](https://github.com/bartaz/ieee754-visualization)，没有 LICENSE 文件，README 写 Copyright 2013 Bartek Szopka、MIT，2014-02-17，310 stars，JavaScript。只参考: 2014 年后没有提交。
- HowCalculator: 原码一位乘法、补码一位乘法、存储器线数、数制和码制转换的过程计算器。[仓库](https://github.com/ZZHow1024/HowCalculator)，GPL-3.0，2025-06-04，3 stars，JavaScript（React）。可借: 题型清单；页面今天没有打开。只参考: GPL-3.0。
- Booth、除法步骤可视化: 搜 `booth algorithm visualizer`、`booth multiplication`，结果全部 0 stars。不采用: 自己写。

### 数字逻辑（门级）

- CircuitVerse: [仓库](https://github.com/CircuitVerse/CircuitVerse)，MIT，2026-11-03，1293 stars，JavaScript。只参考: 门级电路编辑器，超出本站范围。
- DigitalJS: [仓库](https://github.com/tilk/digitaljs)，BSD-2-Clause，2026-02-10，787 stars，JavaScript。只参考: 阵列乘法器如果要画到门级，可以看它的电路渲染；目前用不到。
- Digital-Logic-Sim: [仓库](https://github.com/SebLague/Digital-Logic-Sim)，MIT，2025-05-05，4753 stars，C#。不采用: 桌面程序。
- Digital: [仓库](https://github.com/hneemann/Digital)，GPL-3.0，2026-10-08，6166 stars，Java。不采用。
- logisim-evolution: [仓库](https://github.com/logisim-evolution/logisim-evolution)，GPL-3.0，2026-11-13，7939 stars，Java。不采用。

### 时序图、位域图

- WaveDrom: WaveJSON 文本生成 SVG 时序图。[仓库](https://github.com/wavedrom/wavedrom)，MIT，2026-10-25，3521 stars，JavaScript；npm wavedrom 3.8.0，min 53 KB，gzip 19 KB。可借: 总线仲裁、中断响应、DMA 的时序图。不采用（备选）: 时序图多于三四张时再引入，只在该页懒加载；能否在构建期用 Node 直接出 SVG「未验证」。
- bit-field: `[{bits, name}]` 生成寄存器位域 SVG。[仓库](https://github.com/wavedrom/bitfield)，MIT，2026-10-25，396 stars，JavaScript；npm bit-field 1.11.0。可借: 输入格式，用来描述指令格式。只参考: 指令格式图是几个矩形，自己画。

### 中文同类项目

- coe-lab: 408 计算机组成原理的交互实验台，有数据表示、Cache 地址映射、指令执行周期、五级流水线、I/O 三方式。[仓库](https://gitee.com/CaiSre/coe-lab)（Gitee），MIT（LICENSE 已读，Copyright 2026 CaiSre），2026-11-08，0 stars，TypeScript（Next.js 16 + React 19）。可借: `src/lib/step-player.ts` 的 `useStepPlayer<T>(steps)`，步骤数组换新就回到第 0 步；`VisualStep<TState> = {state, note, activeSignals, metrics, codeLine?}`；空格、`←`/`→`、`R` 快捷键，输入框有焦点时让出；localStorage 版本化键加跨标签同步；README 逐个写明实验模型的边界。采用: 借步骤结构和交互约定。它的 Cache 实验不维护访问历史，指令周期只演示固定的 LOAD，这两块本站要做完整。
- cs-knowledge: 操作系统、组成原理、算法的分步讲解站。[仓库](https://github.com/QMangoJ/cs-knowledge)，代码 MIT，README 称 `content/` 为 CC BY 4.0，2026-11-07，0 stars，TypeScript（Next.js 静态导出）。可借: `src/lib/schema.ts` 用 zod 校验每一步（id、title、tldr、body、mistake、keyFields，画布状态是判别联合，`registers[].changed` 标记变化）；`LabState.cases` 要求交互实验复现正文里的固定算例；来源登记在 `content/sources.yaml`，每条引用带出处位置、核对状态、核对人和核对日期；`budget.json` 限制步骤页首屏 JS gzip 200 KB。采用: 借 schema 设计和算例校验。
- struct-viz: 408 四科算法可视化。[仓库](https://github.com/xiaweiyi713/struct-viz)，没有 LICENSE 文件，package.json 没有 license 字段，2026-10-02，23 stars，TypeScript（React 19、D3、Framer Motion、Monaco）。可借: `src/core/algorithms/` 下有 booth.ts、ieee754.ts、floatArithmetic.ts、cacheMapping.ts、cacheFullyAssoc.ts、pipeline.ts；booth.ts 把 A、Q、Q-1 拆成逐位数组，每步记一次状态（只读了开头 60 行）。只参考: 没有许可证，依赖重。
- cs408（408Lab）: 408 刷题站。[仓库](https://github.com/43aquarius/cs408)，LICENSE 是 MIT 加一段附注：题库和笔记只供个人备考交流，许可证只覆盖源码，2026-10-10，22 stars，TypeScript（Next.js 16）。可借: 逐选项讲解的题目结构、错题本；README 提到流水线时空图动画组件，组件源码未读。只参考: 题库内容不能拷，Next.js + Prisma 架构不同。
- 408-visual-lab: 每题一个独立 HTML 页面的动画合集。[仓库](https://github.com/zzuli-ljz/408-visual-lab)，MIT，2026-11-05，4 stars，HTML。组成原理目录下目前只有 memory-hierarchy.html。只参考: 内容少。
- computer-organization-learning-platform: 按唐朔飞第 3 版组织的学习平台，README 列出寄存器传送级、加法器/ALU、存储器读写、总线仲裁、指令流水线、中断处理 6 个模拟器。[仓库](https://github.com/wangdada8208/computer-organization-learning-platform)，根目录没有 LICENSE 文件，README 的 MIT 徽章指向不存在的文件，README 末尾贴了 MIT 文字和版权行，2026-06-21，1 star，JavaScript。可借: 总线仲裁、中断处理两个模拟器的选题。只参考: 许可证文件缺失，模拟器都在一个 `simulators.js` 里。
- cscp: 用 Java 对象搭计算机部件的学习项目。[仓库](https://gitee.com/cikema/cscp)（Gitee），接口标 GPL-2.0（LICENSE 正文未读），2024-05-11，2 stars，Java。不采用。
- 白中英模型机: 没有找到针对白中英教材模型机或其微程序控制器的模拟器。2026-11-14 的查询，GitHub: 「白中英」「白中英 模型机」「白中英 模拟器」「计算机组成原理 模拟器」「计算机组成原理 模型机」「模型机 模拟器」「模型机 微程序」「微程序 模拟」「微程序控制器」「微程序控制器 模拟器」「计组 模拟器」「计组 可视化」「计算机组成原理 可视化」「Cache 模拟器」「唐朔飞」「COP2000」「TEC-8 模拟」；Gitee: 「计算机组成原理 模拟器」「微程序 模拟器」「微程序控制器」「模型机」「组成原理 模型机」「白中英」「计组 可视化」「计算机组成原理 可视化」「计算机组成原理 仿真」「Cache 模拟器」「补码 乘法」「流水线 时空图」。每个查询只看了前 8–12 条，单字命中的无关仓库很多，stars 为 0 的小项目可能漏掉。Gitee 上「微程序控制器」命中的是 Proteus 和 Logisim 电路工程，例如 [proteus-logic-computer](https://gitee.com/lai-xiaozheng/proteus-logic-computer)（搜索结果标 MIT，2021-03-04，19 stars）。

建议: 模型机和微程序引擎按 MARIE.js 的「指令是微步数组，微步产出带类型的动作」来写，播放器和步骤结构照 coe-lab，cache 和流水线拿 Ripes 对照；WepSIM、QtRvSim、VonSim 只看不拷；门级模拟器全部跳过。

## 2. 步进式讲解的界面与库

- @preact/signals: [仓库](https://github.com/preactjs/signals)，MIT，2026-11-12，4504 stars，TypeScript；npm 2.11.4，peer preact >= 10.25 或 11；signals-core min 5 KB，gzip 2 KB。可借: trace 下标、输入参数、预测答案各一个 signal，当前步用 `computed` 派生。采用。
- preact-iso: [仓库](https://github.com/preactjs/preact-iso)，MIT，2026-10-27，251 stars，JavaScript；npm 2.12.2，无依赖。有 Router、lazy、hydrate、prerender，`useLocation().query` 读查询参数。采用: 路由、预渲染、URL 参数在同一个包里。
- XState: [仓库](https://github.com/statelyai/xstate)，MIT，2026-11-14，30461 stars，TypeScript；npm 5.33.4，UMD min 46 KB，gzip 14 KB。不采用: 播放器的状态只有步骤数组、下标、是否在答题，一个 30 行左右的 reducer 就够；引擎是生成 trace 的纯函数，用不到状态机运行时。
- nuqs: [仓库](https://github.com/47ng/nuqs)，MIT，2026-11-10，10906 stars，TypeScript；npm 2.10.3，peerDependencies 只有 next、react、react-router、remix、tanstack router。不采用: 只支持 React 系框架。URL 状态用 preact-iso 的 `useLocation().query` 加一个 `URLSearchParams` 序列化函数。
- scrollama: [仓库](https://github.com/russellsamora/scrollama)，MIT，2025-11-13，6015 stars；npm 3.2.0（2022-06-17 发布），min 4 KB，gzip 2 KB。不采用: 本站靠按钮和键盘步进，不靠滚动触发；要滚动触发时直接用 IntersectionObserver。
- Idyll: [仓库](https://github.com/idyll-lang/idyll)，MIT，2022-07-15，2041 stars，JavaScript；npm 6.0.0-alpha.6（2022-04-22 发布）。不采用: 停更，React 体系。
- algorithm-visualizer: [仓库](https://github.com/algorithm-visualizer/algorithm-visualizer)，MIT，2023-11-18，49495 stars，JavaScript。可借: 算法代码只产出可视化指令，渲染器只消费指令的分层。只参考: 2023 年后没有提交；本站的 trace 是数据表，比它简单。
- View Transitions API: 浏览器内置。web-features 3.46.0 的数据: 同文档 view transitions 是 Baseline newly available（2025-10-14 起，Chrome 111、Safari 18、Firefox 144）；跨文档 view transitions 还不是 Baseline（没有 Firefox）。采用: 步骤切换包一层 `document.startViewTransition`，不支持的浏览器直接换内容。
- motion: [仓库](https://github.com/motiondivision/motion)，MIT，2026-11-13，35122 stars，TypeScript；npm 14.14.0。[官方文档](https://motion.dev/docs/quick-start)称 mini 版 HTML/SVG `animate()` 为 3.2 kb；完整 `dist/motion.js` 187 KB，gzip 63 KB。不采用（暂时）: 先用 CSS transition 和 Web Animations API；需要编排多段动画时再加，只引 `animate`。
- anime.js: [仓库](https://github.com/juliangarnier/anime)，MIT，2026-08-09，74597 stars，JavaScript；npm 4.5.0，UMD min 115 KB，gzip 39 KB，`dist/modules` 可按模块引入。不采用: 理由同上，整包比 motion 的 mini 版大。
- GSAP: [仓库](https://github.com/greensock/GSAP)没有 LICENSE 文件，package.json 的 license 字段是 `Standard 'no charge' license`，2026-11-04，30593 stars，JavaScript；npm 3.15.1，min 71 KB，gzip 27 KB。[许可证页](https://gsap.com/community/standard-license/)（生效 2025-04-30，修改 2025-05-30）: 免费，含商用；禁止用在和 Webflow 竞争的无代码可视化动画工具里；禁止为做竞品而逆向；Webflow 可以改条款；终止后要销毁副本。不采用: 不是开源许可证。
- KaTeX: [仓库](https://github.com/KaTeX/KaTeX)，MIT，2026-11-03，20519 stars，TypeScript；npm 0.19.1；katex.min.js 266 KB，gzip 74 KB；katex.min.css 24 KB，gzip 3 KB；`dist/fonts` 里看到的 woff2 每个 7–28 KB。`katex.renderToString` 可以在 Node 里出 HTML。采用: 只在构建期调用，页面带 CSS 和用到的字体，不带 JS。
- Temml: [仓库](https://github.com/ronkok/Temml)，MIT，2026-10-08，360 stars，JavaScript；npm 0.14.0；temml.min.js 163 KB，gzip 48 KB；CSS 9 KB；Temml.woff2 9 KB。输出 MathML Core；MathML 在 web-features 里是 Baseline widely available（各主流浏览器自 2023-01-12 起都支持）。README 写明 Chromium 用系统字体时有渲染问题，配 Latin Modern（380 KB）更好。不采用（备选）: 体积最小，但各浏览器的渲染差异要自己看过才能定。
- MathJax: [仓库](https://github.com/mathjax/MathJax-src)，Apache-2.0，2026-07-03，2415 stars，TypeScript；npm 4.1.3；tex-mml-chtml.js 974 KB，gzip 274 KB。不采用: 体积。
- rough.js: [仓库](https://github.com/rough-stuff/rough)，MIT，2023-11-20，21377 stars；npm 4.6.6，27 KB，gzip 8 KB。不采用: 手绘风格和教材图不搭。
- svg.js: [仓库](https://github.com/svgdotjs/svg.js)，LICENSE.txt 是 MIT 条款，2026-08-04，11922 stars，JavaScript。不采用: Preact 里直接写 SVG JSX。
- d3-shape: [仓库](https://github.com/d3/d3-shape)，ISC，2026-11-03，2534 stars，JavaScript；npm 3.2.1。不采用（备选）: 只在需要曲线连线时引入。
- perfect-arrows: [仓库](https://github.com/steveruizok/perfect-arrows)，MIT，2022-06-09，2848 stars，TypeScript；npm 0.3.7。可借: 两点、两框之间箭头路径的算法。只参考: 停更。
- leader-line: [仓库](https://github.com/anseki/leader-line)，MIT，2025-04-11（已归档），3245 stars。不采用。
- elkjs: [仓库](https://github.com/kieler/elkjs)，LICENSE.md 是 EPL 2.0，npm license 字段 `EPL-2.0 OR GPL-3.0-or-later`，2026-11-09，2896 stars；npm 0.12.1，解包 8 MB。不采用: 数据通路图是固定布局，用不到自动布局；许可证和体积都不合适。

建议: 运行时只加 @preact/signals 和 preact-iso；动画用 CSS 加 View Transitions；公式在构建期用 KaTeX 转好，随输入变化的式子用组件拼（位格、`<sup>`、`<sub>`），不走 TeX；XState、nuqs、scrollama、GSAP、MathJax 都不要。

## 3. 引擎正确性

- fast-check: 属性测试库。[仓库](https://github.com/dubzzz/fast-check)，MIT，2026-11-13，5253 stars，TypeScript；npm 4.10.2，依赖 pure-rand ^8。可借: 补码加减和乘除法对照 BigInt；IEEE 754 编码对照 DataView 往返；cache 命中数对照朴素实现；trace 最后一步等于直接计算的结果。采用。
- @fast-check/vitest: 同仓库；npm 0.5.0，MIT，peer vitest ^4.1 或 ^5。[文档](https://fast-check.dev/docs/tutorials/setting-up-your-test-environment/property-based-testing-with-vitest/): 可选，提供 `test.prop`；失败后用报告里的 seed 配 `fc.configureGlobal({ seed })` 重放。采用。
- Vitest: [仓库](https://github.com/vitest-dev/vitest)，MIT，2026-11-13，17374 stars，TypeScript；npm 5.1.0，peer vite ^6.4、^7、^8，Node ^22.12、^24 或 >= 26。采用。
- StrykerJS: 变异测试。[仓库](https://github.com/stryker-mutator/stryker-js)，Apache-2.0，2026-10-29，3368 stars，TypeScript；npm @stryker-mutator/core 10.1.1、@stryker-mutator/vitest-runner 10.1.1（peer vitest >= 2，Node >= 22）。[文档](https://stryker-mutator.io/docs/stryker-js/vitest-runner/)写明的限制: 不支持 Browser Mode；只支持 threads；`coverageAnalysis` 被忽略，固定 perTest；强制单 worker，首个失败即停；`vitest.related` 默认开，只跑和变异文件相关的测试。采用: 可选，`mutate` 限定在 `src/engine/**`，按需或每周跑。耗时随变异数和相关测试时长增长，本仓库的实际耗时未测。
- JS 内置类型: Float32Array、Float64Array、DataView 读写 IEEE 754 位模式，`Math.fround` 取单精度舍入，BigInt 和 `BigInt.asIntN`/`asUintN` 做任意位宽补码。语言内置，今天没有另查文档。采用: 作为各引擎的对照实现，零依赖。
- Berkeley TestFloat: [仓库](https://github.com/ucb-bar/berkeley-testfloat-3)，COPYING.txt 是 BSD 三条款（The Regents of the University of California），2025-03-07，80 stars，C。可借: 生成 float32 加减的测试向量存成夹具，核对舍入和特殊值。不采用（暂时）: 要本地编译 C；先用内置类型对照，出现分歧再用。
- Berkeley SoftFloat: [仓库](https://github.com/ucb-bar/berkeley-softfloat-3)，COPYING.txt（只读了开头，Release 3e，John R. Hauser），2026-11-03，365 stars，C。可借: 对阶、规格化、舍入的参考实现。只参考。
- cache 对照数据: Ripes 的 `src/cachesim/`（MIT）读过后写一个独立的朴素实现；UW CSE351 模拟器的 history 文本可以手工录几组做黄金用例；教材例题和习题答案是最直接的夹具。CS:APP cachelab 的 trace 文件「未验证」，今天没有打开，许可证不明。
- 教材格式: 阶码和尾数用补码的非 IEEE 浮点、变形补码、原码除法的恢复余数法和加减交替法，没有找到现成参考实现。用 BigInt 做有理数算出精确值，再和引擎结果比。

建议: Vitest、fast-check、@fast-check/vitest 进 CI；每个引擎配一个不共享代码的朴素对照实现；Stryker 只对 `src/engine/**` 定期跑；TestFloat 留到出现分歧时。

## 4. 练习与间隔重复

- ts-fsrs: FSRS 调度器的 TypeScript 实现。[仓库](https://github.com/open-spaced-repetition/ts-fsrs)，MIT，2026-11-13，872 stars，TypeScript；npm 6.0.0（2026-10-28 发布），engines Node >= 24，依赖 @open-spaced-repetition/srs-kit 1.0.0（BSD-3-Clause），默认 FSRS-7，入口是 `await DefaultScheduler()`；UMD 193 KB，gzip 39 KB。上一条线 5.4.2 的 engines 是 Node >= 20。不采用（暂时）: 期末复习只有几周，题目是参数化生成的，FSRS 面向长期记忆固定卡片。先写 Leitner 盒：答错的题型隔 1、3、7 天再出，约 40 行。要做长期复习时再引入并懒加载。
- idb-keyval: [仓库](https://github.com/jakearchibald/idb-keyval)，Apache-2.0（LICENCE 文件），2026-07-08，3256 stars，TypeScript；npm 6.3.0，无依赖，UMD 4 KB，gzip 1 KB。采用: 可选，存做题记录这类会增长的数据。
- idb: [仓库](https://github.com/jakearchibald/idb)，ISC，2026-10-06，7441 stars，TypeScript；npm 8.0.4，UMD 3 KB，gzip 1 KB。不采用（备选）: 需要按题型、按日期做索引查询时，用它替换 idb-keyval。
- Dexie: [仓库](https://github.com/dexie/Dexie.js)，Apache-2.0，2026-11-09，14689 stars，TypeScript；npm 4.4.7，min 94 KB，gzip 30 KB。不采用: 没有复杂查询。
- localStorage: 进度是几 KB 的 JSON。coe-lab 的做法够用：版本化键、storage 事件跨标签同步、保存失败时降级。采用。
- PrairieLearn: [仓库](https://github.com/PrairieLearn/PrairieLearn)，LICENSE: 社区版 AGPL-3.0，客户端 JS 明确为 AGPL，另有企业版目录，2026-11-13，531 stars，TypeScript。可借: 题目按参数生成变体、逐项判分的设计；具体的 generate/grade 接口「未验证」。只参考: AGPL。
- js-parsons: Parsons 题（把打乱的片段排回正确顺序）的库。[仓库](https://github.com/js-parsons/js-parsons)，MIT，2018-02-03，99 stars，JavaScript。可借: 排序题的判分和反馈，可用于微操作序列题。只参考: 2018 年后没有提交。
- Runestone（rs）: [仓库](https://github.com/RunestoneInteractive/rs)，LICENSE 是 MIT 加例外项（第三方 CSS/JS、商业组件 Handsontable、两本教材正文），2026-11-10，71 stars，TypeScript。只参考: 例外项多，整套是课程平台。
- pure-rand: 可设种子的随机数库。[仓库](https://github.com/dubzzz/pure-rand)，MIT，2026-11-13，119 stars，TypeScript；npm 8.4.2。不采用（备选）: 出题用的种子随机数自己写 mulberry32，10 行。
- 判分方式（设计建议，没有来源）: 题目是 trace 的某一步遮住若干字段；比对前规范化（去空格、补前导零、十六进制大小写、定点数的小数点位置）；一步一分；某步答错时，后续步骤按学生的中间值重算再比，避免一步错全错。

建议: 题目直接从 trace 生成，不引题库框架；进度用 localStorage，做题记录用 idb-keyval；间隔重复先用 Leitner，ts-fsrs 留到确实要做长期复习时。

## 5. 静态站

- @preact/preset-vite: [仓库](https://github.com/preactjs/preset-vite)，MIT，2026-07-18，311 stars，TypeScript；npm 2.10.6，peer vite 2–8，依赖 vite-prerender-plugin ^0.5.8。`prerender` 选项有 `enabled`、`renderTarget`、`additionalPrerenderRoutes`、`previewMiddlewareEnabled`；入口导出 `prerender()`，返回 `html`、`links`、`head`（lang、title 等）；会沿页面里的链接自动爬取。采用。
- vite-prerender-plugin: [仓库](https://github.com/preactjs/vite-prerender-plugin)，MIT，2026-09-26，67 stars，JavaScript；npm 0.5.14，peer vite 5–8。采用: 随 preset 带入。
- preact-render-to-string: [仓库](https://github.com/preactjs/preact-render-to-string)，MIT，2026-11-12，731 stars，JavaScript；npm 6.8.3。采用: preact-iso 的 peer 依赖。
- vite-ssg: [仓库](https://github.com/antfu-collective/vite-ssg)，MIT，2026-02-05，1579 stars；npm 28.3.0。不采用: 仓库描述是 Static site generation for Vue 3 on Vite。
- Vike: [仓库](https://github.com/vikejs/vike)，MIT，2026-11-12，5838 stars，TypeScript；npm 0.4.270。不采用: 是一整套框架，preset 自带的预渲染已经够。
- Astro: [仓库](https://github.com/withastro/astro)，MIT，2026-11-13，63937 stars，TypeScript；npm 7.4.12。不采用: 用它等于换架构；本站交互页占多数。
- vite-plugin-pwa: [仓库](https://github.com/vite-pwa/vite-plugin-pwa)，MIT，2026-10-09，4312 stars，TypeScript；npm 2.0.0（2026-10-03 发布），peer vite ^3.1 到 ^8、workbox-build ^7.4.1、workbox-window ^7.4.1，Node >= 20.19；README 列出对 Preact 的新内容提示支持。采用: 放第二阶段。上线后再加，更新提示要做，否则 service worker 会让用户停在旧版本。
- Workbox: [仓库](https://github.com/GoogleChrome/workbox)，MIT，2026-09-02，13048 stars，JavaScript；workbox-build 7.4.1。采用: 随 vite-plugin-pwa 带入。
- 系统字体栈: 无依赖，零下载。采用: 正文用系统中文字体；位串和地址用 `ui-monospace` 等宽栈，开 `font-variant-numeric: tabular-nums`。
- cn-font-split: 把中文字体按字符分包成多个 woff2 加 unicode-range。[仓库](https://github.com/KonghaYao/cn-font-split)，Apache-2.0，2026-06-12，1262 stars，Rust（WASM/FFI）；npm 7.4.3，解包 6 MB；配套 vite-plugin-font 5.1.2（Apache-2.0）。不采用（暂时）: 决定用自带中文字体时才需要。
- 思源黑体、思源宋体: [source-han-sans](https://github.com/adobe-fonts/source-han-sans)，OFL-1.1，保留字体名 Source，2025-06-18，17461 stars；[source-han-serif](https://github.com/adobe-fonts/source-han-serif)，OFL-1.1，2024-07-30，9837 stars。按 OFL，子集化和转格式后的文件是修改版，不能再用保留名，CSS 里的 font-family 要另起名字；Adobe 是否另有豁免「未验证」。不采用。
- 霞鹜文楷: [仓库](https://github.com/lxgw/LxgwWenKai)，OFL-1.1，2026-11-12，27016 stars。OFL.txt 有附加许可：只为网页分发做子集或转 WOFF/WOFF2 的版本可以继续用保留名，前提是不作为可安装的桌面字体提供。不采用（备选）: 要用楷体做例题手写感时再考虑，配 cn-font-split。
- Noto CJK: [仓库](https://github.com/notofonts/noto-cjk)根目录没有 LICENSE（GitHub 识别为无许可证），`Sans/LICENSE` 是 OFL-1.1，2024-09-19，4153 stars；npm @fontsource/noto-sans-sc 5.3.1 标 OFL-1.1，解包 72 MB。不采用。
- JetBrains Mono: [仓库](https://github.com/JetBrains/JetBrainsMono)，OFL-1.1，2025-01-31，13170 stars。不采用（备选）: 等宽数字要跨平台一致时用；拉丁字体小，不需要分包。
- Paged.js: [仓库](https://github.com/pagedjs/pagedjs)，MIT，2026-10-20，1566 stars；npm 0.4.3（2023-07-06 发布），解包 5.7 MB。不采用: 步骤表只需要 `@media print`、`break-inside: avoid`、`thead { display: table-header-group }`、`print-color-adjust: exact`。web-features: page-breaks 是 Baseline widely available（各主流浏览器自 2019-01-29 起都支持），print-color-adjust 是 newly available（2025-05-01 起）。

建议: 预渲染用 @preact/preset-vite 自带的 prerender 加 preact-iso；字体用系统栈，不下载中文字体；打印用纯 CSS；PWA 放第二阶段。

## 6. 无障碍与质量检查

- @axe-core/playwright: [仓库](https://github.com/dequelabs/axe-core-npm)，MPL-2.0，2026-11-06，737 stars，JavaScript；npm 4.14.0，peer playwright-core >= 1。[Playwright 文档](https://playwright.dev/docs/accessibility-testing)的用法: `new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()`，并写明自动检测只能发现一部分问题，其余要人工检查。采用: 只作 devDependency，不改它的源文件，MPL 不影响本仓库代码。
- axe-core: [仓库](https://github.com/dequelabs/axe-core)，MPL-2.0，2026-11-13，7818 stars；npm 4.14.0。采用: 随上一项带入。
- Playwright: [仓库](https://github.com/microsoft/playwright)，Apache-2.0，2026-11-13，100124 stars，TypeScript；npm @playwright/test 1.65.1，Node >= 20。[视觉对比文档](https://playwright.dev/docs/test-snapshots): `toHaveScreenshot()` 的基线存在测试文件旁的 `-snapshots` 目录，文件名带浏览器和平台（如 chromium-darwin），建议在生成基线的同一环境里跑；有 `maxDiffPixels`、`threshold`、`stylePath`。采用: 截图只在一个固定环境（CI 容器）里生成和比较；每个引擎挑 2–3 个固定步骤截图；键盘走查（`←`/`→`、空格、`R`）也用它。
- Lighthouse CI: [仓库](https://github.com/GoogleChrome/lighthouse-ci)，Apache-2.0，2026-11-12，7144 stars，JavaScript；npm @lhci/cli 0.16.1，内含 lighthouse 13.6.0。`collect.staticDistDir` 指向构建目录，自动发现页面。采用: 给性能、无障碍、SEO 分数设断言。
- Unlighthouse: 整站扫描，带界面。[仓库](https://github.com/harlan-zw/unlighthouse)，MIT，2026-10-23，4949 stars；npm 0.19.1。不采用（备选）: 上线后偶尔 `npx` 跑一次，不进依赖。
- pa11y-ci: [仓库](https://github.com/pa11y/pa11y-ci)，LGPL-3.0，2026-11-01，647 stars，JavaScript。不采用: 和 axe 重复。

建议: 用 Playwright 一套工具做端到端、axe 扫描和少量截图对比；Lighthouse CI 用 staticDistDir 跑预渲染产物；Unlighthouse 和 pa11y 不进依赖。

## 建议的依赖清单

版本于 2026-11-14 用 `npm view` 核对，都是当天的 latest。

运行时，进浏览器：

- preact 11.2.0（MIT；`dist/preact.mjs` 12 KB，未压缩）
- @preact/signals 2.11.4（MIT）
- preact-iso 2.12.2（MIT）
- idb-keyval 6.3.0（Apache-2.0，可选）

构建：

- vite 8.3.8（MIT；Node ^20.19 或 >= 22.12）
- @preact/preset-vite 2.10.6（MIT；带入 vite-prerender-plugin）
- preact-render-to-string 6.8.3（MIT）
- typescript 7.0.2（Apache-2.0）
- katex 0.19.1（MIT；只在预渲染时调用，页面带 katex.min.css 和用到的 woff2）
- vite-plugin-pwa 2.0.0（MIT；第二阶段）

测试：

- vitest 5.1.0（MIT）
- fast-check 4.10.2、@fast-check/vitest 0.5.0（MIT）
- @playwright/test 1.65.1（Apache-2.0）、@axe-core/playwright 4.14.0（MPL-2.0）
- @lhci/cli 0.16.1（Apache-2.0）
- @stryker-mutator/core 10.1.1、@stryker-mutator/vitest-runner 10.1.1（Apache-2.0；可选）

没有验证的地方：

- 这些版本之间只核对了 peerDependencies 和 engines，没有装在一起跑过。Vitest 5.1.0 要 Node ^22.12、^24 或 >= 26，Stryker 要 Node >= 22，项目按 Node 24 定。
- typescript 的 latest 是 7.0.2，6.x 线最新是 6.0.3。除类型检查外依赖 TypeScript API 的工具（lint、Stryker 的类型检查插件）对 7.x 的支持「未验证」。
- preact 的 latest 是 11.2.0；preact-iso 和 @preact/signals 的 peer 范围都包含 11，实际运行未测。

自己写，不引依赖：trace 播放器、各引擎、出题和判分、URL 参数序列化、Leitner 调度、SVG 图、打印样式、种子随机数。

## 只参考不拷贝

- LGPL-3.0：WepSIM、pa11y-ci。
- GPL：QtRvSim、Digital、logisim-evolution、HowCalculator、COP3000（GPL-3.0），cscp（GPL-2.0），JSCacheSimulator、ammoradi/cache-simulator（GPL-3.0）。
- AGPL-3.0：VonSim、PrairieLearn。
- MPL-2.0：emulsiV。axe-core 也是 MPL-2.0，作为测试工具使用没有问题，不要拷它的源文件。
- CC-BY-SA-4.0：Kim-Hammar/cache_simulator。
- EPL-2.0：elkjs。
- 非开源的免费许可：GSAP。
- 没有任何许可证：float-toy、struct-viz、OSTEP homework、CPU-Electron、CPU Visual Simulator、sohambagchi/cache-simulator、doekman/integer.exposed；mpm-simulator 的 README 只有 MIT 徽章，没有许可证正文。
- 没有源码或没有声明：float.exposed、integer.exposed、EECS 370 simulators、UW CSE351 Cache Simulator、CPUlator、SonicRV。
- 许可证只写在 README、没有 LICENSE 文件：computer-organization-learning-platform（徽章链接指向不存在的文件）、ieee754-visualization、Simple 8-bit Assembler Simulator。要拷之前先存一份当日 README。
- 代码许可证可用，内容不可拷：cs408 的题库和笔记；cs-knowledge 的 `content/`（CC BY 4.0，引用要署名）。
- 字体：思源系列有保留字体名 Source，子集化后要改 font-family 名；霞鹜文楷的网页子集豁免以不提供可安装桌面字体为前提。
- 许可证可用但架构不合，只读思路：Ripes（C++/Qt）、WebRISC-V（PHP）、Digital-Logic-Sim（C#）、CircuitVerse、DigitalJS、nand2tetris web-ide（上游许可证链未核实）、algorithm-visualizer。MARIE.js 的界面是 Svelte，只借 `src/marie.ts` 的数据模型。
