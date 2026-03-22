/**
 * Props for the CloneRepositoryDialog component.
 */
export interface CloneRepositoryDialogProps {
	/** Whether the dialog is open */
	open: boolean;
	/** Callback when dialog open state changes */
	onOpenChange: (open: boolean) => void;
	/** Callback when clone completes successfully, receives the cloned project path and name */
	onCloneComplete: (path: string, name: string) => void;
}
