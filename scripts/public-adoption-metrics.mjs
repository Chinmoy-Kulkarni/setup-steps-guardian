import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "Chinmoy-Kulkarni";
const REPOSITORY = "setup-steps-guardian";
const FULL_NAME = `${OWNER}/${REPOSITORY}`;
const USEFULNESS_DISCUSSION_NUMBER = 5;
const ACTION_REFERENCE_QUERY = `"${FULL_NAME}@" path:.github/workflows -repo:${FULL_NAME}`;
const DIRECT_WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;

function usage() {
  return [
    "Usage: node scripts/public-adoption-metrics.mjs [options]",
    "",
    "Options:",
    "  --output <path>  Output directory (default: .research/public-adoption-metrics)",
    "  --help           Show this help",
    "",
    "Authentication uses GH_TOKEN or the current `gh auth` session.",
  ].join("\n");
}

export function parseArguments(argv) {
  const options = {
    output: resolve(".research/public-adoption-metrics"),
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--output": {
        const value = argv[++index];
        if (value === undefined || value.trim().length === 0) {
          throw new Error("--output requires a non-empty path.");
        }
        options.output = resolve(value);
        break;
      }
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function runGh(args) {
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `gh exited with status ${result.status}`);
  }

  return JSON.parse(result.stdout);
}

function captureGh(args) {
  try {
    return { available: true, value: runGh(args) };
  } catch (error) {
    return {
      available: false,
      error: error instanceof Error ? error.message.slice(0, 300) : "Unknown gh failure",
    };
  }
}

function isExternalLogin(login) {
  if (typeof login !== "string" || login.length === 0) {
    return false;
  }
  const normalized = login.toLowerCase();
  return (
    normalized !== OWNER.toLowerCase() &&
    normalized !== "dependabot" &&
    !normalized.endsWith("[bot]")
  );
}

function externalAuthors(nodes) {
  return [
    ...new Set(
      nodes
        .map((node) => node?.author?.login)
        .filter(isExternalLogin)
        .map((login) => login.toLowerCase()),
    ),
  ].sort();
}

export function publicActionReferenceItems(items) {
  return items.filter(
    (item) =>
      item.repository?.private === false &&
      typeof item.repository.full_name === "string" &&
      typeof item.path === "string" &&
      DIRECT_WORKFLOW_PATH.test(item.path) &&
      typeof item.html_url === "string",
  );
}

export function aggregateParticipation(repository) {
  const discussions = repository.discussions?.nodes ?? [];
  const discussionComments = discussions.flatMap((discussion) => discussion.comments?.nodes ?? []);
  const usefulnessDiscussion = discussions.find(
    (discussion) => discussion.number === USEFULNESS_DISCUSSION_NUMBER,
  );
  const usefulnessComments = usefulnessDiscussion?.comments?.nodes ?? [];

  return {
    discussions: repository.discussions?.totalCount ?? 0,
    externalDiscussionAuthorsOrCommenters: externalAuthors([...discussions, ...discussionComments]),
    usefulnessDiscussionExternalComments: usefulnessComments.filter((comment) =>
      isExternalLogin(comment?.author?.login),
    ).length,
    issues: repository.issues?.totalCount ?? 0,
    externalIssueAuthors: externalAuthors(repository.issues?.nodes ?? []),
    pullRequests: repository.pullRequests?.totalCount ?? 0,
    externalPullRequestAuthors: externalAuthors(repository.pullRequests?.nodes ?? []),
  };
}

function trafficMetric(result) {
  if (!result.available) {
    return result;
  }
  return {
    available: true,
    count: result.value.count,
    uniques: result.value.uniques,
  };
}

export function renderSummary(metrics) {
  const participation = metrics.participation;
  const externalParticipants = new Set([
    ...participation.externalDiscussionAuthorsOrCommenters,
    ...participation.externalIssueAuthors,
    ...participation.externalPullRequestAuthors,
  ]).size;

  return `# SetupStepsGuardian public adoption metrics

Generated: ${metrics.generatedAt}

## Product adoption

- GitHub stars: **${metrics.repository.stars}**
- Forks: **${metrics.repository.forks}**
- Subscribers: **${metrics.repository.subscribers}**
- Observed indexed public direct-workflow references in the first 100 search items:
  **${metrics.actionReferences.observedPublicCount}**
- Distinct external issue or pull-request authors and Discussion authors or commenters captured:
  **${externalParticipants}**
- External comments in the usefulness-report discussion: **${participation.usefulnessDiscussionExternalComments}**

## Repository awareness

- Views in GitHub's rolling traffic window: **${
    metrics.traffic.views.available ? metrics.traffic.views.count : "unavailable"
  }**
- Unique viewers in that window: **${
    metrics.traffic.views.available ? metrics.traffic.views.uniques : "unavailable"
  }**
- Clones in GitHub's rolling traffic window: **${
    metrics.traffic.clones.available ? metrics.traffic.clones.count : "unavailable"
  }**
- Unique cloners in that window: **${
    metrics.traffic.clones.available ? metrics.traffic.clones.uniques : "unavailable"
  }**

## Interpretation

- These are public or repository-owner GitHub metrics, not hidden Action telemetry.
- A matching code-search result is an observed indexed public reference, not proof that a workflow
  ran successfully.
- Stars, views, clones, and automated dependency pull requests are not confirmed usefulness.
- Participation queries are capped at the first 100 records or comments for each GitHub connection.
- A usefulness report is confirmed only after a maintainer reviews the voluntary report and its
  public evidence. This file records the raw participation count, not a positive-outcome claim.
`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const repository = runGh(["api", `repos/${FULL_NAME}`]);
  const actionReferences = runGh([
    "api",
    "--method",
    "GET",
    "search/code",
    "-f",
    `q=${ACTION_REFERENCE_QUERY}`,
    "-f",
    "per_page=100",
  ]);
  const participationResponse = runGh([
    "api",
    "graphql",
    "-f",
    `query=query {
      repository(owner: "${OWNER}", name: "${REPOSITORY}") {
        discussions(first: 100) {
          totalCount
          nodes {
            number
            title
            author { login }
            comments(first: 100) {
              totalCount
              nodes { author { login } }
            }
          }
        }
        issues(first: 100) {
          totalCount
          nodes { author { login } }
        }
        pullRequests(first: 100) {
          totalCount
          nodes { author { login } }
        }
      }
    }`,
  ]);
  const views = captureGh(["api", `repos/${FULL_NAME}/traffic/views`]);
  const clones = captureGh(["api", `repos/${FULL_NAME}/traffic/clones`]);
  const publicActionReferences = publicActionReferenceItems(actionReferences.items ?? []);

  const metrics = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repository: {
      fullName: FULL_NAME,
      url: repository.html_url,
      createdAt: repository.created_at,
      pushedAt: repository.pushed_at,
      stars: repository.stargazers_count,
      forks: repository.forks_count,
      subscribers: repository.subscribers_count,
    },
    actionReferences: {
      query: ACTION_REFERENCE_QUERY,
      observedPublicCount: publicActionReferences.length,
      searchPageSize: 100,
      incompleteResults: actionReferences.incomplete_results === true,
      items: publicActionReferences.map((item) => ({
        repository: item.repository?.full_name,
        path: item.path,
        url: item.html_url,
      })),
    },
    participation: aggregateParticipation(participationResponse.data.repository),
    traffic: {
      window: "GitHub rolling 14-day traffic window",
      views: trafficMetric(views),
      clones: trafficMetric(clones),
    },
    limitations: [
      "GitHub code search covers public indexed code and can lag behind repository changes.",
      "Action-reference counts include only direct-child .yml or .yaml workflow files observed among the first 100 search items.",
      "Traffic includes maintainer activity and is awareness evidence, not product adoption.",
      "Participation counts include only the first 100 records or comments in each queried connection.",
      "Discussion comments require human review before they can count as confirmed usefulness.",
      "No Action-run telemetry is collected.",
    ],
  };

  await mkdir(options.output, { recursive: true });
  await Promise.all([
    writeFile(`${options.output}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`, "utf8"),
    writeFile(`${options.output}/summary.md`, renderSummary(metrics), "utf8"),
  ]);
  process.stdout.write(renderSummary(metrics));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
