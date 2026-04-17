# BS Tools macOS Release And Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a macOS installer automatically from GitHub, keep a rolling `nightly` GitHub Release for every `main` push, and ship stable auto-updates from versioned GitHub Releases.

**Architecture:** Use two delivery lanes. `main` pushes publish a rolling `nightly` prerelease for fast QA, while tagged releases (`vX.Y.Z`) publish signed stable installers plus `latest.json` for Tauri updater clients. The app embeds the updater public key, checks GitHub Releases for stable updates, and installs updates in-app with an explicit user action.

**Tech Stack:** Tauri 2, React 19, TypeScript, Rust, GitHub Actions, `tauri-plugin-updater`, `tauri-plugin-process`, `tauri-apps/tauri-action`, `pnpm`, Node built-in test runner, Vitest

---

## File Map

- Modify: `/Users/mlt/codebases/bs-tools/package.json`
  - Add release/test scripts and keep Tauri metadata synced before builds.
- Create: `/Users/mlt/codebases/bs-tools/scripts/sync-release-metadata.mjs`
  - Sync `package.json` version into `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`, and inject the updater public key.
- Create: `/Users/mlt/codebases/bs-tools/scripts/release-version.mjs`
  - Single command to bump the app version everywhere before creating a stable tag.
- Create: `/Users/mlt/codebases/bs-tools/scripts/__tests__/sync-release-metadata.test.mjs`
  - Regression tests for version/public-key sync behavior.
- Create: `/Users/mlt/codebases/bs-tools/src-tauri/updater-public-key.pem`
  - Committed public key used by Tauri updater.
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/Cargo.toml`
  - Add updater/process plugins.
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/src/lib.rs`
  - Register updater/process plugins.
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/tauri.conf.json`
  - Enable updater artifacts and point the app at GitHub Releases.
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/capabilities/default.json`
  - Grant updater/process permissions to the frontend.
- Create: `/Users/mlt/codebases/bs-tools/vitest.config.ts`
  - Minimal frontend unit-test config.
- Create: `/Users/mlt/codebases/bs-tools/src/lib/updater.ts`
  - Wrap update-check/install logic and keep it testable.
- Create: `/Users/mlt/codebases/bs-tools/src/lib/updater.test.ts`
  - Unit tests for update-status formatting and guardrails.
- Create: `/Users/mlt/codebases/bs-tools/src/components/UpdateBanner.tsx`
  - Startup banner for checking, downloading, and restarting into an update.
- Modify: `/Users/mlt/codebases/bs-tools/src/App.tsx`
  - Mount the update UI globally.
- Create: `/Users/mlt/codebases/bs-tools/.github/workflows/macos-nightly.yml`
  - Build macOS installers on every `main` push and replace assets on the `nightly` prerelease.
- Create: `/Users/mlt/codebases/bs-tools/.github/workflows/release-stable.yml`
  - Build signed stable artifacts on version tags and upload `latest.json`.
- Create: `/Users/mlt/codebases/bs-tools/docs/release-and-update.md`
  - Operator runbook for secrets, versioning, nightly, and stable release flow.
- Modify: `/Users/mlt/codebases/bs-tools/README.md`
  - Link to the new release/update runbook.

### Task 1: Add Release Metadata Tooling

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/scripts/sync-release-metadata.mjs`
- Create: `/Users/mlt/codebases/bs-tools/scripts/release-version.mjs`
- Create: `/Users/mlt/codebases/bs-tools/scripts/__tests__/sync-release-metadata.test.mjs`
- Modify: `/Users/mlt/codebases/bs-tools/package.json`
- Test: `/Users/mlt/codebases/bs-tools/scripts/__tests__/sync-release-metadata.test.mjs`

- [ ] **Step 1: Write the failing Node test for version and public-key sync**

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncReleaseMetadata } from "../sync-release-metadata.mjs";

test("syncReleaseMetadata copies package version and updater public key", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bs-tools-release-"));

  await fs.writeFile(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ version: "0.3.0" }, null, 2),
  );

  await fs.mkdir(path.join(tempRoot, "src-tauri"), { recursive: true });
  await fs.writeFile(
    path.join(tempRoot, "src-tauri", "Cargo.toml"),
    '[package]\nname = "bs-tools"\nversion = "0.1.0"\n',
  );
  await fs.writeFile(
    path.join(tempRoot, "src-tauri", "tauri.conf.json"),
    JSON.stringify({ version: "0.1.0", plugins: { updater: { pubkey: "" } } }, null, 2),
  );
  await fs.writeFile(
    path.join(tempRoot, "src-tauri", "updater-public-key.pem"),
    "PUBLIC-KEY-CONTENT",
  );

  await syncReleaseMetadata(tempRoot);

  const cargoToml = await fs.readFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), "utf8");
  const tauriConf = JSON.parse(
    await fs.readFile(path.join(tempRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  assert.match(cargoToml, /version = "0.3.0"/);
  assert.equal(tauriConf.version, "0.3.0");
  assert.equal(tauriConf.plugins.updater.pubkey, "PUBLIC-KEY-CONTENT");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/__tests__/sync-release-metadata.test.mjs`

Expected: FAIL with `Cannot find module '../sync-release-metadata.mjs'` or `syncReleaseMetadata is not a function`

- [ ] **Step 3: Write the metadata sync script**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRoot = path.resolve(__dirname, "..");

function replaceCargoVersion(source, version) {
  return source.replace(/^version = ".*"$/m, `version = "${version}"`);
}

export async function syncReleaseMetadata(rootDir = defaultRoot) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
  const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
  const updaterPubkeyPath = path.join(rootDir, "src-tauri", "updater-public-key.pem");

  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const updaterPubkey = (await fs.readFile(updaterPubkeyPath, "utf8")).trim();
  const cargoToml = await fs.readFile(cargoTomlPath, "utf8");
  const tauriConf = JSON.parse(await fs.readFile(tauriConfPath, "utf8"));

  tauriConf.version = packageJson.version;
  tauriConf.plugins ??= {};
  tauriConf.plugins.updater ??= {};
  tauriConf.plugins.updater.pubkey = updaterPubkey;

  await fs.writeFile(cargoTomlPath, replaceCargoVersion(cargoToml, packageJson.version));
  await fs.writeFile(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);
}

if (process.argv[1] === __filename) {
  syncReleaseMetadata().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Write the version bump helper**

```js
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncReleaseMetadata } from "./sync-release-metadata.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function assertSemver(input) {
  if (!/^\d+\.\d+\.\d+$/.test(input)) {
    throw new Error(`Expected x.y.z version, received: ${input}`);
  }
}

async function main() {
  const nextVersion = process.argv[2];
  assertSemver(nextVersion);

  const packageJsonPath = path.join(rootDir, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  packageJson.version = nextVersion;

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await syncReleaseMetadata(rootDir);

  console.log(`Prepared release v${nextVersion}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Wire the new scripts into `package.json`**

```json
{
  "scripts": {
    "dev": "vite",
    "prebuild": "node scripts/sync-release-metadata.mjs",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test:node": "node --test scripts/__tests__/sync-release-metadata.test.mjs",
    "release:sync": "node scripts/sync-release-metadata.mjs",
    "release:version": "node scripts/release-version.mjs"
  }
}
```

- [ ] **Step 6: Run the Node test to verify it passes**

Run: `node --test scripts/__tests__/sync-release-metadata.test.mjs`

Expected: PASS with `ok 1 - syncReleaseMetadata copies package version and updater public key`

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/sync-release-metadata.mjs scripts/release-version.mjs scripts/__tests__/sync-release-metadata.test.mjs
git commit -m "build: add release metadata sync tooling"
```

### Task 2: Enable Tauri Updater Infrastructure

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/src-tauri/updater-public-key.pem`
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/Cargo.toml`
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/src/lib.rs`
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/tauri.conf.json`
- Modify: `/Users/mlt/codebases/bs-tools/src-tauri/capabilities/default.json`
- Test: `/Users/mlt/codebases/bs-tools/src-tauri/Cargo.toml`

- [ ] **Step 1: Generate updater signing keys and store the public key in the repo**

Run:

```bash
mkdir -p ~/.tauri
pnpm tauri signer generate -w ~/.tauri/bs-tools-updater.key | sed -n '/BEGIN PUBLIC KEY/,/END PUBLIC KEY/p' > src-tauri/updater-public-key.pem
chmod 600 ~/.tauri/bs-tools-updater.key
```

Expected:
- `src-tauri/updater-public-key.pem` exists and starts with `-----BEGIN PUBLIC KEY-----`
- private key is written under `~/.tauri/bs-tools-updater.key`

Immediately save the matching private key contents into the GitHub repository secret `TAURI_SIGNING_PRIVATE_KEY` and its password into `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

- [ ] **Step 2: Add updater/process crates and register them in Rust**

Replace the dependency section in `/Users/mlt/codebases/bs-tools/src-tauri/Cargo.toml` with:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
tauri-plugin-fs = "2"
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
qrcode = "0.14"
similar = "2"
rusqlite = { version = "0.32", features = ["bundled"] }
```

Update `/Users/mlt/codebases/bs-tools/src-tauri/src/lib.rs`:

```rust
mod commands;
mod db;

use commands::diff::compute_diff;
use commands::menu_parser::parse_menu_json;
use commands::qrcode::{delete_qr_history, generate_qrcode, get_qr_history};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let db_state = db::init_db(app.handle())?;
            app.manage(db_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            generate_qrcode,
            get_qr_history,
            delete_qr_history,
            parse_menu_json,
            compute_diff,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Configure updater endpoints and build artifacts**

Update `/Users/mlt/codebases/bs-tools/src-tauri/tauri.conf.json` to:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "bs-tools",
  "version": "0.1.0",
  "identifier": "com.zouxu.bs-tools",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "BS Tools",
        "width": 1200,
        "height": 800
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/cyhndaugust/bs-tools/releases/latest/download/latest.json"
      ],
      "pubkey": ""
    }
  }
}
```

Run after the edit so the public key is injected:

```bash
pnpm release:sync
```

Expected: `src-tauri/tauri.conf.json` keeps the same endpoint and now contains the real committed public key.

- [ ] **Step 4: Grant updater and restart permissions to the frontend**

Update `/Users/mlt/codebases/bs-tools/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default",
    "updater:default",
    "process:default",
    {
      "identifier": "fs:allow-read-text-file",
      "allow": [{ "path": "**" }]
    },
    {
      "identifier": "fs:default"
    }
  ]
}
```

- [ ] **Step 5: Run Rust verification**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: PASS with a final `Finished dev [unoptimized + debuginfo]` or equivalent success line

- [ ] **Step 6: Commit**

```bash
git add src-tauri/updater-public-key.pem src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat: enable tauri updater infrastructure"
```

### Task 3: Add In-App Update UX With Tests

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/vitest.config.ts`
- Create: `/Users/mlt/codebases/bs-tools/src/lib/updater.ts`
- Create: `/Users/mlt/codebases/bs-tools/src/lib/updater.test.ts`
- Create: `/Users/mlt/codebases/bs-tools/src/components/UpdateBanner.tsx`
- Modify: `/Users/mlt/codebases/bs-tools/package.json`
- Modify: `/Users/mlt/codebases/bs-tools/src/App.tsx`
- Test: `/Users/mlt/codebases/bs-tools/src/lib/updater.test.ts`

- [ ] **Step 1: Add the failing updater unit test**

```ts
import { describe, expect, it } from "vitest";
import { formatUpdateBody } from "./updater";

describe("formatUpdateBody", () => {
  it("falls back when release notes are empty", () => {
    expect(formatUpdateBody("")).toBe("发现新版本，建议完成当前工作后更新。");
  });

  it("keeps release notes when present", () => {
    expect(formatUpdateBody("Fix menu parsing bug")).toBe("Fix menu parsing bug");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm dlx vitest run src/lib/updater.test.ts`

Expected: FAIL with `Cannot find module './updater'`

- [ ] **Step 3: Add Vitest and the updater helper module**

Update `/Users/mlt/codebases/bs-tools/package.json` dev dependencies and scripts:

```json
{
  "scripts": {
    "test:node": "node --test scripts/__tests__/sync-release-metadata.test.mjs",
    "test:unit": "vitest run",
    "check": "pnpm test:node && pnpm test:unit && pnpm build && cargo check --manifest-path src-tauri/Cargo.toml"
  },
  "dependencies": {
    "@tauri-apps/plugin-process": "^2",
    "@tauri-apps/plugin-updater": "^2"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

Create `/Users/mlt/codebases/bs-tools/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

Create `/Users/mlt/codebases/bs-tools/src/lib/updater.ts`:

```ts
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

export async function fetchAvailableUpdate(): Promise<UpdateInfo | null> {
  const update = await check();
  if (!update?.available) {
    return null;
  }

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    body: formatUpdateBody(update.body),
    downloadAndInstall: update.downloadAndInstall,
  };
}
```

- [ ] **Step 4: Add the update banner UI**

Create `/Users/mlt/codebases/bs-tools/src/components/UpdateBanner.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Alert, Button, Space, Typography, message } from "antd";
import { relaunch } from "@tauri-apps/plugin-process";
import { fetchAvailableUpdate, type UpdateInfo } from "../lib/updater";

type Status = "idle" | "checking" | "available" | "downloading";

function UpdateBanner() {
  const [status, setStatus] = useState<Status>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("checking");
      try {
        const next = await fetchAvailableUpdate();
        if (!cancelled && next) {
          setUpdateInfo(next);
          setStatus("available");
        } else if (!cancelled) {
          setStatus("idle");
        }
      } catch (error) {
        if (!cancelled) {
          setStatus("idle");
          message.warning(`检查更新失败: ${String(error)}`);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleInstall() {
    if (!updateInfo) {
      return;
    }

    setStatus("downloading");
    try {
      await updateInfo.downloadAndInstall();
      message.success("更新已安装，应用即将重启");
      await relaunch();
    } catch (error) {
      setStatus("available");
      message.error(`安装更新失败: ${String(error)}`);
    }
  }

  if (status !== "available" && status !== "downloading") {
    return null;
  }

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message={`发现新版本 ${updateInfo?.version}`}
      description={
        <Space direction="vertical" size={8}>
          <Typography.Text>
            当前版本 {updateInfo?.currentVersion}，{updateInfo?.body}
          </Typography.Text>
          <Button
            type="primary"
            onClick={handleInstall}
            loading={status === "downloading"}
          >
            下载并重启安装
          </Button>
        </Space>
      }
    />
  );
}

export default UpdateBanner;
```

Update `/Users/mlt/codebases/bs-tools/src/App.tsx`:

```tsx
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { Layout, Menu } from "antd";
import {
  QrcodeOutlined,
  UnorderedListOutlined,
  DiffOutlined,
} from "@ant-design/icons";
import QrCode from "./pages/QrCode";
import MenuParser from "./pages/MenuParser";
import DiffTool from "./pages/DiffTool";
import UpdateBanner from "./components/UpdateBanner";
import "./App.css";

const { Sider, Content } = Layout;

const menuItems = [
  { key: "/", icon: <QrcodeOutlined />, label: "二维码生成" },
  { key: "/menu-parser", icon: <UnorderedListOutlined />, label: "菜单解析" },
  { key: "/diff", icon: <DiffOutlined />, label: "文件对比" },
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider width={180} theme="light" style={{ borderRight: "1px solid #f0f0f0" }}>
        <div className="app-logo">BS Tools</div>
        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderRight: 0 }}
        />
      </Sider>
      <Layout>
        <Content className="app-content">
          <UpdateBanner />
          <Routes>
            <Route path="/" element={<QrCode />} />
            <Route path="/menu-parser" element={<MenuParser />} />
            <Route path="/diff" element={<DiffTool />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default App;
```

- [ ] **Step 5: Run the frontend tests and type/build verification**

Run:

```bash
pnpm install
pnpm test:unit
pnpm build
```

Expected:
- `pnpm test:unit` reports `2 passed`
- `pnpm build` completes without TypeScript or Vite errors

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/lib/updater.ts src/lib/updater.test.ts src/components/UpdateBanner.tsx src/App.tsx
git commit -m "feat: add in-app update banner"
```

### Task 4: Add Nightly macOS GitHub Release Publishing

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/.github/workflows/macos-nightly.yml`
- Test: `/Users/mlt/codebases/bs-tools/.github/workflows/macos-nightly.yml`

- [ ] **Step 1: Write the workflow file that rebuilds the rolling `nightly` prerelease on every `main` push**

Create `/Users/mlt/codebases/bs-tools/.github/workflows/macos-nightly.yml`:

```yaml
name: macos-nightly

on:
  push:
    branches:
      - main

permissions:
  contents: write

jobs:
  build-nightly:
    runs-on: macos-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
      APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
      APPLE_API_KEY_CONTENT: ${{ secrets.APPLE_API_KEY_CONTENT }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: ./src-tauri -> target

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Run checks
        run: pnpm check

      - name: Restore App Store Connect API key
        run: |
          if [ -n "${APPLE_API_KEY_CONTENT}" ]; then
            KEY_PATH="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY}.p8"
            printf '%s' "${APPLE_API_KEY_CONTENT}" > "$KEY_PATH"
            echo "APPLE_API_KEY_PATH=$KEY_PATH" >> "$GITHUB_ENV"
          fi

      - name: Import Apple certificate
        if: env.APPLE_CERTIFICATE != ''
        run: |
          echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -t 3600 -u build.keychain
          security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain

      - name: Build macOS bundle
        run: pnpm tauri build --bundles app,dmg

      - name: Collect nightly assets
        run: |
          mkdir -p release-assets
          find src-tauri/target/release/bundle -type f \
            \( -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.app.tar.gz.sig' \) \
            -exec cp {} release-assets/ \;
          ls -la release-assets

      - name: Create nightly release if missing
        run: |
          gh release view nightly >/dev/null 2>&1 || \
          gh release create nightly --prerelease --title "BS Tools Nightly" --notes "Rolling macOS build from main"

      - name: Upload nightly assets
        run: |
          gh release upload nightly release-assets/* --clobber
          gh release edit nightly --notes "Commit: $GITHUB_SHA"
```

- [ ] **Step 2: Verify the workflow syntax locally**

Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/macos-nightly.yml"); puts "ok"'`

Expected: prints `ok`

- [ ] **Step 3: Trigger the workflow once after it lands on `main`**

Run:

```bash
gh workflow run macos-nightly.yml --ref main
```

Expected in GitHub Actions:
- workflow `macos-nightly` runs against `main`
- GitHub Release `nightly` exists
- `nightly` contains at least one `.dmg` and the updater `.app.tar.gz` + `.sig`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/macos-nightly.yml
git commit -m "ci: add nightly macos release workflow"
```

### Task 5: Add Stable Release Publishing For Auto-Updates

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/.github/workflows/release-stable.yml`
- Test: `/Users/mlt/codebases/bs-tools/.github/workflows/release-stable.yml`

- [ ] **Step 1: Write the stable release workflow**

Create `/Users/mlt/codebases/bs-tools/.github/workflows/release-stable.yml`:

```yaml
name: release-stable

on:
  push:
    tags:
      - "v*"

permissions:
  contents: write

jobs:
  publish-tauri:
    runs-on: macos-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
      TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
      APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
      APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
      KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
      APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
      APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
      APPLE_API_KEY_CONTENT: ${{ secrets.APPLE_API_KEY_CONTENT }}
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: ./src-tauri -> target

      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile

      - name: Run checks
        run: pnpm check

      - name: Restore App Store Connect API key
        run: |
          KEY_PATH="$RUNNER_TEMP/AuthKey_${APPLE_API_KEY}.p8"
          printf '%s' "${APPLE_API_KEY_CONTENT}" > "$KEY_PATH"
          echo "APPLE_API_KEY_PATH=$KEY_PATH" >> "$GITHUB_ENV"

      - name: Import Apple certificate
        run: |
          echo "$APPLE_CERTIFICATE" | base64 --decode > certificate.p12
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -t 3600 -u build.keychain
          security import certificate.p12 -k build.keychain -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
          security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" build.keychain
          CERT_INFO=$(security find-identity -v -p codesigning build.keychain | head -n 1)
          CERT_ID=$(echo "$CERT_INFO" | awk -F'"' '{print $2}')
          echo "APPLE_SIGNING_IDENTITY=$CERT_ID" >> "$GITHUB_ENV"

      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
          APPLE_SIGNING_IDENTITY: ${{ env.APPLE_SIGNING_IDENTITY }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
          APPLE_API_KEY: ${{ secrets.APPLE_API_KEY }}
          APPLE_API_KEY_PATH: ${{ env.APPLE_API_KEY_PATH }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: "BS Tools ${{ github.ref_name }}"
          releaseBody: "Stable macOS release for BS Tools."
          releaseDraft: false
          prerelease: false
          projectPath: .
          uploadUpdaterJson: true
          args: --bundles app,dmg
```

- [ ] **Step 2: Prepare the operator flow for stable releases**

Run:

```bash
pnpm release:version 0.2.0
pnpm check
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: release v0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

Expected in GitHub:
- workflow `release-stable` runs on tag `v0.2.0`
- GitHub Release `v0.2.0` contains `.dmg`, `.app.tar.gz`, `.app.tar.gz.sig`, and `latest.json`
- installed apps using the updater see `v0.2.0` as available

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release-stable.yml
git commit -m "ci: add stable tauri release workflow"
```

### Task 6: Document Secrets, Release Flow, and Recovery

**Files:**
- Create: `/Users/mlt/codebases/bs-tools/docs/release-and-update.md`
- Modify: `/Users/mlt/codebases/bs-tools/README.md`
- Test: `/Users/mlt/codebases/bs-tools/docs/release-and-update.md`

- [ ] **Step 1: Write the release/update runbook**

Create `/Users/mlt/codebases/bs-tools/docs/release-and-update.md`:

```md
# Release And Update Runbook

## GitHub Secrets

- `TAURI_SIGNING_PRIVATE_KEY`: output of `pnpm tauri signer generate`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password used for the private key
- `APPLE_CERTIFICATE`: base64-encoded `.p12` Developer ID Application certificate
- `APPLE_CERTIFICATE_PASSWORD`: password used when exporting the `.p12`
- `KEYCHAIN_PASSWORD`: temporary CI keychain password
- `APPLE_API_ISSUER`: App Store Connect issuer id
- `APPLE_API_KEY`: App Store Connect key id
- `APPLE_API_KEY_CONTENT`: raw contents of the downloaded `.p8` API key file

## Everyday Development

1. Merge code into `main`.
2. GitHub Actions refreshes the `nightly` prerelease with the newest macOS installer.
3. QA downloads `nightly` assets directly from GitHub Releases.

## Stable Release

1. Run `pnpm release:version X.Y.Z`.
2. Run `pnpm check`.
3. Commit the version bump.
4. Create and push tag `vX.Y.Z`.
5. Wait for `release-stable` to publish the signed installer and `latest.json`.

## How Auto-Update Works

- The app checks `https://github.com/cyhndaugust/bs-tools/releases/latest/download/latest.json`.
- Tauri validates the response with the public key committed in `src-tauri/updater-public-key.pem`.
- Users install the update inside the app, then the app restarts.

## Recovery

- If `nightly` upload fails, re-run `macos-nightly` from GitHub Actions.
- If `latest.json` is missing on a stable release, verify `uploadUpdaterJson: true` and that updater signing env vars were present.
- If notarization fails, check the Apple certificate, Team/App Store Connect credentials, and the selected signing identity in the workflow logs.
```

- [ ] **Step 2: Link the runbook from the README**

Append to `/Users/mlt/codebases/bs-tools/README.md`:

```md
## Release

- Release and auto-update operations are documented in [docs/release-and-update.md](docs/release-and-update.md).
```

- [ ] **Step 3: Verify the docs reference paths that exist**

Run: `rg -n "release-and-update|updater-public-key|release-stable|macos-nightly" README.md docs/release-and-update.md`

Expected: all four strings are found in the docs

- [ ] **Step 4: Commit**

```bash
git add README.md docs/release-and-update.md
git commit -m "docs: add release and updater runbook"
```

### Task 7: Final End-to-End Verification

**Files:**
- Test: `/Users/mlt/codebases/bs-tools/package.json`
- Test: `/Users/mlt/codebases/bs-tools/src-tauri/tauri.conf.json`
- Test: `/Users/mlt/codebases/bs-tools/.github/workflows/macos-nightly.yml`
- Test: `/Users/mlt/codebases/bs-tools/.github/workflows/release-stable.yml`

- [ ] **Step 1: Run the full local verification suite**

Run:

```bash
pnpm install --frozen-lockfile
pnpm check
```

Expected:
- Node metadata sync test passes
- Vitest updater test passes
- frontend build passes
- Rust `cargo check` passes

- [ ] **Step 2: Build a local macOS bundle once on a Mac**

Run: `pnpm tauri build --bundles app,dmg`

Expected:
- `.dmg` exists under `src-tauri/target/release/bundle/dmg/`
- updater artifacts exist under `src-tauri/target/release/bundle/macos/`

- [ ] **Step 3: Smoke test the updater against a real stable release**

1. Install the currently released app from GitHub Release `v0.2.0`.
2. Publish `v0.2.1` with `pnpm release:version 0.2.1`, commit, tag, and push.
3. Launch the old app.
4. Confirm the update banner appears.
5. Click `下载并重启安装`.

Expected:
- the app downloads `latest.json`
- signature verification succeeds
- the app restarts into `0.2.1`

- [ ] **Step 4: Commit**

Run: `git status --short`

Expected: no output

## Self-Review

- Spec coverage: the plan covers automatic macOS packaging to GitHub Releases, a rolling build after each `main` change, and Tauri auto-update plumbing for stable releases.
- Placeholders scan: removed plan placeholders; updater key material is generated directly by the command in Task 2 Step 1 instead of being hand-typed.
- Type consistency: the updater module exports `formatUpdateBody` and `fetchAvailableUpdate`, and the UI consumes exactly those names.
