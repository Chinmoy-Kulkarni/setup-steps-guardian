import { z } from "zod";

const ConfigurableSeveritySchema = z.enum(["off", "warning", "error"]);

export const PolicySchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    allowedRunners: z.array(z.string().min(1)).min(1).default(["ubuntu-latest", "windows-latest"]),
    maxTimeoutMinutes: z.number().int().min(1).max(59).default(59),
    requireTimeout: z.boolean().default(true),
    requireExplicitPermissions: z.boolean().default(true),
    requireWorkflowDispatch: z.boolean().default(true),
    actionPinning: ConfigurableSeveritySchema.default("warning"),
    secretUsage: ConfigurableSeveritySchema.default("warning"),
    unsupportedJobKeys: ConfigurableSeveritySchema.default("warning"),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;
export type ConfigurableSeverity = z.infer<typeof ConfigurableSeveritySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({});

export function parsePolicy(value: unknown): Policy {
  return PolicySchema.parse(value);
}
