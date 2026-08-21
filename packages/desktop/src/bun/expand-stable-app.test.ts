import { expect, test } from "bun:test";
import { macosDirHasNativeWrapper, resolveZigZstd, runExpandStableApp, defaultStableAppPath, spawnFailureReason, prepareBuiltMacApp } from "./expand-stable-app.ts";

test("macosDirHasNativeWrapper is true when the dylib sits next to launcher", () => {
	expect(
		macosDirHasNativeWrapper("/tmp/Acepe.app/Contents/MacOS", (path) =>
			path.endsWith("libNativeWrapper.dylib"),
		),
	).toBe(true);
	expect(macosDirHasNativeWrapper("/tmp/Acepe.app/Contents/MacOS", () => false)).toBe(false);
});

test("runExpandStableApp expands an extractor wrapper into the real Acepe.app", () => {
	const calls: Array<string> = [];
	const result = runExpandStableApp({
		appPath: "/build/Acepe.app",
		extractDir: "/tmp/expand",
		electrobunDir: "/node_modules/electrobun",
		fs: {
			list: (dir) => (dir.endsWith("Resources") ? ["abc.tar.zst"] : ["dist-macos-arm64"]),
			exists: (path) => path.endsWith("Resources") || path.endsWith("abc.tar.zst"),
			mkdir: (dir) => {
				calls.push(`mkdir:${dir}`);
			},
			decompressZst: (zst, tar) => {
				calls.push(`decompress:${zst}->${tar}`);
			},
			extractTar: (tar, dest) => {
				calls.push(`extract:${tar}->${dest}`);
			},
			replaceAppBundle: (from, to) => {
				calls.push(`replace:${from}->${to}`);
			},
		},
	});
	expect(result).toBe("expanded");
	expect(calls).toEqual([
		"mkdir:/tmp/expand",
		"decompress:/build/Acepe.app/Contents/Resources/abc.tar.zst->/tmp/expand/bundle.tar",
		"extract:/tmp/expand/bundle.tar->/tmp/expand",
		"replace:/tmp/expand/Acepe.app->/build/Acepe.app",
	]);
});

test("resolveZigZstd finds the platform binary under electrobun", () => {
	expect(
		resolveZigZstd("/node_modules/electrobun", {
			list: () => ["dist", "dist-macos-arm64"],
			exists: (path) =>
				path === "/node_modules/electrobun" ||
				path === "/node_modules/electrobun/dist-macos-arm64/zig-zstd",
		}),
	).toBe("/node_modules/electrobun/dist-macos-arm64/zig-zstd");
});

test("defaultStableAppPath points at the stable macos arm64 bundle", () => {
	expect(defaultStableAppPath("/repo/packages/desktop")).toBe(
		"/repo/packages/desktop/electrobun-build/stable-macos-arm64/Acepe.app",
	);
});

test("spawnFailureReason names the failed action", () => {
	expect(spawnFailureReason("zstd decompress", "no such file")).toBe(
		"zstd decompress failed: no such file",
	);
});

test("prepareBuiltMacApp makes the worker loud, names the GUI Acepe, and rewrites kit assets", () => {
	const prepared = prepareBuiltMacApp({
		mainJs: `new Worker(appEntrypointPath, {});\nlib.symbols.startEventLoop();\n`,
		macosFilenames: ["launcher", "bun", "libNativeWrapper.dylib"],
		indexHtml: `<link href="/_app/immutable/entry/start.js" rel="modulepreload">`,
	});
	expect(prepared.mainJs !== null && prepared.mainJs.includes('stdout: "inherit"')).toBe(true);
	expect(prepared.renameGuiProcess).toBe(true);
	expect(prepared.bunWrapper).toContain("Acepe");
	expect(prepared.indexHtml !== null && prepared.indexHtml.includes("desktop round trip")).toBe(
		true,
	);
	expect(prepared.indexHtml).toContain('href="./_app/immutable/entry/start.js"');
});
