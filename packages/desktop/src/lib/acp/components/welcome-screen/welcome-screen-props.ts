/**
 * Props for the WelcomeScreen component.
 * Shown once on first launch as a full-screen onboarding overlay:
 * splash → agent selection → project import → done.
 */
export interface WelcomeScreenProps {
	/** Callback when a project is imported (added to database). */
	onProjectImported: (path: string, name: string, options?: { scan?: boolean }) => void;
	/** Called when onboarding completes — parent should dismiss the overlay. */
	onDismiss: () => void;
}
