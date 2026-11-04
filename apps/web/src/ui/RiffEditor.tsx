import { STARTER_RIFFS } from "@rig/dsp-host";
import type { Riff, Technique } from "@rig/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import type { Rig } from "../audio";
import { saveRiff } from "../catalog";
import {
  blankRiff,
  clearCell,
  noteAt,
  resize,
  setFret,
  setTech,
  slugOf,
  stepFor,
  toggleTech,
} from "../riff-edit";

const NAMES = ["e", "B", "G", "D", "A", "E"];
const TECH_KEYS: Record<string, Technique> = {
  h: "hammer",
  p: "pull",
  s: "slide",
  b: "bend",
  m: "palm",
};
const MARK = { hammer: "h", pull: "p", slide: "/", palm: "m", bend: "" } as const;

export interface RiffEditorProps {
  draft: Riff;
  riffs: Riff[];
  connected: boolean;
  rig: Rig | null;
  playing: boolean;
  loop: boolean;
  onChange(r: Riff): void;
  onPick(id: string): void;
  onPlay(): void;
  onLoop(on: boolean): void;
}

const same = (a: Riff, b?: Riff) =>
  !!b &&
  a.name === b.name &&
  a.bpm === b.bpm &&
  a.beats === b.beats &&
  JSON.stringify(a.notes) === JSON.stringify(b.notes);

export function RiffEditor(p: RiffEditorProps) {
  const { draft, riffs, rig } = p;
  const [step, setStep] = useState(() => stepFor(draft));
  const [cursor, setCursor] = useState({ string: 1, slot: 0 });
  const typed = useRef({ text: "", at: 0, cell: "" });
  const grid = useRef<HTMLFieldSetElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  const slots = Math.round(draft.beats / step);
  const columns = Array.from({ length: slots }, (_, i) => i);

  // a different riff may need sixteenths to show all its notes
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when another riff is picked
  useEffect(() => setStep(stepFor(draft)), [draft.id]);

  useEffect(
    () =>
      rig?.onBeat(({ beat: heard }) => {
        // the audio takes `latencyMs` to reach the speakers: draw where the sound is, not where the synth is
        const beat = Math.max(0, heard - (rig.latencyMs / 60000) * draft.bpm);
        const h = head.current;
        const g = grid.current;
        if (!h || !g) return;
        h.dataset.beat = beat.toFixed(2);
        h.style.transform = `translateX(calc(var(--col) * ${beat / step}))`;
        const width = (sel: string) => g.querySelector(sel)?.getBoundingClientRect().width ?? 0;
        const at = width(".tabname") + (beat / step) * width(".cell");
        if (at > g.scrollLeft + g.clientWidth * 0.85) g.scrollLeft = at - g.clientWidth * 0.15;
        else if (at < g.scrollLeft) g.scrollLeft = Math.max(0, at - 40);
      }),
    [rig, step, draft.bpm],
  );

  const focusCell = (string: number, slot: number) => {
    setCursor({ string, slot });
    requestAnimationFrame(() =>
      grid.current?.querySelector<HTMLElement>(`[data-cell="${string}-${slot}"]`)?.focus(),
    );
  };

  function onKey(e: KeyboardEvent) {
    const { string, slot } = cursor;
    const key = e.key;
    if (e.ctrlKey || e.metaKey || e.altKey || (e.target as HTMLElement).tagName === "INPUT") return;
    const move = (ds: number, dl: number) => {
      e.preventDefault();
      focusCell(Math.min(6, Math.max(1, string + ds)), Math.min(slots - 1, Math.max(0, slot + dl)));
    };
    if (key === "ArrowUp") move(-1, 0);
    else if (key === "ArrowDown") move(1, 0);
    else if (key === "ArrowLeft") move(0, -1);
    else if (key === "ArrowRight") move(0, 1);
    else if (key === " ") {
      e.preventDefault();
      p.onPlay();
    } else if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      p.onChange(clearCell(draft, string, slot, step));
    } else if (/^[0-9]$/.test(key)) {
      e.preventDefault();
      const t = typed.current;
      const cell = `${string}-${slot}`;
      const joined = t.text + key;
      const text =
        t.cell === cell && performance.now() - t.at < 900 && Number(joined) <= 24 ? joined : key;
      typed.current = { text, at: performance.now(), cell };
      p.onChange(setFret(draft, string, slot, step, Number(text)));
    } else if (TECH_KEYS[key.toLowerCase()]) {
      e.preventDefault();
      p.onChange(toggleTech(draft, string, slot, step, TECH_KEYS[key.toLowerCase()] as Technique));
    }
  }

  const current = noteAt(draft, cursor.string, cursor.slot, step);
  const saved = riffs.find((r) => r.id === draft.id);
  const shipped = STARTER_RIFFS.some((r) => r.id === draft.id);
  const dirty = !same(draft, saved);

  async function save() {
    const id = saved && !shipped ? draft.id : slugOf(draft.name);
    const existing = riffs.find((r) => r.id === id);
    if (STARTER_RIFFS.some((r) => r.id === id) || (existing && id !== draft.id)) {
      setMessage(`There is already a riff called "${draft.name}". Give this one another name.`);
      return;
    }
    const res = await saveRiff({ ...draft, id }, existing?.rev ?? 0);
    if (res.ok) {
      setMessage("Saved.");
      p.onChange(res.riff);
    } else setMessage(res.message);
  }

  const choices = saved ? riffs : [draft, ...riffs];
  return (
    <section className="riffed" aria-label="Riff editor">
      <div className="riffbar">
        <button type="button" className="play" disabled={!rig} onClick={p.onPlay}>
          {p.playing ? "Pause riff" : "Play riff"}
        </button>
        <label>
          Riff
          <select value={draft.id} onChange={(e) => p.onPick(e.target.value)}>
            {choices.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => p.onChange(blankRiff())}>
          New riff
        </button>
        <label>
          <input type="checkbox" checked={p.loop} onChange={(e) => p.onLoop(e.target.checked)} />
          Loop
        </label>
        <label>
          Tempo
          <input
            type="number"
            min={30}
            max={300}
            value={draft.bpm}
            onChange={(e) =>
              p.onChange({
                ...draft,
                bpm: Math.min(300, Math.max(30, Number(e.target.value) || 100)),
              })
            }
          />
          <span className="unit">bpm</span>
        </label>
      </div>
      <div className="riffbar">
        <label>
          Name
          <input
            type="text"
            value={draft.name}
            maxLength={60}
            onChange={(e) => p.onChange({ ...draft, name: e.target.value })}
          />
        </label>
        <label>
          Grid
          <select value={step} onChange={(e) => setStep(Number(e.target.value))}>
            <option value={0.5}>Eighths</option>
            <option value={0.25}>Sixteenths</option>
          </select>
        </label>
        <label>
          Length
          <input
            type="number"
            min={1}
            max={64}
            value={draft.beats}
            onChange={(e) =>
              p.onChange(
                resize(
                  draft,
                  Math.min(64, Math.max(1, Math.round(Number(e.target.value)) || 4)),
                  step,
                ),
              )
            }
          />
          <span className="unit">beats</span>
        </label>
        <button
          type="button"
          disabled={!p.connected || draft.notes.length === 0 || (!dirty && !!saved && !shipped)}
          title={p.connected ? undefined : "Saving needs the daemon"}
          onClick={save}
        >
          Save riff
        </button>
        <output className="status">{dirty && !message ? "Unsaved changes" : message}</output>
      </div>

      <div className="riffbar cellbar">
        <span className="cellname">
          {NAMES[cursor.string - 1]} string, step {cursor.slot + 1}
        </span>
        <label>
          Fret
          <input
            type="number"
            min={0}
            max={24}
            value={current?.fret ?? ""}
            placeholder="-"
            onChange={(e) =>
              p.onChange(
                e.target.value === ""
                  ? clearCell(draft, cursor.string, cursor.slot, step)
                  : setFret(
                      draft,
                      cursor.string,
                      cursor.slot,
                      step,
                      Math.round(Number(e.target.value)),
                    ),
              )
            }
          />
        </label>
        <label>
          Technique
          <select
            disabled={!current}
            value={current?.tech ?? ""}
            onChange={(e) =>
              p.onChange(
                setTech(
                  draft,
                  cursor.string,
                  cursor.slot,
                  step,
                  (e.target.value || undefined) as Technique | undefined,
                  current?.bend,
                ),
              )
            }
          >
            <option value="">None</option>
            <option value="hammer">Hammer-on</option>
            <option value="pull">Pull-off</option>
            <option value="slide">Slide</option>
            <option value="bend">Bend</option>
            <option value="palm">Palm mute</option>
          </select>
        </label>
        <button
          type="button"
          disabled={!current}
          onClick={() => p.onChange(clearCell(draft, cursor.string, cursor.slot, step))}
        >
          Clear note
        </button>
        {!rig && <span className="status">Start audio to hear it</span>}
        {draft.notes.length === 0 && (
          <span className="status">Empty: click a cell, then type a fret number</span>
        )}
      </div>
      <fieldset
        className="tab"
        ref={grid}
        onKeyDown={onKey}
        style={{ "--cols": slots } as React.CSSProperties}
      >
        <legend className="sr-only">Tab</legend>
        <div className="tabgrid">
          {NAMES.map((name, i) => (
            <div className="tabrow" key={name}>
              <span className="tabname">{name}</span>
              {columns.map((slot) => {
                const n = noteAt(draft, i + 1, slot, step);
                const here = cursor.string === i + 1 && cursor.slot === slot;
                const beatStart = (slot * step) % 1 === 0;
                const bar = (slot * step) % 4 === 0;
                return (
                  <button
                    key={slot}
                    type="button"
                    tabIndex={here ? 0 : -1}
                    data-cell={`${i + 1}-${slot}`}
                    className={`cell${n ? " on" : ""}${here ? " sel" : ""}${bar ? " bar" : beatStart ? " beat" : ""}`}
                    aria-label={`String ${i + 1}, step ${slot + 1}${n ? `: fret ${n.fret}${n.tech ? `, ${n.tech}` : ""}` : ""}`}
                    onClick={() => setCursor({ string: i + 1, slot })}
                  >
                    {n && (
                      <span>
                        {n.tech ? MARK[n.tech] : ""}
                        {n.fret}
                        {n.tech === "bend" ? `↑${n.bend ?? 1}` : ""}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="playhead" ref={head} data-testid="playhead" data-beat="0.00" />
        </div>
      </fieldset>
      <p className="hint">
        Click a cell and type a fret (0 to 24). <kbd>h</kbd> hammer-on, <kbd>p</kbd> pull-off,{" "}
        <kbd>s</kbd> slide, <kbd>b</kbd> bend, <kbd>m</kbd> palm mute, <kbd>Backspace</kbd> clears,
        arrows move, <kbd>Space</kbd> plays. Edits are heard while it plays.
      </p>
    </section>
  );
}
