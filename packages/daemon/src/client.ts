import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface Reply {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/** A caller for a running daemon. The token comes from `RIG_TOKEN`, else from `<rigDir>/.rig/token`. */
export function daemonClient(base: string, rigDir: string, envToken: string | undefined) {
  return async (method: string, path: string, body?: unknown): Promise<Reply> => {
    let token = envToken;
    if (!token) {
      try {
        token = readFileSync(join(rigDir, ".rig", "token"), "utf8").trim();
      } catch {
        throw new Error("no token: set RIG_TOKEN or point --rig-dir at the daemon's rig directory");
      }
    }
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
}
