import { makeFactCodec } from "../FactCodec.ts"
import { GrokContractFact } from "./Facts.ts"

export const { decodeContractFact, encodeContractFact } = makeFactCodec(GrokContractFact)
