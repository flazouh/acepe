export type DesktopShellKind = "pending" | "electrobun" | "tauri";

export const isElectrobunShellWindow = (input: {
	readonly protocol: string;
	readonly search: string;
	readonly hasElectrobunGlobal: boolean;
}): boolean => {
	if (input.protocol === "views:") {
		return true;
	}
	if (input.search.includes("slice=tracer") === true) {
		return true;
	}
	return input.hasElectrobunGlobal;
};

export const desktopShellKind = (
	windowFacts: {
		readonly protocol: string;
		readonly search: string;
		readonly hasElectrobunGlobal: boolean;
	} | null,
): DesktopShellKind => {
	if (windowFacts === null) {
		return "pending";
	}
	if (isElectrobunShellWindow(windowFacts) === true) {
		return "electrobun";
	}
	return "tauri";
};

