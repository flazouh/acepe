/**
 * Session DTO types.
 *
 * This module exports all session-related types organized by concern:
 *
 * Identity & Metadata:
 * - SessionIdentity: Immutable lookup keys (id, projectPath, agentId)
 * - SessionMetadata: Rarely changing data (title, timestamps)
 * - SessionCold: Identity + Metadata (what gets persisted)
 *
 * State & Capabilities:
 * - SessionStatus: UI state (idle, loading, streaming, etc.)
 * - SessionCapabilities: ACP configuration (models, modes, commands)
 *
 * Content:
 * - SessionEntry: Conversation entries (user, assistant, tool_call, etc.)
 * - TaskProgress: Live task step tracking
 *
 * Composite:
 * - Session: Full session with all fields (what components receive)
 * - SessionSummary: Lightweight for list views
 *
 * Configuration:
 * - Model: Available AI model
 * - Mode: Available agent mode
 */

export type { Mode } from "./mode.js";
// Configuration
export type { Model } from "./model.js";
// Composite
export type { Session } from "./session.js";
export type { SessionCapabilities } from "./session-capabilities.js";
export type { SessionCold } from "./session-cold.js";

// Content
export type { SessionEntry } from "./session-entry.js";
// Identity & Metadata
export type { SessionIdentity } from "./session-identity.js";
export type { SessionMetadata } from "./session-metadata.js";
// State & Capabilities
export type { SessionStatus } from "./session-status.js";
export type { SessionSummary } from "./session-summary.js";
export type { TaskProgress } from "./task-progress.js";
