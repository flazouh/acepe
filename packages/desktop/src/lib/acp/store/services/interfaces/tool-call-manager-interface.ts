/**
 * Tool Call Manager Interface
 *
 * Narrow interface for tool call CRUD, child-parent reconciliation,
 * and streaming argument storage. Combines the original tool call
 * and streaming input responsibilities since Rust pre-parses arguments.
 */

import type { Result } from "neverthrow";

import type { ToolArguments, ToolCallData } from "../../../../services/converted-session-types.js";
import type { AppError } from "../../../errors/app-error.js";
import type { ToolCallUpdate } from "../../../types/tool-call.js";

export interface IToolCallManager {
	createEntry(sessionId: string, data: ToolCallData): Result<void, AppError>;
	updateEntry(sessionId: string, update: ToolCallUpdate): Result<void, AppError>;
	updateChildInParent(sessionId: string, update: ToolCallUpdate): Result<void, AppError>;
	getToolCallIdsForSession(sessionId: string): ReadonlySet<string>;
	setStreamingArguments(sessionId: string, toolCallId: string, args: ToolArguments): void;
	getStreamingArguments(toolCallId: string): ToolArguments | undefined;
	clearStreamingArguments(toolCallId: string): void;
	clearSession(sessionId: string): void;
}
