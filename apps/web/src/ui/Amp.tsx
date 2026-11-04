import type { ReactNode } from "react";
import { finishFor } from "./finish";
import { Knob } from "./Knob";
import type { UnitProps } from "./Pedal";

/** The tools, switch and lamp every amp panel and the cabinet carry, as on a pedal. */
function Tools({ slot, def, onRemove, onSelect, selected, onMove, canMove }: UnitProps) {
  return (
    <div className="pedal-tools">
      <button
        type="button"
        aria-label={`Move ${def.name} left`}
        disabled={!canMove[0]}
        onClick={() => onMove(-1)}
      >
        ◀
      </button>
      <button
        type="button"
        aria-label={`Inspect ${def.name}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        ◎
      </button>
      <button
        type="button"
        aria-label={`Remove ${def.name}`}
        onClick={onRemove}
        data-slot={slot.id}
      >
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
  );
}

function Controls({ slot, def, onParam }: UnitProps) {
  return (
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
  );
}

function Standby({ slot, def, fault, onBypass }: UnitProps) {
  const on = !slot.bypass && !fault;
  return (
    <button
      type="button"
      className={`standby${on ? " lit" : ""}`}
      aria-pressed={on}
      aria-label={`${def.name} ${on ? "on" : "bypassed"}`}
      onClick={onBypass}
    >
      <span className="jewel" aria-hidden="true" />
    </button>
  );
}

/** One section of an amp's faceplate: a name, its knobs and a power switch with a jewel lamp. */
function Panel(u: UnitProps) {
  const { slot, def, fault, selected, onSelect, drag } = u;
  const on = !slot.bypass && !fault;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut; the Inspect button is the keyboard route
    <article
      className={`amp-panel${on ? "" : " off"}${selected ? " selected" : ""}`}
      data-testid={`pedal-${def.id}`}
      onClick={(e) => {
        if (!(e.target as Element).closest("button, [role=slider]")) onSelect();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drag.drop}
    >
      <Tools {...u} />
      {/* only the name drags the panel: a draggable ancestor would steal knob drags */}
      <h3
        className="amp-name"
        title="Drag to reorder"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/plain", def.id);
          drag.start();
        }}
      >
        {def.name}
      </h3>
      <Controls {...u} />
      {fault && (
        <p className="fault" role="alert">
          Bypassed: {fault}
        </p>
      )}
      <Standby {...u} />
    </article>
  );
}

/**
 * An amplifier head: a brass faceplate with one panel per module (the whole amp, or the preamp and the
 * power amp), and under it the effects loop, whose pedals sit between the preamp and the power amp.
 */
export function AmpHead({ panels, loop }: { panels: UnitProps[]; loop?: ReactNode }) {
  const { finish, ink } = finishFor(panels[0]?.slot.module ?? "");
  return (
    <article
      className="amp"
      data-testid="amp-head"
      style={{ "--finish": finish, "--ink": ink } as React.CSSProperties}
    >
      <div className="amp-handle" aria-hidden="true" />
      <div className="amp-face">
        {panels.map((u) => (
          <Panel key={u.slot.id} {...u} />
        ))}
      </div>
      {loop && (
        <section className="amp-loop" aria-label="Effects loop">
          <div className="amp-loop-head">
            <span>Send</span>
            <span className="amp-loop-title">Effects loop</span>
            <span>Return</span>
          </div>
          <div className="amp-loop-row">{loop}</div>
        </section>
      )}
    </article>
  );
}

/** A speaker cabinet: grille cloth over the speaker, with the cab's controls on a plate above it. */
export function CabBox(u: UnitProps) {
  const { slot, def, fault, selected, onSelect, drag } = u;
  const on = !slot.bypass && !fault;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut; the Inspect button is the keyboard route
    <article
      className={`cabbox${on ? "" : " off"}${selected ? " selected" : ""}`}
      data-testid={`pedal-${def.id}`}
      onClick={(e) => {
        if (!(e.target as Element).closest("button, [role=slider]")) onSelect();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={drag.drop}
    >
      <Tools {...u} />
      <div className="cab-plate">
        <h3
          className="amp-name"
          title="Drag to reorder"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", def.id);
            drag.start();
          }}
        >
          {def.name}
        </h3>
        <Controls {...u} />
        <Standby {...u} />
      </div>
      <div className="cab-grille" aria-hidden="true">
        <span className="cab-speaker" />
      </div>
      {fault && (
        <p className="fault" role="alert">
          Bypassed: {fault}
        </p>
      )}
    </article>
  );
}
