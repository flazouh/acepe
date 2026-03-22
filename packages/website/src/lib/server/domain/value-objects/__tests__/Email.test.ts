import { describe, it, expect } from 'vitest';
import { Email } from '../Email';
import { InvalidEmailError } from '../../errors/WaitlistErrors';

describe('Email Value Object', () => {
	it('should create a valid email', () => {
		const result = Email.create('user@example.com');

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.getValue()).toBe('user@example.com');
		}
	});

	it('should normalize email to lowercase', () => {
		const result = Email.create('USER@EXAMPLE.COM');

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.getValue()).toBe('user@example.com');
		}
	});

	it('should trim whitespace', () => {
		const result = Email.create('  user@example.com  ');

		expect(result.isOk()).toBe(true);
		if (result.isOk()) {
			expect(result.value.getValue()).toBe('user@example.com');
		}
	});

	it('should reject invalid email format', () => {
		const result = Email.create('invalid-email');

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(InvalidEmailError);
		}
	});

	it('should reject email without domain', () => {
		const result = Email.create('user@');

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(InvalidEmailError);
		}
	});

	it('should reject email without local part', () => {
		const result = Email.create('@example.com');

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(InvalidEmailError);
		}
	});

	it('should reject email that is too long', () => {
		const longEmail = 'a'.repeat(255) + '@example.com';
		const result = Email.create(longEmail);

		expect(result.isErr()).toBe(true);
		if (result.isErr()) {
			expect(result.error).toBeInstanceOf(InvalidEmailError);
		}
	});

	it('should consider two emails equal if they have the same value', () => {
		const email1 = Email.create('user@example.com');
		const email2 = Email.create('USER@EXAMPLE.COM');

		expect(email1.isOk()).toBe(true);
		expect(email2.isOk()).toBe(true);

		if (email1.isOk() && email2.isOk()) {
			expect(email1.value.equals(email2.value)).toBe(true);
		}
	});

	it('should accept emails with common domains', () => {
		const validEmails = [
			'user@gmail.com',
			'test@company.co.uk',
			'admin@localhost.example',
			'name+tag@domain.org'
		];

		validEmails.forEach((email) => {
			const result = Email.create(email);
			expect(result.isOk()).toBe(true);
		});
	});
});
