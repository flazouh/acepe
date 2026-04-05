import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "bun:test";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const CURRENT_TEST_FILE_PATH = import.meta.filename;
const ROOT_PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const DESKTOP_PACKAGE_JSON_PATH = resolve(REPO_ROOT, "packages/desktop/package.json");
const BUN_LOCK_PATH = resolve(REPO_ROOT, "bun.lock");
const LEGACY_PACKAGE_NAMES = ["lucide-svelte", "phosphor-icons-svelte"];
const SOURCE_FILE_EXTENSIONS = new Set([
	".cjs",
	".cts",
	".js",
	".jsx",
	".mjs",
	".mts",
	".svelte",
	".ts",
	".tsx",
]);
const IGNORED_DIRECTORY_NAMES = new Set([
	".git",
	".svelte-kit",
	"coverage",
	"dist",
	"node_modules",
	"target",
]);
const LEGACY_PACKAGE_PATTERN = LEGACY_PACKAGE_NAMES.join("|");
const LEGACY_IMPORT_PATTERN =
	new RegExp(
		`from\\s+["'](${LEGACY_PACKAGE_PATTERN})["']|import\\s*\\(\\s*["'](${LEGACY_PACKAGE_PATTERN})["']\\s*\\)|require\\s*\\(\\s*["'](${LEGACY_PACKAGE_PATTERN})["']\\s*\\)`
	);

type PackageJson = {
	dependencies?: Record<string, string>;
};

function readPackageJson(path: string): PackageJson {
	return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function collectSourceFilePaths(directoryPath: string): string[] {
	const entries = readdirSync(directoryPath, { withFileTypes: true });
	const filePaths: string[] = [];

	for (const entry of entries) {
		if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
			continue;
		}

		const entryPath = resolve(directoryPath, entry.name);

		if (entry.isDirectory()) {
			filePaths.push(...collectSourceFilePaths(entryPath));
			continue;
		}

		const extensionIndex = entry.name.lastIndexOf(".");
		const extension = extensionIndex === -1 ? "" : entry.name.slice(extensionIndex);

		if (SOURCE_FILE_EXTENSIONS.has(extension)) {
			filePaths.push(entryPath);
		}
	}

	return filePaths;
}

describe("legacy icon package cleanup", () => {
	it("removes the unused legacy dependencies from package manifests", () => {
		const rootPackageJson = readPackageJson(ROOT_PACKAGE_JSON_PATH);
		const desktopPackageJson = readPackageJson(DESKTOP_PACKAGE_JSON_PATH);

		expect(rootPackageJson.dependencies?.["phosphor-icons-svelte"]).toBeUndefined();
		expect(desktopPackageJson.dependencies?.["lucide-svelte"]).toBeUndefined();
	});

	it("does not import the removed legacy icon packages from source files", () => {
		const sourceFilePaths = collectSourceFilePaths(REPO_ROOT);

		for (const sourceFilePath of sourceFilePaths) {
			if (sourceFilePath === CURRENT_TEST_FILE_PATH) {
				continue;
			}

			const source = readFileSync(sourceFilePath, "utf8");

			expect(
				source,
				`File ${sourceFilePath} contains a legacy icon package import`
			).not.toMatch(LEGACY_IMPORT_PATTERN);
		}
	});

	it("removes the legacy icon packages from the Bun lockfile", () => {
		const lockfile = readFileSync(BUN_LOCK_PATH, "utf8");

		expect(lockfile).not.toContain('"phosphor-icons-svelte"');
		expect(lockfile).not.toContain('"lucide-svelte"');
	});
});
