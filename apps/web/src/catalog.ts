import { MODULES, type ModuleInfo, STARTER_PRESETS, STARTER_RIFFS } from "@rig/dsp-host";
import type { Preset, Riff, Slot } from "@rig/shared";
import { useEffect, useState } from "react";

/** Every module the page can show by id. Built-ins carry code; stored modules are metadata only. */
export type Catalog = Record<string, ModuleInfo>;

const BUILTIN: Catalog = MODULES;

/**
 * Built-ins plus the modules stored in the daemon, and the source of each stored one for the audio
 * worklet to compile. The page never runs that source itself: it holds the daemon token.
 */
export function useCatalog(connected: boolean, tick: number) {
  const [stored, setStored] = useState<{ catalog: Catalog; sources: string[] }>({
    catalog: {},
    sources: [],
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the trigger to fetch again
  useEffect(() => {
    const token = document.querySelector<HTMLMetaElement>('meta[name="rig-token"]')?.content;
    if (!connected || !token) return;
    const headers = { authorization: `Bearer ${token}` };
    let live = true;
    (async () => {
      try {
        const list = await (await fetch("/api/modules", { headers })).json();
        const infos = (list.modules as (ModuleInfo & { kind: string })[]).filter(
          (m) => m.kind === "stored",
        );
        const sources = await Promise.all(
          infos.map(async (m) => {
            const res = await fetch(`/api/modules/${encodeURIComponent(m.id)}`, { headers });
            return ((await res.json()) as { source: string }).source;
          }),
        );
        if (live) setStored({ catalog: Object.fromEntries(infos.map((m) => [m.id, m])), sources });
      } catch {
        // the daemon went away; keep what is already loaded
      }
    })();
    return () => {
      live = false;
    };
  }, [connected, tick]);
  return { catalog: { ...BUILTIN, ...stored.catalog }, sources: stored.sources };
}

/** A list the daemon keeps (`GET /api/<name>` answers `{ <name>: [...] }`): the shipped items until it is reachable. */
function useDaemonList<T>(name: string, shipped: T[], connected: boolean, tick: number): T[] {
  const [items, setItems] = useState<T[]>(shipped);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the trigger to fetch again
  useEffect(() => {
    const token = document.querySelector<HTMLMetaElement>('meta[name="rig-token"]')?.content;
    if (!connected || !token) return;
    let live = true;
    fetch(`/api/${name}`, { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((body: Record<string, T[]>) => live && setItems(body[name] as T[]))
      .catch(() => {}); // keep the list we have
    return () => {
      live = false;
    };
  }, [name, connected, tick]);
  return items;
}

export const usePresets = (connected: boolean, tick: number) =>
  useDaemonList<Preset>("presets", STARTER_PRESETS, connected, tick);

export const useRiffs = (connected: boolean, tick: number) =>
  useDaemonList<Riff>("riffs", STARTER_RIFFS, connected, tick);

/** Modules a preset uses that this page cannot show, so loading it would leave holes. */
export const missingModules = (preset: Preset, catalog: Catalog): string[] => [
  ...new Set(preset.slots.map((s) => s.module).filter((m) => !catalog[m])),
];

/** A preset's slots as new slots for the board: same modules and knobs, fresh ids. */
export const slotsOf = (preset: Preset): Slot[] =>
  preset.slots.map((s) => ({ ...s, id: crypto.randomUUID(), params: { ...s.params } }));
