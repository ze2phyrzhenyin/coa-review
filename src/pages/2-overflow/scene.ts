/**
 * 变形补码竖式的场景：一格一张翻片，摆成纸面竖式的样子。部件位置只取决于题目的位数和运算，
 * 画面只取决于当前步的状态。页面不算任何结果：位、进位、判定都取自引擎的 Trace 和 solve()。
 *
 * 版式（台面坐标，z 朝向观看的人）：
 *   上方是竖式（减法多 [y]变补、各位取反 两行），进位行在 [x]变补 上面；
 *   左边是「丢掉的进位」托盘和预测符号位时的四个候选；
 *   竖式下面是判定牌、两个判定式，最下面是数轴：负溢 | 能表示的范围 | 正溢，结果落在哪一段。
 */
import type { Step, Trace } from '../../engines/trace';
import type { OverflowParams, OverflowSolution, OverflowState } from '../../engines/overflow/model';
import { formatDecimal, formatValue } from '../../lib/bits';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage } from '../../player/Player';
import { signAskIndex } from './adapt';

type RowKey = 'y' | 'inverted' | 'carry' | 'x' | 'negY' | 'sum';
type Table = Parameters<typeof bindTable<OverflowState>>[0];

export interface OverflowScene {
  scene: SceneSpec;
  bind: Binding<OverflowState>;
  moves: (step: Step<OverflowState>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  /** 符号位题在结果行的两个符号位上翻位片作答。 */
  flipPart: (ask: unknown, index: number) => string | null;
  /** 答错时按学生的答案演后果。 */
  wrong: (ask: { kind: string }, value: string) => Breakage | null;
}

/** 符号位与数值位之间多空的一点、行距。列距宽屏 1.0，窄屏 0.9（整张竖式不出左右边）。 */
const SIGN_GAP = 0.35;
const ROW = 1.3;
const HALF_TILE = 0.45;

function conditionValue(trace: Trace<OverflowParams, OverflowState>, label: string): string {
  return trace.conditions.find((item) => item.label === label)?.value ?? '';
}

/** 粗估一行字在台面上的宽度：中文按字高算，其余按六成。 */
function textWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.6;
  return w;
}

export function overflowScene(trace: Trace<OverflowParams, OverflowState>, solution: OverflowSolution, compact = false): OverflowScene {
  const PITCH = compact ? 0.9 : 1.0;
  const { width: W, n, notation, op } = solution;
  const point = notation === '小数';
  const subtract = op === '减';
  const keys: RowKey[] = subtract ? ['y', 'inverted', 'carry', 'x', 'negY', 'sum'] : ['carry', 'x', 'y', 'sum'];
  const addend: RowKey = subtract ? 'negY' : 'y';
  const last = trace.steps[trace.steps.length - 1]?.state ?? trace.initial;
  const columns = trace.table.columns;
  // 解题表的行与 keys 一一对应，行名直接用表里的。
  const rowLabel = (key: RowKey, i: number): string => trace.table.rows[i]?.cells[0] ?? trace.initial.rows[key]?.label ?? key;
  const colName = (c: number): string => (c < 3 ? (columns[c + 1] ?? '') : (columns[c + 1 + (point ? 1 : 0)] ?? ''));
  const modulus = /模 (\S+)$/.exec(conditionValue(trace, '变形补码'))?.[1] ?? '';
  const [low = '', high = ''] = conditionValue(trace, '表示范围').split(' 到 ');
  const expression = conditionValue(trace, '运算').replace(/\s/g, '');

  const span = W * PITCH + SIGN_GAP;
  const cx = (c: number): number => c * PITCH + (c >= 3 ? SIGN_GAP : 0) - span / 2;
  const rz = (key: RowKey): number => keys.indexOf(key) * ROW;
  const zSum = rz('sum');

  const parts: PartSpec[] = [];
  const table: Table = {};

  // 列头：符号位和各数值位的权。
  const zHead = -0.95;
  for (let c = 1; c <= W; c++) {
    const name = colName(c);
    parts.push({ id: `head-${c}`, kind: 'label', position: [cx(c), zHead], props: { text: name, size: compact ? 0.36 : c < 3 ? 0.34 : 0.31, tone: c < 3 ? 'text' : 'muted', weight: c < 3 ? 600 : 500 } });
  }

  keys.forEach((key, i) => {
    const label = rowLabel(key, i);
    const firstCol = key === 'carry' ? 0 : 1;
    for (let c = firstCol; c <= W; c++) {
      const path = `rows.${key}.cells.${c}`;
      // 没写的格子是空槽（像答题纸上的空格），写出时从空槽直接翻成这一位，不先露出相反的数字。
      const placeholder = ' ';
      const id = `${key}-${c}`;
      const title = key === 'carry' ? (c === 0 ? '最高符号位向外的进位' : `进入 ${colName(c)} 的进位`) : `${label} ${colName(c)}`;
      // 一行同时写出时从右往左逐格错开 25 毫秒。
      parts.push({ id, kind: 'bits', position: [cx(c), rz(key)], props: { bits: placeholder }, title, delay: (W - c) * 25 });
      const dropsHere = key === 'carry' && c === 0;
      table[id] = {
        bits: from(path, (ctx) => ctx.flat[path] || placeholder),
        hidden: from(dropsHere ? [path, 'dropped'] : path, (ctx) => dropsHere && ctx.state.dropped === '1'),
      };
    }
    if (point && key !== 'carry') {
      parts.push({ id: `dot-${key}`, kind: 'label', position: [(cx(2) + cx(3)) / 2, rz(key) + 0.18], props: { text: '.', size: 0.5, weight: 700 } });
    }
    const labelSize = compact ? 0.32 : 0.31;
    const shown = label;
    parts.push({
      id: `label-${key}`,
      kind: 'label',
      position: [cx(W) + HALF_TILE + (compact ? 0.22 : 0.35) + textWidth(shown, labelSize) / 2, rz(key)],
      props: { text: shown, size: labelSize, tone: key === 'carry' ? 'muted' : 'text' },
    });
  });

  // 丢掉的进位落进最左边的托盘。窄屏上托盘是「出界」列里进位格正下方的一小格（下一行这一列本来是空的），
  // 不加宽台面，也不会在舞台上沿外。
  const trayWidth = compact ? 1.1 : 2.3;
  const below = keys[keys.indexOf('carry') + 1] ?? 'x';
  if (compact) {
    // 窄屏：一块小牌「出界 1」「出界 无」，没有名牌，不会压到上面那一格。
    parts.push({ id: 'drop', kind: 'label', position: [cx(0) - 0.1, rz(below)], props: { text: '', plate: true, size: 0.32 } });
    table.drop = { text: from('dropped', (ctx) => (ctx.state.dropped === '1' ? '出界 1' : ctx.state.dropped === '0' ? '出界 无' : '')), hidden: from('dropped', (ctx) => ctx.state.dropped === '' || ctx.state.dropped === null) };
  } else {
    parts.push({ id: 'drop', kind: 'register', position: [cx(0) - HALF_TILE - 0.3 - trayWidth / 2, rz('carry')], props: { name: '丢掉的进位', value: '', width: trayWidth } });
    table.drop = { value: from('dropped', (ctx) => (ctx.state.dropped === '1' ? `1，权 ${modulus}` : ctx.state.dropped === '0' ? '无' : '')) };
  }

  // 预测两个符号位：就在结果行的两个符号位上翻位片，只在出题那一屏出现（那时这两格还没写）。
  const asking = signAskIndex(trace);
  parts.push({ id: 'sign', kind: 'bits', position: [(cx(1) + cx(2)) / 2, zSum], props: { bits: '  ', pitch: cx(2) - cx(1), group: 8 }, pick: true, title: '结果的两个符号位' });
  table.sign = { hidden: (ctx) => ctx.index !== asking };

  // 两个符号位读出来的判定，贴在结果的符号位下面。
  parts.push({ id: 'verdict', kind: 'label', position: [(cx(1) + cx(2)) / 2, zSum + 1.0], props: { text: '', plate: true, size: 0.3, weight: 600 } });
  table.verdict = {
    text: from(['sf1', 'sf2', 'verdict'], (ctx) => (ctx.state.verdict ? `${ctx.state.sf1}${ctx.state.sf2} ${ctx.state.verdict}` : '')),
    hidden: from('verdict', (ctx) => !ctx.state.verdict),
  };

  // 两个判定式并排。
  const formulaWidth = compact ? Math.min(3.4, (span + 0.6) / 2) : 3.4;
  const zFormula = zSum + 3.1;
  parts.push({ id: 'vs', kind: 'register', position: [-(formulaWidth / 2 + 0.25), zFormula], props: { name: 'V = S_f1 ⊕ S_f2', value: '', width: formulaWidth } });
  parts.push({ id: 'vc', kind: 'register', position: [formulaWidth / 2 + 0.25, zFormula], props: { name: 'V = C_f ⊕ C_0', value: '', width: formulaWidth } });
  table.vs = { value: from(['sf1', 'sf2', 'vBySign'], (ctx) => (ctx.state.vBySign ? `${ctx.state.sf1} ⊕ ${ctx.state.sf2} = ${ctx.state.vBySign}` : '')) };
  table.vc = { value: from(['cf', 'c0', 'vByCarry'], (ctx) => (ctx.state.vByCarry ? `${ctx.state.cf} ⊕ ${ctx.state.c0} = ${ctx.state.vByCarry}` : '')) };

  // 数轴：三段，宽度按 −2^(n+1) 到 2^(n+1) 等比例摆，能表示的范围正好占中间一半。
  const sideText = Math.max(textWidth(`< ${low}`, 0.36), textWidth(`> ${high}`, 0.36));
  const midText = textWidth(`${low} 到 ${high}`, 0.36);
  // 窄屏上数轴不比竖式宽，三段都能同时入画。
  // 窄屏上数轴三段的字不缩小：分区宽度按字来定，必要时比竖式宽一点。
  const L = compact ? Math.max(span + 0.9, 4 * (sideText + 0.3), 2 * (midText + 0.3)) : Math.max(10, span + 2.4, 4 * (sideText + 0.8), 2 * (midText + 0.8));
  const zLine = zFormula + 1.75;
  const zones: { id: string; title: '负溢' | '无溢出' | '正溢'; x: number; w: number; value: string }[] = [
    { id: 'zone-neg', title: '负溢', x: (-3 * L) / 8, w: L / 4 - 0.12, value: `< ${low}` },
    { id: 'zone-ok', title: '无溢出', x: 0, w: L / 2 - 0.12, value: `${low} 到 ${high}` },
    { id: 'zone-pos', title: '正溢', x: (3 * L) / 8, w: L / 4 - 0.12, value: `> ${high}` },
  ];
  for (const zone of zones) {
    parts.push({ id: zone.id, kind: 'register', position: [zone.x, zLine], props: { name: zone.title, value: zone.value, width: zone.w }, pick: true, title: zone.title });
    table[zone.id] = {
      focus: (ctx) => ctx.state.verdict === zone.title && (ctx.changed.has('verdict') || ctx.changed.has('conclusion')),
    };
  }

  // 结果落点：按真值在数轴上的位置摆在数轴前面，整块落在它所属的那一段里；到结论那一步才出现。
  const exact = solution.exactUnits;
  const exactText = formatValue(exact, n, notation);
  const markWidth = Math.max(1.6, textWidth(exactText, 0.36) + 0.5);
  const home = zones.find((zone) => zone.title === solution.verdict) ?? zones[1]!;
  const xv = (exact / 2 ** (n + 1)) * (L / 2);
  const inset = Math.max(0, home.w / 2 - markWidth / 2);
  const markX = Math.max(home.x - inset, Math.min(home.x + inset, xv));
  parts.push({ id: 'mark', kind: 'register', position: [markX, zLine + 1.5], props: { name: `${expression} = ${formatDecimal(exact, n, notation)}`, value: '', width: markWidth } });
  table.mark = {
    value: from('conclusion', (ctx) => (ctx.state.conclusion ? exactText : '')),
    hidden: from('conclusion', (ctx) => !ctx.state.conclusion),
  };

  const scene: SceneSpec = { parts, wires: [] };
  const bind = bindTable<OverflowState>(table);

  const moves = (step: Step<OverflowState>): Move[] => {
    const out: Move[] = [];
    const s = step.state;
    const changed = new Map(step.changes.map((change) => [change.at, change.to]));
    for (const [at, to] of changed) {
      const match = /^rows\.carry\.cells\.(\d+)$/.exec(at);
      // 进位从右边一列的上方跳到左边一列。最低位右边没有进位，起点是那一列上方的空位。
      if (match && to === '1') {
        const k = Number(match[1]);
        out.push({ value: '1', from: `carry-${k + 1}`, to: `carry-${k}`, arc: true });
      }
    }
    if (changed.get('dropped') === '1') out.push({ value: '1', from: 'carry-0', to: 'drop', arc: true });
    if (changed.has('verdict')) out.push({ value: `${s.sf1}${s.sf2}`, from: 'sum-1', to: 'verdict', arc: true });
    if (changed.has('vByCarry') && step.focus.includes('rows.carry.cells.1')) {
      out.push({ value: `C_f = ${s.cf}`, from: 'carry-1', to: 'vc', arc: true });
      out.push({ value: `C_0 = ${s.c0}`, from: 'carry-2', to: 'vc', arc: true, phase: 1 });
    }
    if (changed.has('conclusion')) out.push({ value: exactText, from: 'vs', to: 'mark', arc: true });
    return out;
  };

  const plain: Record<string, string> = {
    dropped: '丢掉的进位',
    sf1: 'S_f1',
    sf2: 'S_f2',
    cf: 'C_f',
    c0: 'C_0',
    vBySign: 'V = S_f1 ⊕ S_f2',
    vByCarry: 'V = C_f ⊕ C_0',
    verdict: '判定',
    value: '真值',
    conclusion: '结论',
  };
  const names = (path: string): string => {
    const match = /^rows\.(\w+)\.cells\.(\d+)$/.exec(path);
    if (match) {
      const key = match[1] as RowKey;
      const c = Number(match[2]);
      if (key === 'carry') return c === 0 ? '向外的进位' : `进入 ${colName(c)} 的进位`;
      const label = rowLabel(key, keys.indexOf(key)).replace(/^\+ /, '');
      return `${label} ${colName(c)}`;
    }
    return plain[path] ?? path;
  };

  /** 「变化」里的值：丢掉的进位 0 写成「无」，和台面上的托盘一致。 */
  const values = (path: string, value: string): string => (path === 'dropped' ? (value === '0' ? '无' : value === '1' ? '1，丢掉' : value) : value);
  const flipPart = (_ask: unknown, index: number): string | null => (index === asking ? 'sign' : null);

  /** 两个符号位读出的判定：00、11 无溢出，01 正溢，10 负溢（教材 p37）。 */
  const readSigns = (bits: string): string => (bits === '01' ? '正溢' : bits === '10' ? '负溢' : '无溢出');
  const wrong = (ask: { kind: string }, value: string): Breakage | null => {
    if (ask.kind === 'bits' && /^[01]{2}$/.test(value)) {
      // 学生翻出的两个符号位先写进结果行，判定牌按它们读出来，过一会儿退回。
      return {
        label: '',
        patch: { sign: { bits: value, hidden: false }, verdict: { text: `${value} ${readSigns(value)}`, hidden: false } },
        moves: [{ value, from: 'sign', to: 'verdict', arc: true }],
        message: `按你翻的 ${value}，判定牌会写「${readSigns(value)}」。`,
      };
    }
    const zone = zones.find((item) => item.title === value);
    if (zone) {
      return {
        label: '',
        patch: { [zone.id]: { focus: true } },
        moves: [{ value: zone.title, from: 'sum-1', to: zone.id, arc: true }],
        message: value === '无溢出' ? '判成无溢出，就是说结果在能表示的范围里，这几位可以直接当结果。' : `判成${value}，就是说真实结果${value === '正溢' ? '超过上限' : '低于下限'}。`,
      };
    }
    return null;
  };

  return { scene, bind, moves, names, values, flipPart, wrong };
}
