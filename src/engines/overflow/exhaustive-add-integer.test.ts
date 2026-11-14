import { describe, expect, it } from 'vitest';
import { exhaust } from './reference';

describe('穷举 n = 2…5：加法，定点整数', () => {
  it(
    '全部 x、y 与整数参照一致；有无进位、有无溢出的四种组合都出现',
    () => {
      const got = exhaust('加', '整数');
      expect(got.problems).toEqual([]);
      expect(got.count).toBe(64 + 256 + 1024 + 4096);
      for (const [combo, times] of Object.entries(got.combos)) expect(times, combo).toBeGreaterThan(0);
    },
    120_000,
  );
});
