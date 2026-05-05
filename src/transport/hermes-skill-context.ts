export const HERMES_SKILL_CONTEXT_BANNER =
	"[Load these skills into context before responding — use read_file on each:]";

function normalizeSkillPath(path: string): string {
	const trimmed = path.trim().replace(/\/+$/, "");
	return trimmed.endsWith(".md") ? trimmed : `${trimmed}/SKILL.md`;
}

export function buildHermesSkillContext(raw: string): string | undefined {
	const uniquePaths: string[] = [];
	const seen = new Set<string>();

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const normalized = normalizeSkillPath(trimmed);
		if (seen.has(normalized)) continue;
		seen.add(normalized);
		uniquePaths.push(normalized);
	}

	if (uniquePaths.length === 0) return undefined;
	return [HERMES_SKILL_CONTEXT_BANNER, ...uniquePaths].join("\n");
}

export function shouldPrependHermesSkillContext(input: string, skillContext: string | undefined): boolean {
	if (!skillContext) return false;
	return !input.includes(HERMES_SKILL_CONTEXT_BANNER);
}
