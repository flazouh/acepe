export interface JsonRpcInteractionReplyHandler {
	kind: "json-rpc";
	requestId: number;
}

export interface HttpInteractionReplyHandler {
	kind: "http";
	requestId: string;
}

export type InteractionReplyHandler = JsonRpcInteractionReplyHandler | HttpInteractionReplyHandler;

export interface InteractionReplyHandlerInput {
	kind: "json-rpc" | "json_rpc" | "http" | "JsonRpc" | "Http";
	requestId: string | number;
}

export function createLegacyInteractionReplyHandler(
	id: string,
	jsonRpcRequestId?: number | null
): InteractionReplyHandler {
	if (jsonRpcRequestId !== undefined && jsonRpcRequestId !== null) {
		return {
			kind: "json-rpc",
			requestId: jsonRpcRequestId,
		};
	}

	return {
		kind: "http",
		requestId: id,
	};
}

export function normalizeInteractionReplyHandler(
	replyHandler: InteractionReplyHandlerInput | null | undefined
): InteractionReplyHandler | undefined {
	if (replyHandler === undefined || replyHandler === null) {
		return undefined;
	}

	if (
		replyHandler.kind === "json-rpc" ||
		replyHandler.kind === "json_rpc" ||
		replyHandler.kind === "JsonRpc"
	) {
		const requestId =
			typeof replyHandler.requestId === "number"
				? replyHandler.requestId
				: Number.parseInt(replyHandler.requestId, 10);
		if (Number.isSafeInteger(requestId)) {
			return {
				kind: "json-rpc",
				requestId,
			};
		}
		return undefined;
	}

	return {
		kind: "http",
		requestId:
			typeof replyHandler.requestId === "string"
				? replyHandler.requestId
				: String(replyHandler.requestId),
	};
}
