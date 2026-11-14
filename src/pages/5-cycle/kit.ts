/**
 * 部件样张：把演示页用不到的部件（位串、存储阵列、答题纸、值牌、总线冲突）各摆一个，手写三步。
 * 只在网址带 ?demo=kit 时出现，用来在真实浏览器里检查这些部件。
 */
import { TraceBuilder } from '../../engines/trace';
import type { Step, Trace } from '../../engines/trace';
import { bindTable, from } from '../../scene';
import type { Move, SceneSpec } from '../../scene';

export interface KitState {
  sum: string;
  carry: number;
  rows: { valid: string; tag: string; data: string }[];
  active: number;
  at: string;
  drivers: string;
  bus: string;
}

export function kitTrace(): Trace<null, KitState> {
  const initial: KitState = {
    sum: '00001011',
    carry: -1,
    rows: [
      { valid: '1', tag: '010', data: '3A' },
      { valid: '0', tag: '000', data: '00' },
      { valid: '1', tag: '110', data: '7F' },
      { valid: '1', tag: '001', data: 'C4' },
    ],
    active: -1,
    at: 'A',
    drivers: '',
    bus: '',
  };
  const builder = new TraceBuilder<null, KitState>('demo-kit', null, initial, [{ label: '用途', value: '部件样张' }]);
  builder.step({
    level: 'beat',
    title: '低四位加 0101，向高四位进位',
    why: '1011 加 0101 得 1 0000，低四位变成 0000，进位送到左边一列。',
    update: (s) => {
      s.sum = '00010000';
      s.carry = 4;
    },
  });
  builder.step({
    level: 'access',
    title: '访问第 1 行，装入新块',
    why: '第 1 行的有效位是 0，没有命中，把块装进来并改写标记。',
    update: (s) => {
      s.carry = -1;
      s.active = 1;
      s.rows[1] = { valid: '1', tag: '101', data: 'E2' };
      s.at = 'B';
    },
  });
  builder.step({
    level: 'explain',
    title: 'A 和 B 同时驱动总线',
    why: '两个三态门同时导通，总线上的值不确定。真实电路里两个输出端互相顶着，可能烧坏器件。',
    update: (s) => {
      s.drivers = 'A、B';
      s.bus = '0101 1100';
    },
  });
  return builder.finish(
    { 和: builder.state.sum },
    {
      columns: ['步', '做什么', '结果'],
      rows: [
        { cells: ['1', '低四位相加', `和 = ${builder.state.sum}`], step: 's1' },
        { cells: ['2', '访问第 1 行', '未命中，装入'], step: 's2' },
        { cells: ['3', '两个部件驱动总线', '冲突'], step: 's3' },
      ],
    },
  );
}

export const kitScene: SceneSpec = {
  parts: [
    { id: 'sum', kind: 'bits', position: [-2.6, -3.2], props: { name: '和', bits: '00000000' }, pick: true },
    { id: 'mem', kind: 'memory', position: [-3, 1.6], props: { name: 'cache', columns: [{ title: '有效' }, { title: '标记', ink: 'addr' }, { title: '数据' }], rows: [], labels: ['0', '1', '2', '3'] }, pick: true },
    { id: 'A', kind: 'register', position: [2.2, -3.2], props: { name: 'A', value: '0101 1100' } },
    { id: 'B', kind: 'register', position: [5.4, -3.2], props: { name: 'B', value: '1110 0001' } },
    { id: 'bus', kind: 'bus', position: [3.8, -0.9], props: { name: '总线', length: 5.6, value: '' } },
    { id: 'tok', kind: 'token', position: [0, 0], props: { value: '块 5', at: 'A', ink: 'addr' } },
    { id: 'sheet', kind: 'sheet', position: [3.8, 3.4], props: { title: '答题纸', columns: [], rows: [], shown: 0 } },
    { id: 'note', kind: 'label', position: [-2.6, -1.6], props: { text: '进位向左', tone: 'muted' } },
  ],
  wires: [
    { id: 'a-bus', from: 'A', to: 'bus' },
    { id: 'b-bus', from: 'B', to: 'bus', ink: 'addr' },
    { id: 'a-b', from: 'A.e', to: 'B.w', ink: 'ctrl' },
  ],
};

export const kitBind = bindTable<KitState>({
  sum: { bits: 'sum', carry: from('carry', (c) => (c.state.carry < 0 ? null : c.state.carry)) },
  mem: {
    rows: from('rows', (c) => c.state.rows.map((row) => [row.valid, row.tag, row.data])),
    active: from('active', (c) => c.state.active),
    changedCells: from('rows', (c) => [...c.changed].filter((path) => path.startsWith('rows.')).map((path) => {
      const [, row, key] = path.split('.');
      return `${row}.${['valid', 'tag', 'data'].indexOf(key ?? '')}`;
    })),
  },
  tok: { at: 'at', via: from('at', () => ['a-b']) },
  bus: { value: 'bus', drivers: 'drivers' },
});

export const kitMoves = (_step: Step<KitState>): Move[] => [];
