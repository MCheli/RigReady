/**
 * Azure Trusted Signing script for electron-builder
 *
 * This script is used by electron-builder to sign Windows executables
 * using Azure Trusted Signing service.
 *
 * Required environment variables:
 * - AZURE_TENANT_ID: Azure AD tenant ID
 * - AZURE_CLIENT_ID: Service principal application ID
 * - AZURE_CLIENT_SECRET: Service principal client secret
 * - AZURE_CODE_SIGNING_ACCOUNT: Azure Trusted Signing account name
 * - AZURE_CODE_SIGNING_PROFILE: Certificate profile name
 * - AZURE_CODE_SIGNING_ENDPOINT: Trusted Signing endpoint URL (optional, defaults to EastUS)
 *
 * Setup instructions:
 * 1. Create an Azure Trusted Signing account at https://portal.azure.com
 * 2. Complete identity verification
 * 3. Create a certificate profile
 * 4. Create a service principal with "Trusted Signing Certificate Profile Signer" role
 * 5. Add the environment variables to your GitHub repository secrets
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Check if Azure signing is configured
function isAzureSigningConfigured() {
  return !!(
    process.env.AZURE_TENANT_ID &&
    process.env.AZURE_CLIENT_ID &&
    process.env.AZURE_CLIENT_SECRET &&
    process.env.AZURE_CODE_SIGNING_ACCOUNT &&
    process.env.AZURE_CODE_SIGNING_PROFILE
  );
}

// Get the Azure SignTool path
function getSignToolPath() {
  // Azure SignTool should be installed via dotnet tool
  // Install with: dotnet tool install --global Azure.CodeSigning.Dlib
  const globalToolPath = path.join(
    process.env.USERPROFILE || process.env.HOME || '',
    '.dotnet',
    'tools',
    'azuresigntool.exe'
  );

  if (fs.existsSync(globalToolPath)) {
    return globalToolPath;
  }

  // Try using it from PATH
  return 'AzureSignTool';
}

/**
 * Sign a file using Azure Trusted Signing
 * @param {Object} configuration - electron-builder signing configuration
 * @returns {Promise<void>}
 */
exports.default = async function sign(configuration) {
  const filePath = configuration.path;

  // Skip if Azure signing is not configured
  if (!isAzureSigningConfigured()) {
    console.log(`Skipping signing for ${path.basename(filePath)} - Azure signing not configured`);
    return;
  }

  const endpoint = process.env.AZURE_CODE_SIGNING_ENDPOINT || 'https://eus.codesigning.azure.net';

  console.log(`Signing ${path.basename(filePath)} with Azure Trusted Signing...`);

  const signToolPath = getSignToolPath();

  const args = [
    'sign',
    '-kvu',
    endpoint,
    '-kva',
    process.env.AZURE_CODE_SIGNING_ACCOUNT,
    '-kvt',
    process.env.AZURE_TENANT_ID,
    '-kvi',
    process.env.AZURE_CLIENT_ID,
    '-kvs',
    process.env.AZURE_CLIENT_SECRET,
    '-kvc',
    process.env.AZURE_CODE_SIGNING_PROFILE,
    '-tr',
    'http://timestamp.digicert.com',
    '-td',
    'sha256',
    '-fd',
    'sha256',
    '-v',
    `"${filePath}"`,
  ];

  try {
    execSync(`"${signToolPath}" ${args.join(' ')}`, {
      stdio: 'inherit',
      encoding: 'utf-8',
    });
    console.log(`Successfully signed ${path.basename(filePath)}`);
  } catch (error) {
    console.error(`Failed to sign ${path.basename(filePath)}:`, error.message);
    // Don't throw in CI if signing fails - allow unsigned builds
    if (process.env.CI !== 'true') {
      throw error;
    }
  }
};
