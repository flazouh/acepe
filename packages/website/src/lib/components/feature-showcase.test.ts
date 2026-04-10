import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import FeatureShowcase from "./feature-showcase.svelte";

describe("feature showcase", () => {
	it("defaults to the agent panel tab and renders shared scene content", () => {
		const { body } = render(FeatureShowcase);

		expect(body).toContain("Agent Panel");
		expect(body).toContain("Migrate auth to JWT");
		expect(body).not.toContain("Coming soon");
	});
});
