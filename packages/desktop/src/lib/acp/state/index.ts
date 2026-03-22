// Session status types (for UI indicators)
// This is the UI-facing status, different from store's SessionStatus
export type SessionStatus = "warming" | "ready" | "claimed" | "error" | "empty" | "connected";

// Selector state manager
export { SelectorState } from "./selector-state.svelte.js";
