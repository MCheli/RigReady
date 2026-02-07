/**
 * Bundle Service
 * Handles export/import of .rigready profile bundles using archiver for ZIP.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import archiver from 'archiver';
import extract from 'extract-zip';
import { createReadStream, createWriteStream } from 'fs';
import { profileService } from './profileService';
import { pathVariableService } from './pathVariableService';
import type { Profile } from '../../shared/profileTypes';
import type {
  BundleManifest,
  BundleFileEntry,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
} from '../../shared/bundleTypes';

class BundleService {
  private bundlesDir: string;

  constructor() {
    this.bundlesDir = path.join(os.homedir(), '.rigready', 'bundles');
    if (!fs.existsSync(this.bundlesDir)) {
      fs.mkdirSync(this.bundlesDir, { recursive: true });
    }
  }

  /**
   * Export a profile as a .rigready bundle (ZIP).
   */
  async exportBundle(options: ExportOptions): Promise<ExportResult> {
    const profile = profileService.getById(options.profileId);
    if (!profile) {
      return { success: false, error: 'Profile not found' };
    }

    const outputPath =
      options.outputPath ||
      path.join(
        this.bundlesDir,
        `${profile.name.replace(/[^a-zA-Z0-9-_]/g, '_')}-${Date.now().toString(36)}.rigready`
      );

    try {
      const yaml = await import('js-yaml');
      const profileYaml = yaml.dump(profile);

      const files: BundleFileEntry[] = [
        {
          path: 'profile.yaml',
          type: 'profile',
          size: Buffer.byteLength(profileYaml, 'utf-8'),
        },
      ];

      // Collect config snapshots if requested
      const configSnapshots: { entryPath: string; absolutePath: string }[] = [];
      if (options.includeConfigSnapshots && profile.trackedConfigurations) {
        for (const config of profile.trackedConfigurations) {
          const resolvedPath = pathVariableService.expandPath(config.path);
          if (fs.existsSync(resolvedPath)) {
            const stat = fs.statSync(resolvedPath);
            if (stat.isFile()) {
              const entryPath = `configs/${path.basename(resolvedPath)}`;
              configSnapshots.push({ entryPath, absolutePath: resolvedPath });
              files.push({
                path: entryPath,
                type: 'config-snapshot',
                originalPath: pathVariableService.tokenizePath(resolvedPath),
                size: stat.size,
              });
            }
          }
        }
      }

      // Build manifest
      const manifest: BundleManifest = {
        version: 1,
        createdAt: Date.now(),
        createdBy: os.userInfo().username,
        appVersion: '1.0.0',
        profileName: profile.name,
        game: profile.game,
        description: options.description,
        compatibility: {
          minAppVersion: '1.0.0',
          platform: process.platform,
        },
        files,
      };

      // Create ZIP
      await this.createZip(outputPath, profileYaml, manifest, configSnapshots);

      return { success: true, bundlePath: outputPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Export failed: ${message}` };
    }
  }

  private createZip(
    outputPath: string,
    profileYaml: string,
    manifest: BundleManifest,
    configSnapshots: { entryPath: string; absolutePath: string }[]
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', () => resolve());
      archive.on('error', (err) => reject(err));

      archive.pipe(output);

      // Add manifest
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Add profile YAML
      archive.append(profileYaml, { name: 'profile.yaml' });

      // Add config snapshots
      for (const snapshot of configSnapshots) {
        archive.append(createReadStream(snapshot.absolutePath), { name: snapshot.entryPath });
      }

      archive.finalize();
    });
  }

  /**
   * Import a .rigready bundle.
   */
  async importBundle(options: ImportOptions): Promise<ImportResult> {
    const warnings: string[] = [];

    if (!fs.existsSync(options.bundlePath)) {
      return { success: false, warnings, error: 'Bundle file not found' };
    }

    // Extract to temp directory
    const tempDir = path.join(this.bundlesDir, `_import-${Date.now().toString(36)}`);

    try {
      await extract(options.bundlePath, { dir: tempDir });

      // Read manifest
      const manifestPath = path.join(tempDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        return { success: false, warnings, error: 'Invalid bundle: missing manifest.json' };
      }

      const manifest: BundleManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      // Read profile YAML
      const profileYamlPath = path.join(tempDir, 'profile.yaml');
      if (!fs.existsSync(profileYamlPath)) {
        return { success: false, warnings, error: 'Invalid bundle: missing profile.yaml' };
      }

      const yaml = await import('js-yaml');
      const profileData = yaml.load(fs.readFileSync(profileYamlPath, 'utf-8')) as Record<
        string,
        unknown
      >;

      // Create new profile with optional name override
      const newName = options.newProfileName || manifest.profileName;
      const profile = profileService.create({
        name: newName,
        game: profileData.game as Profile['game'],
        launchTarget: profileData.launchTarget as never,
        checklistItems: (profileData.checklistItems as never[]) || [],
        trackedConfigurations: (profileData.trackedConfigurations as never[]) || [],
      });

      // Restore config snapshots if requested
      if (options.restoreConfigs) {
        for (const fileEntry of manifest.files) {
          if (fileEntry.type === 'config-snapshot' && fileEntry.originalPath) {
            const extractedFile = path.join(tempDir, fileEntry.path);
            if (fs.existsSync(extractedFile)) {
              const targetPath = pathVariableService.expandPath(fileEntry.originalPath);
              try {
                const targetDir = path.dirname(targetPath);
                if (!fs.existsSync(targetDir)) {
                  fs.mkdirSync(targetDir, { recursive: true });
                }
                fs.copyFileSync(extractedFile, targetPath);
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                warnings.push(`Failed to restore config ${fileEntry.path}: ${msg}`);
              }
            }
          }
        }
      }

      return {
        success: true,
        profileId: profile.id,
        profileName: profile.name,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, warnings, error: `Import failed: ${message}` };
    } finally {
      // Clean up temp directory
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

export const bundleService = new BundleService();
