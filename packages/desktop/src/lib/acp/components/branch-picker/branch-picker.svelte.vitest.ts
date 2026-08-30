import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError } from "../../errors/app-error.js";

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

const mocks = vi.hoisted(() => ({
	checkoutBranch: vi.fn(),
	listBranches: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("svelte-sonner", () => ({
	toast: {
		error: mocks.toastError,
	},
}));

vi.mock("$lib/utils/backend-client.js", () => ({
	backendClient: {
		git: {
			checkoutBranch: mocks.checkoutBranch,
			listBranches: mocks.listBranches,
		},
	},
}));

const { default: BranchPicker } = await import("./branch-picker.svelte");

describe("BranchPicker", () => {
	beforeEach(() => {
		mocks.checkoutBranch.mockReset();
		mocks.listBranches.mockReset();
		mocks.toastError.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("keeps the branch list visible when checkout fails", async () => {
		mocks.listBranches.mockReturnValue(Effect.succeed(["main", "feature/login"]));
		// Effect.delay(0) pushes the failure onto a macrotask, matching real IPC
		// latency. Without it the failure resolves before bits-ui finishes its own
		// item-select close sequence, and the picker's re-open (branchPopoverOpen
		// = true) loses that race and gets clobbered back to closed.
		mocks.checkoutBranch.mockReturnValue(
			Effect.fail(
				new AgentError(
					"git.checkoutBranch",
					new Error("local changes would be overwritten by checkout")
				)
			).pipe(Effect.delay(0))
		);

		const view = render(BranchPicker, {
			projectPath: "/repo",
			currentBranch: "main",
			diffStats: null,
			isGitRepo: true,
		});

		await fireEvent.click(view.getByRole("button", { name: "Branch: main" }));

		await waitFor(() => {
			expect(view.getByRole("menuitem", { name: "feature/login" })).toBeTruthy();
		});

		await fireEvent.click(view.getByRole("menuitem", { name: "feature/login" }));

		await waitFor(() => {
			expect(mocks.checkoutBranch).toHaveBeenCalledWith("/repo", "feature/login", false);
			expect(view.getByRole("menuitem", { name: "feature/login" })).toBeTruthy();
		});
		expect(mocks.toastError).toHaveBeenCalledWith("local changes would be overwritten by checkout");
	});
});
