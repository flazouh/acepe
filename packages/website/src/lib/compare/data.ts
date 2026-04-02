import type { ComparisonData } from "./types.js";
import { cursorComparison } from "./cursor.js";

const comparisons: ReadonlyMap<string, ComparisonData> = new Map([
	[cursorComparison.slug, cursorComparison],
]);

export function getComparison(slug: string): ComparisonData | null {
	return comparisons.get(slug) ?? null;
}

export function getAllComparisonSlugs(): readonly string[] {
	return Array.from(comparisons.keys());
}
