import type { OrchestrationCommand, OrchestrationEvent, Sequence } from "@acepe/contracts"
import type * as Arr from "effect/Array"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Metric from "effect/Metric"
import * as Schema from "effect/Schema"
import type * as Stream from "effect/Stream"
import type { SqlError } from "effect/unstable/sql/SqlError"
import type { OrchestrationCommandPreviouslyRejectedError } from "../../persistence/Services/OrchestrationCommandReceipts.ts"
import type { OrchestrationCommandInvariantError } from "../Errors.ts"
import type { OrchestrationProjectorDecodeError } from "../Schemas.ts"

export class OrchestrationEngineShutdownError extends Schema.TaggedError<OrchestrationEngineShutdownError>()(
	"OrchestrationEngineShutdownError",
	{}
) {
	override get message(): string {
		return "Orchestration engine is shut down."
	}
}

export type OrchestrationDispatchError =
	| OrchestrationCommandInvariantError
	| OrchestrationCommandPreviouslyRejectedError
	| OrchestrationProjectorDecodeError
	| OrchestrationEngineShutdownError
	| SqlError
	| Schema.SchemaError

export type OrchestrationDispatchResult = {
	readonly sequence: Sequence
}

export const orchestrationCommandsTotal = Metric.counter("acepe_orchestration_commands_total", {
	description: "Total orchestration commands dispatched.",
	incremental: true
})

export const orchestrationCommandDuration = Metric.timer("acepe_orchestration_command_duration", {
	description: "Orchestration command dispatch duration."
})

export const orchestrationCommandAckDuration = Metric.timer("acepe_orchestration_command_ack_duration", {
	description: "Time from orchestration command offer to the first committed domain event."
})

export interface OrchestrationEngineShape {
	readonly dispatch: (
		command: OrchestrationCommand
	) => Effect.Effect<OrchestrationDispatchResult, OrchestrationDispatchError>
	// appendEvents is the ONLY other write path into the event store besides
	// dispatch(command). It exists for services that author their own
	// contract events instead of going through decide() — today just
	// ProviderBridge.ts, which forwards a real provider adapter's own
	// already-shaped OrchestrationEvent stream (TokenAppended,
	// SessionMetaUpdated, ...). Events flow through the SAME single-writer
	// queue as commands (see OrchestrationEngine.ts Layer), so there is
	// still exactly one place that calls OrchestrationEventStore.append.
	// The `sequence` on each input event is a caller-local placeholder
	// (mirrors what decide() does internally) and gets overwritten with the
	// real committed sequence before the read model is projected and the
	// events are published.
	readonly appendEvents: (
		events: Arr.NonEmptyReadonlyArray<OrchestrationEvent>
	) => Effect.Effect<OrchestrationDispatchResult, OrchestrationDispatchError>
	readonly streamDomainEvents: Stream.Stream<OrchestrationEvent>
	readonly latestSequence: Effect.Effect<Sequence>
}

export class OrchestrationEngine extends Context.Service<
	OrchestrationEngine,
	OrchestrationEngineShape
>()("@acepe/server/orchestration/Services/OrchestrationEngine") {}
