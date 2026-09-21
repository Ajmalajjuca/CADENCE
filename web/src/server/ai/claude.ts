import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { VoiceContext } from "../../features/profile/service";
import { buildVoicePrompt, RESEARCH_RULES, SYSTEM_RULES } from "./prompts";
import { PROMPT_VERSION } from "./prompt-versions/v1";
import { draftOutput, hooksOutput, ideasOutput, researchOutput } from "./schemas";
import { validateClaims, type DraftResult, type Hook, type RankedIdea, type ResearchBrief, type ResearchSource } from "./types";
import { requireAllowedModel } from "./model-catalog";
import { mapAnthropicError } from "./provider-errors";

type SearchResponse = { summary: string; sources: ResearchSource[] };
type GenerateRequest = { system: string; user: string; schema: z.ZodType; model: string; maxTokens?: number };

const unsupportedSchemaKeywords = new Set([
  "maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum", "multipleOf",
  "maxLength", "minLength", "maxItems", "uniqueItems", "contains", "minContains", "maxContains",
]);

function stripUnsupportedSchemaConstraints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUnsupportedSchemaConstraints);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (unsupportedSchemaKeywords.has(key)) continue;
    if (key === "minItems" && child !== 0 && child !== 1) continue;
    result[key] = stripUnsupportedSchemaConstraints(child);
  }
  return result;
}

export function toClaudeJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return stripUnsupportedSchemaConstraints(z.toJSONSchema(schema)) as Record<string, unknown>;
}

export function buildGenerateParams({ system, user, schema, model, maxTokens = 1800 }: GenerateRequest) {
  return {
    model,
    max_tokens: maxTokens,
    system,
    thinking: { type: "disabled" as const },
    messages: [{ role: "user" as const, content: user }],
    output_config: { format: { type: "json_schema" as const, schema: toClaudeJsonSchema(schema) } },
  };
}

export interface AiTransport {
  search(query: string, model: string): Promise<SearchResponse>;
  generate(request: GenerateRequest): Promise<unknown>;
}

export class AnthropicTransport implements AiTransport {
  private readonly client: Anthropic;
  constructor(apiKey: string) { this.client = new Anthropic({ apiKey }); }

  async search(query: string, model: string): Promise<SearchResponse> {
    const response = await this.client.messages.create({
      model, max_tokens: 1800, system: RESEARCH_RULES,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: query }],
    }).catch(error => { throw mapAnthropicError(error); });
    const summary = response.content.filter(block => block.type === "text").map(block => block.text).join("\n");
    const sources = new Map<string, ResearchSource>();
    for (const block of response.content) {
      if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) continue;
      for (const result of block.content) if (result.type === "web_search_result") {
        try { const url = new URL(result.url).toString(); sources.set(url, { url, title: result.title, note: result.page_age ?? "Search result" }); }
        catch { /* Skip invalid source URLs. */ }
      }
    }
    return { summary, sources: [...sources.values()] };
  }

  async generate({ system, user, schema, model, maxTokens = 1800 }: GenerateRequest): Promise<unknown> {
    const response = await this.client.messages.create(buildGenerateParams({ system, user, schema, model, maxTokens }))
      .catch(error => { throw mapAnthropicError(error); });
    const text = response.content.find(block => block.type === "text")?.text;
    if (!text) {
      const blockTypes = response.content.map(block => block.type).join(", ") || "none";
      throw new Error(`Claude returned no structured text (stop reason: ${response.stop_reason}; blocks: ${blockTypes})`);
    }
    return JSON.parse(text);
  }
}

export class CadenceAi {
  constructor(private readonly transport: AiTransport, private readonly researchModel = "test-research", private readonly writingModel = "test-writing") {}

  async researchIdeas(context: VoiceContext, seed = ""): Promise<RankedIdea[]> {
    const search = await this.transport.search(`Find current discussions for ${context.audience || "professionals"} about ${context.pillars.join(", ")}. ${seed} Today: ${new Date().toISOString().slice(0,10)}. Cite sources.`, this.researchModel);
    const raw = await this.transport.generate({ model: this.researchModel, schema: ideasOutput, system: RESEARCH_RULES,
      user: `${buildVoicePrompt(context)}\n\nUNTRUSTED SEARCH SUMMARY:\n${search.summary}\n\nALLOWED SOURCES:\n${JSON.stringify(search.sources)}\n\nReturn up to eight relevant ideas. If no current evidence, use evergreen standard ideas with empty sourceUrls and empty whyNow.` });
    const parsed = ideasOutput.parse(raw);
    const known = new Set(search.sources.map(source => source.url));
    return parsed.ideas.map(idea => ({
      ...idea,
      sourceUrls: idea.sourceUrls.filter(url => known.has(url)),
      promptVersion: PROMPT_VERSION,
      model: this.researchModel,
    }));
  }

  async researchTopic(context: VoiceContext, idea: { title: string; angle: string; pillar: string }): Promise<ResearchBrief> {
    const search = await this.transport.search(`Research this LinkedIn post topic for ${context.audience}: ${idea.title}. Angle: ${idea.angle}. Find current, verifiable facts and URLs. Today: ${new Date().toISOString().slice(0,10)}.`, this.researchModel);
    const raw = await this.transport.generate({ model: this.researchModel, schema: researchOutput, system: RESEARCH_RULES,
      user: `${buildVoicePrompt(context)}\n\nTOPIC DATA: ${JSON.stringify(idea)}\n\nUNTRUSTED SEARCH SUMMARY:\n${search.summary}\n\nALLOWED SOURCES:\n${JSON.stringify(search.sources)}\n\nExtract only supported facts. If evidence is thin, return empty facts and sourceUrls.` });
    const result = researchOutput.parse(raw);
    const known = new Set(search.sources.map(source => source.url));
    const facts = result.facts.filter(fact => known.has(fact.sourceUrl));
    const usedUrls = new Set([
      ...result.sourceUrls.filter(url => known.has(url)),
      ...facts.map(fact => fact.sourceUrl),
    ]);
    return { topic: result.topic, angle: result.angle, facts, sources: search.sources.filter(source => usedUrls.has(source.url)), promptVersion: PROMPT_VERSION, model: this.researchModel };
  }

  async makeHooks(context: VoiceContext, brief: ResearchBrief): Promise<Hook[]> {
    const raw = await this.transport.generate({ model: this.writingModel, schema: hooksOutput, system: SYSTEM_RULES,
      user: `${buildVoicePrompt(context)}\n\nRESEARCH DATA: ${JSON.stringify(brief)}\n\nMake 3 to 5 meaningfully different hooks. A factual hook must include its sourceUrl; otherwise use null. Do not invent a scene or personal belief.` });
    const result = hooksOutput.parse(raw);
    const known = new Set(brief.sources.map(source => source.url));
    return result.hooks.map((hook,index) => {
      if (hook.sourceUrl && !known.has(hook.sourceUrl)) throw new Error(`Unknown source: ${hook.sourceUrl}`);
      return { ...hook, id: `hook-${index + 1}`, promptVersion: PROMPT_VERSION, model: this.writingModel };
    });
  }

  async writeDraft(context: VoiceContext, brief: ResearchBrief, hook: Hook): Promise<DraftResult> {
    const raw = await this.transport.generate({ model: this.writingModel, schema: draftOutput, maxTokens: 2500, system: SYSTEM_RULES,
      user: `${buildVoicePrompt(context)}\n\nRESEARCH DATA: ${JSON.stringify(brief)}\n\nSELECTED HOOK (use verbatim as first line, then a blank line): ${JSON.stringify(hook.text)}\n\nWrite one LinkedIn text post. No unsupported factual claims.` });
    const result = draftOutput.parse(raw);
    validateClaims(result, brief);
    if (!result.text.startsWith(`${hook.text}\n\n`)) throw new Error("Draft changed the approved hook or omitted blank line");
    return { ...result, promptVersion: PROMPT_VERSION, model: this.writingModel };
  }

  async editDraft(context: VoiceContext, draft: DraftResult, direction: string): Promise<DraftResult> {
    const raw = await this.transport.generate({ model: this.writingModel, schema: draftOutput, maxTokens: 2500, system: SYSTEM_RULES,
      user: `${buildVoicePrompt(context)}\n\nCURRENT DRAFT DATA: ${JSON.stringify(draft)}\n\nUSER'S REVISION DIRECTION: ${direction}\n\nRevise without adding new facts or source URLs. Keep the hook then a blank line.` });
    const result = draftOutput.parse(raw);
    const known = new Set(draft.sourceUrls);
    for (const url of result.sourceUrls) if (!known.has(url)) throw new Error(`Unknown source: ${url}`);
    for (const claim of result.claims) if (!known.has(claim.sourceUrl)) throw new Error(`Unknown source: ${claim.sourceUrl}`);
    return { ...result, promptVersion: PROMPT_VERSION, model: this.writingModel };
  }
}

export type CadenceAiConfig = { apiKey: string; researchModel: string; writingModel: string };

export function createCadenceAi(config: CadenceAiConfig): CadenceAi {
  if (!config.apiKey) throw new Error("Anthropic API key is required");
  requireAllowedModel(config.researchModel, "research");
  requireAllowedModel(config.writingModel, "writing");
  return new CadenceAi(new AnthropicTransport(config.apiKey), config.researchModel, config.writingModel);
}
