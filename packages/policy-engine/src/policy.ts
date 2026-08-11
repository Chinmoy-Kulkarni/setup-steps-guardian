import { z } from "zod";

const ConfigurableSeveritySchema = z.enum(["off", "warning", "error"]);
const RUNNER_GROUP_PREFIX = "group:";

const AllowedRunnerSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (entry) => !entry.startsWith(RUNNER_GROUP_PREFIX) || entry.length > RUNNER_GROUP_PREFIX.length,
    `Runner groups must use ${RUNNER_GROUP_PREFIX}<name>.`,
  );

export const PolicySchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    allowedRunners: z.array(AllowedRunnerSchema).min(1).default(["*"]),
    maxTimeoutMinutes: z.number().int().min(1).max(59).default(59),
    requireTimeout: z.boolean().default(false),
    requireExplicitPermissions: z.boolean().default(false),
    requireWorkflowDispatch: z.boolean().default(false),
    actionPinning: ConfigurableSeveritySchema.default("warning"),
    secretUsage: ConfigurableSeveritySchema.default("warning"),
    unsupportedJobKeys: ConfigurableSeveritySchema.default("warning"),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;
export type ConfigurableSeverity = z.infer<typeof ConfigurableSeveritySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({});

export function parseAllowedRunnerEntry(entry: string): {
  readonly kind: "group" | "label";
  readonly value: string;
} {
  return entry.startsWith(RUNNER_GROUP_PREFIX)
    ? { kind: "group", value: entry.slice(RUNNER_GROUP_PREFIX.length) }
    : { kind: "label", value: entry };
}

export function parsePolicy(value: unknown): Policy {
  return PolicySchema.parse(value);
}
