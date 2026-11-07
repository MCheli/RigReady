/**
 * Bounds the memory a Lua chunk in the sandbox can take (SEC-004).
 *
 * Fengari has no allocation hook, and a worker's heap limit does not help: Lua strings are
 * Uint8Arrays, whose bytes live outside the JavaScript heap (a worker capped at 64 MB of
 * heap allocated 2 GB of Uint8Arrays without complaint). Memory is bounded instead by
 * closing each way a few instructions can allocate a lot:
 *
 * - New string bytes. Every string made by `..`, and every buffer behind string.rep,
 *   table.concat, string.format, gsub, upper and lower, is a `new Uint8Array(n)`. While a
 *   chunk runs, the global Uint8Array is a constructor that adds up those bytes, so
 *   doubling a string or one huge string.rep is refused on the allocation itself, before
 *   the bytes exist.
 * - Copied string bytes. Substrings are copied by fengari through a function bound when it
 *   loaded, which the constructor does not see, so string.sub, match, find and gmatch count
 *   the length of what they return.
 * - The Lua stack. One VARARG or table constructor copies every value passed to it, so a
 *   chunk that piles values on the stack can allocate a lot per instruction. The stack is
 *   held to {@link STACK_SLOTS} slots (Lua's own limit is a million): the hook checks its
 *   size, and table.unpack and string.byte, which fill it in one call, are capped.
 * - Everything else (tables, closures) grows by a bounded amount per instruction, and the
 *   instruction hook measures the heap and the array buffers every {@link CHECK_EVERY}
 *   instructions. Between two measurements the string bytes counted may not pass what is
 *   left of the limit; other growth in that time is at most a few tens of megabytes.
 *
 * Once the limit is passed the guard stays tripped: every further allocation and every
 * hook fails, so a chunk that catches the error with pcall cannot carry on, and the run is
 * reported as refused whatever the chunk returns.
 */

/** Default limit for one evaluation, far above what DCS's largest input defaults use. */
export const MEMORY_LIMIT_MB = 256;
/** Lua stack slots one evaluation may use. DCS's own input defaults use about 160. */
export const STACK_SLOTS = 2000;
/** Instructions between two measurements of the heap. */
export const CHECK_EVERY = 200;

/**
 * Lua run before anything else, with the guard's functions as arguments: `trip` refuses
 * the run, `counted` counts the string bytes among its arguments and returns them.
 */
export const GUARD_PRELUDE = `
local trip, most, counted = ...
local select = select
local function bounded(...)
  if select('#', ...) > most then trip() end
  return ...
end
local unpack, byte = table.unpack, string.byte
table.unpack = function(...) return bounded(unpack(...)) end
string.byte = function(...) return bounded(byte(...)) end
for _, name in ipairs({ 'sub', 'match', 'find' }) do
  local original = string[name]
  string[name] = function(...) return counted(original(...)) end
end
local gmatch = string.gmatch
string.gmatch = function(...)
  local next = gmatch(...)
  return function() return counted(next()) end
end
`;

const NativeUint8Array = Uint8Array;

class MemoryLimitError extends Error {
  constructor() {
    super('memory limit reached');
  }
}

/** The guard in force while a chunk runs; null outside a run. */
let active: MemoryGuard | null = null;
function setActive(guard: MemoryGuard | null): void {
  active = guard;
}

/**
 * Stands in for Uint8Array while a chunk runs. It returns ordinary Uint8Arrays and shares
 * their prototype, so `instanceof Uint8Array` and everything else behave as before.
 */
function CountedUint8Array(this: unknown, a?: unknown, b?: unknown, c?: unknown): Uint8Array {
  // A view on an existing buffer shares its bytes; a length or a list allocates.
  if (active) {
    if (typeof a === 'number') active.allocate(a);
    else if (a && typeof (a as ArrayLike<unknown>).length === 'number')
      active.allocate((a as ArrayLike<unknown>).length);
  }
  return new NativeUint8Array(a as ArrayBuffer, b as number, c as number);
}
CountedUint8Array.prototype = NativeUint8Array.prototype;
Object.setPrototypeOf(CountedUint8Array, NativeUint8Array);

/** Heap and array-buffer bytes, the two places a Lua state's memory lives. */
function used(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed + usage.arrayBuffers;
}

export class MemoryGuard {
  readonly limit: number;
  private baseline = 0;
  /** String bytes that may still be allocated before the next measurement. */
  private room = 0;
  private previous: typeof Uint8Array | null = null;
  private outer: MemoryGuard | null = null;
  /** Set once the limit was passed; never cleared. */
  exceeded = false;

  constructor(limitMb: number = MEMORY_LIMIT_MB) {
    this.limit = limitMb * 1024 * 1024;
  }

  /** Called with each allocation or copy of `bytes` string bytes. */
  allocate(bytes: number): void {
    if (this.exceeded) throw new MemoryLimitError();
    this.room -= bytes;
    if (this.room < 0) this.trip();
  }

  /** From the instruction hook: measures what the chunk holds now. */
  check(stackSlots: number): void {
    if (this.exceeded || stackSlots > STACK_SLOTS) this.trip();
    this.room = this.limit - (used() - this.baseline);
    if (this.room < 0) this.trip();
  }

  trip(): never {
    this.exceeded = true;
    throw new MemoryLimitError();
  }

  /** Starts counting. Synchronous code only: everything until {@link stop} is counted. */
  start(): void {
    this.previous = globalThis.Uint8Array;
    this.outer = active;
    this.baseline = used();
    this.room = this.limit;
    setActive(this);
    globalThis.Uint8Array = CountedUint8Array as unknown as typeof Uint8Array;
  }

  stop(): void {
    if (this.previous) globalThis.Uint8Array = this.previous;
    setActive(this.outer);
    this.previous = null;
    this.outer = null;
  }
}

/** True for the error the guard throws, wherever it surfaced. */
export function isMemoryLimit(e: unknown): boolean {
  return e instanceof MemoryLimitError;
}
