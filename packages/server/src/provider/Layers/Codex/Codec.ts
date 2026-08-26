import { makeFactCodec } from "../FactCodec.ts"
import { CodexContractFact } from "./Facts.ts"

export const { decodeContractFact, encodeContractFact } = makeFactCodec(CodexContractFact)
