/**
 * Agent Panel Types
 *
 * Type definitions for agent panel component and its subcomponents.
 * Each type is defined in its own file for clarity and maintainability.
 */

export type { AgentPanelContentProps } from "./agent-panel-content-props";
export type { AgentPanelHeaderProps } from "./agent-panel-header-props";
export type { AgentPanelInput } from "./agent-panel-input";
export type { AgentPanelProps } from "./agent-panel-props";
export type { AgentPanelResizeEdgeProps } from "./agent-panel-resize-edge-props";
export type { LoadingAnimationState } from "./loading-animation-state";
export type { PlanState } from "./plan-state";
export type { SessionStatusUI } from "./session-status-ui";

/**
 * Minimal session identity for plan loading.
 * Used by usePlanLoader hook to avoid depending on full Session object.
 */
export interface SessionIdentityForPlan {
	id: string;
	projectPath: string;
	agentId: string;
}
