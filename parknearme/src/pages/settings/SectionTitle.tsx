import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/** Group title with a lock glyph while admin is locked. */
export function SectionTitle({ id, locked, children }: { id: string; locked?: boolean; children: ReactNode }) {
  return (
    <h2 className="group-title" id={id}>
      {children}
      {locked && <Lock size={11} strokeWidth={2.6} className="group-lock" aria-label="Admin only" />}
    </h2>
  );
}
