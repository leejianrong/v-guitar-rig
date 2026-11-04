import type { ParamSpec } from "@rig/shared";
import type { ModuleDef, Processor } from "./modules";
import { ModuleError } from "./render";

const ID = /^[a-z][a-z0-9-]{0,40}@[1-9][0-9]{0,3}$/;
const CATEGORIES = new Set(["drive", "time", "mod", "dynamics"]);
const TAPERS = new Set(["linear", "log", "audio"]);
const MAX_PARAMS = 12;

const bad = (id: string, why: string): never => {
  throw new ModuleError(id, why);
};

function checkParam(id: string, p: ParamSpec, seen: Set<string>) {
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (typeof p?.id !== "string" || !/^[a-z][a-zA-Z0-9]{0,23}$/.test(p.id))
    bad(id, `param id ${JSON.stringify(p?.id)} must be a short camelCase name`);
  if (seen.has(p.id)) bad(id, `duplicate param id "${p.id}"`);
  seen.add(p.id);
  if (typeof p.label !== "string" || !p.label) bad(id, `param "${p.id}" needs a label`);
  if (typeof p.unit !== "string") bad(id, `param "${p.id}" needs a unit (may be empty)`);
  if (!n(p.min) || !n(p.max) || p.min >= p.max) bad(id, `param "${p.id}" needs min < max`);
  if (!n(p.default) || p.default < p.min || p.default > p.max)
    bad(id, `param "${p.id}" default must lie within min and max`);
  if (!TAPERS.has(p.taper)) bad(id, `param "${p.id}" taper must be linear, log or audio`);
  if (p.taper === "log" && p.min <= 0) bad(id, `param "${p.id}" is log-taper, so min must be > 0`);
}

/**
 * Turn module source text into a `ModuleDef`. The source is a function body that returns
 * `{ id, name, category, description, params, create(sampleRate) { return { process(input, output, p) } } }`.
 *
 * This RUNS the source, so it must only be called where untrusted code is allowed to run: inside the
 * sandboxed worker (ADR-0004), never in the daemon's own process.
 */
export function compileModule(source: string): ModuleDef {
  let spec: Record<string, unknown>;
  try {
    spec = new Function(`"use strict";\n${source}`)();
  } catch (e) {
    return bad("(source)", `does not compile: ${e instanceof Error ? e.message : String(e)}`);
  }
  const id = typeof spec?.id === "string" ? spec.id : "(source)";
  if (typeof spec !== "object" || spec === null) bad(id, "source must return the module object");
  if (!ID.test(id)) bad(id, 'id must look like "tape-echo@1"');
  if (typeof spec.name !== "string" || !spec.name) bad(id, "needs a name");
  if (typeof spec.description !== "string") bad(id, "needs a description");
  if (!CATEGORIES.has(spec.category as string))
    bad(id, "category must be drive, time, mod or dynamics");
  const params = spec.params as ParamSpec[];
  if (!Array.isArray(params) || params.length > MAX_PARAMS)
    bad(id, `params must be a list of at most ${MAX_PARAMS}`);
  const seen = new Set<string>();
  for (const p of params) checkParam(id, p, seen);
  if (typeof spec.create !== "function") bad(id, "needs a create(sampleRate) function");
  const create = spec.create as (sr: number) => Processor;
  return {
    id,
    name: spec.name as string,
    category: spec.category as ModuleDef["category"],
    description: spec.description as string,
    params,
    create: (sr) => create(sr),
  };
}
