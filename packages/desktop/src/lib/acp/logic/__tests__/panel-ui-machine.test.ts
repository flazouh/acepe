import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { PanelUiEvent, PanelUiState, panelUiMachine } from "../panel-ui-machine.js";

describe("panelUiMachine", () => {
	describe("initial state", () => {
		it("should start in PROJECT_SELECTION state", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			expect(actor.getSnapshot().value).toBe(PanelUiState.PROJECT_SELECTION);
		});
	});

	describe("PROJECT_SELECTION state", () => {
		it("should transition to SESSION_ACTIVE when SELECT_PROJECT event is sent", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});

			expect(actor.getSnapshot().value).toBe(PanelUiState.SESSION_ACTIVE);
			expect(actor.getSnapshot().context.projectPath).toBe("/path/to/project");
			expect(actor.getSnapshot().context.agentId).toBe("claude-code");
		});
	});

	describe("SESSION_ACTIVE state", () => {
		it("should update sessionId on SESSION_CREATED", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			// Get to SESSION_ACTIVE
			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});

			actor.send({
				type: PanelUiEvent.SESSION_CREATED,
				sessionId: "session-123",
			});

			expect(actor.getSnapshot().value).toBe(PanelUiState.SESSION_ACTIVE);
			expect(actor.getSnapshot().context.sessionId).toBe("session-123");
		});

		it("should transition to ERROR on PANEL_ERROR", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			// Get to SESSION_ACTIVE
			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});

			actor.send({
				type: PanelUiEvent.PANEL_ERROR,
				error: "Panel error occurred",
			});

			expect(actor.getSnapshot().value).toBe(PanelUiState.ERROR);
			expect(actor.getSnapshot().context.error).toBe("Panel error occurred");
		});

		it("should transition back to PROJECT_SELECTION on CLEAR_SESSION", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			// Get to SESSION_ACTIVE
			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});

			actor.send({
				type: PanelUiEvent.SESSION_CREATED,
				sessionId: "session-123",
			});

			actor.send({ type: PanelUiEvent.CLEAR_SESSION });

			expect(actor.getSnapshot().value).toBe(PanelUiState.PROJECT_SELECTION);
			expect(actor.getSnapshot().context.projectPath).toBe("");
			expect(actor.getSnapshot().context.agentId).toBe("");
			expect(actor.getSnapshot().context.sessionId).toBe(null);
		});
	});

	describe("ERROR state", () => {
		it("should transition back to PROJECT_SELECTION on RETRY", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			// Get to ERROR state
			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});
			actor.send({
				type: PanelUiEvent.PANEL_ERROR,
				error: "Panel error occurred",
			});

			actor.send({ type: PanelUiEvent.RETRY });

			expect(actor.getSnapshot().value).toBe(PanelUiState.PROJECT_SELECTION);
			expect(actor.getSnapshot().context.error).toBe(undefined);
		});

		it("should transition back to PROJECT_SELECTION on CANCEL", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "test-panel" },
			});
			actor.start();

			// Get to ERROR state
			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path/to/project",
				agentId: "claude-code",
			});
			actor.send({
				type: PanelUiEvent.PANEL_ERROR,
				error: "Panel error occurred",
			});

			actor.send({ type: PanelUiEvent.CANCEL });

			expect(actor.getSnapshot().value).toBe(PanelUiState.PROJECT_SELECTION);
			expect(actor.getSnapshot().context.projectPath).toBe("");
			expect(actor.getSnapshot().context.agentId).toBe("");
			expect(actor.getSnapshot().context.sessionId).toBe(null);
			expect(actor.getSnapshot().context.error).toBe(undefined);
		});
	});

	describe("context preservation", () => {
		it("should preserve panelId throughout all transitions", () => {
			const actor = createActor(panelUiMachine, {
				input: { panelId: "my-panel-id" },
			});
			actor.start();

			actor.send({
				type: PanelUiEvent.SELECT_PROJECT,
				projectPath: "/path",
				agentId: "agent",
			});
			expect(actor.getSnapshot().context.panelId).toBe("my-panel-id");

			actor.send({
				type: PanelUiEvent.SESSION_CREATED,
				sessionId: "session",
			});
			expect(actor.getSnapshot().context.panelId).toBe("my-panel-id");

			actor.send({
				type: PanelUiEvent.PANEL_ERROR,
				error: "error",
			});
			expect(actor.getSnapshot().context.panelId).toBe("my-panel-id");
		});
	});
});
