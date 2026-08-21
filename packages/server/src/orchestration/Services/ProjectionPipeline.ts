import type { OrchestrationEvent, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export type ProjectorHealth = "healthy" | "degraded"

export class ProjectionUnknownError extends Schema.TaggedError<ProjectionUnknownError>()(
	"ProjectionUnknownError",
	{
		name: Schema.String
	}
) {
	override get message(): string {
		return `Projection pipeline has no projector named '${this.name}'.`
	}
}

export class ProjectionDuplicateNameError extends Schema.TaggedError<ProjectionDuplicateNameError>()(
	"ProjectionDuplicateNameError",
	{
		name: Schema.String
	}
) {
	override get message(): string {
		return `Projection pipeline registry has a duplicate projector named '${this.name}'.`
	}
}

export class ProjectionApplyError extends Schema.TaggedError<ProjectionApplyError>()(
	"ProjectionApplyError",
	{
		name: Schema.String,
		detail: Schema.String
	}
) {
	override get message(): string {
		return `Projector '${this.name}' failed: ${this.detail}`
	}
}

export type ProjectorApplyFailure = SqlError | Schema.SchemaError | ProjectionApplyError

export type ProjectorDefinition = {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, ProjectorApplyFailure>
	readonly truncate: (tx: SqlClient.SqlClient) => Effect.Effect<void, SqlError | Schema.SchemaError>
}

export interface ProjectionPipelineShape {
	readonly rebuild: (
		name: string
	) => Effect.Effect<void, ProjectionUnknownError | SqlError | Schema.SchemaError>
	readonly health: (
		name: string
	) => Effect.Effect<ProjectorHealth, ProjectionUnknownError | Schema.SchemaError>
}

export class ProjectionPipeline extends Context.Service<
	ProjectionPipeline,
	ProjectionPipelineShape
>()("@acepe/server/orchestration/Services/ProjectionPipeline") {}
