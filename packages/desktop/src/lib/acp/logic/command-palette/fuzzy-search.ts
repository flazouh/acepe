/**
 * Generic fuzzy search utility for command palette.
 * Supports searching by label and optional description.
 */

export interface FuzzySearchItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
}

export interface FuzzySearchResult<T extends FuzzySearchItem> {
	readonly item: T;
	readonly score: number;
}

/**
 * Calculate fuzzy match score for a query against text.
 * Returns null if no match, or a score (higher = better match).
 */
function calculateTextScore(query: string, text: string): number | null {
	const lowerQuery = query.toLowerCase();
	const lowerText = text.toLowerCase();

	// Exact substring match (highest priority)
	const exactIndex = lowerText.indexOf(lowerQuery);
	if (exactIndex >= 0) {
		// Earlier match = better score, shorter text = better
		return 1000 + (100 - exactIndex) + (100 - Math.min(text.length, 100));
	}

	// Word start match (e.g., "ct" matches "Create Thread")
	const words = lowerText.split(/\s+/);
	let wordStartScore = 0;
	let queryIdx = 0;

	for (const word of words) {
		if (queryIdx < lowerQuery.length && word.startsWith(lowerQuery[queryIdx])) {
			wordStartScore += 50;
			queryIdx++;
		}
	}

	if (queryIdx === lowerQuery.length) {
		return 500 + wordStartScore;
	}

	// Fuzzy character match
	queryIdx = 0;
	let score = 0;
	let consecutiveBonus = 0;

	for (let i = 0; i < lowerText.length && queryIdx < lowerQuery.length; i++) {
		if (lowerText[i] === lowerQuery[queryIdx]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5;
			queryIdx++;
		} else {
			consecutiveBonus = 0;
		}
	}

	return queryIdx === lowerQuery.length ? score : null;
}

/**
 * Calculate match score for an item against a query.
 * Searches both label and description.
 */
function calculateItemScore<T extends FuzzySearchItem>(query: string, item: T): number | null {
	const labelScore = calculateTextScore(query, item.label);

	if (labelScore !== null) {
		return labelScore;
	}

	// Try description as fallback
	if (item.description) {
		const descScore = calculateTextScore(query, item.description);
		if (descScore !== null) {
			// Description matches are lower priority than label
			return Math.floor(descScore * 0.5);
		}
	}

	return null;
}

/**
 * Filter and sort items by fuzzy match score.
 *
 * @param query - The search query
 * @param items - Array of items to search
 * @param maxResults - Maximum number of results to return (default: 50)
 * @returns Sorted array of matching items with scores
 */
export function fuzzySearch<T extends FuzzySearchItem>(
	query: string,
	items: T[],
	maxResults = 50
): FuzzySearchResult<T>[] {
	// If no query, return items in original order (limited)
	if (!query.trim()) {
		return items.slice(0, maxResults).map((item) => ({ item, score: 0 }));
	}

	const results: FuzzySearchResult<T>[] = [];

	for (const item of items) {
		const score = calculateItemScore(query, item);
		if (score !== null) {
			results.push({ item, score });
		}
	}

	// Sort by score descending
	results.sort((a, b) => b.score - a.score);

	return results.slice(0, maxResults);
}
