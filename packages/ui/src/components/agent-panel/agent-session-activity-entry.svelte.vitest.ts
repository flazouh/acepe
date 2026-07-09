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

afterEach(() => {
	cleanup();
});

describe("AgentSessionActivityEntry", () => {
	it("renders before and after context as one layered comparison", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				entry: {
					id: "compaction-completed",
					type: "session_activity",
					activityKind: "compaction",
					title: "Compaction done",
					status: "completed",
					subtitle: "138,000 tokens freed",
					contextUsage: {
						preCompactionTokens: 182_000,
						postCompactionTokens: 44_000,
						contextWindowSize: 200_000,
					},
				},
			},
		});

		const comparison = view.container.querySelector("[data-compaction-context-comparison]");
		const before = view.container.querySelector(
			'[data-compaction-context-segment="before"]'
		) as HTMLElement | null;
		const after = view.container.querySelector(
			'[data-compaction-context-segment="after"]'
		) as HTMLElement | null;

		expect(comparison?.getAttribute("aria-label")).toBe(
			"Context reduced from 182,000 to 44,000 tokens"
		);
		expect(before?.style.width).toBe("91%");
		expect(after?.style.width).toBe("22%");
		expect(view.getByText("91%")).toBeTruthy();
		expect(view.getByText("22%")).toBeTruthy();
	});

	it("renders preparing as indeterminate progress without a numeric value", () => {
		const view = render(AgentSessionActivityEntry, {
			props: {
				entry: {
					id: "compaction-preparing",
					type: "session_activity",
					activityKind: "compaction",
					title: "Compacting conversation",
					status: "preparing",
				},
			},
		});

		const progress = view.getByRole("progressbar", { name: "Compaction in progress" });

		expect(progress.getAttribute("aria-busy")).toBe("true");
		expect(progress.hasAttribute("aria-valuenow")).toBe(false);
		expect(view.container.querySelector("[data-compaction-context-comparison]")).toBeNull();
	});
});
