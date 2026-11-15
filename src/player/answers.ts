/**
 * 答案比对和「弄坏它」镜头要看的部件。纯函数，不碰浏览器和 three.js，单独测。
 */
import type { Ask } from '../engines/trace';
import type { Move } from '../scene';

/**
 * 把学生写的和标准答案化成同一种写法再比。
 * 全角字符先换成半角。位串去掉空格和下划线；数按数值；文字题不分大小写、不看空格，
 * 十六进制数结尾的 H 可写可不写（16bh = 16BH = 16B）。选择题只去掉两头的空格。
 */
export function normalize(ask: Ask, value: string): string {
  const text = value.normalize('NFKC').trim();
  if (ask.kind === 'choice') return value.trim();
  if (ask.kind === 'bits') return text.replace(/[\s_]/g, '');
  if (ask.kind === 'number' && text !== '' && Number.isFinite(Number(text))) return String(Number(text));
  const upper = text.replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-F]+H$/.test(upper) ? upper.slice(0, -1) : upper;
}

export const sameAnswer = (ask: Ask, value: string): boolean => normalize(ask, value) === normalize(ask, ask.answer);

/** 演后果时镜头临时要看的部件：各个移动的两头。 */
export function breakFrame(moves: Move[]): string[] | undefined {
  const ids = [...new Set(moves.flatMap((move) => [move.from, move.to]))];
  // 没有移动（只盖一层画面）：不临时换镜头，留在这一步本来的画面上演。
  return ids.length > 0 ? ids : undefined;
}
