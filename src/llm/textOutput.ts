export function normalizeAssistantText(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
