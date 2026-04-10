import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

import { getComparison } from "$lib/compare/data.js";
import type { FeatureFlags } from "$lib/server/feature-flags.js";

vi.mock("$lib/components/header.svelte", async () => ({
	default: (await import("./test-fixtures/header-stub.svelte")).default,
}));

const { default: Page } = await import("./+page.svelte");

describe("compare page verification signals", () => {
	it("shows last verified metadata and source links for verified comparisons", () => {
		const comparison = getComparison("1code");
		const featureFlags: FeatureFlags = {
			loginEnabled: false,
			downloadEnabled: false,
			roadmapEnabled: false,
		};

		expect(comparison).not.toBeNull();

		if (comparison === null) {
			throw new Error("Expected 1Code comparison data to exist");
		}

		const { body } = render(Page, {
			props: {
				data: {
					comparison,
					featureFlags,
					githubStars: null,
				},
			},
		});

		expect(body).toContain("Last verified");
		expect(body).toContain("2026-04-02");
		expect(body).toContain("Sources");
		expect(body).toContain("https://github.com/21st-dev/1Code");
		expect(body).toContain("Verified 1Code public README and repository structure");
		expect(body).toContain("See Acepe features behind this comparison");
		expect(body).toContain("/blog/attention-queue");
		expect(body).toContain("/blog/checkpoints");
		expect(body).toContain("/blog/sql-studio");
	});
});
