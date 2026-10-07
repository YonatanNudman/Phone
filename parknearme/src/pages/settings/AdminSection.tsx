// Admin unlock: the token is checked against the server before it's stored on this device.

import { KeyRound, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api';
import { toast } from '../../lib/toast';

interface Props {
  isAdmin: boolean;
  unlock: (token: string) => Promise<void>;
  lock: () => void;
}

function unlockError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "That token didn't work.";
    if (err.status === 503) return 'Admin is not set up on the server (ADMIN_TOKEN secret).';
    return err.message;
  }
  return err instanceof Error ? err.message : 'Could not unlock.';
}

export function AdminSection({ isAdmin, unlock, lock }: Props) {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setError(null);
    try {
      await unlock(token);
      setToken('');
      toast('Admin unlocked');
    } catch (err) {
      setError(unlockError(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="section" aria-labelledby="sec-admin">
      <h2 className="group-title" id="sec-admin">
        Admin
      </h2>
      <div className="group">
        {isAdmin ? (
          <div className="row has-icon">
            <span className="row-icon tone-green" aria-hidden="true">
              <ShieldCheck size={17} />
            </span>
            <span className="row-label">
              Admin unlocked
              <small>Calibration, camera setup and settings are enabled on this device</small>
            </span>
            <button
              type="button"
              className="btn btn-plain btn-sm"
              onClick={() => {
                lock();
                toast('Admin locked', 'info');
              }}
            >
              Lock
            </button>
          </div>
        ) : (
          <form className="row has-icon admin-form" onSubmit={submit}>
            <span className="row-icon tone-gray" aria-hidden="true">
              <KeyRound size={17} />
            </span>
            <label className="sr-only" htmlFor="admin-token">
              Admin token
            </label>
            <input
              id="admin-token"
              className="field"
              type="password"
              autoComplete="current-password"
              placeholder="Admin token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'admin-error' : undefined}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={checking || !token.trim()}>
              {checking ? 'Checking…' : 'Unlock'}
            </button>
          </form>
        )}
      </div>
      {error ? (
        <p className="group-footer is-error" id="admin-error" role="alert">
          {error}
        </p>
      ) : (
        !isAdmin && <p className="group-footer">The ADMIN_TOKEN secret set on the Worker. Stored only on this device.</p>
      )}
    </section>
  );
}
