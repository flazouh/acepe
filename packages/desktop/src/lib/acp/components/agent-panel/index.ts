// Export idiomatic Svelte 5 components
export { AgentPanel } from "./components/index.js";

// Export state (old anti-pattern version - kept for backwards compatibility)
export { AgentPanelState } from "./state/agent-panel-state.svelte.js";
export { AgentPanelState as AgentPanelStateManager } from "./state/index.js";
// Export types
export type { AgentPanelInput } from "./types/index.js";
