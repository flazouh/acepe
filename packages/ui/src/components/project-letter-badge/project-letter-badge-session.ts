export const SESSION_PROJECT_BADGE_SIZE = 12;
export const SESSION_PROJECT_BADGE_CLASS = "font-mono";

export type SessionProjectBadgeIdentity = {
	sequenceId?: number | null;
	projectName?: string | null;
	projectColor?: string | null;
};

export function shouldShowSessionProjectBadge(identity: SessionProjectBadgeIdentity): boolean {
	return (
		identity.sequenceId != null &&
		identity.projectName != null &&
		identity.projectColor != null
	);
}
