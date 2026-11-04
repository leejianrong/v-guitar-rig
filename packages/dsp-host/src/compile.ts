import type { ParamSpec } from "@rig/shared";
import { BLOCK } from "./chain";
import type { ModuleDef, Processor } from "./modules";
import { ModuleError } from "./render";

const ID = /^[a-z][a-z0-9-]{0,40}@[1-9][0-9]{0,3}$/;
const CATEGORIES = new Set(["drive", "time", "mod", "dynamics", "amp", "cab"]);
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
 * A separate JavaScript realm (for example a `node:vm` context) in which untrusted source runs. It shares
 * no objects with the host: a buffer or object created in the host would hand the module a route back to
 * the host's globals (`input.constructor.constructor("return process")()`), so everything the module sees
 * is made by the realm, and the host copies data in and out.
 */
export interface Realm {
  evaluate(code: string): unknown;
  newFloat32(length: number): Float32Array;
  newParams(): Record<string, number>;
}

const message = (e: unknown) =>
  String((e as { message?: unknown } | null)?.message ?? e).slice(0, 300);

/**
 * Turn module source text into a `ModuleDef`. The source is a function body that returns
 * `{ id, name, category, description, params, create(sampleRate) { return { process(input, output, p) } } }`.
 *
 * This RUNS the source. Untrusted source must be given a `realm` and be compiled in the sandbox process
 * (ADR-0004); without one it runs in the caller's own realm, which is for trusted code and tests only.
 */
export function compileModule(source: string, realm?: Realm): ModuleDef {
  let spec: Record<string, unknown>;
  try {
    spec = realm
      ? (realm.evaluate(`(function () {\n"use strict";\n${source}\n})()`) as typeof spec)
      : new Function(`"use strict";\n${source}`)();
  } catch (e) {
    return bad("(source)", `does not compile: ${message(e)}`);
  }
  const id = typeof spec?.id === "string" ? spec.id : "(source)";
  if (typeof spec !== "object" || spec === null) bad(id, "source must return the module object");
  if (!ID.test(id)) bad(id, 'id must look like "tape-echo@1"');
  if (typeof spec.name !== "string" || !spec.name) bad(id, "needs a name");
  if (typeof spec.description !== "string") bad(id, "needs a description");
  if (!CATEGORIES.has(spec.category as string))
    bad(id, "category must be drive, time, mod, dynamics, amp or cab");
  // plain data copied into the host, so no object of the realm's is kept
  const params = JSON.parse(JSON.stringify(spec.params ?? null)) as ParamSpec[];
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
    create: (sr) => {
      const proc = create(sr);
      if (!realm) return proc;
      const [inp, out, p] = [realm.newFloat32(BLOCK), realm.newFloat32(BLOCK), realm.newParams()];
      return {
        process(input, output, params) {
          inp.set(input);
          Object.assign(p, params);
          proc.process(inp, out, p);
          output.set(out);
        },
      };
    },
  };
}
