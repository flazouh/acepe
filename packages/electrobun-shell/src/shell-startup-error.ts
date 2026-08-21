import * as Schema from "effect/Schema"

export const SHELL_STARTUP_FAILED_PREFIX = "acepe-shell-startup-failed"

export class ShellStartupError extends Schema.TaggedError<ShellStartupError>()(
	"ShellStartupError",
	{
		reason: Schema.String,
	},
) {
	override get message(): string {
		return `${SHELL_STARTUP_FAILED_PREFIX}: ${this.reason}`
	}
}
