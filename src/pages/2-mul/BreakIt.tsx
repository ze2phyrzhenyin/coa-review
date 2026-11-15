/** 弄坏它：三个求补器的 E 都接 0，补码直接进阵列。两组数：异号、同号。 */
import { useMemo } from 'preact/hooks';
import { useParam } from '../../app/url-state';
import { useNarrow } from '../../app/media';
import { Player } from '../../player/Player';
import { CASES, breakScene, breakTrace } from './break';

const minus = (text: string) => text.replace(/^-/, '−');

export function BreakIt() {
  const [bx, setBx] = useParam('bx', '1', (raw) => (raw === '2' ? '2' : '1'));
  const [, setStep] = useParam('s', '0');
  const which = bx === '2' ? 1 : 0;
  const narrow = useNarrow();
  const trace = useMemo(() => breakTrace(which), [which]);
  const made = useMemo(() => breakScene(trace, narrow), [trace, narrow]);
  return (
    <>
      <div class="seg is-mono mul-examples" role="group" aria-label="例子">
        {CASES.map((item, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={i === which}
            onClick={() => {
              if (i === which) return;
              setStep('0');
              setBx(String(i + 1));
            }}
          >
            ({minus(item.x)}) × ({minus(item.y)})
          </button>
        ))}
      </div>
      <Player key={`break-${which}-${narrow}`} trace={trace} scene={made.scene} bind={made.bind} moves={made.moves} names={made.names} values={made.values} />
    </>
  );
}
