/**
 * 练习：引擎按种子出几条指令。台面上是指令板和一张答题纸（每一对一行：类型、会不会读错）。
 * 学生在填写栏里给每一对选 RAW、WAR、WAW（可以几种）或「无」，再标出五段流水线里会读错的。判分只看引擎的 hazards()，指出第一处错的一对，
 * 并在指令板上把这一对的读写集合和连线亮出来。
 */
import { useMemo, useState } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { generateHazard, hazards, kindsText, runHazard } from '../../engines/pipeline/hazard';
import type { HazardParams, Kind } from '../../engines/pipeline/hazard';
import { parseInstruction } from '../../engines/pipeline/instr';
import type { Pose, SceneSpec } from '../../scene';
import { Rich } from '../../player/Rich';
import { Given, PaperStage, Verdict, useDraft, useSeed } from '../5-spacetime/kit';
import type { DepsProps } from '../5-spacetime/part-types';
import { allLinks, kinds } from './scene';

interface Entry {
  kinds: Kind[];
  none: boolean;
  wrong: boolean;
}

const KINDS: Kind[] = ['RAW', 'WAR', 'WAW'];

export function HazardQuiz() {
  const [seed, next] = useSeed();
  return <Sheet key={seed} seed={seed} onNext={next} />;
}

function Sheet({ seed, onNext }: { seed: number; onNext: () => void }) {
  const params = useMemo<HazardParams>(() => generateHazard(seed), [seed]);
  const trace = useMemo(() => runHazard(params), [params]);
  const results = useMemo(() => hazards(params), [params]);
  const list = useMemo(() => params.instructions.map(parseInstruction), [params]);
  const links = useMemo(() => allLinks(results), [results]);
  const narrow = useNarrow();
  const blank = (): Entry[] => results.map(() => ({ kinds: [], none: false, wrong: false }));
  const isDraft = (value: unknown): value is Entry[] => Array.isArray(value) && value.length === results.length;
  const [entries, setEntries] = useDraft(`coa:5-hazard:quiz:${seed}`, blank, isDraft);
  const [graded, setGraded] = useState<{ first: number; part: 'kind' | 'wrong' | null } | null>(null);
  const [revealed, setRevealed] = useState(false);

  const scene = useMemo<SceneSpec>(
    () => ({
      parts: [
        {
          id: 'deps',
          kind: '5-spacetime:deps',
          position: [0, -1.4],
          title: '指令',
          props: { rows: list.map((x, r) => ({ label: `I${r + 1}`, text: x.text, reads: x.reads, writes: x.writes, shown: false })), links: links.map((l) => ({ ...l, on: false })), compact: narrow } satisfies DepsProps,
          describe: () => '指令和读写集合',
        },
        {
          id: 'paper',
          kind: 'memory',
          // 答题纸立起来不能挡住后面指令板的底边：按它的高度往前放。
          position: [0, -0.2 + (0.62 + results.length * 0.52) / 0.79],
          title: '答题纸',
          props: {
            name: '答题纸',
            columns: [{ title: '相关', width: narrow ? 2.4 : 2.8 }, { title: '五段里读错', width: narrow ? 1.9 : 2.2 }],
            labels: results.map((r) => `I${r.i}–I${r.j}`),
            rows: results.map(() => ['', '']),
          },
        },
      ],
      wires: [],
      kinds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seed, narrow],
  );

  const text = (entry: Entry): string => (entry.none ? '无' : entry.kinds.length ? KINDS.filter((k) => entry.kinds.includes(k)).join('、') : '');
  const pose = useMemo<Pose>(() => {
    const first = graded && graded.first >= 0 ? results[graded.first]! : null;
    const show = revealed || !!first;
    return {
      parts: {
        deps: {
          ...scene.parts[0]!.props,
          rows: list.map((x, r) => ({ label: `I${r + 1}`, text: x.text, reads: x.reads, writes: x.writes, shown: revealed || (!!first && (r === first.i - 1 || r === first.j - 1)) })),
          links: links.map((l) => ({ ...l, on: show && (revealed || (first !== null && l.i === first.i && l.j === first.j)), tone: first && l.i === first.i && l.j === first.j ? 'hot' : 'faint' })),
          current: first ? [first.i - 1, first.j - 1] : [],
        },
        paper: {
          ...scene.parts[1]!.props,
          rows: entries.map((entry) => [text(entry), entry.wrong ? '会' : '']),
          changedCells: graded && graded.first >= 0 ? [`${graded.first}.${graded.part === 'wrong' ? 1 : 0}`] : [],
          active: graded && graded.first >= 0 ? graded.first : -1,
        },
      },
      wires: {},
    };
  }, [scene, entries, graded, revealed, results, list, links]);

  const edit = (k: number, patch: Partial<Entry>) => {
    setEntries(entries.map((entry, i) => (i === k ? { ...entry, ...patch } : entry)));
    setGraded(null);
  };
  const toggle = (k: number, kind: Kind) => {
    const entry = entries[k]!;
    const has = entry.kinds.includes(kind);
    edit(k, { kinds: has ? entry.kinds.filter((x) => x !== kind) : [...entry.kinds, kind], none: false });
  };
  const check = () => {
    for (const [k, r] of results.entries()) {
      const entry = entries[k]!;
      if (text(entry) !== kindsText(r.kinds)) return setGraded({ first: k, part: 'kind' });
      if (entry.wrong !== r.wrong) return setGraded({ first: k, part: 'wrong' });
    }
    setGraded({ first: -1, part: null });
  };
  const reveal = () => {
    setEntries(results.map((r) => ({ kinds: [...r.kinds], none: r.kinds.length === 0, wrong: r.wrong })));
    setRevealed(true);
    setGraded({ first: -1, part: null });
  };

  const panel = (
    <form
      class="pp-fill"
      onSubmit={(event) => {
        event.preventDefault();
        check();
      }}
    >
      <p class="pp-fill-head">每一对选相关的类型（可以选几种），没有就选「无」；再标出五段流水线里不处理会读错的</p>
      <div class="pp-fill-grid">
        {results.map((r, k) => {
          const entry = entries[k]!;
          const bad = graded && graded.first === k;
          return (
            <div key={`${r.i}-${r.j}`} class={`pp-fill-group pp-pair${bad ? ' is-wrong' : ''}`} role="group" aria-label={`I${r.i} 和 I${r.j}`}>
              <span>
                I{r.i}–I{r.j}
              </span>
              <div class="seg is-mono">
                {KINDS.map((kind) => (
                  <button key={kind} type="button" aria-pressed={entry.kinds.includes(kind)} onClick={() => toggle(k, kind)}>
                    {kind}
                  </button>
                ))}
                <button type="button" aria-pressed={entry.none} onClick={() => edit(k, { none: !entry.none, kinds: [] })}>
                  无
                </button>
              </div>
              <div class="seg">
                <button type="button" aria-pressed={entry.wrong} onClick={() => edit(k, { wrong: !entry.wrong })}>
                  五段里会读错
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div class="pp-fill-foot">
        <button type="button" class="btn is-quiet" onClick={reveal}>
          看答案
        </button>
        <button type="button" class="btn" onClick={onNext}>
          换一题
        </button>
        <button type="submit" class="btn is-primary">
          交卷
        </button>
      </div>
    </form>
  );

  let verdict = null;
  if (graded) {
    if (graded.first < 0) {
      verdict = <Verdict ok>{revealed ? '答案已经填在纸上，指令板上画出了全部连线。' : `${results.length} 对都对。`}</Verdict>;
    } else {
      const r = results[graded.first]!;
      const a = list[r.i - 1]!;
      const b = list[r.j - 1]!;
      const set = (xs: string[]) => (xs.length ? `{${xs.join(', ')}}` : '∅');
      verdict =
        graded.part === 'kind' ? (
          <Verdict ok={false}>
            <Rich
              text={`I${r.i}–I${r.j} 的类型不对（指令板上亮出了这两条的读写集合）。I${r.i} ${a.meaning}：读 ${set(a.reads)}，写 ${set(a.writes)}；I${r.j} ${b.meaning}：读 ${set(b.reads)}，写 ${set(b.writes)}。拿后一条的读、写分别去比前一条的写、读、写。`}
            />
          </Verdict>
        ) : (
          <Verdict ok={false}>
            <Rich text={`I${r.i}–I${r.j} 会不会读错标得不对。只看寄存器的 RAW：I${r.i} 在第 ${r.i}+4 个周期写回，I${r.j} 在第 ${r.j}+1 个周期读，写回的下一个周期才读得到；中间有别的指令再写同一个寄存器时看最近的那条。`} />
          </Verdict>
        );
    }
  }

  return (
    <div class="pp-quiz">
      <p class="pp-task">下面几条指令按编号先后进入五段流水线（IF、ID、EX、MEM、WB），目标寄存器写在最前。判断每一对之间的数据相关，并指出不加处理时哪几对会读到旧值。</p>
      <Given items={[...list.map((x, r) => ({ label: `I${r + 1}`, value: `${x.text}（${x.meaning}）` })), { label: '题号', value: String(seed) }]} />
      <PaperStage scene={scene} pose={pose} frame={['deps', 'paper']} panel={panel} tall />
      {verdict}
    </div>
  );
}
