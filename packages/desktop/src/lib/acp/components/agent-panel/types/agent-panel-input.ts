import type { Session } from "../../../application/dto/session.js";
import type { Project } from "../../../logic/project-manager.svelte.js";

/**
 * Input configuration for agent panel components.
 * All values accessed via getters for reactivity.
 *
 * sessionData comes from AppStateClass cache - no loading in panel.
 */
export interface AgentPanelInput {
	readonly panelId: string | undefined;
	readonly sessionId: string | null;
	readonly sessionData: Session | null;
	readonly width: number;
	readonly pendingProjectSelection: boolean;
	readonly recentProjects: readonly Project[];
	readonly activeAgentId: string | null;
	readonly effectiveTheme: "light" | "dark";
}
