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

const { default: WorktreeToggleButton } = await import("../worktree-toggle-button.svelte");

afterEach(() => {
	cleanup();
});

describe("WorktreeToggleButton", () => {
	it("shows the auto worktree switch as enabled when autoWorktree is true", async () => {
		render(WorktreeToggleButton, {
			disabled: false,
			loading: false,
			tooltipText: "Worktree active",
			worktreeName: "proud-harbor",
			pending: false,
			deleted: false,
			autoWorktree: true,
			onCreate: vi.fn(),
		});

		const switchRoot = document.querySelector('[data-slot="switch"]');
		expect(switchRoot).toBeTruthy();
		expect(switchRoot?.getAttribute("data-state")).toBe("checked");
	});

	it("shows the auto worktree switch as unchecked when autoWorktree is false", async () => {
		render(WorktreeToggleButton, {
			disabled: false,
			loading: false,
			tooltipText: "Worktree active",
			worktreeName: "proud-harbor",
			pending: false,
			deleted: false,
			autoWorktree: false,
			onCreate: vi.fn(),
		});

		const switchRoot = document.querySelector('[data-slot="switch"]');
		expect(switchRoot).toBeTruthy();
		expect(switchRoot?.getAttribute("data-state")).toBe("unchecked");
	});

	it("disables the main button when autoWorktree is true", async () => {
		render(WorktreeToggleButton, {
			disabled: false,
			loading: false,
			tooltipText: "Auto worktree enabled",
			worktreeName: null,
			pending: true,
			deleted: false,
			autoWorktree: true,
			onCreate: vi.fn(),
		});

		const button = screen.getByRole("button", { name: /worktree/i });
		expect(button).toBeTruthy();
		expect(button.hasAttribute("disabled")).toBe(true);
	});

	it("shows inline rename input from the pencil icon and submits on Enter", async () => {
		const onRename = vi.fn();

		render(WorktreeToggleButton, {
			disabled: true,
			loading: false,
			tooltipText: "Rename worktree",
			worktreeName: "happy-canyon",
			pending: false,
			deleted: false,
			onCreate: vi.fn(),
			onRename,
		});

		await fireEvent.click(screen.getByLabelText("Rename worktree"));

		const input = screen.getByDisplayValue("happy-canyon");
		expect(input).toBeTruthy();
		expect(document.activeElement).toBe(input);

		await fireEvent.input(input, { target: { value: "brave-river" } });
		await fireEvent.keyDown(input, { key: "Enter" });

		expect(onRename).toHaveBeenCalledWith("brave-river");
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("cancels inline rename on Escape", async () => {
		const onRename = vi.fn();

		render(WorktreeToggleButton, {
			disabled: false,
			loading: false,
			tooltipText: "Rename worktree",
			worktreeName: "happy-canyon",
			pending: false,
			deleted: false,
			onCreate: vi.fn(),
			onRename,
		});

		await fireEvent.click(screen.getByLabelText("Rename worktree"));

		const input = screen.getByDisplayValue("happy-canyon");
		await fireEvent.input(input, { target: { value: "brave-river" } });
		await fireEvent.keyDown(input, { key: "Escape" });

		expect(onRename).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox")).toBeNull();
	});
});
