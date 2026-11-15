/**
 * 练习：台面上一张答题纸，一行一个要求的量，学生填结果。没有动画；判分按引擎 compute 的数值，允许题目要求的位数内的差。
 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { run } from '../../engines/cacheperf/model';
import type { Params } from '../../engines/cacheperf/model';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { PaperStage, useDraft, useSeed, useWidePaper } from '../3-vm-replace/kit';
import { nameOf } from './scene';
import { answerOf, grade, inputOf, quizParams } from './setup';

export function Paper() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

/** 判分说明里用短名：h、r、e、t_a。 */
const short = (key: string): string => (key === 'h' || key === 'r' || key === 'e' || key === 't_a' ? key : nameOf(key));

const HINTS: Record<string, string> = {
  h: 'h = N_c/(N_c + N_m)；知道 t_a 时 h = (t_m − t_a)/(t_m − t_c)；知道 e 时 h = (r − 1/e)/(r − 1)。',
  r: 'r = t_m/t_c，主存比 cache 慢几倍。',
  e: 'e = t_c/t_a = 1/[r + (1 − r)h]，写成百分数。',
  t_a: 't_a = h·t_c + (1 − h)·t_m，或 t_a = t_c/e。',
  时钟周期: '时钟周期 = 1 / 时钟频率。',
  主存缺失损失: '访问主存的时间除以时钟周期，折成周期数。',
  一级CPI: '基本 CPI + 一级缺失率 × 主存缺失损失。',
  二级缺失损失: '访问二级 cache 的时间除以时钟周期。',
  两级CPI: '基本 CPI + 一级缺失率 × 二级缺失损失 + 必须访问主存的缺失率 × 主存缺失损失。',
  性能比: '一级 CPI ÷ 两级 CPI。',
};

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<Params>(() => quizParams(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const keys = Object.keys(trace.result);
  const wide = useWidePaper();
  const ok = (value: unknown): value is Record<string, string> => !!value && typeof value === 'object' && keys.every((key) => typeof (value as Record<string, unknown>)[key] === 'string');
  const [typed, setTyped] = useDraft(`coa:3-cache-perf:quiz:${seed}`, () => Object.fromEntries(keys.map((key) => [key, ''])), ok);
  const [wrong, setWrong] = useState<string[] | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [, setTab] = useParam('t', '');
  const [, setStep] = useParam('s', '0');
  const setters = {
    kind: useParam('kind', 'fwd')[1],
    order: useParam('order', 'book')[1],
    nc: useParam('nc', '4750')[1],
    nm: useParam('nm', '250')[1],
    tc: useParam('tc', '20')[1],
    tm: useParam('tm', '120')[1],
    ta: useParam('ta', '30')[1],
    e: useParam('e', '0.75')[1],
    ghz: useParam('ghz', '2')[1],
    cpi: useParam('cpi', '1.2')[1],
    mem: useParam('mem', '80')[1],
    l1: useParam('l1', '4')[1],
    l2ns: useParam('l2ns', '6')[1],
    l2: useParam('l2', '0.8')[1],
  };

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title: '答题纸',
          props: { name: '答题纸', columns: [{ title: '结果', width: 2.6 }], rows: keys.map(() => ['']), labels: keys.map(nameOf) },
        },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 2.6 + keys.length * 0.6] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    // keys 只由题型决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [trace, wide],
  );
  const pose = useMemo<Pose>(
    () => ({
      parts: {
        paper: { ...scene.parts[0]!.props, rows: keys.map((key) => [(typed[key] ?? '').trim()]), changedCells: (wrong ?? []).slice(0, 1).map((key) => `${keys.indexOf(key)}.0`) },
        ...(scene.parts[1] ? { desk: { ...scene.parts[1].props } } : {}),
      },
      wires: {},
    }),
    // keys 只由题型决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scene, typed, wrong],
  );

  const check = (event?: TargetedEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setWrong(grade(params, typed));
  };
  const reveal = () => {
    const filled = answerOf(params);
    setTyped(filled);
    setRevealed(true);
    setWrong(grade(params, filled));
  };
  const demo = (key: string) => {
    const input = inputOf(params);
    for (const [k, value] of Object.entries(input)) setters[k as keyof typeof setters](value);
    const at = trace.steps.findIndex((step) => step.changes.some((change) => change.at === key));
    setStep(String(Math.max(0, at)));
    setTab('try');
  };

  const panel = (style: Parameters<Parameters<typeof PaperStage>[0]['panel']>[0], ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`t4-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={check} data-no-orbit>
      <div class="t4-fill-grid">
        {keys.map((key) => (
          <label key={key} class={wrong?.includes(key) ? 'is-wrong' : ''}>
            <span>
              <Rich text={nameOf(key)} />
            </span>
            <input
              class="input is-mono"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={typed[key] ?? ''}
              onInput={(event) => {
                setTyped({ ...typed, [key]: event.currentTarget.value });
                setWrong(null);
              }}
            />
          </label>
        ))}
      </div>
      <div class="t4-fill-foot">
        <button type="submit" class="btn is-primary">
          交卷
        </button>
        <button type="button" class="btn is-quiet" onClick={reveal}>
          看答案
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (wrong && wrong.length === 0) {
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-ok-text">{revealed ? '答案已填上' : '全对'}</span>
        <Rich text={keys.map((key) => `${short(key)} = ${trace.result[key]}`).join('，')} />。
        <button type="button" class="btn" onClick={onNext}>
          换一道
        </button>
      </p>
    );
  } else if (wrong) {
    const first = wrong[0]!;
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-bad-text">不对</span>
        <Rich text={`${short(first)} 有错${wrong.length > 1 ? `，一共 ${wrong.length} 处没填对` : ''}。${HINTS[first] ?? ''}`} />
        <button type="button" class="btn" onClick={() => demo(first)}>
          看这一步的演示
        </button>
      </p>
    );
  }

  return (
    <div class="t4-quiz">
      <p class="t4-task">按下面的条件依次求出各量。e 和缺失率写百分数，h、r、CPI 写小数（最多 4 位），时间带 ns。</p>
      <dl class="pl-given">
        {trace.conditions.map((condition) => (
          <div key={condition.label}>
            <dt>
              <Rich text={condition.label} />
            </dt>
            <dd>
              <Rich text={condition.value} />
            </dd>
          </div>
        ))}
        <div>
          <dt>题号</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
