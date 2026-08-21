import * as Arr from "effect/Array"
import * as Equal from "effect/Equal"
import * as HashMap from "effect/HashMap"
import * as HashSet from "effect/HashSet"
import * as Option from "effect/Option"
import * as Predicate from "effect/Predicate"
import * as Schema from "effect/Schema"
import * as Str from "effect/String"
import type { CompletedExchange } from "./correlate.ts"
import { IsoDateTime, type RecordedExchange } from "./fixture.ts"

/**
 * Semantic comparison ignores these differences. Anything else is unexplained.
 *
 * 1. field-order: object keys are compared as a map. Insertion order is ignored.
 * 2. generated-ids: UUID, toolu_*, msg_*, perm-*, and named id fields are
 *    replaced by first-seen tokens `<id:n>` so relative identity is compared.
 * 3. timestamps: ISO-8601 strings and named timestamp fields become `<timestamp>`.
 */
export const NORMALIZATION_RULES = [
	{
		name: "field-order",
		description: "Object keys are compared as a map. Insertion order is ignored.",
	},
	{
		name: "generated-ids",
		description:
			"UUID, toolu_*, msg_*, perm-*, and named id fields are replaced by first-seen tokens <id:n>.",
	},
	{
		name: "timestamps",
		description:
			"ISO-8601 strings and timestamp / timestampMs / recordedAt / createdAt / updatedAt values become <timestamp>.",
	},
] as const

export const TIMESTAMP_TOKEN = "<timestamp>"

export const TIMESTAMP_FIELDS = [
	"createdAt",
	"created_at",
	"recordedAt",
	"timestamp",
	"timestampMs",
	"updatedAt",
	"updated_at",
] as const

export const GENERATED_ID_FIELDS = [
	"eventId",
	"permissionId",
	"sessionId",
	"session_id",
	"toolCallId",
	"uuid",
] as const

const timestampFields = HashSet.fromIterable<string>(TIMESTAMP_FIELDS)
const generatedIdFields = HashSet.fromIterable<string>(GENERATED_ID_FIELDS)

const UuidLike = Schema.String.check(
	Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
		expected: "a UUID",
	}),
)
const TooluId = Schema.String.check(
	Schema.isPattern(/^toolu_[A-Za-z0-9]+$/, { expected: "an Anthropic tool id" }),
)
const MsgId = Schema.String.check(
	Schema.isPattern(/^msg_[A-Za-z0-9]+$/, { expected: "an Anthropic message id" }),
)
const PermId = Schema.String.check(Schema.isPattern(/^perm-.+$/, { expected: "a permission id" }))
const isUuidLike = Schema.is(UuidLike)
const isTooluId = Schema.is(TooluId)
const isMsgId = Schema.is(MsgId)
const isPermId = Schema.is(PermId)
const isIsoDateTime = Schema.is(IsoDateTime)
const isJsonArray = Schema.is(Schema.Array(Schema.Json))
const isJsonRecord = Schema.is(Schema.Record(Schema.String, Schema.Json))

export const isTimestampField = (field: string): boolean => HashSet.has(timestampFields, field)

export const isGeneratedId = (value: string, field: string | undefined): boolean => {
	if (isUuidLike(value) || isTooluId(value) || isMsgId(value) || isPermId(value)) {
		return true
	}
	if (field === undefined) {
		return false
	}
	return HashSet.has(generatedIdFields, field) && Str.isNonEmpty(Str.trim(value))
}

export type GradeStatus = "pass" | "fail" | "skipped"

export type Divergence = {
	readonly path: string
	readonly expected: Option.Option<Schema.Json>
	readonly actual: Option.Option<Schema.Json>
}

export type ExchangeGrade = {
	readonly index: number
	readonly command: string
	readonly status: GradeStatus
	readonly skipReason: Option.Option<string>
	readonly divergence: Option.Option<Divergence>
}

type Subst = {
	readonly next: number
	readonly seen: HashMap.HashMap<string, string>
}

const emptySubst = (): Subst => ({
	next: 1,
	seen: HashMap.empty<string, string>(),
})

const idToken = (n: number): string => `<id:${String(n)}>`

const jsonKeys = (value: Schema.JsonObject): ReadonlyArray<string> => Arr.sort(Object.keys(value), Str.Order)

const jsonField = (value: Schema.JsonObject, key: string): Option.Option<Schema.Json> => {
	const child = value[key]
	if (child === undefined) {
		return Option.none()
	}
	return Option.some(child)
}

const jsonRecord = (entries: ReadonlyArray<readonly [string, Schema.Json]>): Schema.JsonObject =>
	Object.fromEntries(entries)

const internId = (value: string, subst: Subst): readonly [string, Subst] => {
	const existing = HashMap.get(subst.seen, value)
	if (Option.isSome(existing)) {
		return [existing.value, subst]
	}
	const token = idToken(subst.next)
	return [
		token,
		{
			next: subst.next + 1,
			seen: HashMap.set(subst.seen, value, token),
		},
	]
}

const normalizeNode = (
	value: Schema.Json,
	subst: Subst,
	field: string | undefined,
): readonly [Schema.Json, Subst] => {
	if (field !== undefined && isTimestampField(field)) {
		if (Predicate.isString(value) || Predicate.isNumber(value)) {
			return [TIMESTAMP_TOKEN, subst]
		}
	}
	if (Predicate.isString(value)) {
		if (isIsoDateTime(value)) {
			return [TIMESTAMP_TOKEN, subst]
		}
		if (isGeneratedId(value, field)) {
			return internId(value, subst)
		}
		return [value, subst]
	}
	if (
		Predicate.isNull(value) ||
		Predicate.isNumber(value) ||
		Predicate.isBoolean(value)
	) {
		return [value, subst]
	}
	if (isJsonArray(value)) {
		return Arr.reduce(
			value,
			[Arr.empty<Schema.Json>(), subst] as readonly [ReadonlyArray<Schema.Json>, Subst],
			([items, current], item) => {
				const [normalized, next] = normalizeNode(item, current, undefined)
				return [Arr.append(items, normalized), next]
			},
		)
	}
	if (isJsonRecord(value)) {
		const keys = jsonKeys(value)
		const reduced = Arr.reduce(
			keys,
			[Arr.empty<readonly [string, Schema.Json]>(), subst] as readonly [
				ReadonlyArray<readonly [string, Schema.Json]>,
				Subst,
			],
			([entries, current], key) =>
				Option.match(jsonField(value, key), {
					onNone: () => [entries, current] as const,
					onSome: (child) => {
						const [normalized, next] = normalizeNode(child, current, key)
						return [Arr.append(entries, [key, normalized]), next] as const
					},
				}),
		)
		return [jsonRecord(reduced[0]), reduced[1]]
	}
	return [value, subst]
}

export const normalizeJson = (value: Schema.Json): Schema.Json => {
	const [normalized] = normalizeNode(value, emptySubst(), undefined)
	return normalized
}

const childPath = (path: string, key: string): string => `${path}.${key}`

const indexPath = (path: string, index: number): string => `${path}[${String(index)}]`

const mismatch = (
	path: string,
	expected: Option.Option<Schema.Json>,
	actual: Option.Option<Schema.Json>,
): Divergence => ({
	path,
	expected,
	actual,
})

const walk = (expected: Schema.Json, actual: Schema.Json, path: string): Option.Option<Divergence> => {
	if (Equal.equals(expected, actual)) {
		return Option.none()
	}
	if (isJsonArray(expected) && isJsonArray(actual)) {
		const longest = expected.length > actual.length ? expected.length : actual.length
		if (longest === 0) {
			return Option.none()
		}
		return Arr.reduce(
			Arr.range(0, longest - 1),
			Option.none<Divergence>(),
			(found, index) => {
				if (Option.isSome(found)) {
					return found
				}
				const expectedItem = Arr.get(expected, index)
				const actualItem = Arr.get(actual, index)
				if (Option.isNone(expectedItem)) {
					return Option.some(mismatch(indexPath(path, index), Option.none(), actualItem))
				}
				if (Option.isNone(actualItem)) {
					return Option.some(mismatch(indexPath(path, index), expectedItem, Option.none()))
				}
				return walk(expectedItem.value, actualItem.value, indexPath(path, index))
			},
		)
	}
	if (isJsonRecord(expected) && isJsonRecord(actual)) {
		const keys = Arr.sort(Arr.dedupe(Arr.appendAll(jsonKeys(expected), jsonKeys(actual))), Str.Order)
		return Arr.reduce(keys, Option.none<Divergence>(), (found, key) => {
			if (Option.isSome(found)) {
				return found
			}
			const expectedChild = jsonField(expected, key)
			const actualChild = jsonField(actual, key)
			const nextPath = childPath(path, key)
			if (Option.isNone(expectedChild)) {
				return Option.some(mismatch(nextPath, Option.none(), actualChild))
			}
			if (Option.isNone(actualChild)) {
				return Option.some(mismatch(nextPath, expectedChild, Option.none()))
			}
			return walk(expectedChild.value, actualChild.value, nextPath)
		})
	}
	return Option.some(mismatch(path, Option.some(expected), Option.some(actual)))
}

export const firstDivergence = (
	expected: Schema.Json,
	actual: Schema.Json,
	path: string,
): Option.Option<Divergence> => walk(normalizeJson(expected), normalizeJson(actual), path)

export const skipExchange = (
	index: number,
	command: string,
	reason: string,
): ExchangeGrade => ({
	index,
	command,
	status: "skipped",
	skipReason: Option.some(reason),
	divergence: Option.none(),
})

const passed = (index: number, command: string): ExchangeGrade => ({
	index,
	command,
	status: "pass",
	skipReason: Option.none(),
	divergence: Option.none(),
})

const failed = (index: number, command: string, divergence: Divergence): ExchangeGrade => ({
	index,
	command,
	status: "fail",
	skipReason: Option.none(),
	divergence: Option.some(divergence),
})

export const gradeExchange = (
	index: number,
	expected: RecordedExchange,
	actual: Option.Option<CompletedExchange>,
	skipCommands: ReadonlyArray<string>,
): ExchangeGrade => {
	if (Arr.contains(skipCommands, expected.command) === true) {
		return skipExchange(index, expected.command, `command ${expected.command} is skipped`)
	}
	if (Option.isNone(actual)) {
		return failed(
			index,
			expected.command,
			mismatch(
				`exchanges[${String(index)}].response`,
				Option.some(expected.response),
				Option.none(),
			),
		)
	}
	const responsePath = `exchanges[${String(index)}].response`
	const responseDiff = firstDivergence(expected.response, actual.value.response, responsePath)
	if (Option.isSome(responseDiff)) {
		return failed(index, expected.command, responseDiff.value)
	}
	const notificationsPath = `exchanges[${String(index)}].notifications`
	const notificationDiff = firstDivergence(
		expected.notifications,
		actual.value.notifications,
		notificationsPath,
	)
	if (Option.isSome(notificationDiff)) {
		return failed(index, expected.command, notificationDiff.value)
	}
	return passed(index, expected.command)
}

export const gradeExchanges = (
	expected: ReadonlyArray<RecordedExchange>,
	actuals: ReadonlyArray<Option.Option<CompletedExchange>>,
	skipCommands: ReadonlyArray<string>,
): ReadonlyArray<ExchangeGrade> =>
	Arr.map(expected, (exchange, index) =>
		gradeExchange(index, exchange, Option.getOrElse(Arr.get(actuals, index), () => Option.none()), skipCommands),
	)
