import * as Schema from "effect/Schema"

export class OrchestrationCommandInvariantError extends Schema.TaggedError<OrchestrationCommandInvariantError>()(
	"OrchestrationCommandInvariantError",
	{
		commandType: Schema.String,
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Orchestration command invariant failed (${this.commandType}): ${this.detail}`
	}
}
