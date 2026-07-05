import type { InstalledSkill } from "@/lib/api/skills";

export function mergeImportedSkills(
  existing: InstalledSkill[] | undefined,
  imported: InstalledSkill[],
): InstalledSkill[] {
  if (!existing) return imported;
  if (imported.length === 0) return existing;
  const importedIds = new Set(imported.map((s) => s.id));
  const preserved = existing.filter((s) => !importedIds.has(s.id));
  return [...preserved, ...imported];
}
