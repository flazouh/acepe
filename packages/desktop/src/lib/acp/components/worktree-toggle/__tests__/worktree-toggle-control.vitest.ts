import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as m from "$lib/paraglide/messages.js";

const setWorktreeDefault = vi.fn(() => okAsync(undefined));

vi.mock(
	"svelte",
	async () => {
		const { createRequire } = await import("node:module");
		const { dirname, join } = await import("node:path");
		const require = createRequire(import.meta.url);
		const svelteClientPath = join(
			dirname(require.resolve("svelte/package.json")),
			"src/index-client.js"
		);

		return import(/* @vite-ignore */ svelteClientPath);
	}
);

vi.mock("../worktree-toggle.svelte", async () => {
	const Stub = (await import("./fixtures/worktree-toggle-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("../../agent-panel/components/setup-scripts-dialog.svelte", async () => {
	const Stub = (await import("./fixtures/setup-scripts-dialog-stub.svelte")).default;

	return {
		default: Stub,
	};
});

vi.mock("../worktree-default-store.svelte.js", () => ({
	getWorktreeDefaultStore: () => ({
		globalDefault: false,
		set: setWorktreeDefault,
	}),
}));

const { default: WorktreeToggleControl } = await import("../worktree-toggle-control.svelte");

afterEach(() => {
	cleanup();
	setWorktreeDefault.mockClear();
});

describe("WorktreeToggleControl", () => {
	it("opens the shared menu and setup dialog", async () => {
		const { container } = render(WorktreeToggleControl, {
			panelId: "panel-1",
			projectPath: "/repo/current-project",
			projectName: "Current Project",
			activeWorktreePath: null,
			hasEdits: false,
			hasMessages: false,
			globalWorktreeDefault: false,
			onWorktreeCreated: vi.fn(),
		});

		await fireEvent.click(screen.getByLabelText("Worktree options"));

		expect(await screen.findByText(m.settings_worktree_default_label())).toBeTruthy();

		await fireEvent.click(screen.getByRole("switch"));
		expect(setWorktreeDefault).toHaveBeenCalledWith(true);

		await fireEvent.click(screen.getByLabelText(m.setup_scripts_button_title()));

		const dialog = container.querySelector("[data-testid='setup-scripts-dialog-stub']");
		expect(dialog?.getAttribute("data-open")).toBe("true");
		expect(dialog?.getAttribute("data-project-path")).toBe("/repo/current-project");
		expect(dialog?.getAttribute("data-project-name")).toBe("Current Project");
	});

	it("uses lighter minimal styling outside the panel footer", () => {
		render(WorktreeToggleControl, {
			panelId: "empty-state-panel",
			projectPath: "/repo/current-project",
			projectName: "Current Project",
			activeWorktreePath: null,
			hasEdits: false,
			hasMessages: false,
			globalWorktreeDefault: false,
			variant: "minimal",
			onWorktreeCreated: vi.fn(),
		});

		const trigger = screen.getByLabelText("Worktree options");
		const wrapper = trigger.parentElement?.parentElement;

		expect(wrapper?.className.includes("border-r")).toBe(false);
	});
});
