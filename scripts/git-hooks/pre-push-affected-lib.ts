export type Affected = {
	desktopFrontend: boolean;
	desktopRust: boolean;
	website: boolean;
	ui: boolean;
	rootScripts: boolean;
	shared: boolean;
	gpuiPoc: boolean;
};

function matchesAny(
	files: readonly string[],
	prefixes: readonly string[],
): boolean {
	return files.some((file) =>
		prefixes.some((prefix) => file === prefix || file.startsWith(prefix)),
	);
}

function isDesktopFrontend(file: string): boolean {
	return (
		file.startsWith("packages/desktop/") &&
		!file.startsWith("packages/desktop/src-tauri/")
	);
}

export function classifyPushFiles(files: readonly string[]): Affected {
	return {
		desktopFrontend: files.some(isDesktopFrontend),
		desktopRust: matchesAny(files, ["packages/desktop/src-tauri/"]),
		website: matchesAny(files, ["packages/website/"]),
		ui: matchesAny(files, ["packages/ui/"]),
		rootScripts: matchesAny(files, ["scripts/"]),
		shared: matchesAny(files, [
			"bun.lock",
			"package.json",
			".github/workflows/",
			".github/actions/",
			".node-version",
			"coderabbit.yaml",
			"opencode.json",
			"railway.json",
		]),
		gpuiPoc: matchesAny(files, ["packages/gpui-agent-panel-poc/"]),
	};
}

export function shouldRunDesktop(affected: Affected): boolean {
	return (
		affected.desktopFrontend ||
		affected.desktopRust ||
		affected.ui ||
		affected.rootScripts ||
		affected.shared
	);
}

export function shouldRunWebsite(affected: Affected): boolean {
	return affected.website || affected.ui || affected.shared;
}

export function shouldRunUi(affected: Affected): boolean {
	return affected.ui || affected.rootScripts || affected.shared;
}

export function shouldRunTauriBackend(affected: Affected): boolean {
	return affected.desktopRust || affected.shared;
}

export function shouldRunGpuiPoc(affected: Affected): boolean {
	return affected.gpuiPoc;
}
