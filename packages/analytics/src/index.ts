/**
 * Shared analytics event names across desktop, website, and backend.
 * Use these instead of string literals to avoid drift.
 */

export enum AnalyticsEvent {
	// Desktop + Website
	AgentChanged = "agent_changed",
	AppError = "app_error",
	ChangelogViewed = "changelog_viewed",
	Downloaded = "downloaded",
	PlanViewed = "plan_viewed",
	UpdateAvailable = "update_available",
	AcpError = "acp_error",
}
