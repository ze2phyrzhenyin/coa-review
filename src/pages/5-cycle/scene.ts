/** 演示页的场景：部件摆在哪、怎么连、状态怎么落到部件上。不含任何计算。 */
import type { Step } from '../../engines/trace';
import type { DemoState } from '../../player/demo-trace';
import { bindTable, from } from '../../scene';
import type { Move, SceneSpec } from '../../scene';

export const scene: SceneSpec = {
  parts: [
    { id: 'R1', kind: 'register', position: [-1.5, -2.9], props: { name: 'R1', value: '' }, pick: true },
    { id: 'C2', kind: 'gate', position: [-1.5, -1.45], props: { name: 'C2', open: false, dir: 's', states: ['高阻', '导通'] } },
    { id: 'bus', kind: 'bus', position: [0, 0], props: { name: '总线', length: 6.2, value: '' } },
    { id: 'DR', kind: 'register', position: [1.5, 2.5], props: { name: 'DR', value: '' }, pick: true },
    { id: 'R0', kind: 'register', position: [-1.5, 2.5], props: { name: 'R0', value: '' }, pick: true },
    { id: 'LDDR', kind: 'label', position: [1.5, 4.0], props: { text: '', plate: true, size: 0.22 } },
    { id: 'LDR0', kind: 'label', position: [-1.5, 4.0], props: { text: '', plate: true, size: 0.22 } },
  ],
  wires: [
    { id: 'r1-c2', from: 'R1', to: 'C2' },
    { id: 'c2-bus', from: 'C2', to: 'bus' },
    { id: 'bus-dr', from: 'bus', to: 'DR' },
    { id: 'dr-r0', from: 'DR.w', to: 'R0.e' },
    { id: 'lddr', from: 'LDDR', to: 'DR', ink: 'ctrl' },
    { id: 'ldr0', from: 'LDR0', to: 'R0', ink: 'ctrl' },
  ],
};

export const bind = bindTable<DemoState>({
  R1: { value: 'reg.R1' },
  R0: { value: 'reg.R0' },
  DR: { value: 'reg.DR' },
  C2: { open: 'ctl.C2' },
  bus: { value: 'bus.value', drivers: 'bus.driver' },
  LDDR: { text: from('ctl.LDDR', (c) => `LDDR = ${c.flat['ctl.LDDR']}`) },
  LDR0: { text: from('ctl.LDR0', (c) => `LDR0 = ${c.flat['ctl.LDR0']}`) },
});

/** 这一步里哪个值从哪走到哪。按状态的变化判断，不按步骤编号。 */
export function moves(step: Step<DemoState>): Move[] {
  const changed = new Set(step.changes.map((change) => change.at));
  const { state } = step;
  const out: Move[] = [];
  if (changed.has('bus.value') && state.bus.value !== '') out.push({ value: state.bus.value, from: state.bus.driver, to: 'bus', via: ['r1-c2', 'c2-bus'] });
  if (changed.has('reg.DR')) out.push({ value: state.reg.DR, from: 'bus', to: 'DR', via: ['bus-dr'] });
  if (changed.has('reg.R0')) out.push({ value: state.reg.R0, from: 'DR', to: 'R0', via: ['dr-r0'] });
  return out;
}

const pathNames: Record<string, string> = {
  'reg.R0': 'R0',
  'reg.R1': 'R1',
  'reg.DR': 'DR',
  'bus.value': '总线上的值',
  'bus.driver': '驱动总线的部件',
  'ctl.C2': 'C2',
  'ctl.LDDR': 'LDDR',
  'ctl.LDR0': 'LDR0',
};

export const names = (path: string): string => pathNames[path] ?? path;
