import { cleanup, render, screen } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputMetricsChip from "./agent-input-metrics-chip.svelte";

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

describe("AgentInputMetricsChip", () => {
	it("renders an accessible unknown state without claiming zero percent", () => {
		render(AgentInputMetricsChip, {
			props: {
				value: { kind: "unknown", label: "—" },
				ariaLabel: "Context window usage",
			},
		});

		const status = screen.getByRole("status", { name: "Context window usage: unavailable" });
		expect(status.textContent).toContain("—");
		expect(status.textContent).not.toContain("0%");
	});
});
