/**
 * 练习：台面上一张答题纸，画着地址格式的三段（全相联两段），学生填每段几位、地址共几位、每段的十六进制。
 * 没有动画；判分只看引擎。
 */
import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { run } from '../../engines/cacheaddr/model';
import type { Params } from '../../engines/cacheaddr/model';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { PaperStage, useDraft, useSeed, useWidePaper } from '../3-vm-replace/kit';
import { answerOf, grade, indexName, inputOf, quizParams } from './setup';
import { tidy } from './scene';
import type { Answer, Grade } from './setup';

export function Paper() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<Params>(() => quizParams(seed), [seed]);
  const trace = useMemo(() => run(params), [params]);
  const wide = useWidePaper();
  const full = params.mapping === '全相联';
  const names = full ? ['标记', '字地址'] : ['标记', indexName(params.mapping), '字地址'];
  const blank = (): Answer => ({ bits: names.map(() => ''), hex: names.map(() => ''), length: '' });
  const ok = (value: unknown): value is Answer => !!value && typeof value === 'object' && Array.isArray((value as Answer).bits) && (value as Answer).bits.length === names.length;
  const [answer, setAnswer] = useDraft(`coa:3-cache-addr:quiz:${seed}`, blank, ok);
  const [result, setResult] = useState<Grade | null>(null);
  const [revealed, setRevealed] = useState(false);

  const [, setTab] = useParam('t', '');
  const [, setStep] = useParam('s', '0');
  const setters = {
    map: useParam('map', 'set')[1],
    v: useParam('v', '2')[1],
    unit: useParam('unit', 'word')[1],
    wb: useParam('wb', '2')[1],
    k: useParam('k', '4')[1],
    mem: useParam('mem', '64K')[1],
    memIn: useParam('memIn', 'unit')[1],
    cache: useParam('cache', '1K')[1],
    cacheIn: useParam('cacheIn', 'unit')[1],
    addr: useParam('addr', 'A3C6')[1],
  };

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'paper',
          kind: 'memory',
          position: [0, 0],
          title: '答题纸',
          props: {
            name: `答题纸：地址 ${params.address ?? ''}H 的格式`,
            columns: names.map((title) => ({ title, width: 1.9, ink: 'addr' as const })),
            rows: [names.map(() => ''), names.map(() => '')],
            labels: ['位数', '十六进制'],
          },
        },
        { id: 'len', kind: 'label', position: [0, 1.45], props: { text: '地址共 __ 位', plate: true, size: 0.34 } },
        ...(wide ? [{ id: 'desk', kind: 'memory' as const, position: [0, 4.9] as const, props: { name: '填写', columns: [{ title: '', width: 6.4 }], rows: [[''], ['']], hidden: true } }] : []),
      ],
      wires: [],
    }),
    // names 只由映射方式决定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, wide],
  );

  const wrong = result?.wrong ?? [];
  const pose = useMemo<Pose>(() => {
    const cells = wrong.flatMap((key) => (key.startsWith('b') ? [`0.${key.slice(1)}`] : key.startsWith('h') ? [`1.${key.slice(1)}`] : []));
    return {
      parts: {
        paper: { ...scene.parts[0]!.props, rows: [answer.bits.map((t) => (t.trim() ? `${t.trim()} 位` : '')), answer.hex.map((t) => t.trim().toUpperCase())], changedCells: cells },
        len: { ...scene.parts[1]!.props, text: `地址共 ${answer.length.trim() || '__'} 位`, changed: wrong.includes('len') },
        ...(scene.parts[2] ? { desk: { ...scene.parts[2].props } } : {}),
      },
      wires: {},
    };
  }, [scene, answer, wrong]);

  const edit = (patch: Partial<Answer>) => {
    setAnswer({ ...answer, ...patch });
    setResult(null);
  };
  const check = (event?: TargetedEvent<HTMLFormElement>) => {
    event?.preventDefault();
    setResult(grade(params, answer));
  };
  const reveal = () => {
    const filled = answerOf(params);
    setAnswer(filled);
    setRevealed(true);
    setResult(grade(params, filled));
  };
  const demo = (atHex: boolean) => {
    const input = inputOf(params);
    for (const [key, value] of Object.entries(input)) setters[key as keyof typeof setters](value);
    const at = atHex ? trace.steps.findIndex((step) => step.changes.some((c) => c.at === 'address.tagBits')) : 0;
    setStep(String(Math.max(0, at)));
    setTab('try');
  };

  const panel = (style: Parameters<Parameters<typeof PaperStage>[0]['panel']>[0], ref: (el: HTMLFormElement | null) => void) => (
    <form ref={ref} class={`t4-fill${style ? ' is-anchored' : ''}`} style={style} onSubmit={check} data-no-orbit>
      <div class="t4-fill-grid">
        {names.map((name, i) => (
          <label key={`b${i}`} class={wrong.includes(`b${i}`) ? 'is-wrong' : ''}>
            <span>{name}几位</span>
            <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={answer.bits[i]} onInput={(event) => edit({ bits: answer.bits.map((t, k) => (k === i ? event.currentTarget.value : t)) })} />
          </label>
        ))}
        <label class={wrong.includes('len') ? 'is-wrong' : ''}>
          <span>地址共几位</span>
          <input class="input is-mono" type="text" inputMode="numeric" autoComplete="off" value={answer.length} onInput={(event) => edit({ length: event.currentTarget.value })} />
        </label>
      </div>
      <div class="t4-fill-grid">
        {names.map((name, i) => (
          <label key={`h${i}`} class={wrong.includes(`h${i}`) ? 'is-wrong' : ''}>
            <span>{name}（十六进制）</span>
            <input class="input is-mono" type="text" autoComplete="off" spellcheck={false} placeholder="如 1FH" value={answer.hex[i]} onInput={(event) => edit({ hex: answer.hex.map((t, k) => (k === i ? event.currentTarget.value : t)) })} />
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
  if (result && result.wrong.length === 0) {
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-ok-text">{revealed ? '答案已填上' : '全对'}</span>
        地址格式：{trace.result['地址格式']}。
        <button type="button" class="btn" onClick={onNext}>
          换一道
        </button>
      </p>
    );
  } else if (result) {
    const first = result.wrong[0]!;
    const i = Number(first.slice(1));
    const name = names[i] ?? '';
    const tips: Record<string, string> = {
      b: name === '字地址' ? '字地址看一块有几个编址单位：2^w = 每块的单位数。' : name === '标记' ? `标记 = 块号位数 s 减去${full ? ' 0（全相联不分段）' : `${names[1]}位数`}。` : name === '组号' ? '组号看组数：u = cache 行数 ÷ 每组行数，2^d = u。' : '行号看 cache 行数：2^r = m。',
      l: '地址位数 = 块号位数 s + 字地址位数 w，也等于主存编址单位数的位数。',
      h: '先把地址写成二进制，从高位按位数数出这一段，再从右往左 4 位一组换十六进制。',
    };
    verdict = (
      <p class="t4-verdict" role="status">
        <span class="is-bad-text">不对</span>
        {first === 'len' ? '地址位数' : first.startsWith('b') ? `${name}的位数` : `${name}的十六进制`}有错{result.wrong.length > 1 ? `，一共 ${result.wrong.length} 处` : ''}。<Rich text={tips[first[0] ?? 'h'] ?? ''} />
        <button type="button" class="btn" onClick={() => demo(first.startsWith('h'))}>
          看这道题的演示
        </button>
      </p>
    );
  }

  return (
    <div class="t4-quiz">
      <p class="t4-task">按下面的条件写出地址格式：{full ? '标记、字地址' : `标记、${names[1]}、字地址`}各几位，地址共几位，再把给出的地址切开，每段写成十六进制。</p>
      <dl class="pl-given">
        {trace.conditions.map((condition) => (
          <div key={condition.label}>
            <dt>
              <Rich text={condition.label} />
            </dt>
            <dd>
              <Rich text={tidy(condition.value)} />
            </dd>
          </div>
        ))}
        <div>
          <dt>题号</dt>
          <dd>{seed}</dd>
        </div>
      </dl>
      <PaperStage scene={scene} pose={pose} frame={wide ? ['paper', 'desk'] : ['paper', 'len']} panel={panel} wide={wide} />
      {verdict}
    </div>
  );
}
