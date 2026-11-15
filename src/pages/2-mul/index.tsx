import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import { MODES } from '../../engines/mul/model';
import type { MulMode, MulParams } from '../../engines/mul/model';
import { formatValue, fromUnsigned, parseValue } from '../../lib/bits';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { BreakIt } from './BreakIt';
import { EXAMPLES, MUL_CONCLUSION, MUL_NEEDS, MUL_QUESTION, MUL_QUESTION_SIGN, exampleParams, lesson, sub } from './lesson';
import { Paper } from './Paper';
import './mul.css';

const TABS = [
  { id: 'learn', name: '讲解' },
  { id: 'try', name: '试一试' },
  { id: 'practice', name: '练习' },
  { id: 'break', name: '弄坏它' },
] as const;

const minus = (text: string) => text.replace(/^-/, '−');

export default function Page() {
  const [tab, setTab] = useParam('tab', 'learn', (raw) => (TABS.some((item) => item.id === raw) ? raw : 'learn'));
  const [, setStep] = useParam('s', '0');
  const current = TABS.find((item) => item.id === tab)?.id ?? 'learn';
  const choose = (id: string) => {
    if (id === current) return;
    setStep('0');
    setTab(id);
  };
  return (
    <div class="mul">
      <div class="tabs" role="tablist" aria-label="本页">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" id={`mul-tab-${item.id}`} aria-selected={item.id === current} aria-controls="mul-panel" onClick={() => choose(item.id)}>
            {item.name}
          </button>
        ))}
      </div>
      <div id="mul-panel" role="tabpanel" aria-labelledby={`mul-tab-${current}`}>
        {current === 'learn' && <Learn />}
        {current === 'try' && <Try />}
        {current === 'practice' && <Paper />}
        {current === 'break' && <BreakIt />}
      </div>
    </div>
  );
}

/** 台面的图例：第一次出现的术语在这里点开。 */
function Legend() {
  return (
    <p class="mul-legend">
      浅色格是<Term k="位积" /> a<sub>i</sub>·b<sub>j</sub>，落在 2<sup>i+j</sup> 那一列；深色底座是<Term k="全加器" />，左下的小牌是它送出的进位。带符号时，
      <Term k="符号位" />单独放在最左一列，<Term k="对 2 求补器">求补器</Term>的 E = 1 时把该翻的位就地翻过来。
    </p>
  );
}

function exampleName(i: number): string {
  const item = EXAMPLES[i]!;
  if (item.mode === '无符号') return `${item.x} × ${item.y}`;
  return `${item.mode} (${minus(item.x)}) × (${minus(item.y)})`;
}

function Learn() {
  const [ex, setEx] = useParam('ex', '1', (raw) => String(Math.max(1, Math.min(EXAMPLES.length, Math.trunc(Number(raw)) || 1))));
  const [, setStep] = useParam('s', '0');
  const index = Math.max(0, Math.min(EXAMPLES.length - 1, Number(ex) - 1 || 0));
  const narrow = useNarrow();
  const made = useMemo(() => lesson(exampleParams(index), narrow), [index, narrow]);
  const signed = EXAMPLES[index]!.mode !== '无符号';
  const at = made.ok ? made.top : [];
  const question = signed ? { text: EXAMPLES[index]!.mode === '原码' ? MUL_QUESTION_SIGN : MUL_QUESTION, at } : { text: '阵列本身只做无符号乘法：位积怎么排，进位往哪走', at };
  return (
    <>
      <div class="seg is-mono mul-examples" role="group" aria-label="例题">
        {EXAMPLES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === index}
            onClick={() => {
              if (i === index) return;
              setStep('0');
              setEx(String(i + 1));
            }}
          >
            {exampleName(i)}
          </button>
        ))}
      </div>
      <Legend />
      {made.ok ? (
        <Player
          key={`learn-${index}-${narrow}`}
          trace={made.trace}
          scene={made.scene}
          bind={made.bind}
          moves={made.moves}
          names={made.names}
          values={made.values}
          flipPart={made.flipPart}
          onWrong={made.wrong}
          askFrame={made.askFrame}
          frame={made.frame}
          question={question}
          conclusion={MUL_CONCLUSION}
          needs={MUL_NEEDS}
          mistakes={made.mistakes}
          convention={made.convention}
        />
      ) : (
        <p class="field-error">{made.error}</p>
      )}
    </>
  );
}

const N_CHOICES = [2, 3, 4, 5, 6];

/** 改了模式或位数时按原来的读法读出数值，再按新的写法写出来。读不出时原样保留，交给引擎报错。 */
function rewrite(text: string, readN: number, readMode: MulMode, writeN: number, writeMode: MulMode): string {
  try {
    const units = parseValue(readMode === '无符号' ? text.replace(/^[+]/, '') : text, readN, '整数');
    if (writeMode === '无符号') return units >= 0 && units < 2 ** writeN ? fromUnsigned(units, writeN) : text.replace(/^[+\-−]/, '');
    return formatValue(units, writeN, '整数');
  } catch {
    return text;
  }
}

function Try() {
  const [modeText, setMode] = useParam('m', '补码', (raw) => (MODES.includes(raw as MulMode) ? raw : '补码'));
  const [nText, setN] = useParam('n', '4', (raw) => String(Math.max(2, Math.min(6, Math.trunc(Number(raw)) || 4))));
  const [x, setX] = useParam('x', '+1011');
  const [y, setY] = useParam('y', '-0110');
  const mode = modeText as MulMode;
  const n = Math.max(2, Math.min(6, Math.trunc(Number(nText)) || 4));
  const [draft, setDraft] = useState<{ x: string; y: string } | null>(null);
  const shownX = draft?.x ?? x;
  const shownY = draft?.y ?? y;
  const params: MulParams = useMemo(() => ({ mode, n, x: { as: '真值', text: x }, y: { as: '真值', text: y } }), [mode, n, x, y]);
  const narrow = useNarrow();
  const made = useMemo(() => lesson(params, narrow), [params, narrow]);

  const commit = () => {
    if (!draft) return;
    setX(draft.x.trim());
    setY(draft.y.trim());
    setDraft(null);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    commit();
  };
  const edit = (key: 'x' | 'y', value: string) => setDraft({ x: shownX, y: shownY, [key]: value });
  const changeMode = (to: MulMode) => {
    if (to === mode) return;
    setX(rewrite(x, n, mode, n, to));
    setY(rewrite(y, n, mode, n, to));
    setDraft(null);
    setMode(to);
  };
  const changeN = (next: number) => {
    setX(rewrite(x, n, mode, next, mode));
    setY(rewrite(y, n, mode, next, mode));
    setDraft(null);
    setN(String(next));
  };
  const signed = mode !== '无符号';
  const result = made.ok ? made.trace.result : null;

  return (
    <>
      <form class="mul-form" onSubmit={submit}>
        <div class="field mul-wide">
          <span class="field-label" id="mul-mode">乘法</span>
          <div class="seg" role="group" aria-labelledby="mul-mode">
            {MODES.map((item) => (
              <button key={item} type="button" aria-pressed={item === mode} onClick={() => changeMode(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <label for="mul-n">数值位 n</label>
          <select id="mul-n" class="select" value={String(n)} onChange={(e) => changeN(Number(e.currentTarget.value))}>
            {N_CHOICES.map((item) => (
              <option key={item} value={String(item)}>
                {item}
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <label for="mul-x">{signed ? 'x 的真值' : 'A'}</label>
          <input id="mul-x" class="input is-mono" value={shownX} autoComplete="off" spellcheck={false} onInput={(e) => edit('x', e.currentTarget.value)} onChange={commit} />
        </div>
        <div class="field">
          <label for="mul-y">{signed ? 'y 的真值' : 'B'}</label>
          <input id="mul-y" class="input is-mono" value={shownY} autoComplete="off" spellcheck={false} onInput={(e) => edit('y', e.currentTarget.value)} onChange={commit} />
        </div>
        <button type="submit" class="mul-hidden-submit" tabIndex={-1} aria-hidden="true" />
      </form>
      <p class="field-help">{signed ? `二进制定点整数，${n} 位数值位，负数前面写 −，如 −0110。` : `${n} 位无符号二进制数，如 ${'1011'.padStart(n, '0').slice(-n)}。`}</p>
      {!x.trim() || !y.trim() ? (
        <p class="field-error" role="alert">
          {!x.trim() ? 'x 还没填。' : 'y 还没填。'}
        </p>
      ) : made.ok && result ? (
        <>
          <dl class="mul-result">
            <div>
              <dt>
                <Rich text={sub(signed ? (mode === '原码' ? '[x×y]原' : '[x·y]补') : 'P')} />
              </dt>
              <dd>{result['乘积']}</dd>
            </div>
            <div>
              <dt>十进制</dt>
              <dd>{result['十进制']}</dd>
            </div>
            <div>
              <dt>
                <Rich text="t_m" />
              </dt>
              <dd>{result['延迟']}</dd>
            </div>
          </dl>
          <Player
            key={`try-${JSON.stringify(params)}-${narrow}`}
            trace={made.trace}
            scene={made.scene}
            bind={made.bind}
            moves={made.moves}
            names={made.names}
            values={made.values}
            flipPart={made.flipPart}
            onWrong={made.wrong}
            askFrame={made.askFrame}
            frame={made.frame}
            convention={made.convention}
          />
        </>
      ) : (
        <p class="field-error" role="alert">
          {made.ok ? '' : <Rich text={sub(made.error).replace('2^2n', '2^(2n)')} />}
        </p>
      )}
    </>
  );
}
