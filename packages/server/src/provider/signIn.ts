import type { AgentCallSignInMethod } from "@acepe/contracts"
import { COPILOT_BINARY_ENV_KEY, COPILOT_BINARY_NAME } from "./Layers/Copilot/Provider.ts"
import { CURSOR_BINARY_ENV_KEY, CURSOR_BINARY_NAME } from "./Layers/Cursor/Provider.ts"

// What actually signs each agent in, and which of those Acepe can run.
//
// Every agent here authenticates through its own CLI, and the CLI writes the
// token into its own credential store -- ~/.claude, ~/.codex/auth.json, the
// system credential store for Copilot, Cursor's own store. That is the right
// place for it and the only place it goes: the same store the adapter's
// child process reads when it starts a session, so the presence probe that
// answers "is this agent authenticated" keeps reading the one fact the login
// wrote. Acepe never sees the token, never copies it and has no store of its
// own to put it in.
//
// A `browser` plan is a login command that completes without a terminal: it
// opens the operator's browser, takes the OAuth round trip there and exits
// when the browser step is done. Acepe spawns it and waits for the exit code.
//
// A `manual` plan is an agent whose login is an interactive terminal program.
// OpenCode's asks for a provider and then an API key on stdin, so driving it
// would mean Acepe collecting the operator's secret. It does not, and says so
// with the command to run instead.
export type AgentSignInPlan =
	| {
		readonly kind: "browser"
		// The executable name to find on PATH. Deliberately the CLI's own
		// name rather than a managed-cache binary: the login writes into the
		// user-level credential store that both copies read, and only the
		// operator-installed CLI is guaranteed to be a full CLI rather than
		// the ACP-server-only entry point Acepe launches sessions with.
		readonly binaryName: string
		readonly args: ReadonlyArray<string>
		// Environment variable that overrides the binary's location, taken
		// from the provider module that owns it rather than repeated here.
		// Read before PATH, the same order the adapter's own probe uses, so
		// an operator who points Acepe at a CLI through that variable can
		// sign in with the same CLI they start sessions with. Claude and
		// Codex define no such variable.
		readonly binaryEnvKey: string | null
	}
	| {
		readonly kind: "manual"
		readonly instructions: string
	}

const CLAUDE_PLAN: AgentSignInPlan = {
	kind: "browser",
	binaryName: "claude",
	// `claude auth login` (not the `/login` inside the interactive session):
	// it opens the Anthropic sign-in page and captures the result itself.
	args: ["auth", "login"],
	binaryEnvKey: null
}

const CODEX_PLAN: AgentSignInPlan = {
	kind: "browser",
	binaryName: "codex",
	// Plain `codex login`, never `--device-auth`: the device flow prints a
	// one-time code to stdout that Acepe would then have to relay, and
	// relaying a credential is exactly what this lane refuses to do. The
	// default flow keeps the whole exchange between the CLI and the browser.
	args: ["login"],
	binaryEnvKey: null
}

const COPILOT_PLAN: AgentSignInPlan = {
	kind: "browser",
	binaryName: COPILOT_BINARY_NAME,
	// --web-flow is forced rather than left to the CLI's own detection: it
	// falls back to the device-code flow when it thinks it is headless, and
	// spawned from a server process without a terminal it thinks exactly
	// that. The device code would then be printed where nobody reads it.
	args: ["login", "--web-flow"],
	binaryEnvKey: COPILOT_BINARY_ENV_KEY
}

const CURSOR_PLAN: AgentSignInPlan = {
	kind: "browser",
	binaryName: CURSOR_BINARY_NAME,
	args: ["login"],
	binaryEnvKey: CURSOR_BINARY_ENV_KEY
}

const OPENCODE_PLAN: AgentSignInPlan = {
	kind: "manual",
	instructions:
		"OpenCode signs in from its own terminal prompt: run `opencode auth login`, pick your provider and paste its API key there. Acepe does not run it for you because that would mean handling your key."
}

const PLANS: Record<string, AgentSignInPlan> = {
	"claude-code": CLAUDE_PLAN,
	"codex": CODEX_PLAN,
	"copilot": COPILOT_PLAN,
	"cursor": CURSOR_PLAN,
	"opencode": OPENCODE_PLAN
}

const unknownAgentPlan = (providerId: string): AgentSignInPlan => ({
	kind: "manual",
	instructions:
		`Acepe does not know how to sign '${providerId}' in. Run that agent's own login command in a terminal, then reconnect.`
})

export const signInPlanForAgent = (providerId: string): AgentSignInPlan =>
	PLANS[providerId] ?? unknownAgentPlan(providerId)

// The wire projection of a plan. The binary name and args stay server-side:
// they are how the server does the work, not something a caller decides.
export const signInMethodForAgent = (providerId: string): AgentCallSignInMethod => {
	const plan = signInPlanForAgent(providerId)
	return plan.kind === "browser" ? { kind: "browser" } : {
		kind: "manual",
		instructions: plan.instructions
	}
}
