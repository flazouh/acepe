import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AgentInputBranchSelector from "./agent-input-branch-selector.svelte";

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

describe("AgentInputBranchSelector", () => {
	it("opens branch rows from a fused setup chip trigger", async () => {
		render(AgentInputBranchSelector, {
			currentBranch: "main",
			branchListDisplay: {
				kind: "branches",
				branches: ["main", "feature/login"],
			},
			onBranchSelect: vi.fn(),
			showCreateButton: true,
			variant: "setupBarChip",
		});

		await fireEvent.click(screen.getByRole("button", { name: "Branch: main" }));

		await waitFor(() => {
			expect(
				screen.getByRole("menuitem", { name: "feature/login" }),
			).toBeTruthy();
		});
	});
});
