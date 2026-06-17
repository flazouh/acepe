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
	it("shows start-in prompt and current local selection", () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onDismiss,
		});

		expect(screen.getByText("Start in")).toBeTruthy();
		expect(screen.getByText("Work locally")).toBeTruthy();
		expect(screen.queryByText("Remember")).toBeNull();
	});

	it("shows new worktree as current selection when enabled", () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: true,
			onYes,
			onNo,
			onDismiss,
		});

		expect(screen.getByText("New worktree")).toBeTruthy();
	});

	it("does not render a dismiss button in the standard card", () => {
		const onYes = vi.fn();
		const onNo = vi.fn();
		const onDismiss = vi.fn();

		render(PreSessionWorktreeCard, {
			pendingWorktreeEnabled: false,
			onYes,
			onNo,
			onDismiss,
		});

		expect(screen.queryByLabelText("Dismiss")).toBeNull();
	});
});
