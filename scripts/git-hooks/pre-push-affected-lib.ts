export type Affected = {
	desktopFrontend: boolean;
	website: boolean;
	ui: boolean;
	rootScripts: boolean;
	shared: boolean;
	electrobunShell: boolean;
};

function matchesAny(files: readonly string[], prefixes: readonly string[]): boolean {
	return files.some((file) => prefixes.some((prefix) => file === prefix || file.startsWith(prefix)));
}

function isDesktopFrontend(file: string): boolean {
	return file.startsWith("packages/desktop/");
}

export function classifyPushFiles(files: readonly string[]): Affected {
	return {
		desktopFrontend: files.some(isDesktopFrontend),
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
		electrobunShell: matchesAny(files, [
			"packages/electrobun-shell/",
			"packages/desktop/electrobun.config.ts",
			"packages/desktop/src/bun/",
			"scripts/build-electrobun.sh",
			"scripts/demo-electrobun-update.sh",
		]),
	};
}

export function shouldRunDesktop(affected: Affected): boolean {
	return (
		affected.desktopFrontend || affected.ui || affected.rootScripts || affected.shared
	);
}

export function shouldRunWebsite(affected: Affected): boolean {
	return affected.website || affected.ui || affected.shared;
}

export function shouldRunUi(affected: Affected): boolean {
	return affected.ui || affected.rootScripts || affected.shared;
}

export function shouldRunElectrobunShell(affected: Affected): boolean {
	return affected.electrobunShell || affected.shared;
}
