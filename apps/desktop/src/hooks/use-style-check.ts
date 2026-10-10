import { useEffect, useRef, useState } from 'react';
import { post } from '../lib/api';
import type { StyleReport } from '../lib/types';

const checkText = (text: string) => post<StyleReport>('/style/check', { text });

/**
 * Check prose against the style sheet shortly after typing stops. Answers that arrive after a
 * newer check started (or after unmount) are dropped. Failures are quiet: the marks just stay.
 */
export function useStyleCheck(text: string, sheetKey: unknown, { check = checkText, delay = 450 }: { check?: (text: string) => Promise<StyleReport>; delay?: number } = {}) {
  const [report, setReport] = useState<StyleReport | null>(null);
  const seq = useRef(0);
  const checkRef = useRef(check);
  checkRef.current = check;

  useEffect(() => {
    const n = ++seq.current;
    if (!text.trim()) {
      setReport(null);
      return;
    }
    const t = setTimeout(() => {
      checkRef.current(text).then(
        (r) => void (n === seq.current && setReport(r)),
        () => undefined,
      );
    }, delay);
    return () => clearTimeout(t);
  }, [text, sheetKey, delay]);

  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  return report;
}
