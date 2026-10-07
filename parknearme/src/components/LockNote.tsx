import { Lock } from 'lucide-react';
import { Link } from 'wouter';

/** Shown next to admin-only controls while admin is locked. */
export function LockNote({ text = 'Unlock in Settings' }: { text?: string }) {
  return (
    <span className="lock-note">
      <Lock size={13} strokeWidth={2.4} aria-hidden="true" />
      <span>
        Admin only · <Link href="/settings">{text}</Link>
      </span>
    </span>
  );
}
