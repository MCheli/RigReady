import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { JsonStore } from '../../../core/jsonStore';
import type { Clock } from '../../../core/ports';
import { err, ok, type Result } from '../../../core/result';
import type { McpStoreSchema, Pairing } from './store';

/**
 * Who may talk to the server. A pairing is a name and a token: the name is what a change
 * made through that assistant is recorded under, the token is what its requests carry
 * (`Authorization: Bearer ...`). Only the hash of a token is kept; an HTTP client's token
 * is shown once, when it is made. The bridge (RigReady.exe --mcp) has a pairing of its own
 * whose token is in a file of its own under the data root, where the bridge, running as the same
 * Windows user, reads it.
 */

/** Where the bridge's token is kept (a file under the data root, outside mcp.json). */
export interface BridgeTokenStore {
  read(): Promise<Result<string | undefined>>;
  write(token: string): Promise<Result<void>>;
}
export const BRIDGE_PAIRING_NAME = 'RigReady.exe --mcp (stdio bridge)';

const TOKEN_PREFIX = 'rr_';

export function newToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** What a request may carry; anything else is refused before it is even hashed. */
export const TOKEN_PATTERN = /^rr_[0-9a-f]{64}$/;

export interface PairingMatch {
  id: string;
  name: string;
  kind: Pairing['kind'];
}

/** The pairing a bearer token belongs to, compared in constant time; undefined for a stranger. */
export function matchToken(pairings: Pairing[], token: string): PairingMatch | undefined {
  if (!TOKEN_PATTERN.test(token)) return undefined;
  const hash = Buffer.from(hashToken(token), 'hex');
  for (const pairing of pairings) {
    const known = Buffer.from(pairing.tokenHash, 'hex');
    if (known.length === hash.length && timingSafeEqual(known, hash)) {
      return { id: pairing.id, name: pairing.name, kind: pairing.kind };
    }
  }
  return undefined;
}

export class Pairings {
  constructor(
    private readonly store: JsonStore<typeof McpStoreSchema>,
    private readonly bridgeToken: BridgeTokenStore,
    private readonly clock: Clock
  ) {}

  async list(): Promise<Result<Pairing[]>> {
    const data = await this.store.read();
    return data.ok ? ok(data.value.pairings) : data;
  }

  /** Pairs an HTTP client under a name. The token comes back once and is not kept. */
  async pairHttp(name: string): Promise<Result<{ pairing: Pairing; token: string }>> {
    const trimmed = name.trim();
    if (trimmed.length === 0) return err('mcp.name', 'Give the assistant a name.');
    const token = newToken();
    const pairing: Pairing = {
      id: `p-${randomBytes(6).toString('hex')}`,
      name: trimmed,
      kind: 'http',
      tokenHash: hashToken(token),
      createdAt: this.clock.now().toISOString(),
      calls: 0,
    };
    const saved = await this.store.update((data) => ({
      ...data,
      pairings: [...data.pairings, pairing],
    }));
    if (!saved.ok) return saved;
    return ok({ pairing, token });
  }

  /**
   * Makes sure the bridge has a pairing and a token in the secrets store, and that the two
   * agree. Called when the server is enabled and when the bridge's token is rotated.
   */
  async ensureBridge(options: { rotate?: boolean } = {}): Promise<Result<Pairing>> {
    const data = await this.store.read();
    if (!data.ok) return data;
    const existing = data.value.pairings.find((p) => p.kind === 'bridge');
    const stored = await this.bridgeToken.read();
    if (!stored.ok) return stored;
    const agree =
      existing && stored.value !== undefined && hashToken(stored.value) === existing.tokenHash;
    if (agree && !options.rotate) return ok(existing);
    const token = newToken();
    const kept = await this.bridgeToken.write(token);
    if (!kept.ok) return kept;
    const pairing: Pairing = {
      id: existing?.id ?? `bridge-${randomBytes(6).toString('hex')}`,
      name: BRIDGE_PAIRING_NAME,
      kind: 'bridge',
      tokenHash: hashToken(token),
      createdAt: existing?.createdAt ?? this.clock.now().toISOString(),
      calls: existing?.calls ?? 0,
    };
    const saved = await this.store.update((current) => ({
      ...current,
      pairings: [...current.pairings.filter((p) => p.kind !== 'bridge'), pairing],
    }));
    if (!saved.ok) return saved;
    return ok(pairing);
  }

  /** Forgets a pairing: its token stops working at once. The bridge's is remade, not removed. */
  async revoke(id: string): Promise<Result<{ removed: boolean }>> {
    const data = await this.store.read();
    if (!data.ok) return data;
    const target = data.value.pairings.find((p) => p.id === id);
    if (!target) return ok({ removed: false });
    if (target.kind === 'bridge') {
      const remade = await this.ensureBridge({ rotate: true });
      return remade.ok ? ok({ removed: true }) : remade;
    }
    const saved = await this.store.update((current) => ({
      ...current,
      pairings: current.pairings.filter((p) => p.id !== id),
    }));
    return saved.ok ? ok({ removed: true }) : saved;
  }

  /** Who a token belongs to. Reads the store each time, so a pairing revoked on the page is gone at once. */
  async identify(token: string): Promise<PairingMatch | undefined> {
    const data = await this.store.read();
    if (!data.ok) return undefined;
    return matchToken(data.value.pairings, token);
  }

  /** Records a call under a pairing. Best effort: a failure to write is not the call's problem. */
  async noteCall(id: string): Promise<void> {
    await this.store.update((current) => ({
      ...current,
      pairings: current.pairings.map((p) =>
        p.id === id ? { ...p, lastUsedAt: this.clock.now().toISOString(), calls: p.calls + 1 } : p
      ),
    }));
  }
}
