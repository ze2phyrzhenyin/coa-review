import { useEffect, useMemo, useState } from 'preact/hooks';
import type { TargetedEvent } from 'preact';
import { useParam } from '../../app/url-state';
import { Term } from '../../app/TermCard';
import type { Instruction, SignalNames } from '../../engines/cpu/model';
import { MAX_FLOW_INSTRUCTIONS, sampleFlow } from '../../engines/hardwired/flow';
import type { FlowParams } from '../../engines/hardwired/flow';
import { parseLine } from '../5-cycle/program';
import { Field, PageShell, Seg } from '../4-ea/shell';
import { FlowPlayer } from './play';
import { FlowPaper } from './Paper';

/** 5-cycle 的写法再加上 AND（写法同 ADD）。 */
function parseAny(line: string): Instruction | string {
  const m = /^\s*AND\s+(R[0-3])\s*[,，]\s*(R[0-3])\s*$/i.exec(line);
  if (m) return { op: 'AND', rx: m[1]!.toUpperCase() as 'R0', ry: m[2]!.toUpperCase() as 'R0' };
  return parseLine(line);
}

const EXAMPLES: { key: string; label: string; instructions: Instruction[]; lead: string }[] = [
  { key: 'lad', label: '例题：LAD', instructions: [{ op: 'LAD', rx: 'R0', addr: 9 }], lead: 'LAD R0,9 把数存 9 号单元的数取进 R0。' },
  { key: 'sto', label: '变式：STO', instructions: [{ op: 'STO', rx: 'R1', ry: 'R3' }], lead: '把读数存换成写数存：STO R1,(R3)。' },
  { key: 'all', label: '五条一起', instructions: sampleFlow().instructions, lead: '图 5.15 的五种指令，用本站的寄存器和地址。' },
];

const nameItems = [
  { key: 'book', label: '教材' },
  { key: 'solutions', label: '解析书' },
] as const;

function SignalSeg() {
  const [nm, setNm] = useParam('nm', 'book', (raw) => (raw === 'solutions' ? 'solutions' : 'book'));
  const [, setStep] = useParam('s', '0');
  return (
    <Seg
      label="信号名"
      items={nameItems}
      value={nm as SignalNames}
      onChoose={(key) => {
        setStep('0');
        setNm(key);
      }}
    />
  );
}

function Learn() {
  const [ex, setEx] = useParam('ex', 'lad', (raw) => (EXAMPLES.some((item) => item.key === raw) ? raw : 'lad'));
  const [nm] = useParam('nm', 'book', (raw) => (raw === 'solutions' ? 'solutions' : 'book'));
  const [, setStep] = useParam('s', '0');
  const example = EXAMPLES.find((item) => item.key === ex) ?? EXAMPLES[0]!;
  const params = useMemo<FlowParams>(() => ({ instructions: example.instructions, names: nm as SignalNames }), [example, nm]);
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
        <SignalSeg />
      </div>
      <p class="ix-lead">
        <Term k="方框图" />里一个方框是一个 <Term k="CPU 周期" />，框里写这个周期的数据通路「源→目的」；菱形是译码，「～」是<Term k="公操作" />（教材 p161–162）。框旁边的<Term k="电位信号" />直接写，
        <Term k="脉冲信号" />注明在哪个<Term k="节拍" />。台面左边是方框图，右边是图 5.1 的模型机：每画一个方框，模型机就把这个周期走一遍；点方框可以再看一遍它的通路。手机上镜头停在模型机里收值的部件上。{example.lead}
      </p>
      <FlowPlayer key={`${example.key}|${nm}`} params={params} lesson />
    </>
  );
}

/** 试一试：自己写几条指令，看它们的方框图。指令在网址参数 prog（分号隔开）。 */
function Try() {
  const [prog, setProg] = useParam('prog', 'LAD R2,6;ADD R2,R0');
  const [nm] = useParam('nm', 'book', (raw) => (raw === 'solutions' ? 'solutions' : 'book'));
  const [, setStep] = useParam('s', '0');
  const [draft, setDraft] = useState(prog.replace(/;/g, '\n'));
  useEffect(() => setDraft(prog.replace(/;/g, '\n')), [prog]);
  const read = (text: string): { instructions: Instruction[]; problem: string } => {
    const lines = text.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { instructions: [], problem: '至少写一条指令' };
    if (lines.length > MAX_FLOW_INSTRUCTIONS) return { instructions: [], problem: `最多 ${MAX_FLOW_INSTRUCTIONS} 条` };
    const out: Instruction[] = [];
    for (const line of lines) {
      const parsed = parseAny(line);
      if (typeof parsed === 'string') return { instructions: [], problem: parsed };
      out.push(parsed);
    }
    return { instructions: out, problem: '' };
  };
  const current = useMemo(() => read(prog), [prog]);
  const [problem, setProblem] = useState('');
  const submit = (event: TargetedEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = read(draft);
    setProblem(next.problem);
    if (next.problem) return;
    setStep('0');
    setProg(draft.split('\n').map((l) => l.trim()).filter(Boolean).join(';'));
  };
  return (
    <>
      <div class="ix-controls">
        <SignalSeg />
      </div>
      <form class="ix-form" onSubmit={submit}>
        <Field label="指令（一行一条）" help="写法：MOV R2,R1、NOT R1,R0、ADD R0,R1、AND R0,R1、LAD R0,9、STO R1,(R3)、JMP 37" grow>
          <textarea class="input is-mono" rows={3} spellcheck={false} value={draft} onInput={(e) => setDraft(e.currentTarget.value)} />
        </Field>
        <button type="submit" class="btn">
          画方框图
        </button>
      </form>
      {problem ? (
        <p class="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {current.problem ? <p class="field-error">{current.problem}</p> : <FlowPlayer key={`${prog}|${nm}`} params={{ instructions: current.instructions, names: nm as SignalNames }} lesson={false} />}
    </>
  );
}

export default function Page() {
  return <PageShell id="flow" panels={{ '': Learn, try: Try, quiz: FlowPaper }} />;
}
