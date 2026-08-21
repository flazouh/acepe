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

