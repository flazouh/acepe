import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentSessionActivityEntry from "./agent-session-activity-entry.svelte";

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

afterEach(() => cleanup());

const completedUsage = {
	preCompactionTokens: 142_010,
	postCompactionTokens: 18_400,
	contextWindowSize: 200_000,
};

describe("AgentSessionActivityEntry", () => {
	it("announces preparing as busy status without any progress semantics or numbers", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				title: "Compaction preparing",
				status: "preparing",
			},
		});

		const status = view.getByRole("status");
		expect(status.getAttribute("aria-busy")).toBe("true");
		expect(view.queryByRole("progressbar")).toBeNull();
		expect(view.getByText("Compaction preparing")).toBeTruthy();
		expect(view.container.textContent).not.toContain("→");
		expect(view.container.textContent).not.toMatch(/\d/);
	});

	it("shows compact before and after counts plus gauges for completed compaction", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				title: "Compaction done",
				status: "completed",
				subtitle: "123,610 tokens freed",
				contextUsage: completedUsage,
				metadata: [
					{ label: "Trigger", value: "Auto" },
					{ label: "Duration", value: "1.2 s" },
				],
			},
		});

		const status = view.getByRole("status");
		expect(status.getAttribute("aria-busy")).toBeNull();
		expect(view.queryByRole("progressbar")).toBeNull();

		expect(view.getByText("142k")).toBeTruthy();
		expect(view.getByText("18k")).toBeTruthy();

		const gauge = view.getByTestId("compaction-gauge");
		expect(gauge.getAttribute("aria-hidden")).toBe("true");

		const ariaLabel = status.getAttribute("aria-label") ?? "";
		expect(ariaLabel).toContain("142,010");
		expect(ariaLabel).toContain("18,400");
		expect(ariaLabel).toContain("123,610 tokens freed");

		const normalizedText = (view.container.textContent ?? "").replace(/\s+/g, " ");
		expect(normalizedText).toContain("123,610 tokens freed · Trigger: Auto · Duration: 1.2 s");
	});

	it("omits gauges and numbers when completed has no comparable usage", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				title: "Compaction done",
				status: "completed",
				contextUsage: {
					preCompactionTokens: 142_010,
					postCompactionTokens: null,
					contextWindowSize: null,
				},
			},
		});

		expect(view.queryByTestId("compaction-gauge")).toBeNull();
		expect(view.container.textContent).not.toContain("→");
		expect(view.getByText("Compaction done")).toBeTruthy();
	});

	it("marks failed compaction with a warning icon and no gauge", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				title: "Compaction failed",
				status: "failed",
			},
		});

		const status = view.getByRole("status");
		expect(status.getAttribute("data-status")).toBe("failed");
		expect(status.querySelector("svg")).toBeTruthy();
		expect(view.queryByTestId("compaction-gauge")).toBeNull();
		expect(view.getByText("Compaction failed")).toBeTruthy();
	});

	it("renders usage reset with its subtitle detail", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				title: "Compaction done",
				status: "usage_reset",
				subtitle: "Context meter reset",
			},
		});

		const status = view.getByRole("status");
		expect(status.getAttribute("data-status")).toBe("usage_reset");
		expect(status.querySelector("svg")).toBeTruthy();
		expect(view.getByText("Context meter reset")).toBeTruthy();
	});
});
