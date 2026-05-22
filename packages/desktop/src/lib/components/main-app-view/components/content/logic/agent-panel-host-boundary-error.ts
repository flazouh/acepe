export type AgentPanelBoundaryErrorLike = {
	message?: unknown;
	stack?: unknown;
	name?: unknown;
	backendCorrelationId?: unknown;
	backendEventId?: unknown;
};

export function normalizeAgentPanelBoundaryError(error: unknown): Error {
	if (error instanceof Error) {
		return error;
	}

	if (typeof error === "string" && error.length > 0) {
		return new Error(error);
	}

	if (error !== null && typeof error === "object") {
		const errorLike = error as AgentPanelBoundaryErrorLike;
		const message =
			typeof errorLike.message === "string" && errorLike.message.length > 0
				? errorLike.message
				: "Unknown agent panel error";
		const nextError = new Error(message);
		if (typeof errorLike.name === "string" && errorLike.name.length > 0) {
			nextError.name = errorLike.name;
		}
		if (typeof errorLike.stack === "string" && errorLike.stack.length > 0) {
			nextError.stack = errorLike.stack;
		}
		if (typeof errorLike.backendCorrelationId === "string") {
			(nextError as Error & { backendCorrelationId?: string }).backendCorrelationId =
				errorLike.backendCorrelationId;
		}
		if (typeof errorLike.backendEventId === "string") {
			(nextError as Error & { backendEventId?: string }).backendEventId = errorLike.backendEventId;
		}
		return nextError;
	}

	return new Error("Unknown agent panel error");
}

export function formatAgentPanelBoundaryError(error: Error): string {
	const lines: string[] = [];
	if (error.name && error.name !== "Error") {
		lines.push(`${error.name}: ${error.message}`);
	} else {
		lines.push(error.message);
	}

	if (error.stack) {
		const stackLines = error.stack.split("\n");
		const firstLine = stackLines[0]?.trim() ?? "";
		const isMessageLine =
			firstLine === `${error.name}: ${error.message}` || firstLine === error.message;
		const relevantLines = isMessageLine ? stackLines.slice(1) : stackLines;

		if (relevantLines.length > 0) {
			lines.push("");
			lines.push("Stack trace:");
			lines.push(...relevantLines.slice(0, 30));
		}
	}

	return lines.join("\n");
}
