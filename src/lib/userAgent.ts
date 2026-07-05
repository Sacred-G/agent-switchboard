export function isValidUserAgentHeader(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  // eslint-disable-next-line no-control-regex
  return !/[\x00-\x08\x0a-\x1f\x7f]/.test(trimmed);
}
