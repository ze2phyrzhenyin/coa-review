import { useMemo } from 'preact/hooks';
import { useNarrow } from '../../app/media';
import { useParam } from '../../app/url-state';
import { Seg } from '../4-ea/shell';
import { runFlow } from '../../engines/hardwired/flow';
import type { FlowParams } from '../../engines/hardwired/flow';
import { Player } from '../../player/Player';
import { Rich } from '../../player/Rich';
import './flow.css';
import { FLOW_CONCLUSION, FLOW_NEEDS, flowQuestion, flowAskFrame, flowBind, flowBreak, flowCaption, flowFrame, flowMistakes, flowMoves, flowNames, flowScene, flowValues, flowWrong, link } from './scene';

/** 一份参数 → 方框图的 Trace、配套的模型机 Trace 和台面。 */
export function FlowPlayer({ params, lesson }: { params: FlowParams; lesson: boolean }) {
  const key = JSON.stringify(params);
  const narrow = useNarrow();
  // 手机上方框图和模型机不同屏：镜头看哪一半由学生选，写在网址参数 cam。
  const [cam, setCam] = useParam('cam', 'box', (raw) => (raw === 'machine' ? 'machine' : 'box'));
  const machine = narrow && cam === 'machine';
  const made = useMemo(() => {
    try {
      const L = link(runFlow(params));
      return { L, scene: flowScene(L), bind: flowBind(L), moves: flowMoves(L), frame: flowFrame(L, narrow, machine), askFrame: flowAskFrame(L, narrow, machine), caption: flowCaption(L), values: flowValues(L), wrong: flowWrong(L), breakIt: flowBreak(L, narrow), mistakes: flowMistakes(L), error: '' };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, narrow, machine]);
  if (!('L' in made) || !made.L) {
    return (
      <p class="field-error" role="alert">
        <Rich text={made.error || '参数有误'} />
      </p>
    );
  }
  return (
    <div class="fl">
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
      askFrame={made.askFrame}
      onWrong={made.wrong}
      breakIt={made.breakIt}
      {...(lesson ? { question: flowQuestion(narrow), conclusion: FLOW_CONCLUSION, needs: FLOW_NEEDS, mistakes: made.mistakes } : {})}
    >
      {narrow ? (
        <Seg
          label="镜头看"
          items={[
            { key: 'box', label: '看方框图' },
            { key: 'machine', label: '看模型机' },
          ]}
          value={cam as 'box' | 'machine'}
          onChoose={setCam}
        />
      ) : null}
    </Player>
    </div>
  );
}
