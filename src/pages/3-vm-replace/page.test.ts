import { describe, expect, it } from 'vitest';
import { run } from '../../engines/vmreplace/model';
import { clampStep } from './kit';
import { filledColumns, polish, replaceStage } from './scene';
import { examples } from './setup';

describe('讲解的最后一步（命中率）', () => {
  for (const example of examples) {
    const raw = run(example.params);
    const trace = polish(raw);
    const count = example.params.pages!.length;
    it(`${example.label}：表的各列都还在，命中率写进 a 行最后一格`, () => {
      const total = trace.steps.length;
      expect(filledColumns(trace, total)).toBe(count);
      expect(filledColumns(trace, total - 1)).toBe(count);
      // 比较步上这一列还没填。
      expect(filledColumns(trace, 1)).toBe(0);
      expect(filledColumns(trace, 2)).toBe(1);
      const stage = replaceStage(trace, false, raw.table);
      const last = trace.steps[total - 1]!;
      const props = stage.bind.props({ state: last.state, flat: {}, index: total, step: last, changed: new Set() });
      const rows = props['tbl']!['rows'] as string[][];
      expect(rows[0]!.slice(0, count).every((cell) => cell !== '')).toBe(true);
      expect(rows[0]![count]).toBe(raw.result['命中率']);
      expect(rows[example.params.frames]!.filter((cell) => cell === '命中').length).toBe(Number(raw.result['命中次数']));
    });
  }
});

describe('步数', () => {
  it('上限跟着当前例题走：7 步的例题换成 10 步的，第 9 步不被截到 7', () => {
    expect(clampStep('9', 10)).toBe(9);
    expect(clampStep('9', 7)).toBe(7);
    expect(clampStep('x', 7)).toBe(0);
    expect(clampStep('-2', 7)).toBe(0);
  });
});
