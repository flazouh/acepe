import { cleanup, render, screen } from "@testing-library/svelte";
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
	it("shows worktree label and current selection", () => {
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

		expect(screen.getByText("Worktree")).toBeTruthy();
		expect(screen.getByText("No")).toBeTruthy();
	});

	it("shows Yes as current selection when worktree is enabled", () => {
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

		expect(screen.getByText("Worktree")).toBeTruthy();
		expect(screen.getByText("Yes")).toBeTruthy();
	});

	it("shows Yes when alwaysEnabled is true", () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onAlways = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: true,
			alwaysEnabled: true,
			onYes,
			onNo,
			onAlways,
			onDismiss,
		});

		expect(screen.getByText("Yes")).toBeTruthy();
	});

	it("does not render a dismiss button in the standard card", () => {
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

		expect(screen.queryByLabelText("Dismiss")).toBeNull();
	});
});
