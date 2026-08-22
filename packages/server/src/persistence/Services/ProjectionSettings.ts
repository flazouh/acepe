import {
	type OrchestrationEvent,
	Sequence,
	SettingsUpdatedPayload,
	TrimmedNonEmptyString,
	UserSettingKey,
	SettingsValue
} from "@acepe/contracts"
import * as Arr from "effect/Array"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import type * as SqlClient from "effect/unstable/sql/SqlClient"
import type { SqlError } from "effect/unstable/sql/SqlError"

export const PROJECTION_SETTINGS_NAME = "projection.settings"
export const PROJECTION_SETTINGS_TABLE = "projection_settings"

export const ProjectedSetting = Schema.Struct({
	key: UserSettingKey,
	value: SettingsValue,
	sequence: Sequence
})
export type ProjectedSetting = typeof ProjectedSetting.Type

export const ProjectionSettingRow = Schema.Struct({
	setting_key: UserSettingKey,
	setting_value: SettingsValue,
	sequence: Sequence
})
export type ProjectionSettingRow = typeof ProjectionSettingRow.Type

export interface ProjectionSettingsShape {
	readonly name: TrimmedNonEmptyString
	readonly apply: (
		event: OrchestrationEvent,
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly truncate: (
		tx: SqlClient.SqlClient
	) => Effect.Effect<void, SqlError | Schema.SchemaError>
	readonly list: () => Effect.Effect<
		ReadonlyArray<ProjectedSetting>,
		SqlError | Schema.SchemaError
	>
	readonly get: (
		key: UserSettingKey
	) => Effect.Effect<Option.Option<ProjectedSetting>, SqlError | Schema.SchemaError>
}

export class ProjectionSettings extends Context.Service<
	ProjectionSettings,
	ProjectionSettingsShape
>()("@acepe/server/persistence/Services/ProjectionSettings") {}

const projectedSettingFromRow = (row: ProjectionSettingRow): ProjectedSetting => ({
	key: row.setting_key,
	value: row.setting_value,
	sequence: row.sequence
})

const decodeRow = Schema.decodeUnknownEffect(ProjectionSettingRow)
const decodeRows = Schema.decodeUnknownEffect(Schema.Array(ProjectionSettingRow))

export const decodeStoredProjectedSetting = Effect.fn("decodeStoredProjectedSetting")(
	function*(input: unknown) {
		const row = yield* decodeRow(input)
		return projectedSettingFromRow(row)
	}
)

export const decodeStoredProjectedSettings = Effect.fn("decodeStoredProjectedSettings")(
	function*(input: unknown) {
		const rows = yield* decodeRows(input)
		return Arr.map(rows, projectedSettingFromRow)
	}
)

const decodePayload = <S extends Schema.Top>(schema: S, value: unknown) =>
	Schema.decodeUnknownEffect(schema)(value)

const ignoreEvent = (
	current: Option.Option<ProjectedSetting>
): Effect.Effect<Option.Option<ProjectedSetting>> => Effect.succeed(current)

const projectSettingsUpdated = (
	event: Extract<OrchestrationEvent, { readonly type: "SettingsUpdated" }>
): Effect.Effect<Option.Option<ProjectedSetting>, Schema.SchemaError> =>
	decodePayload(SettingsUpdatedPayload, event.payload).pipe(
		Effect.map((payload) =>
			Option.some({
				key: payload.key,
				value: payload.value,
				sequence: event.sequence
			})
		)
	)

export const evolveProjectedSetting = (
	current: Option.Option<ProjectedSetting>,
	event: OrchestrationEvent
): Effect.Effect<Option.Option<ProjectedSetting>, Schema.SchemaError> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => ignoreEvent(current),
			ProjectMetaUpdated: () => ignoreEvent(current),
			ProjectDeleted: () => ignoreEvent(current),
			SessionCreated: () => ignoreEvent(current),
			SessionMetaUpdated: () => ignoreEvent(current),
			SessionArchived: () => ignoreEvent(current),
			SessionUnarchived: () => ignoreEvent(current),
			SessionDeleted: () => ignoreEvent(current),
			MessageSent: () => ignoreEvent(current),
			TokenAppended: () => ignoreEvent(current),
			TurnCancelled: () => ignoreEvent(current),
			CheckpointCreated: () => ignoreEvent(current),
			CheckpointReadinessChanged: () => ignoreEvent(current),
			CheckpointReverted: () => ignoreEvent(current),
			SettingsUpdated: (updated) => projectSettingsUpdated(updated)
		})
	)(event)

export const settingKeyFromEvent = (event: OrchestrationEvent): Option.Option<UserSettingKey> =>
	Match.type<OrchestrationEvent>().pipe(
		Match.discriminatorsExhaustive("type")({
			ProjectCreated: () => Option.none(),
			ProjectMetaUpdated: () => Option.none(),
			ProjectDeleted: () => Option.none(),
			SessionCreated: () => Option.none(),
			SessionMetaUpdated: () => Option.none(),
			SessionArchived: () => Option.none(),
			SessionUnarchived: () => Option.none(),
			SessionDeleted: () => Option.none(),
			MessageSent: () => Option.none(),
			TokenAppended: () => Option.none(),
			TurnCancelled: () => Option.none(),
			CheckpointCreated: () => Option.none(),
			CheckpointReadinessChanged: () => Option.none(),
			CheckpointReverted: () => Option.none(),
			SettingsUpdated: (updated) => Option.some(updated.payload.key)
		})
	)(event)
