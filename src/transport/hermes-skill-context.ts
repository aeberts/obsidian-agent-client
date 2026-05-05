export const HERMES_SKILL_CONTEXT_BANNER =
	"[Load these skills into context before responding — use read_file on each:]";

export type HermesSkillLoadState = {
	loadedSkillKeys: Set<string>;
};

export type PreparedHermesSkillContextInput = {
	input: string;
	loadedCount: number;
	skippedCount: number;
};

type SkillRef = {
	key: string;
	displayPath: string;
};

export function createHermesSkillLoadState(): HermesSkillLoadState {
	return { loadedSkillKeys: new Set<string>() };
}

function normalizeSkillPath(path: string): string {
	const trimmed = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");
	if (!trimmed) return "";
	return trimmed.endsWith(".md") ? trimmed : `${trimmed}/SKILL.md`;
}

function stripSkillMd(input: string): string {
	return input.replace(/\/SKILL\.md$/i, "").replace(/\/+$/, "");
}

/**
 * Collapse equivalent skill references to a stable comparison key.
 *
 * Examples that all normalize to `obsidian`:
 * - obsidian
 * - /home/zand/.hermes/skills/obsidian/obsidian/SKILL.md
 * - ./skills/obsidian/obsidian/SKILL.md
 */
export function normalizeHermesSkillKey(input: string): string {
	const trimmed = input.trim().replace(/\\/g, "/").replace(/\/+$/, "");
	if (!trimmed) return "";
	const withoutSkillMd = stripSkillMd(trimmed);
	const parts = withoutSkillMd.split("/").filter(Boolean);
	return (parts.at(-1) ?? withoutSkillMd).toLowerCase();
}

function parseSkillRefs(raw: string): SkillRef[] {
	const refs: SkillRef[] = [];
	const seen = new Set<string>();

	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed === HERMES_SKILL_CONTEXT_BANNER) continue;

		const key = normalizeHermesSkillKey(trimmed);
		if (!key || seen.has(key)) continue;

		seen.add(key);
		refs.push({
			key,
			displayPath: trimmed.includes("/") || trimmed.endsWith(".md") ? normalizeSkillPath(trimmed) : trimmed,
		});
	}

	return refs;
}

export function buildHermesSkillContext(raw: string): string | undefined {
	const uniqueRefs = parseSkillRefs(raw);
	if (uniqueRefs.length === 0) return undefined;
	return [HERMES_SKILL_CONTEXT_BANNER, ...uniqueRefs.map((ref) => ref.displayPath)].join("\n");
}

export function shouldPrependHermesSkillContext(input: string, skillContext: string | undefined): boolean {
	if (!skillContext) return false;
	return !input.includes(HERMES_SKILL_CONTEXT_BANNER);
}

function collectContextSkillBlocks(input: string): { skillRefs: SkillRef[]; strippedInput: string } {
	const lines = input.split("\n");
	const outputLines: string[] = [];
	const skillRefs: SkillRef[] = [];
	let index = 0;

	while (index < lines.length) {
		if (lines[index].trim() !== HERMES_SKILL_CONTEXT_BANNER) {
			outputLines.push(lines[index]);
			index += 1;
			continue;
		}

		index += 1;
		const blockLines: string[] = [];
		while (index < lines.length && lines[index].trim() !== "") {
			blockLines.push(lines[index]);
			index += 1;
		}
		skillRefs.push(...parseSkillRefs(blockLines.join("\n")));

		// Drop one blank line that separated the skill banner from the user prompt.
		if (index < lines.length && lines[index].trim() === "") {
			index += 1;
		}
	}

	return { skillRefs, strippedInput: outputLines.join("\n").trim() };
}

/**
 * Apply session-scoped skill loading to configured skills plus any skill-load
 * banners already present in the outgoing prompt.
 *
 * The function removes all existing skill banners from the input, prepends a
 * single banner containing only skills not yet loaded in this session, and marks
 * those skills loaded immediately. State is intentionally in-memory only.
 */
export function prepareHermesSkillContextInput(
	input: string,
	configuredSkillsRaw: string,
	state: HermesSkillLoadState,
): PreparedHermesSkillContextInput {
	const configuredRefs = parseSkillRefs(configuredSkillsRaw);
	const { skillRefs: contextRefs, strippedInput } = collectContextSkillBlocks(input);
	const requestedRefs = [...configuredRefs, ...contextRefs];
	const seenRequestedKeys = new Set<string>();
	const missingRefs: SkillRef[] = [];
	let skippedCount = 0;

	for (const ref of requestedRefs) {
		if (seenRequestedKeys.has(ref.key)) {
			skippedCount += 1;
			continue;
		}
		seenRequestedKeys.add(ref.key);

		if (state.loadedSkillKeys.has(ref.key)) {
			skippedCount += 1;
			continue;
		}

		missingRefs.push(ref);
	}

	for (const ref of missingRefs) {
		state.loadedSkillKeys.add(ref.key);
	}

	if (missingRefs.length === 0) {
		return { input: strippedInput, loadedCount: 0, skippedCount };
	}

	return {
		input: [
			HERMES_SKILL_CONTEXT_BANNER,
			...missingRefs.map((ref) => ref.displayPath),
			"",
			strippedInput,
		].join("\n"),
		loadedCount: missingRefs.length,
		skippedCount,
	};
}
