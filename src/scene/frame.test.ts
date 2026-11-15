import { describe, expect, it } from 'vitest';
import { pickFrameOf } from './frame';

describe('候选框', () => {
  it('矮的部件框在台面上，围着占地', () => {
    // 寄存器：宽 2.4、深 1.2，牌高约 1.14。
    expect(pickFrameOf({ w: 2.4, d: 1.2 }, 2.1, 1.14)).toEqual({ plane: 'table', w: 2.8, h: 1.6, y0: 0 });
  });

  it('立着一块高板的部件框在板的平面上，从底座围到板顶', () => {
    // 六行的一栏：底座深 1.0，板高 4.5。框不能只围住底座那一条。
    const frame = pickFrameOf({ w: 3.2, d: 1.0 }, 3.0, 4.5, 0.29);
    expect(frame.plane).toBe('face');
    expect(frame.y0).toBeLessThan(-0.29);
    expect(frame.y0 + frame.h).toBeGreaterThan(4.5);
    expect(frame.w).toBeGreaterThan(3.2);
  });

  it('板比占地宽时按板的宽度', () => {
    expect(pickFrameOf({ w: 1.0, d: 0.3 }, 2.6, 1.0).w).toBeCloseTo(3.0);
  });
});
