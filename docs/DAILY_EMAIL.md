# Daily challenge reminders

The Home invitation has a **Remind me daily** email form. The public cloud API accepts a subscription request, sends a confirmation link, and starts reminders only after the recipient confirms. A reminder links to the regular real daily challenge route, which also selects Sunday's synthetic lab. The email footer links to the unsubscribe page. Opening a management page is read-only. The recipient presses a button to confirm or unsubscribe so that automated link previews cannot change a subscription.

## Configuration

The public cloud API and the private reminder job use the same settings.

| Setting | Value |
| --- | --- |
| `BLINK_EMAIL_ENABLED` | `true` when email is configured and ready |
| `BLINK_EMAIL_SITE_URL` | Public HTTPS frontend base including the repository path |
| `BLINK_EMAIL_KEY` | Stable secret of at least 32 bytes, provided by the deployment secret store |
| `BLINK_SMTP_HOST` | SMTP relay hostname |
| `BLINK_SMTP_PORT` | TLS SMTP port, default `465` |
| `BLINK_SMTP_FROM` | Verified sender address |
| `BLINK_SMTP_USER`, `BLINK_SMTP_PASSWORD` | Relay credentials supplied by the deployment secret store |
| `BLINK_EMAIL_CONFIRM_LIMIT` | Daily UTC confirmation-send budget, default `100` |
| `BLINK_FIRESTORE_DATABASE` | Firestore state database used by the API and private job |

Use the cloud image to run a separate private reminder job with `python -m spherex.daily_email`. Schedule it at `0 9 * * *` in `Europe/Bucharest`. The job uses Firestore subscriptions and an SMTP relay over TLS. It exits with a failure status if any sends fail and logs only counts. It claims each subscriber's local date before SMTP to avoid duplicate reminders across repeated runs. A failed send after a claim is skipped for that date. Expired unconfirmed records are deleted by the job. Unsubscribing deletes the subscription.

The subscriptions and confirmation budgets live in `dailyEmailSubscriptions` and `dailyEmailLimits`. The API uses a six-hour per-address confirmation cooldown, an atomic global confirmation budget, expiring private confirmation tokens and stable unsubscribe links. Keep Firestore and SMTP credentials server-side. Configure and verify the sender and schedule before enabling the public form.
