import { useMemo } from 'preact/hooks';
import { useParam } from '../../app/url-state';
import { Player } from '../../player/Player';
import { useNarrow } from '../../app/media';
import { breakSetup, breakTrace } from './break-trace';
import { cacheStage } from './scene';
import { exampleParams } from './setup';

/** 选一行，把块硬放进去，再看两次访问出什么错。 */
export function BreakIt() {
  const setup = useMemo(() => breakSetup(exampleParams), []);
  const [intoText, setInto] = useParam('into', String(setup.wrongRows[0] ?? 0));
  const [, setStep] = useParam('s', '0');
  const into = setup.wrongRows.includes(Number(intoText)) ? Number(intoText) : (setup.wrongRows[0] ?? 0);
  const trace = useMemo(() => breakTrace(exampleParams, into), [into]);
  const narrow = useNarrow();
  const stage = useMemo(() => cacheStage(exampleParams, narrow), [narrow]);

  return (
    <>
      <div class="cr-controls">
        <div class="cr-choice" role="group" aria-label={`把块 ${setup.block} 硬放进哪一行`}>
          <span class="cr-lead">
            块 {setup.block} 该进行 {setup.home}，硬放进
          </span>
          {setup.wrongRows.map((row) => (
            <button
              key={row}
              type="button"
              class={`pl-btn${row === into ? ' is-on' : ''}`}
              aria-pressed={row === into}
              onClick={() => {
                setStep('0');
                setInto(String(row));
              }}
            >
              行 {row}
            </button>
          ))}
        </div>
      </div>
      <Player key={into} trace={trace} scene={stage.scene} bind={stage.bind} moves={stage.moves} names={stage.names} values={stage.values} frame={stage.frame} />
    </>
  );
}
