export abstract class DomainError extends Error {
	abstract readonly code: string;

	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
	}
}

/**
 * Generic validation error for domain invariant violations.
 */
export class ValidationError extends DomainError {
	readonly code = "VALIDATION";
}

/**
 * Repository-level error for persistence operations.
 */
export class RepositoryError extends DomainError {
	readonly code = "REPOSITORY";
}
