type HermesVaultPathSettings = {
	transportMode?: string;
	windowsWslMode?: boolean;
	hermesApi?: {
		vaultPathOverride?: string;
	};
};

export function convertWindowsPathToWslPath(path: string): string {
	const normalized = path.replace(/\\/g, "/");
	const match = normalized.match(/^([A-Za-z]):(\/.*)/);
	if (!match) return path;
	return `/mnt/${match[1].toLowerCase()}${match[2]}`;
}

/**
 * Resolve the working directory sent to Hermes API sessions.
 *
 * In Windows→WSL mode, Hermes runs inside WSL while Obsidian reports Windows
 * paths. Prefer an explicit canonical WSL vault path when configured so the
 * agent does not have to discover/guess `/mnt/c/Users/<name>/...` paths.
 */
export function resolveHermesApiWorkingDirectory(
	settings: HermesVaultPathSettings,
	workingDirectory: string,
): string {
	if (settings.transportMode !== "hermes-api") {
		return workingDirectory;
	}

	const override = settings.hermesApi?.vaultPathOverride?.trim();
	if (override) {
		return override;
	}

	if (settings.windowsWslMode) {
		return convertWindowsPathToWslPath(workingDirectory);
	}

	return workingDirectory;
}
