import { render } from "svelte/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("$lib/components/header.svelte", async () => ({
	default: (await import("../compare/[slug]/test-fixtures/header-stub.svelte")).default,
}));

const { default: Page } = await import("./+page.svelte");

describe("homepage performance contract", () => {
	it("keeps heavyweight below-fold demos out of the initial server render", () => {
		const { body } = render(Page, {
			props: {
				data: {
					featureFlags: {
						loginEnabled: false,
						downloadEnabled: true,
						roadmapEnabled: false,
					},
					githubStars: null,
				},
			},
		});

		expect(body).toContain('data-lazy-feature-demo="Kanban board demo"');
		expect(body).not.toContain("SELECT * FROM users WHERE plan = 'pro' LIMIT 10;");
		expect(body).not.toContain("Should I use JWT or session cookies for the new auth layer?");
	});
});
