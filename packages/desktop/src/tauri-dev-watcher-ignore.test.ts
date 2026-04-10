import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

const GIT_EXECUTABLE = "/usr/bin/git";
const DESKTOP_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(import.meta.dir, "../../..");
const tempRepos: string[] = [];

function readDesktopFile(relativePath: string): string {
	return readFileSync(resolve(DESKTOP_ROOT, relativePath), "utf8");
}

function createTempRepo(): string {
	const tempRepo = mkdtempSync(resolve(tmpdir(), "acepe-tauri-ignore-"));
	tempRepos.push(tempRepo);

	const initResult = spawnSync(GIT_EXECUTABLE, ["init", "-q"], {
		cwd: tempRepo,
		encoding: "utf8",
	});

	if (initResult.status !== 0) {
		throw new Error(`git init failed: ${initResult.stderr}`);
	}

	return tempRepo;
}

function installTaurignore(tempRepo: string, repoRelativePath: string): void {
	const sourcePath = resolve(REPO_ROOT, repoRelativePath);
	expect(existsSync(sourcePath)).toBe(true);

	const targetPath = resolve(tempRepo, dirname(repoRelativePath), ".gitignore");
	mkdirSync(dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, readFileSync(sourcePath, "utf8"));
}

function writeFixture(tempRepo: string, repoRelativePath: string): void {
	const targetPath = resolve(tempRepo, repoRelativePath);
	mkdirSync(dirname(targetPath), { recursive: true });
	writeFileSync(targetPath, "fixture\n");
}

function isIgnored(tempRepo: string, repoRelativePath: string): boolean {
	const result = spawnSync(GIT_EXECUTABLE, ["check-ignore", "-v", repoRelativePath], {
		cwd: tempRepo,
		encoding: "utf8",
	});

	if (result.status === 0) {
		return true;
	}

	if (result.status === 1) {
		return false;
	}

	throw new Error(
		`git check-ignore failed for ${repoRelativePath}: ${result.stderr}${result.stdout}`
	);
}

afterEach(() => {
	while (tempRepos.length > 0) {
		const tempRepo = tempRepos.pop();
		if (tempRepo) {
			rmSync(tempRepo, { force: true, recursive: true });
		}
	}
});

describe("tauri dev watcher ignore config", () => {
	it("uses filename-based .taurignore discovery for tauri dev", () => {
		const packageJsonSource = readDesktopFile("package.json");

		expect(packageJsonSource).toContain("TAURI_CLI_WATCHER_IGNORE_FILENAME=.taurignore");
		expect(packageJsonSource).not.toContain("TAURI_DEV_WATCHER_IGNORE_FILE");
	});

	it("ignores desktop and shared UI frontend sources without ignoring Rust sources", () => {
		const tempRepo = createTempRepo();

		installTaurignore(tempRepo, "packages/.taurignore");
		installTaurignore(tempRepo, "packages/desktop/.taurignore");
		installTaurignore(tempRepo, "packages/desktop/src-tauri/.taurignore");

		writeFixture(tempRepo, "packages/desktop/src/routes/+page.svelte");
		writeFixture(tempRepo, "packages/desktop/src/app.css");
		writeFixture(
			tempRepo,
			"packages/ui/src/components/attention-queue/attention-queue-entry.svelte"
		);
		writeFixture(tempRepo, "packages/desktop/src-tauri/src/lib.rs");
		writeFixture(tempRepo, "packages/desktop/src-tauri/Cargo.toml");

		expect(isIgnored(tempRepo, "packages/desktop/src/routes/+page.svelte")).toBe(true);
		expect(isIgnored(tempRepo, "packages/desktop/src/app.css")).toBe(true);
		expect(
			isIgnored(tempRepo, "packages/ui/src/components/attention-queue/attention-queue-entry.svelte")
		).toBe(true);
		expect(isIgnored(tempRepo, "packages/desktop/src-tauri/src/lib.rs")).toBe(false);
		expect(isIgnored(tempRepo, "packages/desktop/src-tauri/Cargo.toml")).toBe(false);
	});
});
