import type { Fault } from "@rig/dsp-host";
import { MODULES } from "@rig/dsp-host";
import type { Slot } from "@rig/shared";
import { Fragment, useRef } from "react";
import { Pedal } from "./Pedal";

interface Props {
  slots: Slot[];
  faults: Fault[];
  tap: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onTap: (i: number) => void;
  edit: (fn: (s: Slot[]) => Slot[]) => void;
}

const move = (s: Slot[], from: number, to: number): Slot[] => {
  if (from === to || to < 0 || to >= s.length) return s;
  const next = s.slice();
  const [m] = next.splice(from, 1);
  if (m) next.splice(to, 0, m);
  return next;
};

/** Where in the chain a cable sits: the jack on it chooses which signal the scope shows. */
export const tapLabel = (slots: Slot[], i: number) =>
  i === 0
    ? "Input"
    : i >= slots.length
      ? "Output"
      : `After ${MODULES[slots[i - 1]?.module ?? ""]?.name ?? "pedal"}`;

function Jack({
  index,
  slots,
  tap,
  onTap,
}: {
  index: number;
  slots: Slot[];
  tap: number;
  onTap: (i: number) => void;
}) {
  const label = tapLabel(slots, index);
  return (
    <div className="cable">
      <button
        type="button"
        className="jack"
        aria-pressed={tap === index}
        aria-label={`Listen here: ${label}`}
        title={label}
        onClick={() => onTap(index)}
      />
      <span className="cable-label">{index === 0 ? "in" : index >= slots.length ? "out" : ""}</span>
    </div>
  );
}

export function Board({ slots, faults, tap, selected, onSelect, onTap, edit }: Props) {
  const dragFrom = useRef<number | null>(null);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut; the Inspect button is the keyboard route
    <section
      className="board"
      aria-label="Pedalboard"
      onClick={(e) => e.target === e.currentTarget && onSelect(null)}
    >
      <Jack index={0} slots={slots} tap={tap} onTap={onTap} />
      {slots.map((slot, i) => {
        const def = MODULES[slot.module];
        if (!def) return null;
        return (
          <Fragment key={slot.id}>
            <Pedal
              slot={slot}
              def={def}
              fault={faults.find((f) => f.slotId === slot.id)?.message}
              onParam={(id, v) =>
                edit((s) =>
                  s.map((x) => (x.id === slot.id ? { ...x, params: { ...x.params, [id]: v } } : x)),
                )
              }
              onBypass={() =>
                edit((s) => s.map((x) => (x.id === slot.id ? { ...x, bypass: !x.bypass } : x)))
              }
              onRemove={() => {
                if (selected === slot.id) onSelect(null);
                edit((s) => s.filter((x) => x.id !== slot.id));
              }}
              onMove={(d) => edit((s) => move(s, i, i + d))}
              canMove={[i > 0, i < slots.length - 1]}
              selected={selected === slot.id}
              onSelect={() => onSelect(slot.id)}
              drag={{
                start: () => {
                  dragFrom.current = i;
                },
                drop: () => {
                  const from = dragFrom.current;
                  dragFrom.current = null;
                  if (from !== null) edit((s) => move(s, from, i));
                },
              }}
            />
            <Jack index={i + 1} slots={slots} tap={tap} onTap={onTap} />
          </Fragment>
        );
      })}
      {slots.length === 0 && (
        <p className="empty">No pedals on the board. Add one from the shelf on the left.</p>
      )}
    </section>
  );
}
