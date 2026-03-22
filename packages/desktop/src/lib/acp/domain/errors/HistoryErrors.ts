import { DomainError } from "./DomainError";
import { SessionNotFoundError } from "./SessionErrors";

export class HistoryReadError extends DomainError {
	readonly code = "HISTORY_READ";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

export class HistoryWriteError extends DomainError {
	readonly code = "HISTORY_WRITE";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

export class HistorySyncError extends DomainError {
	readonly code = "HISTORY_SYNC";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

// Re-export SessionNotFoundError from SessionErrors for convenience
export { SessionNotFoundError };

export class PlanNotFoundError extends DomainError {
	readonly code = "PLAN_NOT_FOUND";

	constructor(slug: string) {
		super(`Plan not found: ${slug}`);
	}
}

export class FileSystemError extends DomainError {
	readonly code = "FILESYSTEM";

	constructor(
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
	}
}

export class NotImplementedError extends DomainError {
	readonly code = "NOT_IMPLEMENTED";
}
