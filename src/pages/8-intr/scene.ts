/**
 * 8-intr 的台面：上面一排是 CPU 和挂在请求链上的接口（接口 0 离 CPU 最近），INTR 是公共请求线，INTA 沿链往下传；
 * 左下是 PC、IR、IM 和要保存的寄存器；中间一叠程序卡（响应时服务程序那张压上来，主程序卡角写着断点）和堆栈；
 * 右下是图 8.6 的三栏：指令周期、中断周期（硬件）、服务程序（软件），走到哪一框就填到哪一格。
 * 画面只取决于引擎 Trace 的状态。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { hex } from '../../engines/intr/model';
import type { Params, State } from '../../engines/intr/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const INTR_QUESTION = { text: '从请求到返回，关中断、保存断点、保存现场、开中断各由谁做，先后怎样', at: ['hw', 'sw'] };
export const INTR_CONCLUSION =
  '指令执行完才查请求；响应后由硬件在中断周期里依次发 INTA、关中断（IM 置 1）、找中断源、把断点（PC）进栈、转到服务程序入口；进了服务程序才由软件保存现场、做设备服务、恢复现场，最后开中断（IM 清 0）再返回。关中断和保存断点是硬件，保存现场和开中断是软件。';
export const INTR_NEEDS = [{ href: '/6-arbiter', text: '链式查询（INTA 也是沿链传）' }];

/** 图 8.6 的三栏，按引擎 state.box 的名字。 */
const CYCLE = ['执行指令', '中断？', '响应条件', '开中断指令'];
const HW = ['响应中断', '关中断', '找出中断源', '保存断点', '转移'];
const SW = ['保存现场', '设备服务', '恢复现场', '开中断', '中断返回'];

export interface IntrStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  caption: (state: State) => string;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
  wrong: (ask: Ask, value: string, state: State, next: Step<State> | null) => Breakage | null;
  mistakes: Mistake<State>[];
  convention: (step: Step<State>) => string | null;
}

export function intrStage(trace: Trace<Params, State>, narrow: boolean): IntrStage {
  const p = trace.params;
  const n = p.devices.length;
  const regNames = p.regs.map((r) => r.name);
  const depth = 1 + regNames.length;
  const chosen = trace.steps.find((step) => step.state.selected !== null)?.state.selected ?? null;
  const serviceName = chosen === null ? '服务程序' : `${p.devices[chosen]!.name}服务程序`;
  // 指令周期这一栏实际走过的框（IM=1 时多一轮）。
  const cycleRows: string[] = [];
  for (const step of trace.steps) if (CYCLE.includes(step.state.box) && cycleRows.length < 6) cycleRows.push(step.state.box);
  // 到第 index 步为止走过的框，按先后。
  const seen: string[][] = [[]];
  for (const step of trace.steps) seen.push([...(seen.at(-1) ?? []), step.state.box]);

  // ---- 版式 ----（存储阵列是立着的板，往上长；前后排之间留够距离，不压住后排）
  const devW = narrow ? 2.25 : 2.5;
  const devX = (i: number) => (narrow ? (i - (n - 1) / 2) * 2.32 : -2.4 + i * 2.9);
  const devZ = narrow ? -8.0 : -4.4;
  const at = (wide: [number, number], small: [number, number]): [number, number] => (narrow ? small : wide);
  const P = {
    CPU: at([-5.6, -4.4], [-1.55, -4.6]),
    PC: at([-5.6, -1.4], [1.55, -4.6]),
    IR: at([-3.5, -1.4], [-1.55, -2.6]),
    IM: at([-2.0, -1.4], [0.0, -2.6]),
    cards: at([4.65, -1.6], [0.0, 0.6]),
    regs: at([-5.7, 3.6], [-1.3, 4.8]),
    stack: at([-2.4, 3.6], [1.65, 4.8]),
    cycle: at([1.0, 3.6], [-2.25, 11.2]),
    hw: at([3.45, 3.6], [0.0, 11.2]),
    sw: at([5.9, 3.6], [2.25, 11.2]),
  };
  const colW = narrow ? 2.2 : 2.2;

  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<State>>[0] = {};

  parts.push({ id: 'CPU', kind: 'register', position: P.CPU, props: { name: 'CPU', value: '', width: narrow ? 2.6 : 2.4, ink: 'ctrl' } });
  table.CPU = {
    value: from(['phase', 'vector'], (c) => (c.state.vector !== null && c.state.phase === '中断周期' ? `向量 ${hex(c.state.vector)}` : c.state.phase)),
  };
  for (let i = 0; i < n; i++) {
    const d = p.devices[i]!;
    parts.push({ id: `D${i}`, kind: 'register', position: [devX(i), devZ], props: { name: `${i} ${d.name}`, value: '', width: devW }, pick: true, title: d.name });
    table[`D${i}`] = {
      value: from(`devices.${i}`, (c) => {
        const s = c.state.devices[i]!;
        if (c.state.selected === i && c.state.phase === '中断周期') return '截住 INTA';
        return `RD=${s.rd} EI=${s.ei}`;
      }),
    };
  }
  const lastX = devX(n - 1);

  // 公共请求线 INTR、沿链传的 INTA。
  if (narrow) {
    parts.push({ id: 'sINTR', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.s`, to: 'CPU.n', text: 'INTR', ink: 'ctrl', via: [[lastX, devZ + 1.5], [P.CPU[0] + 0.6, devZ + 1.5]], labelAt: 0.5 } });
    for (let i = 0; i < n; i++) {
      parts.push({ id: `sA${i}`, kind: 'signal', position: [0, 0], props: { from: i === 0 ? 'CPU.w' : `D${i - 1}.e`, to: i === 0 ? 'D0.w' : `D${i}.w`, text: i === 0 ? 'INTA' : '', ink: 'ctrl', ...(i === 0 ? { via: [[-3.65, P.CPU[1]], [-3.65, devZ]] as [number, number][] } : {}), labelAt: 0.35 } });
    }
  } else {
    parts.push({ id: 'sINTR', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.n`, to: 'CPU.n', text: 'INTR', ink: 'ctrl', via: [[lastX, devZ - 1.45], [P.CPU[0], devZ - 1.45]], labelAt: 0.5 } });
    for (let i = 0; i < n; i++) {
      parts.push({ id: `sA${i}`, kind: 'signal', position: [0, 0], props: { from: i === 0 ? 'CPU.e' : `D${i - 1}.e`, to: `D${i}.w`, text: i === 0 ? 'INTA' : '', ink: 'ctrl', labelAt: 0.5 } });
    }
  }
  table.sINTR = { on: from('line', (c) => c.state.line === 1) };
  for (let i = 0; i < n; i++) table[`sA${i}`] = { on: from(`devices.${i}.chain`, (c) => c.state.devices[i]!.chain === 1) };

  parts.push({ id: 'PC', kind: 'register', position: P.PC, props: { name: 'PC', value: '', width: narrow ? 2.3 : 2.4 } });
  table.PC = { value: from('pc', (c) => hex(c.state.pc)) };
  parts.push({ id: 'IR', kind: 'register', position: P.IR, props: { name: 'IR', value: '', width: 1.3 } });
  table.IR = { value: 'ir' };
  parts.push({ id: 'IM', kind: 'register', position: P.IM, props: { name: 'IM', value: '', width: 1.3 } });
  table.IM = { value: 'im' };
  parts.push({
    id: 'regs',
    kind: 'memory',
    position: P.regs,
    props: { name: '寄存器', columns: [{ title: '值', width: 1.25 }], rows: regNames.map(() => ['']), labels: regNames },
  });
  table.regs = {
    rows: from('regs', (c) => regNames.map((name) => [hex(c.state.regs[name] ?? 0)])),
    changedCells: from('regs', (c) => regNames.flatMap((name, r) => (c.changed.has(`regs.${name}`) ? [`${r}.0`] : []))),
  };

  parts.push({ id: 'cards', kind: 'stack', position: P.cards, props: { name: '程序卡', cards: [{ title: '主程序' }], width: narrow ? 3.4 : 3.2 } });
  table.cards = {
    cards: from(['stack', 'phase'], (c) => {
      const saved = c.state.stack.find((item) => item.what === '断点');
      const main = { title: '主程序', note: saved ? `断点 ${hex(saved.value)}` : '' };
      return c.state.phase === '服务程序' ? [main, { title: serviceName }] : [main];
    }),
  };
  parts.push({
    id: 'stack',
    kind: 'memory',
    position: P.stack,
    props: { name: '堆栈', columns: [{ title: '内容', width: 1.0 }, { title: '值', width: 1.25 }], rows: Array.from({ length: depth }, () => ['', '']), labels: Array.from({ length: depth }, (_, k) => (k === 0 ? '栈底' : '')) },
  });
  table.stack = {
    rows: from('stack', (c) => Array.from({ length: depth }, (_, k) => {
      const item = c.state.stack[k];
      return item ? [item.what, hex(item.value)] : ['', ''];
    })),
    active: from('stack', (c) => c.state.stack.length - 1),
    changedCells: from('stack', (c) => [...c.changed].flatMap((path) => {
      const m = /^stack\.(\d+)\.value$/.exec(path);
      return m ? [`${m[1]}.0`, `${m[1]}.1`] : [];
    })),
  };

  const column = (id: 'cycle' | 'hw' | 'sw', title: string, head: string, boxes: string[], pick: boolean) => {
    parts.push({
      id,
      kind: 'memory',
      position: P[id],
      props: { name: title, columns: [{ title: head, width: colW - 0.5 }], rows: boxes.map(() => ['']), labels: boxes.map((_, k) => String(k + 1)) },
      ...(pick ? { pick: true, title: id === 'hw' ? '硬件' : '软件' } : {}),
    });
    table[id] = {
      rows: from('box', (c) => {
        const done = seen[c.index] ?? [];
        // 同名的框（中断？、响应条件）在 IM=1 时出现两次：按出现的次数一格一格填。
        return boxes.map((box, k) => [done.filter((b) => b === box).length >= boxes.slice(0, k + 1).filter((b) => b === box).length ? box : '']);
      }),
      active: from('box', (c) => {
        const box = c.state.box;
        const times = (seen[c.index] ?? []).filter((b) => b === box).length;
        let count = 0;
        return boxes.findIndex((b) => b === box && ++count === times);
      }),
    };
  };
  column('cycle', '指令周期', '公操作', cycleRows.length ? cycleRows : ['执行指令', '中断？'], false);
  column('hw', '硬件', '中断周期', HW, true);
  column('sw', '软件', '服务程序', SW, true);

  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<State>(table);

  const moves = (step: Step<State>): Move[] => {
    const s = step.state;
    const box = s.box;
    switch (box) {
      case '发出请求':
        return p.devices.flatMap((d, i) => (d.rd && d.ei ? [{ value: 'INTR', from: `D${i}`, to: 'CPU', arc: true, shape: 'level' as const }] : [])).slice(0, 1);
      case '中断？':
        return s.ir ? [{ value: 'IR=1', from: 'CPU', to: 'IR', arc: true, shape: 'pulse' }] : [];
      case '响应中断':
        return [{ value: 'INTA', from: 'CPU', to: 'D0', arc: true, shape: 'level' }];
      case '关中断':
        return [{ value: '1', from: 'CPU', to: 'IM', arc: true, shape: 'pulse' }];
      case '找出中断源':
        return s.selected === null ? [] : [{ value: hex(s.vector ?? 0), from: `D${s.selected}`, to: 'CPU', arc: true, ink: 'addr' }];
      case '保存断点':
        return [{ value: hex(s.stack[0]?.value ?? 0), from: 'PC', to: 'stack.0.1', arc: true }];
      case '转移':
        return [{ value: hex(s.pc), from: 'CPU', to: 'PC', arc: true, ink: 'addr' }];
      case '保存现场':
        return regNames.map((name, k) => ({ value: hex(s.stack[k + 1]?.value ?? 0), from: `regs.${k}.0`, to: `stack.${k + 1}.1`, arc: true, phase: k }));
      case '设备服务':
        return chosenMove(s);
      case '恢复现场':
        return [...regNames].reverse().map((name, k) => ({ value: hex(s.regs[name] ?? 0), from: `stack.${regNames.length - k}.1`, to: `regs.${regNames.length - 1 - k}.0`, arc: true, phase: k }));
      case '开中断':
      case '开中断指令':
        return [{ value: '0', from: 'CPU', to: 'IM', arc: true, shape: 'pulse' }];
      case '中断返回':
        return [{ value: hex(s.pc), from: 'stack.0.1', to: 'PC', arc: true }];
      default:
        return [];
    }
  };
  function chosenMove(s: State): Move[] {
    if (chosen === null) return [];
    return [{ value: `${p.data} = ${hex(p.data)}`, from: `D${chosen}`, to: 'regs.0.0', arc: true }];
  }

  const names = (path: string): string => {
    const plain: Record<string, string> = { phase: 'CPU 所处', pc: 'PC', im: 'IM', ir: 'IR', line: '请求线 INTR', inta: 'INTA', selected: '被响应的接口', vector: '向量地址', box: '图 8.6 里的这一框' };
    if (plain[path]) return plain[path]!;
    let m = /^devices\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `${p.devices[Number(m[1])]?.name ?? m[1]} 的 ${({ bs: 'BS', rd: 'RD', ei: 'EI', chain: 'INTA 到达' } as Record<string, string>)[m[2] ?? ''] ?? m[2]}`;
    m = /^stack\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `栈第 ${Number(m[1]) + 1} 格 ${m[2] === 'what' ? '内容' : '值'}`;
    m = /^regs\.(\w+)$/.exec(path);
    if (m) return m[1]!;
    return path;
  };
  const values = (path: string, value: string): string => {
    if (path === 'pc' || path === 'vector' || /^regs\./.test(path) || /^stack\.\d+\.value$/.test(path)) return value === '' || value === 'null' ? value : hex(Number(value));
    if (path === 'selected') return value === '' || value === 'null' ? value : (p.devices[Number(value)]?.name ?? value);
    return value;
  };
  const caption = (s: State): string => `${s.phase}　PC = ${hex(s.pc)}　IM = ${s.im}${s.im ? '（关中断）' : '（开中断）'}`;

  const askFrame = (ask: Ask): string[] => {
    if (ask.options?.includes('硬件')) return ['hw', 'sw'];
    if (ask.options?.includes('响应')) return narrow ? ['CPU', 'PC', 'IR', 'IM'] : ['IR', 'IM', 'PC', 'cycle'];
    return ['CPU', ...p.devices.map((_, i) => `D${i}`)];
  };
  const frame = (step: Step<State>): string[] | null => {
    const box = step.state.box;
    const chain = ['CPU', ...p.devices.map((_, i) => `D${i}`)];
    if (['设备就绪', '发出请求', '响应中断', '找出中断源', '设备服务', '还有请求'].includes(box)) return chain;
    if (narrow) {
      // 手机上各排离得远：每一步只看它动到的那几个部件。
      const near: Record<string, string[]> = {
        执行指令: ['CPU', 'PC'],
        '中断？': ['CPU', 'IR', 'IM'],
        响应条件: ['CPU', 'PC', 'IR', 'IM'],
        开中断指令: ['PC', 'IR', 'IM'],
        关中断: ['CPU', 'IR', 'IM'],
        保存断点: ['cards', 'stack'],
        转移: ['CPU', 'PC', 'cards'],
        保存现场: ['cards', 'regs', 'stack'],
        恢复现场: ['cards', 'regs', 'stack'],
        开中断: ['CPU', 'IR', 'IM'],
        中断返回: ['CPU', 'PC', 'cards'],
      };
      return near[box] ?? null;
    }
    if (box === '转移') return ['CPU', 'PC', 'cards'];
    if (box === '中断返回') return ['PC', 'stack', 'cards'];
    return null;
  };

  /** 答错时演学生的答案。 */
  const wrong = (ask: Ask, value: string, state: State, next: Step<State> | null): Breakage | null => {
    if (!next) return null;
    const box = next.state.box;
    if (value === '硬件' || value === '软件') {
      const target = value === '硬件' ? 'hw' : 'sw';
      const boxes = value === '硬件' ? HW : SW;
      const done = (seen[trace.steps.indexOf(next)] ?? []).filter((b) => boxes.includes(b)).length;
      const rows = boxes.map((b, k) => (k < done ? b : k === done ? `${box}？` : ''));
      const why =
        box === '关中断'
          ? '关中断要在任何服务程序指令之前生效，否则第一条指令执行完就可能又被打断。所以它不能靠程序做，由硬件在中断周期里完成（教材 p266）。'
          : box === '保存断点'
            ? '转到服务程序之后 PC 已经指向入口，原来的值就丢了。断点必须在转移之前由硬件存下，程序里写不出这一步。'
            : box === '保存现场'
              ? '要保存哪些寄存器只有服务程序自己知道，硬件不管，所以保存现场是服务程序开头的几条指令（软件）。'
              : '';
      return {
        label: '',
        patch: { [target]: { rows: rows.map((r) => [r]) } },
        moves: [{ value: box, from: 'CPU', to: target, arc: true }],
        message: `把「${box}」放进${value}那一栏：${why}`,
      };
    }
    if (value === '响应' || value === '不响应') {
      return value === '响应'
        ? {
            label: '',
            patch: { IM: { value: '1' }, CPU: { value: '中断周期？' } },
            moves: [{ value: 'INTA', from: 'CPU', to: 'D0', arc: true, shape: 'level' }],
            message: `IM=${state.im} 表示中断关着。这时硬是响应，主程序正在做的、不许打断的那一段就被插了进来。`,
          }
        : {
            label: '',
            patch: { CPU: { value: '主程序？' } },
            moves: [{ value: 'IR=1', from: 'IR', to: 'CPU', arc: true, shape: 'pulse' }],
            message: 'IR=1、IM=0、指令也执行完了，三个条件都满足，CPU 就响应。',
          };
    }
    const picked = p.devices.findIndex((d) => d.name === value);
    if (picked >= 0) {
      const winner = p.devices.findIndex((d) => d.name === ask.answer);
      return {
        label: '',
        patch: { [`D${picked}`]: { value: '没收到 INTA' }, [`D${winner}`]: { value: '截住 INTA' } },
        moves: [{ value: 'INTA', from: winner === 0 ? 'CPU' : `D${winner - 1}`, to: `D${winner}`, arc: true, shape: 'level' }],
        message: `INTA 从接口 0 往下传，先到 ${ask.answer}，它有请求就截住，不再往下送，${value} 收不到。`,
      };
    }
    return null;
  };

  // 常见错误。
  const stepAt = (box: string) => trace.steps.findIndex((step) => step.state.box === box) + 1;
  const mistakes: Mistake<State>[] = [];
  const atSave = stepAt('保存现场');
  if (atSave > 0) {
    mistakes.push({
      text: '容易把开中断写在保存现场之后，因为多级中断的流程里是这样',
      at: atSave,
      act: () => ({
        label: '',
        patch: { IM: { value: '0' }, sw: { rows: ['保存现场', '开中断？', '', '', ''].map((r) => [r]) } },
        moves: [{ value: '0', from: 'CPU', to: 'IM', arc: true, shape: 'pulse' }],
        message: '单级中断在服务期间谁都不许打断，所以保存现场之后没有开中断，开中断只在恢复现场之后（教材 p265、p268）。这里一开，别的请求就可能在服务程序中途插进来。',
      }),
    });
  }
  const atJump = stepAt('转移');
  if (atJump > 0) {
    mistakes.push({
      text: '容易把保存断点当成服务程序的事，因为保存现场是服务程序做的',
      at: atJump,
      act: (state) => ({
        label: '',
        patch: { stack: { rows: Array.from({ length: depth }, () => ['', '']) }, cards: { cards: [{ title: '主程序', note: '断点？' }, { title: serviceName }] } },
        moves: [{ value: hex(state.pc), from: 'CPU', to: 'PC', arc: true, ink: 'addr' }],
        message: `转移以后 PC 已经是入口 ${hex(state.pc)}，被打断的地址没人记得了。断点只能由硬件在转移之前存下，服务程序里没有这一步。`,
      }),
    });
  }
  const atReturn = stepAt('恢复现场');
  if (atReturn > 0 && regNames.length >= 2) {
    mistakes.push({
      text: '容易按进栈的次序出栈，因为恢复和保存是同一批寄存器',
      at: atReturn,
      act: (state) => {
        const wrongOrder = regNames.map((name, k) => [hex(trace.steps[atSave - 1]!.state.stack[regNames.length - k]?.value ?? 0)]);
        void state;
        return {
          label: '',
          patch: { regs: { rows: wrongOrder, changedCells: regNames.map((_, k) => `${k}.0`) } },
          moves: [{ value: regNames[0]!, from: `stack.${regNames.length}.1`, to: 'regs.0.0', arc: true }],
          message: `堆栈后进先出。按 ${regNames.join('、')} 的次序出栈，栈顶的 ${regNames.at(-1)} 的值就进了 ${regNames[0]}，寄存器全换了位置。恢复要按相反的次序：${[...regNames].reverse().join('、')}。`,
        };
      },
    });
  }

  const convention = (step: Step<State>): string | null => {
    if (step.state.box === '找出中断源') return '图 8.6 把找出中断源和保存 PC 画在同一框里，这里按框内文字的先后拆成两步。';
    if (step.state.box === '响应中断') return 'IR 什么时候清 0 教材没说，这里在 CPU 响应时清 0。';
    if (step.state.box === '设备服务') return '把数据读进第一个寄存器，用来说明为什么要先保存现场。';
    return null;
  };

  return { scene, bind, moves, names, values, caption, askFrame, frame, wrong, mistakes, convention };
}
