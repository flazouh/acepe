import {
	APP_VOICE_ID,
	type OrchestrationEvent,
	ProjectedVoice,
	TrimmedNonEmptyString
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedVoice,
	encodeProjectedVoice,
	evolveProjectedVoice,
	PROJECTION_VOICE_NAME,
	ProjectionVoice
} from "../Services/ProjectionVoice.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readCurrent = Effect.fn("ProjectionVoice.readCurrent")(function*(tx: SqlClient.SqlClient) {
	const rows = yield* tx`
		SELECT
			voice_id,
			models_json,
			languages_json,
			recording_json,
			last_transcription_json,
			sequence
		FROM projection_voice
		WHERE voice_id = ${APP_VOICE_ID}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedVoice(row).pipe(Effect.map(Option.some))
	})
})

const upsert = Effect.fn("ProjectionVoice.upsert")(function*(
	tx: SqlClient.SqlClient,
	voice: ProjectedVoice
) {
	const encoded = yield* encodeProjectedVoice(voice)
	yield* tx`
		INSERT INTO projection_voice (
			voice_id,
			models_json,
			languages_json,
			recording_json,
			last_transcription_json,
			sequence
		) VALUES (
			${encoded.voiceId},
			${encoded.modelsJson},
			${encoded.languagesJson},
			${encoded.recordingJson},
			${encoded.lastTranscriptionJson},
			${encoded.sequence}
		)
		ON CONFLICT(voice_id) DO UPDATE SET
			models_json = excluded.models_json,
			languages_json = excluded.languages_json,
			recording_json = excluded.recording_json,
			last_transcription_json = excluded.last_transcription_json,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionVoiceLive = Layer.effect(ProjectionVoice)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_VOICE_NAME)

		const apply = Effect.fn("ProjectionVoice.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* readCurrent(tx)
			const next = yield* evolveProjectedVoice(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionVoice.truncate")(function*(tx: SqlClient.SqlClient) {
			yield* tx`DELETE FROM projection_voice`.withoutTransform.pipe(Effect.asVoid)
		})

		const get = Effect.fn("ProjectionVoice.get")(function*() {
			return yield* readCurrent(sql)
		})

		return ProjectionVoice.of({
			name,
			apply,
			truncate,
			get
		})
	})
)
