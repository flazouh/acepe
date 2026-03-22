export class InvalidEmailError extends Error {
	constructor(message: string = 'Invalid email format') {
		super(message);
		this.name = 'InvalidEmailError';
	}
}

export class EmailAlreadyExistsError extends Error {
	constructor(email: string) {
		super(`Email "${email}" is already on the waitlist`);
		this.name = 'EmailAlreadyExistsError';
	}
}

export class InvalidConfirmationTokenError extends Error {
	constructor(message: string = 'Invalid or expired confirmation token') {
		super(message);
		this.name = 'InvalidConfirmationTokenError';
	}
}

export class EmailConfirmationFailedError extends Error {
	constructor(message: string = 'Failed to confirm email') {
		super(message);
		this.name = 'EmailConfirmationFailedError';
	}
}

export class EmailSendingFailedError extends Error {
	constructor(message: string = 'Failed to send confirmation email') {
		super(message);
		this.name = 'EmailSendingFailedError';
	}
}

export class DatabaseError extends Error {
	constructor(
		message: string,
		public readonly originalError?: unknown
	) {
		super(message);
		this.name = 'DatabaseError';
	}
}

export type WaitlistError =
	| InvalidEmailError
	| EmailAlreadyExistsError
	| InvalidConfirmationTokenError
	| EmailConfirmationFailedError
	| EmailSendingFailedError
	| DatabaseError;
