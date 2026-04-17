import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRoot = path.resolve(__dirname, "..");

function replaceCargoVersion(source, version) {
  const lines = source.split(/\r?\n/);
  let inPackageSection = false;
  let replaced = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inPackageSection = sectionMatch[1].trim() === "package";
      continue;
    }

    if (!inPackageSection || replaced) {
      continue;
    }

    const versionMatch = line.match(/^(\s*version\s*=\s*)"([^"]*)"(\s*(#.*)?)$/);
    if (versionMatch) {
      lines[i] = `${versionMatch[1]}"${version}"${versionMatch[3] ?? ""}`;
      replaced = true;
    }
  }

  if (!replaced) {
    throw new Error("Could not find Cargo package version field in [package] section to update.");
  }

  return source.includes("\r\n") ? `${lines.join("\r\n")}` : `${lines.join("\n")}`;
}

export async function syncReleaseMetadata(rootDir = defaultRoot) {
  const packageJsonPath = path.join(rootDir, "package.json");
  const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
  const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
  const updaterPubkeyPath = path.join(rootDir, "src-tauri", "updater-public-key.pem");

  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const cargoToml = await fs.readFile(cargoTomlPath, "utf8");
  const tauriConf = JSON.parse(await fs.readFile(tauriConfPath, "utf8"));
  const updaterPubkey = (await fs.readFile(updaterPubkeyPath, "utf8")).trim();
  if (!updaterPubkey) {
    throw new Error("Updater public key in src-tauri/updater-public-key.pem is empty.");
  }

  tauriConf.version = packageJson.version;
  tauriConf.plugins ??= {};
  tauriConf.plugins.updater ??= {};
  tauriConf.plugins.updater.pubkey = updaterPubkey;

  await fs.writeFile(cargoTomlPath, replaceCargoVersion(cargoToml, packageJson.version));
  await fs.writeFile(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  syncReleaseMetadata().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
