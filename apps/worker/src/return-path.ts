function containsUnsafeWhitespaceOrControl(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      /\s/u.test(character) ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

function decodedVariants(value: string): readonly string[] | null {
  const variants = [value];
  let current = value;

  try {
    for (let depth = 0; depth < 3; depth += 1) {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      variants.push(decoded);
      current = decoded;
    }
  } catch {
    return null;
  }

  return variants;
}

function hasSafeRelativeShape(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !containsUnsafeWhitespaceOrControl(value)
  );
}

export function isSafeReturnPath(value: string): boolean {
  const variants = decodedVariants(value);
  if (variants === null) {
    return false;
  }

  const validationBase = new URL("https://return-path.invalid");
  try {
    return variants.every((candidate) => {
      if (!hasSafeRelativeShape(candidate)) {
        return false;
      }
      const resolved = new URL(candidate, validationBase);
      return (
        resolved.origin === validationBase.origin &&
        hasSafeRelativeShape(`${resolved.pathname}${resolved.search}${resolved.hash}`)
      );
    });
  } catch {
    return false;
  }
}

export function canonicalizeReturnPath(value: string | null, appUrl: string): string {
  if (value === null || !isSafeReturnPath(value)) {
    return "/";
  }

  const productUrl = new URL(appUrl);
  const resolved = new URL(value, productUrl);
  if (resolved.origin !== productUrl.origin) {
    return "/";
  }

  const canonicalPath = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return isSafeReturnPath(canonicalPath) ? canonicalPath : "/";
}
