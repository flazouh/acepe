import * as Schema from "effect/Schema"

export const ConfigOptionPresentation = Schema.Literals([
	"hidden",
	"advanced",
	"compactReasoning",
	"compactSpeed"
])
export type ConfigOptionPresentation = typeof ConfigOptionPresentation.Type

export const ConfigOptionValue = Schema.Struct({
	name: Schema.String,
	value: Schema.Json,
	description: Schema.NullOr(Schema.String).pipe(Schema.optionalKey)
})
export type ConfigOptionValue = typeof ConfigOptionValue.Type

export const ConfigOptionData = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	category: Schema.String,
	type: Schema.String,
	description: Schema.NullOr(Schema.String).pipe(Schema.optionalKey),
	currentValue: Schema.NullOr(Schema.Json).pipe(Schema.optionalKey),
	options: ConfigOptionValue.pipe(Schema.Array, Schema.optionalKey),
	presentation: ConfigOptionPresentation.pipe(Schema.optionalKey)
})
export type ConfigOptionData = typeof ConfigOptionData.Type

export const decodeConfigOptionData = Schema.decodeUnknownEffect(ConfigOptionData)
