import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_VERSION = 1;
const QUERY = "filename:copilot-setup-steps.yml path:.github/workflows";
const WORKFLOW_PATH = ".github/workflows/copilot-setup-steps.yml";
const METADATA_FILES = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "pyproject.toml",
  "uv.lock",
  "poetry.lock",
  "requirements.txt",
]);
const DEFAULT_EXCLUDED_REPOSITORIES = new Set(["Chinmoy-Kulkarni/setup-steps-guardian"]);

function usage() {
  return [
    "Usage: node scripts/public-workflow-study.mjs [options]",
    "",
    "Options:",
    "  --sample-size <1-1000>  Number of public workflows to validate (default: 100)",
    "  --census-pages <1-10>    Search-result pages to inspect for a public lower bound (default: 10)",
    "  --concurrency <1-10>    Concurrent GitHub/API workers (default: 5)",
    "  --output <path>         Output directory (default: .research/public-workflow-study)",
    "  --preserve-raw          Keep fetched workflows under output/raw/; never commit them",
    "  --help                  Show this help",
  ].join("\n");
}

function parsePositiveInteger(value, name, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    sampleSize: 100,
    censusPages: 10,
    concurrency: 5,
    output: resolve(".research/public-workflow-study"),
    preserveRaw: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--sample-size":
        options.sampleSize = parsePositiveInteger(argv[++index], "--sample-size", 1000);
        break;
      case "--census-pages":
        options.censusPages = parsePositiveInteger(argv[++index], "--census-pages", 10);
        break;
      case "--concurrency":
        options.concurrency = parsePositiveInteger(argv[++index], "--concurrency", 10);
        break;
      case "--output": {
        const value = argv[++index];
        if (value === undefined || value.trim().length === 0) {
          throw new Error("--output requires a non-empty path.");
        }
        options.output = resolve(value);
        break;
      }
      case "--preserve-raw":
        options.preserveRaw = true;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

export function parseGitHubOutput(content) {
  const output = {};
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) {
      continue;
    }

    const delimiterIndex = line.indexOf("<<");
    if (delimiterIndex > 0) {
      const key = line.slice(0, delimiterIndex);
      const delimiter = line.slice(delimiterIndex + 2);
      const valueLines = [];
      index += 1;
      while (index < lines.length && lines[index] !== delimiter) {
        valueLines.push(lines[index]);
        index += 1;
      }
      if (index >= lines.length) {
        throw new Error(`GitHub output ${key} is missing delimiter ${delimiter}.`);
      }
      output[key] = valueLines.join("\n");
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error(`Unrecognized GitHub output line: ${line}`);
    }
    output[line.slice(0, equalsIndex)] = line.slice(equalsIndex + 1);
  }

  return output;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function retryDelayFromMessage(body) {
  let message = body;
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed?.message === "string") {
      message = parsed.message;
    }
  } catch {
    // Non-JSON GitHub errors are still checked as plain text.
  }

  const match = message.match(
    /try again in\s+(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m)\b/i,
  );
  if (match === null) {
    return undefined;
  }

  const amount = Number.parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  if (unit.startsWith("m") && unit !== "ms" && !unit.startsWith("millisecond")) {
    return amount * 60_000;
  }
  if (unit === "ms" || unit.startsWith("millisecond")) {
    return amount;
  }
  return amount * 1000;
}

export function retryDelay(response, attempt, body, now = Date.now()) {
  const delays = [Math.min(60_000, 1000 * 2 ** attempt)];
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) {
    const seconds = Number.parseFloat(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      delays.push(seconds * 1000);
    } else {
      const retryAt = Date.parse(retryAfter);
      if (Number.isFinite(retryAt)) {
        delays.push(Math.max(0, retryAt - now));
      }
    }
  }

  const messageDelay = retryDelayFromMessage(body);
  if (messageDelay !== undefined) {
    delays.push(messageDelay);
  }

  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number.parseInt(response.headers.get("x-ratelimit-reset") ?? "", 10);
    if (Number.isSafeInteger(reset)) {
      delays.push(Math.max(0, reset * 1000 - now));
    }
  }

  return Math.ceil(Math.max(...delays)) + 1000;
}

export function isRetryableGitHubResponse(response, body) {
  return (
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        /secondary rate limit|abuse detection|try again in/i.test(body)))
  );
}

function createGitHubClient(token) {
  const apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "SetupStepsGuardian-public-workflow-study",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  async function request(url, options = {}) {
    const target = url.startsWith("https://") ? url : `${apiBase}${url}`;
    let lastError;
    const maximumAttempts = 8;

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      let response;
      try {
        response = await fetch(target, {
          headers: {
            ...headers,
            ...(options.accept === undefined ? {} : { Accept: options.accept }),
          },
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        lastError = error;
        if (attempt === maximumAttempts - 1) {
          break;
        }
        const waitMilliseconds = Math.min(60_000, 1000 * 2 ** attempt);
        process.stderr.write(
          `GitHub request failed before a response; retrying in ${waitMilliseconds}ms.\n`,
        );
        await delay(waitMilliseconds);
        continue;
      }

      if (response.ok) {
        return options.raw === true ? response.text() : response.json();
      }

      const body = await response.text();
      const responseError = new Error(
        `GitHub API ${response.status} for ${target}: ${body.slice(0, 300)}`,
      );
      if (!isRetryableGitHubResponse(response, body) || attempt === maximumAttempts - 1) {
        throw responseError;
      }

      lastError = responseError;
      const waitMilliseconds = retryDelay(response, attempt, body);
      process.stderr.write(
        `GitHub API ${response.status} (${response.headers.get("x-ratelimit-resource") ?? "unknown"}); retrying in ${waitMilliseconds}ms.\n`,
      );
      await delay(waitMilliseconds);
    }

    throw lastError instanceof Error ? lastError : new Error(`GitHub request failed: ${target}`);
  }

  return { request };
}

export function isEligiblePublicSearchItem(item) {
  return (
    item?.repository?.private === false &&
    typeof item.repository.full_name === "string" &&
    item.path === WORKFLOW_PATH &&
    typeof item.url === "string" &&
    typeof item.html_url === "string" &&
    typeof item.sha === "string"
  );
}

async function fetchSearchSample(client, sampleSize, censusPages) {
  const selected = [];
  const selectedKeys = new Set();
  const observedPublicKeys = new Set();
  let incompleteResults = false;
  let discardedNonExactPaths = 0;
  let pagesInspected = 0;

  for (let page = 1; page <= censusPages; page += 1) {
    const url = new URL("/search/code", "https://api.github.com");
    url.searchParams.set("q", QUERY);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    const response = await client.request(`${url.pathname}${url.search}`);

    if (!Array.isArray(response.items)) {
      throw new Error("GitHub code search returned no items array.");
    }
    pagesInspected = page;
    incompleteResults ||= response.incomplete_results === true;

    for (const item of response.items) {
      if (item.repository?.private !== false) {
        continue;
      }
      if (item.path !== WORKFLOW_PATH) {
        discardedNonExactPaths += 1;
        continue;
      }
      if (!isEligiblePublicSearchItem(item)) {
        continue;
      }
      const fullName = item.repository.full_name;
      if (DEFAULT_EXCLUDED_REPOSITORIES.has(fullName)) {
        continue;
      }

      const key = `${fullName}:${item.path}:${item.sha}`;
      observedPublicKeys.add(key);
      if (selected.length >= sampleSize || selectedKeys.has(key)) {
        continue;
      }
      selectedKeys.add(key);
      selected.push({
        repository: fullName,
        path: item.path,
        fileSha: item.sha,
        apiUrl: item.url,
        htmlUrl: item.html_url,
      });
    }

    if (response.items.length < 100) {
      break;
    }
    if (page < censusPages) {
      await delay(6500);
    }
  }

  if (selected.length < sampleSize) {
    throw new Error(
      `Only ${selected.length} public exact-path workflows were found in ${pagesInspected} search pages; ${sampleSize} were requested.`,
    );
  }

  return {
    publicExactObserved: observedPublicKeys.size,
    pagesInspected,
    incompleteResults,
    discardedNonExactPaths,
    selected,
  };
}

function commitRefFromApiUrl(apiUrl) {
  const ref = new URL(apiUrl).searchParams.get("ref");
  if (ref === null || !/^[0-9a-f]{40}$/i.test(ref)) {
    throw new Error(`Search result URL has no immutable commit ref: ${apiUrl}`);
  }
  return ref;
}

async function runCommand(command, args, options) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", rejectCommand);
    child.once("close", (code, signal) => {
      resolveCommand({ code, signal, stdout, stderr });
    });
  });
}

async function validateWorkflow(bundlePath, workflowContent, metadataFiles) {
  const workspace = await mkdtemp(join(tmpdir(), "setup-steps-guardian-study-"));
  const outputPath = join(workspace, "github-output.txt");
  const summaryPath = join(workspace, "github-summary.md");

  try {
    await mkdir(join(workspace, ".github", "workflows"), { recursive: true });
    await writeFile(join(workspace, WORKFLOW_PATH), workflowContent, "utf8");
    await writeFile(outputPath, "", "utf8");
    await writeFile(summaryPath, "", "utf8");
    await Promise.all(
      metadataFiles.map((name) => writeFile(join(workspace, name), "present\n", "utf8")),
    );

    const execution = await runCommand(process.execPath, [bundlePath], {
      cwd: workspace,
      env: {
        ...process.env,
        GITHUB_ACTIONS: "true",
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_WORKSPACE: workspace,
        "INPUT_WORKFLOW-PATH": WORKFLOW_PATH,
        "INPUT_POLICY-PATH": ".github/agent-setup-policy.yml",
        "INPUT_FAIL-ON-WARNINGS": "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const actionOutput = parseGitHubOutput(await readFile(outputPath, "utf8"));
    if (typeof actionOutput["result-json"] !== "string") {
      throw new Error(
        `Validator did not emit result-json. Exit ${execution.code}; stderr: ${execution.stderr.slice(0, 300)}`,
      );
    }

    return {
      exitCode: execution.code,
      result: JSON.parse(actionOutput["result-json"]),
    };
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function processItem(client, bundlePath, item, options) {
  const ref = commitRefFromApiUrl(item.apiUrl);
  try {
    const [workflowContent, rootListing] = await Promise.all([
      client.request(item.apiUrl, {
        accept: "application/vnd.github.raw+json",
        raw: true,
      }),
      client.request(`/repos/${item.repository}/contents?ref=${encodeURIComponent(ref)}`),
    ]);
    if (!Array.isArray(rootListing)) {
      throw new Error("Repository root response is not a directory listing.");
    }

    const metadataFiles = rootListing
      .map((entry) => entry?.name)
      .filter((name) => typeof name === "string" && METADATA_FILES.has(name))
      .sort();
    const validation = await validateWorkflow(bundlePath, workflowContent, metadataFiles);

    if (options.preserveRaw) {
      const rawName = `${item.repository.replaceAll("/", "__")}__${ref}.yml`;
      await writeFile(join(options.output, "raw", rawName), workflowContent, "utf8");
    }

    return {
      ...item,
      ref,
      metadataFiles,
      validatorExitCode: validation.exitCode,
      status: "validated",
      validation: sanitizeValidationResult(validation.result),
    };
  } catch (error) {
    return {
      ...item,
      ref,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown record failure",
    };
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  return results;
}

export function aggregateRecords(records) {
  const validated = records.filter((record) => record.status === "validated");
  const failed = records.filter((record) => record.status === "failed");
  const findingCounts = new Map();

  for (const record of validated) {
    const seenCodes = new Set();
    for (const finding of record.validation.findings) {
      const current = findingCounts.get(finding.code) ?? {
        code: finding.code,
        severity: finding.severity,
        occurrences: 0,
        workflows: 0,
      };
      current.occurrences += 1;
      if (!seenCodes.has(finding.code)) {
        current.workflows += 1;
        seenCodes.add(finding.code);
      }
      findingCounts.set(finding.code, current);
    }
  }

  return {
    attempted: records.length,
    validated: validated.length,
    failed: failed.length,
    valid: validated.filter((record) => record.validation.status === "valid").length,
    invalid: validated.filter((record) => record.validation.status === "invalid").length,
    withWarnings: validated.filter((record) =>
      record.validation.findings.some((finding) => finding.severity === "warning"),
    ).length,
    findingCounts: [...findingCounts.values()].sort(
      (left, right) => right.workflows - left.workflows || left.code.localeCompare(right.code),
    ),
  };
}

export function sanitizeValidationResult(result) {
  return {
    schemaVersion: result.schemaVersion,
    status: result.status,
    workflowPath: result.workflowPath,
    ...(typeof result.workflowHash === "string" ? { workflowHash: result.workflowHash } : {}),
    ...(typeof result.policyHash === "string" ? { policyHash: result.policyHash } : {}),
    findings: Array.isArray(result.findings)
      ? result.findings.map((finding) => ({
          code: finding.code,
          severity: finding.severity,
          path: finding.path,
          ...(Number.isSafeInteger(finding.line) ? { line: finding.line } : {}),
          ...(typeof finding.documentationUrl === "string"
            ? { documentationUrl: finding.documentationUrl }
            : {}),
        }))
      : [],
    patchCount: Array.isArray(result.patches) ? result.patches.length : 0,
  };
}

function percentage(numerator, denominator) {
  if (denominator === 0) {
    return "0.0%";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function renderSummary(study) {
  const aggregate = study.aggregate;
  const validPercentage = percentage(aggregate.valid, aggregate.validated);
  const invalidPercentage = percentage(aggregate.invalid, aggregate.validated);
  const warningPercentage = percentage(aggregate.withWarnings, aggregate.validated);
  const findingRows = aggregate.findingCounts
    .map(
      (finding) =>
        `| \`${finding.code}\` | ${finding.severity} | ${finding.workflows} | ${percentage(
          finding.workflows,
          aggregate.validated,
        )} |`,
    )
    .join("\n");

  return `# Public Copilot setup workflow study

Generated: ${study.generatedAt}

## Census

- GitHub code-search query: \`${study.query}\`
- Public exact-path workflows directly observed: **${study.search.publicExactObserved}**
- Search-result pages inspected: **${study.search.pagesInspected}**
- Search marked incomplete: **${study.search.incompleteResults ? "yes" : "no"}**
- Non-exact suffix paths discarded while selecting the sample: **${study.search.discardedNonExactPaths}**

## Convenience sample

- Requested: ${study.sample.requested}
- Attempted: ${aggregate.attempted}
- Validated: ${aggregate.validated}
- Fetch or execution failures: ${aggregate.failed}
- Valid under the default SetupStepsGuardian policy: ${aggregate.valid} (${validPercentage})
- Invalid under the default policy: ${aggregate.invalid} (${invalidPercentage})
- At least one warning: ${aggregate.withWarnings} (${warningPercentage})

| Finding | Default severity | Workflows | Share of validated sample |
| --- | --- | ---: | ---: |
${findingRows}

## Method and limits

- The GitHub query can also match suffix variants such as \`.yml.example\` or \`.yml.disabled\`, so
  they are excluded from both the observed count and sample.
- Only results explicitly marked public by GitHub are eligible. The observed count is a lower
  bound from the inspected pages, not GitHub's total count for the authenticated query.
- The sample keeps only the exact \`${WORKFLOW_PATH}\` path from the first unique public results
  after excluding this repository. It is a convenience sample, not a random or statistically
  representative sample.
- GitHub code search may omit unindexed, deleted, or otherwise unavailable public repositories.
- Each workflow was fetched at the immutable commit SHA returned by GitHub search.
- Root package-manager filenames were detected at that same commit. Third-party workflow source
  is not included in this report.
- Validation used the repository's committed Node 24 Action bundle with its default policy.
- A finding count is evidence that the rule triggered, not proof that every maintainer would choose
  the same policy. Human review is required before treating aggregate findings as confirmed defects.
`;
}

async function sha256File(path) {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token.length === 0) {
    throw new Error("GITHUB_TOKEN is required for GitHub code search.");
  }

  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const bundlePath = join(repositoryRoot, "packages", "action", "dist", "index.cjs");
  await mkdir(options.output, { recursive: true });
  if (options.preserveRaw) {
    await mkdir(join(options.output, "raw"), { recursive: true });
  }

  const startedAt = new Date().toISOString();
  const client = createGitHubClient(token);
  const search = await fetchSearchSample(client, options.sampleSize, options.censusPages);
  const records = await runPool(search.selected, options.concurrency, (item, index) => {
    process.stderr.write(
      `[${index + 1}/${search.selected.length}] ${item.repository}/${item.path}\n`,
    );
    return processItem(client, bundlePath, item, options);
  });
  const generatedAt = new Date().toISOString();
  const study = {
    schemaVersion: 1,
    scriptVersion: SCRIPT_VERSION,
    generatedAt,
    startedAt,
    query: QUERY,
    validator: {
      bundlePath: "packages/action/dist/index.cjs",
      bundleSha256: await sha256File(bundlePath),
    },
    search: {
      publicExactObserved: search.publicExactObserved,
      pagesInspected: search.pagesInspected,
      incompleteResults: search.incompleteResults,
      discardedNonExactPaths: search.discardedNonExactPaths,
    },
    sample: {
      requested: options.sampleSize,
      selection:
        "First unique public exact-path GitHub code-search results after excluding the SetupStepsGuardian repository.",
      rawPreserved: options.preserveRaw,
    },
    aggregate: aggregateRecords(records),
    records,
  };

  await Promise.all([
    writeFile(join(options.output, "study.json"), `${JSON.stringify(study, null, 2)}\n`, "utf8"),
    writeFile(join(options.output, "summary.md"), renderSummary(study), "utf8"),
  ]);
  process.stdout.write(`${renderSummary(study)}\n`);
}

const isEntryPoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
