#!/usr/bin/env node

import { fetchLatestVersion, saveUpdateCache } from './updateNotifier.js';

async function run() {
  try {
    const latest = await fetchLatestVersion(4000);
    if (latest) {
      saveUpdateCache({
        lastChecked: Date.now(),
        latestVersion: latest
      });
    }
  } catch {
    // Fail completely silently in background worker
  } finally {
    process.exit(0);
  }
}

run();
