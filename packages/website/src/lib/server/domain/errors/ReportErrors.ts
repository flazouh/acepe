export class ReportNotFoundError extends Error {
	constructor(id: string) {
		super(`Report "${id}" not found`);
		this.name = "ReportNotFoundError";
	}
}

export class CommentNotFoundError extends Error {
	constructor(id: string) {
		super(`Comment "${id}" not found`);
		this.name = "CommentNotFoundError";
	}
}

export class ForbiddenError extends Error {
	constructor(message: string = "You do not have permission to perform this action") {
		super(message);
		this.name = "ForbiddenError";
	}
}

export class InvalidReplyDepthError extends Error {
	constructor() {
		super("Replies can only be one level deep");
		this.name = "InvalidReplyDepthError";
	}
}

export class DatabaseError extends Error {
	constructor(
		message: string,
		public readonly originalError?: unknown
	) {
		super(message);
		this.name = "DatabaseError";
	}
}

export type ReportError =
	| ReportNotFoundError
	| CommentNotFoundError
	| ForbiddenError
	| InvalidReplyDepthError
	| DatabaseError;
