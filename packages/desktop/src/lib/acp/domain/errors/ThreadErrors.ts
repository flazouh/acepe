import { DomainError } from "./DomainError";

export class InvalidThreadIdError extends DomainError {
	readonly code = "INVALID_THREAD_ID";
}

export class InvalidProjectPathError extends DomainError {
	readonly code = "INVALID_PROJECT_PATH";
}

export class InvalidAgentIdError extends DomainError {
	readonly code = "INVALID_AGENT_ID";
}

export class ThreadNotFoundError extends DomainError {
	readonly code = "THREAD_NOT_FOUND";

	constructor(threadId: string) {
		super(`Thread not found: ${threadId}`);
	}
}

export class CannotModifyThreadError extends DomainError {
	readonly code = "CANNOT_MODIFY_THREAD";
}

export class InvalidStateTransitionError extends DomainError {
	readonly code = "INVALID_STATE_TRANSITION";

	constructor(
		public readonly from: string,
		public readonly to: string
	) {
		super(`Cannot transition from ${from} to ${to}`);
	}
}
