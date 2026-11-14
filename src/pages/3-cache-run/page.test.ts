import { describe, expect, it } from 'vitest';
import { run } from '../../engines/cache/model';
import { validateTrace } from '../../engines/trace';
import { breakSetup, breakTrace } from './break-trace';
import { blankEntry, entryOf, grade, makeExercise } from './exercise';
import { cacheStage, withRowAsks } from './scene';
import { exampleParams, makeParams, parseSequence } from './setup';

describe('讲解的例题', () => {
  const trace = run(exampleParams);
  it('直接映射里，有一次缺失落在之前访问过的块上（被冲突顶出）', () => {
    const seen = new Set<string>();
    let conflict = false;
    for (const row of trace.table.rows) {
      const block = row.cells[1]!;
      if (row.cells[4] === '缺失' && seen.has(block)) conflict = true;
      seen.add(block);
    }
    expect(conflict).toBe(true);
  });
  it('换到 2 路组相联后缺失更少', () => {
    const set = run(makeParams('组相联', 'LRU', exampleParams.accesses));
    expect(Number(set.result['缺失次数'])).toBeLessThan(Number(trace.result['缺失次数']));
  });
  it('点选行的题，答案是引擎给的候选行', () => {
    const asked = withRowAsks(trace);
    expect(validateTrace(asked)).toEqual([]);
    const rowAsks = asked.steps.filter((step) => step.ask?.prompt.endsWith('放在哪一行'));
    expect(rowAsks.length).toBeGreaterThan(0);
    for (const step of rowAsks) expect(step.ask!.answer).toBe(`行 ${step.state.access.candidates[0]}`);
  });
  it('每个选项都能在台面上点到', () => {
    const { scene } = cacheStage(exampleParams);
    const titles = new Set(scene.parts.filter((p) => p.pick).map((p) => p.title ?? (p.props as { name?: string }).name));
    for (const step of withRowAsks(trace).steps) for (const option of step.ask?.options ?? []) expect(titles.has(option)).toBe(true);
  });
  it('调入的那一步，新块从主存板走到所在行', () => {
    const stage = cacheStage(exampleParams);
    const moved = trace.steps.flatMap((step) => stage.moves(step));
    expect(moved.some((move) => move.to.startsWith('r'))).toBe(true);
    const ids = new Set(stage.scene.wires.map((w) => w.id));
    for (const move of moved) for (const id of move.via ?? []) expect(ids.has(id)).toBe(true);
  });
});

describe('弄坏它', () => {
  const setup = breakSetup(exampleParams);
  it('每个错行都能演，Trace 合格', () => {
    expect(setup.wrongRows).not.toContain(setup.home);
    for (const r of setup.wrongRows) expect(validateTrace(breakTrace(exampleParams, r))).toEqual([]);
  });
});

describe('练习', () => {
  it('同一个种子出同一道题，题目可用', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const a = makeExercise(seed);
      expect(makeExercise(seed)).toEqual(a);
      const trace = run(a);
      expect(trace.table.rows.some((row) => row.cells[4] === '命中')).toBe(true);
    }
  });
  it('照引擎的答案填就全对，空着就从第 1 行错起', () => {
    const trace = run(makeExercise(7));
    expect(grade(trace, trace.table.rows.map((r) => entryOf(r.cells))).first).toBe(-1);
    expect(grade(trace, trace.table.rows.map(() => blankEntry())).first).toBe(0);
  });
  it('只错一格时指向那一行', () => {
    const trace = run(makeExercise(3));
    const entries = trace.table.rows.map((r) => entryOf(r.cells));
    entries[4] = { ...entries[4]!, tag: String(Number(entries[4]!.tag) + 1) };
    const result = grade(trace, entries);
    expect(result.first).toBe(4);
    expect(result.wrong[4]).toEqual([2]);
  });
});

describe('访问序列的写法', () => {
  it('认写操作和分隔符，报出越界', () => {
    expect(parseSequence('9 写10，8').accesses).toEqual([
      { address: 9, op: '读' },
      { address: 10, op: '写' },
      { address: 8, op: '读' },
    ]);
    expect(parseSequence('40').problems.length).toBe(1);
    expect(parseSequence('abc').problems.length).toBe(1);
  });
});
