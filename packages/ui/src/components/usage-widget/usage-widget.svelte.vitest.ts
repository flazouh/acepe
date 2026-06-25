import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import UsageLimitWidget from "./usage-widget.svelte";
import type { UsageWidgetModel } from "./types.js";

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

const model: UsageWidgetModel = {
	summary: {
		label: "",
		value: "Codex · 73% left",
		tone: "watch",
	},
	triggerLimits: [
		{
			id: "codex:five-hour",
			providerName: "Codex",
			providerBrand: "codex",
			initials: "CX",
			label: "5h window",
			leftLabel: "73% left",
			percentUsed: 27,
			tone: "good",
		},
	],
	updatedAtLabel: "2m ago",
	statusLabel: "1 live · 2m ago",
	copy: {
		triggerLabel: "AI usage",
		title: "Usage",
		subtitle: "",
		updatedLabel: "Updated",
		refreshLabel: "Refresh",
		localLabel: "Provider account usage only.",
		emptyLabel: "No providers connected yet",
	},
	providers: [
		{
			id: "codex",
			name: "Codex",
			plan: "Pro",
			providerBrand: "codex",
			initials: "CX",
			accentColor: "#111827",
			state: "ok",
			statusLabel: "Active",
			lines: [
				{
					type: "progress",
					label: "Session",
					usedLabel: "27% used",
					leftLabel: "73% left",
					resetLabel: "Resets in 2h 18m",
					percentUsed: 27,
					projectedPercent: 42,
					tone: "good",
				},
			],
		},
	],
};

describe("UsageLimitWidget", () => {
	it("opens the provider usage panel from the trigger", async () => {
		const { container } = render(UsageLimitWidget, { model });

		expect(container.querySelector('[data-usage-widget-trigger] .an-root')?.textContent).toContain(
			"27%"
		);

		await fireEvent.click(screen.getByRole("button", { name: "AI usage" }));

		expect(screen.queryByRole("heading", { name: "Usage" })).toBeNull();
		expect(screen.getByText("Codex")).toBeTruthy();
		expect(screen.getByRole("progressbar", { name: "Session" }).getAttribute("aria-valuenow")).toBe(
			"27"
		);
	});

	it("refreshes account usage when the panel opens", async () => {
		const onRefresh = vi.fn();
		render(UsageLimitWidget, { model, onRefresh });

		await fireEvent.click(screen.getByRole("button", { name: "AI usage" }));

		expect(onRefresh).toHaveBeenCalledTimes(1);
	});
});
