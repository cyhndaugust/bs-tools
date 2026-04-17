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

export async function releaseVersion(nextVersion, targetRootDir = rootDir) {
  assertSemver(nextVersion);

  const packageJsonPath = path.join(targetRootDir, "package.json");
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const previousVersion = packageJson.version;
  packageJson.version = nextVersion;

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  try {
    await syncReleaseMetadata(targetRootDir);
  } catch (error) {
    packageJson.version = previousVersion;
    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    throw error;
  }
}

async function main() {
  const nextVersion = process.argv[2];
  await releaseVersion(nextVersion, rootDir);

  console.log(`Prepared release v${nextVersion}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
