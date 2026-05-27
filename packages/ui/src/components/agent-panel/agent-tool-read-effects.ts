type ReadExpansionStorage = Pick<Storage, "getItem" | "setItem">;

function getBrowserStorage(): ReadExpansionStorage | null {
	if (typeof localStorage === "undefined") return null;
	if (
		typeof localStorage.getItem !== "function" ||
		typeof localStorage.setItem !== "function"
	) {
		return null;
	}
	return localStorage;
}

export function readPersistedReadExpanded(
	storageKey: string | null,
	storage: ReadExpansionStorage | null = getBrowserStorage()
): boolean {
	if (!storageKey || !storage) return false;
	const stored = storage.getItem(storageKey);
	if (stored === "true") return true;
	return false;
}

export function writePersistedReadExpanded(
	storageKey: string | null,
	expanded: boolean,
	storage: ReadExpansionStorage | null = getBrowserStorage()
): void {
	if (!storageKey || !storage) return;
	storage.setItem(storageKey, expanded ? "true" : "false");
}
