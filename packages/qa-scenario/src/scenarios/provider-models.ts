/**
 * A session whose provider reported its own model catalog, and a model chosen
 * from it.
 *
 * The composer's model picker has no list of its own any more: it renders what
 * a provider published as a `session_models` fact and which of those the
 * canonical `SessionModelSet` selected. This scenario is how that path gets
 * exercised in the app without an agent, an account or a token -- the ids
 * below are deliberately ones no constant in this repo ever held.
 */

import { SessionId, type SessionModelCatalog } from "@acepe/contracts"
import { scenarioBuilder } from "../builder.ts"
import type { QaScenario } from "../scenario.ts"
import {
	QA_PROJECT_ID,
	QA_STARTED_AT,
	QA_WORKSPACE_ROOT,
	qaProject,
	qaSessionRow,
} from "./fixtures.ts"

const sessionId = SessionId.make("qa-provider-models")

const PUBLISHED_MODELS: SessionModelCatalog = [
	{ modelId: "qa-opus-9", name: "QA Opus 9", description: "The one the provider recommends" },
	{ modelId: "qa-sonnet-9", name: "QA Sonnet 9", description: "Faster, still capable" },
	{ modelId: "qa-haiku-9", name: "QA Haiku 9", description: null },
]

export const providerModels: QaScenario = scenarioBuilder({
	sessionId,
	projectId: QA_PROJECT_ID,
	startedAt: QA_STARTED_AT,
})
	.shellBoot({ workspaceRoot: QA_WORKSPACE_ROOT, branch: "main" })
	.library([qaProject], [qaSessionRow(sessionId, "Provider models")])
	.sessionCreated("Provider models", "claude")
	.advance(80)
	.sessionModels(PUBLISHED_MODELS)
	.advance(40)
	.sessionModelSet("qa-sonnet-9")
	.build("provider-models", "a provider's published model catalog and the model chosen from it")
