import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  body: string;
  downloadAndInstall: () => Promise<void>;
}

export function formatUpdateBody(body?: string | null) {
  const trimmed = body?.trim();
  return trimmed && trimmed.length > 0
    ? trimmed
    : "发现新版本，建议完成当前工作后更新。";
}

export function formatCurrentVersion(version?: string | null) {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "未知版本";
}

export function formatUpdateTitle(version?: string | null) {
  const trimmed = version?.trim();
  return trimmed && trimmed.length > 0
    ? `发现新版本 ${trimmed}`
    : "发现新版本";
}

export async function fetchAvailableUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) {
    return null;
  }

  const update = await check();
  if (!update) {
    return null;
  }

  return {
    version: update.version,
    currentVersion: formatCurrentVersion(update.currentVersion),
    body: formatUpdateBody(update.body),
    downloadAndInstall: () => update.downloadAndInstall(),
  };
}
