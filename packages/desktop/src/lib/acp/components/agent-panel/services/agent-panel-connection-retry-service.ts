/**
 * Retry UX for panel connection errors — product intent extracted from agent-panel handlers.
 */

import type { Project } from "$lib/acp/logic/project-manager.svelte";
import { PanelConnectionEvent } from "$lib/acp/types/panel-connection-state.js";
import { PanelConnectionState } from "$lib/acp/types/panel-connection-state.js";
import { toast } from "svelte-sonner";

export function runPanelConnectionRetry(args: {
	sessionId: string | null;
	panelId: string | undefined;
	panelConnectionState: PanelConnectionState | null;
	project: Project | null | undefined;
	effectivePanelAgentId: string | null | undefined;
	onClearErrorDismissed: () => void;
	onSendCancelToPanel: (panelId: string) => void;
	onRecreateSession: (project: Project, agentId: string) => void;
	logContext: {
		panelId: string;
		projectPath: string | null | undefined;
		agentId: string | null | undefined;
	};
}): void {
	const {
		sessionId,
		panelId,
		panelConnectionState,
		project,
		effectivePanelAgentId,
		onClearErrorDismissed,
		onSendCancelToPanel,
		onRecreateSession,
		logContext,
	} = args;

	if (!sessionId && panelId && panelConnectionState === PanelConnectionState.ERROR) {
		onSendCancelToPanel(panelId);
		onClearErrorDismissed();
		return;
	}

	if (project && effectivePanelAgentId) {
		onRecreateSession(project, effectivePanelAgentId);
		return;
	}

	console.warn("Retry connection failed: Missing project or agent", logContext);
	toast.error("Cannot retry connection: Project or agent not available.");
}
