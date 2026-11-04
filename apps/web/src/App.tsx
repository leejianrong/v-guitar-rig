import type { Fault } from "@rig/dsp-host";
import { useEffect, useRef, useState } from "react";
import { benchmarkHeadroom, loadWasm, Rig, type Source } from "./audio";
import { useBoard } from "./board-state";
import { missingModules, slotsOf, useCatalog, usePresets, useRiffs } from "./catalog";
import { FrameCounter } from "./frames";
import { renderOffline } from "./offline";
import { Board, tapLabel } from "./ui/Board";
import { Inspector, pairLevels } from "./ui/Inspector";
import { Library } from "./ui/Library";
import { levelAt, Scope } from "./ui/Scope";

export function App() {
  const { board, link, notice, changeTick, dismissNotice, edit } = useBoard();
  const { catalog, sources } = useCatalog(link === "connected", changeTick);
  const presets = usePresets(link === "connected", changeTick);
  const riffs = useRiffs(link === "connected", changeTick);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [rig, setRig] = useState<Rig | null>(null);
  const [source, setSource] = useState<Source>("tone");
  const [riffId, setRiffId] = useState("pentatonic-lick");
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState(0.9);
  const [volume, setVolume] = useState(0.8);
  const [tap, setTap] = useState(1 << 20); // clamped below; starts at the output
  const [faults, setFaults] = useState<Fault[]>([]);
  const [status, setStatus] = useState("Idle");
  const [headroom, setHeadroom] = useState<number | null>(null);
  const [perf, setPerf] = useState<{ fps: number; underruns: number | null }>({
    fps: 0,
    underruns: 0,
  });
  const frames = useRef(new FrameCounter());
  const [loop, setLoop] = useState("not measured (needs a cable from interface output to input)");
  const [selectedId, select] = useState<string | null>(null);
  const slots = board.slots;
  const selectedSlot = slots.find((s) => s.id === selectedId);
  const selectedDef = catalog[selectedSlot?.module ?? ""];
  const tapAt = Math.min(tap, slots.length);

  // modules before slots, so a board that uses a stored module finds it compiled
  useEffect(() => rig?.setModules(sources), [rig, sources]);
  useEffect(() => rig?.setSlots(slots), [rig, slots]);
  useEffect(() => rig?.selectTap(tapAt), [rig, tapAt]);
  const inspected = slots.findIndex((s) => s.id === selectedId);
  useEffect(() => rig?.inspect(inspected), [rig, inspected]);
  useEffect(() => rig?.setLevel(level), [rig, level]);
  const riff = riffs.find((r) => r.id === riffId);
  // restart only when the chosen riff itself changes, not whenever the list is fetched again
  // biome-ignore lint/correctness/useExhaustiveDependencies: `riff` is read through its id and rev
  useEffect(() => {
    rig?.playRiff(playing && riff ? riff : null);
  }, [rig, riff?.id, riff?.rev, playing]);
  useEffect(() => rig?.setVolume(volume), [rig, volume]);
  useEffect(() => {
    if (!rig) return;
    const offs = [
      rig.onFaults(setFaults),
      rig.onProbe((r) =>
        setLoop(
          r.ms === null ? "no click heard: connect output to input" : `${r.ms.toFixed(1)} ms`,
        ),
      ),
    ];
    return () => {
      for (const o of offs) o();
    };
  }, [rig]);

  useEffect(() => {
    if (!rig) return;
    const counter = frames.current;
    counter.start();
    const read = () => ({ fps: counter.fps(), underruns: rig.underruns });
    window.__rigStats = read;
    const t = setInterval(() => setPerf(read()), 1000);
    return () => {
      clearInterval(t);
      counter.stop();
    };
  }, [rig]);

  useEffect(() => {
    window.__rigOffline = async (clip, s) =>
      Array.from(await renderOffline(await loadWasm(), s, Float32Array.from(clip)));
  }, []);

  async function start() {
    setStatus("Starting audio...");
    try {
      const r = await Rig.start(source, slots, sources, level, volume);
      setRig(r);
      setPlaying(source === "riff");
      setStatus("Running");
      const h = await benchmarkHeadroom();
      setHeadroom(h);
      window.__rig = { ready: true, headroom: h, level: levelAt, pair: pairLevels };
    } catch (e) {
      setStatus(`Could not start: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function stop() {
    window.__rig = undefined;
    setRig(null);
    setFaults([]);
    setStatus("Stopped");
    await rig?.stop();
  }

  return (
    <main>
      <header className="bar">
        <h1>Virtual Guitar Rig</h1>
        <label>
          Source
          <select
            value={source}
            disabled={!!rig}
            onChange={(e) => setSource(e.target.value as Source)}
          >
            <option value="tone">Test tone (110 Hz)</option>
            <option value="guitar">Guitar input</option>
            <option value="riff">Virtual guitar (riff)</option>
          </select>
        </label>
        {source === "riff" && (
          <>
            <label>
              Riff
              <select value={riffId} onChange={(e) => setRiffId(e.target.value)}>
                {riffs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={!rig} onClick={() => setPlaying(!playing)}>
              {playing ? "Pause riff" : "Play riff"}
            </button>
          </>
        )}
        <label>
          Input level
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
          />
        </label>
        <label>
          Output volume
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        {rig ? (
          <button type="button" onClick={stop}>
            Stop audio
          </button>
        ) : (
          <button type="button" className="primary" onClick={start}>
            Start audio
          </button>
        )}
        <output className="status">{status}</output>
      </header>

      {blocked && (
        <output className="notice" data-testid="preset-notice">
          {blocked}{" "}
          <button type="button" onClick={() => setBlocked(null)}>
            Dismiss
          </button>
        </output>
      )}

      {notice && (
        <output className="notice">
          {notice}{" "}
          <button type="button" onClick={dismissNotice}>
            Dismiss
          </button>
        </output>
      )}

      <div className="stage">
        <Library
          catalog={catalog}
          presets={presets}
          onLoad={(p) => {
            const missing = missingModules(p, catalog);
            if (missing.length > 0) {
              setBlocked(`Cannot load ${p.name}: this rig is missing ${missing.join(", ")}.`);
              return;
            }
            setBlocked(null);
            edit(() => slotsOf(p));
            select(null);
          }}
          onAdd={(id) =>
            edit((s) => [...s, { id: crypto.randomUUID(), module: id, bypass: false, params: {} }])
          }
        />
        <div className="work">
          <Board
            catalog={catalog}
            slots={slots}
            faults={faults}
            tap={tapAt}
            selected={selectedDef ? selectedId : null}
            onSelect={select}
            onTap={setTap}
            edit={edit}
          />
          {selectedDef && selectedSlot && (
            <Inspector def={selectedDef} slot={selectedSlot} rig={rig} />
          )}
          <Scope rig={rig} label={tapLabel(catalog, slots, tapAt)} />
        </div>
      </div>
      <footer className="engine">
        <dl>
          <dt>Sample rate</dt>
          <dd>{rig ? `${rig.sampleRate} Hz, 128-frame blocks` : "-"}</dd>
          <dt>Browser-reported latency</dt>
          <dd>{rig ? `${rig.latencyMs.toFixed(1)} ms (estimate)` : "-"}</dd>
          <dt>Loopback round trip</dt>
          <dd>
            {loop}{" "}
            <button
              type="button"
              disabled={!rig}
              onClick={() => {
                setLoop("measuring...");
                rig?.probe();
              }}
            >
              Measure
            </button>
          </dd>
          <dt>CPU headroom</dt>
          <dd>{headroom ? `${headroom.toFixed(1)}x real time` : "-"}</dd>
          <dt>Frame rate</dt>
          <dd data-testid="fps">
            {rig
              ? `${perf.fps.toFixed(0)} fps average, ${perf.underruns ?? "?"} audio dropout(s)`
              : "-"}
          </dd>
          <dt>Daemon</dt>
          <dd data-testid="daemon">
            {link === "standalone" && "standalone (no daemon): edits stay in this tab"}
            {link === "connected" &&
              `connected: board "${board.name}" rev ${board.rev}, ${slots.length} pedal(s)`}
            {link === "offline" && "daemon unreachable: edits are not being saved"}
          </dd>
        </dl>
      </footer>
    </main>
  );
}

declare global {
  interface Window {
    __rigStats?: () => { fps: number; underruns: number | null };
    __rigOffline?: (clip: number[], slots: import("@rig/shared").Slot[]) => Promise<number[]>;
    __rig?: {
      ready: boolean;
      headroom: number;
      level: (freq: number) => number;
      pair: typeof pairLevels;
    };
  }
}
