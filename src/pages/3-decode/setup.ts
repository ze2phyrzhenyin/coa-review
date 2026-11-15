/**
 * 这一页用到的参数：讲解的两道例题、试一试的地址分配、网址里的写法。
 * 只拼参数，不算结果；选片、译码器接法、每个 Y 的去向都由 src/engines/decode 给出。
 */
import { design, sizeText, validateParams } from '../../engines/decode/model';
import type { Params, Region } from '../../engines/decode/model';

export const MAX_ROWS_ON_BOARD = 8;
export const MAX_PER_GROUP_ON_BOARD = 4;

/**
 * 讲解：16 位地址、8 位数据。ROM 已有一整块，占低 16K；RAM 用 8K×4 位芯片，从 8000H 起 24K。
 * 变式只多一个条件：最高 4K 再放一片 4K×8 位的 RAM，它比一组小，要局部译码。
 */
const base: Region[] = [
  { kind: 'ROM', start: 0x0000, end: 0x3fff },
  { kind: 'RAM', start: 0x8000, end: 0xdfff, chip: { words: '8K', bits: 4 } },
];
export const EXAMPLES: { key: string; label: string; params: Params }[] = [
  { key: 'a', label: 'ROM + 24K RAM', params: { addressBits: 16, dataBits: 8, regions: base, probe: 0xa51c } },
  {
    key: 'b',
    label: '再加最高 4K',
    params: { addressBits: 16, dataBits: 8, regions: [...base, { kind: 'RAM', start: 0xf000, end: 0xffff, chip: { words: '4K', bits: 8 } }], probe: 0xf51c },
  },
];

/** 网址里的区域：ROM:0000-3FFF;RAM:8000-DFFF:8Kx4。 */
export function encodeRegions(regions: Region[]): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  return regions
    .map((r) => `${r.kind}:${hex(r.start)}-${hex(r.end)}${r.chip ? `:${typeof r.chip.words === 'number' ? sizeText(r.chip.words) : r.chip.words.toUpperCase()}x${r.chip.bits}` : ''}`)
    .join(';');
}

export function decodeRegions(text: string): Region[] | null {
  const out: Region[] = [];
  for (const part of text.split(';').filter(Boolean)) {
    const m = /^(ROM|RAM):([0-9A-F]+)-([0-9A-F]+)(?::(\d+[KM]?)x(\d+))?$/i.exec(part.trim());
    if (!m) return null;
    const region: Region = { kind: m[1]!.toUpperCase() as 'ROM' | 'RAM', start: parseInt(m[2]!, 16), end: parseInt(m[3]!, 16) };
    if (m[4] && m[5]) region.chip = { words: m[4].toUpperCase(), bits: Number(m[5]) };
    out.push(region);
  }
  return out.length > 0 ? out : null;
}

export const TRY_DEFAULT = { rg: encodeRegions(EXAMPLES[1]!.params.regions), db: '8', dec: '', a: 'F51C' };

export const CHIP_CHOICES = ['', '1Kx8', '2Kx8', '4Kx4', '4Kx8', '8Kx4', '8Kx8', '8Kx16', '16Kx8', '16Kx16'];

export function parseHex(text: string): number | null {
  const m = /^\s*(?:0x)?([0-9a-f]+)h?\s*$/i.exec(text);
  return m ? parseInt(m[1]!, 16) : null;
}

/** 试一试的参数：引擎的检查在前，台面放不下的在后。 */
export function tryParams(rg: string, db: string, dec: string, a: string): { params: Params | null; problems: string[] } {
  const regions = decodeRegions(rg);
  if (!regions) return { params: null, problems: ['区域写法不对'] };
  const params: Params = { addressBits: 16, dataBits: Number(db) || 8, regions };
  if (dec === '74138' || dec === '74139') params.decoder = dec;
  const address = a.trim() === '' ? null : parseHex(a);
  if (a.trim() !== '' && address === null) return { params: null, problems: ['地址写十六进制，例如 A51C'] };
  if (address !== null) params.probe = address;
  const problems = validateParams(params);
  if (problems.length > 0) return { params: null, problems };
  const d = design(params);
  if (d.groups.length > MAX_ROWS_ON_BOARD) return { params: null, problems: [`一共 ${d.groups.length} 组芯片，台面上最多摆 ${MAX_ROWS_ON_BOARD} 组；把 RAM 区改小，或换大一点的芯片`] };
  if (d.groups.some((g) => g.perGroup > MAX_PER_GROUP_ON_BOARD)) return { params: null, problems: [`一组要 ${Math.max(...d.groups.map((g) => g.perGroup))} 片，台面上一组最多摆 ${MAX_PER_GROUP_ON_BOARD} 片；换位数多一点的芯片`] };
  return { params, problems: [] };
}
