import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateRecords,
  isEligiblePublicSearchItem,
  isRetryableGitHubResponse,
  parseArguments,
  parseGitHubOutput,
  renderSummary,
  retryDelay,
  sanitizeValidationResult,
} from "./public-workflow-study.mjs";

test("parseGitHubOutput reads scalar and multiline values", () => {
  assert.deepEqual(
    parseGitHubOutput(
      [
        "status=valid",
        "result-json<<delimiter",
        '{"status":"valid",',
        '"findings":[]}',
        "delimiter",
        "",
      ].join("\n"),
    ),
    {
      status: "valid",
      "result-json": '{"status":"valid",\n"findings":[]}',
    },
  );
});

test("parseGitHubOutput rejects an unterminated multiline value", () => {
  assert.throws(() => parseGitHubOutput("result-json<<missing\n{}"), /missing delimiter missing/);
});

test("isEligiblePublicSearchItem rejects private and suffix results", () => {
  const item = {
    repository: { private: false, full_name: "owner/repository" },
    path: ".github/workflows/copilot-setup-steps.yml",
    url: "https://api.github.com/item",
    html_url: "https://github.com/item",
    sha: "a".repeat(40),
  };

  assert.equal(isEligiblePublicSearchItem(item), true);
  assert.equal(
    isEligiblePublicSearchItem({
      ...item,
      repository: { ...item.repository, private: true },
    }),
    false,
  );
  assert.equal(isEligiblePublicSearchItem({ ...item, path: `${item.path}.example` }), false);
});

test("parseArguments validates bounded numeric options", () => {
  const options = parseArguments([
    "--sample-size",
    "25",
    "--census-pages",
    "4",
    "--concurrency",
    "3",
  ]);
  assert.equal(options.sampleSize, 25);
  assert.equal(options.censusPages, 4);
  assert.throws(() => parseArguments(["--sample-size", "0"]), /between 1 and 1000/);
  assert.throws(() => parseArguments(["--census-pages", "11"]), /between 1 and 10/);
});

test("retryDelay respects GitHub reset headers and fractional retry messages", () => {
  const now = 1_000_000;
  const reset = Math.floor((now + 12_000) / 1000);
  const response = new Response("", {
    status: 429,
    headers: {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(reset),
    },
  });

  assert.equal(retryDelay(response, 0, '{"message":"try again in 472.054249ms"}', now), 13_000);
});

test("retryDelay parses Retry-After seconds and HTTP dates", () => {
  const now = Date.parse("2026-08-11T00:00:00.000Z");
  assert.equal(
    retryDelay(new Response("", { status: 429, headers: { "retry-after": "2.5" } }), 0, "", now),
    3500,
  );
  assert.equal(
    retryDelay(
      new Response("", {
        status: 429,
        headers: { "retry-after": "Tue, 11 Aug 2026 00:00:05 GMT" },
      }),
      0,
      "",
      now,
    ),
    6000,
  );
});

test("isRetryableGitHubResponse recognizes primary and secondary limits", () => {
  assert.equal(
    isRetryableGitHubResponse(
      new Response("", { status: 403, headers: { "x-ratelimit-remaining": "1" } }),
      '{"message":"You have exceeded a secondary rate limit. Please try again in 2s."}',
    ),
    true,
  );
  assert.equal(
    isRetryableGitHubResponse(
      new Response("", { status: 403, headers: { "x-ratelimit-remaining": "1" } }),
      '{"message":"Resource not accessible by integration"}',
    ),
    false,
  );
});

test("aggregateRecords separates validity, warnings, failures, and finding prevalence", () => {
  const aggregate = aggregateRecords([
    {
      status: "validated",
      validation: {
        status: "invalid",
        findings: [
          { code: "TIMEOUT_MISSING", severity: "error" },
          { code: "ACTION_REF_MUTABLE", severity: "warning" },
        ],
      },
    },
    {
      status: "validated",
      validation: {
        status: "valid",
        findings: [{ code: "ACTION_REF_MUTABLE", severity: "warning" }],
      },
    },
    { status: "failed" },
  ]);

  assert.equal(aggregate.attempted, 3);
  assert.equal(aggregate.validated, 2);
  assert.equal(aggregate.failed, 1);
  assert.equal(aggregate.valid, 1);
  assert.equal(aggregate.invalid, 1);
  assert.equal(aggregate.withWarnings, 2);
  assert.deepEqual(aggregate.findingCounts, [
    {
      code: "ACTION_REF_MUTABLE",
      severity: "warning",
      occurrences: 2,
      workflows: 2,
    },
    {
      code: "TIMEOUT_MISSING",
      severity: "error",
      occurrences: 1,
      workflows: 1,
    },
  ]);
});

test("sanitizeValidationResult excludes third-party source excerpts", () => {
  const sanitized = sanitizeValidationResult({
    schemaVersion: 1,
    status: "invalid",
    workflowPath: ".github/workflows/copilot-setup-steps.yml",
    workflowHash: "workflow-hash",
    policyHash: "policy-hash",
    findings: [
      {
        code: "WORKFLOW_YAML_INVALID",
        severity: "error",
        title: "Invalid YAML",
        message: 'Map keys must be unique at line 3:\\n  password: "source excerpt"',
        path: ".github/workflows/copilot-setup-steps.yml",
        evidence: { source: "source excerpt" },
        remediation: "Fix it.",
      },
    ],
    patches: [{ content: "generated content" }],
  });

  assert.deepEqual(sanitized.findings, [
    {
      code: "WORKFLOW_YAML_INVALID",
      severity: "error",
      path: ".github/workflows/copilot-setup-steps.yml",
    },
  ]);
  assert.equal(sanitized.patchCount, 1);
  assert.doesNotMatch(JSON.stringify(sanitized), /source excerpt|generated content/);
});

test("renderSummary safely renders exact and suffix workflow paths", () => {
  const summary = renderSummary({
    generatedAt: "2026-01-01T00:00:00.000Z",
    query: "filename:copilot-setup-steps.yml path:.github/workflows",
    search: {
      publicExactObserved: 10,
      pagesInspected: 1,
      incompleteResults: false,
      discardedNonExactPaths: 2,
    },
    sample: { requested: 1 },
    aggregate: {
      attempted: 1,
      validated: 1,
      failed: 0,
      valid: 1,
      invalid: 0,
      withWarnings: 0,
      findingCounts: [],
    },
  });

  assert.match(summary, /`\.yml\.example`/);
  assert.match(summary, /`\.github\/workflows\/copilot-setup-steps\.yml`/);
  assert.match(summary, /Public exact-path workflows directly observed: \*\*10\*\*/);
});
