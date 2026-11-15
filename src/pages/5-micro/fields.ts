/**
 * 字段位数和控存容量的台面：一张微指令格式卡（字段｜位数）一格格填上，旁边是字长和控存两块读数。
 * 数都取自引擎 runFields 的状态。
 */
import type { FieldParams, FieldState } from '../../engines/micro/model';
import type { Trace } from '../../engines/trace';
import { bindTable, from } from '../../scene';
import type { BindContext, SceneSpec } from '../../scene';

type Ctx = BindContext<FieldState>;

const names = (trace: Trace<FieldParams, FieldState>): string[] => {
  const last = trace.steps.at(-1)?.state ?? trace.initial;
  return last.fields.map((field) => field.name);
};

export function fieldsScene(trace: Trace<FieldParams, FieldState>, narrow: boolean): SceneSpec {
  const rows = names(trace);
  return {
    parts: [
      {
        id: 'FMT',
        kind: 'memory',
        position: narrow ? [0, -1.6] : [-2.6, 0],
        title: '微指令格式',
        props: { name: '微指令格式', columns: [{ title: '字段', width: 2.2 }, { title: '位数', width: 1.0 }], rows: rows.map((name) => [name, '']) },
        pick: true,
      },
      { id: 'WORD', kind: 'register', position: narrow ? [-1.3, 2.4 + rows.length * 0.25] : [2.6, -1.1], props: { name: '字长', value: '', width: 2.0 }, pick: true },
      { id: 'CAP', kind: 'register', position: narrow ? [1.3, 2.4 + rows.length * 0.25] : [2.6, 1.3], props: { name: '控存', value: '', width: narrow ? 2.4 : 3.4 }, pick: true },
    ],
    wires: [],
  };
}

export function fieldsBind(trace: Trace<FieldParams, FieldState>) {
  const rows = names(trace);
  return bindTable<FieldState>({
    FMT: {
      rows: from('fields', (c: Ctx) => rows.map((name) => [name, String(c.state.fields.find((f) => f.name === name)?.bits ?? '')])),
      changedCells: (c: Ctx) => {
        const fresh = new Set([...c.changed].filter((path) => /^fields\.\d+\.bits$/.test(path)).map((path) => c.state.fields[Number(path.split('.')[1])]?.name));
        return rows.flatMap((name, r) => (fresh.has(name) ? [`${r}.1`] : []));
      },
    },
    WORD: { value: from('wordBits', (c: Ctx) => (c.state.wordBits === null ? '' : `${c.state.wordBits} 位`)) },
    CAP: { value: from('capacity', (c: Ctx) => c.state.capacity ?? '') },
  });
}

export function fieldNames(path: string): string {
  if (path === 'wordBits') return '字长';
  if (path === 'capacity') return '控存容量';
  if (path === 'words') return '控存单元数';
  if (path === 'controlBits') return '微命令字段';
  if (path === 'testBits') return '判别测试字段';
  if (path === 'nextBits') return '下地址字段';
  const m = /^fields\.(\d+)\.(name|bits)$/.exec(path);
  if (m) return m[2] === 'name' ? `第 ${Number(m[1]) + 1} 个字段` : `第 ${Number(m[1]) + 1} 个字段的位数`;
  return path;
}
