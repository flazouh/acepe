import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { OpenCodeContractFact } from "./Facts.ts"
import { jsonObjectOf } from "./Map.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const encodeFact = Schema.encodeUnknownExit(OpenCodeContractFact)
const decodeFact = Schema.decodeUnknownExit(OpenCodeContractFact)

export const encodeContractFact = (fact: OpenCodeContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<OpenCodeContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}
