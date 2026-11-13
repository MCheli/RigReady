import { describe, expect, it } from 'vitest';
import { forgetPsModulePath, windowsPowerShellEnv } from './windowsPowerShell';

describe('starting Windows PowerShell without PowerShell 7 module path', () => {
  it('a copy of the environment without PSModulePath in any case, the rest kept, the original untouched', () => {
    const env = {
      Path: 'C:\\Windows',
      PSModulePath: 'C:\\pwsh\\Modules',
      psmodulepath: 'x',
      A: '1',
    };
    expect(windowsPowerShellEnv(env)).toEqual({ Path: 'C:\\Windows', A: '1' });
    expect(env.PSModulePath).toBe('C:\\pwsh\\Modules');
  });

  it('or removed from the environment itself, for every program the process starts', () => {
    const env: NodeJS.ProcessEnv = { PSMODULEPATH: 'C:\\pwsh\\Modules', Path: 'C:\\Windows' };
    forgetPsModulePath(env);
    expect(env).toEqual({ Path: 'C:\\Windows' });
    forgetPsModulePath(env);
    expect(env).toEqual({ Path: 'C:\\Windows' });
  });
});
