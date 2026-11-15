/**
 * 6-arbiter 的台面：左边是总线仲裁器，右边一排设备接口，接口 0 离仲裁器最近。
 * 链式查询时 BG 像一根接力棒沿链往下传，被第一个举手（有请求）的接口接住；计数器定时查询时计数值一张张发到地址相同的接口；
 * 独立请求时每个接口有自己的一对 BRi、BGi。上方两根公共线 BR、BS，下方是总线占用的时间轴。
 * 画面只取决于引擎 Trace 的状态，谁得到总线、什么时候得到都来自引擎。
 */
import type { Ask, Step, Trace } from '../../engines/trace';
import { schedule } from '../../engines/arbiter/model';
import type { Params, State } from '../../engines/arbiter/model';
import { bindTable, from } from '../../scene';
import type { Binding, Move, PartSpec, SceneSpec } from '../../scene';
import type { Breakage, Mistake } from '../../player/Player';

export const ARB_QUESTION = { text: '几台设备同时请求，链式查询时谁先拿到总线，凭什么', at: ['ARB', 'D0'] };
export const ARB_CONCLUSION =
  'BG 从仲裁器出来，按接口在链上的位置一个一个往下传，第一个有请求的接口把它截住，后面的接口收不到。离仲裁器近的先碰到 BG，所以优先；优先次序是接线定死的，链上一处断了，后面的设备都得不到总线。';
export const ARB_NEEDS = [{ href: '/5-cycle', text: '总线和三态门（模型机）' }];

export interface ArbStage {
  scene: SceneSpec;
  bind: Binding<State>;
  moves: (step: Step<State>) => Move[];
  names: (path: string) => string;
  values: (path: string, value: string) => string;
  caption: (state: State) => string;
  askFrame: (ask: Ask, index: number) => string[];
  frame: (step: Step<State>) => string[] | null;
  wrong: (ask: Ask, value: string, state: State, next: Step<State> | null) => Breakage | null;
  mistakes: Mistake<State>[];
  convention: (step: Step<State>) => string | null;
}

type Kind = 'request' | 'bg' | 'count' | 'queue' | 'grant' | 'release' | 'none';

/** 这一步是哪一种。 */
export function kindOf(step: Step<State>): Kind {
  if (step.level === 'access') return 'grant';
  if (step.title.startsWith('t=') && step.focus[0] === 't') return 'request';
  if (step.title.startsWith('BG 到接口')) return 'bg';
  if (step.title.startsWith('计数值')) return 'count';
  if (step.title.startsWith('排队电路')) return 'queue';
  if (step.title.includes('BS 清 0')) return 'release';
  return 'none';
}

export function arbStage(trace: Trace<Params, State>, narrow: boolean): ArbStage {
  const p = trace.params;
  const n = p.devices;
  const chain = p.mode === '链式查询';
  const counter = p.mode === '计数器定时查询';
  const own = p.mode === '独立请求';
  const plan = schedule(p);
  const end = Math.max(1, ...plan.grants.map((g) => g.until), ...p.requests.map((r) => r.at + 1));

  // 版式：宽屏是一排，仲裁器在左；窄屏竖着排，仲裁器在上，BG 一格一格往下传。
  const W = narrow ? 2.4 : 2.1;
  const devPos = (i: number): [number, number] => (narrow ? [0.2, i * 1.75] : [-1.5 + i * 2.9, 0]);
  const ARB: [number, number] = narrow ? [0.2, -2.0] : [-5.4, 0];
  const lastX = devPos(n - 1)[0];
  const lastZ = devPos(n - 1)[1];
  const anyBr = (s: State) => s.devices.some((d) => d.br === 1);
  const parts: PartSpec[] = [];
  const table: Parameters<typeof bindTable<State>>[0] = {};

  parts.push({ id: 'ARB', kind: 'register', position: ARB, props: { name: '总线仲裁器', value: '', width: 2.4, ink: 'ctrl' } });
  table.ARB = {
    value: from(counter ? 'counter' : 'bs', (c) => {
      if (counter) return c.state.counter === null || c.state.bs === 1 || !anyBr(c.state) ? '' : `计数 ${c.state.counter}`;
      if (c.state.bs === 1) return '';
      if (c.state.devices.some((d) => d.bg === 1)) return own ? '回 BG' : '发 BG';
      return c.state.devices.some((d) => d.br === 1) ? '收到 BR' : '';
    }),
  };

  const deviceText = (state: State, i: number): string => {
    const d = state.devices[i]!;
    if (state.owner === i) return '占用总线';
    if (d.bg === 1 && d.br === 1) return chain ? '接住 BG' : own ? `收到 BG_${i}` : '地址相同';
    if (d.bg === 1 && chain) return p.broken === i ? '传不下去' : '往下传';
    if (counter && state.counter === i && state.bs === 0 && state.devices.some((x) => x.br === 1)) return d.br ? '地址相同' : '没有请求';
    if (d.br === 1) return d.pending > 1 ? `请求 ×${d.pending}` : '请求';
    return '';
  };
  for (let i = 0; i < n; i++) {
    parts.push({ id: `D${i}`, kind: 'register', position: devPos(i), props: { name: `接口 ${i}`, value: '', width: W }, pick: true, title: `设备 ${i}` });
    table[`D${i}`] = { value: from(`devices.${i}`, (c) => deviceText(c.state, i)) };
  }

  const wires: SceneSpec['wires'] = [];
  if (chain) {
    // BG 链：仲裁器 → 接口 0 → 接口 1 → …
    for (let i = 0; i < n; i++) {
      const a = i === 0 ? 'ARB' : `D${i - 1}`;
      wires.push({ id: `bg-${i}`, from: narrow ? `${a}.s` : `${a}.e`, to: narrow ? `D${i}.n` : `D${i}.w`, ink: 'ctrl' });
    }
  }

  // 公共线 BR、BS（链式、计数器）：从最远的接口一直通到仲裁器，每个接口都挂在上面。
  if (!own) {
    if (narrow) {
      parts.push({ id: 'sBR', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.w`, to: 'ARB.w', text: 'BR', ink: 'ctrl', via: [[-1.75, lastZ], [-1.75, ARB[1]]], labelAt: 0.5 } });
      parts.push({ id: 'sBS', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.e`, to: 'ARB.e', text: 'BS', ink: 'ctrl', via: [[2.15, lastZ], [2.15, ARB[1]]], labelAt: 0.5 } });
    } else {
      const topZ = -1.9;
      parts.push({ id: 'sBR', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.n`, to: 'ARB.n', text: 'BR', ink: 'ctrl', via: [[lastX + 0.3, topZ], [ARB[0] + 0.3, topZ]], labelAt: 0.5 } });
      parts.push({ id: 'sBS', kind: 'signal', position: [0, 0], props: { from: `D${n - 1}.n`, to: 'ARB.n', text: 'BS', ink: 'ctrl', via: [[lastX - 0.3, topZ - 0.75], [ARB[0] - 0.3, topZ - 0.75]], labelAt: 0.45 } });
    }
    table.sBR = { on: from('devices', (c) => anyBr(c.state)) };
    table.sBS = { on: from('bs', (c) => c.state.bs === 1) };
  } else {
    // 独立请求：每个接口一对 BRi、BGi。
    for (let i = 0; i < n; i++) {
      const [x, z] = devPos(i);
      if (narrow) {
        const xr = 1.75 + i * 0.62;
        parts.push({ id: `sBR${i}`, kind: 'signal', position: [0, 0], props: { from: `D${i}.e`, to: 'ARB.e', text: `BR_${i}`, ink: 'ctrl', via: [[xr, z - 0.15], [xr, ARB[1] - 0.15]], labelAt: 0.06 } });
        parts.push({ id: `sBG${i}`, kind: 'signal', position: [0, 0], props: { from: 'ARB.e', to: `D${i}.e`, text: `BG_${i}`, ink: 'ctrl', via: [[xr + 0.3, ARB[1] + 0.15], [xr + 0.3, z + 0.15]], labelAt: 0.55 } });
      } else {
        const lane = 1.2 + i * 0.62;
        parts.push({ id: `sBR${i}`, kind: 'signal', position: [0, 0], props: { from: `D${i}.s`, to: 'ARB.s', text: `BR_${i}`, ink: 'ctrl', via: [[x - 0.35, z + lane], [ARB[0] - 0.35, z + lane]], labelAt: 0.12 } });
        parts.push({ id: `sBG${i}`, kind: 'signal', position: [0, 0], props: { from: 'ARB.s', to: `D${i}.s`, text: `BG_${i}`, ink: 'ctrl', via: [[ARB[0] + 0.35, z + lane + 0.3], [x + 0.35, z + lane + 0.3]], labelAt: 0.88 } });
      }
      table[`sBR${i}`] = { on: from(`devices.${i}.br`, (c) => c.state.devices[i]!.br === 1) };
      table[`sBG${i}`] = { on: from(`devices.${i}.bg`, (c) => c.state.devices[i]!.bg === 1) };
    }
  }
  if (counter && !narrow) {
    // 设备地址线：计数值从仲裁器发出，所有接口都看得到，地址相同的那个接口应答。
    const z = 1.6;
    const x0 = ARB[0] - 1.2;
    const len = lastX + W / 2 - x0 + 0.2;
    const cx = x0 + len / 2;
    parts.push({ id: 'ADDR', kind: 'bus', position: [cx, z], props: { name: '设备地址线', length: len, value: '', ink: 'addr', showDriver: false, idleText: '' } });
    table.ADDR = {
      value: from(['counter', 'devices', 'bs'], (c) => (c.state.counter !== null && c.state.bs === 0 && anyBr(c.state) ? String(c.state.counter) : '')),
      tileAt: from('counter', (c) => devPos(c.state.counter ?? 0)[0] - cx),
    };
  }

  // 时间轴：每台设备占用总线的时段。
  const trackLen = narrow ? 5.4 : 7.6;
  const trackDepth = n * 1.25 + 0.5;
  const below = narrow ? lastZ + 1.0 : own ? 1.2 + n * 0.62 + 0.4 : counter ? 2.4 : 1.0;
  const trackZ = below + 0.9 + trackDepth / 2;
  const every = end <= 10 ? 1 : end <= 24 ? 2 : 5;
  parts.push({
    id: 'track',
    kind: 'track',
    position: [narrow ? 0.7 : (ARB[0] + lastX) / 2 + 0.6, trackZ],
    props: {
      name: '总线占用',
      length: trackLen,
      span: [0, end],
      lanes: Array.from({ length: n }, (_, i) => `设备 ${i}`),
      segments: [],
      ticks: Array.from({ length: Math.floor(end / every) + 1 }, (_, k) => ({ at: k * every, text: String(k * every) })),
    },
    title: '总线占用',
  });
  table.track = {
    segments: from('grants', (c) =>
      plan.grants.slice(0, c.state.grants.length).map((g) => ({ lane: g.device, from: g.at, to: g.until, ink: 'data' as const, text: `${g.at}–${g.until}` })),
    ),
    markers: from(['t', 'devices'], (c) =>
      c.index === 0 ? [] : p.requests.filter((r) => r.at <= c.state.t).map((r) => ({ at: r.at, text: '请求', lane: r.device, ink: 'accent' as const })),
    ),
    now: from('t', (c) => (c.index === 0 ? undefined : c.state.t)),
  };

  const scene: SceneSpec = { parts, wires };
  const bind = bindTable<State>(table);

  const moves = (step: Step<State>): Move[] => {
    const s = step.state;
    const kind = kindOf(step);
    if (kind === 'bg' && chain) {
      const i = s.devices.findLastIndex((d) => d.bg === 1);
      return [{ value: 'BG', from: i === 0 ? 'ARB' : `D${i - 1}`, to: `D${i}`, via: [`bg-${i}`], shape: 'level', ink: 'ctrl' }];
    }
    if (kind === 'count' && s.counter !== null) return [{ value: String(s.counter), from: 'ARB', to: `D${s.counter}`, arc: true, ink: 'addr' }];
    if (kind === 'queue') {
      const i = s.devices.findIndex((d) => d.bg === 1);
      return i >= 0 ? [{ value: `BG_${i}`, from: 'ARB', to: `D${i}`, arc: true, shape: 'level', ink: 'ctrl' }] : [];
    }
    if (kind === 'grant' && s.owner !== null) return [{ value: 'BS', from: `D${s.owner}`, to: 'ARB', arc: true, shape: 'level', ink: 'ctrl' }];
    return [];
  };

  const names = (path: string): string => {
    const plain: Record<string, string> = { t: '时刻 t', bs: 'BS', owner: '总线的主方', counter: '计数器' };
    if (plain[path]) return plain[path]!;
    let m = /^devices\.(\d+)\.(\w+)$/.exec(path);
    if (m) return `接口 ${m[1]} 的 ${({ br: own ? `BR_${m[1]}` : '请求', bg: own ? `BG_${m[1]}` : 'BG', pending: '排队的请求数' } as Record<string, string>)[m[2] ?? ''] ?? m[2]}`;
    m = /^grants\.(\d+)$/.exec(path);
    if (m) return `第 ${Number(m[1]) + 1} 次授权`;
    return path;
  };
  const values = (path: string, value: string): string => {
    if (path === 'owner' || /^grants\.\d+$/.test(path)) return value === '' || value === 'null' ? '空' : `设备 ${value}`;
    return value;
  };
  const caption = (s: State): string => `t = ${s.t}　BS = ${s.bs}${s.owner === null ? '' : `　设备 ${s.owner} 占用总线`}`;

  const devices = Array.from({ length: n }, (_, i) => `D${i}`);
  const askFrame = (): string[] => ['ARB', ...devices];
  const frame = (step: Step<State>): string[] | null => {
    const kind = kindOf(step);
    if (kind === 'release') return ['ARB', ...devices, 'track'];
    return null;
  };

  /** 答错：学生选的设备举着手，却看着 BG 被别人截走。 */
  const wrong = (ask: Ask, value: string, state: State, next: Step<State> | null): Breakage | null => {
    if (ask.kind !== 'choice' || !next) return null;
    const winner = ask.answer === '没有设备' ? null : Number(ask.answer.replace(/\D/g, ''));
    if (value === '没有设备') {
      return {
        label: '',
        patch: { ARB: { value: '没人接？' } },
        moves: [{ value: 'BG', from: 'ARB', to: `D${winner ?? 0}`, arc: true, shape: 'level' }],
        message: `有设备能接住 BG：${ask.answer} 有请求，而且 BG 到得了它。`,
      };
    }
    const picked = Number(value.replace(/\D/g, ''));
    const patch: Record<string, Record<string, unknown>> = { [`D${picked}`]: { value: '没拿到' } };
    if (winner !== null) patch[`D${winner}`] = { value: chain ? '接住 BG' : counter ? '地址相同' : `收到 BG_${winner}` };
    const why =
      winner === null
        ? `接口 ${p.broken} 传 BG 的电路坏了，BG 到不了设备 ${picked}。`
        : chain
          ? `BG 从接口 0 往下传，先到接口 ${winner}，它有请求，当场截住，设备 ${picked} 收不到。`
          : counter
            ? `这一轮计数从 ${state.counter === null ? 0 : '上一次停下的下一个值'} 开始，先数到 ${winner}，地址相同又有请求，计数就停了。`
            : `排队电路按优先次序一步选出设备 ${winner}。`;
    return {
      label: '',
      patch,
      moves: [{ value: chain ? 'BG' : counter ? String(winner) : `BG_${winner}`, from: 'ARB', to: `D${winner ?? picked}`, arc: true, shape: chain || own ? 'level' : 'card' }],
      message: `按你选的设备 ${picked}：${why}`,
    };
  };

  // 常见错误：在这份 Trace 的步骤上演。
  const indexOf = (test: (step: Step<State>, i: number) => boolean): number => trace.steps.findIndex(test) + 1;
  const mistakes: Mistake<State>[] = [];
  const captureFar = indexOf((step) => kindOf(step) === 'bg' && step.state.devices.some((d, i) => d.bg === 1 && d.br === 1 && i < n - 1) && step.state.devices.slice(0, -1).some((d, i, all) => d.br === 1 && all.findIndex((x) => x.bg === 1 && x.br === 1) < i));
  if (chain) {
    const at = captureFar > 0 ? captureFar : indexOf((step) => kindOf(step) === 'bg');
    mistakes.push({
      text: '容易以为后面的接口也收到了 BG，只是慢一点，因为 BR 是公共线',
      at,
      act: (state) => {
        const w = state.devices.findIndex((d) => d.bg === 1 && d.br === 1);
        const behind = state.devices.map((d, i) => i).filter((i) => i > w && state.devices[i]!.br === 1);
        const patch: Record<string, Record<string, unknown>> = {};
        for (const i of behind) patch[`D${i}`] = { value: '等不到 BG' };
        return {
          label: '',
          patch,
          moves: [{ value: 'BG', from: `D${w}`, to: `D${Math.min(n - 1, w + 1)}`, arc: true, shape: 'level' }],
          message: `BR 是公共线，仲裁器只知道「有人要」，不知道是谁。BG 到了接口 ${w} 就被截住，不再往下送${behind.length ? `，${behind.map((i) => `设备 ${i}`).join('、')} 这一轮根本收不到 BG` : ''}。它们只能等下一轮，而下一轮 BG 还是先经过前面的接口。`,
        };
      },
    });
  }
  // 占用期间有更靠前的设备请求：它不能抢。
  const busy = plan.grants.find((g) => p.requests.some((r) => r.at > g.at && r.at < g.until && (chain || counter ? r.device < g.device : true)));
  if (busy) {
    const late = p.requests.find((r) => r.at > busy.at && r.at < busy.until)!;
    const at = indexOf((step) => kindOf(step) === 'grant' && step.state.owner === busy.device && step.state.t <= busy.at);
    if (at > 0) {
      mistakes.push({
        text: '容易以为离仲裁器近的设备一请求就能把总线抢过来，因为它优先',
        at,
        act: () => ({
          label: '',
          patch: { [`D${late.device}`]: { value: `t=${late.at} 请求` }, ARB: { value: '不发 BG' } },
          moves: [{ value: 'BR', from: `D${late.device}`, to: 'ARB', arc: true, shape: 'level' }],
          message: `设备 ${late.device} 在 t=${late.at} 请求时，设备 ${busy.device} 正占着总线（BS=1，到 t=${busy.until}）。总线占用期间不被打断（教材 p211），仲裁器等 BS 清 0 才开始下一轮，优先只在下一轮比。`,
        }),
      });
    }
  }
  if (counter) {
    const second = indexOf((step, i) => kindOf(step) === 'count' && trace.steps.slice(0, i).filter((x) => kindOf(x) === 'grant').length >= 1);
    if (second > 0) {
      mistakes.push({
        text: p.counterFrom === '中止点' ? '容易从停下的那个值再计一遍，因为叫「从中止点」' : '容易以为从 0 计数时各设备机会均等，因为每台都会被数到',
        at: second,
        act: (state) => {
          const last = state.grants.at(-1) ?? 0;
          return {
            label: '',
            patch: { ARB: { value: p.counterFrom === '中止点' ? `计数 ${last}？` : '计数 0' } },
            moves: [{ value: p.counterFrom === '中止点' ? String(last) : '0', from: 'ARB', to: `D${p.counterFrom === '中止点' ? last : 0}`, arc: true, ink: 'addr' }],
            message:
              p.counterFrom === '中止点'
                ? `上一轮停在 ${last}。如果这一轮还从 ${last} 计，刚用完总线的设备 ${last} 只要又有请求就会再赢一次，谈不上优先级相等。本站取停下的下一个值。`
                : '每轮都从 0 计，设备 0 只要有请求就先被数到，和链式查询一样是固定优先级；要机会均等，得从中止点计数。',
          };
        },
      });
    }
  }

  const convention = (step: Step<State>): string | null => {
    if (kindOf(step) === 'count' && p.counterFrom === '中止点') return '教材只说从中止点开始计数，没说是停下的值还是它的下一个。这里取下一个，停在 k 后下一轮从 k+1 计。';
    if (kindOf(step) === 'request' && trace.steps.indexOf(step) > 0) return '上一个主方释放总线和这一轮仲裁算在同一个周期边界，不另花周期。';
    return null;
  };

  return { scene, bind, moves, names, values, caption, askFrame, frame, wrong, mistakes, convention };
}
