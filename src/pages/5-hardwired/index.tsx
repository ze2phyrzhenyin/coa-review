import { useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Term } from '../../app/TermCard';
import type { Op, SignalNames } from '../../engines/cpu/model';
import { ALL_OPS, BOOK_OPS, runReverse, signals } from '../../engines/hardwired/model';
import type { DeriveParams } from '../../engines/hardwired/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { Field, PageShell, Seg } from '../4-ea/shell';
import { DerivePlayer } from './play';
import { revBind, revMoves, revNames, revScene } from './reverse';
import { HardPaper } from './Paper';

const EXAMPLES: { key: string; label: string; params: DeriveParams; lead: string }[] = [
  { key: 'lddr', label: 'LDDR', params: { signal: 'LDDR' }, lead: 'LDDR 把 DBUS 上的数打入 DR，是脉冲信号。' },
  { key: 'not', label: '变式：多一条 NOT', params: { signal: 'LDDR', instructions: ['MOV', 'NOT', 'LAD', 'ADD', 'STO', 'JMP'] }, lead: '指令集里加一条 NOT，其余不变。NOT 的执行周期也要把结果打入 DR。' },
  { key: 'rdd', label: 'RD(D)', params: { signal: 'RD(D)' }, lead: 'RD(D) 让数存一直读着，是电位信号。' },
  { key: 'ldpc', label: 'LDPC', params: { signal: 'LDPC' }, lead: 'LDPC 把数打入 PC，取指和 JMP 都要用。' },
];

function Learn() {
  const [ex, setEx] = useParam('ex', 'lddr', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'lddr'));
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
        同步控制下每条指令都走 M1、M2、M3 三个节拍电位，每个里面有 T1–T4 四个<Term k="节拍">节拍脉冲</Term>（教材 p178 图 5.30）。台面上的格子表一行是一拍、一列是一条指令，格子里是那一拍做的事。
        {example.lead}
        <Term k="脉冲信号" />与上 M 和 T，<Term k="电位信号" />只与 M。
      </p>
      <DerivePlayer key={example.key} params={example.params} lesson />
    </>
  );
}

const nameItems = [
  { key: 'book', label: '教材' },
  { key: 'solutions', label: '解析书' },
] as const;

/** 试一试：选指令和信号推表达式，或者写一个式子和流程图对照。都在网址里。 */
function Try() {
  const [mode, setMode] = useParam('m', 'derive', (raw) => (raw === 'check' ? 'check' : 'derive'));
  const [opsText, setOps] = useParam('ops', BOOK_OPS.join(','), (raw) => {
    const list = raw.split(',').filter((x) => (ALL_OPS as readonly string[]).includes(x));
    return list.length ? ALL_OPS.filter((x) => list.includes(x)).join(',') : BOOK_OPS.join(',');
  });
  const [nm, setNm] = useParam('nm', 'book', (raw) => (raw === 'solutions' ? 'solutions' : 'book'));
  const ops = opsText.split(',') as Op[];
  const list = useMemo(() => signals(ops, nm as SignalNames), [opsText, nm]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sig, setSig] = useParam('sig', 'LDDR');
  const signal = list.some((x) => x.name === sig) ? sig : list[0]!.name;
  const [expr, setExpr] = useParam('expr', 'M2·T3·ADD+M3·T3·LAD');
  const [draft, setDraft] = useState(expr);
  const [, setStep] = useParam('s', '0');
  const [problem, setProblem] = useState('');

  const toggle = (op: Op) => {
    const next = ops.includes(op) ? ops.filter((x) => x !== op) : [...ops, op];
    if (next.length === 0) return;
    setStep('0');
    setOps(ALL_OPS.filter((x) => next.includes(x)).join(','));
  };
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      runReverse({ expression: draft, signal, instructions: ops, names: nm as SignalNames });
      setProblem('');
      setStep('0');
      setExpr(draft.trim());
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <>
      <div class="ix-controls">
        <Seg
          label="做什么"
          items={[
            { key: 'derive', label: '推表达式' },
            { key: 'check', label: '检查一个式子' },
          ]}
          value={mode}
          onChoose={(key) => {
            setStep('0');
            setMode(key);
          }}
        />
        <Seg
          label="信号名"
          items={nameItems}
          value={nm as SignalNames}
          onChoose={(key) => {
            setStep('0');
            setNm(key);
          }}
        />
      </div>
      <div class="ix-controls">
        <div class="ix-seg-wrap">
          <span class="ix-seg-label">指令集</span>
          <div class="seg is-mono" role="group" aria-label="指令集">
            {ALL_OPS.map((op) => (
              <button key={op} type="button" aria-pressed={ops.includes(op)} onClick={() => toggle(op)}>
                {op}
              </button>
            ))}
          </div>
        </div>
        <Field label="信号">
          <select
            class="select"
            value={signal}
            onChange={(event) => {
              setStep('0');
              setSig(event.currentTarget.value);
            }}
          >
            {list.map((x) => (
              <option key={x.name} value={x.name}>
                {x.name}（{x.kind}）
              </option>
            ))}
          </select>
        </Field>
      </div>
      {mode === 'check' ? (
        <>
          <form class="ix-form" onSubmit={submit}>
            <Field label={`${signal} 的式子`} help="· 或 * 是与，+ 是或，可以加括号；只认 M1–M3、T1–T4 和指令名" grow>
              <input class="input is-mono" spellcheck={false} autoComplete="off" autoCapitalize="off" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} />
            </Field>
            <button type="submit" class="btn">
              对照
            </button>
          </form>
          {problem ? (
            <p class="field-error" role="alert">
              {problem}
            </p>
          ) : null}
          <ReversePlayer key={`${expr}|${signal}|${opsText}|${nm}`} expression={expr} signal={signal} ops={ops} names={nm as SignalNames} />
        </>
      ) : (
        <DerivePlayer key={`${signal}|${opsText}|${nm}`} params={{ signal, instructions: ops, names: nm as SignalNames }} lesson={false} />
      )}
    </>
  );
}

function ReversePlayer({ expression, signal, ops, names }: { expression: string; signal: string; ops: Op[]; names: SignalNames }) {
  const narrow = useNarrow();
  const made = useMemo(() => {
    try {
      const trace = runReverse({ expression, signal, instructions: ops, names });
      return { trace, scene: revScene(trace, narrow), bind: revBind(trace, narrow), moves: revMoves(trace, narrow), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [expression, signal, ops.join(','), names, narrow]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!('trace' in made) || !made.trace) return <p class="field-error">{made.error}</p>;
  return <Player wide trace={made.trace} scene={made.scene} bind={made.bind} moves={made.moves} names={revNames} />;
}

export default function Page() {
  return <PageShell id="hw" panels={{ '': Learn, try: Try, quiz: HardPaper }} />;
}
