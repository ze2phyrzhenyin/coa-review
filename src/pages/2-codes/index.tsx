import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import type { CodesInput, CodesParams } from '../../engines/codes/model';
import type { Code, Notation } from '../../lib/bits';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { breakScene, breakTrace } from './break';
import { EXAMPLES, lesson, practiceParams } from './lesson';
import type { Lesson } from './lesson';
import { CODES, CODES_CONCLUSION, tag } from './scene';
import { Choice, NeedsText, PageTabs, useExample, usePageTab, useSeed } from './shared';
import './codes.css';

export default function Page() {
  const [tab, choose] = usePageTab();
  return (
    <div class="cd">
      <PageTabs prefix="cd" current={tab} choose={choose}>
        {tab === 'learn' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'practice' && <Practice />}
        {tab === 'break' && <Break />}
      </PageTabs>
    </div>
  );
}

/** 盘的说明：哪一圈、几格、深色的带是什么。术语第一次出现时可以点开。 */
function Legend({ n, notation }: { n: number; notation: Notation }) {
  return (
    <p class="cd-legend">
      <Term k="机器数" />共 {n + 1} 位：1 位<Term k="符号位" />加 {n} 位<Term k="数值位" />，{notation === '整数' ? <Term k="定点整数" /> : '定点小数'}
      。每个盘是这 {n + 1} 位的全部写法排成一圈，<Rich text={`一圈 2^${n + 1} 格`} />（<Term k="模" />），0 在正上方，顺时针递增；刻度里深色的一段是这种码的负数。同一个
      <Term k="真值" /> x，在四个盘上指的格子不一样。
    </p>
  );
}

function Learn() {
  const [index, pick] = useExample(EXAMPLES.length);
  const narrow = useNarrow();
  const example = EXAMPLES[index]!;
  const made = useMemo(() => lesson(example.params, narrow), [example, narrow]);
  return (
    <>
      <NeedsText>二进制和十进制互化（教材 p23）</NeedsText>
      <Legend n={example.params.n} notation={example.params.notation} />
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
          question={made.question}
          conclusion={CODES_CONCLUSION}
          mistakes={made.mistakes}
          convention={made.convention}
        >
          <Choice label="例题" options={EXAMPLES.map((item) => item.label)} value={example.label} onPick={(label) => pick(EXAMPLES.findIndex((item) => item.label === label))} mono />
        </Player>
      ) : (
        <p class="field-error">{made.error}</p>
      )}
    </>
  );
}

const AS = ['十进制', '真值', '机器数'] as const;
type As = (typeof AS)[number];
const NS = [1, 2, 3, 4, 5, 6, 7, 8];

function Try() {
  const [asText, setAs] = useParam('as', '十进制', (raw) => (AS.includes(raw as As) ? raw : '十进制'));
  const [text, setText] = useParam('x', '-45');
  const [codeText, setCode] = useParam('code', '补码', (raw) => (CODES.includes(raw as Code) ? raw : '补码'));
  const [nText, setN] = useParam('n', '7', (raw) => String(Math.max(1, Math.min(8, Math.trunc(Number(raw)) || 7))));
  const [ntText, setNt] = useParam('nt', '整数', (raw) => (raw === '小数' ? '小数' : '整数'));
  const as = asText as As;
  const code = codeText as Code;
  const n = Math.max(1, Math.min(8, Math.trunc(Number(nText)) || 7));
  const notation: Notation = ntText === '小数' ? '小数' : '整数';
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? text;
  const narrow = useNarrow();

  const params: CodesParams = useMemo(() => {
    const input: CodesInput = as === '机器数' ? { as, code, bits: text.trim() } : { as, text: text.trim() };
    return { n, notation, input };
  }, [as, code, text, n, notation]);
  const made: Lesson = useMemo(() => (text.trim() ? lesson(params, narrow) : { ok: false, error: '还没填。' }), [params, narrow, text]);

  const commit = () => {
    if (draft === null) return;
    setText(draft.trim());
    setDraft(null);
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    commit();
  };
  const placeholder = as === '十进制' ? (notation === '整数' ? '例如 -45' : '例如 -0.375') : as === '真值' ? (notation === '整数' ? '例如 -0101101' : '例如 -0.0111') : notation === '整数' ? `${n + 1} 位，例如 1${'0'.repeat(n)}` : `例如 1.${'0'.repeat(n)}`;

  return (
    <>
      <form class="cd-form" onSubmit={submit}>
        <div class="field">
          <span class="field-label">给出的是</span>
          <Choice
            label="给出的是"
            options={AS}
            value={as}
            onPick={(next) => {
              setDraft(null);
              setAs(next);
            }}
          />
        </div>
        {as === '机器数' ? (
          <div class="field">
            <span class="field-label">哪一种码</span>
            <Choice label="哪一种码" options={CODES} value={code} onPick={(next) => setCode(next)} />
          </div>
        ) : null}
        <div class="field">
          <label for="cd-x">{as === '机器数' ? tag(code) : as === '真值' ? '二进制真值 x' : '十进制 x'}</label>
          <input id="cd-x" class="input is-mono" value={shown} placeholder={placeholder} inputMode="text" autoComplete="off" spellcheck={false} onInput={(e) => setDraft(e.currentTarget.value)} onChange={commit} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())} />
        </div>
        <div class="field">
          <label for="cd-n">数值位 n</label>
          <select id="cd-n" class="select" value={String(n)} onChange={(e) => setN(e.currentTarget.value)}>
            {NS.map((item) => (
              <option key={item} value={String(item)}>
                {item}（机器数 {item + 1} 位）
              </option>
            ))}
          </select>
        </div>
        <div class="field">
          <span class="field-label">写法</span>
          <Choice label="写法" options={['整数', '小数'] as const} value={notation} onPick={(next) => setNt(next)} names={(item) => `定点${item}`} />
        </div>
      </form>
      {made.ok ? (
        <>
          <dl class="cd-result">
            {['[x]原', '[x]反', '[x]补', '[x]移'].map((key) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{made.trace.result[key]}</dd>
              </div>
            ))}
            <div>
              <dt>真值</dt>
              <dd>
                {made.trace.result['真值']}（{made.trace.result['十进制']}）
              </dd>
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
          {made.error}
        </p>
      )}
    </>
  );
}

function Practice() {
  const [seed, next] = useSeed();
  const narrow = useNarrow();
  const params = useMemo(() => practiceParams(seed), [seed]);
  const made = useMemo(() => lesson(params, narrow, true), [params, narrow]);
  if (!made.ok) return <p class="field-error">{made.error}</p>;
  const input = made.trace.conditions.find((item) => item.label === '输入')?.value ?? '';
  return (
    <>
      <p class="cd-task">
        第 {seed} 题。{made.trace.conditions.find((item) => item.label === '字长')?.value}，{made.trace.conditions.find((item) => item.label === '写法')?.value}，{input.replace('-', '−')}。按顺序写出四种机器数，写不出的选「写不出」。位片点一下翻一面。
      </p>
      <Player
        key={`practice-${seed}-${narrow}`}
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
      >
        <button type="button" class="btn" onClick={next}>
          换一题
        </button>
      </Player>
    </>
  );
}

function Break() {
  const narrow = useNarrow();
  const trace = useMemo(() => breakTrace(), []);
  const made = useMemo(() => breakScene(trace, narrow), [trace, narrow]);
  return (
    <>
      <p class="cd-task">把三种码当成普通的二进制数直接相加：盘上就是指针顺时针转过 b 的机器码那么多格。先猜哪个盘停对。</p>
      <Player key={`break-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} onWrong={made.wrong} />
    </>
  );
}
