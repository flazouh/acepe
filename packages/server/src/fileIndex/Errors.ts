import * as Schema from "effect/Schema"

export class FileIndexRootNotFoundError extends Schema.TaggedError<FileIndexRootNotFoundError>()(
	"FileIndexRootNotFoundError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `File index root was not found: ${this.path}`
	}
}

export class FileIndexNotADirectoryError extends Schema.TaggedError<FileIndexNotADirectoryError>()(
	"FileIndexNotADirectoryError",
	{
		path: Schema.String
	}
) {
	override get message(): string {
		return `File index root is not a directory: ${this.path}`
	}
}
