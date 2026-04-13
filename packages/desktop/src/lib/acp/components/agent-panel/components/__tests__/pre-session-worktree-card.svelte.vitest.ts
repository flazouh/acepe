import { cleanup, fireEvent, render, screen } from "@testing-library/svelte";
import { okAsync } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";

const loadWorktreeConfig = vi.fn(() =>
	okAsync({ setupCommands: ["bun install", "bun test"] })
);
const setWorktreeDefault = vi.fn(() => okAsync(undefined));

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

vi.mock("$lib/utils/tauri-client.js", () => {
	return {
		tauriClient: {
			git: {
				loadWorktreeConfig,
			},
		},
	};
});

vi.mock("$lib/acp/components/worktree-toggle/worktree-default-store.svelte.js", () => {
	return {
		getWorktreeDefaultStore: () => ({
			set: setWorktreeDefault,
		}),
	};
});

vi.mock("../setup-scripts-dialog.svelte", async () => ({
	default: (await import("../../../worktree-toggle/__tests__/fixtures/setup-scripts-dialog-stub.svelte"))
		.default,
}));

const { default: PreSessionWorktreeCard } = await import("../pre-session-worktree-card.svelte");

afterEach(() => {
	cleanup();
	setWorktreeDefault.mockClear();
	loadWorktreeConfig.mockClear();
});

describe("PreSessionWorktreeCard desktop wrapper", () => {
	it("loads setup command count, opens the dialog, and updates the global default", async () => {
		const onPendingWorktreeChange = vi.fn();

		const { container } = render(PreSessionWorktreeCard, {
			projectPath: "/repo/current-project",
			projectName: "Current Project",
			pendingWorktreeEnabled: true,
			globalWorktreeDefault: false,
			onPendingWorktreeChange,
		});

		expect(await screen.findByText("2 setup commands")).toBeTruthy();

		await fireEvent.click(screen.getByRole("switch"));
		await fireEvent.click(screen.getByRole("button", { name: /setup commands/i }));
		await fireEvent.click(screen.getByRole("button", { name: /project root/i }));

		expect(setWorktreeDefault).toHaveBeenCalledWith(true);
		expect(onPendingWorktreeChange).toHaveBeenCalledWith(false);

		const dialog = container.querySelector("[data-testid='setup-scripts-dialog-stub']");
		expect(dialog?.getAttribute("data-open")).toBe("true");
		expect(dialog?.getAttribute("data-project-path")).toBe("/repo/current-project");
		expect(dialog?.getAttribute("data-project-name")).toBe("Current Project");
	});
});
