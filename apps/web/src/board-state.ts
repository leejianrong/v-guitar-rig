import type { Board, Slot } from "@rig/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const STANDALONE: Board = {
  schema: 1,
  id: "default",
  name: "Standalone board",
  rev: 0,
  slots: [{ id: "s-clipper", module: "diode-clipper@1", bypass: false, params: {} }],
};

export type Link = "standalone" | "connected" | "offline";

const token = () => document.querySelector<HTMLMetaElement>('meta[name="rig-token"]')?.content;

/**
 * The board being edited. With a daemon it loads from it, saves edits (a stale save adopts the daemon's
 * copy and says so) and follows changes made elsewhere, such as the agent's. Without one it stays local.
 */
export function useBoard() {
  const [board, setBoard] = useState<Board>(STANDALONE);
  const [link, setLink] = useState<Link>("standalone");
  const [notice, setNotice] = useState<string | null>(null);
  const [changeTick, setChangeTick] = useState(0); // bumps when the daemon stores a module or preset
  const cur = useRef(board);
  const dirty = useRef(false);
  const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  cur.current = board;

  const flush = useCallback(async () => {
    const t = token();
    if (!t || saving.current || !dirty.current) return;
    saving.current = true;
    dirty.current = false;
    try {
      const sent = cur.current;
      const res = await fetch(`/api/boards/${sent.id}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${t}`, "content-type": "application/json" },
        body: JSON.stringify({ expectedRev: sent.rev, board: sent }),
      });
      const body = await res.json();
      if (res.ok) setBoard((b) => ({ ...b, rev: body.rev }));
      else if (res.status === 409) {
        dirty.current = false;
        setBoard(body.current);
        setNotice(
          "The board was changed elsewhere, so your last edit was not saved. Showing the latest.",
        );
      } else setNotice(`Could not save: ${body.error ?? res.status}`);
      setLink("connected");
    } catch {
      setLink("offline");
    } finally {
      saving.current = false;
      if (dirty.current) void flush();
    }
  }, []);

  useEffect(() => {
    const t = token();
    if (!t) return;
    const headers = { authorization: `Bearer ${t}` };
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/boards/default", { headers });
        if (!res.ok) throw new Error(String(res.status));
        setBoard(await res.json());
        setLink("connected");
        const events = await fetch("/api/events", { headers, signal: abort.signal });
        const reader = (events.body as ReadableStream<Uint8Array>).getReader();
        const dec = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
            const lines = buf.slice(0, i).split("\n");
            const line = lines.find((l) => l.startsWith("data: "));
            buf = buf.slice(i + 2);
            if (lines.includes("event: modules") || lines.includes("event: presets")) {
              setChangeTick((t) => t + 1);
              continue;
            }
            if (!line || dirty.current) continue;
            const next = JSON.parse(line.slice(6)) as Board;
            if (next.rev > cur.current.rev) setBoard(next);
          }
        }
      } catch {
        if (!abort.signal.aborted) setLink("offline");
      }
    })();
    return () => abort.abort();
  }, []);

  const edit = useCallback(
    (fn: (slots: Slot[]) => Slot[]) => {
      setBoard((b) => ({ ...b, slots: fn(b.slots) }));
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 150);
    },
    [flush],
  );

  return { board, link, notice, changeTick, dismissNotice: () => setNotice(null), edit };
}
