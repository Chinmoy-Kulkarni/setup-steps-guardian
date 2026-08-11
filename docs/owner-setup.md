# Owner setup

These are the unavoidable account-owner actions. Do not paste secrets into issues, commits,
chat transcripts, or screenshots.

## GitHub

1. Create or select the GitHub organization that will own the public GitHub App.
2. Register a public GitHub App without a Marketplace listing.
3. Set repository permissions to:
   - Metadata: read
   - Contents: read
   - Actions: read
4. Subscribe to:
   - `installation`
   - `installation_repositories`
   - `push`
   - `workflow_run`
5. Enable user authorization and set the callback to
   `https://<deployment>/api/auth/github/callback`.
6. Set the webhook URL to `https://<deployment>/api/webhooks/github`.
7. Generate a private key and convert it offline from GitHub's PKCS#1 PEM to PKCS#8:

   ```bash
   openssl pkcs8 \
     -topk8 \
     -inform PEM \
     -outform PEM \
     -nocrypt \
     -in github-app-private-key.pem \
     -out github-app-private-key-pkcs8.pem
   ```

8. Store the PKCS#8 value only as the `GITHUB_PRIVATE_KEY_PKCS8` Cloudflare secret.

## Cloudflare

1. Create the free Workers/D1 project.
2. Create the production D1 database.
3. Replace the placeholder `database_id` in `apps/worker/wrangler.jsonc`.
4. Apply migrations from `packages/data/migrations`.
5. Add the secrets listed in `.env.example` with `wrangler secret put`.
6. Deploy first to a preview hostname and verify health, OAuth, webhook, deletion, and billing
   behavior before approving production.

Do not enable the Workers paid plan before revenue without explicit owner approval.

## Merchant of record

1. Complete identity, tax, banking, payout, and product review with Paddle or the selected
   no-fixed-cost merchant of record.
2. Create separate active recurring USD prices with distinct Paddle price IDs: Team must be
   `2900` cents every one month, and Fleet must be `7900` cents every one month.
3. Create a server-side runtime API key with `transaction.write` and `subscription.write`
   permissions. Use a separate temporary preflight key with `price.read` and
   `notification_setting.read`, then revoke it after verification.
4. Configure an active API-version-1 URL notification destination at
   `https://<deployment>/api/webhooks/paddle`, with sensitive fields disabled, for
   `subscription.created`,
   `subscription.activated`, `subscription.trialing`, `subscription.updated`,
   `subscription.past_due`, `subscription.paused`, `subscription.resumed`, and
   `subscription.canceled`. Store its endpoint secret as `PADDLE_WEBHOOK_SECRET`.
5. Generate a separate random `PADDLE_BINDING_SECRET` with at least 32 characters. Do not reuse
   the webhook secret.
6. Add the provider API key, webhook secret, binding secret, and price IDs as Cloudflare secrets.
7. Verify that sandbox subscription webhooks contain exactly one quantity-one item whose
   `price.id` matches the selected Team or Fleet price.
8. Verify checkout, renewal, failed payment, cancellation, refund, and portal behavior in the
   provider sandbox before enabling live checkout.

All payouts remain in owner-controlled accounts. The application has no authority to spend
revenue or upgrade infrastructure.

## Public launch

Before accepting external installations:

- Approve the product name after legal/trademark review.
- Add valid publisher, privacy, terms, support, and security contact details.
- Enable GitHub private vulnerability reporting.
- Review pricing and refund behavior.
- Confirm uninstall and account-deletion paths.
- Approve the Action/App listing and public launch.
