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
  onAdd,
}: {
  catalog: Catalog;
  onAdd: (moduleId: string) => void;
}) {
  return (
    <aside className="shelf" aria-label="Pedal shelf">
      <h2>Shelf</h2>
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
    </aside>
  );
}
