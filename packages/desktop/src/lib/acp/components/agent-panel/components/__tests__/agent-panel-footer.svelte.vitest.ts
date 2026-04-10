import { cleanup, render } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

const storageMock: Storage = {
	length: 0,
	clear: () => undefined,
	getItem: () => null,
	key: () => null,
	removeItem: () => undefined,
	setItem: () => undefined,
};

Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: storageMock,
});

Object.defineProperty(globalThis, "sessionStorage", {
	configurable: true,
	value: storageMock,
});

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error Test-only client runtime override for Vitest component mounting
		import("../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("../../worktree-toggle/index.js", async () => ({
	WorktreeToggleControl: (await import("./fixtures/user-message-stub.svelte")).default,
}));

import AgentPanelFooter from "../agent-panel-footer.svelte";

afterEach(() => {
	cleanup();
});

describe("AgentPanelFooter", () => {
	it("uses the same background surface as the top bar", () => {
		const { container } = render(AgentPanelFooter, {
			panelId: "panel-1",
			projectPath: null,
			activeWorktreePath: null,
			effectiveCwd: null,
			hasEdits: false,
			hasMessages: false,
			onWorktreeCreated: vi.fn(),
			onWorktreeRenamed: undefined,
			onPendingChange: undefined,
			onToggleTerminal: vi.fn(),
			isTerminalDrawerOpen: false,
			onToggleBrowser: vi.fn(),
			isBrowserSidebarOpen: false,
			onSettings: undefined,
		});

		expect(container.firstElementChild?.className).toContain("bg-card/50");
	});
});
