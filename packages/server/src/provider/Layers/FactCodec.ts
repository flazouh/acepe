import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { type Json, jsonObjectOf, type JsonObject } from "./Json.ts"

export type FactCodec<Fact> = {
	readonly encodeContractFact: (fact: Fact) => Option.Option<JsonObject>
	readonly decodeContractFact: (value: Json) => Option.Option<Fact>
}

/**
 * A fact that fails to encode is dropped rather than raised: the caller is a
 * projection that must keep the rest of the transcript.
 */
export const makeFactCodec = <Fact, Encoded extends Json>(
	schema: Schema.Codec<Fact, Encoded>
): FactCodec<Fact> => {
	const decodeFact = Schema.decodeUnknownExit(schema)
	const encodeFact = Schema.encodeUnknownExit(schema)

	return {
		encodeContractFact: (fact) => {
			const encoded = encodeFact(fact)
			if (Exit.isFailure(encoded)) {
				return Option.none()
			}
			return jsonObjectOf(encoded.value)
		},
		decodeContractFact: (value) => {
			const decoded = decodeFact(value)
			if (Exit.isFailure(decoded)) {
				return Option.none()
			}
			return Option.some(decoded.value)
		}
	}
}
