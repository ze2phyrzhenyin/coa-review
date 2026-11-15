import { useMemo } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { run } from '../../engines/ea/model';
import type { EaParams } from '../../engines/ea/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { EA_CONCLUSION, EA_NEEDS, EA_QUESTION, eaAskFrame, eaBind, eaBreak, eaConvention, eaFrame, eaMistakes, eaMoves, eaNames, eaScene, eaValues, eaWrong, memoryRows, polish } from './scene';

/** 一份参数 → 引擎 Trace 和台面。参数不变时引用不变。 */
export function useEa(params: EaParams | null) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  return useMemo(() => {
    if (!params) return { error: '', made: null };
    try {
      const trace = polish(run(params));
      const rows = memoryRows(trace);
      return {
        error: '',
        made: {
          trace,
          scene: eaScene(trace, narrow),
          bind: eaBind(trace),
          moves: eaMoves(params, rows),
          names: eaNames(params),
          frame: eaFrame(params),
          askFrame: eaAskFrame(params),
          wrong: eaWrong(params, rows),
          breakIt: eaBreak(params, rows),
          mistakes: eaMistakes(trace, rows),
        },
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error), made: null };
    }
    // key 就是 params 的内容。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
}

export function EaPlayer({ params, lesson }: { params: EaParams; lesson: boolean }) {
  const { made, error } = useEa(params);
  if (!made) {
    return (
      <p class="field-error" role="alert">
        <Rich text={error || '参数有误'} />
      </p>
    );
  }
  return (
    <Player
      wide
      trace={made.trace}
      scene={made.scene}
      bind={made.bind}
      moves={made.moves}
      names={made.names}
      values={eaValues}
      frame={made.frame}
      askFrame={made.askFrame}
      onWrong={made.wrong}
      breakIt={made.breakIt}
      convention={eaConvention}
      {...(lesson ? { question: EA_QUESTION, conclusion: EA_CONCLUSION, needs: EA_NEEDS, mistakes: made.mistakes } : {})}
    />
  );
}

