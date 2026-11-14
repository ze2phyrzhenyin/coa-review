import { test } from 'vitest';
import { run as codes } from './model';
import { run as ieee } from '../ieee/model';
import { run as fpadd } from '../fpadd/model';
import { run as mul } from '../mul/model';
import { run as div } from '../div/model';
const show = (t: any) => { const last = t.steps[t.steps.length - 1]; process.stdout.write(JSON.stringify({ result: t.result, final: last.state, asks: t.steps.filter((s: any) => s.ask).map((s: any) => [s.id, s.title, s.ask]), titles: t.steps.map((s: any) => s.level + ':' + s.title) }) + "\n"); };
const tr = (f: () => any) => { try { show(f()); } catch (e: any) { process.stdout.write('{ERR ' + e.message + '\n'); } };
const sr = (f: () => any) => { try { const t = f(); process.stdout.write(JSON.stringify({ r: t.result, fin: t.steps[t.steps.length-1].state, table: t.table.rows.map((r: any) => r.cells.join(' | ')) }) + '\n'); } catch (e: any) { process.stdout.write('{ERR ' + e.message + '\n'); } };
test('probe', () => {
  sr(() => fpadd({ style: '有效位', digits: 4, op: '减', x: '0.5', y: '1.75', rounding: '就近舍入' }));
  sr(() => fpadd({ style: '有效位', digits: 4, op: '加', x: '0', y: '-1.75', rounding: '就近舍入' }));
  sr(() => fpadd({ style: '补码', k: 3, m: 6, op: '加', x: { exp: '-111', mant: '0.100000' }, y: { exp: '-111', mant: '-0.110000' }, rounding: '截断' }));
  sr(() => mul({ mode: '补码', n: 4, x: { as: '真值', text: '+1011' }, y: { as: '真值', text: '-0110' } }));
  sr(() => mul({ mode: '无符号', n: 5, x: { as: '机器数', bits: '11011' }, y: { as: '机器数', bits: '10101' } }));
  sr(() => div({ n: 5, notation: '小数', x: { as: '真值', text: '0.10110' }, y: { as: '真值', text: '0.11111' } }));
  sr(() => div({ n: 5, notation: '整数', x: { as: '真值', text: '11000' }, y: { as: '真值', text: '-11111' } }));
  sr(() => div({ n: 5, notation: '小数', x: { as: '真值', text: '-0.01011' }, y: { as: '真值', text: '0.11001' } }));
});
