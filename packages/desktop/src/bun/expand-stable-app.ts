import {
	expandStableMacAppIfNeeded,
	findZstFile,
	findZigZstdPath,
	distDirNames,
	NATIVE_WRAPPER_FILENAMES,
	makeLauncherWorkerLoud,
	needsGuiProcessRename,
	bunLauncherWrapperScript,
	GUI_PROCESS_FILENAME,
	BUN_RUNTIME_FILENAME,
	rewriteSvelteKitRootAbsolutePaths,
	injectAcepeShellPingScript,
} from "@acepe/electrobun-shell";

export type ExpandStableAppFs = {
	readonly list: (dir: string) => ReadonlyArray<string>;
	readonly exists: (path: string) => boolean;
	readonly mkdir: (dir: string) => void;
	readonly decompressZst: (zst: string, tar: string) => void;
	readonly extractTar: (tar: string, dest: string) => void;
	readonly replaceAppBundle: (from: string, to: string) => void;
};

export const macosDirHasNativeWrapper = (
	macosDir: string,
	exists: (path: string) => boolean,
): boolean => {
	for (const name of NATIVE_WRAPPER_FILENAMES) {
		if (exists(`${macosDir}/${name}`) === true) {
			return true;
		}
	}
	return false;
};

export const runExpandStableApp = (input: {
	readonly appPath: string;
	readonly extractDir: string;
	readonly electrobunDir: string;
	readonly fs: ExpandStableAppFs;
}): "expanded" | "already-native" => {
	input.fs.mkdir(input.extractDir);
	const macosDir = `${input.appPath}/Contents/MacOS`;
	const resourcesDir = `${input.appPath}/Contents/Resources`;
	const resourceFiles = input.fs.exists(resourcesDir) ? input.fs.list(resourcesDir) : [];
	const zstName = findZstFile(resourceFiles);
	return expandStableMacAppIfNeeded({
		appPath: input.appPath,
		extractDir: input.extractDir,
		macosDirHasNativeWrapper: macosDirHasNativeWrapper(macosDir, input.fs.exists),
		findZst: () => (zstName === null ? null : `${resourcesDir}/${zstName}`),
		decompressZst: input.fs.decompressZst,
		extractTar: input.fs.extractTar,
		replaceAppBundle: input.fs.replaceAppBundle,
		innerAppPath: (extractDir) => `${extractDir}/Acepe.app`,
	});
};

export const resolveZigZstd = (
	electrobunDir: string,
	fs: Pick<ExpandStableAppFs, "list" | "exists">,
): string | null => {
	if (fs.exists(electrobunDir) === false) {
		return null;
	}
	return findZigZstdPath(electrobunDir, distDirNames(fs.list(electrobunDir)), fs.exists);
};

export const defaultStableAppPath = (desktopRoot: string): string =>
	`${desktopRoot}/electrobun-build/stable-macos-arm64/Acepe.app`;

export const spawnFailureReason = (action: string, stderr: string): string =>
	`${action} failed: ${stderr}`;

export type BuiltMacAppFiles = {
	readonly mainJs: string | null;
	readonly macosFilenames: ReadonlyArray<string>;
	readonly indexHtml: string | null;
};

export type PreparedMacApp = {
	readonly mainJs: string | null;
	readonly renameGuiProcess: boolean;
	readonly bunWrapper: string | null;
	readonly indexHtml: string | null;
};

export const prepareBuiltMacApp = (input: BuiltMacAppFiles): PreparedMacApp => {
	const renameGuiProcess = needsGuiProcessRename(input.macosFilenames);
	return {
		mainJs: input.mainJs === null ? null : makeLauncherWorkerLoud(input.mainJs),
		renameGuiProcess,
		bunWrapper: renameGuiProcess === true ? bunLauncherWrapperScript(GUI_PROCESS_FILENAME) : null,
		indexHtml:
			input.indexHtml === null
				? null
				: injectAcepeShellPingScript(rewriteSvelteKitRootAbsolutePaths(input.indexHtml)),
	};
};

if (import.meta.main) {
	const { spawnSync } = await import("node:child_process");
	const { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } =
		await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { dirname, resolve } = await import("node:path");
	const { fileURLToPath } = await import("node:url");
	const { SHELL_STARTUP_FAILED_PREFIX } = await import("@acepe/electrobun-shell");

	const fail = (reason: string): never => {
		process.stderr.write(`${SHELL_STARTUP_FAILED_PREFIX}: ${reason}\n`);
		return process.exit(1);
	};

	const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
	const appPath = defaultStableAppPath(desktopRoot);
	const electrobunDir = resolve(desktopRoot, "node_modules/electrobun");
	const extractDir = `${tmpdir()}/acepe-stable-expand`;
	const zstd = resolveZigZstd(electrobunDir, {
		list: (dir) => readdirSync(dir),
		exists: (path) => existsSync(path),
	});
	if (zstd === null) {
		fail("zig-zstd not found under electrobun dist-*");
	}
	if (existsSync(extractDir) === true) {
		rmSync(extractDir, { recursive: true, force: true });
	}

	const result = runExpandStableApp({
		appPath,
		extractDir,
		electrobunDir,
		fs: {
			list: (dir) => readdirSync(dir),
			exists: (path) => existsSync(path),
			mkdir: (dir) => {
				mkdirSync(dir, { recursive: true });
			},
			decompressZst: (zst, tar) => {
				const decompressed = spawnSync(zstd, ["decompress", "-i", zst, "-o", tar], {
					encoding: "utf8",
				});
				if (decompressed.status !== 0) {
					fail(spawnFailureReason("zstd decompress", decompressed.stderr));
				}
			},
			extractTar: (tar, dest) => {
				const extracted = spawnSync("tar", ["-xf", tar, "-C", dest], { encoding: "utf8" });
				if (extracted.status !== 0) {
					fail(spawnFailureReason("tar extract", extracted.stderr));
				}
			},
			replaceAppBundle: (from, to) => {
				if (existsSync(to) === true) {
					rmSync(to, { recursive: true, force: true });
				}
				renameSync(from, to);
			},
		},
	});
	process.stdout.write(`${result}\n`);

	const macosDir = `${appPath}/Contents/MacOS`;
	const prepared = prepareBuiltMacApp({
		mainJs:
			existsSync(`${appPath}/Contents/Resources/main.js`) === true
				? readFileSync(`${appPath}/Contents/Resources/main.js`, "utf8")
				: null,
		macosFilenames: existsSync(macosDir) === true ? readdirSync(macosDir) : [],
		indexHtml:
			existsSync(`${appPath}/Contents/Resources/app/views/mainview/index.html`) === true
				? readFileSync(`${appPath}/Contents/Resources/app/views/mainview/index.html`, "utf8")
				: null,
	});
	if (prepared.mainJs !== null) {
		writeFileSync(`${appPath}/Contents/Resources/main.js`, prepared.mainJs);
	}
	if (prepared.renameGuiProcess === true && prepared.bunWrapper !== null) {
		renameSync(`${macosDir}/${BUN_RUNTIME_FILENAME}`, `${macosDir}/${GUI_PROCESS_FILENAME}`);
		writeFileSync(`${macosDir}/${BUN_RUNTIME_FILENAME}`, prepared.bunWrapper, { mode: 0o755 });
	}
	if (prepared.indexHtml !== null) {
		writeFileSync(
			`${appPath}/Contents/Resources/app/views/mainview/index.html`,
			prepared.indexHtml,
		);
	}
}
