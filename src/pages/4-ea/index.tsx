import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { Term } from '../../app/TermCard';
import { EaPlayer } from './play';
import { EXAMPLES, FORMATS, TRY_DEFAULTS, formatOf, readTry } from './setup';
import { Field, PageShell, Seg } from './shell';
import { EaPaper } from './Paper';

function Learn() {
  const [ex, setEx] = useParam('ex', 'xi', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'xi'));
  const [, setStep] = useParam('s', '0');
  const example = EXAMPLES.find((item) => item.key === ex) ?? EXAMPLES[0];
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
        指令字里的地址码叫<Term k="形式地址" /> A，按<Term k="寻址方式" />算出的主存地址叫<Term k="有效地址" /> EA。台面上：指令字切成几段翻片，寻址特征那几位决定落到哪块方式牌上；地址卡每跳进主存一次，就是访存一次。{example.lead}
      </p>
      <EaPlayer key={example.key} params={example.params} lesson />
    </>
  );
}

/** 试一试：选格式，自己写指令字、寄存器和主存。都在网址里。 */
function Try() {
  const [fmt, setFmt] = useParam('fmt', 'xi', (raw) => (FORMATS.some((f) => f.key === raw) ? raw : 'xi'));
  const defaults = TRY_DEFAULTS[fmt]!;
  const [words, setWords] = useParam('w', '');
  const [regs, setRegs] = useParam('reg', '');
  const [mem, setMem] = useParam('mem', '');
  const [, setStep] = useParam('s', '0');
  const shown = { words: words || defaults.words, regs: regs || defaults.regs, mem: mem || defaults.mem };
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [fmt, words, regs, mem]); // eslint-disable-line react-hooks/exhaustive-deps
  const read = useMemo(() => readTry(fmt, shown.words, shown.regs, shown.mem), [fmt, shown.words, shown.regs, shown.mem]);
  const [problem, setProblem] = useState('');
  const format = formatOf(fmt);

  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = readTry(fmt, draft.words, draft.regs, draft.mem);
    if (next.problems.length) {
      setProblem(next.problems[0]!);
      return;
    }
    setProblem('');
    setStep('0');
    setWords(draft.words.trim() === defaults.words ? '' : draft.words.trim());
    setRegs(draft.regs.trim() === defaults.regs ? '' : draft.regs.trim());
    setMem(draft.mem.trim() === defaults.mem ? '' : draft.mem.trim());
  };

  return (
    <>
      <div class="ix-controls">
        <Seg
          label="指令格式"
          items={FORMATS.map((f) => ({ key: f.key, label: f.label }))}
          value={fmt}
          onChoose={(key) => {
            setStep('0');
            setWords('');
            setRegs('');
            setMem('');
            setProblem('');
            setFmt(key);
          }}
        />
      </div>
      <p class="ix-note">
        格式：{format.fields.map((f) => `${f.name}（${f.bits} 位）`).join(' | ')}。寻址特征 {format.modeFields.join('')}：
        {Object.entries(format.modes)
          .map(([k, m]) => `${k} ${m.kind}${m.reg ? ` ${m.reg}` : m.regField ? `（寄存器号在 ${m.regField}）` : ''}`)
          .join('，')}
        。
      </p>
      <form class="ix-form" onSubmit={submit}>
        <Field label="指令字（十六进制，空格隔开）" grow>
          <input class="input is-mono" spellcheck={false} autoComplete="off" value={draft.words} onInput={(e) => setDraft({ ...draft, words: e.currentTarget.value })} />
        </Field>
        <Field label="寄存器" grow>
          <input class="input is-mono" spellcheck={false} autoComplete="off" value={draft.regs} onInput={(e) => setDraft({ ...draft, regs: e.currentTarget.value })} />
        </Field>
        <Field label="主存（地址=内容）" grow>
          <input class="input is-mono" spellcheck={false} autoComplete="off" value={draft.mem} onInput={(e) => setDraft({ ...draft, mem: e.currentTarget.value })} />
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
      {read.params ? <EaPlayer key={JSON.stringify(read.params)} params={read.params} lesson={false} /> : <p class="field-error">{read.problems[0]}</p>}
    </>
  );
}

export default function Page() {
  return <PageShell id="ea" panels={{ '': Learn, try: Try, quiz: EaPaper }} />;
}
