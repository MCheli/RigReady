import type { Contract } from '../shared/ipc';

/**
 * Every IPC contract the app wired, as data: which features there are, which channels each
 * has, and the schemas of each. Filled by the bootstrap as it binds the features' handlers,
 * so by the time anything reads it (the MCP server, a diagnostics page) every feature's
 * setup has run. Nothing here calls a channel; `MainContext.invoke` does that.
 */
export class ContractRegistry {
  private readonly contracts = new Map<string, Contract>();

  register(contract: Contract): void {
    if (this.contracts.has(contract.feature)) {
      throw new Error(`Contract registered twice: ${contract.feature}`);
    }
    this.contracts.set(contract.feature, contract);
  }

  /** Every contract, in the order they were wired (features sorted by folder name). */
  all(): Contract[] {
    return [...this.contracts.values()];
  }

  get(feature: string): Contract | undefined {
    return this.contracts.get(feature);
  }
}
