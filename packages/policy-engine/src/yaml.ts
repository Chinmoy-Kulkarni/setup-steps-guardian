import { parseDocument } from "yaml";

export class YamlParseError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = "YamlParseError";
    this.issues = issues;
  }
}

export function parseYamlDocument(content: string): unknown {
  const document = parseDocument(content, {
    merge: false,
    schema: "core",
    uniqueKeys: true,
  });

  const issues = [...document.errors, ...document.warnings].map((issue) => issue.message);
  if (document.errors.length > 0) {
    throw new YamlParseError("YAML could not be parsed safely.", issues);
  }

  return document.toJS({
    maxAliasCount: 0,
    mapAsMap: false,
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
