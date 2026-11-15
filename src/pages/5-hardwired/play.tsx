import { useMemo } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { run } from '../../engines/hardwired/model';
import type { DeriveParams } from '../../engines/hardwired/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { HARD_CONCLUSION, HARD_NEEDS, hardQuestion, hardBind, hardBreak, hardConvention, hardMistakes, hardMoves, hardNames, hardScene, hardValues, hardWrong, polish, hardFrame } from './scene';

/** 一份参数 → 推导的 Trace 和台面。 */
export function DerivePlayer({ params, lesson }: { params: DeriveParams; lesson: boolean }) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  const made = useMemo(() => {
    try {
      const trace = polish(run(params));
      return { trace, scene: hardScene(trace, narrow), bind: hardBind(trace, narrow), moves: hardMoves(trace, narrow), wrong: hardWrong(trace, narrow), breakIt: hardBreak(trace, narrow), mistakes: hardMistakes(trace, narrow), frame: hardFrame(trace, narrow), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow]);
  if (!('trace' in made) || !made.trace) {
    return (
      <p class="field-error" role="alert">
        <Rich text={made.error || '参数有误'} />
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
      names={hardNames}
      values={hardValues}
      frame={made.frame}
      onWrong={made.wrong}
      breakIt={made.breakIt}
      convention={hardConvention}
      {...(lesson ? { question: hardQuestion(narrow), conclusion: HARD_CONCLUSION, needs: HARD_NEEDS, mistakes: made.mistakes } : {})}
    />
  );
}

