import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { AI_SCHEMA, AI_SYSTEM, type AIResult } from '../engine/planAI';

const KEY_STORE = 'gyomufit:anthropic-key';

/** API 키는 이 브라우저에만 둔다 (설정 파일·시트·공용 저장에 넣지 않음) */
export function loadAIKey(): string {
  try {
    return localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    return '';
  }
}
export function saveAIKey(k: string) {
  try {
    if (k) localStorage.setItem(KEY_STORE, k);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* 저장이 막힌 브라우저: 이번 화면에서만 */
  }
}

/**
 * 1차안과 요청을 보내 변경 제안을 받는다.
 * 교사가 자기 키로 브라우저에서 바로 부르므로 dangerouslyAllowBrowser를 켠다(키는 그 교사 브라우저에만 있음).
 */
export async function askPlanAI(apiKey: string, context: string, request: string): Promise<AIResult> {
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  try {
    const response = await client.beta.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'medium', format: jsonSchemaOutputFormat(AI_SCHEMA) },
      // 안전 분류기가 거절하면 서버가 알맞은 다른 모델로 이어서 처리
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: AI_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `<plan>\n${context}\n</plan>\n\n<request>\n${request}\n</request>`,
        },
      ],
    });
    if (response.stop_reason === 'refusal') throw new Error('AI가 이 요청을 처리하지 않았습니다. 요청을 바꿔 다시 해 보세요.');
    if (response.stop_reason === 'max_tokens') throw new Error('AI 답이 너무 길어 끊겼습니다. 요청을 나눠서 해 보세요.');
    const parsed = response.parsed_output;
    if (!parsed) throw new Error('AI 답을 읽지 못했습니다. 다시 해 보세요.');
    return parsed as AIResult;
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API 키가 올바르지 않습니다. console.anthropic.com에서 받은 키인지 확인하세요.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('이 API 키로는 이 모델을 쓸 수 없습니다.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('요청이 많아 잠시 막혔습니다. 조금 뒤 다시 하세요.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('AI 서버에 연결하지 못했습니다. 학교망에서 api.anthropic.com이 막혀 있을 수 있습니다.');
    if (e instanceof Anthropic.APIError) throw new Error(`AI 서버 오류 (${e.status}): ${e.message}`);
    throw e;
  }
}
