import { describe, expect, it } from "vitest";
import type { PanelErrorInfo } from "../../logic/connection-ui.js";
import type { PanelLifecyclePresentation } from "../../../../logic/panel-visibility.js";
import { AgentPanelViewStateController } from "../agent-panel-view-state-controller.svelte.js";

const READY_LIFECYCLE: PanelLifecyclePresentation = {
	connectionPhase: "connected",
	contentPhase: "loaded",
	showConversation: false,
	showReadyPlaceholder: true,
};

const NO_ERROR: PanelErrorInfo = {
	showError: false,
	title: "Connection error",
	summary: null,
	details: null,
	referenceId: null,
	referenceSearchable: false,
	failureReason: null,
};

describe("AgentPanelViewStateController", () => {
	it("derives project_selection when showProjectSelection is true", () => {
		const controller = new AgentPanelViewStateController({
			getViewStateInput: () => ({
				lifecyclePresentation: READY_LIFECYCLE,
				entriesCount: 0,
				hasSession: false,
				isAwaitingModelResponse: false,
				hasImmediatePendingSendIntent: false,
				showProjectSelection: true,
				hasEffectiveProjectPath: false,
				errorInfo: NO_ERROR,
			}),
		});
		expect(controller.viewState).toEqual({ kind: "project_selection" });
		expect(controller.panelViewKind).toBe("project_selection");
	});

	it("derives conversation when entries exist", () => {
		const controller = new AgentPanelViewStateController({
			getViewStateInput: () => ({
				lifecyclePresentation: READY_LIFECYCLE,
				entriesCount: 3,
				hasSession: true,
				isAwaitingModelResponse: false,
				hasImmediatePendingSendIntent: false,
				showProjectSelection: false,
				hasEffectiveProjectPath: true,
				errorInfo: NO_ERROR,
			}),
		});
		expect(controller.viewState.kind).toBe("conversation");
		expect(controller.panelViewKind).toBe("conversation");
	});

});
