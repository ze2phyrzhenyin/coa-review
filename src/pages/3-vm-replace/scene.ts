/**
 * 台面：最远一排是考试用的那张表（一列一次访问，行是 a、b、c…，最下一行写「命中」）；
 * 中间是「a 进 c 出」的传送带，左边站着这次要访问的页，右边是淘汰的页；最近一排是比较和两块计数牌。
 * 部件位置固定。所有数都取自 Trace 的状态和引擎的解题表，页面不自己算。
 */
import type { SolutionTable, Step, Trace } from '../../engines/trace';
import { pageList, run } from '../../engines/vmreplace/model';
import type { Params, Policy, State } from '../../engines/vmreplace/model';
import { bindTable, from } from '../../scene';
import type { BindContext, Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

const LETTERS = 'abcdefgh';
export const slot = (i: number): string => LETTERS[i] ?? `第 ${i + 1} 格`;
export const policyLabel = (policy: Policy): string => (policy === 'FIFO' ? 'FIFO' : policy === 'LRU' ? 'LRU' : 'FIFO+LRU');

export interface ReplaceStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  askFrame: (ask: unknown, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
}

/** 第 index 步时表上已经填好几列：填列的那一步（access）之后才算填上。 */
export function filledColumns(trace: Trace<Params, State>, index: number): number {
  const step = index > 0 ? trace.steps[index - 1] : null;
  if (!step) return 0;
  const n = step.state.current.n;
  // 比较步（刚换了访问页，这一列还没填）才少一列；页面加的最后一步「命中率」不改状态，各列都在。
  const comparing = step.level !== 'access' && step.changes.some((change) => change.at === 'current.n' || change.at === 'current.page' || change.at === 'current.hit');
  return comparing ? n - 1 : n;
}

/** 引擎解题表里第 k 列（从 0 起）在第 r 行的格子。 */
const cellOf = (sheet: SolutionTable, r: number, k: number): string => sheet.rows[r]?.cells[k + 1] ?? '';

const items = (frames: (number | null)[]): string[] => frames.map((p) => (p === null ? '' : String(p)));

/** 一份 Trace 对应一张台面。引用要稳定：同一份 Trace 请用 useMemo 缓存。 */
export function replaceStage(trace: Trace<Params, State>, narrow: boolean, sheet: SolutionTable): ReplaceStage {
  const params = trace.params;
  const pages = pageList(params);
  const n = params.frames;
  const count = pages.length;
  const hitRow = n; // 表的最后一行写「命中」。
  // 每列宽：放得下「命中」两个字。
  const colW = narrow ? 0.62 : 0.98;
  const at = <T>(wide: T, small: T): T => (narrow ? small : wide);
  // 手机上页面不多于 3 个时，访问页、传送带、淘汰排成一排（带子窄一点，不挂名牌），整张台面矮一截，360 宽也装得下表和传送带。
  // 页面更多时一排放不下，访问页和淘汰排到传送带下面。
  const inline = narrow && n <= 3;
  const beltW = inline ? 0.95 : 1.2;
  const beltLen = n * beltW + 0.5;
  const rowZ = inline ? -1.25 : -1.6;
  const tableZ = at(-3.7, (inline ? -3.3 : -4.2) - Math.max(0, n - 3) * 0.3);

  const parts: PartSpec[] = [
    {
      id: 'tbl',
      kind: 'memory',
      position: [0, tableZ],
      title: '列表',
      props: {
        // 手机上列宽只够一个字，行名再写「命中」表就比 360 的屏宽：最下一行打 ✓，名牌上说明。
        name: narrow ? '页面访问序列（✓ 是命中）' : '页面访问序列',
        // 宽屏照例 3.11 在最右加一列「命中率」；手机上放不下，改成表下面的一块牌。
        columns: [...pages.map((p) => ({ title: String(p), width: colW })), ...(narrow ? [] : [{ title: '命中率', width: 2.3 }])],
        rows: Array.from({ length: n + 1 }, () => [...pages.map(() => ''), ...(narrow ? [] : [''])]),
        labels: [...Array.from({ length: n }, (_, i) => slot(i)), ''],
      },
    },
    {
      id: 'conv',
      kind: 'conveyor',
      position: at([0.2, 0.3], inline ? [-0.4, rowZ] : [0.5, rowZ]),
      title: '主存页面',
      props: { ...(inline ? {} : { name: '主存' }), slots: n, items: items(trace.initial.frames), inLabel: slot(0), outLabel: slot(n - 1), slotWidth: beltW },
    },
    { id: 'cur', kind: 'register', position: at([-beltLen / 2 - 3.0, 0.3], inline ? [-2.8, rowZ] : [-1.75, 0.6]), props: { name: '访问页', value: '', width: inline ? 1.2 : params.addresses ? 2.6 : 2.0 } },
    { id: 'out', kind: 'register', position: at([beltLen / 2 + 3.1, 0.3], inline ? [2.4, rowZ] : [1.75, 0.6]), props: { name: '淘汰', value: '', width: inline ? 2.0 : 2.6 } },
    {
      id: 'cmp',
      kind: 'compare',
      position: at([-1.6, 2.7], [0, inline ? 1.2 : 2.5]),
      title: '找这一页',
      props: { left: '', right: '', ...(narrow ? {} : { leftName: '访问页', rightName: '主存里' }) },
    },
    { id: 'hit', kind: 'label', position: at([2.4, 2.7], [-1.2, inline ? 2.6 : 3.9]), props: { text: '命中 0', plate: true, size: 0.36, weight: 600, mono: true }, title: '命中次数' },
    { id: 'miss', kind: 'label', position: at([4.4, 2.7], [1.2, inline ? 2.6 : 3.9]), props: { text: '缺页 0', plate: true, size: 0.36, weight: 600, mono: true }, title: '缺页次数' },
    // 答「命中吗」用的两块牌：只在出这道题时摆出来。和计数牌分开，牌上的次数不会被当成选项，牌的大小也不随计数变。
    { id: 'ansHit', kind: 'label', position: at([2.4, 4.1], [-1.2, inline ? 3.9 : 5.4]), props: { text: '命中', plate: true, size: 0.36, weight: 600 }, pick: true, title: '命中' },
    { id: 'ansMiss', kind: 'label', position: at([4.4, 4.1], [1.2, inline ? 3.9 : 5.4]), props: { text: '缺页', plate: true, size: 0.36, weight: 600 }, pick: true, title: '缺页' },
  ];
  if (narrow) parts.push({ id: 'ratio', kind: 'label', position: [0, inline ? 3.9 : 5.4], props: { text: '', plate: true, size: 0.36, weight: 600, mono: true } });
  // 传送带自己只在两端写 a 和最后一格的字母；中间几格补上，和表的行名对得上。
  const convAt = parts.find((part) => part.id === 'conv')!.position;
  for (let k = 1; k < n - 1; k++) {
    parts.push({ id: `slot${k}`, kind: 'label', position: [convAt[0] - (n * beltW) / 2 + beltW * (k + 0.5), convAt[1] + 0.82], props: { text: slot(k), size: 0.31, weight: 600, tone: 'text' } });
  }
  const wires = [
    { id: 'cur-conv', from: narrow && !inline ? 'cur.n' : 'cur', to: 'conv' },
    { id: 'conv-out', from: 'conv', to: narrow && !inline ? 'out.n' : 'out' },
  ];

  // 窄屏上列宽只够一个字：「命中」那一行写 ✓。
  const mark = (text: string): string => (narrow && text === '命中' ? '✓' : text);
  const comparing = (c: BindContext<State>): boolean => !!c.step && c.step.level === 'explain' && c.state.current.n > 0 && c.state.current.hit !== null && c.state.current.n <= count && !isTail(c);
  /** 页面自己加的最后一步（命中率）。 */
  const isTail = (c: BindContext<State>): boolean => c.index > count * 2;
  /** 这一步的画面上正等着答「命中吗」。 */
  const asking = (c: BindContext<State>): boolean => !!trace.steps[c.index]?.ask?.prompt.endsWith('命中吗');
  const table: Record<string, Record<string, unknown>> = {
    tbl: {
      rows: from<State>(['frames', 'current.n'], (c) => {
        const k = filledColumns(trace, c.index);
        // 最后一格是命中率：全部列填完、到了「命中率」那一步才写（引擎的表里它在 a 行最后一格）。
        const ratio = isTail(c) ? (sheet.rows[0]?.cells[count + 1] ?? '') : '';
        return Array.from({ length: n + 1 }, (_, r) => [...pages.map((_, col) => (col < k ? mark(cellOf(sheet, r, col)) : '')), ...(narrow ? [] : [r === 0 ? ratio : ''])]);
      }),
      changedCells: from<State>(['frames'], (c) => {
        if (isTail(c)) return narrow ? [] : [`0.${count}`];
        if (!c.step || c.step.level !== 'access') return [];
        const col = c.state.current.n - 1;
        return Array.from({ length: n + 1 }, (_, r) => `${r}.${col}`).filter((cell) => {
          const [r] = cell.split('.').map(Number);
          return cellOf(sheet, r ?? 0, col) !== '';
        });
      }),
      cell: (c: BindContext<State>) => (comparing(c) ? `${hitRow}.${c.state.current.n - 1}` : ''),
    },
    conv: { items: from<State>(['frames'], (c) => items(c.state.frames)) },
    cur: {
      value: from<State>(['current.page'], (c) => {
        if (c.state.current.page === null || isTail(c)) return '';
        const address = params.addresses?.[c.state.current.n - 1];
        return address === undefined || inline ? `页 ${c.state.current.page}` : `页 ${c.state.current.page}（${address}）`;
      }),
    },
    // 排成一排时「淘汰」的牌窄：页号之间用空格，整串都写得下。
    out: { value: from<State>(['evicted'], (c) => { const list = c.state.evicted; return list.join(inline ? ' ' : '、'); }) },
    cmp: {
      left: from<State>(['current.page'], (c) => (c.state.current.page === null ? '' : String(c.state.current.page))),
      right: from<State>(['current.hit'], (c) => {
        const cur = c.state.current;
        if (cur.hit && cur.marked !== null) return `${slot(cur.marked)}：${c.state.frames[cur.marked] ?? ''}`;
        const list = c.state.frames.filter((p): p is number => p !== null);
        return list.length ? list.join('、') : '空';
      }),
      result: from<State>(['current.hit'], (c) => (c.state.current.hit === null ? '' : c.state.current.hit ? 'match' : 'mismatch')),
      hidden: (c: BindContext<State>) => !comparing(c),
    },
    ...(narrow ? { ratio: { text: (c: BindContext<State>) => (isTail(c) ? `命中率 ${sheet.rows[0]?.cells[count + 1] ?? ''}` : ''), hidden: (c: BindContext<State>) => !isTail(c) } } : {}),
    ansHit: { hidden: (c: BindContext<State>) => !asking(c) },
    ansMiss: { hidden: (c: BindContext<State>) => !asking(c) },
    hit: { text: from<State>(['hits'], (c) => `命中 ${c.state.hits}`) },
    miss: { text: from<State>(['faults'], (c) => `缺页 ${c.state.faults}`) },
  };
  const bind = bindTable<State>(table as Parameters<typeof bindTable<State>>[0]);

  /** 缺页时这一页从「访问页」走上传送带的 a 端。其余的挪动由传送带自己演：整排后移、c 端掉下、命中的页拎回 a。 */
  const moves = (step: Step<State>): Move[] => {
    const cur = step.state.current;
    // 手机上访问页就在 a 端下方，传送带自己从上方落进新页，不再另飞一张。
    if (narrow || step.level !== 'access' || cur.hit !== false || cur.page === null) return [];
    return [{ value: `页 ${cur.page}`, from: 'cur', to: 'conv', via: ['cur-conv'] }];
  };

  const names = (path: string): string => {
    const [head, key] = path.split('.');
    if (head === 'frames') return `${slot(Number(key))} 格`;
    if (head === 'hits') return '命中次数';
    if (head === 'faults') return '缺页次数';
    if (head === 'evicted') return `第 ${Number(key) + 1} 个淘汰的页`;
    const fields: Record<string, string> = { n: '第几次访问', page: '访问页', hit: '结果', evicted: '这次换出的页', marked: '加圈的格' };
    if (head === 'current') return fields[key ?? ''] ?? path;
    return path;
  };
  const values = (path: string, value: string): string => {
    if (path === 'current.hit') return value === 'true' ? '命中' : value === 'false' ? '缺页' : value;
    if (path === 'current.marked' && /^\d+$/.test(value)) return `${slot(Number(value))} 格`;
    return value;
  };
  const askFrame = (ask: unknown): string[] => ((ask as { prompt?: string }).prompt?.endsWith('命中吗') ? ['conv', 'ansHit', 'ansMiss'] : ['conv', 'cur']);
  // 填列的那一步看表和传送带（手机上两样要同时看见）；比较的那一步看传送带、访问页和比较。
  const frame = (step: Step<State>): string[] | null => {
    if (step.state.current.n === 0) return null;
    // 手机上每一步看同一片：表、传送带、访问页和淘汰，镜头不来回跑。装不下时看传送带（放在最后）。
    if (narrow) return step.changes.length === 0 ? ['hit', 'miss', 'ratio'] : ['cur', 'tbl', 'conv'];
    if (step.level === 'access') return ['tbl', 'conv'];
    return step.state.current.n <= count && step.title.startsWith('第') ? ['conv', 'cur', 'cmp'] : null;
  };
  return { scene: { parts, wires }, bind, moves, names, values, askFrame, frame };
}

/** 页面对 Trace 的加工：最后加一步「命中率」（取自引擎的 result），解题表另排成横表（页面下方），播放器里不再列。 */
export function polish(trace: Trace<Params, State>): Trace<Params, State> {
  const last = trace.steps[trace.steps.length - 1];
  // 出题时台面上的「访问页」还是上一页，题面里写明问的是哪一页。答案不变，仍是引擎给的。
  const steps = trace.steps.map((raw) => {
    let step = raw;
    const page = step.state.current.page;
    // 命中的页已经在最下一格时，引擎那句「x 以下的页不动」没有所指，去掉。
    const bottom = slot(trace.params.frames - 1);
    if (step.why.includes(`${bottom} 以下的页不动。`)) step = { ...step, why: step.why.replace(`${bottom} 以下的页不动。`, '') };
    if (!step.ask || page === null) return step;
    const prompt = step.ask.prompt === '命中吗' ? `访问页 ${page}，命中吗` : `页 ${page} 命中后，a 格是哪一页`;
    return { ...step, ask: { ...step.ask, prompt } };
  });
  if (last) {
    steps.push({
      id: `s${steps.length + 1}`,
      level: 'explain',
      title: `命中率 ${trace.result['命中率'] ?? ''}`,
      why: `命中率 = 命中次数 / 访问次数。表里命中的列有 ${trace.result['命中次数'] ?? ''} 列，缺页 ${trace.result['缺页次数'] ?? ''} 次，依次淘汰的页是 ${trace.result['淘汰页号'] ?? ''}。`,
      ref: '教材 p118 例 3.11',
      state: last.state,
      changes: [],
      focus: ['hits', 'faults', 'evicted'],
    });
  }
  return { ...trace, steps, table: { columns: [], rows: [] } };
}

/** 答错时按学生的答案演后果。 */
export function replaceWrong(trace: Trace<Params, State>) {
  return (ask: { prompt: string; answer: string }, value: string, state: State, next: Step<State> | null): Breakage | null => {
    const cur = next?.state.current ?? state.current;
    const p = cur.page;
    if (p === null) return null;
    const n = state.frames.length;
    if (ask.prompt.endsWith('命中吗')) {
      if (value === '缺页') {
        const at = state.frames.indexOf(p);
        const bottom = state.frames[n - 1];
        return {
          label: '',
          patch: { miss: { text: `缺页 ${state.faults + 1}` }, cur: { value: `页 ${p}` } },
          moves: [{ value: `页 ${p}`, from: 'cur', to: 'conv', via: ['cur-conv'] }],
          message: `按缺页处理，就要从辅存把页 ${p} 再调一次。可它就在 ${slot(at)} 格，这一趟是白跑的${bottom !== null && bottom !== undefined && bottom !== p ? `，还会把 ${slot(n - 1)} 格的页 ${bottom} 挤出主存` : ''}。`,
        };
      }
      return {
        label: '',
        patch: { hit: { text: `命中 ${state.hits + 1}` }, cur: { value: `页 ${p}` } },
        moves: [{ value: `页 ${p}？`, from: 'conv', to: 'cur', arc: true }],
        message: `各格里都没有页 ${p}。按命中处理，就要到主存里取一页不在主存的数据。`,
      };
    }
    // 命中后 a 格是哪一页
    const v = Number(value);
    if (!Number.isInteger(v) || !state.frames.includes(v) || v === p) {
      return { label: '', patch: {}, moves: [{ value: `页 ${value}`, from: 'cur', to: 'conv', arc: true }], message: `a 格只能是主存里已有的页，看这次访问的是哪一页。` };
    }
    const reordered = [v, ...state.frames.filter((q) => q !== v)];
    return {
      label: '',
      patch: { conv: { items: items(reordered) } },
      moves: [{ value: `页 ${v}`, from: 'conv', to: 'conv.0.0', arc: true }],
      message: `把页 ${v} 拎到 a，等于记下刚用过的是页 ${v}。可这次访问的是页 ${p}，它留在原处，以后会比页 ${v} 先被挤到 ${slot(n - 1)} 端换出。`,
    };
  };
}

/** 常见错误，每条在场景里演一遍。页号、格子都取自这份 Trace；换算法后的结果由引擎重算。 */
export function replaceMistakes(trace: Trace<Params, State>): Mistake<State>[] {
  const params = trace.params;
  const steps = trace.steps;
  const out: Mistake<State>[] = [];
  const n = params.frames;
  const before = (i: number): State => (i > 0 ? steps[i - 1]!.state : trace.initial);

  // 1. FIFO 和 FIFO+LRU 命中时的做法记混。
  const lift = steps.findIndex((step, i) => step.level === 'access' && step.state.current.hit === true && before(i).frames.indexOf(step.state.current.page ?? -1) > 0);
  if (lift >= 0) {
    const step = steps[lift]!;
    const p = step.state.current.page!;
    const old = before(lift).frames;
    const other: Policy = params.policy === 'FIFO' ? 'FIFO+LRU' : 'FIFO';
    const otherResult = run({ ...params, policy: other }).result;
    const wrongFrames = params.policy === 'FIFO' ? [p, ...old.filter((q) => q !== p)] : old;
    out.push({
      text:
        params.policy === 'FIFO'
          ? `容易在 FIFO 命中时也把页 ${p} 提到 a，因为和 FIFO+LRU 记混了`
          : `容易在 ${policyLabel(params.policy)} 命中时让各格不动，因为套用了 FIFO`,
      at: lift + 1,
      act: () => ({
        label: '',
        patch: { conv: { items: items(wrongFrames) } },
        moves: params.policy === 'FIFO' ? [{ value: `页 ${p}`, from: 'conv', to: 'conv.0.0', arc: true }] : [{ value: `页 ${p}`, from: 'cur', to: 'conv', arc: true }],
        message:
          params.policy === 'FIFO'
            ? `FIFO 只看调入的先后，命中时各格不动。这样提一下就成了 FIFO+LRU，后面换出的页跟着变：照这样填完，命中 ${otherResult['命中次数']} 次，淘汰 ${otherResult['淘汰页号']}，和 FIFO 的答案对不上。`
            : `各格不动是 FIFO 的做法。${policyLabel(params.policy)} 命中时要把页 ${p} 提到 a，不然最久没用的页认错了：照 FIFO 填完，命中 ${otherResult['命中次数']} 次，淘汰 ${otherResult['淘汰页号']}。`,
      }),
    });
  }

  // 2. 新页写进被换出的那一格，别的页不动（页框固定的画法）。
  const evict = steps.findIndex((step) => step.level === 'access' && step.state.current.evicted !== null);
  if (evict >= 0 && n >= 2) {
    const step = steps[evict]!;
    const p = step.state.current.page!;
    const gone = step.state.current.evicted!;
    const old = before(evict).frames;
    const wrong = [...old.slice(0, n - 1), p];
    out.push({
      text: `容易把新页 ${p} 直接写进 ${slot(n - 1)} 格、别的页不动，因为别的书里页框是固定的`,
      at: evict + 1,
      act: () => ({
        label: '',
        patch: { conv: { items: items(wrong) }, out: { value: String(gone) } },
        moves: [{ value: `页 ${gone}`, from: 'conv', to: 'out', arc: true }],
        message: `这张表是「${slot(0)} 进 ${slot(n - 1)} 出」：新页进 ${slot(0)}，各页下移一格，${slot(n - 1)} 格放的永远是最早进来的页。新页 ${p} 留在 ${slot(n - 1)} 格，下一次缺页就会把刚调进来的它换出去。`,
      }),
    });
  }

  // 3. 主存还空着时的调入没算缺页。
  const first = steps.findIndex((step) => step.level === 'access' && step.state.current.hit === false && step.state.current.evicted === null);
  if (first >= 0) {
    const step = steps[first]!;
    const p = step.state.current.page!;
    out.push({
      text: '容易把主存还有空格时的调入不算缺页，因为这时没有页被换出',
      at: first + 1,
      act: (s) => ({
        label: '',
        patch: { miss: { text: `缺页 ${s.faults - 1}` } },
        moves: [{ value: `页 ${p}`, from: 'cur', to: 'conv', arc: true }],
        message: `页 ${p} 原来不在主存，要从辅存调进来，这就是一次缺页。有没有页被换出只看主存满没满，和算不算缺页无关。`,
      }),
    });
  }
  return out;
}

export function replaceConvention(params: Params) {
  return (step: Step<State>): string | null => {
    if (params.policy === 'LRU' && step.level === 'access' && step.state.current.hit) {
      return 'LRU 用和 FIFO+LRU 同一张表：a 是刚用过的页，最下一格是最久没用的页。教材只给了 FIFO+LRU 的列表例题（p118）。';
    }
    if ((params.initial?.length ?? 0) > 0 && step.state.current.n === 1 && step.level === 'explain') {
      return '开始时已在主存的页按给出的顺序从 a 往下排，教材没说装入的先后。';
    }
    return null;
  };
}

export const REPLACE_QUESTION = { text: '每来一次访问，这一列的 a、b、c 各填哪一页', at: ['cur', 'tbl', 'conv'] };
export const REPLACE_CONCLUSION =
  '缺页时两种算法一样：新页进 a，各页下移一格，最下一格原来的页被换出。命中时 FIFO 各格不动；FIFO+LRU 把命中的页提到 a，它上面的页各下移一格，下面的不动。命中的页加圈，那一列写「命中」，命中率 = 命中次数 / 访问次数。';
export const REPLACE_NEEDS = [{ href: '/3-vm-addr', text: '页、页号和缺页' }];
