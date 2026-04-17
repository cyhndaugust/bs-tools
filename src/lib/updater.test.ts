import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

import { isTauri } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import {
  fetchAvailableUpdate,
  formatCurrentVersion,
  formatUpdateBody,
  formatUpdateTitle,
} from "./updater";

const mockedCheck = vi.mocked(check);
const mockedIsTauri = vi.mocked(isTauri);

beforeEach(() => {
  mockedCheck.mockReset();
  mockedIsTauri.mockReset();
  mockedIsTauri.mockReturnValue(true);
});

describe("formatUpdateBody", () => {
  it("falls back when release notes are empty", () => {
    expect(formatUpdateBody("")).toBe("发现新版本，建议完成当前工作后更新。");
  });

  it("keeps release notes when present", () => {
    expect(formatUpdateBody("Fix menu parsing bug")).toBe("Fix menu parsing bug");
  });
});

describe("formatCurrentVersion", () => {
  it("falls back when current version is missing", () => {
    expect(formatCurrentVersion("")).toBe("未知版本");
  });

  it("keeps the current version when present", () => {
    expect(formatCurrentVersion("0.4.0")).toBe("0.4.0");
  });
});

describe("formatUpdateTitle", () => {
  it("adds the version to the update banner title", () => {
    expect(formatUpdateTitle("0.5.0")).toBe("发现新版本 0.5.0");
  });
});

describe("fetchAvailableUpdate", () => {
  it("returns null outside the Tauri runtime", async () => {
    mockedIsTauri.mockReturnValue(false);

    await expect(fetchAvailableUpdate()).resolves.toBeNull();
    expect(mockedCheck).not.toHaveBeenCalled();
  });

  it("returns null when no update is available", async () => {
    mockedCheck.mockResolvedValue(null);

    await expect(fetchAvailableUpdate()).resolves.toBeNull();
  });

  it("normalizes the available update payload", async () => {
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    mockedCheck.mockResolvedValue({
      version: "0.5.0",
      currentVersion: "0.4.0",
      body: "",
      downloadAndInstall,
    } as never);

    await expect(fetchAvailableUpdate()).resolves.toEqual({
      version: "0.5.0",
      currentVersion: "0.4.0",
      body: "发现新版本，建议完成当前工作后更新。",
      downloadAndInstall: expect.any(Function),
    });
  });
});
