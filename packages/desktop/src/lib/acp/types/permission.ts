import type {
	JsonValue,
	InteractionReplyHandler as GeneratedInteractionReplyHandler,
	ToolArguments,
	ToolReference,
} from "../../services/converted-session-types.js";
import {
	createLegacyInteractionReplyHandler,
	normalizeInteractionReplyHandler,
	type InteractionReplyHandler,
	type InteractionReplyHandlerInput,
} from "./reply-handler.js";

/**
 * Tool-call reference used to anchor a permission request to an existing tool row.
 */
export interface PermissionToolReference {
	messageID: string;
	callID: string;
}

/**
 * Permission option metadata supplied by the ACP subprocess.
 */
export interface PermissionOptionMetadata {
	kind: string;
	name: string;
	optionId: string;
}

/**
 * Permission metadata consumed by the desktop UI.
 */
export interface PermissionMetadata {
	rawInput?: JsonValue;
	parsedArguments?: ToolArguments | null;
	options?: PermissionOptionMetadata[];
}

/**
 * ACP permission metadata always carries the original tool payload and options.
 */
export interface AcpPermissionMetadata extends PermissionMetadata {
	rawInput: JsonValue;
	options: PermissionOptionMetadata[];
}

/**
 * Permission request from the agent.
 *
 * Represents a single pending permission prompt.
 *
 * - `id` is the canonical pending-request identity used by the store.
 * - `tool.callID` is the stable UI/tool-row anchor.
 * - `replyHandler` is the explicit backend-owned reply route when available.
 */
export interface PermissionRequest {
	/**
	 * Unique identity for this pending permission request.
	 */
	id: string;

	/**
	 * The session this permission belongs to.
	 */
	sessionId: string;

	/**
	 * The JSON-RPC request ID for this permission request.
	 * Used only to route the response back to the ACP subprocess.
	 * Only present for ACP mode (not OpenCode HTTP mode).
	 */
	jsonRpcRequestId?: number;

	/**
	 * Explicit reply routing metadata for this interaction.
	 */
	replyHandler?: InteractionReplyHandler;

	/**
	 * The permission being requested (e.g., "ReadFile", "RunCommand").
	 */
	permission: string;

	/**
	 * Patterns or paths the permission applies to.
	 */
	patterns: string[];

	/**
	 * Additional metadata about the permission request.
	 */
	metadata: PermissionMetadata;

	/**
	 * Options that should be shown as "always allow" choices.
	 */
	always: string[];

	/**
	 * Optional reference to the tool call that triggered this permission.
	 *
	 * `callID` is the stable tool-row anchor used to attach this permission to
	 * the originating tool call in the UI.
	 */
	tool?: PermissionToolReference;
}

/**
 * ACP permission request with the fields required for JSON-RPC replies.
 */
export interface AcpPermissionRequest extends PermissionRequest {
	jsonRpcRequestId: number;
	replyHandler: Extract<InteractionReplyHandler, { kind: "json-rpc" }>;
	metadata: AcpPermissionMetadata;
	tool: PermissionToolReference;
}

type PermissionRequestMetadataInput = PermissionMetadata | JsonValue;
type PermissionRequestToolInput = PermissionToolReference | ToolReference | null | undefined;
type PermissionRequestReplyHandlerInput =
	| InteractionReplyHandler
	| InteractionReplyHandlerInput
	| GeneratedInteractionReplyHandler
	| null
	| undefined;

export interface PermissionRequestBuilderInput {
	id: string;
	sessionId: string;
	jsonRpcRequestId?: number | null;
	replyHandler?: PermissionRequestReplyHandlerInput;
	permission: string;
	patterns: string[];
	metadata: PermissionRequestMetadataInput;
	always: string[];
	tool?: PermissionRequestToolInput;
}

function normalizePermissionMetadata(value: PermissionRequestMetadataInput): PermissionMetadata {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return {};
	}

	return value;
}

function normalizePermissionToolReference(
	tool: PermissionRequestToolInput
): PermissionToolReference | undefined {
	if (tool === undefined || tool === null) {
		return undefined;
	}

	if ("messageID" in tool) {
		return tool;
	}

	return {
		messageID: tool.messageId,
		callID: tool.callId,
	};
}

export function createPermissionRequest(input: PermissionRequestBuilderInput): PermissionRequest {
	return {
		id: input.id,
		sessionId: input.sessionId,
		jsonRpcRequestId: input.jsonRpcRequestId ?? undefined,
		replyHandler:
			normalizeInteractionReplyHandler(input.replyHandler) ??
			createLegacyInteractionReplyHandler(input.id, input.jsonRpcRequestId),
		permission: input.permission,
		patterns: input.patterns,
		metadata: normalizePermissionMetadata(input.metadata),
		always: input.always,
		tool: normalizePermissionToolReference(input.tool),
	};
}

/**
 * Build the canonical internal ID for an ACP permission request.
 *
 * This request identity is store-facing only. UI anchoring should continue to use
 * `tool.callID`, not this composite key.
 */
export function buildAcpPermissionId(
	sessionId: string,
	toolCallId: string,
	jsonRpcRequestId: number
): string {
	return `${sessionId}\u0000${toolCallId}\u0000${jsonRpcRequestId}`;
}

/**
 * Response to a permission request.
 */
export type PermissionReply = "once" | "always" | "reject";

/**
 * Permission update event from the ACP protocol.
 */
export type PermissionUpdate = {
	type: "permissionRequest";
	permission: PermissionRequest;
};

/**
 * Permission reply request to send to the backend.
 */
export interface PermissionReplyRequest {
	id: string;
	reply: PermissionReply;
}
