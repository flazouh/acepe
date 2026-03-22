import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { okAsync, errAsync, ok, err } from 'neverthrow';
import { WaitlistApplicationService } from '../WaitlistApplicationService';
import type {
	WaitlistRepository,
	WaitlistEntry
} from '../../infrastructure/repositories/WaitlistRepository';
import type { EmailVerificationService } from '../../domain/services/EmailVerificationService';
import {
	EmailAlreadyExistsError,
	InvalidConfirmationTokenError,
	InvalidEmailError
} from '../../domain/errors/WaitlistErrors';

describe('WaitlistApplicationService', () => {
	let mockRepository: WaitlistRepository;
	let mockEmailService: EmailVerificationService;
	let service: WaitlistApplicationService;

	beforeEach(() => {
		mockRepository = {
			add: vi.fn(),
			findByEmail: vi.fn(),
			findByToken: vi.fn(),
			confirmEmail: vi.fn(),
			getAll: vi.fn(),
			getTotalCount: vi.fn(),
			exportToCSV: vi.fn()
		};

		mockEmailService = {
			generateToken: vi.fn(() => 'test-token-12345678901234567890'),
			sendConfirmationEmail: vi.fn(),
			sendFollowUpEmail: vi.fn()
		};

		service = new WaitlistApplicationService(mockRepository, mockEmailService);
	});

	describe('joinWaitlist', () => {
		it('should successfully add a new user to waitlist and send confirmation email', async () => {
			const mockEntry: WaitlistEntry = {
				id: 'test-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'test-token-12345678901234567890',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			(mockRepository.findByEmail as Mock).mockReturnValue(okAsync(null));
			(mockRepository.add as Mock).mockReturnValue(okAsync(mockEntry));
			(mockEmailService.sendConfirmationEmail as Mock).mockReturnValue(okAsync(undefined));

			const result = await service.joinWaitlist({
				email: 'user@example.com',
				locale: 'en'
			});

			expect(result.isOk()).toBe(true);
			expect(mockRepository.findByEmail).toHaveBeenCalled();
			expect(mockRepository.add).toHaveBeenCalled();
			expect(mockEmailService.sendConfirmationEmail).toHaveBeenCalled();
		});

		it('should reject invalid email format', async () => {
			const result = await service.joinWaitlist({
				email: 'invalid-email',
				locale: 'en'
			});

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error).toBeInstanceOf(InvalidEmailError);
			}
			expect(mockRepository.findByEmail).not.toHaveBeenCalled();
		});

		it('should reject email that already exists on waitlist', async () => {
			const existingEntry: WaitlistEntry = {
				id: 'existing-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'token',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			(mockRepository.findByEmail as Mock).mockReturnValue(okAsync(existingEntry));

			const result = await service.joinWaitlist({
				email: 'user@example.com',
				locale: 'en'
			});

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error).toBeInstanceOf(EmailAlreadyExistsError);
			}
			expect(mockRepository.add).not.toHaveBeenCalled();
		});

		it('should handle email sending failure gracefully', async () => {
			const mockEntry: WaitlistEntry = {
				id: 'test-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'test-token-12345678901234567890',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			(mockRepository.findByEmail as Mock).mockReturnValue(okAsync(null));
			(mockRepository.add as Mock).mockReturnValue(okAsync(mockEntry));
			(mockEmailService.sendConfirmationEmail as Mock).mockReturnValue(
				errAsync(new Error('Email service failed') as any)
			);

			const result = await service.joinWaitlist({
				email: 'user@example.com',
				locale: 'en'
			});

			expect(result.isErr()).toBe(true);
		});
	});

	describe('confirmEmail', () => {
		it('should successfully confirm email and send follow-up email', async () => {
			const mockEntry: WaitlistEntry = {
				id: 'test-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'test-token',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			const confirmedEntry: WaitlistEntry = {
				...mockEntry,
				emailConfirmed: true,
				confirmedAt: new Date()
			};

			(mockRepository.findByToken as Mock).mockReturnValue(okAsync(mockEntry));
			(mockRepository.confirmEmail as Mock).mockReturnValue(okAsync(confirmedEntry));
			(mockEmailService.sendFollowUpEmail as Mock).mockReturnValue(okAsync(undefined));

			const result = await service.confirmEmail('test-token');

			expect(result.isOk()).toBe(true);
			expect(mockRepository.findByToken).toHaveBeenCalledWith('test-token');
			expect(mockRepository.confirmEmail).toHaveBeenCalled();
			expect(mockEmailService.sendFollowUpEmail).toHaveBeenCalledWith('user@example.com', 'en');
		});

		it('should reject invalid confirmation token', async () => {
			(mockRepository.findByToken as Mock).mockReturnValue(okAsync(null));

			const result = await service.confirmEmail('invalid-token');

			expect(result.isErr()).toBe(true);
			if (result.isErr()) {
				expect(result.error).toBeInstanceOf(InvalidConfirmationTokenError);
			}
			expect(mockRepository.confirmEmail).not.toHaveBeenCalled();
		});

		it('should handle database errors during confirmation', async () => {
			const mockEntry: WaitlistEntry = {
				id: 'test-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'test-token',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			(mockRepository.findByToken as Mock).mockReturnValue(okAsync(mockEntry));
			(mockRepository.confirmEmail as Mock).mockReturnValue(
				errAsync(new Error('Database error') as any)
			);

			const result = await service.confirmEmail('test-token');

			expect(result.isErr()).toBe(true);
			expect(mockEmailService.sendFollowUpEmail).not.toHaveBeenCalled();
		});

		it('should succeed confirmation even if follow-up email fails', async () => {
			const mockEntry: WaitlistEntry = {
				id: 'test-id',
				email: 'user@example.com',
				locale: 'en',
				confirmationToken: 'test-token',
				emailConfirmed: false,
				createdAt: new Date(),
				confirmedAt: null
			};

			const confirmedEntry: WaitlistEntry = {
				...mockEntry,
				emailConfirmed: true,
				confirmedAt: new Date()
			};

			(mockRepository.findByToken as Mock).mockReturnValue(okAsync(mockEntry));
			(mockRepository.confirmEmail as Mock).mockReturnValue(okAsync(confirmedEntry));
			(mockEmailService.sendFollowUpEmail as Mock).mockReturnValue(
				errAsync(new Error('Email service failed') as any)
			);

			const result = await service.confirmEmail('test-token');

			expect(result.isOk()).toBe(true);
			expect(mockRepository.confirmEmail).toHaveBeenCalled();
			expect(mockEmailService.sendFollowUpEmail).toHaveBeenCalledWith('user@example.com', 'en');
		});
	});
});
