import { describe, expect, it } from 'vitest';
import { BOOK_STORE, COMMANDS, decode, nextAddress, run } from '../../engines/micro/model';
import { validateTrace } from '../../engines/trace';
import { fieldsExercise, practiceParams, practiceWrong, withAsks } from './practice';
import { microBreak, microMistakes, microMoves, microWrong, rerun } from './scene';

describe('5-micro 练习', () => {
  it('前 400 个题号都能由引擎跑完，题目答案和引擎的状态一致', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const params = practiceParams(seed);
      const trace = withAsks(run(params));
      expect(validateTrace(trace)).toEqual([]);
      const asks = trace.steps.filter((step) => step.ask);
      expect(asks.length).toBeGreaterThanOrEqual(3);
      // 运算微指令：X 端、打入都只有一个答案，和直接解码一致。
      const word = params.store!.find((w) => w.addr === params.op)!;
      const d = decode(word.word);
      const x = asks.find((step) => step.ask!.options?.includes('DR'))!;
      expect(x.ask!.answer).toBe(d.x);
      const load = asks.find((step) => step.ask!.options?.includes('R3'))!;
      expect(load.ask!.answer).toBe(d.load[0]);
      // P_1 题的答案就是 OP。
      expect(asks[0]!.ask!.answer).toBe(nextAddress({ p1: 1, p2: 0, next: '0000' }, params.op!, 0));
    }
  });

  it('答错时演出来的后果指向学生选的那一位', () => {
    const trace = withAsks(run(practiceParams(7)));
    const i = trace.steps.findIndex((step) => step.ask?.options?.includes('DR'));
    const step = trace.steps[i]!;
    const wrong = (['R1', 'R2', 'DR'] as const).find((r) => r !== step.ask!.answer)!;
    const acted = practiceWrong(step.ask!, wrong, trace.steps[i - 1]!.state, step);
    expect(acted?.message).toContain(`第 ${COMMANDS.indexOf(`${wrong}→X`) + 1} 位`);
    const bitsAt = trace.steps.findIndex((s) => s.ask?.kind === 'bits');
    const bad = microWrong(trace.steps[bitsAt]!.ask!, '0000', trace.steps[bitsAt - 1]!.state, trace.steps[bitsAt]!);
    expect(bad?.patch['uAR']).toEqual({ bits: '0000' });
  });

  it('答题纸的题都能算出', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const ex = fieldsExercise(seed);
      expect(ex.trace.table.rows.length).toBeGreaterThan(1);
      expect(ex.words).toBeGreaterThan(0);
    }
  });
});

describe('5-micro 讲解', () => {
  for (const [a, b] of [
    [2, 5],
    [7, 6],
  ] as const) {
    it(`${a}+${b}：每一步都有移动或原地变化，常见错误和弄坏它都演得出来`, () => {
      const trace = run({ a, b });
      for (const step of trace.steps) if (step.level === 'cycle') expect(microMoves(step).length).toBeGreaterThan(3);
      const mistakes = microMistakes(trace);
      expect(mistakes.length).toBe(3);
      for (const m of mistakes) expect(m.act(trace.steps[m.at! - 1]!.state)?.message.length).toBeGreaterThan(10);
      const p2 = trace.steps.find((step) => step.state.branch && step.state.uIR?.p2)!;
      expect(microBreak(trace)(p2.state, null)?.message).toContain('引擎重跑');
    });
  }

  it('弄坏它：改一位后交给引擎重跑', () => {
    const fetchBroken = rerun({ a: 2, b: 5 }, '0000', (bits) => bits.slice(0, 17) + '0' + bits.slice(18));
    expect(fetchBroken.trace?.result['执行路径']).toBe('0000 → 0000');
    const p2 = rerun({ a: 2, b: 5 }, BOOK_STORE[2]!.addr, (bits) => bits.slice(0, 18) + '0' + bits.slice(19));
    expect(p2.trace?.result['R2']).not.toBe(run({ a: 2, b: 5 }).result['R2']);
  });
});
