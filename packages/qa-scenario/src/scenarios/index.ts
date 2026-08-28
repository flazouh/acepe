/**
 * Scenarios authored in code, as opposed to captured from a live session.
 *
 * Authoring in TypeScript means the compiler and the canonical event decode
 * both check them, so a contract change breaks the scenario at build time
 * instead of leaving a stale recording that quietly no longer reproduces.
 */

import type { QaScenario } from "../scenario.ts"
import { providerModels } from "./provider-models.ts"
import { streamingReply } from "./streaming-reply.ts"
import { toolAndApproval } from "./tool-and-approval.ts"

export const authoredScenarios: ReadonlyArray<QaScenario> = [
	streamingReply,
	toolAndApproval,
	providerModels,
]

export const authoredScenarioByName = (name: string): QaScenario | null =>
	authoredScenarios.find((scenario) => scenario.meta.name === name) ?? null

export { providerModels, streamingReply, toolAndApproval }
export { QA_PROJECT_ID, QA_STARTED_AT, QA_WORKSPACE_ROOT, qaProject, qaSessionRow } from "./fixtures.ts"
