export interface CommandChipModel {
	command: string;
	message: string;
	stdout: string;
	modelDisplayName?: string | null;
	modelDescription?: string | null;
	cleanStdout?: string;
	displayModelName?: string;
	displayModelDescription?: string | null;
	isModelCommand?: boolean;
}
