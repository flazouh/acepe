<script lang="ts">
/**
 * QA fixture: the agent panel's sign-in card, one per agent, built from the
 * live backend's sign-in method rather than a hand-written one.
 *
 * It exists because whether an agent gets a sign-in control at all is a
 * backend fact (packages/server/src/provider/signIn.ts), and a static fixture
 * cannot show that the fact travelled. Rendered from the fixture route only.
 */
import { AgentPanelSignInCard } from "@acepe/ui/agent-panel";
import { Button } from "@acepe/ui/button";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { rootCauseMessage } from "$lib/acp/errors/error-cause-details.js";
import { type AgentInfo, api } from "$lib/acp/store/api.js";
import { deriveSignInCard } from "../logic/sign-in-card.js";

// AgentInfo, not the store's Agent: this reads what the backend answered,
// and sign_in is required there because the wire always carries it.
let agents = $state<AgentInfo[]>([]);
let loadError = $state<string | null>(null);

async function loadAgents(): Promise<void> {
	const outcome = await Effect.runPromise(Effect.result(api.listAgents()));
	if (Result.isFailure(outcome)) {
		loadError = rootCauseMessage(outcome.failure);
		agents = [];
		return;
	}
	loadError = null;
	agents = outcome.success;
}
</script>

<div class="flex w-[360px] flex-col gap-2" data-testid="live-sign-in-cards">
	<Button variant="secondary" size="xs" onclick={loadAgents}>Load sign-in methods</Button>
	{#if loadError !== null}
		<span data-testid="live-sign-in-load-error" class="text-[0.625rem] text-destructive">
			{loadError}
		</span>
	{/if}
	{#each agents as agent (agent.id)}
		{@const card = deriveSignInCard({
			requirement: {
				agent: agent.name,
				instructions: `Complete the ${agent.id} sign-in, then retry.`,
			},
			signInMethod: agent.sign_in,
		})}
		{#if card}
			<div
				class="border border-border/40 p-2"
				data-testid="live-sign-in-card"
				data-agent-id={agent.id}
				data-sign-in-kind={agent.sign_in.kind}
				data-can-sign-in={String(card.canSignIn)}
			>
				<AgentPanelSignInCard
					title="Sign in to continue"
					message={card.message}
					onSignIn={card.canSignIn ? () => {} : undefined}
					onDismiss={() => {}}
				/>
			</div>
		{/if}
	{/each}
</div>
