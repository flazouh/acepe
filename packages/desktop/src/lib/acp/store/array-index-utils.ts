/**
 * Shared helper for the session-store's lazy Proxy-backed array views (merged
 * snapshots, patched transcript entries, session-cold arrays, reference arrays).
 * Returns the non-negative integer array index a property string denotes, or
 * null when the property is not a canonical array index. Pure.
 */
export function toArrayIndex(property: string): number | null {
	if (property === "") {
		return null;
	}
	const index = Number(property);
	return Number.isInteger(index) && index >= 0 && String(index) === property ? index : null;
}
