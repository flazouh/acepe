import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EmbeddedTerminalStore } from "../../../../store/embedded-terminal-store.svelte.js";

vi.mock(
	"svelte",
	async () =>
		// @ts-expect-error client runtime import for test
		import("../../../../../../../../../node_modules/svelte/src/index-client.js")
);

vi.mock("@acepe/ui/agent-panel", async () => ({
	AgentPanelTerminalDrawer: (await import("./fixtures/shared-terminal-drawer-stub.svelte")).default,
}));

vi.mock("$lib/utils/tauri-client/shell.js", () => ({
	shell: {
		getDefaultShell: () => ({
			mapErr: () => ({
				match: (onOk: (shell: string) => void) => onOk("/bin/zsh"),
			}),
		}),
	},
}));

vi.mock("../../../terminal-panel/index.js", async () => ({
	TerminalRenderer: (await import("./fixtures/terminal-renderer-stub.svelte")).default,
}));

import AgentPanelTerminalDrawer from "../agent-panel-terminal-drawer.svelte";

afterEach(cleanup);

function createStore(): EmbeddedTerminalStore {
	return new EmbeddedTerminalStore(() => {});
}

describe("AgentPanelTerminalDrawer", () => {
	it("renders an existing terminal tab from the embedded terminal store", async () => {
		const store = createStore();
		store.addTab("panel-1", "/tmp/project");

		render(AgentPanelTerminalDrawer, {
			panelId: "panel-1",
			effectiveCwd: "/tmp/project",
			embeddedTerminals: store,
			onClose: vi.fn(),
		});

		expect(screen.getByText("Terminal 1")).toBeTruthy();
		await waitFor(() => expect(screen.getByTestId("terminal-renderer-stub")).toBeTruthy());
	});

	it("shows a newly added tab after clicking the new terminal button", async () => {
		const store = createStore();

		render(AgentPanelTerminalDrawer, {
			panelId: "panel-1",
			effectiveCwd: "/tmp/project",
			embeddedTerminals: store,
			onClose: vi.fn(),
		});

		await fireEvent.click(screen.getByTitle("New terminal"));

		expect(store.getTabs("panel-1")).toHaveLength(1);
		await waitFor(() => expect(screen.getByText("Terminal 1")).toBeTruthy());
	});
});
