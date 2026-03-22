/**
 * Fuzzy matching utility for file paths.
 * Optimized for file picker use case with filename priority.
 */

import type { IndexedFile } from "../../services/converted-session-types.js";

export type FuzzyMatchResult = {
	item: IndexedFile;
	score: number;
};

/**
 * Extract filename from a path.
 */
function getFileName(path: string): string {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
}

/**
 * Calculate fuzzy match score for a query against a file.
 * Returns null if no match, or a score (higher = better match).
 */
function calculateScore(query: string, file: IndexedFile): number | null {
	const lowerQuery = query.toLowerCase();
	const fileName = getFileName(file.path).toLowerCase();
	const filePath = file.path.toLowerCase();

	// Try exact substring match on filename first (highest priority)
	const fileNameIndex = fileName.indexOf(lowerQuery);
	if (fileNameIndex >= 0) {
		// Earlier match in filename = better score
		return 1000 + (100 - fileNameIndex);
	}

	// Try exact substring match on full path
	const pathIndex = filePath.indexOf(lowerQuery);
	if (pathIndex >= 0) {
		return 500 + (100 - pathIndex);
	}

	// Try fuzzy match on filename
	let queryIdx = 0;
	let score = 0;
	let consecutiveBonus = 0;

	for (let i = 0; i < fileName.length && queryIdx < lowerQuery.length; i++) {
		if (fileName[i] === lowerQuery[queryIdx]) {
			score += 10 + consecutiveBonus;
			consecutiveBonus += 5; // Reward consecutive matches
			queryIdx++;
		} else {
			consecutiveBonus = 0;
		}
	}

	if (queryIdx === lowerQuery.length) {
		return score;
	}

	// Fall back to full path fuzzy match
	queryIdx = 0;
	score = 0;
	consecutiveBonus = 0;

	for (let i = 0; i < filePath.length && queryIdx < lowerQuery.length; i++) {
		if (filePath[i] === lowerQuery[queryIdx]) {
			score += 1 + consecutiveBonus;
			consecutiveBonus += 1;
			queryIdx++;
		} else {
			consecutiveBonus = 0;
		}
	}

	return queryIdx === lowerQuery.length ? score : null;
}

/**
 * Filter and sort files by fuzzy match score.
 *
 * @param query - The search query
 * @param files - Array of indexed files to search
 * @param maxResults - Maximum number of results to return (default: 100)
 * @returns Sorted array of matching files with scores
 */
export function fuzzyMatchFiles(
	query: string,
	files: IndexedFile[],
	maxResults = 100
): FuzzyMatchResult[] {
	// If no query, return first N files sorted by path length (shorter = more relevant)
	if (!query) {
		return files
			.slice(0, maxResults)
			.sort((a, b) => a.path.length - b.path.length)
			.map((item) => ({ item, score: 0 }));
	}

	const results: FuzzyMatchResult[] = [];

	for (const file of files) {
		const score = calculateScore(query, file);
		if (score !== null) {
			results.push({ item: file, score });
		}
	}

	// Sort by score descending, then by path length (shorter = better)
	results.sort((a, b) => {
		if (b.score !== a.score) {
			return b.score - a.score;
		}
		return a.item.path.length - b.item.path.length;
	});

	return results.slice(0, maxResults);
}
