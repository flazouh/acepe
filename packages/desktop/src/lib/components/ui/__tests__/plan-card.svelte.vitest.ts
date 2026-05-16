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
	it("renders plan decision actions in a footer using compact header-style buttons", () => {
		const { container, queryByRole, getByRole } = render(PlanCard, {
			content: "## Plan",
			status: "interactive",
			onBuild: vi.fn(),
			onCancel: vi.fn(),
		});

		const footer = container.querySelector(".plan-footer");
		expect(footer).toBeTruthy();
		expect(footer?.querySelectorAll("button")).toHaveLength(2);
		expect(queryByRole("button", { name: "Review" })).toBeNull();
		expect(queryByRole("button", { name: "Deepen" })).toBeNull();
		expect(queryByRole("link", { name: /Review/i })).toBeNull();
		expect(queryByRole("link", { name: /Deepen/i })).toBeNull();
		expect(getByRole("button", { name: "Build" })).toBeTruthy();
		expect(getByRole("button", { name: "Cancel" })).toBeTruthy();
	});

	it("renders a top-right header button when a full-plan callback is provided", () => {
		const onViewFull = vi.fn();
		const { container, getByRole } = render(PlanCard, {
			content: "## Plan",
			status: "approved",
			onViewFull,
		});

		const footer = container.querySelector(".plan-footer");
		expect(footer).toBeNull();
		expect(container.querySelectorAll(".plan-card > .h-7 button")).toHaveLength(1);
		getByRole("button", { name: "Open full plan" }).click();
		expect(onViewFull).toHaveBeenCalledTimes(1);
	});
});
