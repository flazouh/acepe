import { cleanup, fireEvent, render, waitFor } from "@testing-library/svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("$lib/utils/tauri-client.js", () => ({
	tauriClient: {
		git: {
			checkoutBranch: mocks.checkoutBranch,
			listBranches: mocks.listBranches,
		},
	},
}));

interface TestError {
	readonly message: string;
}

interface MatchableResult<T> {
	match(onOk: (value: T) => void, onErr: (error: TestError) => void): void;
}

function okResult<T>(value: T): MatchableResult<T> {
	return {
		match(onOk) {
			onOk(value);
		},
	};
}

function errResult<T>(message: string): MatchableResult<T> {
	return {
		match(_onOk, onErr) {
			setTimeout(() => {
				onErr({ message });
			}, 0);
		},
	};
}

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
		mocks.listBranches.mockReturnValue(okResult(["main", "feature/login"]));
		mocks.checkoutBranch.mockReturnValue(
			errResult<string>("local changes would be overwritten by checkout")
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
