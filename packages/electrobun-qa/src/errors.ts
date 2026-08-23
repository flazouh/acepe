import * as Schema from "effect/Schema"

export class QaAppNotRunning extends Schema.TaggedError<QaAppNotRunning>()("QaAppNotRunning", {
	// True when a connection had opened and then broke: worth one retry.
	// False when nothing listens at all: fail fast.
	retriable: Schema.optionalKey(Schema.Boolean),
	path: Schema.String,
}) {
	override get message(): string {
		return `QaAppNotRunning: no Electrobun app is listening at ${this.path}`
	}
}

// A connection that opened and then ran past its deadline. This is not
// QaAppNotRunning: the app answered the connect, so a large or slow
// response (e.g. a big snapshotDom with xterm mounted) is the likely cause,
// not a missing listener. The request may already have executed on the
// host side, so callers must not retry this blindly - a retried click could
// double-click.
export class QaResponseTimeout extends Schema.TaggedError<QaResponseTimeout>()("QaResponseTimeout", {
	path: Schema.String,
	method: Schema.String,
	deadlineMs: Schema.Number,
}) {
	override get message(): string {
		return `QaResponseTimeout: ${this.method} exceeded its ${String(this.deadlineMs)}ms deadline at ${this.path} (connection was open, so this is not retried)`
	}
}

export class QaEvalTimeout extends Schema.TaggedError<QaEvalTimeout>()("QaEvalTimeout", {
	token: Schema.String,
}) {
	override get message(): string {
		return `QaEvalTimeout: webview did not answer token ${this.token}`
	}
}

export class QaHelperTimeout extends Schema.TaggedError<QaHelperTimeout>()("QaHelperTimeout", {
	helper: Schema.String,
}) {
	override get message(): string {
		return `QaHelperTimeout: ${this.helper} passed its deadline`
	}
}

export class QaElementNotFound extends Schema.TaggedError<QaElementNotFound>()("QaElementNotFound", {
	query: Schema.String,
}) {
	override get message(): string {
		return `QaElementNotFound: no element matched ${this.query}`
	}
}

export class QaWindowNotFound extends Schema.TaggedError<QaWindowNotFound>()("QaWindowNotFound", {
	windowId: Schema.String,
}) {
	override get message(): string {
		return `QaWindowNotFound: ${this.windowId}`
	}
}

export class QaSignedBuild extends Schema.TaggedError<QaSignedBuild>()("QaSignedBuild", {
	reason: Schema.String,
}) {
	override get message(): string {
		return `QaSignedBuild: ${this.reason}`
	}
}

export class QaUnknownCommand extends Schema.TaggedError<QaUnknownCommand>()("QaUnknownCommand", {
	command: Schema.String,
}) {
	override get message(): string {
		return `QaUnknownCommand: ${this.command}`
	}
}

export class QaSocketError extends Schema.TaggedError<QaSocketError>()("QaSocketError", {
	reason: Schema.String,
}) {
	override get message(): string {
		return `QaSocketError: ${this.reason}`
	}
}

export class QaEvalFailed extends Schema.TaggedError<QaEvalFailed>()("QaEvalFailed", {
	reason: Schema.String,
}) {
	override get message(): string {
		return `QaEvalFailed: ${this.reason}`
	}
}

export class QaScreenshotDisabled extends Schema.TaggedError<QaScreenshotDisabled>()(
	"QaScreenshotDisabled",
	{},
) {
	override get message(): string {
		return "QaScreenshotDisabled: use snapshotText; screenshots are not QA evidence"
	}
}

export type QaError =
	| QaAppNotRunning
	| QaResponseTimeout
	| QaEvalTimeout
	| QaHelperTimeout
	| QaElementNotFound
	| QaWindowNotFound
	| QaSignedBuild
	| QaUnknownCommand
	| QaSocketError
	| QaEvalFailed
	| QaScreenshotDisabled
