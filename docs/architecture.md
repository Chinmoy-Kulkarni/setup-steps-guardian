# Architecture

## Trust boundary

The GitHub Action runs inside the customer's GitHub Actions runner and reads only the documented
setup workflow, optional policy, and supported root manifests/lockfiles. The hosted service uses
a separate read-only GitHub App and never executes repository code.

## Components

- `packages/policy-engine`: portable deterministic parser and rule engine
- `packages/action`: Node 24 JavaScript Action using the shared engine
- `packages/github`: signature verification, event normalization, and read-only API adapters
- `packages/data`: D1 migrations and tenant-scoped persistence
- `apps/worker`: webhook/API/auth/billing/scheduled processing
- `apps/dashboard`: static React dashboard served with the Worker

## GitHub App permissions

- Metadata: read (implicit)
- Contents: read
- Actions: read

The initial release does not request Actions write, Contents write, Pull requests write,
Workflows write, Administration, Secrets, or Members permissions.

## Event flow

1. GitHub sends installation, repository-selection, push, or workflow-run events.
2. The Worker verifies `X-Hub-Signature-256` over the raw body and records the delivery ID.
3. The handler stores a normalized bounded scan job in D1 and returns quickly.
4. A scheduled handler claims jobs in bounded batches and fetches only the setup workflow,
   selected policy, relevant lockfiles, and workflow-run metadata.
5. The shared engine emits hashes and normalized findings; fetched content is discarded.
6. The dashboard reads tenant-scoped summaries from D1 rather than making live GitHub calls.

## Authentication

Dashboard login uses GitHub App user authorization. Sessions are short-lived, signed, HTTP-only,
SameSite cookies. Account discovery uses the user's installations, while every fleet, detail, and
manual-scan response is intersected with repository IDs returned by GitHub's authenticated-user
installation repository endpoint. The numeric `sender.id` from `installation.created` is retained
as the initial account administrator; only that administrator can start checkout or delete
retained account data. OAuth return paths are canonicalized against the configured product origin
before redirecting.

## Billing integrity

Checkout starts only after the Worker reauthorizes the user for the immutable GitHub account ID.
The Worker binds that account ID, the requested plan, and the configured Paddle price ID with a
domain-separated HMAC and a dedicated binding secret before placing the metadata on the
transaction. Paddle's webhook-signing secret is not reused for this purpose.

For subscription webhooks, the Worker verifies Paddle's raw-body signature, derives the plan from
the provider-owned `data.items[].price.id`, requires one quantity-one item using one of the two
distinct configured prices, and then verifies the metadata binding. Mutable `custom_data` alone
can never grant an entitlement.

## Deployment

The initial deployment uses Cloudflare Workers static assets and D1 on free tiers. A public
GitHub App can be installed across organizations without a Marketplace listing. Paid GitHub
Marketplace plans are deferred until publisher and installation requirements are met.
