/**
 * Durable alias→canonical index projected from Rust-asserted identity events.
 * Survives alias session row collapse (removeSession on the alias id).
 */
export type SessionIdentityResolverDeps = {
	readonly hasSession: (sessionId: string) => boolean;
};

export class SessionIdentityResolver {
	readonly #aliasToCanonical = new Map<string, string>();
	readonly #deps: SessionIdentityResolverDeps;

	constructor(deps: SessionIdentityResolverDeps) {
		this.#deps = deps;
	}

	recordAliasRelationship(requestedSessionId: string, canonicalSessionId: string): void {
		if (requestedSessionId === canonicalSessionId) {
			return;
		}
		this.#aliasToCanonical.set(requestedSessionId, canonicalSessionId);
	}

	recordFromGraph(input: {
		readonly isAlias: boolean;
		readonly requestedSessionId: string;
		readonly canonicalSessionId: string;
	}): void {
		if (input.isAlias && input.requestedSessionId !== input.canonicalSessionId) {
			this.recordAliasRelationship(input.requestedSessionId, input.canonicalSessionId);
		}
	}

	resolveCanonicalSessionId(requestedId: string): string | null {
		const aliasTarget = this.#aliasToCanonical.get(requestedId);
		if (aliasTarget !== undefined) {
			if (this.#deps.hasSession(aliasTarget)) {
				return aliasTarget;
			}
			this.#aliasToCanonical.delete(requestedId);
			return null;
		}

		if (this.#deps.hasSession(requestedId)) {
			return requestedId;
		}

		return null;
	}

	onCanonicalSessionRemoved(canonicalSessionId: string): void {
		for (const [aliasId, canonicalId] of this.#aliasToCanonical) {
			if (canonicalId === canonicalSessionId) {
				this.#aliasToCanonical.delete(aliasId);
			}
		}
	}

	/** Test seam — read alias mappings without session existence checks. */
	getAliasTargetForTest(aliasId: string): string | undefined {
		return this.#aliasToCanonical.get(aliasId);
	}
}
