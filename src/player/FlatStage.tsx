/** 平面模式：没有 WebGL 时，同一份目标画面用普通页面元素排出来。步骤、文字、解题表、答题控件都一样。 */
import type { Patch, PartSpec, Pose, SceneSpec } from '../scene';
import { Rich } from './Rich';

const text = (value: unknown): string => (value === undefined || value === null ? '' : String(value));
const isOn = (value: unknown): boolean => value === true || value === '1' || value === 'true';

function drivers(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map(String) : text(value).split(/[、,，\s]+/);
  return list.filter((name) => name !== '');
}

export function partTitle(part: PartSpec): string {
  if (part.title) return part.title;
  const props = part.props as { name?: string };
  return props.name || part.id;
}

/** 一个部件现在的读数，一句话。读屏和点选说明用。 */
export function readout(part: PartSpec, props: Patch): string {
  const title = text(props.name) || partTitle(part);
  switch (part.kind) {
    case 'register':
    case 'token':
      return `${title}，${text(props.value) || '空'}`;
    case 'bus': {
      const names = drivers(props.drivers);
      if (names.length > 1) return `${title}，${names.join('、')} 同时驱动，冲突`;
      return names.length ? `${title}，${text(props.value)}，${names[0]} 驱动` : `${title}，没有部件驱动`;
    }
    case 'gate': {
      const states = (props.states as [string, string] | undefined) ?? ['关', '通'];
      return `${title}，${states[isOn(props.open) ? 1 : 0]}`;
    }
    case 'bits':
      return `${title}，${text(props.bits)}`;
    case 'label':
      return text(props.text);
    case 'chip': {
      const pins = ((props.pins as { name: string; value?: string }[] | undefined) ?? []).filter((pin) => text(pin.value) !== '');
      const said = pins.map((pin) => `${pin.name} ${text(pin.value)}`).join('，');
      return `${title}${text(props.label) ? ` ${text(props.label)}` : ''}${isOn(props.selected) ? '，选中' : ''}${said ? `，${said}` : ''}`;
    }
    case 'decoder': {
      const active = Number(props.active ?? -1);
      const names = props.outputNames as string[] | undefined;
      return `${title || '译码器'}，输入 ${text(props.input) || '空'}${active >= 0 ? `，${names?.[active] ?? `Y_${active}`} 有效` : '，没有输出有效'}`;
    }
    case 'signal':
      return `${text(props.text)}，${isOn(props.on) ? '有效' : '无效'}`;
    case 'dial':
      return `${title || '刻度盘'}，指针在第 ${text(props.pointer)} 格${isOn(props.crossed) ? '，越过了接缝' : ''}`;
    case 'balance': {
      const tilt = Math.sign(Number(props.tilt));
      return `${title || '天平'}，左 ${text(props.left)}，右 ${text(props.right)}，${tilt < 0 ? '左边沉' : tilt > 0 ? '右边沉' : '平'}`;
    }
    case 'conveyor':
      return `${title || '传送带'}，${((props.items as string[] | undefined) ?? []).map((item) => item || '空').join('、')}`;
    case 'stack':
      return `${title || '程序卡'}，${((props.cards as { title: string; note?: string }[] | undefined) ?? []).map((card) => card.title + (card.note ? `（${card.note}）` : '')).join('，')}`;
    case 'compare': {
      const result = text(props.result);
      return `${title || '比较'}，${text(props.left)} 和 ${text(props.right)}${result === 'match' ? '，一致' : result === 'mismatch' ? '，不一致' : ''}`;
    }
    case 'track': {
      const segments = (props.segments as { text?: string }[] | undefined) ?? [];
      return `${title || '时间轴'}，${segments.map((segment) => segment.text).filter(Boolean).join('、') || '空'}`;
    }
    default:
      if ('describe' in part && part.describe) return part.describe(props);
      return props.value !== undefined ? `${title}，${text(props.value) || '空'}` : title;
  }
}

export interface FlatStageProps {
  scene: SceneSpec;
  pose: Pose;
  picking: boolean;
  wrong: string | undefined;
  onPick: (id: string) => void;
}

export function FlatStage({ scene, pose, picking, wrong, onPick }: FlatStageProps) {
  return (
    <div class="pl-flat">
      {scene.parts.map((part) => {
        const props = pose.parts[part.id] ?? {};
        if (part.kind === 'sheet' || props.hidden) return null;
        const title = text(props.name) || partTitle(part);
        const classes = `pl-part is-${part.kind}${props.changed ? ' is-changed' : ''}${props.focus ? ' is-focus' : ''}${wrong !== undefined && (wrong === part.id || wrong === title) ? ' is-wrong' : ''}`;
        let body;
        if (part.kind === 'grid') {
          const columns = (props.columns as string[] | undefined) ?? [];
          const rows = (props.rows as string[] | undefined) ?? [];
          const cells = (props.cells as string[][] | undefined) ?? [];
          body = (
            <table>
              <thead>
                <tr>
                  <th />
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={row}>
                    <th scope="row">
                      <Rich text={row} />
                    </th>
                    {columns.map((_, c) => (
                      <td key={c} class={props.current === c ? 'is-current' : ''}>
                        <Rich text={cells[r]?.[c] ?? ''} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        } else if (part.kind === 'memory') {
          const columns = (props.columns as { title: string }[] | undefined) ?? [];
          const rows = (props.rows as string[][] | undefined) ?? [];
          const labels = props.labels as string[] | undefined;
          const marked = new Set((props.changedCells as string[] | undefined) ?? []);
          body = (
            <table>
              <thead>
                <tr>
                  {labels ? <th /> : null}
                  {columns.map((column) => (
                    <th key={column.title}>{column.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r} class={props.active === r ? 'is-current' : ''}>
                    {labels ? <th scope="row">{labels[r]}</th> : null}
                    {row.map((cell, c) => (
                      <td key={c} class={marked.has(`${r}.${c}`) || props.cell === `${r}.${c}` ? 'is-changed' : ''}>
                        <Rich text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        } else if (part.kind === 'label') {
          body = (
            <span class="pl-part-value">
              <Rich text={text(props.text)} />
            </span>
          );
        } else {
          const said = readout(part, props);
          body = (
            <>
              <span class="pl-part-name">
                <Rich text={title} />
              </span>
              <span class="pl-part-value">
                <Rich text={said.startsWith(`${title}，`) ? said.slice(title.length + 1) : said} />
              </span>
            </>
          );
        }
        return part.pick ? (
          <button key={part.id} type="button" class={classes} data-pick={part.id} aria-label={picking ? `选 ${title}` : undefined} onClick={() => onPick(part.id)}>
            {body}
          </button>
        ) : (
          <div key={part.id} class={classes}>
            {body}
          </div>
        );
      })}
    </div>
  );
}
