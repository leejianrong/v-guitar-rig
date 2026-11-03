import { MODULES } from "@rig/dsp-host";

export function Library({ onAdd }: { onAdd: (moduleId: string) => void }) {
  return (
    <section className="shelf" aria-label="Pedal shelf">
      <h2>Shelf</h2>
      <ul>
        {Object.values(MODULES).map((m) => (
          <li key={m.id}>
            <div>
              <strong>{m.name}</strong>
              <span className="cat">{m.category}</span>
              <p>{m.description}</p>
            </div>
            <button
              type="button"
              onClick={() => onAdd(m.id)}
              aria-label={`Add ${m.name} to the board`}
            >
              Add
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
