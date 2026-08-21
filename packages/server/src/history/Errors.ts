import * as Schema from "effect/Schema"

export class HistoryMalformedLineWarning extends Schema.TaggedClass<HistoryMalformedLineWarning>()(
	"HistoryMalformedLineWarning",
	{
		path: Schema.String,
		lineNumber: Schema.Int.check(Schema.isGreaterThan(0)),
		reason: Schema.String
	}
) {}

export class HistoryDirectoryNotFoundError extends Schema.TaggedError<HistoryDirectoryNotFoundError>()(
	"HistoryDirectoryNotFoundError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `History directory was not found: ${this.path}`
	}
}
