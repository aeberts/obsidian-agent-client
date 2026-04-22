import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from "obsidian";
import type AgentClientPlugin from "../plugin";
import { getLogger } from "../utils/logger";
import type {
	AgentCapabilities,
	InitializeResult,
	ListSessionsResult,
	SessionConfigOption,
	SessionInfo,
	SessionResult,
	SessionUpdate,
} from "../types/session";
import type { PromptContent } from "../types/chat";
import type { AgentConfig, IAgentTransport, TerminalOutputResult } from "../types/transport";
import type { SlashCommand } from "../types/session";

interface HermesSessionState {
	sessionId: string;
	cwd: string;
	updatedAt: string;
	title?: string;
	configOptions?: SessionConfigOption[];
}

export class HermesApiTransport implements IAgentTransport {
	private plugin: AgentClientPlugin;
	private logger = getLogger();
	private initialized = false;
	private currentAgentId: string | null = null;
	private apiBase = "http://127.0.0.1:8642";
	private apiKey = "";
	private defaultModel = "gpt-5.3-codex";
	private sessionStates = new Map<string, HermesSessionState>();
	private callbacks = new Set<(update: SessionUpdate) => void>();

	constructor(plugin: AgentClientPlugin) {
		this.plugin = plugin;
	}

	async initialize(config: AgentConfig): Promise<InitializeResult> {
		this.apiBase = (config.env?.HERMES_API_BASE || "http://127.0.0.1:8642").replace(/\/$/, "");
		this.apiKey =
			config.env?.HERMES_API_KEY ||
			config.env?.API_SERVER_KEY ||
			config.env?.OPENAI_API_KEY ||
			"";
		this.defaultModel = config.env?.HERMES_MODEL || "gpt-5.3-codex";
		this.currentAgentId = config.id;
		this.initialized = true;

		const agentCapabilities: AgentCapabilities = {
			loadSession: true,
			sessionCapabilities: {
				resume: {},
				fork: {},
				list: {},
			},
			promptCapabilities: {
				embeddedContext: false,
				image: false,
			},
		};

		return {
			authMethods: [],
			protocolVersion: 1,
			promptCapabilities: agentCapabilities.promptCapabilities,
			agentCapabilities,
			agentInfo: {
				name: "hermes-api",
				title: "Hermes API",
				version: "0.1",
			},
		};
	}

	async newSession(workingDirectory: string): Promise<SessionResult> {
		this.ensureInitialized();
		const sessionId = `hermes-${crypto.randomUUID()}`;
		const state: HermesSessionState = {
			sessionId,
			cwd: workingDirectory,
			updatedAt: new Date().toISOString(),
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: this.defaultModel,
					options: [{ value: this.defaultModel, name: this.defaultModel }],
				},
			],
		};
		this.sessionStates.set(sessionId, state);
		void this.fetchAndEmitGatewayCommands(sessionId);
		return {
			sessionId,
			configOptions: state.configOptions,
		};
	}

	async authenticate(_methodId: string): Promise<boolean> {
		return true;
	}

	async sendPrompt(sessionId: string, content: PromptContent[]): Promise<void> {
		this.ensureInitialized();
		const state = this.getSessionState(sessionId);
		if (!this.apiKey) {
			throw { code: -32000, message: "Hermes API key is not configured" };
		}

		const input = this.flattenPromptContent(content);
		const model = this.getSessionModel(state) || this.defaultModel;
		this.logger.log(
			`[HermesApiTransport] sendPrompt start session=${sessionId} model=${model} inputChars=${input.length}`,
		);

		const payload = await this.requestJson("/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model,
				conversation: sessionId,
				input,
			}),
		});

		const outputText = this.extractOutputText(payload);
		this.logger.log(
			`[HermesApiTransport] sendPrompt response session=${sessionId} outputChars=${outputText.length}`,
		);
		if (outputText.length > 0) {
			const chunks = this.chunkText(outputText, 140);
			this.logger.log(
				`[HermesApiTransport] emitting ${chunks.length} chunk(s) for session=${sessionId}`,
			);
			for (const chunk of chunks) {
				this.emit({
					type: "agent_message_chunk",
					sessionId,
					text: chunk,
				});
			}
		} else {
			this.logger.warn(
				`[HermesApiTransport] empty output_text for session=${sessionId}; payload keys=${Object.keys(payload).join(",")}`,
			);
		}

		const usage = payload.usage as
			| { input_tokens?: number; output_tokens?: number; total_tokens?: number }
			| undefined;
		if (usage?.total_tokens) {
			this.emit({
				type: "usage_update",
				sessionId,
				size: usage.total_tokens,
				used: usage.total_tokens,
			});
		}

		state.updatedAt = new Date().toISOString();
	}

	async cancel(_sessionId: string): Promise<void> {
		// No server-side cancellation endpoint currently wired for /v1/responses.
	}

	async disconnect(): Promise<void> {
		this.initialized = false;
		this.currentAgentId = null;
	}

	isInitialized(): boolean {
		return this.initialized;
	}

	getCurrentAgentId(): string | null {
		return this.currentAgentId;
	}

	async setSessionMode(sessionId: string, modeId: string): Promise<void> {
		this.emit({ type: "current_mode_update", sessionId, currentModeId: modeId });
	}

	async setSessionModel(sessionId: string, modelId: string): Promise<void> {
		const state = this.getSessionState(sessionId);
		state.configOptions = this.upsertModelConfigOption(state.configOptions, modelId);
		this.emit({
			type: "config_option_update",
			sessionId,
			configOptions: state.configOptions,
		});
	}

	async setSessionConfigOption(
		sessionId: string,
		configId: string,
		value: string,
	): Promise<SessionConfigOption[]> {
		const state = this.getSessionState(sessionId);
		if (configId === "model") {
			state.configOptions = this.upsertModelConfigOption(state.configOptions, value);
		} else {
			state.configOptions = this.upsertGenericConfigOption(
				state.configOptions,
				configId,
				value,
			);
		}
		this.emit({
			type: "config_option_update",
			sessionId,
			configOptions: state.configOptions,
		});
		return state.configOptions;
	}

	onSessionUpdate(callback: (update: SessionUpdate) => void): () => void {
		this.callbacks.add(callback);
		return () => this.callbacks.delete(callback);
	}

	async respondToPermission(_requestId: string, _optionId: string): Promise<void> {
		// Hermes API transport currently does not expose ACP-style permission flows.
	}

	async getTerminalOutput(_terminalId: string): Promise<TerminalOutputResult> {
		return {
			output: "",
			truncated: false,
			exitStatus: null,
		};
	}

	async listSessions(cwd?: string, _cursor?: string): Promise<ListSessionsResult> {
		const sessions = Array.from(this.sessionStates.values())
			.filter((s) => !cwd || s.cwd === cwd)
			.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
			.map(
				(s): SessionInfo => ({
					sessionId: s.sessionId,
					cwd: s.cwd,
					title: s.title,
					updatedAt: s.updatedAt,
				}),
			);
		return { sessions };
	}

	async loadSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const state = this.getSessionState(sessionId, cwd);
		void this.fetchAndEmitGatewayCommands(state.sessionId);
		return { sessionId: state.sessionId, configOptions: state.configOptions };
	}

	async resumeSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const state = this.getSessionState(sessionId, cwd);
		void this.fetchAndEmitGatewayCommands(state.sessionId);
		return { sessionId: state.sessionId, configOptions: state.configOptions };
	}

	async forkSession(sessionId: string, cwd: string): Promise<SessionResult> {
		const parent = this.getSessionState(sessionId, cwd);
		const newSessionId = `hermes-${crypto.randomUUID()}`;
		const forked: HermesSessionState = {
			sessionId: newSessionId,
			cwd,
			title: parent.title,
			updatedAt: new Date().toISOString(),
			configOptions: parent.configOptions,
		};
		this.sessionStates.set(newSessionId, forked);
		return { sessionId: newSessionId, configOptions: forked.configOptions };
	}

	private flattenPromptContent(content: PromptContent[]): string {
		return content
			.map((block) => {
				if (block.type === "text") return block.text;
				if (block.type === "resource") {
					return block.resource?.text || "";
				}
				if (block.type === "resource_link") {
					return `[resource:${block.name || block.uri}] ${block.uri}`;
				}
				if (block.type === "image") {
					return "[image omitted]";
				}
				return "";
			})
			.filter((x) => x.length > 0)
			.join("\n\n");
	}

	private extractOutputText(payload: Record<string, unknown>): string {
		const output = payload.output as Array<Record<string, unknown>> | undefined;
		if (!Array.isArray(output)) return "";
		const textParts: string[] = [];
		for (const item of output) {
			if (item.type !== "message") continue;
			const content = item.content as Array<Record<string, unknown>> | undefined;
			if (!Array.isArray(content)) continue;
			for (const c of content) {
				if (c.type === "output_text" && typeof c.text === "string") {
					textParts.push(c.text);
				}
			}
		}
		return textParts.join("\n").trim();
	}

	private chunkText(text: string, chunkSize: number): string[] {
		if (text.length <= chunkSize) return [text];
		const chunks: string[] = [];
		for (let i = 0; i < text.length; i += chunkSize) {
			chunks.push(text.slice(i, i + chunkSize));
		}
		return chunks;
	}

	private getSessionState(sessionId: string, cwd?: string): HermesSessionState {
		const existing = this.sessionStates.get(sessionId);
		if (existing) return existing;
		if (cwd) {
			const state: HermesSessionState = {
				sessionId,
				cwd,
				updatedAt: new Date().toISOString(),
				configOptions: [
					{
						id: "model",
						name: "Model",
						category: "model",
						type: "select",
						currentValue: this.defaultModel,
						options: [{ value: this.defaultModel, name: this.defaultModel }],
					},
				],
			};
			this.sessionStates.set(sessionId, state);
			return state;
		}
		throw new Error(`Unknown Hermes session: ${sessionId}`);
	}

	private getSessionModel(state: HermesSessionState): string | null {
		const modelOpt = state.configOptions?.find((o) => o.id === "model");
		return modelOpt?.currentValue || null;
	}

	private upsertModelConfigOption(
		options: SessionConfigOption[] | undefined,
		modelId: string,
	): SessionConfigOption[] {
		const existing = options || [];
		const withoutModel = existing.filter((o) => o.id !== "model");
		return [
			...withoutModel,
			{
				id: "model",
				name: "Model",
				category: "model",
				type: "select",
				currentValue: modelId,
				options: [{ value: modelId, name: modelId }],
			},
		];
	}

	private upsertGenericConfigOption(
		options: SessionConfigOption[] | undefined,
		configId: string,
		value: string,
	): SessionConfigOption[] {
		const existing = options || [];
		const without = existing.filter((o) => o.id !== configId);
		return [
			...without,
			{
				id: configId,
				name: configId,
				type: "select",
				currentValue: value,
				options: [{ value, name: value }],
			},
		];
	}

	/**
	 * Fetch slash commands advertised by the Hermes gateway and emit an
	 * available_commands_update so the dropdown reflects gateway-sourced commands.
	 *
	 * Command discovery contract:
	 *   - Local deterministic commands (capture/move/done/status/process-inbox)
	 *     are registered statically in ChatPanel and never come from this call.
	 *   - Hermes-roundtrip commands are advertised by the gateway via GET /v1/commands
	 *     and flow through this method → session.availableCommands → dropdown.
	 *   - Background-only operations are not slash commands and are not advertised here.
	 *
	 * Degrades silently if the gateway does not implement the endpoint yet (404).
	 */
	private async fetchAndEmitGatewayCommands(sessionId: string): Promise<void> {
		try {
			const payload = await this.requestJson("/v1/commands", {
				method: "GET",
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const raw = payload.commands;
			if (!Array.isArray(raw)) return;
			const commands: SlashCommand[] = raw
				.filter(
					(c): c is Record<string, unknown> =>
						c !== null && typeof c === "object" && typeof c.name === "string",
				)
				.map((c) => ({
					name: c.name as string,
					description: typeof c.description === "string" ? c.description : "",
					hint:
						typeof c.hint === "string" || c.hint == null
							? (c.hint as string | null | undefined)
							: undefined,
				}));
			if (commands.length > 0) {
				this.emit({ type: "available_commands_update", sessionId, commands });
			}
		} catch {
			// Gateway does not implement /v1/commands yet — degrade silently.
		}
	}

	private emit(update: SessionUpdate): void {
		for (const callback of this.callbacks) {
			callback(update);
		}
	}

	private async requestJson(
		path: string,
		options: Omit<RequestUrlParam, "url">,
	): Promise<Record<string, unknown>> {
		let response: RequestUrlResponse;
		try {
			this.logger.log(
				`[HermesApiTransport] request ${options.method ?? "GET"} ${this.apiBase}${path}`,
			);
			response = await requestUrl({
				url: `${this.apiBase}${path}`,
				...options,
			});
			this.logger.log(
				`[HermesApiTransport] response status=${response.status} path=${path}`,
			);
		} catch (error) {
			const maybeResponse = error as RequestUrlResponse & {
				json?: unknown;
				text?: string;
				status?: number;
			};
			const errorPayload =
				maybeResponse?.json && typeof maybeResponse.json === "object"
					? (maybeResponse.json as Record<string, unknown>)
					: {};
			const status = maybeResponse?.status;
			const message =
				((errorPayload.error as Record<string, unknown> | undefined)?.message as string | undefined) ||
				(status ? `Hermes API error (${status})` : (error as Error).message || "Hermes API request failed");
			this.logger.error(
				`[HermesApiTransport] request failed path=${path} status=${status ?? "n/a"} message=${message}`,
			);
			throw new Error(message);
		}

		const payload =
			response.json && typeof response.json === "object"
				? (response.json as Record<string, unknown>)
				: {};

		if (response.status >= 400) {
			const message =
				((payload.error as Record<string, unknown> | undefined)?.message as string | undefined) ||
				`Hermes API error (${response.status})`;
			throw new Error(message);
		}

		return payload;
	}

	private ensureInitialized(): void {
		if (!this.initialized) {
			throw new Error("HermesApiTransport is not initialized");
		}
	}
}
