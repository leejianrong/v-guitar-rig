import type { ModuleDef } from "@rig/dsp-host";
import type { Slot } from "@rig/shared";
import { finishFor } from "./finish";
import { Knob } from "./Knob";

interface Props {
  slot: Slot;
  def: ModuleDef;
  fault?: string;
  onParam: (id: string, v: number) => void;
  onBypass: () => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMove: [boolean, boolean];
  drag: { start: () => void; drop: () => void };
}

export function Pedal({
  slot,
  def,
  fault,
  onParam,
  onBypass,
  onRemove,
  onMove,
  canMove,
  drag,
}: Props) {
  const { finish, ink } = finishFor(slot.module);
  const on = !slot.bypass && !fault;
  return (
    <article
      className={`pedal${on ? "" : " off"}`}
      style={{ "--finish": finish, "--ink": ink } as React.CSSProperties}
      data-testid={`pedal-${def.id}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drag.drop}
    >
      <div className="pedal-tools">
        <button
          type="button"
          aria-label={`Move ${def.name} left`}
          disabled={!canMove[0]}
          onClick={() => onMove(-1)}
        >
          ◀
        </button>
        <button type="button" aria-label={`Remove ${def.name}`} onClick={onRemove}>
          ✕
        </button>
        <button
          type="button"
          aria-label={`Move ${def.name} right`}
          disabled={!canMove[1]}
          onClick={() => onMove(1)}
        >
          ▶
        </button>
      </div>
      {/* only the legend drags the pedal: a draggable ancestor would steal knob drags */}
      <h3
        className="legend"
        title="Drag to reorder"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", def.id);
          const box = e.currentTarget.parentElement;
          if (box) e.dataTransfer.setDragImage(box, 20, 20);
          drag.start();
        }}
      >
        {def.name}
      </h3>
      <div className={`knobs k${def.params.length}`}>
        {def.params.map((p) => (
          <Knob
            key={p.id}
            spec={p}
            value={slot.params[p.id] ?? p.default}
            onChange={(v) => onParam(p.id, v)}
          />
        ))}
      </div>
      {fault && (
        <p className="fault" role="alert">
          Bypassed: {fault}
        </p>
      )}
      <span className={`led${on ? " lit" : ""}`} aria-hidden="true" />
      <button
        type="button"
        className="footswitch"
        aria-pressed={on}
        aria-label={`${def.name} ${on ? "on" : "bypassed"}`}
        onClick={onBypass}
      />
    </article>
  );
}
