import * as Context from "effect/Context"
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { ProviderId } from "./ProviderAdapter.ts"

// Runs the sign-in an agent's own CLI performs. See provider/signIn.ts for
// which agents have one and where the token each writes actually lands.
//
// SECRETS. Nothing below carries a token, a code or a URL. The login child's
// stdout and stderr are never read, never logged and never put in an error:
// a login CLI's output is the one place a device code or a one-time
// authorization URL appears, and an error message is the one place that would
// then get copied, pasted and mailed around. What the errors carry instead is
// the cause -- which agent, which binary was missing, which exit code -- which
// is what a person needs to fix it.

export class AgentSignInUnavailableError
	extends Schema.TaggedError<AgentSignInUnavailableError>()("AgentSignInUnavailableError", {
		agentId: ProviderId,
		instructions: Schema.String
	})
{
	override get message(): string {
		return this.instructions
	}
}

export class AgentSignInBinaryMissingError
	extends Schema.TaggedError<AgentSignInBinaryMissingError>()("AgentSignInBinaryMissingError", {
		agentId: ProviderId,
		binaryName: Schema.String
	})
{
	override get message(): string {
		return `Cannot sign '${this.agentId}' in: its '${this.binaryName}' command is not on PATH. Install the CLI, then try again.`
	}
}

export class AgentSignInSpawnFailedError
	extends Schema.TaggedError<AgentSignInSpawnFailedError>()("AgentSignInSpawnFailedError", {
		agentId: ProviderId,
		binaryPath: Schema.String
	})
{
	override get message(): string {
		return `Could not start the sign-in for '${this.agentId}': '${this.binaryPath}' would not run.`
	}
}

export class AgentSignInRejectedError
	extends Schema.TaggedError<AgentSignInRejectedError>()("AgentSignInRejectedError", {
		agentId: ProviderId,
		exitCode: Schema.Number
	})
{
	override get message(): string {
		return `The ${this.agentId} sign-in ended without signing you in (its login command exited with code ${this.exitCode}). Its browser step was most likely closed or refused.`
	}
}

export class AgentSignInCancelledError
	extends Schema.TaggedError<AgentSignInCancelledError>()("AgentSignInCancelledError", {
		agentId: ProviderId
	})
{
	override get message(): string {
		return `The ${this.agentId} sign-in was cancelled.`
	}
}

export type AgentSignInError =
	| AgentSignInUnavailableError
	| AgentSignInBinaryMissingError
	| AgentSignInSpawnFailedError
	| AgentSignInRejectedError
	| AgentSignInCancelledError

export interface AgentAuthenticatorShape {
	// Runs the agent's login command and returns when it has exited cleanly.
	// Long-running on purpose: it is waiting on a person finishing a browser
	// step, and the caller's transport is built to wait on a request that is
	// still working.
	readonly signIn: (agentId: ProviderId) => Effect.Effect<void, AgentSignInError>
	// Stops a sign-in that is in flight for this agent. `false` means there
	// was none, which is a real answer and not a failure.
	readonly cancel: (agentId: ProviderId) => Effect.Effect<boolean>
}

export class AgentAuthenticator extends Context.Service<
	AgentAuthenticator,
	AgentAuthenticatorShape
>()("@acepe/server/provider/Services/AgentAuthenticator") {}
