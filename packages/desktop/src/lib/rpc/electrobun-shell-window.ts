export type DesktopShellKind = "pending" | "electrobun" | "web";

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
	} | null
): DesktopShellKind => {
	if (windowFacts === null) {
		return "pending";
	}
	if (isElectrobunShellWindow(windowFacts) === true) {
		return "electrobun";
	}
	return "web";
};

// HMR: self-accepting, like the rest of src/lib/rpc. Its only state is on
// globalThis (the window.__acepeQa* hooks) / it is pure, so re-evaluating in
// place is safe, and it stops an edit here from propagating to the component
// that imports it and remounting the app.
if (import.meta.hot) {
	import.meta.hot.accept();
}
