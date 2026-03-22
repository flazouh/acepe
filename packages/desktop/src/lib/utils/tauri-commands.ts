import { invoke as tauriInvoke } from "@tauri-apps/api/core";

// Import generated TypeScript types and values from Rust (specta)
// To regenerate: cd packages/desktop/src-tauri && cargo test export_command_values -- --nocapture
import type {
	AcpCommands as GeneratedAcpCommands,
	CursorHistoryCommands as GeneratedCursorHistoryCommands,
	GitHubCommands as GeneratedGitHubCommands,
	SessionHistoryCommands as GeneratedSessionHistoryCommands,
	StorageCommands as GeneratedStorageCommands,
} from "../services/command-names";

import { COMMANDS } from "../services/command-names";

/**
 * Type-safe wrapper around Tauri's invoke.
 *
 * Note: Tauri 2 expects camelCase argument names that match the Rust parameter names
 * after automatic snake_case to camelCase conversion.
 *
 * Usage:
 * ```ts
 * const result = await invoke('get_full_session', {
 *   sessionId: 'abc-123',
 *   projectPath: '/path/to/project'
 * });
 * // Tauri 2 automatically matches sessionId -> session_id in Rust
 * ```
 */
export async function invoke<
	TResult,
	TArgs extends Record<string, unknown> = Record<string, unknown>,
>(command: string, args?: TArgs): Promise<TResult> {
	// Tauri 2 expects camelCase args - it auto-converts to match Rust snake_case params
	return tauriInvoke<TResult>(command, args);
}

// ============================================
// Command Constants (shared with Rust)
// These values are auto-generated from Rust by specta
// To regenerate: cd packages/desktop/src-tauri && cargo test export_command_values -- --nocapture
// DO NOT EDIT - any changes will be overwritten
// ============================================

/**
 * ACP (Agent Client Protocol) command names.
 * Generated from Rust to ensure sync between frontend and backend.
 */
export const AcpCommands: GeneratedAcpCommands = COMMANDS.acp;

/**
 * Session history command names (jsonl-backed).
 * Generated from Rust to ensure sync between frontend and backend.
 */
export const SessionHistoryCommands: GeneratedSessionHistoryCommands = COMMANDS.session_history;

/**
 * Storage command names.
 * Generated from Rust to ensure sync between frontend and backend.
 */
export const StorageCommands: GeneratedStorageCommands = COMMANDS.storage;

/**
 * Cursor history command names.
 * Generated from Rust to ensure sync between frontend and backend.
 */
export const CursorHistoryCommands: GeneratedCursorHistoryCommands = COMMANDS.cursor_history;

/**
 * GitHub integration command names.
 * Generated from Rust to ensure sync between frontend and backend.
 */
export const GitHubCommands: GeneratedGitHubCommands = COMMANDS.github;

/**
 * All available Tauri commands grouped by category.
 * Generated from Rust to ensure sync between frontend and backend.
 */
export { COMMANDS as Commands } from "../services/command-names";
