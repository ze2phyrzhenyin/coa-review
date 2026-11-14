/** 平面模式：没有 WebGL 时，同一份目标画面用普通页面元素排出来。步骤、文字、解题表、答题控件都一样。 */
import type { Patch, PartSpec, Pose, SceneSpec } from '../scene';

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
    default:
      return title;
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
        if (part.kind === 'memory') {
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
                      <td key={c} class={marked.has(`${r}.${c}`) ? 'is-changed' : ''}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        } else if (part.kind === 'label') {
          body = <span class="pl-part-value">{text(props.text)}</span>;
        } else {
          const said = readout(part, props);
          body = (
            <>
              <span class="pl-part-name">{title}</span>
              <span class="pl-part-value">{said.startsWith(`${title}，`) ? said.slice(title.length + 1) : said}</span>
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
