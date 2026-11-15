/**
 * 这一页用到的参数：讲解的两道例题、试一试的选项、网址里的写法。
 * 只拼参数，不算结果；芯片数、分组、接法都由 src/engines/expand 给出。
 */
import { plan, validateParams } from '../../engines/expand/model';
import type { Params } from '../../engines/expand/model';

/** 台面上摆得下的上限：最多 8 组、每组 4 片。 */
export const MAX_GROUPS_ON_BOARD = 8;
export const MAX_PER_GROUP_ON_BOARD = 4;

/**
 * 讲解：两道题只差芯片规格。16K×4 位凑 64K×8 位要 8 片、分 4 组；换成 8K×8 位也是 8 片，却分 8 组。
 * 片数一样，片选位数不一样，正好说明片选按组算。查的地址两题相同。
 */
export const EXAMPLES: { key: string; label: string; params: Params }[] = [
  { key: 'a', label: '用 16K×4 位芯片', params: { target: { words: '64K', bits: 8 }, chip: { words: '16K', bits: 4 }, probe: 0x9a3c } },
  { key: 'b', label: '用 8K×8 位芯片', params: { target: { words: '64K', bits: 8 }, chip: { words: '8K', bits: 8 }, probe: 0x9a3c } },
];

export const WORD_CHOICES = ['1K', '2K', '4K', '8K', '16K', '32K', '64K', '128K', '256K'];
export const BIT_CHOICES = [1, 2, 4, 8, 16];

export interface TryValues {
  tw: string;
  tb: number;
  cw: string;
  cb: number;
  /** 要查的地址，十六进制，不带 H。 */
  probe: string;
}

export const TRY_DEFAULT: TryValues = { tw: '64K', tb: 8, cw: '16K', cb: 4, probe: '9A3C' };

/** 读十六进制地址：认 9A3C、9A3CH、0x9A3C。不合格返回 null。 */
export function parseHex(text: string): number | null {
  const m = /^\s*(?:0x)?([0-9a-f]+)h?\s*$/i.exec(text);
  if (!m) return null;
  const value = parseInt(m[1]!, 16);
  return Number.isSafeInteger(value) ? value : null;
}

/** 试一试的参数。不合格时给出原因（引擎的原因在前，台面放不下的在后）。 */
export function tryParams(v: TryValues): { params: Params | null; problems: string[] } {
  const params: Params = { target: { words: v.tw, bits: v.tb }, chip: { words: v.cw, bits: v.cb } };
  const address = parseHex(v.probe);
  if (v.probe.trim() !== '' && address === null) return { params: null, problems: ['地址写十六进制，例如 9A3C'] };
  if (address !== null) params.probe = address;
  const problems = validateParams(params);
  if (problems.length > 0) return { params: null, problems };
  const p = plan(params);
  if (p.groups > MAX_GROUPS_ON_BOARD) return { params: null, problems: [`要分 ${p.groups} 组，台面上最多摆 ${MAX_GROUPS_ON_BOARD} 组；换大一点的芯片`] };
  if (p.perGroup > MAX_PER_GROUP_ON_BOARD) return { params: null, problems: [`每组要 ${p.perGroup} 片，台面上一组最多摆 ${MAX_PER_GROUP_ON_BOARD} 片；换位数多一点的芯片`] };
  return { params, problems: [] };
}
