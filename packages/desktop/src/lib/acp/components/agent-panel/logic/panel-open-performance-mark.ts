export type PanelOpenPerformanceMarkName =
	| "agent-panel-host:props"
	| "agent-panel:props"
	| "agent-panel:root-state-start"
	| "agent-panel:root-state-end"
	| "agent-panel:header-snippet"
	| "agent-panel:content-snippet"
	| "agent-panel:pre-composer-snippet"
	| "agent-panel:composer-snippet"
	| "agent-panel:composer-mount-deferred"
	| "agent-panel:composer-mount-ready"
	| "agent-panel:agent-input-before"
	| "agent-panel:agent-input-after"
	| "agent-panel-content:props"
	| "agent-panel-content:input-session"
	| "agent-panel-content:input-no-session"
	| "agent-panel-content:view-project-selection"
	| "agent-panel-content:view-error"
	| "agent-panel-content:view-ready"
	| "agent-panel-content:view-conversation"
	| "agent-panel-content:shell-eligible"
	| "agent-panel-content:rows-ready"
	| "agent-panel-content:branch-renderable"
	| "agent-panel-content:branch-conversation"
	| "agent-panel-content:branch-session-shell"
	| "agent-panel-content:scene-before"
	| "agent-panel-content:scene-after"
	| "scene-content:props"
	| "scene-content:message-scroller-before"
	| "scene-content:message-scroller-after"
	| "agent-input:props"
	| "agent-input:state-end"
	| "agent-input:controller-end"
	| "agent-input:on-mount-start"
	| "agent-input:on-mount-listeners-scheduled"
	| "agent-input:on-mount-work-deferred"
	| "agent-input:on-mount-work-run"
	| "agent-input:on-mount-initialize-end"
	| "agent-input:on-mount-draft-end"
	| "agent-input:on-mount-editor-sync-start"
	| "agent-input:sync-empty-skip"
	| "agent-input:on-mount-editor-synced"
	| "agent-input:on-mount-width-deferred"
	| "agent-input:on-mount-end";

declare global {
	interface Window {
		__acepeRecordPanelOpenPerformanceMark?: (
			panelId: string,
			name: PanelOpenPerformanceMarkName,
			timestampMs: number
		) => void;
	}
}

export function recordPanelOpenPerformanceMark(
	panelId: string | undefined,
	name: PanelOpenPerformanceMarkName
): void {
	const enabled = import.meta.env.DEV || import.meta.env.VITE_ENABLE_QA_HOOKS === "1";
	if (!enabled || panelId === undefined || typeof window === "undefined") {
		return;
	}
	window.__acepeRecordPanelOpenPerformanceMark?.(panelId, name, performance.now());
}
