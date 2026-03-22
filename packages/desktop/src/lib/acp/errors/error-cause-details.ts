type ErrorCauseValue = Error | string | number | boolean | object | null | undefined;

export type ErrorCauseDetails = {
	chain: string[];
	rootCause: string | null;
	formatted: string;
};

function normalizeMessage(message: string): string | null {
	const trimmed = message.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function getMessage(value: ErrorCauseValue): string | null {
	if (value instanceof Error) {
		return normalizeMessage(value.message);
	}
	if (typeof value === "string") {
		return normalizeMessage(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (value && typeof value === "object" && "message" in value) {
		const message = (value as { message?: string }).message;
		return typeof message === "string" ? normalizeMessage(message) : null;
	}
	return null;
}

function getCause(value: ErrorCauseValue): ErrorCauseValue {
	if (value instanceof Error) {
		return (value as Error & { cause?: ErrorCauseValue }).cause;
	}
	if (value && typeof value === "object" && "cause" in value) {
		return (value as { cause?: ErrorCauseValue }).cause;
	}
	return undefined;
}

export function getErrorCauseDetails(error: Error): ErrorCauseDetails {
	const messages: string[] = [];
	const seenMessages = new Set<string>();
	const visitedNodes = new Set<object>();

	let current: ErrorCauseValue = error;
	while (current !== null && current !== undefined) {
		if (typeof current === "object") {
			if (visitedNodes.has(current)) {
				break;
			}
			visitedNodes.add(current);
		}

		const message = getMessage(current);
		if (message !== null && !seenMessages.has(message)) {
			seenMessages.add(message);
			messages.push(message);
		}

		const nextCause = getCause(current);
		if (nextCause === null || nextCause === undefined) {
			break;
		}
		current = nextCause;
	}

	const primaryMessage = messages[0] ?? error.message;
	const nestedMessages = messages.slice(1);

	return {
		chain: messages,
		rootCause: nestedMessages.length > 0 ? messages[messages.length - 1] : null,
		formatted:
			nestedMessages.length > 0
				? `${primaryMessage} (cause: ${nestedMessages.join(" -> ")})`
				: primaryMessage,
	};
}

export function formatErrorWithCauses(error: Error): string {
	return getErrorCauseDetails(error).formatted;
}
