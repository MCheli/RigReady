/**
 * Privacy Review Service
 * Scans profile data for username/computer name patterns before export.
 */

import * as os from 'os';
import { profileService } from './profileService';
import type { PrivacyReviewResult, PrivacyFinding } from '../../shared/bundleTypes';

class PrivacyReviewService {
  private sensitivePatterns: { pattern: RegExp; description: string }[] = [];

  constructor() {
    this.buildPatterns();
  }

  private buildPatterns(): void {
    const username = os.userInfo().username;
    const hostname = os.hostname();
    const homedir = os.homedir().replace(/\\/g, '\\\\');

    this.sensitivePatterns = [
      {
        pattern: new RegExp(this.escapeRegex(username), 'gi'),
        description: `Contains username "${username}"`,
      },
      {
        pattern: new RegExp(this.escapeRegex(hostname), 'gi'),
        description: `Contains computer name "${hostname}"`,
      },
      {
        pattern: new RegExp(homedir, 'gi'),
        description: 'Contains home directory path',
      },
      {
        pattern: /C:\\Users\\[^\\]+/gi,
        description: 'Contains Windows user path',
      },
      {
        pattern: /\/home\/[^/]+/gi,
        description: 'Contains Linux home path',
      },
    ];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Review a profile for privacy-sensitive content.
   */
  reviewProfile(profileId: string): PrivacyReviewResult {
    const findings: PrivacyFinding[] = [];

    const profile = profileService.getById(profileId);
    if (!profile) {
      return { hasIssues: false, findings };
    }

    // Check profile fields
    const fieldsToCheck: { field: string; value: string | undefined }[] = [
      { field: 'launchTarget.executablePath', value: profile.launchTarget?.executablePath },
      { field: 'launchTarget.workingDirectory', value: profile.launchTarget?.workingDirectory },
    ];

    // Check checklist items
    if (profile.checklistItems) {
      for (let i = 0; i < profile.checklistItems.length; i++) {
        const item = profile.checklistItems[i];
        if (item.type === 'config') {
          fieldsToCheck.push({
            field: `checklistItems[${i}].config.filePath`,
            value: item.config.filePath,
          });
        }
        if (item.remediation) {
          if (item.remediation.type === 'launchProcess') {
            fieldsToCheck.push({
              field: `checklistItems[${i}].remediation.config.executablePath`,
              value: item.remediation.config.executablePath,
            });
          }
          if (item.remediation.type === 'script') {
            fieldsToCheck.push({
              field: `checklistItems[${i}].remediation.config.scriptPath`,
              value: item.remediation.config.scriptPath,
            });
          }
        }
      }
    }

    // Check tracked configurations
    if (profile.trackedConfigurations) {
      for (let i = 0; i < profile.trackedConfigurations.length; i++) {
        fieldsToCheck.push({
          field: `trackedConfigurations[${i}].path`,
          value: profile.trackedConfigurations[i].path,
        });
      }
    }

    // Scan all fields
    for (const { field, value } of fieldsToCheck) {
      if (!value) continue;

      for (const { pattern, description } of this.sensitivePatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(value)) {
          findings.push({
            file: 'profile.yaml',
            pattern: field,
            description,
            severity: 'warning',
          });
          break;
        }
      }
    }

    return {
      hasIssues: findings.length > 0,
      findings,
    };
  }
}

export const privacyReviewService = new PrivacyReviewService();
