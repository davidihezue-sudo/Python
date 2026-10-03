"use client";
// Live calculators: posts the form to a stateless endpoint a moment after the person stops typing.
import * as React from "react";
import { finApi, useFin } from "./provider";

export function useCalc<T = any>(path: string, body: unknown | null) {
  const { hid } = useFin();
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const key = JSON.stringify(body);
  React.useEffect(() => {
    if (!body || !hid) { setData(null); return; }
    let live = true;
    setBusy(true);
    const t = setTimeout(async () => {
      try { const r = await finApi<T>(hid, path, { method: "POST", body }); if (live) { setData(r); setError(null); } }
      catch (e) { if (live) { setError((e as Error).message); setData(null); } }
      finally { if (live) setBusy(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [key, hid, path]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, busy };
}

/** Number text box state that tolerates empty input while typing. */
export const num = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));
