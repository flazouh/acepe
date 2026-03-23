/**
 * Lightweight release script — generates next version, bumps tauri.conf.json,
 * commits, tags, and pushes. The GitHub Actions CI workflow handles the rest.
 *
 * Usage: cd scripts/build && bun run release
 */

import { execSync } from "node:child_process";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";

const TAURI_CONFIG_PATH = "packages/desktop/src-tauri/tauri.conf.json";

function getRepoRoot(): string {
  return Path.resolve(import.meta.dirname, "../../..");
}

function generateVersion(repoRoot: string): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  let tags = "";
  try {
    tags = execSync(`git tag -l "v${year}.${month}.*"`, {
      cwd: repoRoot,
      encoding: "utf-8",
    });
  } catch {
    // No tags found
  }

  const tagLines = tags.trim() ? tags.trim().split("\n") : [];
  const maxBuild = tagLines.reduce((max, tag) => {
    const match = tag.match(/^v\d+\.\d+\.(\d+)$/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);

  const version = `${year}.${month}.${maxBuild + 1}`;

  // Check if tag already exists
  try {
    execSync(`git rev-parse "v${version}"`, { cwd: repoRoot, stdio: "pipe" });
    throw new Error(
      `Tag v${version} already exists. Another release may have completed during this run.`
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("already exists")) {
      throw error;
    }
    // Tag doesn't exist — good
  }

  return version;
}

async function main() {
  const repoRoot = getRepoRoot();

  // Check working directory is clean
  const status = execSync("git status --porcelain", {
    cwd: repoRoot,
    encoding: "utf-8",
  });
  if (status.trim()) {
    console.error("Working directory is not clean. Commit or stash changes first.");
    console.error(status);
    process.exit(1);
  }

  // Generate version
  const version = generateVersion(repoRoot);
  console.log(`\nReleasing version: v${version}\n`);

  // Update tauri.conf.json
  const configPath = Path.join(repoRoot, TAURI_CONFIG_PATH);
  const content = await Fs.readFile(configPath, "utf-8");
  const config = JSON.parse(content);
  config.version = version;
  await Fs.writeFile(configPath, JSON.stringify(config, null, 2) + "\n");
  console.log(`Updated ${TAURI_CONFIG_PATH} to version ${version}`);

  // Commit version bump
  execSync(`git add ${TAURI_CONFIG_PATH}`, { cwd: repoRoot, stdio: "inherit" });
  execSync(`git commit -m "release: v${version}"`, { cwd: repoRoot, stdio: "inherit" });

  // Create tag
  execSync(`git tag "v${version}"`, { cwd: repoRoot, stdio: "inherit" });
  console.log(`Created tag v${version}`);

  // Push commit and tag — this triggers the release CI workflow
  execSync("git push", { cwd: repoRoot, stdio: "inherit" });
  execSync("git push --tags", { cwd: repoRoot, stdio: "inherit" });
  console.log(`\nPushed v${version} — CI will build and release to GitHub Releases.`);
}

main().catch((error) => {
  console.error("\nRelease failed:", error.message);
  process.exit(1);
});
