import { describe, expect, it } from 'vitest';
import { run } from '../../engines/opcode/model';
import type { OpcodeParams } from '../../engines/opcode/model';
import { run as derive } from '../../engines/hardwired/model';
import { gridParts, gridView } from '../5-hardwired/scene';
import { opFrame, opQuestion, opScene } from './scene';

/**
 * 回归：手机版式不能往纵深排太远。台面深过二十几个单位时，靠前的部件落到镜头后面，
 * 镜头被推到空白处（b3 验收：四类指令时第 0、2 步舞台是空的）。
 */
const cases: OpcodeParams[] = [
  { wordBits: 12, addressBits: 3, levels: [{ addresses: 2, count: 60 }, { addresses: 1, count: 28 }, { addresses: 0 }] },
  { wordBits: 16, addressBits: 4, levels: [{ addresses: 3, count: 14 }, { addresses: 2 }, { addresses: 1, count: 30 }, { addresses: 0, count: 16 }] },
  { wordBits: 24, addressBits: 3, levels: [7, 6, 5, 4, 3, 2, 1, 0].map((addresses) => ({ addresses, count: 1 })) },
];
const depth = (zs: number[]) => Math.max(...zs) - Math.min(...zs);

describe('4-opcode 场景', () => {
  for (const params of cases) {
    const trace = run(params);
    it(`${params.levels.length} 类：手机版式的纵深不超过 16`, () => {
      expect(depth(opScene(trace, true).parts.map((p) => p.position[1]))).toBeLessThanOrEqual(16);
    });
    it(`${params.levels.length} 类：第 0 步和每一步要看的部件都在场景里`, () => {
      for (const narrow of [true, false]) {
        const ids = new Set(opScene(trace, narrow).parts.map((p) => p.id));
        const at = opQuestion(params, narrow).at;
        expect(at.length).toBeGreaterThan(0);
        for (const id of at) expect(ids.has(id)).toBe(true);
        for (const step of trace.steps) {
          const frame = opFrame(params, narrow)(step);
          if (!narrow) expect(frame?.length).toBeGreaterThan(0);
          for (const id of frame ?? []) expect(ids.has(id)).toBe(true);
        }
      }
    });
  }
  it('5-hardwired：手机上每条指令一张表，排成一排，纵深为 0', () => {
    const ops = derive({ signal: 'LDDR', instructions: ['MOV', 'NOT', 'LAD', 'ADD', 'AND', 'STO', 'JMP'] }).params.instructions!;
    const parts = gridParts(gridView(ops, true), Array.from({ length: 12 }, () => ops.map(() => '')), [0, 0]);
    expect(parts).toHaveLength(ops.length);
    expect(depth(parts.map((p) => p.position[1]))).toBe(0);
  });
});
