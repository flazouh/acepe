import * as Exit from "effect/Exit"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { CodexContractFact } from "./Facts.ts"

type Json = typeof Schema.Json.Type
type JsonObject = typeof Schema.JsonObject.Type

const decodeJsonObject = Schema.decodeUnknownExit(Schema.JsonObject)

const decodeFact = Schema.decodeUnknownExit(CodexContractFact)
const encodeFact = Schema.encodeUnknownExit(CodexContractFact)

const jsonObjectOf = (value: Json): Option.Option<JsonObject> => {
	const exit = decodeJsonObject(value)
	if (Exit.isSuccess(exit)) {
		return Option.some(exit.value)
	}
	return Option.none()
}

export const encodeContractFact = (fact: CodexContractFact): Option.Option<JsonObject> => {
	const encoded = encodeFact(fact)
	if (Exit.isFailure(encoded)) {
		return Option.none()
	}
	return jsonObjectOf(encoded.value)
}

export const decodeContractFact = (value: Json): Option.Option<CodexContractFact> => {
	const decoded = decodeFact(value)
	if (Exit.isFailure(decoded)) {
		return Option.none()
	}
	return Option.some(decoded.value)
}
