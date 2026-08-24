import type { GetProviderAccountUsageRequest, ProviderAccountUsage } from "@acepe/contracts"
import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"

// The getProviderAccountUsage RPC's handler (see packages/server/src/rpc/
// handlers.ts) calls straight through to this. getUsage never fails: a
// provider whose data cannot be read is folded into that provider's own
// ProviderAccountUsage.connection: "unavailable" entry (see usageMapping.ts)
// rather than failing the whole request -- see providerUsage.ts's contract
// comment and RpcProviderUsageError's doc comment in rpc.ts.
export interface ProviderUsageServiceShape {
	readonly getUsage: (
		request: GetProviderAccountUsageRequest,
	) => Effect.Effect<ReadonlyArray<ProviderAccountUsage>>
}

export class ProviderUsageService extends Context.Service<ProviderUsageService, ProviderUsageServiceShape>()(
	"@acepe/server/providerUsage/Services/ProviderUsageService",
) {}
