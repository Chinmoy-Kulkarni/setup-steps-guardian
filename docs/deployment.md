# Deployment and rollback

## Preflight

- `pnpm check`
- `pnpm build`
- Apply D1 migrations to a preview database.
- Verify the bundled Action validates this repository with zero findings.
- Verify no generated asset or log contains a secret.

## Deploy

```bash
pnpm --filter @setup-fleet/dashboard build
pnpm --filter @setup-fleet/worker exec wrangler d1 migrations apply setup-steps-guardian --remote
pnpm --filter @setup-fleet/worker exec wrangler deploy
```

Production deployment requires owner-created Cloudflare credentials and secrets. CI should use
a least-privilege Cloudflare API token stored in GitHub Actions secrets.

Keep `PADDLE_BINDING_SECRET` stable while subscriptions are active. Rotating it requires
re-binding every active Paddle subscription's metadata before removing the old key; disabling
checkout is safer than accepting unbound entitlement events during that operation. The separate
`PADDLE_WEBHOOK_SECRET` may be rotated independently.

## Signals

- `/health` and `/api/health` return `status: ok`.
- GitHub webhook deliveries receive successful responses.
- Billing webhooks reject account, plan, binding, or purchased-price mismatches.
- Scan queue depth and oldest available job remain bounded.
- D1 reads/writes remain below free-tier limits.
- OAuth, fleet access, checkout, and billing webhooks complete without cross-tenant access.

## Rollback

1. Disable new checkout if entitlement handling is affected.
2. Roll back the Worker to the last known-good deployment.
3. Do not roll back a D1 migration by deleting production data.
4. Apply a forward corrective migration when schema repair is required.
5. Reconcile missed webhook deliveries and queued scans idempotently after recovery.

The initial release has no SLA. Security, billing, legal, or account-level incidents require the
owner to decide whether to disable the public App or checkout.
