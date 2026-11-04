import type { Preset } from "@rig/shared";
import type { Catalog } from "../catalog";
import { finishFor } from "./finish";

/** A miniature of the pedal as it looks on the board: same enamel, legend, knob count and footswitch. */
function Thumb({ id, name, knobs }: { id: string; name: string; knobs: number }) {
  const { finish, ink } = finishFor(id);
  return (
    <span
      className="thumb"
      aria-hidden="true"
      style={{ "--finish": finish, "--ink": ink } as React.CSSProperties}
    >
      <span className="thumb-legend">{name}</span>
      <span className="thumb-knobs">
        {Array.from({ length: knobs }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical decorative dots
          <i key={i} />
        ))}
      </span>
      <span className="thumb-foot" />
    </span>
  );
}

export function Library({
  catalog,
  presets,
  activeId,
  onLoad,
  onAdd,
}: {
  catalog: Catalog;
  presets: Preset[];
  /** The preset the board currently is, if any. */
  activeId: string | null;
  onLoad: (preset: Preset) => void;
  onAdd: (moduleId: string) => void;
}) {
  return (
    <aside className="shelf" aria-label="Pedal shelf">
      <details open>
        <summary>
          <h2>Presets</h2>
        </summary>
        <ul className="presets">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onLoad(p)}
                aria-current={p.id === activeId ? "true" : undefined}
                aria-label={`Load preset ${p.name}`}
                title={p.description}
              >
                <span className="shelf-name">{p.name}</span>
                <span className="cat">
                  {p.tags
                    .filter((t) => !t.includes(":"))
                    .slice(0, 3)
                    .join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      <details open>
        <summary>
          <h2>Shelf</h2>
        </summary>
        <ul>
          {Object.values(catalog).map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onAdd(m.id)}
                aria-label={`Add ${m.name} to the board`}
                title={m.description}
              >
                <Thumb id={m.id} name={m.name} knobs={m.params.length} />
                <span className="shelf-name">{m.name}</span>
                <span className="cat">{m.category}</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
    </aside>
  );
}
