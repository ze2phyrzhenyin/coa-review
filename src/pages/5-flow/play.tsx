import { useMemo } from 'preact/hooks';
import { runFlow } from '../../engines/hardwired/flow';
import type { FlowParams } from '../../engines/hardwired/flow';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import { FLOW_CONCLUSION, FLOW_NEEDS, FLOW_QUESTION, flowAskFrame, flowBind, flowBreak, flowCaption, flowFrame, flowMistakes, flowMoves, flowNames, flowScene, flowValues, flowWrong, link } from './scene';

/** 一份参数 → 方框图的 Trace、配套的模型机 Trace 和台面。 */
export function FlowPlayer({ params, lesson }: { params: FlowParams; lesson: boolean }) {
  const key = JSON.stringify(params);
  const made = useMemo(() => {
    try {
      const L = link(runFlow(params));
      return { L, scene: flowScene(L), bind: flowBind(L), moves: flowMoves(L), frame: flowFrame(L), caption: flowCaption(L), values: flowValues(L), wrong: flowWrong(L), breakIt: flowBreak(L), mistakes: flowMistakes(L), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!('L' in made) || !made.L) {
    return (
      <p class="field-error" role="alert">
        <Rich text={made.error || '参数有误'} />
      </p>
    );
  }
  return (
    <Player
      wide
      trace={made.L.flow}
      scene={made.scene}
      bind={made.bind}
      moves={made.moves}
      names={flowNames}
      values={made.values}
      caption={made.caption}
      frame={made.frame}
      askFrame={flowAskFrame()}
      onWrong={made.wrong}
      breakIt={made.breakIt}
      {...(lesson ? { question: FLOW_QUESTION, conclusion: FLOW_CONCLUSION, needs: FLOW_NEEDS, mistakes: made.mistakes } : {})}
    />
  );
}
