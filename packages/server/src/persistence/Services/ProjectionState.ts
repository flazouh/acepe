import { Sequence, TrimmedNonEmptyString } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type { SqlError } from "effect/unstable/sql/SqlError"

export class ProjectionState extends Context.Service<
	ProjectionState,
	{
		readonly checkpoint: (
			name: TrimmedNonEmptyString,
			sequence: Sequence
		) => Effect.Effect<void, SqlError | Schema.SchemaError>
		readonly lastApplied: (
			name: TrimmedNonEmptyString
		) => Effect.Effect<Sequence, SqlError | Schema.SchemaError>
	}
>()("@acepe/server/persistence/Services/ProjectionState") {}
