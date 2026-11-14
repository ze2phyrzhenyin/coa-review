import { useMemo } from 'preact/hooks';
import { useIntParam, useParam } from '../../app/url-state';
import { run, sampleParams } from '../../engines/cpu/model';
import type { Instruction, Params } from '../../engines/cpu/model';
import { Player } from '../../player/Player';
import { coarseMoves, coarsen, grainNames } from '../../player/coarsen';
import type { Grain } from '../../player/coarsen';
import { kitBind, kitMoves, kitScene, kitTrace } from './kit';
import { machineBind, machineBreak, machineCaption, machineMoves, machineNames, machineScene, machineValues } from './machine';

/** 可选的例题：一条指令，或样例程序。指令放在指存 32 号单元，寄存器和数存用样例程序的初值。 */
const choices: { id: string; label: string; ins: Instruction | null }[] = [
  { id: 'LAD', label: 'LAD', ins: { op: 'LAD', rx: 'R0', addr: 9 } },
  { id: 'ADD', label: 'ADD', ins: { op: 'ADD', rx: 'R0', ry: 'R1' } },
  { id: 'STO', label: 'STO', ins: { op: 'STO', rx: 'R1', ry: 'R3' } },
  { id: 'JMP', label: 'JMP', ins: { op: 'JMP', addr: 37 } },
  { id: 'MOV', label: 'MOV', ins: { op: 'MOV', rx: 'R2', ry: 'R1' } },
  { id: 'NOT', label: 'NOT', ins: { op: 'NOT', rx: 'R1', ry: 'R0' } },
  { id: 'prog', label: '程序', ins: null },
];
const grains: Grain[] = ['explain', 'beat', 'cycle', 'instruction'];

function paramsFor(choice: string): Params {
  const sample = sampleParams('book');
  const ins = choices.find((item) => item.id === choice)?.ins;
  if (ins === null) return sample;
  return { ...sample, program: [{ addr: sample.registers.PC, ins: ins ?? choices[0]!.ins! }], limit: 1 };
}

/** 宽屏是一排按钮；窄屏换成下拉框，只占一行。两者只显示一个。 */
function Choice<T extends string>({ label, value, options, names, onChange }: { label: string; value: T; options: readonly T[]; names: (option: T) => string; onChange: (value: T) => void }) {
  return (
    <>
      <div class="pl-choice" role="radiogroup" aria-label={label}>
        <span class="pl-choice-label">{label}</span>
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={option === value} class={`pl-chip${option === value ? ' is-on' : ''}`} onClick={() => onChange(option)}>
            {names(option)}
          </button>
        ))}
      </div>
      <label class="pl-select">
        <span class="pl-choice-label">{label}</span>
        <select value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {names(option)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Machine() {
  const [choice, setChoice] = useParam('ins', 'LAD');
  const [grainParam, setGrain] = useParam('lv', 'explain');
  const [, setStep] = useIntParam('s', 0, 0, 10_000);
  const grain = (grains as string[]).includes(grainParam) ? (grainParam as Grain) : 'explain';
  const full = useMemo(() => run(paramsFor(choice)), [choice]);
  const scene = useMemo(() => machineScene(full), [full]);
  const bind = useMemo(() => machineBind(full), [full]);
  const coarse = useMemo(() => coarsen(full, grain), [full, grain]);
  const moves = useMemo(() => coarseMoves(coarse.members, machineMoves), [coarse]);

  const changeGrain = (next: Grain) => {
    if (next === grain) return;
    // 换粒度时停在同一个时刻：先换成原始步数，再换成新粒度下的步数。
    const at = coarse.toFine(Number(new URLSearchParams(location.search).get('s') ?? 0));
    setGrain(next);
    setStep(coarsen(full, next).toCoarse(at));
  };

  return (
    <Player trace={coarse.trace} scene={scene} bind={bind} moves={moves} names={machineNames} values={machineValues} caption={machineCaption} breakIt={machineBreak}>
      <Choice
        label="例题"
        value={choices.some((item) => item.id === choice) ? choice : 'LAD'}
        options={choices.map((item) => item.id)}
        names={(id) => choices.find((item) => item.id === id)?.label ?? id}
        onChange={(id) => {
          setChoice(id);
          setStep(0);
        }}
      />
      <Choice label="一步走多少" value={grain} options={grains} names={(g) => grainNames[g]} onChange={changeGrain} />
    </Player>
  );
}

/** 模型机的指令周期。?demo=kit 是部件样张，给场景库自查用。 */
export default function Page() {
  const [demo] = useParam('demo', '');
  const kit = useMemo(() => kitTrace(), []);
  if (demo === 'kit') return <Player key="kit" trace={kit} scene={kitScene} bind={kitBind} moves={kitMoves} />;
  return <Machine />;
}
