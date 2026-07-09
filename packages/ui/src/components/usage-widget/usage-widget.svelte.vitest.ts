import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import UsageLimitWidget from "./usage-widget.svelte";
import type { UsageWidgetModel } from "./types.js";

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
	async function openUsagePanel(): Promise<void> {
		const trigger = screen.getByRole("button", { name: "AI usage" });
		await fireEvent.pointerDown(trigger);
		await waitFor(() => {
			expect(
				document.querySelector("[data-usage-widget-panel]"),
			).not.toBeNull();
		});
	}

	function waitForDismissLayer(): Promise<void> {
		return new Promise((resolve) => {
			setTimeout(resolve, 20);
		});
	}

	it("opens the provider usage panel from the trigger", async () => {
		const { container } = render(UsageLimitWidget, { model });

		const triggerMeter = container.querySelector(
			'[data-usage-widget-trigger] [role="progressbar"]',
		);
		expect(triggerMeter?.getAttribute("aria-valuenow")).toBe("27");
		expect(triggerMeter?.querySelector("div")?.className).toContain(
			"bg-success",
		);
		expect(
			container
				.querySelector(
					"[data-usage-widget-trigger] [data-usage-agent-icon] img",
				)
				?.getAttribute("src"),
		).toBe("/svgs/agents/codex/codex-icon.svg");
		expect(
			container.querySelector(
				"[data-usage-widget-trigger] [data-usage-meter-label]",
			),
		).toBeNull();

		await openUsagePanel();

		expect(screen.queryByRole("heading", { name: "Usage" })).toBeNull();
		expect(screen.getByText("Codex")).toBeTruthy();
		expect(screen.getByText("73% left")).toBeTruthy();
		expect(
			document
				.querySelector("[data-usage-widget-panel] [data-usage-meter-label]")
				?.textContent?.trim(),
		).toBe("SSN");
		expect(
			document.querySelectorAll(
				'[data-usage-widget-panel] [role="progressbar"]',
			).length,
		).toBe(1);
	});

	it("refreshes account usage when the panel opens", async () => {
		const onRefresh = vi.fn();
		render(UsageLimitWidget, { model, onRefresh });

		await openUsagePanel();

		expect(onRefresh).toHaveBeenCalledTimes(1);
	});

	it("closes the provider usage panel when clicking outside", async () => {
		render(UsageLimitWidget, { model });

		await openUsagePanel();
		await waitForDismissLayer();

		await fireEvent.pointerDown(document.body, {
			button: 0,
			clientX: 999,
			clientY: 999,
			pointerType: "mouse",
		});

		await waitFor(() => {
			expect(document.querySelector("[data-usage-widget-panel]")).toBeNull();
		});
	});
});
