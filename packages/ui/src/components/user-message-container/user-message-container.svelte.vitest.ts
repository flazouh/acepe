import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import UserMessageContainerHeaderFixture from "./__tests__/fixtures/user-message-container-header-fixture.svelte";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js",
	);
	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("UserMessageContainer", () => {
	it("uses the tool-card shell: rounded-lg, overflow-hidden, bg-input/50, no border", () => {
		const { getByTestId } = render(UserMessageContainerHeaderFixture, {
			props: {
				headerLabel: "14:32",
				bodyText: "hello",
			},
		});

		const surface = getByTestId("user-message-surface");
		const classes = surface.className;

		expect(classes).toContain("rounded-lg");
		expect(classes).toContain("overflow-hidden");
		expect(classes).toContain("bg-input/50");
		expect(classes).not.toContain("border");
		expect(getByTestId("user-message-header-label").textContent).toBe("14:32");
		expect(surface.textContent).toContain("hello");
		const header = surface.querySelector(":scope > div");
		expect(header?.className).toContain("pr-0.5");
		expect(header?.className).toContain("pl-2");
	});
});
