# DNS Configuration for Email Deliverability

This guide will help you set up the necessary DNS records to improve email deliverability for emails sent from `acepe.dev`.

## Prerequisites

- Access to your DNS provider (where acepe.dev is registered)
- Resend account configured for acepe.dev

## 1. SPF Record (Already configured via Resend)

Resend automatically handles SPF when you verify your domain. No action needed if domain is verified.

## 2. DKIM Record (Already configured via Resend)

Resend automatically handles DKIM when you verify your domain. No action needed if domain is verified.

## 3. DMARC Record (NEEDS ATTENTION)

A DMARC record tells email receivers what to do with emails that fail SPF or DKIM checks.

### Add this TXT record to your DNS:

**Record Type:** `TXT`
**Name/Host:** `_dmarc`
**Value/Content:** `v=DMARC1; p=none; rua=mailto:hello@acepe.dev; ruf=mailto:hello@acepe.dev; fo=1; pct=100`

### What this means:

- `v=DMARC1` - DMARC version 1
- `p=none` - Start with monitoring mode (don't reject emails yet)
- `rua=mailto:hello@acepe.dev` - Send aggregate reports to this email
- `ruf=mailto:hello@acepe.dev` - Send forensic reports to this email
- `fo=1` - Generate reports when either SPF or DKIM fails
- `pct=100` - Apply policy to 100% of emails

### Progression Path

After monitoring for 2-4 weeks with `p=none`:

1. **Phase 1 (Current):** `p=none` - Monitor only
2. **Phase 2 (After 2 weeks):** `p=quarantine; pct=10` - Quarantine 10% of failures
3. **Phase 3 (After 4 weeks):** `p=quarantine; pct=100` - Quarantine all failures
4. **Phase 4 (After 6 weeks):** `p=reject; pct=100` - Reject all failures (strictest)

## 4. Verify Domain in Resend

1. Go to [Resend Dashboard](https://resend.com/domains)
2. Add `acepe.dev` domain
3. Follow their verification steps (add DNS records they provide)
4. Wait for verification (can take up to 48 hours)

## 5. Update Sender Email in Resend

After verifying the domain, you need to configure `hello@acepe.dev` as a verified sender:

1. Resend will automatically allow any email from your verified domain
2. No additional configuration needed once domain is verified

## Verification

After adding DNS records, verify them using these tools:

- **DMARC Check:** https://mxtoolbox.com/dmarc.aspx
- **SPF Check:** https://mxtoolbox.com/spf.aspx
- **DKIM Check:** https://mxtoolbox.com/dkim.aspx
- **Overall Email Health:** https://www.mail-tester.com/

## Expected Timeline

- DNS propagation: 1-48 hours
- Full verification: Up to 48 hours
- DMARC reports start arriving: 24-48 hours after first record

## Monitoring

Check `hello@acepe.dev` inbox regularly for DMARC reports. These reports will show:

- Which emails are passing/failing
- Authentication issues
- Potential spoofing attempts

## Troubleshooting

### Common Issues

1. **DNS not propagating:** Wait 24-48 hours
2. **Resend domain verification failing:** Double-check DNS records match exactly
3. **DMARC reports not arriving:** Verify the TXT record is correctly formatted
4. **Emails still going to spam:** This is normal initially; improve over time with good sending practices

## Additional Best Practices

1. **Warm up your domain:** Start with small volumes, gradually increase
2. **Monitor bounce rates:** Keep under 2%
3. **Monitor spam complaints:** Keep under 0.1%
4. **Maintain good list hygiene:** Remove bounces and unengaged users
5. **Use email authentication:** Already handled by Resend (SPF, DKIM)
6. **Avoid spam trigger words:** "free", "guaranteed", excessive caps/exclamation marks
