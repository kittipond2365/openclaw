/**
 * Types for update checking - safe for browser import
 * This file has no Node.js dependencies to avoid browser bundling issues
 */

export type UpdateAvailable = {
  currentVersion: string;
  latestVersion: string;
  channel: string;
};
