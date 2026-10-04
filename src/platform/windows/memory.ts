import koffi from 'koffi';
import { CloseHandle, OpenProcess } from './win32';

/**
 * Hands the memory a process is not using right now back to Windows (its working set is
 * emptied; pages it touches again come straight back). RigReady does this for its own
 * processes while it sits in the tray, so that an idle RigReady does not hold memory a
 * simulator could use. Nothing is lost and nothing is written to disk by this call.
 */

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_SET_QUOTA = 0x0100;

let emptyWorkingSet: ((handle: bigint | number) => number) | undefined;

function binding(): (handle: bigint | number) => number {
  // psapi's EmptyWorkingSet has lived in kernel32 as K32EmptyWorkingSet since Windows 7.
  emptyWorkingSet ??= koffi
    .load('kernel32.dll')
    .func('int32_t K32EmptyWorkingSet(intptr_t process)') as (handle: bigint | number) => number;
  return emptyWorkingSet;
}

/** Trims the given processes; returns how many were trimmed. Never throws. */
export function trimWorkingSets(pids: number[]): number {
  let trimmed = 0;
  for (const pid of pids) {
    try {
      const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA, 0, pid) as
        bigint | number;
      if (!handle || BigInt(handle) === 0n) continue;
      try {
        if (binding()(handle) !== 0) trimmed++;
      } finally {
        CloseHandle(handle);
      }
    } catch {
      // A process that has just ended, or one Windows will not open: nothing to trim.
    }
  }
  return trimmed;
}
