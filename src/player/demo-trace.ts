/**
 * 演示用的小 Trace，手写，只为验证场景和播放器：R1 的内容经三态门上总线，打入 DR，再由 DR 打入 R0。
 * 真实的模型机引擎在 src/engines/cpu/，这里不引用它。数值都从初始状态推出，不在步骤里另写。
 */
import { TraceBuilder } from '../engines/trace';
import type { Trace } from '../engines/trace';

export interface DemoState {
  reg: { R0: string; R1: string; DR: string };
  bus: { value: string; driver: string };
  ctl: { C2: string; LDDR: string; LDR0: string };
}

export interface DemoParams {
  r1: string;
  dr: string;
}

export function demoTrace(params: DemoParams = { r1: '0011 0101', dr: '1010 0001' }): Trace<DemoParams, DemoState> {
  const initial: DemoState = {
    reg: { R0: '0000 0000', R1: params.r1, DR: params.dr },
    bus: { value: '', driver: '' },
    ctl: { C2: '0', LDDR: '0', LDR0: '0' },
  };
  const builder = new TraceBuilder<DemoParams, DemoState>('demo-transfer', params, initial, [
    { label: '要做的事', value: '把 R1 的内容送到 R0' },
    { label: '初始值', value: `R1 = ${initial.reg.R1}，DR = ${initial.reg.DR}，R0 = ${initial.reg.R0}` },
  ]);

  builder.step({
    level: 'beat',
    title: 'C2 打开，R1 的内容上总线',
    why: '控制器发出 C2，R1 输出端的三态门导通。总线原来没有部件驱动，现在由 R1 驱动。R1 自己的内容不变。',
    update: (s) => {
      s.ctl.C2 = '1';
      s.bus.value = s.reg.R1;
      s.bus.driver = 'R1';
    },
  });
  builder.step({
    level: 'beat',
    title: 'LDDR 有效，总线上的值打入 DR',
    why: '通用寄存器的输入接在 DR 后面，不接总线，所以值要先进 DR。LDDR 有效时 DR 接收总线上的值，原来的内容被盖掉。',
    ask: {
      prompt: '总线上的值接下来打入哪个寄存器',
      kind: 'choice',
      options: ['R0', 'R1', 'DR'],
      answer: 'DR',
      hint: '看总线下面接着谁。R0 的输入来自 DR，不直接接总线。',
    },
    update: (s) => {
      s.ctl.LDDR = '1';
      s.reg.DR = s.bus.value;
    },
  });
  builder.step({
    level: 'explain',
    title: 'C2 关闭，总线空出来',
    why: 'DR 已经存好这个值。撤掉 C2 和 LDDR，三态门回到高阻，总线上没有部件驱动。',
    update: (s) => {
      s.ctl.C2 = '0';
      s.ctl.LDDR = '0';
      s.bus.value = '';
      s.bus.driver = '';
    },
  });
  builder.step({
    level: 'beat',
    title: 'LDR0 有效，DR 的内容打入 R0',
    why: 'DR 的输出接着通用寄存器的输入。LDR0 有效时 R0 接收 DR 的值。',
    update: (s) => {
      s.ctl.LDR0 = '1';
      s.reg.R0 = s.reg.DR;
    },
  });
  builder.step({
    level: 'explain',
    title: '撤掉 LDR0，传送完成',
    why: 'R0 已经存好。R1 的内容没有动过，DR 里留着同一个值。',
    update: (s) => {
      s.ctl.LDR0 = '0';
    },
  });

  const end = builder.state;
  return builder.finish(
    { R0: end.reg.R0 },
    {
      columns: ['步', '传送', '控制信号', '结果'],
      rows: [
        { cells: ['1', 'R1 → 总线', 'C2', `总线 = ${end.reg.R1}`], step: 's1' },
        { cells: ['2', '总线 → DR', 'C2，LDDR', `DR = ${end.reg.DR}`], step: 's2' },
        { cells: ['3', '释放总线', '无', '总线没有部件驱动'], step: 's3' },
        { cells: ['4', 'DR → R0', 'LDR0', `R0 = ${end.reg.R0}`], step: 's4' },
      ],
    },
  );
}
