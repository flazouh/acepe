import * as Arr from "effect/Array"
import * as Exit from "effect/Exit"
import * as Filter from "effect/Filter"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"

export type Json = typeof Schema.Json.Type
export type JsonObject = typeof Schema.JsonObject.Type

export const EMPTY_JSON_OBJECT: JsonObject = {}

export const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)
export const isJsonArray = Schema.is(Schema.Array(Schema.Json))

export const jsonObjectOf = (value: Json): Option.Option<JsonObject> => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return Option.some(exit.value)
	}
	return Option.none()
}

export const field = (record: JsonObject, key: string): Option.Option<Json> => {
	const value = record[key]
	if (value === undefined) {
		return Option.none()
	}
	return Option.some(value)
}

// A blank string is absent, not present-and-empty: every provider sends "" for
// a field it has no value for.
export const stringField = (record: JsonObject, key: string): Option.Option<string> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isString(value) && Str.isNonEmpty(Str.trim(value))
			? Option.some(value)
			: Option.none()
	)

export const stringFieldAny = (
	record: JsonObject,
	keys: ReadonlyArray<string>
): Option.Option<string> =>
	Arr.reduce(keys, Option.none<string>(), (found, key) =>
		Option.isSome(found) ? found : stringField(record, key)
	)

export const numberField = (record: JsonObject, key: string): Option.Option<number> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isNumber(value) ? Option.some(value) : Option.none()
	)

export const numberFieldAny = (
	record: JsonObject,
	keys: ReadonlyArray<string>
): Option.Option<number> =>
	Arr.reduce(keys, Option.none<number>(), (found, key) =>
		Option.isSome(found) ? found : numberField(record, key)
	)

export const booleanField = (record: JsonObject, key: string): Option.Option<boolean> =>
	Option.flatMap(field(record, key), (value) =>
		Predicate.isBoolean(value) ? Option.some(value) : Option.none()
	)

export const objectField = (record: JsonObject, key: string): Option.Option<JsonObject> =>
	Option.flatMap(field(record, key), jsonObjectOf)

export const arrayField = (
	record: JsonObject,
	key: string
): Option.Option<ReadonlyArray<Json>> =>
	Option.flatMap(field(record, key), (value) =>
		isJsonArray(value) ? Option.some(value) : Option.none()
	)

export const stringArrayField = (record: JsonObject, key: string): ReadonlyArray<string> =>
	Option.match(arrayField(record, key), {
		onNone: () => Arr.empty<string>(),
		onSome: (items) =>
			Arr.filterMap(
				items,
				Filter.fromPredicateOption((item) =>
					Predicate.isString(item) && Str.isNonEmpty(Str.trim(item))
						? Option.some(item)
						: Option.none()
				)
			)
	})

// A provider result that a reader will see has to be text, and only some
// providers report one as a string: Codex's is Json (an aggregated command
// output, else an { exitCode } object). A Json string renders as itself
// rather than as a quoted literal; a null renders as no text at all, which is
// what an absent output is. Safe against JSON.stringify's throw, because a
// Json value decoded by Schema.Json holds no cycle and no BigInt.
export const jsonText = (value: Json): string | null => {
	if (value === null) {
		return null
	}
	if (Predicate.isString(value)) {
		return value
	}
	return JSON.stringify(value)
}

export const applyOptional = <A, T>(
	current: A,
	value: T | undefined,
	apply: (next: A, present: T) => A
): A => {
	if (value === undefined) {
		return current
	}
	return apply(current, value)
}
