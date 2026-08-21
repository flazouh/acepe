import * as Context from "effect/Context"
import type { HistoryImporterShape } from "../importer.ts"

export class ClaudeHistory extends Context.Service<ClaudeHistory, HistoryImporterShape>()(
	"@acepe/server/history/Services/ClaudeHistory"
) {}
