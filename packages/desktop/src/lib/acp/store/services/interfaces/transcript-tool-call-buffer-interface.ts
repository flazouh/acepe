/**
 * Transcript Tool Call Buffer Interface
 *
 * Narrow interface for tool call CRUD, child-parent reconciliation,
 * and streaming argument storage. Combines the original tool call
 * and streaming input responsibilities since Rust pre-parses arguments.
 */

import type { Result } from "neverthrow";

import type {
	ToolCallData,
	ToolCallUpdateData,
} from "../../../../services/converted-session-types.js";
import type { AppError } from "../../../errors/app-error.js";

export interface ITranscriptToolCallBuffer {
	createEntry(sessionId: string, data: ToolCallData): Result<void, AppError>;
	updateEntry(sessionId: string, update: ToolCallUpdateData): Result<void, AppError>;
	getToolCallIdsForSession(sessionId: string): ReadonlySet<string>;
	clearStreamingArguments(toolCallId: string): void;
	clearSession(sessionId: string): void;
}
