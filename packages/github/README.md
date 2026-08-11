# `@setup-fleet/github`

Cloudflare Workers-compatible GitHub integration for SetupStepsGuardian.

## GitHub App configuration

Grant only:

- Metadata: read (implicit)
- Contents: read
- Actions: read

Subscribe to `installation`, `installation_repositories`, `push`, and `workflow_run`.
Dashboard authorization must use a GitHub App user access token.

Always pass the untouched request bytes from `Request.arrayBuffer()` to
`verifyWebhookSignature` before parsing JSON.

## Worker-facing API

`OctokitGitHubClient` implements `GitHubClient`:

- `createInstallationToken`
- `getInstallationRepositories`
- `getRepository`
- `getFileContent`
- `listWorkflowRuns`
- `getWorkflowRun`
- `getWorkflowRunDiagnostics`
- `getAuthenticatedUser`
- `getAuthenticatedUserInstallations`

`getFileContent` accepts an optional `ref`. Omitting it asks GitHub for the
repository's default branch, which is required when reading versioned policy
from another selected repository such as the organization `.github` repository.

Full `GitHubRepository` values include a non-null `defaultBranch`,
`isPrivate`, and `isArchived`. Installation webhooks use
`GitHubSelectedRepository` because GitHub omits the default branch and archive
state from those compact repository objects. Consumers should hydrate those
repositories with `getRepository(authorization, repositoryId)` before
persisting full metadata. This avoids listing an entire large installation;
`getInstallationRepositories` remains available for full synchronization.
`GitHubAccount.type` is always normalized to `Organization` or `User`.

`getWorkflowRunDiagnostics` reads the jobs endpoint and returns only
`GitHubWorkflowRunDiagnostics` (`runnerLabel` and `failedStep`). Runner labels
come from the job's `labels`; runner names, logs, and artifacts are ignored.
The failed step is the first `failure` conclusion in GitHub's jobs/steps API
order.

GitHub can return workflow conclusion `stale`, which is not in the shared
`WorkflowConclusion` contract. Use `classifyGitHubWorkflowConclusion`: it
returns `kind: "contract"`, `"stale"`, or `"pending"` so the Worker must handle
stale explicitly rather than persisting it as a contract conclusion.

## GitHub App user OAuth

The Workers-compatible helpers are:

- `createGitHubPkceChallenge(codeVerifier)`
- `buildGitHubAppUserAuthorizationUrl(options)`
- `parseGitHubAppUserAuthorizationCallback(callbackUrl, options)`
- `exchangeGitHubAppUserCode(options)`

The authorization URL requires a random state value, PKCE S256 challenge, and
an exact HTTPS callback URL without query parameters. The callback parser
checks both the callback URL and state before returning the code. Store state
and the PKCE verifier in a short-lived, signed, HTTP-only session cookie and
delete them after one use. Generate state and the 43-to-128-character verifier
from `crypto.getRandomValues`; `createGitHubPkceChallenge` only derives the
challenge.

`exchangeGitHubAppUserCode` posts form data to GitHub's official
`/login/oauth/access_token` endpoint with `Accept: application/json`. It returns
`GitHubUserAccessToken` with `accessToken`, `expiresAt`, `tokenType`, nullable
`refreshToken`, and nullable `refreshTokenExpiresAt`. Enable expiring user
tokens in the GitHub App settings; a response without `expires_in` is rejected.
After every exchange, call `getAuthenticatedUser` before binding the session.
The OAuth helpers target GitHub.com and intentionally do not accept alternate
provider endpoints. Catch `GitHubOAuthError` and branch on its normalized
`GitHubOAuthErrorCode`; provider descriptions and response bodies are never
returned. Under SetupStepsGuardian's no-token-retention model, use the access
token only during callback authorization and discard both access and refresh
tokens after resolving the user and accessible installations.

REST requests send `X-GitHub-Api-Version: 2026-03-10` through the Octokit
request hook.

## Private-key setup

GitHub commonly downloads an RSA private key in PKCS#1 form
(`BEGIN RSA PRIVATE KEY`). Workers Web Crypto imports unencrypted PKCS#8
(`BEGIN PRIVATE KEY`). The app owner must convert the key before storing it as a
Worker secret:

```sh
openssl pkcs8 -topk8 -nocrypt \
  -in github-app-private-key.pem \
  -out github-app-private-key.pkcs8.pem

wrangler secret put GITHUB_APP_PRIVATE_KEY_PKCS8
```

Paste the PKCS#8 PEM into the secret prompt. Do not commit either key. Escaped
`\n` line breaks are accepted for secret-manager values.

`createWebCryptoAppJwt` implements the `createJwt` contract exposed by
`@octokit/auth-app`. The installed top-level `octokit` `App` API does not expose
that option, so `OctokitGitHubClient` signs RS256 with Web Crypto and injects
authentication through an Octokit request hook. Octokit's automatic retries are
disabled; callers can use the exported rate-limit and retry classifiers.

Installation access tokens are kept behind opaque authorization handles. They
are never included in normalized results or errors. File contents are returned
in memory for deterministic evaluation and must be discarded after hashing and
validation; this package does not fetch logs or artifacts. A custom request
transport receives a transient `Authorization` header and must never log, store,
or return it. Successful client results include rate-limit metadata from the
final request. OAuth client secrets, codes, access tokens, and refresh tokens
must receive the same treatment.
