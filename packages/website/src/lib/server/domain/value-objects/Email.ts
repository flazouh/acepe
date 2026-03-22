import { Result, ok, err } from 'neverthrow';
import { InvalidEmailError } from '../errors/WaitlistErrors';

export class Email {
	private constructor(private readonly value: string) {}

	static create(email: string): Result<Email, InvalidEmailError> {
		const normalized = email.trim().toLowerCase();

		// Basic email validation regex
		const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

		if (!emailRegex.test(normalized)) {
			return err(new InvalidEmailError('Invalid email format'));
		}

		if (normalized.length > 254) {
			return err(new InvalidEmailError('Email address is too long'));
		}

		return ok(new Email(normalized));
	}

	getValue(): string {
		return this.value;
	}

	equals(other: Email): boolean {
		return this.value === other.value;
	}
}
