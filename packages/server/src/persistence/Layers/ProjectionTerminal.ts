import { type OrchestrationEvent, TerminalId, TrimmedNonEmptyString, type ProjectedTerminal } from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedTerminal,
	evolveProjectedTerminal,
	PROJECTION_TERMINAL_NAME,
	ProjectionTerminal
} from "../Services/ProjectionTerminal.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const sqliteFlag = (value: boolean): 0 | 1 => {
	if (value) {
		return 1
	}
	return 0
}

const readCurrent = Effect.fn("ProjectionTerminal.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	terminalId: TerminalId
) {
	const rows = yield* tx`
		SELECT terminal_id, session_id, cwd, cols, rows, output, closed, sequence
		FROM projection_terminal
		WHERE terminal_id = ${terminalId}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedTerminal(row).pipe(Effect.map(Option.some))
	})
})

const upsert = Effect.fn("ProjectionTerminal.upsert")(function*(
	tx: SqlClient.SqlClient,
	state: ProjectedTerminal
) {
	yield* tx`
		INSERT INTO projection_terminal (
			terminal_id,
			session_id,
			cwd,
			cols,
			rows,
			output,
			closed,
			sequence
		) VALUES (
			${state.terminalId},
			${state.sessionId},
			${state.cwd},
			${state.cols},
			${state.rows},
			${state.output},
			${sqliteFlag(state.closed)},
			${state.sequence}
		)
		ON CONFLICT(terminal_id) DO UPDATE SET
			session_id = excluded.session_id,
			cwd = excluded.cwd,
			cols = excluded.cols,
			rows = excluded.rows,
			output = excluded.output,
			closed = excluded.closed,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionTerminalLive = Layer.effect(ProjectionTerminal)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_TERMINAL_NAME)

		const apply = Effect.fn("ProjectionTerminal.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current =
				event.aggregateKind === "terminal"
					? yield* readCurrent(tx, event.aggregateId)
					: Option.none<ProjectedTerminal>()
			const next = yield* evolveProjectedTerminal(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionTerminal.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_terminal`.withoutTransform.pipe(Effect.asVoid)
		})

		const get = Effect.fn("ProjectionTerminal.get")(function*(terminalId: TerminalId) {
			return yield* readCurrent(sql, terminalId)
		})

		return ProjectionTerminal.of({
			name,
			apply,
			truncate,
			get
		})
	})
)
