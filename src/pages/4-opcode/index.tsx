import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { Term } from '../../app/TermCard';
import { checkOpcode, levelName } from '../../engines/opcode/model';
import type { Level, OpcodeParams } from '../../engines/opcode/model';
import { Field, PageShell, Seg } from '../4-ea/shell';
import { OpcodePlayer } from './play';
import { OpcodePaper } from './Paper';

/** 讲解的例题，数是本站自取的。 */
const EXAMPLES: { key: string; label: string; params: OpcodeParams; lead: string }[] = [
  {
    key: 'max',
    label: '例题：零地址最多几条',
    params: { wordBits: 12, addressBits: 3, levels: [{ addresses: 2, count: 60 }, { addresses: 1, count: 28 }, { addresses: 0 }] },
    lead: '指令字 12 位，地址码每个 3 位。二地址要 60 条，一地址要 28 条，零地址最多能有几条。',
  },
  {
    key: 'fail',
    label: '变式：二地址多要 2 条',
    params: { wordBits: 12, addressBits: 3, levels: [{ addresses: 2, count: 62 }, { addresses: 1, count: 28 }, { addresses: 0 }] },
    lead: '同上一题，只把二地址改成 62 条。',
  },
  {
    key: 'mid',
    label: '例题二：中间一类求最多',
    params: { wordBits: 16, addressBits: 4, levels: [{ addresses: 3, count: 14 }, { addresses: 2 }, { addresses: 1, count: 30 }, { addresses: 0, count: 16 }] },
    lead: '指令字 16 位，地址码每个 4 位。三地址 14 条、一地址 30 条、零地址 16 条，二地址最多几条。',
  },
];

function Learn() {
  const [ex, setEx] = useParam('ex', 'max', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'max'));
  const [, setStep] = useParam('s', '0');
  const example = EXAMPLES.find((item) => item.key === ex) ?? EXAMPLES[0]!;
  return (
    <>
      <div class="ix-controls">
        <Seg
          label="例题"
          items={EXAMPLES.map((item) => ({ key: item.key, label: item.label }))}
          value={example.key}
          onChoose={(key) => {
            setStep('0');
            setEx(key);
          }}
        />
      </div>
      <p class="ix-lead">
        指令字等长时，地址少的指令把空出来的<Term k="操作码、地址码">地址码</Term>位并进操作码，叫<Term k="扩展操作码" />（教材 p129–130）。台面上一类指令一层抽屉柜：柜顶立着用掉的码，留作扩展的码装在抽屉里；抽屉拉开，里面的码就是下一层操作码的开头。
        {example.lead}
      </p>
      <OpcodePlayer key={example.key} params={example.params} lesson />
    </>
  );
}

const DEFAULT = { w: '12', a: '3', lv: '2:60 1:28 0:' };

function readLevels(text: string): { levels: Level[]; problem: string } {
  const levels: Level[] = [];
  for (const item of text.split(/[\s,，;；]+/).filter(Boolean)) {
    const m = /^(\d+)[:：](\d*)$/.exec(item);
    if (!m) return { levels: [], problem: `「${item}」要写成 地址数:条数，求最多的那一类条数空着，如 0:` };
    levels.push(m[2] === '' ? { addresses: Number(m[1]) } : { addresses: Number(m[1]), count: Number(m[2]) });
  }
  return { levels, problem: '' };
}

/** 试一试：自己定字长、地址码位数和各类条数。都在网址里。 */
function Try() {
  const [w, setW] = useParam('w', DEFAULT.w);
  const [a, setA] = useParam('a', DEFAULT.a);
  const [lv, setLv] = useParam('lv', DEFAULT.lv);
  const [, setStep] = useParam('s', '0');
  const [draft, setDraft] = useState({ w, a, lv });
  useEffect(() => setDraft({ w, a, lv }), [w, a, lv]);
  const [problem, setProblem] = useState('');
  const build = (d: { w: string; a: string; lv: string }) => {
    const read = readLevels(d.lv);
    if (read.problem) return { params: null, problem: read.problem };
    const params: OpcodeParams = { wordBits: Number(d.w), addressBits: Number(d.a), levels: read.levels };
    const issues = checkOpcode(params);
    return issues.length ? { params: null, problem: issues[0]! } : { params, problem: '' };
  };
  const current = useMemo(() => build({ w, a, lv }), [w, a, lv]);
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = build(draft);
    setProblem(next.problem);
    if (next.problem) return;
    setStep('0');
    setW(draft.w.trim());
    setA(draft.a.trim());
    setLv(draft.lv.trim());
  };
  return (
    <>
      <form class="ix-form" onSubmit={submit}>
        <Field label="字长（位）">
          <input class="input is-mono" inputMode="numeric" autoComplete="off" value={draft.w} onInput={(e) => setDraft({ ...draft, w: e.currentTarget.value })} />
        </Field>
        <Field label="地址码（位）">
          <input class="input is-mono" inputMode="numeric" autoComplete="off" value={draft.a} onInput={(e) => setDraft({ ...draft, a: e.currentTarget.value })} />
        </Field>
        <Field label="各类：地址数:条数" help="地址数从多到少；求最多的那一类条数空着，如 0:" grow>
          <input class="input is-mono" autoComplete="off" spellcheck={false} value={draft.lv} onInput={(e) => setDraft({ ...draft, lv: e.currentTarget.value })} />
        </Field>
        <button type="submit" class="btn">
          换上
        </button>
      </form>
      {problem ? (
        <p class="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {current.params ? (
        <>
          <p class="ix-note">{current.params.levels.map((l) => `${levelName(l.addresses)}${l.count === undefined ? '求最多' : ` ${l.count} 条`}`).join('，')}</p>
          <OpcodePlayer key={JSON.stringify(current.params)} params={current.params} lesson={false} />
        </>
      ) : (
        <p class="field-error">{current.problem}</p>
      )}
    </>
  );
}

export default function Page() {
  return <PageShell id="op" panels={{ '': Learn, try: Try, quiz: OpcodePaper }} />;
}
