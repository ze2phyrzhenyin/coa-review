/**
 * 扩展操作码的台面：一类指令一层抽屉柜。每层上面一块格式牌（操作码几位、几个地址码）和一块「可用」牌，
 * 下面的抽屉柜分两格：用掉的编码、留作扩展的编码。上一层留作扩展的那格抽屉拉开，
 * 一张写着「留下 n 个 × 2^k」的卡落到下一层的「可用」牌上。数都取自引擎 src/engines/opcode 的状态。
 */
import { levelName, plan } from '../../engines/opcode/model';
import type { OpcodeParams, OpcodeState } from '../../engines/opcode/model';
import type { Ask, Step, Trace } from '../../engines/trace';
import { bindTable } from '../../scene';
import type { BindContext, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

type Ctx = BindContext<OpcodeState>;
const DZ = 4.3;

const formatText = (p: OpcodeParams, i: number): string => {
  const l = p.levels[i]!;
  const op = p.wordBits - l.addresses * p.addressBits;
  const fields = Array.from({ length: l.addresses }, (_, k) => `A${k + 1} ${p.addressBits}`);
  return [`OP ${op}`, ...fields].join(' | ');
};

interface Layout {
  fmt: (i: number) => [number, number];
  cap: (i: number) => [number, number];
  shelf: (i: number) => [number, number];
  verdict: (n: number) => [number, number];
}

function layout(narrow: boolean, codeW: number): Layout {
  if (narrow) {
    const dz = 10.4;
    return {
      fmt: (i) => [-1.3, -6 + i * dz],
      cap: (i) => [2.4, -6 + i * dz],
      shelf: (i) => [0, -0.9 + i * dz],
      verdict: (n) => [0, -6 + n * dz],
    };
  }
  // 宽屏一类一行：格式牌、可用牌、抽屉柜从左往右。
  const dz = 4.9;
  const shelfX = 0.6 + codeW + 1.2;
  return {
    fmt: (i) => [-7.6, -5.4 + i * dz],
    cap: (i) => [-2.8, -5.4 + i * dz],
    shelf: (i) => [shelfX, -5.6 + i * dz],
    verdict: (n) => [-2.8, -5.4 + n * dz],
  };
}

/** 抽屉柜两格的内容：[起, 止, 个数]。 */
function cabinet(s: OpcodeState['levels'][number], last: boolean, failed: boolean, want: number | undefined): { used: [string, string, string]; kept: [string, string, string] } {
  const count = (n: number | null) => (n === null ? '' : `${n} 个`);
  const used = s.range;
  const kept = s.reservedRange;
  return {
    used: [used ? used[0] : failed ? '不够' : '', used && used[1] !== used[0] ? used[1] : '', failed ? `要 ${want ?? ''}` : used ? count(s.used) : s.used === 0 ? '0 个' : ''],
    kept: [kept ? kept[0] : '', kept && kept[1] !== kept[0] ? kept[1] : '', failed ? '' : kept ? count(s.reserved) : !last && s.reserved === 0 ? '0 个' : ''],
  };
}

export function opScene(trace: Trace<OpcodeParams, OpcodeState>, narrow: boolean): SceneSpec {
  const p = trace.params;
  const n = p.levels.length;
  const longest = Math.max(...trace.steps.flatMap((s) => s.state.levels.flatMap((l) => [...(l.range ?? []), ...(l.reservedRange ?? [])].map((t) => t.length))), 4);
  const codeW = Math.min(5.2, longest * 0.2 + 0.4);
  const L = layout(narrow, codeW);
  const parts: PartSpec[] = [];
  p.levels.forEach((l, i) => {
    parts.push({ id: `FMT_${i}`, kind: 'register', position: L.fmt(i), props: { name: levelName(l.addresses), value: formatText(p, i), width: narrow ? 3.6 : 4.2, ink: 'ctrl' } });
    parts.push({ id: `CAP_${i}`, kind: 'register', position: L.cap(i), props: { name: '可用', value: '', width: narrow ? 2.6 : 2.8 } });
    parts.push({
      id: `SHELF_${i}`,
      kind: '4-opcode:cabinet',
      position: L.shelf(i),
      title: `${levelName(l.addresses)}的抽屉柜`,
      props: { used: ['', '', ''], kept: ['', '', ''], open: false, last: i === n - 1, codeWidth: codeW, narrow, fresh: [] },
      describe: (props) => `${levelName(l.addresses)}：用掉 ${(props.used as string[]).filter(Boolean).join(' ') || '未排'}；留作扩展 ${(props.kept as string[]).filter(Boolean).join(' ') || '无'}${props.open ? '，抽屉已拉开' : ''}`,
    });
  });
  parts.push({ id: 'VERDICT', kind: 'register', position: L.verdict(n), props: { name: '方案', value: '', width: narrow ? 6.0 : 5.0 } });
  return { parts, wires: [], kinds: () => import('./parts') };
}

export function opBind(trace: Trace<OpcodeParams, OpcodeState>, narrow: boolean) {
  const p = trace.params;
  const n = p.levels.length;
  const table: Record<string, Record<string, unknown>> = {};
  // 不可行时 Trace 停在卡住的那一类：它是最后一个有「用掉」的类。
  const failedAt = (s: OpcodeState) => (s.feasible === false ? s.levels.map((l) => l.used !== null).lastIndexOf(true) : -1);
  p.levels.forEach((l, i) => {
    table[`CAP_${i}`] = { value: { at: `levels.${i}.available`, as: (c: Ctx) => (c.state.levels[i]!.available === null ? '' : `${c.state.levels[i]!.available} 个`) } };
    const paths = [`levels.${i}.used`, `levels.${i}.range`, `levels.${i}.reservedRange`, `levels.${i}.reserved`];
    table[`SHELF_${i}`] = {
      used: { at: paths, as: (c: Ctx) => cabinet(c.state.levels[i]!, i === n - 1, failedAt(c.state) === i, l.count).used },
      kept: (c: Ctx) => cabinet(c.state.levels[i]!, i === n - 1, failedAt(c.state) === i, l.count).kept,
      // 留作扩展的抽屉：下一层算可用编码时拉开，之后一直开着，看得出下一层从哪来。
      open: (c: Ctx) => i < n - 1 && c.state.levels[i + 1]!.available !== null && (c.state.levels[i]!.reserved ?? 0) > 0,
      fresh: (c: Ctx) => ([...c.changed].some((x) => x === `levels.${i}.used`) ? ['used', 'kept'] : []),
    };
    table[`FMT_${i}`] = { focus: (c: Ctx) => c.state.current === i };
  });
  table.VERDICT = {
    value: {
      at: 'feasible',
      as: (c: Ctx) => {
        if (c.state.feasible === null) return '';
        if (c.state.feasible) return '可行';
        return `不可行，卡在${c.state.levels[failedAt(c.state)]?.name ?? ''}`;
      },
    },
  };
  return bindTable<OpcodeState>(table as never);
}

/** 一步里的移动：算可用编码时，上一层扩展抽屉里的卡落到这一层的「可用」牌；取码时，卡从「可用」牌分进两格抽屉。 */
export function opMoves(p: OpcodeParams, narrow: boolean) {
  return (step: Step<OpcodeState>): Move[] => {
    const i = step.state.current;
    const s = step.state;
    if (step.changes.some((c) => c.at === 'feasible') && s.feasible) {
      return [{ value: '可行', from: `SHELF_${p.levels.length - 1}`, to: 'VERDICT', arc: true }];
    }
    if (i === null) return [];
    const l = s.levels[i]!;
    if (step.changes.some((c) => c.at === `levels.${i}.available`)) {
      if (i === 0) return [{ value: `2^${l.opBits}`, from: `FMT_0`, to: 'CAP_0', arc: true }];
      const prev = s.levels[i - 1]!;
      const grow = l.opBits - prev.opBits;
      // 抽屉里的码先落到这一层的格式牌上（它们是操作码的开头），再算出能接出多少个编码。
      const codes = prev.reservedRange ? (prev.reservedRange[0] === prev.reservedRange[1] ? prev.reservedRange[0] : `${prev.reservedRange[0]}～`) : '';
      return [
        { value: codes, from: `SHELF_${i - 1}.1.0`, to: `FMT_${i}`, arc: true, ink: 'ctrl', phase: 0 },
        { value: `${prev.reserved} × 2^${grow}`, from: `FMT_${i}`, to: `CAP_${i}`, arc: true, phase: 1 },
      ];
    }
    const out: Move[] = [];
    if (l.range) out.push({ value: `${l.used} 个`, from: `CAP_${i}`, to: `SHELF_${i}.0.0`, arc: true });
    if (l.reservedRange) out.push({ value: `${l.reserved} 个`, from: `CAP_${i}`, to: `SHELF_${i}.1.0`, arc: true, phase: 1 });
    if (s.feasible === false) out.push({ value: `要 ${p.levels[i]!.count}`, from: `CAP_${i}`, to: 'VERDICT', arc: true });
    return out;
  };
}

export function opNames(path: string): string {
  if (path === 'current') return '正在排的一类';
  if (path === 'feasible') return '方案可行';
  const m = /^levels\.(\d+)\.(\w+)(?:\.(\d))?$/.exec(path);
  if (!m) return path;
  const tag = `第 ${Number(m[1]) + 1} 类`;
  const names: Record<string, string> = { available: '可用编码数', used: '用掉的码数', reserved: '留作扩展的码数', range: '用掉的范围', reservedRange: '留作扩展的范围' };
  const end = m[3] === undefined ? '' : m[3] === '0' ? '（起）' : '（止）';
  return `${tag}${names[m[2]!] ?? m[2]}${end}`;
}

export function opValues(path: string, value: string): string {
  if (path === 'current') return value === 'null' || value === '' ? '空' : `第 ${Number(value) + 1} 类`;
  if (path === 'feasible') return value === 'true' ? '是' : value === 'false' ? '否' : value;
  return value;
}

/** 答错可用编码数或最多几条时，把学生的数摆上去，说清楚差在哪。 */
export function opWrong(p: OpcodeParams) {
  return (ask: Ask, value: string, state: OpcodeState, next: Step<OpcodeState> | null): Breakage | null => {
    if (ask.kind !== 'number' || !next) return null;
    const said = Number(value);
    if (!Number.isFinite(said)) return { label: '', patch: {}, moves: [], message: '填一个整数。' };
    const i = next.state.current ?? state.current ?? 0;
    const l = next.state.levels[i]!;
    const asksCapacity = next.changes.some((c) => c.at === `levels.${i}.available`);
    if (asksCapacity) {
      const prev = state.levels[i - 1]!;
      const grow = l.opBits - prev.opBits;
      let message = `按 ${said} 个算不对。上一级留下 ${prev.reserved} 个码，每个码后面接多出的 ${grow} 位。`;
      if (said === prev.reserved) message = `${said} 只是上一级留下的码数。每个留下的码后面还要接上多出的 ${grow} 位，一个码变成 2^${grow} 个。`;
      else if (said === 2 ** l.opBits) message = `2^${l.opBits} 是 ${l.opBits} 位操作码的全部编码，可前面几类已经用掉了开头是它们的码，只剩上一级留下的那几个能当前缀。`;
      else if (said === 2 ** grow) message = `2^${grow} 只是一个前缀后面能接的个数，上一级留下了 ${prev.reserved} 个前缀，要乘上去。`;
      return { label: '', patch: { [`CAP_${i}`]: { value: `${said} 个` } }, moves: [{ value: String(said), from: `SHELF_${i - 1}`, to: `CAP_${i}`, arc: true }], message };
    }
    const avail = l.available ?? 0;
    let message = `${l.name}最多不是 ${said} 条。这一级可用 ${avail} 个编码，先扣掉后面几类要用的前缀。`;
    if (said === avail && i < p.levels.length - 1) message = `${avail} 是这一级的全部编码。全给${l.name}，后面几类就没有前缀可用，一条也排不进去。`;
    else if (said > avail) message = `这一级只有 ${avail} 个编码可用，${said} 条放不下。`;
    return { label: '', patch: { [`CAP_${i}`]: { value: `${avail} 个`, changed: true } }, moves: [], message };
  };
}

/** 弄坏它：让某一类多用一个码，交给引擎重排，看后面几类还够不够。 */
export function opBreak(p: OpcodeParams) {
  return (state: OpcodeState, part: string | null): Breakage | null => {
    if (state.feasible !== true) return null;
    const pick = part?.startsWith('SHELF_') || part?.startsWith('CAP_') ? Number(part.split('_')[1]) : 0;
    const i = Math.min(pick, p.levels.length - 2);
    if (i < 0 || p.levels[i]!.count === undefined) return null;
    const changed: OpcodeParams = { ...p, levels: p.levels.map((l, k) => (k === i ? { ...l, count: l.count! + 1 } : l)) };
    let after;
    try {
      after = plan(changed);
    } catch {
      return null;
    }
    const patch: Record<string, Record<string, unknown>> = {};
    p.levels.forEach((_, k) => {
      if (k > i && after.available[k] !== undefined) patch[`CAP_${k}`] = { value: `${after.available[k]} 个` };
    });
    const name = levelName(p.levels[i]!.addresses);
    const nextName = levelName(p.levels[i + 1]!.addresses);
    const lost = (state.levels[i + 1]!.available ?? 0) - (after.available[i + 1] ?? 0);
    patch.VERDICT = { value: after.feasible ? '仍可行' : `不可行，卡在${levelName(p.levels[after.failAt!]!.addresses)}` };
    return {
      label: `弄坏它：${name}多用 1 个码`,
      patch,
      moves: [{ value: '1 个', from: `SHELF_${i}`, to: `CAP_${i + 1}`, arc: true }],
      message: `${name}多用 1 个码，留给扩展的就少 1 个，${nextName}一下少了 ${lost} 个编码。${after.feasible ? '这一题还排得下。' : '后面那一类要的条数就放不下了，硬塞进去的话，同一个编码既是这一类的指令又是更长操作码的开头，译码器分不清。'}`,
    };
  };
}

/** 常见错误：每条在场景里演一遍，数都取自 Trace。 */
export function opMistakes(trace: Trace<OpcodeParams, OpcodeState>): Mistake<OpcodeState>[] {
  const p = trace.params;
  const steps = trace.steps;
  const final = steps[steps.length - 1]!.state;
  const out: Mistake<OpcodeState>[] = [];
  const second = steps.findIndex((s) => s.state.current === 1 && s.changes.some((c) => c.at === 'levels.1.available'));
  if (second >= 0) {
    const l = steps[second]!.state.levels[1]!;
    out.push({
      text: `容易把${l.name}的可用编码数算成 2^${l.opBits}，因为忘了前面一类已经占掉了大部分编码`,
      at: second + 1,
      act: () => ({
        label: '',
        patch: { CAP_1: { value: `${2 ** l.opBits} 个` } },
        moves: [{ value: `2^${l.opBits}`, from: 'FMT_1', to: 'CAP_1', arc: true }],
        message: `${l.opBits} 位操作码一共 ${2 ** l.opBits} 种，可开头 ${p.wordBits - p.levels[0]!.addresses * p.addressBits} 位是前一类用掉的码的那些全不能用，只有上一级留下的前缀可用，所以是 ${l.available} 个。`,
      }),
    });
  }
  const first = final.levels[0]!;
  if (first.available !== null && first.used !== null && final.levels.length > 1 && (first.reserved ?? 0) > 0) {
    out.push({
      text: '容易把留作扩展的码也算进本级的条数，因为它们看上去空着',
      at: steps.findIndex((s) => s.changes.some((c) => c.at === 'levels.0.used')) + 1,
      act: () => ({
        label: '',
        patch: { SHELF_0: { open: false, kept: ['', '', '0 个'] }, CAP_1: { value: '0 个' }, VERDICT: { value: `不可行，${final.levels[1]!.name}没有前缀` } },
        moves: [{ value: `${first.available} 个`, from: 'CAP_0', to: 'SHELF_0', arc: true }],
        message: `${first.name}要是把 ${first.available} 个码全用掉，就没有码留下来当前缀，${final.levels[1]!.name}一个编码也没有。留作扩展的码只能当更长操作码的开头，不能再当本级指令。`,
      }),
    });
  }
  const multi = final.levels.findIndex((l, i) => i < final.levels.length - 1 && (l.reserved ?? 0) > 1);
  if (multi >= 0) {
    const l = final.levels[multi]!;
    const nx = final.levels[multi + 1]!;
    const grow = nx.opBits - l.opBits;
    out.push({
      text: '容易每一级都只留 1 个码，因为课本的例子里多数级只留 1 个',
      at: steps.length,
      act: () => ({
        label: '',
        patch: { [`CAP_${multi + 1}`]: { value: `${2 ** grow} 个` } },
        moves: [{ value: `1 × 2^${grow}`, from: `SHELF_${multi}`, to: `CAP_${multi + 1}`, arc: true }],
        message: `只留 1 个码，${nx.name}只有 2^${grow} = ${2 ** grow} 个编码，${(p.levels[multi + 1]!.count ?? nx.used ?? 0) > 2 ** grow ? '不够它要的条数' : '后面几类可能就不够'}。留几个码要倒着算：后面一共要多少个编码，除以 2^${grow} 向上取整。这一题${l.name}留 ${l.reserved} 个。`,
      }),
    });
  }
  return out.slice(0, 3);
}

export const OP_QUESTION = { text: '每一类用掉几个码、留下几个码，下一类就有几个编码可用', at: ['FMT_0', 'CAP_0'] };
export const OP_CONCLUSION =
  '从地址最多的一类排起：第一类可用 2^操作码位数 个编码，每类从小到大取够自己的条数，其余的码全部留作扩展；下一类可用 = 上一类留下的码数 × 2^多出的操作码位数。哪一类要的条数比它可用的多，方案就不可行，要缩减前面某一类。';
export const OP_NEEDS = [{ href: '/4-ea', text: '指令格式：操作码和地址码' }];
