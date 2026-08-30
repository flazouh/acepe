import type { AgentSignInMethod } from "../../../store/types.js";

/**
 * What the pre-composer sign-in card should say, and whether it should offer
 * a control at all.
 *
 * `canSignIn` is not a guess. It follows the backend's sign-in method for
 * that agent (`sign_in` on the agent list, decided in
 * packages/server/src/provider/signIn.ts), because only the backend knows
 * which agents have a login command it can run. A card that offers a button
 * for an agent the backend cannot sign in is the bug this replaces: pressing
 * it could only ever fail.
 */
export interface SignInCardInfo {
	readonly message: string;
	readonly canSignIn: boolean;
}

export interface SignInCardInputs {
	/** The panel's sign-in requirement, or `null` when none is showing. */
	readonly requirement: { readonly agent: string; readonly instructions: string } | null;
	/**
	 * The backend's sign-in method for the panel's agent. `null` while the
	 * agent list has not answered yet, or for an agent that is not in it.
	 */
	readonly signInMethod: AgentSignInMethod | null;
}

export function deriveSignInCard(inputs: SignInCardInputs): SignInCardInfo | null {
	if (inputs.requirement === null) {
		return null;
	}
	if (inputs.signInMethod?.kind === "browser") {
		return { message: inputs.requirement.instructions, canSignIn: true };
	}
	if (inputs.signInMethod?.kind === "manual") {
		// The backend's own copy, which names the command to run. It replaces
		// the generic requirement text because it is the more specific and
		// more actionable of the two.
		return { message: inputs.signInMethod.instructions, canSignIn: false };
	}
	// No method known yet. Show the requirement and no control: an unusable
	// button is worse than a missing one, and the requirement copy already
	// tells the person to sign in outside the app and retry.
	return { message: inputs.requirement.instructions, canSignIn: false };
}
