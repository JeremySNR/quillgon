import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { deepEqual } from '../lib/util';

/**
 * A local, editable copy of a server value. When the server value changes (saved here, or
 * changed elsewhere), the draft follows it only if the user has not edited it; edits are never
 * overwritten by a refresh. `dirty` is memoised, not recomputed on every render.
 */
export function useDraft<T>(server: T, equal: (a: T, b: T) => boolean = deepEqual) {
  const [value, setValue] = useState<T>(server);
  const valueRef = useRef(value);
  valueRef.current = value;
  /** The server value the draft was last in step with. */
  const base = useRef(server);

  useEffect(() => {
    const prev = base.current;
    if (equal(prev, server)) return;
    base.current = server;
    if (equal(valueRef.current, prev)) setValue(server);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server]);

  const dirty = useMemo(() => !equal(value, server), [value, server, equal]);
  const set = useCallback((v: SetStateAction<T>) => setValue(v), []);
  const reset = useCallback(() => setValue(base.current), []);

  return { value, set, dirty, reset };
}
