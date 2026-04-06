import { PlanCard } from "@acepe/ui/plan-card";
import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("svelte", async () => {
	const { createRequire } = await import("node:module");
	const { dirname, join } = await import("node:path");
	const require = createRequire(import.meta.url);
	const svelteClientPath = join(
		dirname(require.resolve("svelte/package.json")),
		"src/index-client.js"
	);

	return import(/* @vite-ignore */ svelteClientPath);
});

afterEach(() => {
	cleanup();
});

describe("PlanCard", () => {
	it("does not render review or deepen actions in the inline footer", () => {
		const { queryByRole, getByRole } = render(PlanCard, {
			content: "## Plan",
			status: "interactive",
			onBuild: vi.fn(),
			onCancel: vi.fn(),
		});

		expect(queryByRole("button", { name: "Review" })).toBeNull();
		expect(queryByRole("button", { name: "Deepen" })).toBeNull();
		expect(queryByRole("link", { name: /Review/i })).toBeNull();
		expect(queryByRole("link", { name: /Deepen/i })).toBeNull();
		expect(getByRole("button", { name: "Build" })).toBeTruthy();
		expect(getByRole("button", { name: "Cancel" })).toBeTruthy();
	});
});
