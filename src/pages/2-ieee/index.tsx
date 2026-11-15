import { useMemo, useState } from 'preact/hooks';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import type { Direction, IeeeFormat, IeeeParams } from '../../engines/ieee/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { breakTrace, breakWrong } from './break';
import { EXAMPLES, lesson, practiceParams, tidy } from './lesson';
import type { Lesson } from './lesson';
import { IEEE_CONCLUSION, ieeeScene } from './scene';
import { Choice, PageTabs, useExample, usePageTab, useSeed } from '../2-codes/shared';
import '../2-codes/codes.css';

const NEEDS = [{ href: '/2-codes', text: '移码' }];

export default function Page() {
  const [tab, choose] = usePageTab();
  return (
    <div class="cd">
      <PageTabs prefix="fp" current={tab} choose={choose}>
        {tab === 'learn' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'practice' && <Practice />}
        {tab === 'break' && <Break />}
      </PageTabs>
    </div>
  );
}

function Formula() {
  return (
    <p class="cd-formula">
      <Term k="IEEE754">IEEE 754</Term> 单精度：x = (−1)<sup>S</sup> × 1.M × 2<sup>E − 127</sup>。S 是<Term k="符号位" />，<Term k="阶码">阶码 E</Term> 8 位，<Term k="尾数">尾数 M</Term> 23 位；1.M 前面那个 1 是<Term k="隐藏位" />。下面的尺子按真实长度画了相邻三段 2<sup>e−1</sup>、2<sup>e</sup>、2<sup>e+1</sup>，每段只画 8 格。
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
      <Formula />
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
          question={made.question}
          conclusion={IEEE_CONCLUSION}
          needs={NEEDS}
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

const FORMATS = ['单精度', '双精度', '偏移128', '教学格式'] as const;
type FormatName = (typeof FORMATS)[number];
const DIRS: Direction[] = ['十进制→机器数', '机器数→十进制'];
const dirName = (d: Direction) => (d === '十进制→机器数' ? '十进制写成机器码' : '机器码读成十进制');

function Try() {
  const [fText, setF] = useParam('f', '单精度', (raw) => (FORMATS.includes(raw as FormatName) ? raw : '单精度'));
  const [dText, setD] = useParam('dir', '十进制→机器数', (raw) => (DIRS.includes(raw as Direction) ? raw : '十进制→机器数'));
  const [text, setText] = useParam('x', '20.59375');
  const [kText, setK] = useParam('k', '4', (raw) => String(Math.max(2, Math.min(8, Math.trunc(Number(raw)) || 4))));
  const [mText, setM] = useParam('m', '7', (raw) => String(Math.max(2, Math.min(16, Math.trunc(Number(raw)) || 7))));
  const [ec, setEc] = useParam('ec', '移码', (raw) => (raw === '补码' ? '补码' : '移码'));
  const [mc, setMc] = useParam('mc', '原码', (raw) => (raw === '补码' ? '补码' : '原码'));
  const name = fText as FormatName;
  const direction = dText as Direction;
  const format: IeeeFormat = name === '教学格式' ? { k: Number(kText), exp: ec as '移码' | '补码', m: Number(mText), mant: mc as '原码' | '补码' } : name;
  const [draft, setDraft] = useState<string | null>(null);
  const narrow = useNarrow();
  const params: IeeeParams = useMemo(() => ({ format, direction, text: text.trim() }), [JSON.stringify(format), direction, text]); // eslint-disable-line react-hooks/exhaustive-deps
  const made: Lesson = useMemo(() => (text.trim() ? lesson(params, narrow) : { ok: false, error: '还没填。' }), [params, narrow, text]);
  const commit = () => {
    if (draft === null) return;
    setText(draft.trim());
    setDraft(null);
  };
  return (
    <>
      <div class="cd-form">
        <div class="field">
          <span class="field-label">格式</span>
          <Choice label="格式" options={FORMATS} value={name} onPick={(next) => setF(next)} names={(item) => (item === '偏移128' ? '偏移 128' : item)} />
        </div>
        <div class="field">
          <span class="field-label">方向</span>
          <Choice
            label="方向"
            options={DIRS}
            value={direction}
            names={dirName}
            onPick={(next) => {
              setDraft(null);
              setD(next);
              setText(next === '十进制→机器数' ? '20.59375' : name === '教学格式' ? '568H' : name === '双精度' ? '4034980000000000H' : '41360000H');
            }}
          />
        </div>
        {name === '教学格式' ? (
          <>
            <div class="field">
              <label for="fp-k">阶码位数 k（含阶符）</label>
              <select id="fp-k" class="select" value={kText} onChange={(e) => setK(e.currentTarget.value)}>
                {[2, 3, 4, 5, 6, 7, 8].map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <span class="field-label">阶码用</span>
              <Choice label="阶码用" options={['移码', '补码'] as const} value={ec as '移码' | '补码'} onPick={(v) => setEc(v)} />
            </div>
            <div class="field">
              <label for="fp-m">尾数位数 m（不含数符）</label>
              <select id="fp-m" class="select" value={mText} onChange={(e) => setM(e.currentTarget.value)}>
                {Array.from({ length: 15 }, (_, i) => i + 2).map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <span class="field-label">尾数用</span>
              <Choice label="尾数用" options={['原码', '补码'] as const} value={mc as '原码' | '补码'} onPick={(v) => setMc(v)} />
            </div>
          </>
        ) : null}
        <div class="field">
          <label for="fp-x">{direction === '十进制→机器数' ? '十进制 x（可写 27/64、∞、NaN）' : '机器码（十六进制带 H，或二进制）'}</label>
          <input
            id="fp-x"
            class="input is-mono"
            value={draft ?? text}
            autoComplete="off"
            spellcheck={false}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onChange={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
          />
        </div>
      </div>
      {made.ok ? (
        <>
          <dl class="cd-result">
            {Object.entries(made.trace.result).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <Rich text={value.length > 40 ? `${value.slice(0, 39)}…` : value} />
                </dd>
              </div>
            ))}
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
  const what = made.trace.conditions.find((c) => c.label === '格式')?.value ?? '';
  return (
    <>
      <p class="cd-task">
        第 {seed} 题。{what}。{params.direction === '十进制→机器数' ? `把 ${params.text.replace('-', '−')} 写成机器码。` : `把 ${params.text} 读成十进制。`}每一步先答再往下走，位片点一下翻一面。
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
  const trace = useMemo(() => tidy(breakTrace()), []);
  const made = useMemo(() => ieeeScene(trace, narrow, 'decode'), [trace, narrow]);
  return (
    <>
      <p class="cd-task">
        <Rich text="同一个 6.625 存三次，每次都让机器按 IEEE 754 单精度读回来，看指针停在哪一段。" />
      </p>
      <Player key={`break-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} onWrong={breakWrong} />
    </>
  );
}
