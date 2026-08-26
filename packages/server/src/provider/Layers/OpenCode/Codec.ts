import { makeFactCodec } from "../FactCodec.ts"
import { OpenCodeContractFact } from "./Facts.ts"

export const { decodeContractFact, encodeContractFact } = makeFactCodec(OpenCodeContractFact)
