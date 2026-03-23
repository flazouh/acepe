import { ResultAsync, errAsync, okAsync } from 'neverthrow';
import type { WaitlistRepository } from '../infrastructure/repositories/WaitlistRepository';
import type { EmailVerificationService } from '../domain/services/EmailVerificationService';
import { Email } from '../domain/value-objects/Email';
import {
	EmailAlreadyExistsError,
	InvalidConfirmationTokenError,
	EmailSendingFailedError,
	type WaitlistError
} from '../domain/errors/WaitlistErrors';

export class WaitlistApplicationService {
	constructor(
		private readonly repository: WaitlistRepository,
		private readonly emailService: EmailVerificationService
	) {}

	/**
	 * Join waitlist - the main user-facing operation
	 */
	joinWaitlist(params: { email: string; locale: string }): ResultAsync<void, WaitlistError> {
		const emailResult = Email.create(params.email);

		if (emailResult.isErr()) {
			return errAsync(emailResult.error);
		}

		const email = emailResult.value;

		// Check if already exists
		return this.repository.findByEmail(email).andThen((existing) => {
			if (existing) {
				return errAsync(new EmailAlreadyExistsError(email.getValue()));
			}

			const confirmationToken = this.emailService.generateToken();

			return this.repository
				.add({
					email: email.getValue(),
					locale: params.locale,
					confirmationToken,
					emailConfirmed: false,
					confirmedAt: null
				})
				.andThen(() =>
					// Send confirmation email
					this.emailService.sendConfirmationEmail(
						email.getValue(),
						confirmationToken,
						params.locale
					)
				)
				.mapErr(() => new EmailSendingFailedError());
		});
	}

	/**
	 * Confirm email address
	 */
	confirmEmail(token: string): ResultAsync<void, WaitlistError> {
		return this.repository.findByToken(token).andThen((entry) => {
			if (!entry) {
				return errAsync(new InvalidConfirmationTokenError());
			}

			const emailResult = Email.create(entry.email);
			if (emailResult.isErr()) {
				return errAsync(emailResult.error);
			}

			return this.repository.confirmEmail(emailResult.value).andThen(() => {
				// Send follow-up email after successful confirmation
				// If follow-up email fails, log it but don't fail the confirmation
				return this.emailService
					.sendFollowUpEmail(entry.email, entry.locale)
					.map(() => undefined)
					.orElse(() => okAsync(undefined));
			});
		});
	}
}
