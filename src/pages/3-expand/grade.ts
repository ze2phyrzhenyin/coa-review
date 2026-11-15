/**
 * 答题纸的判分：学生写的和引擎给的结果按同一种读法读出来再比。只做读法（认写法上的差别），不算答案。
 * 3-expand、3-decode 共用。
 */

export type FieldKind = 'num' | 'lines' | 'range' | 'hex' | 'choice';

export interface Field {
  key: string;
  title: string;
  kind: FieldKind;
  /** 引擎给的答案原文（如「8 片」「A13–A0 接每片」「0000H–3FFFH」）。 */
  expected: string;
  /** 「看答案」时填进去的写法。 */
  show: string;
  options?: string[];
  placeholder?: string;
}

/** 一串里的整数。 */
const number = (text: string): number | null => {
  const m = /-?\d+/.exec(text);
  return m ? Number(m[0]) : null;
};

/** 地址线：A13–A0、A15、A14、A_13~A_0 都认，读成线号的集合。 */
export function lineSet(text: string): Set<number> | null {
  const t = text.replace(/[_\s]/g, '').toUpperCase().replace(/[—–~～\-至到]/g, '–');
  const out = new Set<number>();
  for (const m of t.matchAll(/A(\d+)(?:–A?(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    for (let x = Math.min(a, b); x <= Math.max(a, b); x++) out.add(x);
  }
  return out.size > 0 ? out : null;
}

/** 十六进制地址：9A3C、9A3CH、0x9A3C。 */
export function hexValue(text: string): number | null {
  const m = /^\s*(?:0X)?([0-9A-F]+)H?\s*$/i.exec(text.replace(/[_\s]/g, ''));
  return m ? parseInt(m[1]!, 16) : null;
}

/** 地址范围：0000H–3FFFH、0000-3fff。 */
export function rangeValue(text: string): [number, number] | null {
  const parts = text
    .replace(/[_\s]/g, '')
    .split(/[—–~～\-至到]+/)
    .filter(Boolean);
  if (parts.length !== 2) return null;
  const a = hexValue(parts[0]!);
  const b = hexValue(parts[1]!);
  return a === null || b === null ? null : [a, b];
}

/** 学生写的和引擎的答案是不是同一个意思。 */
export function same(field: Field, written: string): boolean {
  const w = written.trim();
  if (w === '') return false;
  switch (field.kind) {
    case 'num': {
      const a = /^\d+(?:\s*片|\s*组|\s*位)?$/.test(w) ? number(w) : null;
      return a !== null && a === number(field.expected);
    }
    case 'lines': {
      const a = lineSet(w);
      const b = lineSet(field.expected);
      return !!a && !!b && a.size === b.size && [...a].every((x) => b.has(x));
    }
    case 'range': {
      const a = rangeValue(w);
      const b = rangeValue(field.expected);
      return !!a && !!b && a[0] === b[0] && a[1] === b[1];
    }
    case 'hex': {
      const a = hexValue(w);
      return a !== null && a === hexValue(field.expected);
    }
    case 'choice':
      return w === field.expected;
  }
}

/** 答题纸上的显示：原样，空着就不写。 */
export function shown(_field: Field, written: string): string {
  return written.trim();
}
