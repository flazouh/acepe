import {
	type OrchestrationEvent,
	TrimmedNonEmptyString,
	UserSettingKey
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as SqlClient from "effect/unstable/sql/SqlClient"
import {
	decodeStoredProjectedSetting,
	decodeStoredProjectedSettings,
	evolveProjectedSetting,
	PROJECTION_SETTINGS_NAME,
	type ProjectedSetting,
	ProjectionSettings,
	settingKeyFromEvent
} from "../Services/ProjectionSettings.ts"

const decodeName = Schema.decodeUnknownEffect(TrimmedNonEmptyString)

const readByKey = Effect.fn("ProjectionSettings.readByKey")(function*(
	tx: SqlClient.SqlClient,
	key: UserSettingKey
) {
	const rows = yield* tx`
		SELECT setting_key, setting_value, sequence
		FROM projection_settings
		WHERE setting_key = ${key}
	`.withoutTransform
	return yield* Option.match(Arr.head(rows), {
		onNone: () => Effect.succeed(Option.none()),
		onSome: (row) => decodeStoredProjectedSetting(row).pipe(Effect.map(Option.some))
	})
})

const readCurrent = Effect.fn("ProjectionSettings.readCurrent")(function*(
	tx: SqlClient.SqlClient,
	event: OrchestrationEvent
) {
	const key = settingKeyFromEvent(event)
	if (Option.isNone(key)) {
		return Option.none()
	}
	return yield* readByKey(tx, key.value)
})

const upsert = Effect.fn("ProjectionSettings.upsert")(function*(
	tx: SqlClient.SqlClient,
	setting: ProjectedSetting
) {
	yield* tx`
		INSERT INTO projection_settings (
			setting_key,
			setting_value,
			sequence
		) VALUES (
			${setting.key},
			${setting.value},
			${setting.sequence}
		)
		ON CONFLICT(setting_key) DO UPDATE SET
			setting_value = excluded.setting_value,
			sequence = excluded.sequence
	`.withoutTransform.pipe(Effect.asVoid)
})

export const ProjectionSettingsLive = Layer.effect(ProjectionSettings)(
	Effect.gen(function*() {
		const sql = yield* SqlClient.SqlClient
		const name = yield* decodeName(PROJECTION_SETTINGS_NAME)

		const apply = Effect.fn("ProjectionSettings.apply")(function*(
			event: OrchestrationEvent,
			tx: SqlClient.SqlClient
		) {
			const current = yield* readCurrent(tx, event)
			const next = yield* evolveProjectedSetting(current, event)
			if (Option.isNone(next)) {
				return
			}
			yield* upsert(tx, next.value)
		})

		const truncate = Effect.fn("ProjectionSettings.truncate")(function*(
			tx: SqlClient.SqlClient
		) {
			yield* tx`DELETE FROM projection_settings`.withoutTransform.pipe(Effect.asVoid)
		})

		const list = Effect.fn("ProjectionSettings.list")(function*() {
			const rows = yield* sql`
				SELECT setting_key, setting_value, sequence
				FROM projection_settings
				ORDER BY setting_key ASC
			`.withoutTransform
			return yield* decodeStoredProjectedSettings(rows)
		})

		const get = Effect.fn("ProjectionSettings.get")(function*(key: UserSettingKey) {
			return yield* readByKey(sql, key)
		})

		return ProjectionSettings.of({
			name,
			apply,
			truncate,
			list,
			get
		})
	})
)
