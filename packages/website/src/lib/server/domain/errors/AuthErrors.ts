export class UnauthorizedError extends Error {
	constructor(message: string = "You are not authorized") {
		super(message);
		this.name = "UnauthorizedError";
	}
}

export class SessionCreationFailedError extends Error {
	constructor(message: string = "Failed to create session") {
		super(message);
		this.name = "SessionCreationFailedError";
	}
}

export class SessionValidationFailedError extends Error {
	constructor(message: string = "Failed to validate session") {
		super(message);
		this.name = "SessionValidationFailedError";
	}
}

export type AuthError =
	| UnauthorizedError
	| SessionCreationFailedError
	| SessionValidationFailedError;
