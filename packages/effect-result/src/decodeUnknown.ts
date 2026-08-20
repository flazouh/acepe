import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

export const decodeUnknown = <S extends Schema.ConstraintDecoder<unknown>, E>(
	schema: S,
	onError: (error: Schema.SchemaError) => E
): (input: unknown) => Result.Result<S["Type"], E> => {
	const decode = Schema.decodeUnknownResult(schema)
	return (input) => Result.mapError(decode(input), onError)
}
