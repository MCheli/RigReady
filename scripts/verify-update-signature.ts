/**
 * Checks a signed installer the way an installed RigReady checks a downloaded update, with
 * electron-updater's own code (scripts/lib/updateSignature.ts), and fails unless it accepts
 * the installer by the full DN in the publisher names:
 *
 *   npx tsx scripts/verify-update-signature.ts --installer release/RigReady-Setup-<version>.exe
 *     --feed release/win-unpacked/resources/app-update.yml
 *
 * `--feed` is the feed file that holds the publisher names: the one the build put into the
 * package, or resources\app-update.yml of an installed copy. Run by the Release workflow
 * after a signed build and by scripts/verify-signed-installer.ps1 on its test install
 * (docs/RELEASING.md, "Code signing"). Windows only: the check is Get-AuthenticodeSignature.
 */
import { parseArgs } from 'node:util';
import { checkUpdateSignature } from './lib/updateSignature';
import { forgetPsModulePath } from './lib/windowsPowerShell';

// Started from PowerShell 7 (the Release workflow's steps are), this process would hand
// PowerShell 7's module path to the Windows PowerShell that electron-updater starts. Its own
// command line clears it too; this makes sure of it for everything started from here.
forgetPsModulePath();

// electron-updater starts PowerShell with execFile and shell: true, which Node 24 answers with a
// deprecation warning on stderr (DEP0190); it quotes the file name itself. In a PowerShell
// script that stops on errors, such a line on stderr would stop it. What this script writes
// to stderr is a problem with the installer, nothing else.
process.noDeprecation = true;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { installer: { type: 'string' }, feed: { type: 'string' } },
  });
  const { installer, feed } = values;
  if (!installer || !feed) {
    console.error(
      'verify-update-signature: usage: --installer <RigReady-Setup-x.exe> --feed <app-update.yml>'
    );
    return 2;
  }
  const result = await checkUpdateSignature(installer, feed);
  console.log(`verify-update-signature: publisher names in ${feed}: ${result.names.join(' | ')}`);
  if (result.problem) {
    console.error(`verify-update-signature: ${result.problem}`);
    return 1;
  }
  console.log(
    `verify-update-signature: electron-updater accepts ${installer} by the full DN, without a warning`
  );
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`verify-update-signature: ${e instanceof Error ? (e.stack ?? e.message) : e}`);
    process.exit(1);
  }
);
