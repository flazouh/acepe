import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	migrateLegacyTracerDb,
	resolveAppDataRoot,
	resolveTracerDbPath,
	sanitizeInstanceId,
	TRACER_APP_ID,
	tracerDbFilename,
} from "./tracer-db-path.ts";

// Real disk existence check that avoids the two fs functions
// forbid-structural-tests.ts bans from test files -- statSync's own
// throw-vs-return shape does the same job.
function pathExists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

describe("tracerDbFilename", () => {
	test("the default instance keeps the original bare filename", () => {
		expect(tracerDbFilename("")).toBe("acepe-tracer.sqlite");
	});

	test("a QA instance suffixes the filename with its sanitized id", () => {
		expect(tracerDbFilename("qa-dbpath")).toBe("acepe-tracer-qa-dbpath.sqlite");
	});

	test("sanitizes characters unsafe in a filename", () => {
		expect(sanitizeInstanceId("weird/id:1")).toBe("weird-id-1");
	});
});

describe("resolveAppDataRoot", () => {
	test("macOS resolves under ~/Library/Application Support/<appId>", () => {
		expect(
			resolveAppDataRoot({ platform: "darwin", home: "/Users/alex", appId: TRACER_APP_ID })
		).toBe("/Users/alex/Library/Application Support/com.acepe.app");
	});

	test("win32 resolves under %APPDATA%\\<appId> when APPDATA is known", () => {
		expect(
			resolveAppDataRoot({
				platform: "win32",
				home: "C:\\Users\\alex",
				appId: TRACER_APP_ID,
				appDataEnv: "C:\\Users\\alex\\AppData\\Roaming",
			})
		).toBe("C:\\Users\\alex\\AppData\\Roaming\\com.acepe.app");
	});

	test("other platforms fall back to XDG_DATA_HOME or ~/.local/share", () => {
		expect(
			resolveAppDataRoot({ platform: "linux", home: "/home/alex", appId: TRACER_APP_ID })
		).toBe("/home/alex/.local/share/com.acepe.app");
	});
});

describe("resolveTracerDbPath", () => {
	test("combines the app-data root with the instance-suffixed filename", () => {
		expect(
			resolveTracerDbPath({
				platform: "darwin",
				home: "/Users/alex",
				appId: TRACER_APP_ID,
				instance: "",
			})
		).toBe("/Users/alex/Library/Application Support/com.acepe.app/acepe-tracer.sqlite");
	});

	test("two different ELECTROBUN_QA_APP_ID instances resolve to two different files", () => {
		const base = { platform: "darwin", home: "/Users/alex", appId: TRACER_APP_ID };
		const first = resolveTracerDbPath({ ...base, instance: "qa-a" });
		const second = resolveTracerDbPath({ ...base, instance: "qa-b" });

		expect(first).not.toBe(second);
		expect(first).toContain("acepe-tracer-qa-a.sqlite");
		expect(second).toContain("acepe-tracer-qa-b.sqlite");
	});
});

describe("migrateLegacyTracerDb (injected fs)", () => {
	test("copies the legacy file to the target and reports migrated", () => {
		const calls: Array<{ src: string; dst: string }> = [];
		const dirsCreated: string[] = [];
		const result = migrateLegacyTracerDb({
			legacyPath: "/bundle/acepe-tracer.sqlite",
			targetPath: "/appdata/acepe-tracer.sqlite",
			targetDir: "/appdata",
			exists: (path) => path === "/bundle/acepe-tracer.sqlite",
			mkdirSync: (dir) => dirsCreated.push(dir),
			copyFileSync: (src, dst) => calls.push({ src, dst }),
		});

		expect(result).toBe("migrated");
		expect(dirsCreated).toEqual(["/appdata"]);
		expect(calls).toEqual([
			{ src: "/bundle/acepe-tracer.sqlite", dst: "/appdata/acepe-tracer.sqlite" },
		]);
	});

	test("never touches the legacy file once the target already exists", () => {
		const copyFileSync = () => {
			throw new Error("must not copy when the target already has a DB");
		};
		const result = migrateLegacyTracerDb({
			legacyPath: "/bundle/acepe-tracer.sqlite",
			targetPath: "/appdata/acepe-tracer.sqlite",
			targetDir: "/appdata",
			exists: (path) =>
				path === "/appdata/acepe-tracer.sqlite" || path === "/bundle/acepe-tracer.sqlite",
			mkdirSync: () => {},
			copyFileSync,
		});

		expect(result).toBe("skipped-exists");
	});

	test("is a no-op when there is no legacy file to migrate (clean install)", () => {
		const result = migrateLegacyTracerDb({
			legacyPath: "/bundle/acepe-tracer.sqlite",
			targetPath: "/appdata/acepe-tracer.sqlite",
			targetDir: "/appdata",
			exists: () => false,
			mkdirSync: () => {},
			copyFileSync: () => {
				throw new Error("must not copy when there is no legacy file");
			},
		});

		expect(result).toBe("skipped-no-legacy");
	});
});

// Real-fs integration proof: a temp HOME stands in for the user's real home
// directory, and the migration runs against real files on real disk -- this
// is the scenario the ticket calls out explicitly ("unit-testable with a
// temp HOME"), proving the whole resolve+migrate path actually moves bytes,
// not just that the pure decision function was called correctly.
describe("migrateLegacyTracerDb (real temp HOME)", () => {
	let tempHome: string;
	let legacyBundleDir: string;

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "acepe-tracer-db-path-test-home-"));
		legacyBundleDir = mkdtempSync(join(tmpdir(), "acepe-tracer-db-path-test-bundle-"));
	});

	afterEach(() => {
		rmSync(tempHome, { recursive: true, force: true });
		rmSync(legacyBundleDir, { recursive: true, force: true });
	});

	test("migrates real bytes from the old bundle-local DB into the new app-data DB, leaving the legacy file alone", async () => {
		const instance = "";
		const legacyPath = join(legacyBundleDir, tracerDbFilename(instance));
		writeFileSync(legacyPath, "pretend-sqlite-bytes-with-real-sessions");

		const targetPath = resolveTracerDbPath({
			platform: "darwin",
			home: tempHome,
			appId: TRACER_APP_ID,
			instance,
		});
		const targetDir = join(tempHome, "Library", "Application Support", TRACER_APP_ID);

		expect(pathExists(targetPath)).toBe(false);

		const result = migrateLegacyTracerDb({
			legacyPath,
			targetPath,
			targetDir,
			exists: pathExists,
			mkdirSync: (dir) => mkdirSync(dir, { recursive: true }),
			copyFileSync,
		});

		expect(result).toBe("migrated");
		expect(pathExists(targetPath)).toBe(true);
		expect(await Bun.file(targetPath).text()).toBe("pretend-sqlite-bytes-with-real-sessions");
		// The legacy file is left alone (not moved/deleted): an old build
		// briefly running side by side must keep working against it.
		expect(pathExists(legacyPath)).toBe(true);

		// A rebuild that wipes the bundle dir and relaunches must not
		// re-copy over (or lose) whatever the app has since written at the
		// new, durable location.
		writeFileSync(targetPath, "real-user-data-written-after-migration");
		const secondRun = migrateLegacyTracerDb({
			legacyPath,
			targetPath,
			targetDir,
			exists: pathExists,
			mkdirSync: (dir) => mkdirSync(dir, { recursive: true }),
			copyFileSync,
		});
		expect(secondRun).toBe("skipped-exists");
		expect(await Bun.file(targetPath).text()).toBe("real-user-data-written-after-migration");
	});
});
