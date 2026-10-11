// Types for the offline experiment client (typesafe-client.mjs); used by the web unit test that checks the
// experiment and the production route ask Jev the identical style question.
export type ChoiceSpec = Readonly<{ key: string; choices: readonly string[]; instructions: string; criteria: Readonly<Record<string, string>> }>;
export declare const TYPESAFE_ORIGIN: 'https://api.typesafe.ai';
export declare const TYPESAFE_MODEL: 'jev-1.13.0';
export declare const ACTIONS: readonly string[];
export declare const STYLES: readonly ['pressure', 'counter', 'cautious', 'outboxer', 'body', 'finisher'];
export declare const ACTION_SPEC: ChoiceSpec;
export declare const STYLE_SPEC: ChoiceSpec;
export declare class DecisionError extends Error { readonly code: string; constructor(code: string); }
export type ChoicePayload = { model: string; state: unknown; questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> };
export declare function choiceRequest(spec: ChoiceSpec, state: unknown): ChoicePayload;
export declare function parseChoice(value: unknown, spec: ChoiceSpec): Readonly<{ choice: string; confidence: number; probabilities: Readonly<Record<string, number>>; usage: Readonly<{ inputTokens: number; outputTokens: number }> }>;
export declare function decisionRequest(observation: unknown): ChoicePayload;
export declare function styleRequest(observation: unknown): ChoicePayload;
export declare function parseDecision(value: unknown): Readonly<{ action: string; confidence: number }>;
export declare function parseStyleDecision(value: unknown): Readonly<{ style: string; confidence: number }>;
export type DecisionClient = Readonly<{ decide(observation: unknown): Promise<unknown>; decideStyle(observation: unknown): Promise<Readonly<{ style: string; confidence: number; usage: Readonly<{ inputTokens: number; outputTokens: number }> }>>; budget(): Readonly<{ usedRequests: number; maxRequests: number }> }>;
export declare function createDecisionClient(options?: { env?: Record<string, string | undefined>; origin?: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxRequests?: number; minIntervalMs?: number; telemetry?: (event: Readonly<Record<string, unknown>>) => void }): DecisionClient;
export declare function styleOrFallback(client: DecisionClient, observation: unknown, fallback: (observation: unknown) => string): Promise<Readonly<{ style: string; source: 'jev' | 'fallback'; confidence: number | null; code: string }>>;
