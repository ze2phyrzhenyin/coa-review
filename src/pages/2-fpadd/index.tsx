import { useMemo, useState } from 'preact/hooks';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import type { FpAddParams, Rounding } from '../../engines/fpadd/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { breakTrace } from './break';
import { EXAMPLES, lesson, practiceParams, tidy } from './lesson';
import type { Lesson } from './lesson';
import { FP_CONCLUSION, fpScene } from './scene';
import { Choice, PageTabs, useExample, usePageTab, useSeed } from '../2-codes/shared';
import '../2-codes/codes.css';

const NEEDS = [
  { href: '/2-ieee', text: '浮点数的阶码和尾数' },
  { href: '/2-overflow', text: '变形补码' },
];

export default function Page() {
  const [tab, choose] = usePageTab();
  return (
    <div class="cd">
      <PageTabs prefix="fa" current={tab} choose={choose}>
        {tab === 'learn' && <Learn />}
        {tab === 'try' && <Try />}
        {tab === 'practice' && <Practice />}
        {tab === 'break' && <Break />}
      </PageTabs>
    </div>
  );
}

function Legend() {
  return (
    <p class="cd-legend">
      <Term k="阶码" /> 3 位数值位用<Term k="补码" />，运算时写两个<Term k="符号位" />；<Term k="尾数" /> 6 位数值位用<Term k="变形补码" />。<Term k="对阶" />是相加之前把两个数的阶码变成一样；<Term k="规格化" />是加完以后把尾数挪回规定的样子，阶码跟着改。每条尾数是一条滑轨，小数点固定，右头连着一个盒子：对阶、向右规格化移出去的位掉进盒子，舍入时再看它。
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
          onWrong={made.wrong}
          askFrame={made.askFrame} frame={made.frame}
          question={made.question}
          conclusion={FP_CONCLUSION}
          needs={NEEDS}
          mistakes={made.mistakes}
          convention={made.convention}
        >
          <Choice label="例题" options={EXAMPLES.map((item) => item.label)} value={example.label} onPick={(label) => pick(EXAMPLES.findIndex((item) => item.label === label))} />
        </Player>
      ) : (
        <p class="field-error">{made.error}</p>
      )}
    </>
  );
}

function Field({ id, label, value, onCommit }: { id: string; label: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    onCommit(draft.trim());
    setDraft(null);
  };
  return (
    <div class="field">
      <label for={id}>{label}</label>
      <input id={id} class="input is-mono" value={draft ?? value} autoComplete="off" spellcheck={false} onInput={(e) => setDraft(e.currentTarget.value)} onChange={commit} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())} />
    </div>
  );
}

function Try() {
  const [style, setStyle] = useParam('st', '补码', (raw) => (raw === '有效位' ? '有效位' : '补码'));
  const [op, setOp] = useParam('op', '加', (raw) => (raw === '减' ? '减' : '加'));
  const [k, setK] = useParam('k', '3', (raw) => String(Math.max(2, Math.min(4, Math.trunc(Number(raw)) || 3))));
  const [m, setM] = useParam('m', '6', (raw) => String(Math.max(3, Math.min(12, Math.trunc(Number(raw)) || 6))));
  const [dg, setDg] = useParam('d', '4', (raw) => String(Math.max(2, Math.min(12, Math.trunc(Number(raw)) || 4))));
  const [xe, setXe] = useParam('xe', '-11');
  const [xm, setXm] = useParam('xm', '0.100101');
  const [ye, setYe] = useParam('ye', '-10');
  const [ym, setYm] = useParam('ym', '-0.011110');
  const [xd, setXd] = useParam('xd', '0.5');
  const [yd, setYd] = useParam('yd', '-0.4375');
  const [rd, setRd] = useParam('rd', '0舍1入', (raw) => (['0舍1入', '截断', '就近舍入'].includes(raw) ? raw : '0舍1入'));
  const narrow = useNarrow();
  const rounding = (style === '补码' && rd === '就近舍入' ? '0舍1入' : rd) as Rounding;
  const params: FpAddParams = useMemo(
    () =>
      style === '补码'
        ? { style: '补码', k: Number(k), m: Number(m), op: op as '加' | '减', x: { exp: xe, mant: xm }, y: { exp: ye, mant: ym }, rounding: rounding as '0舍1入' | '截断' }
        : { style: '有效位', digits: Number(dg), op: op as '加' | '减', x: xd, y: yd, rounding },
    [style, k, m, op, xe, xm, ye, ym, dg, xd, yd, rounding],
  );
  const made: Lesson = useMemo(() => lesson(params, narrow), [params, narrow]);
  return (
    <>
      <div class="cd-form">
        <div class="field">
          <span class="field-label">写法</span>
          <Choice label="写法" options={['补码', '有效位'] as const} value={style as '补码' | '有效位'} onPick={(v) => setStyle(v)} names={(v) => (v === '补码' ? '阶码、尾数用补码' : '有效位 1.xxx')} />
        </div>
        <div class="field">
          <span class="field-label">运算</span>
          <Choice label="运算" options={['加', '减'] as const} value={op as '加' | '减'} onPick={(v) => setOp(v)} names={(v) => (v === '加' ? 'x + y' : 'x − y')} />
        </div>
        {style === '补码' ? (
          <>
            <div class="field">
              <label for="fa-k">阶码数值位 k</label>
              <select id="fa-k" class="select" value={k} onChange={(e) => setK(e.currentTarget.value)}>
                {[2, 3, 4].map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div class="field">
              <label for="fa-m">尾数数值位 m</label>
              <select id="fa-m" class="select" value={m} onChange={(e) => setM(e.currentTarget.value)}>
                {Array.from({ length: 10 }, (_, i) => i + 3).map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Field id="fa-xe" label="x 的阶码（二进制真值）" value={xe} onCommit={setXe} />
            <Field id="fa-xm" label="x 的尾数（二进制真值）" value={xm} onCommit={setXm} />
            <Field id="fa-ye" label="y 的阶码" value={ye} onCommit={setYe} />
            <Field id="fa-ym" label="y 的尾数" value={ym} onCommit={setYm} />
          </>
        ) : (
          <>
            <div class="field">
              <label for="fa-d">有效位数</label>
              <select id="fa-d" class="select" value={dg} onChange={(e) => setDg(e.currentTarget.value)}>
                {Array.from({ length: 11 }, (_, i) => i + 2).map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <Field id="fa-xd" label="x（十进制）" value={xd} onCommit={setXd} />
            <Field id="fa-yd" label="y（十进制）" value={yd} onCommit={setYd} />
          </>
        )}
        <div class="field">
          <span class="field-label">舍入</span>
          <Choice label="舍入" options={style === '补码' ? (['0舍1入', '截断'] as const) : (['0舍1入', '截断', '就近舍入'] as const)} value={rounding} onPick={(v) => setRd(v)} names={(v) => (v === '0舍1入' ? '0 舍 1 入' : v)} />
        </div>
      </div>
      {made.ok ? (
        <>
          <dl class="cd-result">
            {Object.entries(made.trace.result).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>
                  <Rich text={value} />
                </dd>
              </div>
            ))}
          </dl>
          <Player key={`try-${JSON.stringify(params)}-${narrow}`} trace={made.trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} onWrong={made.wrong} askFrame={made.askFrame} frame={made.frame} convention={made.convention} />
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
  const c = (label: string) => made.trace.conditions.find((item) => item.label === label)?.value ?? '';
  return (
    <>
      <p class="cd-task">
        <Rich text={`第 ${seed} 题。${c('格式')}。x = ${c('x')}，y = ${c('y')}，求 ${c('运算')}，${c('舍入')}。每道题点场景里的部件或填进框里。`.replace(/(?<![\^(])-/g, '−')} />
      </p>
      <Player key={`practice-${seed}-${narrow}`} trace={made.trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} onWrong={made.wrong} askFrame={made.askFrame} frame={made.frame} convention={made.convention}>
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
  const made = useMemo(() => fpScene(trace, narrow), [trace, narrow]);
  return (
    <>
      <p class="cd-task">x 的阶码大，故意让它去对 y：看 x 的尾数左移时丢的是哪一头，再照规矩做一遍比一比。</p>
      <Player key={`break-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} />
    </>
  );
}
