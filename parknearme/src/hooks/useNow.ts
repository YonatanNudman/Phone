import { useEffect, useState } from 'react';

/** Current time (ms), re-rendering every `intervalMs`. Drives "Updated 24 sec ago" labels. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
