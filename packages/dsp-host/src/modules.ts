import { DIODE_CLIPPER } from "./core";

export interface ModuleDef {
  netlist: string;
  oversample: number;
}

/** Built-in circuit modules. Behavioral and capture modules join in V3/V7. */
export const MODULES: Record<string, ModuleDef> = {
  "diode-clipper@1": { netlist: DIODE_CLIPPER, oversample: 4 },
};

export const KNOWN_MODULES: ReadonlySet<string> = new Set(Object.keys(MODULES));
