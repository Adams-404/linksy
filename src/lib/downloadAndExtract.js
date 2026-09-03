import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import ora from 'ora';
import { LINKSY_DIR, GNIREHTET_DIR, GNIREHTET_BIN, GNIREHTET_APK } from './paths.js';
import { FALLBACK_RELEASES_URL } from './fetchLatestGnirehtet.js';
import { logger } from '../utils/logger.js';

/**
 * Downloads a file to a destination path, with single retry on failure.
 * @param {string} url
 * @param {string} destPath
 * @param {number} maxRetries
 * @returns {Promise<void>}
 */
async function downloadFileWithRetry(url, destPath, maxRetries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        logger.warn('Download interrupted. Retrying download...');
        await new Promise(r => setTimeout(r, 1500));
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'linksy-cli'
        }
      });

      if (!response.ok) {
        throw new Error(`Download failed with status HTTP ${response.status} (${response.statusText})`);
      }

      const fileStream = fs.createWriteStream(destPath);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(destPath, buffer);
      return;
    } catch (err) {
      lastError = err;
      if (fs.existsSync(destPath)) {
        try { fs.unlinkSync(destPath); } catch {}
      }
    }
  }
  throw lastError;
}

/**
 * Recursively finds files in a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function findFilesRecursive(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFilesRecursive(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Downloads and extracts the Gnirehtet release zip.
 * @param {string} downloadUrl
 * @param {string} [version='latest']
 * @returns {Promise<void>}
 */
export async function downloadAndExtractGnirehtet(downloadUrl, version = 'latest') {
  const spinner = ora(`Downloading Gnirehtet (${version})...`).start();
  fs.mkdirSync(LINKSY_DIR, { recursive: true });

  const tempZipPath = path.join(LINKSY_DIR, 'gnirehtet-release.zip');
  const tempExtractDir = path.join(LINKSY_DIR, '.extract-tmp');

  try {
    await downloadFileWithRetry(downloadUrl, tempZipPath);
    spinner.text = 'Extracting Gnirehtet archive...';

    // Clean any prior temp extraction dir
    if (fs.existsSync(tempExtractDir)) {
      fs.rmSync(tempExtractDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempExtractDir, { recursive: true });

    // Extract zip
    const zip = new AdmZip(tempZipPath);
    zip.extractAllTo(tempExtractDir, true);

    // Find gnirehtet binary and apk in the extracted directory
    const extractedFiles = findFilesRecursive(tempExtractDir);
    const binaryFile = extractedFiles.find(f => path.basename(f) === 'gnirehtet');
    const apkFile = extractedFiles.find(f => path.basename(f) === 'gnirehtet.apk');

    if (!binaryFile) {
      throw new Error("Gnirehtet archive does not contain the 'gnirehtet' binary.");
    }

    // Ensure ~/.linksy/gnirehtet exists and is clean
    if (fs.existsSync(GNIREHTET_DIR)) {
      fs.rmSync(GNIREHTET_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(GNIREHTET_DIR, { recursive: true });

    // Copy binary and apk directly into ~/.linksy/gnirehtet/
    fs.copyFileSync(binaryFile, GNIREHTET_BIN);
    if (apkFile) {
      fs.copyFileSync(apkFile, GNIREHTET_APK);
    }

    // Copy any remaining companion files from the same folder
    const binaryParentDir = path.dirname(binaryFile);
    const siblings = fs.readdirSync(binaryParentDir);
    for (const sibling of siblings) {
      const source = path.join(binaryParentDir, sibling);
      const target = path.join(GNIREHTET_DIR, sibling);
      if (!fs.existsSync(target) && fs.statSync(source).isFile()) {
        fs.copyFileSync(source, target);
      }
    }

    // chmod +x the gnirehtet binary
    fs.chmodSync(GNIREHTET_BIN, 0o755);

    spinner.succeed(`Gnirehtet installed successfully to ${GNIREHTET_DIR}`);
  } catch (err) {
    spinner.fail('Failed to download or extract Gnirehtet.');
    logger.error(`Error: ${err.message}`, err);
    logger.info(`You can download Gnirehtet manually from: ${FALLBACK_RELEASES_URL}`);
    throw err;
  } finally {
    // Cleanup temporary files
    if (fs.existsSync(tempZipPath)) {
      try { fs.unlinkSync(tempZipPath); } catch {}
    }
    if (fs.existsSync(tempExtractDir)) {
      try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch {}
    }
  }
}
