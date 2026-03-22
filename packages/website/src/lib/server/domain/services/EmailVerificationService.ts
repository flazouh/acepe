import type { ResultAsync } from 'neverthrow';
import type { EmailSendingFailedError } from '../errors/WaitlistErrors';

export interface EmailVerificationService {
	/**
	 * Generate a secure confirmation token
	 */
	generateToken(): string;

	/**
	 * Send confirmation email with verification link
	 */
	sendConfirmationEmail(
		to: string,
		token: string,
		locale: string
	): ResultAsync<void, EmailSendingFailedError>;

	/**
	 * Send follow-up email after email confirmation
	 */
	sendFollowUpEmail(to: string, locale: string): ResultAsync<void, EmailSendingFailedError>;
}
