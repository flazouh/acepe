import { getContext, setContext } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { PlanApprovalInteraction } from "../types/interaction.js";
import type { PermissionRequest } from "../types/permission.js";
import type { AnsweredQuestion, QuestionRequest } from "../types/question.js";

const INTERACTION_STORE_KEY = Symbol("interaction-store");

export class InteractionStore {
	readonly permissionsPending = new SvelteMap<string, PermissionRequest>();
	readonly questionsPending = new SvelteMap<string, QuestionRequest>();
	readonly answeredQuestions = new SvelteMap<string, AnsweredQuestion>();
	readonly planApprovalsPending = new SvelteMap<string, PlanApprovalInteraction>();
}

export function createInteractionStore(): InteractionStore {
	const store = new InteractionStore();
	setContext(INTERACTION_STORE_KEY, store);
	return store;
}

export function getInteractionStore(): InteractionStore {
	return getContext<InteractionStore>(INTERACTION_STORE_KEY);
}
