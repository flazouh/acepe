import * as SqliteMigrator from "@effect/sql-sqlite-bun/SqliteMigrator"
import init from "./Migrations/0001_init.ts"
import eventStore from "./Migrations/0002_event_store.ts"
import projectionState from "./Migrations/0003_projection_state.ts"
import commandReceipts from "./Migrations/0004_command_receipts.ts"
import projectionMessages from "./Migrations/0005_projection_messages.ts"
import projectionSessions from "./Migrations/0006_projection_sessions.ts"
import projectionTurns from "./Migrations/0007_projection_turns.ts"
import projectionSessionActivities from "./Migrations/0008_projection_session_activities.ts"
import projectionCheckpoints from "./Migrations/0009_projection_checkpoints.ts"
import projectionPendingApprovals from "./Migrations/0010_projection_pending_approvals.ts"
import projectionProjects from "./Migrations/0011_projection_projects.ts"
import checkpointSnapshots from "./Migrations/0012_checkpoint_snapshots.ts"
import projectionSessionsPrLink from "./Migrations/0013_projection_sessions_pr_link.ts"
import projectionSettings from "./Migrations/0014_projection_settings.ts"
import projectionSkills from "./Migrations/0015_projection_skills.ts"
import projectionVoice from "./Migrations/0016_projection_voice.ts"
import projectionGitReview from "./Migrations/0017_projection_git_review.ts"
import projectionMcp from "./Migrations/0018_projection_mcp.ts"
import projectionTerminal from "./Migrations/0019_projection_terminal.ts"
import projectionSessionReviewState from "./Migrations/0020_projection_session_review_state.ts"
import projectionProjectsColor from "./Migrations/0021_projection_projects_color.ts"
import projectionSessionsProviderIdentity from "./Migrations/0022_projection_sessions_provider_identity.ts"
import projectionTurnsContextWindow from "./Migrations/0023_projection_turns_context_window.ts"
import projectionSessionActivitiesOutput from "./Migrations/0024_projection_session_activities_output.ts"
import projectionSessionActivitiesToolKind from "./Migrations/0025_projection_session_activities_tool_kind.ts"
import projectionSessionsCurrentMode from "./Migrations/0026_projection_sessions_current_mode.ts"
import projectionSessionActivitiesInput from "./Migrations/0027_projection_session_activities_input.ts"
import projectionSessionMessagesLastSequence from "./Migrations/0029_projection_session_messages_last_sequence.ts"
import projectionSessionsModels from "./Migrations/0028_projection_sessions_models.ts"
import projectionProjectsShowExternalCliSessions from "./Migrations/0030_projection_projects_show_external_cli_sessions.ts"
import repairTranscriptWhitespace from "./Migrations/0031_repair_transcript_whitespace.ts"

const MIGRATIONS_TABLE = "_migrations"

const loader = SqliteMigrator.fromRecord({
	"0001_init": init,
	"0002_event_store": eventStore,
	"0003_projection_state": projectionState,
	"0004_command_receipts": commandReceipts,
	"0005_projection_messages": projectionMessages,
	"0006_projection_sessions": projectionSessions,
	"0007_projection_turns": projectionTurns,
	"0008_projection_session_activities": projectionSessionActivities,
	"0009_projection_checkpoints": projectionCheckpoints,
	"0010_projection_pending_approvals": projectionPendingApprovals,
	"0011_projection_projects": projectionProjects,
	"0012_checkpoint_snapshots": checkpointSnapshots,
	"0013_projection_sessions_pr_link": projectionSessionsPrLink,
	"0014_projection_settings": projectionSettings,
	"0015_projection_skills": projectionSkills,
	"0016_projection_voice": projectionVoice,
	"0017_projection_git_review": projectionGitReview,
	"0018_projection_mcp": projectionMcp,
	"0019_projection_terminal": projectionTerminal,
	"0020_projection_session_review_state": projectionSessionReviewState,
	"0021_projection_projects_color": projectionProjectsColor,
	"0022_projection_sessions_provider_identity": projectionSessionsProviderIdentity,
	"0023_projection_turns_context_window": projectionTurnsContextWindow,
	"0024_projection_session_activities_output": projectionSessionActivitiesOutput,
	"0025_projection_session_activities_tool_kind": projectionSessionActivitiesToolKind,
	"0026_projection_sessions_current_mode": projectionSessionsCurrentMode,
	"0027_projection_session_activities_input": projectionSessionActivitiesInput,
	"0028_projection_sessions_models": projectionSessionsModels,
	"0029_projection_session_messages_last_sequence": projectionSessionMessagesLastSequence,
	"0030_projection_projects_show_external_cli_sessions": projectionProjectsShowExternalCliSessions,
	"0031_repair_transcript_whitespace": repairTranscriptWhitespace
})

export const runMigrations = SqliteMigrator.run({
	loader,
	table: MIGRATIONS_TABLE
})
