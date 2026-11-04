import type { Fault } from "@rig/dsp-host";
import type { Slot } from "@rig/shared";
import { Fragment, type ReactNode, useRef } from "react";
import type { Catalog } from "../catalog";
import { AmpHead, CabBox } from "./Amp";
import { Pedal, type UnitProps } from "./Pedal";

interface Props {
  catalog: Catalog;
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
export const tapLabel = (catalog: Catalog, slots: Slot[], i: number) =>
  i === 0
    ? "Input"
    : i >= slots.length
      ? "Output"
      : `After ${catalog[slots[i - 1]?.module ?? ""]?.name ?? "pedal"}`;

function Jack({
  catalog,
  index,
  slots,
  tap,
  onTap,
}: {
  catalog: Catalog;
  index: number;
  slots: Slot[];
  tap: number;
  onTap: (i: number) => void;
}) {
  const label = tapLabel(catalog, slots, index);
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

/** Slots from a preamp to the next power amp: the amp's effects loop is whatever lies between them. */
function ampSpan(slots: Slot[], from: number): number {
  return slots.findIndex((s, i) => i > from && s.module === "poweramp@1");
}

export function Board({ catalog, slots, faults, tap, selected, onSelect, onTap, edit }: Props) {
  const dragFrom = useRef<number | null>(null);
  const unit = (slot: Slot, i: number): UnitProps | null => {
    const def = catalog[slot.module];
    if (!def) return null;
    return {
      slot,
      def,
      fault: faults.find((f) => f.slotId === slot.id)?.message,
      onParam: (id, v) =>
        edit((s) =>
          s.map((x) => (x.id === slot.id ? { ...x, params: { ...x.params, [id]: v } } : x)),
        ),
      onBypass: () =>
        edit((s) => s.map((x) => (x.id === slot.id ? { ...x, bypass: !x.bypass } : x))),
      onRemove: () => {
        if (selected === slot.id) onSelect(null);
        edit((s) => s.filter((x) => x.id !== slot.id));
      },
      onMove: (d) => edit((s) => move(s, i, i + d)),
      canMove: [i > 0, i < slots.length - 1],
      selected: selected === slot.id,
      onSelect: () => onSelect(slot.id),
      drag: {
        start: () => {
          dragFrom.current = i;
        },
        drop: () => {
          const from = dragFrom.current;
          dragFrom.current = null;
          if (from !== null) edit((s) => move(s, from, i));
        },
      },
    };
  };
  const jack = (i: number) => (
    <Jack key={`jack-${i}`} catalog={catalog} index={i} slots={slots} tap={tap} onTap={onTap} />
  );

  // what to draw, in signal order: single boxes, and an amp head wherever a preamp meets its power amp
  const items: ReactNode[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i] as Slot;
    const u = unit(slot, i);
    if (!u) continue;
    const power = slot.module === "preamp@1" ? ampSpan(slots, i) : -1;
    if (power > 0) {
      const panels = [u, unit(slots[power] as Slot, power)].filter((x): x is UnitProps => !!x);
      const inLoop = slots.slice(i + 1, power).map((s, k) => {
        const lu = unit(s, i + 1 + k);
        return (
          lu && (
            <Fragment key={s.id}>
              <Pedal {...lu} />
              {jack(i + 2 + k)}
            </Fragment>
          )
        );
      });
      items.push(
        <Fragment key={slot.id}>
          <AmpHead
            panels={panels}
            loop={
              <>
                {jack(i + 1)}
                {inLoop}
                {power === i + 1 && <span className="amp-loop-empty">Nothing in the loop</span>}
              </>
            }
          />
          {jack(power + 1)}
        </Fragment>,
      );
      i = power;
      continue;
    }
    items.push(
      <Fragment key={slot.id}>
        {slot.module === "cab@1" ? (
          <CabBox {...u} />
        ) : slot.module === "amp@1" ||
          slot.module === "preamp@1" ||
          slot.module === "poweramp@1" ? (
          <AmpHead panels={[u]} />
        ) : (
          <Pedal {...u} />
        )}
        {jack(i + 1)}
      </Fragment>,
    );
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: mouse shortcut; the Inspect button is the keyboard route
    <section
      className="board"
      aria-label="Pedalboard"
      onClick={(e) => e.target === e.currentTarget && onSelect(null)}
    >
      {jack(0)}
      {items}
      {slots.length === 0 && (
        <p className="empty">No pedals on the board. Add one from the shelf on the left.</p>
      )}
    </section>
  );
}
