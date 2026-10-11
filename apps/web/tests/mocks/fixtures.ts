/**
 * Mock data for the LIVE contract ("SmartRouter Frontend Architecture", Oct 9 2026): the demo
 * user, a catalogue across the PDF's providers with Oct 7 prices (USD decimals, as the API
 * sends them), and sample answers per task type.
 */
import type { TaskType } from '@/lib/api/types';

export const NOW = () => new Date().toISOString();

export const FREE_MODEL_ID = 'free:llama-3.1-8b';
export const MOCK_ADDRESS = '0x7a3f9c1e5b2d4a6f8e0c1b3d5f7a9c2e4b6d8f01';

export interface MockUser {
  address: string;
  slider: 'cheapest' | 'balanced' | 'best';
  dailyLimitUsd: number;
  weeklyLimitUsd: number;
  autoFreeFallback: boolean;
}

export const mockUser = (): MockUser => ({
  address: MOCK_ADDRESS,
  slider: 'balanced',
  dailyLimitUsd: 2,
  weeklyLimitUsd: 10,
  autoFreeFallback: true,
});

/** Catalogue entry as `GET /catalog` sends it. */
export interface MockModel {
  modelId: string;
  label: string;
  provider: string;
  taskTypes: TaskType[];
  /** Typical price per answer, USD. */
  priceUsd: number;
  /** 0..1 quality per task (LMArena-style, rescaled). */
  quality: Record<string, number>;
  /** Typical latency in ms (→ speed label). */
  latency: number;
  free: boolean;
}

const TEXT: TaskType[] = ['chat', 'writing', 'coding', 'research', 'translation'];

const text = (m: Omit<MockModel, 'taskTypes' | 'free'> & { taskTypes?: TaskType[] }): MockModel => ({ taskTypes: TEXT, free: false, ...m });

export const mockModels: MockModel[] = [
  text({ modelId: 'openrouter:z-ai/glm-5.3-flash', label: 'GLM 5.3 Flash', provider: 'OpenRouter', priceUsd: 0.0008, quality: { writing: 0.8, chat: 0.78, coding: 0.72, research: 0.6, translation: 0.74 }, latency: 700 }),
  text({ modelId: 'openrouter:meta-llama/llama-3.3-70b', label: 'Llama 3.3 70B', provider: 'OpenRouter', priceUsd: 0.0007, quality: { writing: 0.72, chat: 0.74, coding: 0.66, research: 0.55, translation: 0.7 }, latency: 900 }),
  text({ modelId: 'groq:openai/gpt-oss-120b', label: 'gpt-oss-120b', provider: 'Groq', priceUsd: 0.0002, quality: { writing: 0.66, chat: 0.7, coding: 0.68, research: 0.5, translation: 0.6 }, latency: 350 }),
  text({ modelId: 'deepseek:deepseek-chat', label: 'DeepSeek V3', provider: 'DeepSeek', priceUsd: 0.0011, quality: { writing: 0.76, chat: 0.77, coding: 0.82, research: 0.62, translation: 0.72 }, latency: 1400 }),
  text({ modelId: 'mistral:mistral-large', label: 'Mistral Large', provider: 'Mistral AI', priceUsd: 0.004, quality: { writing: 0.78, chat: 0.76, coding: 0.74, research: 0.6, translation: 0.8 }, latency: 1100 }),
  text({ modelId: 'openai:gpt-5', label: 'GPT-5', provider: 'OpenAI', priceUsd: 0.012, quality: { writing: 0.9, chat: 0.9, coding: 0.9, research: 0.8, translation: 0.86 }, latency: 2200 }),
  text({ modelId: 'anthropic:claude-opus-5.5', label: 'Claude Opus 5.5', provider: 'Anthropic', priceUsd: 0.026, quality: { writing: 1, chat: 0.96, coding: 0.98, research: 0.88, translation: 0.9 }, latency: 2600 }),
  text({ modelId: 'perplexity:sonar', label: 'Sonar', provider: 'Perplexity', priceUsd: 0.006, quality: { research: 1, chat: 0.6, writing: 0.5, coding: 0.4, translation: 0.4 }, latency: 2800, taskTypes: ['research', 'chat'] }),
  { modelId: 'fal:flux-pro', label: 'FLUX Pro', provider: 'fal.ai', taskTypes: ['image'], priceUsd: 0.05, quality: { image: 0.9 }, latency: 6000, free: false },
  { modelId: 'stablestudio:sd3.5', label: 'Stable Diffusion 3.5', provider: 'StableStudio', taskTypes: ['image'], priceUsd: 0.035, quality: { image: 0.8 }, latency: 8000, free: false },
  { modelId: 'suno:v4', label: 'Suno v4', provider: 'Suno', taskTypes: ['music'], priceUsd: 0.105, quality: { music: 0.95 }, latency: 60_000, free: false },
  { modelId: FREE_MODEL_ID, label: 'Free · Llama 3.1 8B', provider: 'Cloudflare Workers AI', taskTypes: TEXT, priceUsd: 0, quality: { writing: 0.5, chat: 0.52, coding: 0.45, research: 0.35, translation: 0.5 }, latency: 500, free: true },
];

export const SAMPLE_REPLY: Record<TaskType, string> = {
  chat: "Here's a quick take: SmartRouter picks the model, you pay per use from your Tempo wallet, and the free model keeps you moving when the allocation runs out.",
  writing:
    "**Cover letter — draft**\n\nDear Hiring Team,\n\nI'm applying for the role because I build payment flows that people actually finish. At my last job I shipped a wallet onboarding that cut drop-off by 38%.\n\nI'd love to bring that to your team.\n\nWarm regards,\nAda",
  coding:
    "Here's the fix:\n\n```ts\nexport function roundUp(micro: number) {\n  return Math.ceil(micro / 100) * 100;\n}\n```\n\nThe bug was `Math.round`, which rounded $0.00085 down. The PDF rule is round **up** to $0.0001.",
  research:
    'Three sources agree:\n\n1. Tempo settles stablecoin transfers in under a second.\n2. MPP lets a client pay per request with signed vouchers.\n3. Fees are sponsored, so the user only ever spends the stablecoin.\n\nSee the Tempo docs and the MPP spec for details.',
  translation: 'Bonjour ! SmartRouter choisit le meilleur modèle pour votre budget et vous payez à l’usage depuis votre portefeuille Tempo.',
  image: 'Your image is ready.',
  music: 'Your song is ready.',
};

export const SAMPLE_FILES: Record<'image' | 'music', { url: string; mime: string }> = {
  image: { url: 'https://media.smartrouter.test/images/demo-sunset.jpg', mime: 'image/jpeg' },
  music: { url: 'https://media.smartrouter.test/songs/demo-lagos-nights.mp3', mime: 'audio/mpeg' },
};
