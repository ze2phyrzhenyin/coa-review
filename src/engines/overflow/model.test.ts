import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { flatten } from '../trace';
import { BitsError } from '../../lib/bits';
import { COLUMN_SF1, COLUMN_SF2, operandFromUnits, run, solve, type Operation, type OverflowParams } from './model';
import { NOTATIONS, OPS, compare, lastState, operands, paramsOf, reference, rowBits, withPoint, type NotationName } from './reference';

// 穷举对拍在 exhaustive-*.test.ts（按运算和写法分成四个文件并行跑），固定用例在 golden.test.ts。
// 这里是 Trace 的结构、输入的几种给法、特殊情况和 fast-check 性质。

const params = paramsOf;
const last = lastState;

describe('「进位」和「溢出」是两回事', () => {
  const state = (x: string, y: string, op: Operation = '加') =>
    last(run({ x: { as: '真值', text: x }, y: { as: '真值', text: y }, n: 4, op, notation: '整数' }));

  it('有进位丢掉，但没有溢出', () => {
    const s = state('+1011', '-0101');
    expect([s.dropped, s.verdict, s.value]).toEqual(['1', '无溢出', '+0110']);
    const t = state('-0011', '-0100');
    expect([t.dropped, t.verdict, t.value]).toEqual(['1', '无溢出', '−0111']);
  });

  it('没有进位丢掉，却溢出了', () => {
    const s = state('+1010', '+0111');
    expect([s.dropped, s.verdict, s.sf1 + s.sf2, s.value]).toEqual(['0', '正溢', '01', '']);
    const t = state('+1011', '-0110', '减');
    expect([t.dropped, t.verdict, t.sf1 + t.sf2]).toEqual(['0', '正溢', '01']);
  });

  it('有进位丢掉，同时溢出；没有进位，也没有溢出', () => {
    const s = state('-1100', '-1000');
    expect([s.dropped, s.verdict, s.sf1 + s.sf2]).toEqual(['1', '负溢', '10']);
    const t = state('-1001', '+0110');
    expect([t.dropped, t.verdict, t.value]).toEqual(['0', '无溢出', '−0011']);
  });

  it('丢进位那一步只改 dropped，不碰溢出标志；讲解里说明两者无关', () => {
    const trace = run({ x: { as: '真值', text: '+1011' }, y: { as: '真值', text: '-0101' }, n: 4, op: '加', notation: '整数' });
    const drop = trace.steps.find((s) => s.changes.some((c) => c.at === 'dropped'))!;
    expect(drop.changes).toEqual([{ at: 'dropped', from: '', to: '1' }]);
    expect(drop.state.verdict).toBe('');
    expect(drop.why).toContain('模 2^6');
    expect(drop.why).toContain('丢进位和溢出是两回事');
  });
});

describe('Trace 的结构', () => {
  const sample = (op: Operation, notation: NotationName = '整数') => run(params(-9, 6, 4, op, notation));

  it('同样的参数得到完全相同的 Trace，且不改动传入的参数', () => {
    for (const op of OPS) {
      for (const notation of NOTATIONS) {
        const p = params(-9, 6, 4, op, notation);
        const frozen = JSON.stringify(p);
        Object.freeze(p);
        Object.freeze(p.x);
        Object.freeze(p.y);
        const first = run(p);
        const second = run(JSON.parse(frozen) as OverflowParams);
        expect(second).toEqual(first);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(JSON.stringify(p)).toBe(frozen);
        expect(first.params).toEqual(p);
      }
    }
  });

  it('步骤顺序：加法 n+8 步，减法 n+10 步；逐位相加是 beat，其余是 explain', () => {
    for (const n of [2, 3, 4, 5]) {
      const add = run(params(1, 1, n, '加', '整数'));
      const sub = run(params(1, 1, n, '减', '整数'));
      expect(add.steps).toHaveLength(n + 8);
      expect(sub.steps).toHaveLength(n + 10);
      expect(add.steps.map((s) => s.level)).toEqual([...Array(2).fill('explain'), ...Array(n + 2).fill('beat'), ...Array(4).fill('explain')]);
      expect(sub.steps.map((s) => s.level)).toEqual([...Array(4).fill('explain'), ...Array(n + 2).fill('beat'), ...Array(4).fill('explain')]);
      expect(add.steps.map((s) => s.id)).toEqual(add.steps.map((_, i) => `s${i + 1}`));
    }
  });

  it('每一步各改哪些位置（加法）', () => {
    const trace = sample('加');
    const touched = trace.steps.map((s) => s.changes.map((c) => c.at.replace(/\.\d+$/, '.#')).filter((at, i, all) => all.indexOf(at) === i));
    expect(touched).toEqual([
      ['rows.x.cells.#'],
      ['rows.y.cells.#'],
      ...Array(6).fill(['rows.carry.cells.#', 'rows.sum.cells.#']),
      ['dropped'],
      ['sf1', 'sf2', 'vBySign', 'verdict'],
      ['c0', 'cf', 'vByCarry'],
      ['conclusion', 'value'],
    ]);
  });

  it('每一步各改哪些位置（减法多出取反、加 1 两步）', () => {
    const trace = sample('减');
    const touched = trace.steps.slice(0, 4).map((s) => [...new Set(s.changes.map((c) => c.at.replace(/\.\d+$/, '.#')))]);
    expect(touched).toEqual([['rows.x.cells.#'], ['rows.y.cells.#'], ['rows.inverted.cells.#'], ['rows.negY.cells.#']]);
    expect(trace.steps[2]!.title).toContain('各位取反');
    expect(trace.steps[3]!.title).toContain('末位加 1');
    expect(trace.steps[3]!.why).toContain('从右往左找到');
  });

  it('逐位相加从最低位开始，一列一步，每步写一位和、一位进位', () => {
    const trace = sample('加');
    const beats = trace.steps.filter((s) => s.level === 'beat');
    expect(beats.map((s) => s.changes.find((c) => c.at.startsWith('rows.sum'))!.at)).toEqual([6, 5, 4, 3, 2, 1].map((c) => `rows.sum.cells.${c}`));
    expect(beats.map((s) => s.changes.find((c) => c.at.startsWith('rows.carry'))!.at)).toEqual([5, 4, 3, 2, 1, 0].map((c) => `rows.carry.cells.${c}`));
    for (const beat of beats) expect(beat.changes).toHaveLength(2);
    expect(beats.map((s) => s.title.split('：')[0])).toEqual(['右起第 1 位', '右起第 2 位', '右起第 3 位', '右起第 4 位', '第二符号位', '最高符号位']);
    // 高亮的位置都是状态里真实存在的路径
    for (const step of trace.steps) {
      const paths = Object.keys(flatten(step.state));
      for (const at of step.focus) expect(paths, `${step.id} ${at}`).toContain(at);
    }
  });

  it('每一步都有 title、why、教材页码；预测题只在两步上', () => {
    for (const op of OPS) {
      for (const notation of NOTATIONS) {
        const trace = sample(op, notation);
        for (const step of trace.steps) {
          expect(step.title.trim().length, step.id).toBeGreaterThan(0);
          expect(step.why.trim().length, step.id).toBeGreaterThan(0);
          expect(step.ref, step.id).toMatch(/^教材 p\d+/);
        }
        const asks = trace.steps.filter((s) => s.ask);
        expect(asks).toHaveLength(2);
        // 符号位的预测题挂在第二符号位那一列，此时两个符号位都还没写出来
        const index = trace.steps.indexOf(asks[0]!);
        const before = trace.steps[index - 1]!.state;
        expect(asks[0]!.title).toMatch(/^第二符号位/);
        expect([before.rows.sum.cells[COLUMN_SF1], before.rows.sum.cells[COLUMN_SF2]]).toEqual(['', '']);
        // 溢出的选择题挂在读符号位那一步，此时还没有判定
        const decide = trace.steps.indexOf(asks[1]!);
        expect(trace.steps[decide - 1]!.state.verdict).toBe('');
        expect(asks[1]!.state.verdict).not.toBe('');
        for (const step of asks) expect(step.ask!.hint).not.toContain(step.ask!.answer);
      }
    }
  });

  it('回放 changes 能还原每一步的状态', () => {
    for (const op of OPS) {
      const trace = sample(op, '小数');
      let flat = flatten(trace.initial);
      for (const step of trace.steps) {
        for (const c of step.changes) {
          expect(flat[c.at] ?? '').toBe(c.from);
          flat = { ...flat, [c.at]: c.to };
        }
        expect(flat).toEqual(flatten(step.state));
      }
    }
  });

  it('初始状态是空竖式', () => {
    const trace = sample('减');
    const flat = flatten(trace.initial);
    for (const [at, v] of Object.entries(flat)) if (!at.endsWith('.label')) expect(v, at).toBe(at === 'adder' ? 'null' : '');
    expect(trace.initial.rows.sum.label).toBe('[x−y]变补');
    expect(sample('加').initial.rows.sum.label).toBe('[x+y]变补');
  });

  it('解题表是纸面竖式：定点整数', () => {
    const trace = run(params(10, 7, 4, '加', '整数'));
    expect(trace.table.columns).toEqual(['', '出界', 'S_f1', 'S_f2', '2^3', '2^2', '2^1', '2^0']);
    expect(trace.table.rows).toEqual([
      { cells: ['进位', '0', '0', '1', '1', '1', '0', ''], step: 's3' },
      { cells: ['[x]变补', '', '0', '0', '1', '0', '1', '0'], step: 's1' },
      { cells: ['+ [y]变补', '', '0', '0', '0', '1', '1', '1'], step: 's2' },
      { cells: ['[x+y]变补', '', '0', '1', '0', '0', '0', '1'], step: 's9' },
    ]);
  });

  it('解题表是纸面竖式：定点小数带小数点一列，减法多两行', () => {
    const trace = run(params(-4, 9, 4, '减', '小数'));
    expect(trace.table.columns).toEqual(['', '出界', 'S_f1', 'S_f2', '.', '2^-1', '2^-2', '2^-3', '2^-4']);
    expect(trace.table.rows).toEqual([
      { cells: ['[y]变补', '', '0', '0', '.', '1', '0', '0', '1'], step: 's2' },
      { cells: ['各位取反', '', '1', '1', '.', '0', '1', '1', '0'], step: 's3' },
      { cells: ['进位', '1', '1', '1', '', '1', '0', '0', ''], step: 's5' },
      { cells: ['[x]变补', '', '1', '1', '.', '1', '1', '0', '0'], step: 's1' },
      { cells: ['+ [−y]变补', '', '1', '1', '.', '0', '1', '1', '1'], step: 's4' },
      { cells: ['[x−y]变补', '', '1', '1', '.', '0', '0', '1', '1'], step: 's11' },
    ]);
    expect(trace.result).toEqual({ 结果的变形补码: '11.0011', 是否溢出: '无溢出', 真值: '−0.1101' });
  });

  it('解题表每一行指向的步，正好是写出这一行的那一步', () => {
    for (const op of OPS) {
      const trace = sample(op);
      const ids = new Set(trace.steps.map((s) => s.id));
      for (const row of trace.table.rows) {
        expect(row.step && ids.has(row.step)).toBe(true);
        expect(row.cells).toHaveLength(trace.table.columns.length);
      }
    }
  });

  it('前提里列出写法、位数、运算、操作数、模和范围', () => {
    expect(run(params(10, 7, 4, '加', '整数')).conditions).toEqual([
      { label: '写法', value: '定点整数' },
      { label: '数值位', value: 'n = 4' },
      { label: '运算', value: 'x + y' },
      { label: 'x', value: '+1010' },
      { label: 'y', value: '+0111' },
      { label: '变形补码', value: '6 位：2 个符号位加 4 个数值位，模 2^6' },
      { label: '表示范围', value: '−10000 到 +1111' },
    ]);
    const fraction = run({ x: { as: '机器数', bits: '1.1100' }, y: { as: '机器数', bits: '00.1001' }, n: 4, op: '减', notation: '小数' }).conditions;
    expect(fraction).toEqual([
      { label: '写法', value: '定点小数' },
      { label: '数值位', value: 'n = 4' },
      { label: '运算', value: 'x − y' },
      { label: '[x]补', value: '1.1100' },
      { label: '[y]变补', value: '00.1001' },
      { label: '变形补码', value: '6 位：2 个符号位加 4 个数值位，模 4' },
      { label: '表示范围', value: '−1.0000 到 +0.1111' },
    ]);
  });

  it('文字里没有漏填的占位，也不用被替换掉的旧称', () => {
    for (const n of [2, 3]) {
      for (const op of OPS) {
        for (const notation of NOTATIONS) {
          for (const x of operands(n)) {
            for (const y of operands(n)) {
              const trace = run(params(x, y, n, op, notation));
              const text = JSON.stringify([trace.conditions, trace.steps.map((s) => [s.title, s.why, s.ref, s.ask ?? '']), trace.result, trace.table]);
              expect(text).not.toMatch(/undefined|NaN|null|\[object|双符号位补码|！|!/);
            }
          }
        }
      }
    }
  });
});

describe('操作数的几种给法', () => {
  it('真值、补码、变形补码三种给法得到相同的竖式和结论', () => {
    for (const notation of NOTATIONS) {
      for (const op of OPS) {
        for (const x of operands(2)) {
          for (const y of operands(2)) {
            const want = reference(x, y, 2, op);
            const byValue = last(run(params(x, y, 2, op, notation)));
            const twos = (bits: string) => (notation === '整数' ? bits.slice(1) : `${bits.charAt(1)}.${bits.slice(2)}`);
            const byTwos = last(run({ x: { as: '机器数', bits: twos(want.x) }, y: { as: '机器数', bits: twos(want.y) }, n: 2, op, notation }));
            const byModified = last(
              run({ x: { as: '机器数', bits: withPoint(want.x, notation) }, y: { as: '机器数', bits: withPoint(want.y, notation) }, n: 2, op, notation }),
            );
            expect(byTwos).toEqual(byValue);
            expect(byModified).toEqual(byValue);
          }
        }
      }
    }
  });

  it('operandFromUnits 构造的参数与手写真值等价', () => {
    for (const notation of NOTATIONS) {
      for (const x of operands(4)) {
        const made = operandFromUnits(x, 4, notation);
        const p = { x: made, y: made, n: 4, op: '加' as const, notation };
        expect(solve(p).xUnits).toBe(x);
      }
    }
  });

  it('讲解随给法变化：正数、负数、最小负数、补码、变形补码', () => {
    const first = (x: OverflowParams['x'], notation: NotationName = '整数') =>
      run({ x, y: { as: '真值', text: '0' }, n: 4, op: '加', notation }).steps[0]!;
    expect(first({ as: '真值', text: '+1010' }).title).toBe('写出 [x]变补 = 001010');
    expect(first({ as: '真值', text: '+1010' }).why).toBe('x = +1010 不是负数，两个符号位写 00，后面接 4 位数值 1010。');
    expect(first({ as: '真值', text: '-1001' }).why).toBe('x = −1001 是负数，两个符号位写 11。数值位由 1001 各位取反得 0110，末位加 1 得 0111。');
    expect(first({ as: '真值', text: '-10000' }).why).toContain('最小负数');
    expect(first({ as: '机器数', bits: '10111' }).why).toBe('题目给的 [x]补 = 10111 只有一个符号位。把符号位 1 再写一遍放到最前面，值不变，x = −1001。');
    expect(first({ as: '机器数', bits: '110111' }).why).toContain('已经是变形补码');
    expect(first({ as: '真值', text: '-0.1001' }, '小数').title).toBe('写出 [x]变补 = 11.0111');
  });

  it('非法参数抛出说明原因的错误', () => {
    const base = { x: { as: '真值', text: '+1010' }, y: { as: '真值', text: '+0111' }, n: 4, op: '加', notation: '整数' } as const;
    const bad: [Partial<Record<keyof OverflowParams, unknown>>, RegExp][] = [
      [{ x: { as: '真值', text: '+10000' } }, /x = \+10000 超出范围：4 位数值位只能表示 −10000 到 \+1111/],
      [{ y: { as: '真值', text: '-10001' } }, /y = −10001 超出范围/],
      [{ x: { as: '真值', text: '0.101' } }, /不带小数点/],
      [{ x: { as: '真值', text: '12' } }, /不是二进制真值/],
      [{ x: { as: '机器数', bits: '0101' } }, /应为 5 位，或写成 6 位的变形补码，收到 4 位/],
      [{ x: { as: '机器数', bits: '0101010' } }, /收到 7 位/],
      [{ x: { as: '机器数', bits: '010101' } }, /两个符号位不同/],
      [{ x: { as: '机器数', bits: '101010' } }, /两个符号位不同/],
      [{ x: { as: '机器数', bits: '0.1010' } }, /定点整数的机器码不带小数点/],
      [{ x: { as: '机器数', bits: '01x10' } }, /不是机器码/],
      [{ x: { as: 'other', text: '1' } }, /as 只能是「真值」或「机器数」/],
      [{ x: undefined }, /缺少操作数 x/],
      [{ y: null }, /缺少操作数 y/],
      [{ x: { as: '真值', text: 10 } }, /真值要写成字符串/],
      [{ y: { as: '机器数' } }, /机器数要写成字符串/],
      [{ n: 0 }, /数值位数/],
      [{ n: 2.5 }, /数值位数/],
      [{ op: 'mul' }, /运算只能是/],
      [{ notation: 'float' }, /写法只能是/],
    ];
    for (const [patch, message] of bad) {
      const p = { ...base, ...patch } as unknown as OverflowParams;
      expect(() => run(p), JSON.stringify(patch)).toThrow(message);
      expect(() => solve(p), JSON.stringify(patch)).toThrow(BitsError);
    }
    const fraction = { ...base, notation: '小数' } as const;
    expect(() => run({ ...fraction, x: { as: '真值', text: '+1.0' }, y: { as: '真值', text: '0' } })).toThrow(/x = \+1\.0000 超出范围/);
    expect(() => run({ ...fraction, x: { as: '机器数', bits: '011.010' }, y: { as: '真值', text: '0' } })).toThrow(/小数点应在符号位后面/);
    expect(() => run({ ...fraction, x: { as: '真值', text: '0.10101' }, y: { as: '真值', text: '0' } })).toThrow(/写不下/);
  });
});

describe('减去最小负数：−y 写不成 n+1 位补码', () => {
  it('[−y]变补 的符号位是 01，结论仍然正确，C_f、C_0 按加法器重算', () => {
    for (const n of [2, 3, 4, 5]) {
      for (const x of operands(n)) {
        const p = params(x, -(2 ** n), n, '减', '整数');
        const trace = run(p);
        const state = last(trace);
        const solution = solve(p);
        expect(rowBits(state.rows.negY!.cells)).toBe(`01${'0'.repeat(n)}`);
        expect(solution.carriesFromRow).toBe(false);
        expect(state.verdict).toBe(x >= 0 ? '正溢' : '无溢出');
        expect(state.vByCarry).toBe(state.vBySign);
        // 加法器的做法：[x]补 + [y]补 各位取反 + 1，用整数重算两个进位
        const half = 2 ** n;
        const xs = ((x % (2 * half)) + 2 * half) % (2 * half);
        const notY = half - 1;
        expect(state.c0).toBe(String(Math.floor(((xs % half) + (notY % half) + 1) / half)));
        expect(state.cf).toBe(String(Math.floor((xs + notY + 1) / (2 * half))));
        // 进位行里的两格在这里会给出相反的结论，所以引擎不用它们，也不高亮它们
        const fromRow = state.rows.carry.cells[COLUMN_SF1] === state.rows.carry.cells[COLUMN_SF2] ? '0' : '1';
        expect(fromRow).not.toBe(state.vBySign);
        const confirm = trace.steps[trace.steps.length - 2]!;
        expect(confirm.focus).toEqual(['adder.carry.cells.1', 'adder.carry.cells.2', 'cf', 'c0', 'vByCarry']);
        expect(confirm.why).toContain('加法器做减法的办法重算');
        expect(confirm.why).toContain('上面进位行里的两格不能当作 C_f、C_0');
        // 表上：竖式进位行注明此例不读；加法器进位行的 S_f1、S_f2 两格就是文字里的 C_f、C_0
        const labels = trace.table.rows.map((r) => r.cells[0]);
        expect(labels).toContain('进位（此例不读 C_f、C_0）');
        expect(labels).not.toContain('进位');
        const adderRow = trace.table.rows.find((r) => r.cells[0] === '加法器进位（读 C_f、C_0）')!;
        expect(adderRow.step).toBe(confirm.id);
        expect([adderRow.cells[2], adderRow.cells[3]]).toEqual([state.cf, state.c0]);
        expect(adderRow.cells[adderRow.cells.length - 1]).toBe('1');
        expect(state.adder!.carry.cells[1]).toBe(state.cf);
        expect(state.adder!.carry.cells[2]).toBe(state.c0);
        expect(state.rows.carry.label).toBe('进位（此例不读 C_f、C_0）');
        // 加法器的和是结果的低 n+1 位
        expect(rowBits(state.adder!.sum.cells)).toBe(rowBits(state.rows.sum.cells).slice(1));
        expect(trace.table.rows.slice(-4).map((r) => r.cells[0])).toEqual(['加法器进位（读 C_f、C_0）', '[x]补', '+ [y]补 各位取反', '加法器的和']);
        expect(confirm.ref).toContain('p39');
        expect(trace.steps[3]!.why).toContain('两个符号位是 01');
      }
    }
  });

  it('其余情况 C_f、C_0 就是进位行里进入两个符号位列的进位', () => {
    const trace = run(params(-9, 6, 4, '减', '整数'));
    const confirm = trace.steps[trace.steps.length - 2]!;
    expect(confirm.focus).toEqual(['rows.carry.cells.1', 'rows.carry.cells.2', 'cf', 'c0', 'vByCarry']);
    expect(confirm.ref).toBe('教材 p38');
  });
});

describe('性质（fast-check，n 到 16）', () => {
  const anyCase = fc
    .integer({ min: 1, max: 16 })
    .chain((n) =>
      fc.record({
        n: fc.constant(n),
        x: fc.integer({ min: -(2 ** n), max: 2 ** n - 1 }),
        y: fc.integer({ min: -(2 ** n), max: 2 ** n - 1 }),
        op: fc.constantFrom<Operation>('加', '减'),
        notation: fc.constantFrom<NotationName>('整数', '小数'),
      }),
    );

  it('对任意操作数：与参照一致，两种判法一致，Trace 合格', () => {
    fc.assert(
      fc.property(anyCase, ({ n, x, y, op, notation }) => {
        expect(compare(x, y, n, op, notation).problems).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });

  it('和的变形补码按模 2^(n+2) 总等于数学结果，溢出时也是', () => {
    fc.assert(
      fc.property(anyCase, ({ n, x, y, op, notation }) => {
        const s = solve(params(x, y, n, op, notation));
        expect(s.exactUnits).toBe(op === '加' ? x + y : x - y);
        expect(parseInt(s.sumBits, 2)).toBe((((s.exactUnits % 2 ** (n + 2)) + 2 ** (n + 2)) % 2 ** (n + 2)));
      }),
    );
  });

  it('加法可交换；x − y 与 x + (−y) 的和、结论相同', () => {
    fc.assert(
      fc.property(anyCase, ({ n, x, y, notation }) => {
        const xy = solve(params(x, y, n, '加', notation));
        const yx = solve(params(y, x, n, '加', notation));
        expect([yx.sumBits, yx.verdict, yx.carries]).toEqual([xy.sumBits, xy.verdict, xy.carries]);
        if (y !== -(2 ** n)) {
          const sub = solve(params(x, y, n, '减', notation));
          const add = solve(params(x, -y, n, '加', notation));
          expect([sub.sumBits, sub.verdict, sub.carries, sub.cf, sub.c0]).toEqual([add.sumBits, add.verdict, add.carries, add.cf, add.c0]);
        }
      }),
    );
  });

  it('加法：符号不同的两数相加不会溢出；溢出时结果的第二符号位与两个加数的符号相反', () => {
    fc.assert(
      fc.property(anyCase, ({ n, x, y, notation }) => {
        const s = solve(params(x, y, n, '加', notation));
        if (x >= 0 !== y >= 0) expect(s.verdict).toBe('无溢出');
        if (s.verdict !== '无溢出') {
          expect(s.sf2).toBe(x >= 0 ? '1' : '0');
          expect(s.sf1).toBe(x >= 0 ? '0' : '1');
        }
      }),
    );
  });

  it('两种写法只差小数点：竖式的每一格、结论的种类都相同', () => {
    fc.assert(
      fc.property(anyCase, ({ n, x, y, op }) => {
        const a = last(run(params(x, y, n, op, '整数')));
        const b = last(run(params(x, y, n, op, '小数')));
        expect(b.rows).toEqual(a.rows);
        expect([b.dropped, b.sf1, b.sf2, b.cf, b.c0, b.vBySign, b.vByCarry, b.verdict]).toEqual([a.dropped, a.sf1, a.sf2, a.cf, a.c0, a.vBySign, a.vByCarry, a.verdict]);
      }),
      { numRuns: 100 },
    );
  });
});
