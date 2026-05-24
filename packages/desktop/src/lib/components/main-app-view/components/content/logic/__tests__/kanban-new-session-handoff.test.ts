import { describe, expect, it, mock } from "bun:test";

import { completeKanbanNewSessionHandoff } from "../kanban-new-session-handoff.js";

describe("completeKanbanNewSessionHandoff", () => {
	it("brings the created session panel to the visible front", () => {
		const calls: string[] = [];
		const panelStore = {
			updatePanelSession: mock((panelId: string, sessionId: string | null) => {
				calls.push(`update:${panelId}:${sessionId ?? "null"}`);
			}),
			movePanelToFront: mock((panelId: string) => {
				calls.push(`front:${panelId}`);
			}),
			focusPanel: mock((panelId: string) => {
				calls.push(`focus:${panelId}`);
			}),
			openSession: mock(() => null),
		};

		completeKanbanNewSessionHandoff({
			panelStore,
			panelId: "panel-new",
			sessionId: "session-56",
			sessionPanelWidth: 600,
		});

		expect(calls).toEqual([
			"update:panel-new:session-56",
			"front:panel-new",
			"focus:panel-new",
		]);
		expect(panelStore.openSession).not.toHaveBeenCalled();
	});

	it("opens the session when no optimistic panel exists", () => {
		const panelStore = {
			updatePanelSession: mock(() => {}),
			movePanelToFront: mock(() => {}),
			focusPanel: mock(() => {}),
			openSession: mock((sessionId: string, width: number) => ({ sessionId, width })),
		};

		completeKanbanNewSessionHandoff({
			panelStore,
			panelId: null,
			sessionId: "session-56",
			sessionPanelWidth: 600,
		});

		expect(panelStore.openSession).toHaveBeenCalledWith("session-56", 600);
		expect(panelStore.updatePanelSession).not.toHaveBeenCalled();
		expect(panelStore.movePanelToFront).not.toHaveBeenCalled();
		expect(panelStore.focusPanel).not.toHaveBeenCalled();
	});
});
