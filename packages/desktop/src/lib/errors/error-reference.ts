export interface ErrorReferenceDetails {
	readonly referenceId: string;
	readonly searchable: boolean;
	readonly backendEventId?: string;
}

interface ErrorWithReference extends Error {
	cause?: unknown;
	__acepeReferenceDetails?: ErrorReferenceDetails;
	backendCorrelationId?: unknown;
	backendEventId?: unknown;
}

function extractOwnReferenceDetails(error: ErrorWithReference): ErrorReferenceDetails | null {
	const attached = error.__acepeReferenceDetails;
	if (attached !== undefined) {
		return attached;
	}

	const backendCorrelationId =
		typeof error.backendCorrelationId === "string" ? error.backendCorrelationId : null;
	if (backendCorrelationId === null) {
		return null;
	}

	const backendEventId =
		typeof error.backendEventId === "string" ? error.backendEventId : undefined;
	return {
		referenceId: backendCorrelationId,
		searchable: backendEventId !== undefined,
		backendEventId,
	};
}

export function createLocalReferenceDetails(): ErrorReferenceDetails {
	return {
		referenceId: crypto.randomUUID(),
		searchable: false,
	};
}

export function attachErrorReference<T extends Error>(
	error: T,
	details: ErrorReferenceDetails
): T {
	(error as ErrorWithReference).__acepeReferenceDetails = details;
	return error;
}

export function findErrorReference(error: unknown): ErrorReferenceDetails | null {
	let current: unknown = error;
	let depth = 0;

	while (current instanceof Error && depth < 10) {
		const ownReference = extractOwnReferenceDetails(current as ErrorWithReference);
		if (ownReference !== null) {
			return ownReference;
		}

		current = (current as ErrorWithReference).cause;
		depth += 1;
	}

	return null;
}

export function ensureErrorReference(
	error: Error,
	fallback?: Partial<Pick<ErrorReferenceDetails, "searchable" | "backendEventId">>
): ErrorReferenceDetails {
	const existingReference = findErrorReference(error);
	if (existingReference !== null) {
		return existingReference;
	}

	const errorWithReference = attachErrorReference(error, {
		referenceId: crypto.randomUUID(),
		searchable: fallback?.searchable === true,
		backendEventId: fallback?.backendEventId,
	}) as ErrorWithReference;

	return errorWithReference.__acepeReferenceDetails as ErrorReferenceDetails;
}
