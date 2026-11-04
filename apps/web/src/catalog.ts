import { MODULES, type ModuleInfo } from "@rig/dsp-host";
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
