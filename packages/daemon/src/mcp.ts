import { createInterface } from "node:readline";
import type { Reply } from "./client";

type Call = (method: string, path: string, body?: unknown) => Promise<Reply>;
type Args = Record<string, unknown>;

/** The agent workflow, served as the `build-a-pedal` prompt. */
export const WORKFLOW = `You are building a guitar pedal for a virtual rig by writing its DSP in JavaScript.

Module source is the BODY of a function that returns the module object:

  return {
    id: "warm-drive@1",            // lowercase-with-dashes@version, at most 41 chars before @
    name: "Warm Drive",
    category: "drive",             // drive | time | mod | dynamics | amp | cab
    description: "Soft saturation.",
    params: [                      // at most 12; every field is required
      { id: "drive", label: "Drive", min: 1, max: 20, default: 4, unit: "x", taper: "log" } // taper: linear | log (min > 0) | audio
    ],
    create(sampleRate) {
      let state = 0;               // per-instance memory lives here
      return {
        process(input, output, p) { // exactly 128 samples per call; p.drive is the current knob value
          for (let i = 0; i < input.length; i++) output[i] = Math.tanh(input[i] * p.drive) / Math.tanh(p.drive);
        },
      };
    },
  };

There is no process, require, fetch, import, DOM or Date; only the language's own built-ins (Math, typed arrays such as Float32Array). Allocate buffers in create(), never in process().

Workflow:
1. list_modules to see what exists. Reuse a built-in id only as a reference; pick a new id.
2. Write the source and call new_module. A failure gives the reason (compile error, NaN or Inf, output growing without bound, too slow, throwing). Fix that and call new_module again; replacing an id needs expectedRev from get_module.
3. get_board, add your module to slots, and render that board object to try it without saving; call set_board once you want it kept. A slot is {id: <any unique string>, module: <module id>, bypass: false, params: {}}. The board object's own rev is used as expectedRev unless you pass one; on a stale rev, get_board again.
4. render the board and read the descriptors, which describe the whole board's output, not your pedal alone. To judge one pedal, render once with it bypassed (a copy of the board with bypass: true) and once active, and compare.
   Descriptors: rmsDb, peakDb, crestDb (peak minus rms); centroidHz (spectral centre, lower = darker); rolloffHz (below it lies 85% of the energy); bandsDb in dB relative to the total over low 20-200 Hz, lowMid 200-800, mid 800-3k, high 3k-8k, air 8k+; thdPercent (energy at harmonics 2-8 of a 110 Hz tone, so a drive raises it, and a comb-like delay or chorus changes it too, so only trust it for drive). Expected moves: more drive raises thdPercent and lowers crestDb; a darker tone lowers centroidHz and the high and air bands; more wet delay or reverb raises rmsDb and may raise crestDb as echoes add to peaks. Adjust params or code and repeat.
Output must stay finite and at or below 8x full scale on the gate's tests (impulse, noise, square, DC, at default, minimum and maximum knobs), and not grow over time, or the module is rejected. A master limiter is always on.`;

const obj = (properties: Args, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const str = (description: string) => ({ type: "string", description });

const TOOLS = [
  {
    name: "list_modules",
    description: "Every module available: built-ins and stored ones, with params.",
    inputSchema: obj({}),
  },
  {
    name: "get_module",
    description: "A stored module's info (rev, sha256) and source.",
    inputSchema: obj({ id: str("module id, e.g. warm-drive@1") }, ["id"]),
  },
  {
    name: "new_module",
    description:
      "Add or replace a module from source (see the build-a-pedal prompt). It is compiled and safety-gated in a sandbox first and is stored only if it passes.",
    inputSchema: obj(
      {
        source: str("function body returning the module object"),
        expectedRev: { type: "number", description: "required when replacing an existing id" },
      },
      ["source"],
    ),
  },
  {
    name: "check_module",
    description: "Re-run the safety gate on a stored module.",
    inputSchema: obj({ id: str("module id") }, ["id"]),
  },
  {
    name: "get_board",
    description: "A board: its slots in signal order, and its rev.",
    inputSchema: obj({ id: str('board id, default "default"') }),
  },
  {
    name: "set_board",
    description:
      "Save a board (the whole object, as from get_board). expectedRev must equal the current rev. The open UI follows the change.",
    inputSchema: obj(
      { board: { type: "object", description: "the full board" }, expectedRev: { type: "number" } },
      ["board"],
    ),
  },
  {
    name: "list_presets",
    description: "Saved presets: a board's slots plus name, description and tags.",
    inputSchema: obj({}),
  },
  {
    name: "get_preset",
    description: "One preset with its slots.",
    inputSchema: obj({ id: str("preset id") }, ["id"]),
  },
  {
    name: "set_preset",
    description:
      "Save a preset (id, name, description, 1-16 tags such as artist:name, era:70s, dreamy, and slots). expectedRev is 0 for a new one, else its current rev.",
    inputSchema: obj({ preset: { type: "object" }, expectedRev: { type: "number" } }, ["preset"]),
  },
  {
    name: "render",
    description:
      "Render a board over a guitar-like test clip and return level, peak and descriptors: rmsDb, peakDb, crestDb, centroidHz, rolloffHz, bandsDb, thdPercent.",
    inputSchema: obj({
      board: {
        description:
          'a saved board id (default "default"), or a whole board object to try without saving it',
      },
      seconds: { type: "number", description: "0.1 to 30, default 2" },
    }),
  },
];

const route = (name: string, a: Args): [string, string, unknown?] | null => {
  const id = encodeURIComponent(String(a.id ?? ""));
  switch (name) {
    case "list_modules":
      return ["GET", "/api/modules"];
    case "get_module":
      return ["GET", `/api/modules/${id}`];
    case "new_module":
      return ["POST", "/api/modules", { source: a.source, expectedRev: a.expectedRev }];
    case "check_module":
      return ["POST", `/api/modules/${id}/check`];
    case "get_board":
      return ["GET", `/api/boards/${encodeURIComponent(String(a.id ?? "default"))}`];
    case "set_board": {
      const board = a.board as { id?: string; rev?: number };
      return [
        "PUT",
        `/api/boards/${encodeURIComponent(String(board?.id ?? "default"))}`,
        { expectedRev: a.expectedRev ?? board?.rev, board },
      ];
    }
    case "list_presets":
      return ["GET", "/api/presets"];
    case "get_preset":
      return ["GET", `/api/presets/${id}`];
    case "set_preset": {
      const preset = a.preset as { id?: string; rev?: number };
      return [
        "PUT",
        `/api/presets/${encodeURIComponent(String(preset?.id ?? ""))}`,
        { expectedRev: a.expectedRev ?? preset?.rev ?? 0, preset },
      ];
    }
    case "render":
      return ["POST", "/api/render", { board: a.board, seconds: a.seconds }];
    default:
      return null;
  }
};

/** Answer one JSON-RPC message; undefined for notifications. */
export async function handle(call: Call, msg: { id?: unknown; method: string; params?: Args }) {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const fail = (code: number, message: string) => ({
    jsonrpc: "2.0",
    id: msg.id,
    error: { code, message },
  });
  if (msg.id === undefined) return undefined;
  const p = msg.params ?? {};
  switch (msg.method) {
    case "initialize":
      return reply({
        protocolVersion: (p.protocolVersion as string) ?? "2025-06-18",
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: "v-guitar-rig", version: "0.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "prompts/list":
      return reply({
        prompts: [
          { name: "build-a-pedal", description: "How to write, test and play a new pedal." },
        ],
      });
    case "prompts/get":
      return p.name === "build-a-pedal"
        ? reply({
            messages: [{ role: "user", content: { type: "text", text: WORKFLOW } }],
          })
        : fail(-32602, `no prompt ${String(p.name)}`);
    case "tools/call": {
      const r = route(String(p.name), (p.arguments as Args) ?? {});
      if (!r) return fail(-32602, `no tool ${String(p.name)}`);
      let text: string;
      let isError = false;
      try {
        const res = await call(...r);
        // a rejected module or stale rev is the model's to fix, so it goes back as a tool result
        isError = !res.ok;
        text = JSON.stringify(isError ? { status: res.status, ...res.body } : res.body);
      } catch (e) {
        isError = true;
        text = e instanceof Error ? e.message : String(e);
      }
      return reply({ content: [{ type: "text", text }], isError });
    }
    default:
      return fail(-32601, `unknown method ${msg.method}`);
  }
}

/** Serve MCP over stdio (one JSON message per line) until stdin closes. */
export async function runMcp(call: Call): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let out: unknown;
    try {
      out = await handle(call, JSON.parse(line));
    } catch {
      out = { jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } };
    }
    if (out) process.stdout.write(`${JSON.stringify(out)}\n`);
  }
}
