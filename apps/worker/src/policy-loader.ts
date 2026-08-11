import type { AccountPolicy } from "@setup-fleet/data";
import {
  DEFAULT_POLICY,
  type Policy,
  parsePolicy,
  parseYamlDocument,
  sha256,
  stableStringify,
  YamlParseError,
} from "@setup-fleet/policy-engine";
import { ZodError } from "zod";
import type { RepositoryReader } from "./scan-repository.js";

const POLICY_REPOSITORY = ".github";
const POLICY_PATH = ".github/agent-setup-policy.yml";

export interface LoadedAccountPolicy {
  readonly validationContent: string;
  readonly policy: Policy | null;
  readonly policyHash: string;
  readonly source: "versioned" | "persisted" | "default";
}

function policyFromRecord(record: AccountPolicy): Policy {
  return {
    schemaVersion: 1,
    allowedRunners: [...record.allowedRunners],
    maxTimeoutMinutes: record.maxTimeoutMinutes,
    requireTimeout: record.requireTimeout,
    requireExplicitPermissions: record.requireExplicitPermissions,
    requireWorkflowDispatch: record.requireWorkflowDispatch,
    actionPinning: record.actionPinning,
    secretUsage: record.secretUsage,
    unsupportedJobKeys: record.unsupportedJobKeys,
  };
}

export async function loadAccountPolicy(input: {
  readonly reader: RepositoryReader;
  readonly owner: string;
  readonly persisted: AccountPolicy | null;
}): Promise<LoadedAccountPolicy> {
  const versionedContent = await input.reader.getFileContent({
    owner: input.owner,
    repository: POLICY_REPOSITORY,
    path: POLICY_PATH,
  });

  if (versionedContent !== null) {
    let policy: Policy;
    try {
      policy = parsePolicy(parseYamlDocument(versionedContent));
    } catch (error) {
      if (error instanceof YamlParseError || error instanceof ZodError) {
        return {
          validationContent: versionedContent,
          policy: null,
          policyHash: await sha256(versionedContent),
          source: "versioned",
        };
      }
      throw error;
    }

    return {
      validationContent: versionedContent,
      policy,
      policyHash: await sha256(stableStringify(policy)),
      source: "versioned",
    };
  }

  if (input.persisted !== null) {
    const policy = policyFromRecord(input.persisted);
    const policyHash = await sha256(stableStringify(policy));
    if (policyHash !== input.persisted.policyHash) {
      throw new Error("Persisted account policy hash does not match its fields.");
    }

    return {
      validationContent: JSON.stringify(policy),
      policy,
      policyHash,
      source: "persisted",
    };
  }

  return {
    validationContent: JSON.stringify(DEFAULT_POLICY),
    policy: DEFAULT_POLICY,
    policyHash: await sha256(stableStringify(DEFAULT_POLICY)),
    source: "default",
  };
}
