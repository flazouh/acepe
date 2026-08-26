import { makeFactCodec } from "../FactCodec.ts"
import { CursorContractFact } from "./Facts.ts"

export const { decodeContractFact, encodeContractFact } = makeFactCodec(CursorContractFact)
