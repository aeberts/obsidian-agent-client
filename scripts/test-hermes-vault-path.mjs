import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

const root = process.cwd();
const entry = path.join(root, "src/utils/hermes-vault-path.ts");
const outdir = await mkdtemp(path.join(tmpdir(), "hermes-vault-path-"));
const outfile = path.join(outdir, "hermes-vault-path.mjs");

try {
	await esbuild.build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		format: "esm",
		platform: "node",
		logLevel: "silent",
	});

	const { resolveHermesApiWorkingDirectory } = await import(pathToFileURL(outfile));

	assert.equal(
		resolveHermesApiWorkingDirectory(
			{
				transportMode: "hermes-api",
				windowsWslMode: true,
				hermesApi: { vaultPathOverride: "/mnt/c/Users/alexe/Dropbox/Hermes/Hermes" },
			},
			"C:\\Users\\zand\\Dropbox\\Hermes\\Hermes",
		),
		"/mnt/c/Users/alexe/Dropbox/Hermes/Hermes",
		"Hermes API should prefer the configured canonical WSL vault path over guessed Windows-user paths",
	);

	assert.equal(
		resolveHermesApiWorkingDirectory(
			{
				transportMode: "hermes-api",
				windowsWslMode: true,
				hermesApi: { vaultPathOverride: "" },
			},
			"C:\\Users\\alexe\\Dropbox\\Hermes\\Hermes",
		),
		"/mnt/c/Users/alexe/Dropbox/Hermes/Hermes",
		"Hermes API should convert Windows vault paths to WSL paths when no override is set",
	);

	assert.equal(
		resolveHermesApiWorkingDirectory(
			{
				transportMode: "acp",
				windowsWslMode: true,
				hermesApi: { vaultPathOverride: "/mnt/c/Users/alexe/Dropbox/Hermes/Hermes" },
			},
			"C:\\Users\\alexe\\Dropbox\\Hermes\\Hermes",
		),
		"C:\\Users\\alexe\\Dropbox\\Hermes\\Hermes",
		"ACP transport should keep existing working-directory behavior",
	);
} finally {
	await rm(outdir, { recursive: true, force: true });
}
