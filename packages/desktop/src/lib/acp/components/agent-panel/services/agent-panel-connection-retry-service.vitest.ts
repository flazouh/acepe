import { describe, expect, it, vi } from "vitest";
import { PanelConnectionState } from "$lib/acp/types/panel-connection-state.js";
import { runPanelConnectionRetry } from "./agent-panel-connection-retry-service.js";

describe("runPanelConnectionRetry", () => {
	it("cancels pending connection when pre-session panel is in ERROR", () => {
		const onSendCancelToPanel = vi.fn();
		const onClearErrorDismissed = vi.fn();
		const onRecreateSession = vi.fn();

		runPanelConnectionRetry({
			sessionId: null,
			panelId: "p1",
			panelConnectionState: PanelConnectionState.ERROR,
			project: { path: "/x", name: "X" } as never,
			effectivePanelAgentId: "agent-1",
			onClearErrorDismissed,
			onSendCancelToPanel,
			onRecreateSession,
			logContext: { panelId: "p1", projectPath: "/x", agentId: "agent-1" },
		});

		expect(onSendCancelToPanel).toHaveBeenCalledWith("p1");
		expect(onClearErrorDismissed).toHaveBeenCalled();
		expect(onRecreateSession).not.toHaveBeenCalled();
	});

	it("recreates session when project and agent are available", () => {
		const onRecreateSession = vi.fn();

		runPanelConnectionRetry({
			sessionId: "s1",
			panelId: "p1",
			panelConnectionState: PanelConnectionState.ERROR,
			project: { path: "/x", name: "X" } as never,
			effectivePanelAgentId: "agent-1",
			onClearErrorDismissed: vi.fn(),
			onSendCancelToPanel: vi.fn(),
			onRecreateSession,
			logContext: { panelId: "p1", projectPath: "/x", agentId: "agent-1" },
		});

		expect(onRecreateSession).toHaveBeenCalledWith(
			expect.objectContaining({ path: "/x" }),
			"agent-1"
		);
	});
});
