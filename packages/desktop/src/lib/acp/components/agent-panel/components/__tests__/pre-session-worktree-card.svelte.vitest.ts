import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
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

const { default: PreSessionWorktreeCard } = await import("../pre-session-worktree-card.svelte");

afterEach(() => {
	cleanup();
});

describe("PreSessionWorktreeCard desktop wrapper", () => {
	it("shows worktree prompt and calls onYes when Yes is clicked", async () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		expect(screen.getByText("Use a worktree?")).toBeTruthy();

		await fireEvent.click(screen.getByLabelText("Yes"));
		expect(onYes).toHaveBeenCalled();
	});

	it("calls onNo when No is clicked", async () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		await fireEvent.click(screen.getByLabelText("No"));
		expect(onNo).toHaveBeenCalled();
	});

	it("calls onAlways when Always is clicked", async () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		await fireEvent.click(screen.getByLabelText("Always"));
		expect(onAlways).toHaveBeenCalled();
	});

	it("calls onDismiss when X is clicked", async () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		await fireEvent.click(screen.getByLabelText("Dismiss"));
		expect(onDismiss).toHaveBeenCalled();
	});

	it("stays visible with selected styling when worktree is enabled", () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: true,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		expect(screen.getByText("Use a worktree?")).toBeTruthy();
	});
});
