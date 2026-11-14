/**
 * 出题用的确定性随机数（mulberry32）。同一个种子永远给出同一串数，出题器靠它做到可重放、可写进网址。
 * 引擎里不许用 Math.random，种子由调用方传入。ieee、fpadd 的出题器也用它。
 */
export interface Random {
  /** [0, 1) 的小数。 */
  next(): number;
  /** lo 到 hi 的整数，两端都含。 */
  int(lo: number, hi: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRandom(seed: number): Random {
  let a = Math.trunc(Number.isFinite(seed) ? seed : 0) >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number): number => lo + Math.floor(next() * (hi - lo + 1));
  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      const item = items[int(0, items.length - 1)];
      if (item === undefined) throw new Error('pick 需要非空数组');
      return item;
    },
    chance: (p: number) => next() < p,
  };
}
