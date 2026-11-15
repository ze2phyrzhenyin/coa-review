import { useMemo } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { run } from '../../engines/opcode/model';
import type { OpcodeParams } from '../../engines/opcode/model';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import './opcode.css';
import { OP_CONCLUSION, OP_NEEDS, opQuestion, opFrame, opBind, opBreak, opMistakes, opMoves, opNames, opScene, opValues, opWrong } from './scene';

/** 一份参数 → 引擎 Trace 和台面。 */
export function OpcodePlayer({ params, lesson }: { params: OpcodeParams; lesson: boolean }) {
  const narrow = useNarrow();
  const key = JSON.stringify(params);
  const made = useMemo(() => {
    try {
      const trace = run(params);
      return { trace, scene: opScene(trace, narrow), bind: opBind(trace, narrow), moves: opMoves(params, narrow), wrong: opWrong(params), breakIt: opBreak(params), mistakes: opMistakes(trace), frame: opFrame(params, narrow), error: '' };
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
    <div class="opx">
    <Player
      wide
      trace={made.trace}
      scene={made.scene}
      bind={made.bind}
      moves={made.moves}
      names={opNames}
      values={opValues}
      frame={made.frame}
      onWrong={made.wrong}
      breakIt={made.breakIt}
      {...(lesson ? { question: opQuestion(params, narrow), conclusion: OP_CONCLUSION, needs: OP_NEEDS, mistakes: made.mistakes } : {})}
    />
    </div>
  );
}
