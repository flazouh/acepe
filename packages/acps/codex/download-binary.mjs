import { copyFileSync, mkdirSync, chmodSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Allow CI to override target platform (e.g. CODEX_ACP_TARGET=darwin-x64)
const target =
  process.env.CODEX_ACP_TARGET || `${process.platform}-${process.arch}`;

const packageName = `@zed-industries/codex-acp-${target}`;
const binaryName = process.platform === "win32" ? "codex-acp.exe" : "codex-acp";

let sourcePath;
try {
  const pkgDir = dirname(require.resolve(`${packageName}/package.json`));
  sourcePath = join(pkgDir, "bin", binaryName);
} catch {
  console.error(`Could not resolve ${packageName}. Is it installed?`);
  console.error(`Platform: ${process.platform}, Arch: ${process.arch}`);
  process.exit(1);
}

if (!existsSync(sourcePath)) {
  console.error(`Binary not found at ${sourcePath}`);
  process.exit(1);
}

const destDir = join(__dirname, "bin");
const destPath = join(destDir, "codex-acp");

mkdirSync(destDir, { recursive: true });
copyFileSync(sourcePath, destPath);
chmodSync(destPath, 0o755);

console.log(`Copied ${packageName} binary to ${destPath}`);
