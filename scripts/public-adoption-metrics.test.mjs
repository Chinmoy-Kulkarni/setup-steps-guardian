import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateParticipation,
  parseArguments,
  publicActionReferenceItems,
  renderSummary,
} from "./public-adoption-metrics.mjs";

test("parseArguments accepts an explicit output directory", () => {
  assert.match(parseArguments(["--output", "metrics"]).output, /metrics$/);
  assert.throws(() => parseArguments(["--output"]), /non-empty path/);
});

test("aggregateParticipation excludes the owner and bots", () => {
  const participation = aggregateParticipation({
    discussions: {
      totalCount: 1,
      nodes: [
        {
          number: 5,
          author: { login: "discussion-author" },
          comments: {
            nodes: [
              { author: { login: "Chinmoy-Kulkarni" } },
              { author: { login: "outside-user" } },
              { author: { login: "dependabot" } },
            ],
          },
        },
      ],
    },
    issues: {
      totalCount: 1,
      nodes: [{ author: { login: "outside-user" } }],
    },
    pullRequests: {
      totalCount: 1,
      nodes: [{ author: { login: "automation[bot]" } }],
    },
  });

  assert.deepEqual(participation.externalDiscussionAuthorsOrCommenters, [
    "discussion-author",
    "outside-user",
  ]);
  assert.equal(participation.usefulnessDiscussionExternalComments, 1);
  assert.deepEqual(participation.externalIssueAuthors, ["outside-user"]);
  assert.deepEqual(participation.externalPullRequestAuthors, []);
});

test("publicActionReferenceItems never publishes private search results", () => {
  const publicItem = {
    repository: { private: false, full_name: "public/repository" },
    path: ".github/workflows/check.yml",
    html_url: "https://github.com/public/repository/blob/sha/check.yml",
  };
  const privateItem = {
    ...publicItem,
    repository: { private: true, full_name: "private/repository" },
  };

  assert.deepEqual(publicActionReferenceItems([privateItem, publicItem]), [publicItem]);
});

test("publicActionReferenceItems keeps only direct YAML workflow files", () => {
  const item = {
    repository: { private: false, full_name: "public/repository" },
    path: ".github/workflows/check.yml",
    html_url: "https://github.com/public/repository/blob/sha/check.yml",
  };

  assert.deepEqual(
    publicActionReferenceItems([
      item,
      { ...item, path: ".github/workflows/check.yaml" },
      { ...item, path: ".github/workflows/check.yml.disabled" },
      { ...item, path: ".github/workflows/nested/check.yml" },
      { ...item, path: ".github/workflows/check" },
      { ...item, path: ".GitHub/workflows/check.yml" },
    ]).map((result) => result.path),
    [".github/workflows/check.yml", ".github/workflows/check.yaml"],
  );
});

test("renderSummary separates adoption from traffic awareness", () => {
  const summary = renderSummary({
    generatedAt: "2026-08-11T00:00:00.000Z",
    repository: { stars: 0, forks: 0, subscribers: 0 },
    actionReferences: { observedPublicCount: 0 },
    participation: {
      externalDiscussionAuthorsOrCommenters: [],
      usefulnessDiscussionExternalComments: 0,
      externalIssueAuthors: [],
      externalPullRequestAuthors: [],
    },
    traffic: {
      views: { available: true, count: 12, uniques: 3 },
      clones: { available: false },
    },
  });

  assert.match(summary, /Product adoption/);
  assert.match(summary, /Repository awareness/);
  assert.match(summary, /Unique viewers in that window: \*\*3\*\*/);
  assert.match(summary, /Unique cloners in that window: \*\*unavailable\*\*/);
});
