import { ResultAsync } from 'neverthrow';
import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import { PUBLIC_BASE_URL } from '$env/static/public';
import { nanoid } from 'nanoid';
import type { EmailVerificationService } from '../../domain/services/EmailVerificationService';
import { EmailSendingFailedError } from '../../domain/errors/WaitlistErrors';
import { logger } from '../../logger';

export class ResendEmailService implements EmailVerificationService {
	private resend: Resend;

	constructor() {
		this.resend = new Resend(env.RESEND_API_KEY);
	}

	generateToken(): string {
		return nanoid(32);
	}

	private extractNameFromEmail(email: string): string {
		const localPart = email.split('@')[0];
		if (!localPart) {
			return '';
		}
		// Capitalize first letter
		return localPart.charAt(0).toUpperCase() + localPart.slice(1).toLowerCase();
	}

	sendConfirmationEmail(
		to: string,
		token: string,
		locale: string
	): ResultAsync<void, EmailSendingFailedError> {
		const confirmUrl = `${PUBLIC_BASE_URL}/confirm?token=${token}`;

		logger.info({ to, locale }, 'Sending confirmation email');

		return ResultAsync.fromPromise(
			this.resend.emails.send({
				from: 'Acepe <hello@acepe.dev>',
				to,
				subject: locale === 'es' ? 'Confirma tu email - Acepe' : 'Confirm your email - Acepe',
				html: this.buildEmailTemplate(confirmUrl, locale),
				text: this.buildPlainTextTemplate(confirmUrl, locale),
				headers: {
					'List-Unsubscribe': '<mailto:hello@acepe.dev?subject=unsubscribe>'
				},
				tags: [
					{
						name: 'category',
						value: 'email-verification'
					}
				]
			}),
			(error) => {
				logger.error({ error, to }, 'Failed to send email');
				return new EmailSendingFailedError(`Failed to send email: ${error}`);
			}
		).map(() => {
			logger.info({ to }, 'Successfully sent confirmation email');
			return undefined;
		});
	}

	private buildEmailTemplate(confirmUrl: string, locale: string): string {
		const isSpanish = locale === 'es';

		const content = {
			title: isSpanish ? 'Confirma tu email' : 'Confirm your email',
			greeting: isSpanish ? 'Gracias por unirte a Acepe' : 'Thanks for joining Acepe',
			description: isSpanish
				? 'Estamos construyendo una nueva forma de trabajar con agentes de IA. Confirma tu email para asegurar tu lugar en la lista de espera.'
				: "We're building a new way to work with AI agents. Confirm your email to secure your spot on the waitlist.",
			button: isSpanish ? 'Confirmar Email' : 'Confirm Email',
			ignoreText: isSpanish
				? 'Si no te registraste en Acepe, puedes ignorar este email.'
				: "If you didn't sign up for Acepe, you can safely ignore this email.",
			linkText: isSpanish
				? 'O copia y pega este enlace en tu navegador:'
				: 'Or copy and paste this link into your browser:'
		};

		return `
<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${content.title}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px;">
          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <img src="${PUBLIC_BASE_URL}/favicon-32x32.png" width="32" height="32" alt="Acepe" style="display: block;" />
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Acepe</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #141414; border-radius: 16px; border: 1px solid #2a2a2a;">
                <tr>
                  <td style="padding: 48px 40px;">
                    <!-- Title -->
                    <h1 style="margin: 0 0 8px 0; font-size: 28px; font-weight: 600; color: #ffffff; line-height: 1.3;">
                      ${content.greeting}
                    </h1>

                    <!-- Description -->
                    <p style="margin: 0 0 32px 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      ${content.description}
                    </p>

                    <!-- CTA Button -->
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td style="border-radius: 10px; background: linear-gradient(135deg, #C1823C 0%, #F77E2C 100%);">
                          <a href="${confirmUrl}" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 10px;">
                            ${content.button}
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback Link -->
                    <p style="margin: 24px 0 0 0; font-size: 13px; color: #666666;">
                      ${content.linkText}
                    </p>
                    <p style="margin: 8px 0 0 0; word-break: break-all;">
                      <a href="${confirmUrl}" style="font-size: 13px; color: #C1823C; text-decoration: none;">${confirmUrl}</a>
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <!-- Social Links -->
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <span style="font-size: 13px; color: #555555;">
                      <a href="https://x.com/acepe_dev" target="_blank" style="color: #888888; text-decoration: none;">X</a>
                      <span style="color: #333333; padding: 0 8px;">&middot;</span>
                      <a href="https://github.com/acepe-ai/acepe" target="_blank" style="color: #888888; text-decoration: none;">GitHub</a>
                      <span style="color: #333333; padding: 0 8px;">&middot;</span>
                      <a href="https://discord.gg/acepe" target="_blank" style="color: #888888; text-decoration: none;">Discord</a>
                    </span>
                  </td>
                </tr>

                <!-- Disclaimer -->
                <tr>
                  <td align="center">
                    <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #555555;">
                      ${content.ignoreText}
                    </p>
                  </td>
                </tr>

                <!-- Copyright -->
                <tr>
                  <td align="center" style="padding-top: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #444444;">
                      &copy; ${new Date().getFullYear()} Acepe. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
		`;
	}

	private buildPlainTextTemplate(confirmUrl: string, locale: string): string {
		const isSpanish = locale === 'es';

		const content = {
			greeting: isSpanish ? 'Gracias por unirte a Acepe' : 'Thanks for joining Acepe',
			description: isSpanish
				? 'Estamos construyendo una nueva forma de trabajar con agentes de IA. Confirma tu email para asegurar tu lugar en la lista de espera.'
				: "We're building a new way to work with AI agents. Confirm your email to secure your spot on the waitlist.",
			button: isSpanish ? 'Confirmar Email' : 'Confirm Email',
			ignoreText: isSpanish
				? 'Si no te registraste en Acepe, puedes ignorar este email.'
				: "If you didn't sign up for Acepe, you can safely ignore this email."
		};

		return `
${content.greeting}

${content.description}

${content.button}: ${confirmUrl}

---

${content.ignoreText}

© ${new Date().getFullYear()} Acepe. All rights reserved.

X: https://x.com/acepe_dev
GitHub: https://github.com/acepe-ai/acepe
Discord: https://discord.gg/acepe
		`.trim();
	}

	sendFollowUpEmail(to: string, locale: string): ResultAsync<void, EmailSendingFailedError> {
		const name = this.extractNameFromEmail(to);

		logger.info({ to, locale, name }, 'Sending follow-up email');

		return ResultAsync.fromPromise(
			this.resend.emails.send({
				from: 'Sasha <hello@acepe.dev>',
				to,
				subject: 'Welcome to Acepe! 🎉',
				html: this.buildFollowUpEmailTemplate(name),
				text: this.buildFollowUpPlainTextTemplate(name),
				headers: {
					'List-Unsubscribe': '<mailto:hello@acepe.dev?subject=unsubscribe>'
				},
				tags: [
					{
						name: 'category',
						value: 'follow-up'
					}
				]
			}),
			(error) => {
				logger.error({ error, to }, 'Failed to send follow-up email');
				return new EmailSendingFailedError(`Failed to send follow-up email: ${error}`);
			}
		).map(() => {
			logger.info({ to }, 'Successfully sent follow-up email');
			return undefined;
		});
	}

	private buildFollowUpEmailTemplate(name: string): string {
		const greeting = name ? `Hey there ${name}!` : 'Hey there!';

		return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>Thanks for confirming! - Acepe</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #0a0a0a;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 560px;">
          <!-- Logo Header -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="vertical-align: middle; padding-right: 10px;">
                    <img src="${PUBLIC_BASE_URL}/favicon-32x32.png" width="32" height="32" alt="Acepe" style="display: block;" />
                  </td>
                  <td style="vertical-align: middle;">
                    <span style="font-size: 24px; font-weight: 600; color: #ffffff; letter-spacing: -0.02em;">Acepe</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #141414; border-radius: 16px; border: 1px solid #2a2a2a;">
                <tr>
                  <td style="padding: 48px 40px;">
                    <!-- Greeting -->
                    <p style="margin: 0 0 24px 0; font-size: 18px; line-height: 1.6; color: #ffffff; font-weight: 500;">
                      ${greeting}
                    </p>

                    <!-- Main Message -->
                    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      I saw you registered for the waiting list, thank you so much, where have you found the website?
                    </p>

                    <!-- Questions -->
                    <p style="margin: 0 0 16px 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      What do you think of the app?
                    </p>

                    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      Any features you would like to see implemented?
                    </p>

                    <!-- Feedback Request -->
                    <p style="margin: 0 0 24px 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      Please give me all the feedback you can as I'm finalising this out.
                    </p>

                    <!-- Closing -->
                    <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #a0a0a0;">
                      Have a great day.<br />
                      Sasha
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top: 32px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <!-- Social Links -->
                <tr>
                  <td align="center" style="padding-bottom: 24px;">
                    <span style="font-size: 13px; color: #555555;">
                      <a href="https://x.com/acepe_dev" target="_blank" style="color: #888888; text-decoration: none;">X</a>
                      <span style="color: #333333; padding: 0 8px;">&middot;</span>
                      <a href="https://github.com/acepe-ai/acepe" target="_blank" style="color: #888888; text-decoration: none;">GitHub</a>
                      <span style="color: #333333; padding: 0 8px;">&middot;</span>
                      <a href="https://discord.gg/acepe" target="_blank" style="color: #888888; text-decoration: none;">Discord</a>
                    </span>
                  </td>
                </tr>

                <!-- Copyright -->
                <tr>
                  <td align="center" style="padding-top: 16px;">
                    <p style="margin: 0; font-size: 12px; color: #444444;">
                      &copy; ${new Date().getFullYear()} Acepe. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
		`;
	}

	private buildFollowUpPlainTextTemplate(name: string): string {
		const greeting = name ? `Hey there ${name}!` : 'Hey there!';

		return `
${greeting}

I saw you registered for the waiting list, thank you so much, where have you found the website?

What do you think of the app?

Any features you would like to see implemented?

Please give me all the feedback you can as I'm finalising this out.

Have a great day.

Sasha

---

© ${new Date().getFullYear()} Acepe. All rights reserved.

X: https://x.com/acepe_dev
GitHub: https://github.com/acepe-ai/acepe
Discord: https://discord.gg/acepe
		`.trim();
	}
}
