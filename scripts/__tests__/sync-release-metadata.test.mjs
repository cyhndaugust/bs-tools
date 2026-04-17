import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncReleaseMetadata } from "../sync-release-metadata.mjs";
import { releaseVersion } from "../release-version.mjs";

async function createTempReleaseProject({
  packageVersion = "0.1.0",
  cargoToml = '[package]\nname = "bs-tools"\nversion = "0.1.0"\n',
  tauriConf = { version: "0.1.0", plugins: { updater: { pubkey: "" } } },
  updaterPublicKey = "PUBLIC-KEY-CONTENT",
} = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bs-tools-release-"));
  await fs.writeFile(
    path.join(tempRoot, "package.json"),
    JSON.stringify({ version: packageVersion }, null, 2),
  );
  await fs.mkdir(path.join(tempRoot, "src-tauri"), { recursive: true });
  await fs.writeFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), cargoToml);
  await fs.writeFile(
    path.join(tempRoot, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify(tauriConf, null, 2)}\n`,
  );
  await fs.writeFile(path.join(tempRoot, "src-tauri", "updater-public-key.pem"), updaterPublicKey);
  return tempRoot;
}

test("syncReleaseMetadata copies package version and updater public key", async () => {
  const tempRoot = await createTempReleaseProject({ packageVersion: "0.3.0" });

  await syncReleaseMetadata(tempRoot);

  const cargoToml = await fs.readFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), "utf8");
  const tauriConf = JSON.parse(
    await fs.readFile(path.join(tempRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  assert.match(cargoToml, /version = "0.3.0"/);
  assert.equal(tauriConf.version, "0.3.0");
  assert.equal(tauriConf.plugins.updater.pubkey, "PUBLIC-KEY-CONTENT");
});

test("syncReleaseMetadata updates only the [package] version and tolerates spacing differences", async () => {
  const tempRoot = await createTempReleaseProject({
    packageVersion: "0.7.0",
    cargoToml: `[package]
name = "bs-tools"
version= "0.1.0" # keep comment
edition = "2021"

[package.metadata.bundle]
version = "do-not-touch"
`,
  });

  await syncReleaseMetadata(tempRoot);

  const cargoToml = await fs.readFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(cargoToml, /version\s*=\s*"0.7.0"\s*# keep comment/);
  assert.match(cargoToml, /\[package\.metadata\.bundle\]\nversion = "do-not-touch"/);
});

test("syncReleaseMetadata throws when updater public key is empty or whitespace", async () => {
  const tempRoot = await createTempReleaseProject({ updaterPublicKey: "   \n\t  " });

  await assert.rejects(
    syncReleaseMetadata(tempRoot),
    /Updater public key .* empty/i,
  );
});

test("syncReleaseMetadata throws when [package] version is missing in Cargo.toml", async () => {
  const tempRoot = await createTempReleaseProject({
    cargoToml: '[package]\nname = "bs-tools"\nedition = "2021"\n',
  });

  await assert.rejects(
    syncReleaseMetadata(tempRoot),
    /Could not find Cargo package version field in \[package\] section to update\./,
  );
});

test("releaseVersion updates package version and syncs tauri metadata", async () => {
  const tempRoot = await createTempReleaseProject({ updaterPublicKey: "NEXT-PUBLIC-KEY" });

  await releaseVersion("0.4.0", tempRoot);

  const packageJson = JSON.parse(await fs.readFile(path.join(tempRoot, "package.json"), "utf8"));
  const cargoToml = await fs.readFile(path.join(tempRoot, "src-tauri", "Cargo.toml"), "utf8");
  const tauriConf = JSON.parse(
    await fs.readFile(path.join(tempRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );

  assert.equal(packageJson.version, "0.4.0");
  assert.match(cargoToml, /version = "0.4.0"/);
  assert.equal(tauriConf.version, "0.4.0");
  assert.equal(tauriConf.plugins.updater.pubkey, "NEXT-PUBLIC-KEY");
});

test("releaseVersion rejects invalid semver inputs", async () => {
  const tempRoot = await createTempReleaseProject();

  await assert.rejects(
    releaseVersion("1.2", tempRoot),
    /Expected x\.y\.z version, received: 1\.2/,
  );
});

test("releaseVersion rolls back package.json when sync step fails", async () => {
  const tempRoot = await createTempReleaseProject({
    cargoToml: '[package]\nname = "bs-tools"\nedition = "2021"\n',
  });

  await assert.rejects(
    releaseVersion("0.9.0", tempRoot),
    /Could not find Cargo package version field in \[package\] section to update\./,
  );

  const packageJson = JSON.parse(await fs.readFile(path.join(tempRoot, "package.json"), "utf8"));
  assert.equal(packageJson.version, "0.1.0");
});
