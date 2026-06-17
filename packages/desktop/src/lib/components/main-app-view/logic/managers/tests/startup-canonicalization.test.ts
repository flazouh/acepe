import { describe, expect, it, vi } from "vitest";

import type { Panel } from "$lib/acp/store/types.js";

type PanelStoreLike = {
	readonly panels: Panel[];
	updatePanelSession(panelId: string, sessionId: string | null): void;
};

type SessionStoreLike = {
	read: {
		resolveCanonicalSessionId(requestedId: string): string | null;
		getSessionIdentity(id: string): { id: string } | undefined;
		getSessionMetadata(id: string): { title: string } | undefined;
	};
};

function healStartupPanelSessionIds(
	panelStore: PanelStoreLike,
	sessionStore: SessionStoreLike,
	aliasRemaps: Record<string, string>,
	logger: { warn: (message: string, context: Record<string, string>) => void }
): void {
	for (const panel of panelStore.panels) {
		if (panel.sessionId === null) {
			continue;
		}

		const remappedCanonicalId = aliasRemaps[panel.sessionId];
		const resolverCanonicalId = sessionStore.read.resolveCanonicalSessionId(panel.sessionId);
		const canonicalId = remappedCanonicalId ?? resolverCanonicalId;

		if (canonicalId === null || canonicalId === undefined) {
			if (panel.sessionId in aliasRemaps) {
				continue;
			}
			logger.warn("Persisted panel session id could not be resolved to canonical", {
				panelId: panel.id,
				sessionId: panel.sessionId,
			});
			continue;
		}

		if (canonicalId !== panel.sessionId) {
			panelStore.updatePanelSession(panel.id, canonicalId);
		}
	}
}

describe("startup canonicalization", () => {
	it("collapses two persisted panels resolving to the same canonical id", () => {
		const panels: Panel[] = [
			{
				id: "panel-1",
				kind: "agent",
				ownerPanelId: null,
				sessionId: "alias-a",
				width: 400,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				projectPath: "/tmp/project",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				autoCreated: false,
			},
			{
				id: "panel-2",
				kind: "agent",
				ownerPanelId: null,
				sessionId: "alias-b",
				width: 400,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				projectPath: "/tmp/project",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				autoCreated: false,
			},
		];

		const panelStore: PanelStoreLike = {
			get panels() {
				return panels;
			},
			updatePanelSession: (panelId, sessionId) => {
				if (sessionId === "canonical-c" && panelId === "panel-2") {
					panels.splice(
						panels.findIndex((panel) => panel.id === "panel-2"),
						1
					);
					return;
				}
				const index = panels.findIndex((candidate) => candidate.id === panelId);
				if (index >= 0) {
					const panel = panels[index];
					panels[index] = {
						id: panel.id,
						kind: panel.kind,
						ownerPanelId: panel.ownerPanelId,
						sessionId,
						width: panel.width,
						pendingProjectSelection: panel.pendingProjectSelection,
						pendingWorktreeEnabled: panel.pendingWorktreeEnabled,
						preparedWorktreeLaunch: panel.preparedWorktreeLaunch,
						selectedAgentId: panel.selectedAgentId,
						projectPath: panel.projectPath,
						agentId: panel.agentId,
						sourcePath: panel.sourcePath,
						worktreePath: panel.worktreePath,
						sessionTitle: panel.sessionTitle,
						autoCreated: panel.autoCreated,
					};
				}
			},
		};

		healStartupPanelSessionIds(
			panelStore,
			{
				read: {
					resolveCanonicalSessionId: () => null,
					getSessionIdentity: () => ({ id: "canonical-c" }),
					getSessionMetadata: () => ({ title: "Canonical" }),
				},
			},
			{
				"alias-a": "canonical-c",
				"alias-b": "canonical-c",
			},
			{ warn: vi.fn() }
		);

		expect(panels).toHaveLength(1);
		expect(panels[0]?.sessionId).toBe("canonical-c");
	});

	it("binds persisted alias with known aliasRemaps entry", () => {
		const panels: Panel[] = [
			{
				id: "panel-1",
				kind: "agent",
				ownerPanelId: null,
				sessionId: "alias-a",
				width: 400,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				projectPath: "/tmp/project",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				autoCreated: false,
			},
		];

		const panelStore: PanelStoreLike = {
			get panels() {
				return panels;
			},
			updatePanelSession: (_panelId, sessionId) => {
				const panel = panels[0];
				panels[0] = {
					id: panel.id,
					kind: panel.kind,
					ownerPanelId: panel.ownerPanelId,
					sessionId,
					width: panel.width,
					pendingProjectSelection: panel.pendingProjectSelection,
					pendingWorktreeEnabled: panel.pendingWorktreeEnabled,
					preparedWorktreeLaunch: panel.preparedWorktreeLaunch,
					selectedAgentId: panel.selectedAgentId,
					projectPath: panel.projectPath,
					agentId: panel.agentId,
					sourcePath: panel.sourcePath,
					worktreePath: panel.worktreePath,
					sessionTitle: panel.sessionTitle,
					autoCreated: panel.autoCreated,
				};
			},
		};

		healStartupPanelSessionIds(
			panelStore,
			{
				read: {
					resolveCanonicalSessionId: () => null,
					getSessionIdentity: () => ({ id: "canonical-c" }),
					getSessionMetadata: () => ({ title: "Canonical" }),
				},
			},
			{ "alias-a": "canonical-c" },
			{ warn: vi.fn() }
		);

		expect(panels[0]?.sessionId).toBe("canonical-c");
	});

	it("emits diagnostic for unresolved persisted alias", () => {
		const warn = vi.fn();
		const panels: Panel[] = [
			{
				id: "panel-1",
				kind: "agent",
				ownerPanelId: null,
				sessionId: "orphan-alias",
				width: 400,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				projectPath: "/tmp/project",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				autoCreated: false,
			},
		];

		healStartupPanelSessionIds(
			{
				panels,
				updatePanelSession: vi.fn(),
			},
			{
				read: {
					resolveCanonicalSessionId: () => null,
					getSessionIdentity: () => undefined,
					getSessionMetadata: () => undefined,
				},
			},
			{},
			{ warn }
		);

		expect(warn).toHaveBeenCalledTimes(1);
		expect(panels[0]?.sessionId).toBe("orphan-alias");
	});

	it("does not clear unresolved alias before validation would run", () => {
		const panels: Panel[] = [
			{
				id: "panel-1",
				kind: "agent",
				ownerPanelId: null,
				sessionId: "orphan-alias",
				width: 400,
				pendingProjectSelection: false,
				pendingWorktreeEnabled: null,
				preparedWorktreeLaunch: null,
				selectedAgentId: null,
				projectPath: "/tmp/project",
				agentId: null,
				sourcePath: null,
				worktreePath: null,
				sessionTitle: null,
				autoCreated: false,
			},
		];

		const updatePanelSession = vi.fn();
		healStartupPanelSessionIds(
			{ panels, updatePanelSession },
			{
				read: {
					resolveCanonicalSessionId: () => null,
					getSessionIdentity: () => undefined,
					getSessionMetadata: () => undefined,
				},
			},
			{},
			{ warn: vi.fn() }
		);

		expect(updatePanelSession).not.toHaveBeenCalled();
		expect(panels[0]?.sessionId).toBe("orphan-alias");
	});
});
