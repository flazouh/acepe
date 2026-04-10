import { conductorComparison } from "./conductor.js";
import { cursorComparison } from "./cursor.js";
import { onecodeComparison } from "./onecode.js";
import { supersetComparison } from "./superset.js";
import { t3Comparison } from "./t3.js";
import type { ComparisonData } from "./types.js";

const allComparisons: readonly ComparisonData[] = [
	cursorComparison,
	supersetComparison,
	onecodeComparison,
	t3Comparison,
	conductorComparison,
];

const comparisons: ReadonlyMap<string, ComparisonData> = new Map(
	allComparisons
		.filter((comparison) => comparison.verificationStatus === "verified")
		.map((comparison) => [comparison.slug, comparison])
);

export function getComparison(slug: string): ComparisonData | null {
	return comparisons.get(slug) ?? null;
}

export function getAllComparisonSlugs(): readonly string[] {
	return Array.from(comparisons.keys());
}
