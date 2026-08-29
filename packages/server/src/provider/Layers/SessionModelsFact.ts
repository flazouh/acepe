/**
 * The one codec for the session-models fact, shared by every provider.
 *
 * Deliberately NOT a member of any provider's own fact union (ClaudeContractFact
 * and friends): the catalog is a contract-level fact, so the projection that
 * folds it must be able to decode it without knowing which provider answered.
 * A per-provider copy of this shape is exactly the drift the canonical model
 * exists to prevent -- Claude asks its SDK, OpenCode reads an HTTP catalog, and
 * Copilot and Cursor read ACP config options, but all three publish THIS.
 */

import { SessionModelsListedFact } from "@acepe/contracts"
import { makeFactCodec } from "./FactCodec.ts"

export const {
	decodeContractFact: decodeSessionModelsFact,
	encodeContractFact: encodeSessionModelsFact
} = makeFactCodec(SessionModelsListedFact)
