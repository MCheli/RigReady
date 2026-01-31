/**
 * Icon Generation Script
 * Converts the SVG icon to ICO and PNG formats for the application
 *
 * Usage: node scripts/generate-icons.js
 *
 * Requirements:
 *   npm install sharp png-to-ico --save-dev
 */

const fs = require('fs');
const path = require('path');

async function generateIcons() {
  const assetsDir = path.join(__dirname, '..', 'assets');
  const svgPath = path.join(assetsDir, 'icon.svg');

  if (!fs.existsSync(svgPath)) {
    console.error('SVG icon not found at:', svgPath);
    process.exit(1);
  }

  // Check for required packages
  let sharp, pngToIco;
  try {
    sharp = require('sharp');
  } catch {
    console.log('Installing sharp...');
    require('child_process').execSync('npm install sharp --save-dev', { stdio: 'inherit' });
    sharp = require('sharp');
  }

  try {
    const pngToIcoModule = require('png-to-ico');
    pngToIco = pngToIcoModule.default || pngToIcoModule.imagesToIco || pngToIcoModule;
  } catch {
    console.log('Installing png-to-ico...');
    require('child_process').execSync('npm install png-to-ico --save-dev', { stdio: 'inherit' });
    const pngToIcoModule = require('png-to-ico');
    pngToIco = pngToIcoModule.default || pngToIcoModule.imagesToIco || pngToIcoModule;
  }

  const svgBuffer = fs.readFileSync(svgPath);
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const pngBuffers = [];

  console.log('Generating PNG files at various sizes...');

  // Generate PNG files at different sizes
  for (const size of sizes) {
    const pngPath = path.join(assetsDir, `icon-${size}.png`);
    const buffer = await sharp(svgBuffer).resize(size, size).png().toBuffer();

    fs.writeFileSync(pngPath, buffer);
    pngBuffers.push(buffer);
    console.log(`  Created: icon-${size}.png`);
  }

  // Create main icon.png (256x256)
  const mainPngPath = path.join(assetsDir, 'icon.png');
  await sharp(svgBuffer).resize(256, 256).png().toFile(mainPngPath);
  console.log('  Created: icon.png (256x256)');

  // Generate ICO file
  console.log('Generating ICO file...');
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoPngPaths = [];

  for (const size of icoSizes) {
    const pngPath = path.join(assetsDir, `icon-${size}.png`);
    icoPngPaths.push(pngPath);
  }

  const icoPath = path.join(assetsDir, 'icon.ico');

  // png-to-ico can take file paths or buffers
  try {
    const icoBuffer = await pngToIco(icoPngPaths);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('  Created: icon.ico');
  } catch (err) {
    // Try alternative: use only the 256x256 PNG
    console.log('  Trying single PNG approach...');
    const singlePngPath = path.join(assetsDir, 'icon-256.png');
    const icoBuffer = await pngToIco([singlePngPath]);
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('  Created: icon.ico (from 256x256)');
  }

  // Clean up intermediate PNG files (keep icon.png and icon-256.png)
  console.log('Cleaning up intermediate files...');
  for (const size of sizes) {
    if (size !== 256) {
      const pngPath = path.join(assetsDir, `icon-${size}.png`);
      if (fs.existsSync(pngPath)) {
        fs.unlinkSync(pngPath);
      }
    }
  }

  console.log('\nIcon generation complete!');
  console.log('Files created:');
  console.log('  - assets/icon.svg (source)');
  console.log('  - assets/icon.ico (Windows)');
  console.log('  - assets/icon.png (256x256)');
  console.log('  - assets/icon-256.png');
}

generateIcons().catch(console.error);
