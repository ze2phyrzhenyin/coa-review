/**
 * 逐步播放器。每一步显示三件事：状态（场景）、为什么、变化。答题在场景里做。
 * 约定见 specs/_player-contract.md 和 docs/INTERACTION.md。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties, TargetedKeyboardEvent } from 'preact';
import { useIntParam, useParam } from '../app/url-state';
import type { Ask, Step, StepLevel, Trace } from '../engines/trace';
import { accentName, canUseWebGL, currentScheme, frameAt, hashPose, inkNames, loadRuntime, palettes, poseAt, revealedRows } from '../scene';
import type { Binding, Ink, Move, Patch, PartSpec, Pose, Rect, SceneSpec, SceneView, Scheme } from '../scene';
import { Answer } from './Answer';
import { Rich } from './Rich';
import { plainRich } from '../scene/rich';
import { FlatStage, partTitle, readout } from './FlatStage';
import './player.css';

/** 「弄坏它」：学生做一个错的操作，场景把后果演出来。由页面给出，播放器只负责演和收回。 */
export interface Breakage {
  /** 按钮上的字，动词开头。 */
  label: string;
  /** 盖在当前画面上的部件属性。 */
  patch: Record<string, Patch>;
  /** 演的时候哪个值从哪走到哪。 */
  moves: Move[];
  /** 真实硬件里会怎样。 */
  message: string;
}

export interface PlayerProps<P, S> {
  trace: Trace<P, S>;
  scene: SceneSpec;
  bind: Binding<S>;
  /** 这一步里哪个值从哪个部件沿哪些连线走到哪个部件。不给就原地翻面。 */
  moves?: ((step: Step<S>) => Move[]) | undefined;
  /** 把状态路径换成学生认识的名字，用在「变化」里。 */
  names?: ((path: string) => string) | undefined;
  /** 把「变化」里的值换成学生认识的写法（例如 true 写成「开」）。空串和 null 已经写成「空」。 */
  values?: ((path: string, value: string) => string) | undefined;
  /** 舞台左下角的一行读数（例如 CPU 周期、节拍、有效的信号）。 */
  caption?: ((state: S) => string) | undefined;
  /** 当前状态下能不能「弄坏它」。part 是学生点的部件，null 表示按钮。 */
  breakIt?: ((state: S, part: string | null) => Breakage | null) | undefined;
  /** 答错时按学生的答案演后果（填数题、选择题、点选题都行）。返回 null 时用播放器自己的演法。 */
  onWrong?: ((ask: Ask, value: string, state: S, next: Step<S> | null) => Breakage | null) | undefined;
  /** 翻位片作答：bits 题由哪个 bits 部件来答。学生点位片翻面，再按确定。 */
  flipPart?: ((ask: Ask, index: number) => string | null) | undefined;
  /** 宽屏上舞台占满整行，讲解排在舞台下面（台面很宽、两栏放不下时用）。 */
  wide?: boolean | undefined;
  /** 舞台上方的控件（选例题、选粒度）。 */
  children?: ComponentChildren;
}

const levelNames: Record<StepLevel, string> = {
  explain: '讲解步',
  beat: '一个节拍',
  cycle: '一个 CPU 周期',
  instruction: '一条指令',
  access: '一次访问',
};

const normalize = (ask: Ask, value: string): string => {
  const text = value.trim();
  if (ask.kind === 'bits') return text.replace(/[\s_]/g, '');
  if (ask.kind === 'number' && text !== '' && Number.isFinite(Number(text))) return String(Number(text));
  return text;
};

/** 选项全都是可点选的部件时，这道题用点部件来答。返回 选项 → 部件 id。 */
function pickTargets(scene: SceneSpec, ask: Ask | undefined): Map<string, string> | null {
  if (!ask || ask.kind !== 'choice' || !ask.options?.length) return null;
  const map = new Map<string, string>();
  for (const option of ask.options) {
    const part = scene.parts.find((item) => item.pick && (item.id === option || partTitle(item) === option));
    if (!part) return null;
    map.set(option, part.id);
  }
  return map;
}

/** 部件的中心在不在舞台里。 */
const onStage = (rect: Rect | undefined, size: { width: number; height: number }): boolean =>
  !!rect && rect.x + rect.w / 2 > 0 && rect.x + rect.w / 2 < size.width && rect.y + rect.h / 2 > 0 && rect.y + rect.h / 2 < size.height;

export function Player<P, S>({ trace, scene, bind, moves, names, values, caption, breakIt, onWrong, flipPart, wide, children }: PlayerProps<P, S>) {
  const show = (path: string, value: string) => (value === '' || value === 'null' ? '空' : values ? values(path, value) : value);
  const total = trace.steps.length;
  const [index, setIndex] = useIntParam('s', 0, 0, total);
  const [flatParam] = useParam('flat', '');
  const [mode, setMode] = useState<'loading' | 'scene' | 'flat'>(() => (flatParam === '1' || !canUseWebGL() ? 'flat' : 'loading'));
  const [rects, setRects] = useState<Record<string, Rect>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scheme, setScheme] = useState<Scheme>(currentScheme);
  const [attempt, setAttempt] = useState<{ index: number; wrong: number; picked: string } | null>(null);
  const [notice, setNotice] = useState('');
  const [broken, setBroken] = useState<{ index: number; breakage: Breakage; auto?: boolean } | null>(null);
  const [consequence, setConsequence] = useState<{ index: number; text: string } | null>(null);

  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const view = useRef<SceneView | null>(null);
  const shown = useRef<string | null>(null);

  const input = useMemo(() => ({ trace, scene, bind, moves }), [trace, scene, bind, moves]);
  const step = index > 0 ? trace.steps[index - 1]! : null;
  const next = index < total ? trace.steps[index]! : null;
  const state = step ? step.state : trace.initial;
  const pending = next?.ask;
  const picking = useMemo(() => pickTargets(scene, pending), [scene, pending]);
  const breakage = broken?.index === index ? broken.breakage : null;
  // 翻位片作答：要翻的部件和学生翻出来的位串（空格是还没翻的位）。
  const flipId = pending?.kind === 'bits' && flipPart ? flipPart(pending, index) : null;
  const slots = pending ? pending.answer.replace(/[\s_]/g, '').length : 0;
  const [draft, setDraft] = useState<{ index: number; bits: string } | null>(null);
  /** 点选题时点了不是候选的部件：给一句说明。 */
  const [stray, setStray] = useState('');
  const flipBits = flipId ? (draft?.index === index ? draft.bits : ' '.repeat(slots)) : '';

  /** 每一步的目标画面。等学生点选时，可选的部件多一个标记。 */
  const poseFor = useCallback(
    (i: number): Pose => {
      const pose = poseAt(input, i);
      const targets = pickTargets(scene, trace.steps[i]?.ask);
      if (targets) for (const id of targets.values()) pose.parts[id] = { ...pose.parts[id], pickable: true };
      return pose;
    },
    [input, scene, trace],
  );
  const pose = useMemo(() => {
    const base = poseFor(index);
    if (flipId) base.parts[flipId] = { ...base.parts[flipId], bits: flipBits, pickable: true, hidden: false };
    if (!breakage) return base;
    const parts = { ...base.parts };
    for (const [id, patch] of Object.entries(breakage.patch)) parts[id] = { ...parts[id], ...patch, changed: true };
    return { ...base, parts };
  }, [poseFor, index, breakage, flipId, flipBits]);

  // 场景：按需加载 three.js，建一次，换 Trace 时重建。
  useEffect(() => {
    if (mode === 'flat') return;
    let alive = true;
    let made: SceneView | null = null;
    void loadRuntime()
      .then(({ SceneView: View }) => {
        if (!alive || !stage.current || !canvasHost.current) return;
        const frames: string[][] = [];
        const extras: string[][] = [];
        const poses: Pose[] = [];
        const targets: string[][] = [];
        const picks: string[][] = [];
        for (let i = 0; i <= total; i++) {
          const planned = i > 0 && moves ? moves(trace.steps[i - 1]!) : [];
          const last = Math.max(0, ...planned.map((move) => move.phase ?? 0));
          targets.push([...new Set(planned.filter((move) => (move.phase ?? 0) === last).map((move) => move.to.split('.')[0]!))]);
          frames.push(frameAt(input, i));
          // 等学生作答时，接下来要动的部件装得下就一起留在画面里。
          extras.push(trace.steps[i]?.ask ? frameAt(input, i + 1) : []);
          picks.push([...(pickTargets(scene, trace.steps[i]?.ask)?.values() ?? [])]);
          poses.push(poseFor(i));
        }
        const start = index;
        made = new View(stage.current, canvasHost.current, scene, poseFor(start));
        made.onRects = setRects;
        made.stage.onPick = (id, bit) => pickRef.current(id, bit);
        made.plan(frames, extras, poses, targets, picks);
        made.show(start, poseFor(start), { animate: false, forward: false, moves: [] });
        view.current = made;
        shown.current = `${start}`;
        setSize(made.size);
        setRects(made.rects());
        setMode('scene');
      })
      .catch(() => alive && setMode('flat'));
    return () => {
      alive = false;
      made?.dispose();
      view.current = null;
      shown.current = null;
    };
    // index 只取建场景那一刻的值，之后换步走下面的 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, mode === 'flat']);

  // 换步，或者「弄坏它」开始、收回。
  const key = `${index}${breakage ? '!' : ''}${flipBits}`;
  const lastIndex = useRef(index);
  useEffect(() => {
    const current = view.current;
    if (!current || shown.current === null || shown.current === key) return;
    const from = lastIndex.current;
    lastIndex.current = index;
    shown.current = key;
    if (breakage) {
      current.show(index, pose, { animate: true, forward: true, moves: breakage.moves, frame: [...new Set(breakage.moves.flatMap((move) => [move.from, move.to]))] });
    } else {
      const forward = index === from + 1;
      current.show(index, pose, { animate: true, forward, moves: forward && step && moves ? moves(step) : [] });
    }
    setSize(current.size);
  }, [key, index, pose, step, moves, mode, breakage]);

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const value: Scheme = media.matches ? 'dark' : 'light';
      setScheme(value);
      view.current?.setScheme(value);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  // 答错时演的后果：走完之后自己退回。
  useEffect(() => {
    if (!broken?.auto) return;
    const timer = setTimeout(() => {
      view.current?.hold();
      setBroken((current) => (current === broken ? null : current));
    }, 2600);
    return () => clearTimeout(timer);
  }, [broken]);

  // 打开页面就能用键盘翻步，不抢别处已有的焦点。
  useEffect(() => {
    if (document.activeElement === document.body || document.activeElement === null) root.current?.focus({ preventScroll: true });
  }, []);

  // 连按时每一次都基于上一次的结果，不等重新渲染。
  const latest = useRef(index);
  latest.current = index;
  const go = useCallback(
    (to: number | ((from: number) => number)) => {
      const from = latest.current;
      const target = Math.max(0, Math.min(total, typeof to === 'function' ? to(from) : to));
      setAttempt(null);
      setNotice('');
      setBroken(null);
      setStray('');
      setConsequence(null);
      // 回到某一步时，画面与第一次到那一步时相同：翻过的位片不留。
      setDraft(null);
      if (target === from) return;
      latest.current = target;
      // 画面要变了：立刻标成未稳定，检查脚本和读屏不会读到上一步的结果。
      view.current?.hold();
      setIndex(target);
    },
    [setIndex, total],
  );

  const answer = useCallback(
    (value: string, partId?: string) => {
      if (!pending) return;
      if (normalize(pending, value) === normalize(pending, pending.answer)) {
        go((i) => Math.min(total, i + 1));
        setNotice('答对了。');
        return;
      }
      setAttempt((before) => ({ index, wrong: (before?.index === index ? before.wrong : 0) + 1, picked: value }));
      setNotice(`不对。${pending.hint ?? ''}`);
      // 页面能演后果的，交给页面：画面上盖一层，说明写在舞台下面，「恢复」收回。
      const acted = onWrong?.(pending, value, state, next);
      if (acted) {
        // 演一遍学生答案的后果，说明留在题目下面；过一会儿画面退回本来的样子。
        view.current?.hold();
        setBroken({ index, breakage: acted, auto: true });
        setConsequence({ index, text: acted.message });
        return;
      }
      if (!partId) {
        // 没有页面的演法：下一步要动的部件轻摇，告诉学生该看哪里。
        for (const id of frameAt(input, index + 1).slice(0, 3)) view.current?.shake(id);
        return;
      }
      // 按学生的答案演一遍：本该去答案那里的值，去了他点的部件。往后找几步，找到第一个落到答案上的值。
      const right = picking?.get(pending.answer);
      const base = (ref: string) => ref.split('.')[0];
      let into: Move | undefined;
      let out: Move | undefined;
      for (let k = index; k < Math.min(total, index + 4) && !into && !out; k++) {
        const planned = moves ? moves(trace.steps[k]!) : [];
        into = planned.find((move) => base(move.to) === right);
        out = into ? undefined : planned.find((move) => base(move.from) === right);
      }
      if (into) view.current?.rehearse(into.value, into.from, partId, into.ink);
      else if (out) view.current?.rehearse(out.value, partId, out.to, out.ink);
      else {
        // 没有可演的值：从这一步的焦点飞一张写着学生答案的牌过去。
        const source = frameAt(input, index).find((id) => id !== partId) ?? frameAt(input, index + 1).find((id) => id !== partId);
        if (source) view.current?.rehearse(value, source, partId);
        else view.current?.shake(partId);
      }
    },
    [pending, go, total, index, picking, moves, onWrong, state, trace, input, next],
  );

  const onPick = useCallback(
    (id: string | null, bit?: number) => {
      if (!id) return;
      if (flipId && id === flipId) {
        // 点一下翻一位：空槽先翻成 0，之后 0、1 交替。
        const at = bit ?? flipBits.indexOf(' ');
        if (at < 0 || at >= slots) return;
        const was = flipBits[at];
        const next = was === '0' ? '1' : '0';
        setDraft({ index, bits: flipBits.slice(0, at) + next + flipBits.slice(at + 1) });
        return;
      }
      if (picking) {
        const option = [...picking].find(([, partId]) => partId === id)?.[0];
        if (option !== undefined) {
          setStray('');
          answer(option, id);
          return;
        }
        const part = scene.parts.find((item) => item.id === id);
        setStray(`${part ? partTitle(part) : id} 不是这道题的选项。在 ${[...picking.keys()].join('、')} 里选。`);
        view.current?.shake(id);
        return;
      }
      const tried = breakIt?.(state, id);
      if (tried && !breakage) {
        view.current?.hold();
        setBroken({ index, breakage: tried });
        setNotice(tried.message);
        return;
      }
      const part = scene.parts.find((item) => item.id === id);
      if (part) setNotice(readout(part, pose.parts[id] ?? {}));
    },
    [picking, answer, scene, pose, breakIt, state, breakage, index, flipId, flipBits, slots],
  );
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'ArrowRight' || (event.key === ' ' && !target.closest('button, a, summary'))) {
      event.preventDefault();
      go((i) => Math.min(total, i + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      go((i) => Math.max(0, i - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      go(0);
    }
  };

  const palette = palettes[scheme];
  const vars = {
    '--pl-paper': palette.paper,
    '--pl-data': palette.data,
    '--pl-addr': palette.addr,
    '--pl-ctrl': palette.ctrl,
    '--pl-accent': palette.accent,
  } as unknown as CSSProperties;

  const inks = useMemo(() => {
    const used = new Set<Ink>();
    for (const wire of scene.wires) used.add(wire.ink ?? 'data');
    return (['data', 'addr', 'ctrl'] as const).filter((ink) => used.has(ink));
  }, [scene]);

  const { shown: shownRows, current: currentRow } = revealedRows(trace, index);
  const order = useMemo(() => new Map(trace.steps.map((item, i) => [item.id, i + 1])), [trace]);
  const wrong = attempt?.index === index ? attempt : null;
  const flat = mode === 'flat';
  const pickable = scene.parts.filter((part) => part.pick);
  // 有候选不在画面上时，题目下列出全部候选（答错一次后也不会只剩一个）。
  const missing = !flat && picking ? [...picking].filter(([, id]) => !onStage(rects[id], size)).map(([option]) => option) : [];
  const offStage = missing.length > 0 && picking ? [...picking.keys()] : [];
  const offer = !pending && !breakage && breakIt ? breakIt(state, null) : null;
  const status = caption ? caption(state) : '';

  const pickStyle = (part: PartSpec): CSSProperties => {
    const rect = rects[part.id];
    if (!rect || size.width === 0) return { left: '0px', top: '0px', width: '44px', height: '44px' };
    const w = Math.min(size.width, Math.max(44, rect.w));
    const h = Math.min(size.height, Math.max(44, rect.h));
    const left = Math.max(0, Math.min(size.width - w, rect.x + rect.w / 2 - w / 2));
    const top = Math.max(0, Math.min(size.height - h, rect.y + rect.h / 2 - h / 2));
    return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px`, width: `${Math.round(w)}px`, height: `${Math.round(h)}px` };
  };

  return (
    <div class={`pl${wide ? ' pl-wide' : ''}`} data-player data-step-index={index} data-mode={mode} tabIndex={0} ref={root} onKeyDown={onKeyDown} style={vars}>
      {children ? <div class="pl-controls">{children}</div> : null}

      <div class="pl-body">
        <div class="pl-left">
          {status ? (
            <p class="pl-status" aria-hidden="true">
              <Rich text={status} />
            </p>
          ) : null}
          <div class="pl-stage" data-stage ref={stage} {...(flat ? { 'data-settled': 'true', 'data-scene-hash': hashPose(pose) } : {})}>
            {flat ? (
              <FlatStage scene={scene} pose={pose} onPick={onPick} picking={!!picking} wrong={wrong?.picked} />
            ) : (
              <>
                <div class="pl-canvas" ref={canvasHost} />
                {pickable.map((part) => {
                  const rect = rects[part.id];
                  const off = !onStage(rect, size);
                  return (
                    <button
                      key={part.id}
                      type="button"
                      class={`pl-pick${off ? ' is-off' : ''}${wrong && picking?.get(wrong.picked) === part.id ? ' is-wrong' : ''}`}
                      data-pick={part.id}
                      aria-label={picking ? `选 ${partTitle(part)}` : readout(part, pose.parts[part.id] ?? {})}
                      style={pickStyle(part)}
                      onClick={() => onPick(part.id)}
                    />
                  );
                })}
              </>
            )}
          </div>

          {pending ? (
            <Answer
              key={index}
              ask={pending}
              picking={!!picking}
              wrong={wrong ? { count: wrong.wrong, value: wrong.picked } : null}
              anchor={null}
              size={size}
              offStage={offStage}
              onAnswer={(value) => answer(value)}
              onPick={(option) => {
                const id = picking?.get(option);
                if (id) answer(option, id);
              }}
              onReveal={() => go((i) => Math.min(total, i + 1))}
              onLook={missing.length > 0 && picking ? () => view.current?.lookAt([...picking].filter(([option]) => missing.includes(option)).map(([, id]) => id)) : undefined}
              note={stray}
              consequence={consequence?.index === index ? consequence.text : ''}
              flip={flipId ? { bits: flipBits, toggle: (i) => onPick(flipId, i) } : undefined}
            />
          ) : null}

          {breakage && !broken?.auto ? (
            <div class="pl-break is-on" role="status">
              <p>
                <Rich text={breakage.message} />
              </p>
              <button type="button" class="pl-btn" onClick={() => {
                  view.current?.hold();
                  setBroken(null);
                }}>
                恢复
              </button>
            </div>
          ) : offer && !breakage ? (
            <div class="pl-break">
              <button
                type="button"
                class="pl-btn"
                onClick={() => {
                  view.current?.hold();
                  setBroken({ index, breakage: offer });
                  setNotice(offer.message);
                }}
              >
                {offer.label}
              </button>
            </div>
          ) : null}

          <div class="pl-bar">
            <button type="button" class="pl-btn" onClick={() => go(0)} disabled={index === 0}>
              重置
            </button>
            <button type="button" class="pl-btn" onClick={() => go((i) => Math.max(0, i - 1))} disabled={index === 0}>
              上一步
            </button>
            <button type="button" class="pl-btn is-primary" onClick={() => go((i) => Math.min(total, i + 1))} disabled={index === total}>
              下一步
            </button>
          </div>

          <ul class="pl-legend" aria-label="图例">
            {inks.map((ink) => (
              <li key={ink} class={`is-${ink}`}>
                {inkNames[ink]}
              </li>
            ))}
            <li class="is-accent">{accentName}</li>
          </ul>
        </div>

        <section class="pl-step" aria-label="这一步">
          <p class="pl-count">
            {index === 0 ? `共 ${total} 步` : `第 ${index} 步，共 ${total} 步`}
            {step ? <span class="pl-level">{levelNames[step.level]}</span> : null}
          </p>
          <h2 class="pl-title">{step ? <Rich text={step.title} /> : '初始状态'}</h2>
          {step && (
            <>
              <h3>为什么</h3>
              <p class="pl-why">
                <Rich text={step.why} />
                {step.ref ? <span class="pl-ref">{step.ref}</span> : null}
              </p>
              {step.changes.length > 0 && (
                <>
                  <h3>变化</h3>
                  <ul class="pl-changes">
                    {step.changes.map((change) => (
                      <li key={change.at}>
                        <span class="pl-at">
                          <Rich text={names ? names(change.at) : change.at} />
                        </span>
                        <span class="pl-old">
                          <Rich text={show(change.at, change.from)} />
                        </span>
                        <span class="pl-to">
                          <span class="pl-sr">变为</span>
                        </span>
                        <span class="pl-new">
                          <Rich text={show(change.at, change.to)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {trace.conditions.length > 0 && (
        <dl class="pl-given">
          {trace.conditions.map((condition) => (
            <div key={condition.label}>
              <dt>
                <Rich text={condition.label} />
              </dt>
              <dd>
                <Rich text={condition.value} />
              </dd>
            </div>
          ))}
        </dl>
      )}

      {trace.table.rows.length > 0 && (
        <section class="pl-sheet" aria-label="解题表">
          <h2>解题表</h2>
          <div class="pl-sheet-scroll">
            <table>
              <thead>
                <tr>
                  {trace.table.columns.map((column) => (
                    <th key={column} scope="col">
                      <Rich text={column} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trace.table.rows.map((row, r) => {
                  const revealed = r < shownRows;
                  const target = row.step ? order.get(row.step) : undefined;
                  const jump = revealed && target !== undefined ? () => go(target) : undefined;
                  return (
                    <tr key={r} class={`${revealed ? '' : 'is-blank'}${r === currentRow ? ' is-current' : ''}${jump ? ' is-link' : ''}`} onClick={jump}>
                      {row.cells.map((cell, c) => (
                        <td key={c}>
                          {!revealed ? null : c === 0 && jump ? (
                            <button
                              type="button"
                              class="pl-row"
                              aria-label={`跳到第 ${target} 步：${row.cells.filter(Boolean).join('，')}`}
                              aria-current={r === currentRow ? 'step' : undefined}
                              onClick={(event) => {
                                event.stopPropagation();
                                jump();
                              }}
                            >
                              <Rich text={cell} />
                            </button>
                          ) : (
                            <Rich text={cell} />
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div class="pl-sr" aria-live="polite">
        {plainRich(`${notice ? `${notice} ` : ''}${step ? `第 ${index} 步：${step.title}。${step.why}` : '初始状态。'}${pending ? ` 题目：${pending.prompt}。` : ''}`)}
      </div>
    </div>
  );
}
