import { describe, expect, it } from 'vitest';

import { getAllComparisonSlugs, getComparison } from './data.js';

describe('comparison registry', () => {
	it('only exposes comparisons that have been publicly verified', () => {
		expect(getAllComparisonSlugs()).toEqual(['cursor', 'superset', '1code', 't3']);
	});

	it('returns the public competitor data for verified comparison slugs', () => {
		expect(getComparison('cursor')?.competitorName).toBe('Cursor');
		expect(getComparison('superset')?.competitorName).toBe('Superset');
		expect(getComparison('1code')?.competitorName).toBe('1Code');
		expect(getComparison('t3')?.competitorName).toBe('T3');
	});

	it('requires source notes and avoids unsupported hard-negative competitor rows', () => {
		for (const slug of getAllComparisonSlugs()) {
			const comparison = getComparison(slug);

			expect(comparison).not.toBeNull();
			expect(comparison?.competitorUrl).not.toBe('');
			expect(comparison?.sourceNotes.length).toBeGreaterThan(0);
			expect(comparison?.verificationStatus).toBe('verified');

			for (const feature of comparison?.features ?? []) {
				expect(feature.competitor).not.toBe(false);
			}
		}
	});
});