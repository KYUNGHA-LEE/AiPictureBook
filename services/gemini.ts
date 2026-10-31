import { Character, ImageQuality, Location, PromptRequest } from '../types';
import { pcmToWavUrl } from './audio';

export const VOICES = [
  { id: 'Kore', label: '차분한 여성' },
  { id: 'Aoede', label: '밝은 여성' },
  { id: 'Leda', label: '젊은 여성' },
  { id: 'Puck', label: '경쾌한 남성' },
  { id: 'Charon', label: '부드러운 남성' },
  { id: 'Zephyr', label: '산뜻한 목소리' }
];

export class UserCancelled extends Error {
  constructor(msg = '취소했어요.') {
    super(msg);
    this.name = 'UserCancelled';
  }
}

type PromptHandler = (req: PromptRequest) => Promise<boolean>;
let promptHandler: PromptHandler = async () => false;
export const registerPromptHandler = (h: PromptHandler) => {
  promptHandler = h;
};

export function getSavedApiKey(): string {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('gemini_api_key') || '';
}

export function setSavedApiKey(key: string): void {
  if (typeof window === 'undefined') return;
  if (key) {
    localStorage.setItem('gemini_api_key', key.trim());
  } else {
    localStorage.removeItem('gemini_api_key');
  }
}

export function friendlyError(e: any): string {
  if (e instanceof UserCancelled) return e.message;
  const t = String(e?.message || e || '');
  if (/API key not valid|API_KEY_INVALID|GEMINI_API_KEY가 등록되어 있지|등록된 API 키가 없습니다/i.test(t)) {
    return 'Gemini API 키가 필요하거나 유효하지 않습니다. 상단의 [🔑 API 키 등록] 버튼을 눌러 발급받은 키를 바로 등록해 주세요.';
  }
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(t)) {
    return '사용 한도를 넘었어요. 잠시 후 다시 시도해 주세요.';
  }
  if (/SAFETY|blocked|PROHIBITED|IMAGE_SAFETY/i.test(t)) {
    return 'AI가 안전 기준 때문에 이 장면을 그리지 못했어요. 설명을 조금 바꿔서 다시 해보세요.';
  }
  if (/Failed to fetch|NetworkError|network/i.test(t)) {
    return '서버 연결을 확인해 주세요.';
  }
  if (/Unexpected token|is not valid JSON|<!doctype|<html/i.test(t)) {
    return '서버가 잠시 재시작 중이었습니다. 지금 버튼을 다시 눌러주시면 정상 작동합니다!';
  }
  if (/503|UNAVAILABLE|overloaded/i.test(t)) {
    return 'AI가 지금 바빠요. 잠시 후 다시 시도해 주세요.';
  }
  return t.length > 160 ? t.slice(0, 160) + '…' : t || '요청 처리 중 오류가 발생했습니다.';
}

async function apiRequest<T>(url: string, body: any): Promise<T> {
  const customKey = getSavedApiKey();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (customKey) {
    headers['x-gemini-api-key'] = customKey;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('서버와 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }

  const contentType = res.headers.get('content-type') || '';
  const isHtml = contentType.includes('text/html');

  if (!res.ok || isHtml) {
    let errMessage = '서버 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    try {
      const text = await res.text();
      if (text.includes('<!doctype') || text.includes('<html')) {
        errMessage = '서버가 잠시 재시작 중이었습니다. 지금 버튼을 다시 눌러주시면 정상 작동합니다!';
      } else {
        const data = JSON.parse(text);
        if (data.error) errMessage = data.error;
      }
    } catch {}
    throw new Error(errMessage);
  }

  const rawText = await res.text();
  try {
    return JSON.parse(rawText) as T;
  } catch {
    if (rawText.includes('<!doctype') || rawText.includes('<html')) {
      throw new Error('서버가 잠시 재시작 중이었습니다. 지금 버튼을 다시 눌러주시면 정상 작동합니다!');
    }
    throw new Error('서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/* ---------------- 1) 이야기 자동 기획 ---------------- */
export interface PlannedStory {
  title: string;
  characters: { name: string; description: string }[];
  locations: { name: string; description: string }[];
  pages: { content: string; sceneIdea: string; characters: string[]; location: string }[];
}

export function planStory(opts: {
  topic: string;
  age: string;
  pageCount: number;
  style: string;
  existingCharacters?: { name: string; description?: string }[];
  existingLocations?: { name: string; description?: string }[];
}): Promise<PlannedStory> {
  return apiRequest<PlannedStory>('/api/plan-story', opts);
}

/* ---------------- 2) 본문 분석 ---------------- */
export interface ScriptAnalysis {
  characters: { name: string; description: string }[];
  locations: { name: string; description: string }[];
  pages: { characters: string[]; location: string }[];
}

export function analyzeScript(opts: {
  pages: { content: string; sceneIdea: string }[];
  style: string;
  knownCharacters: string[];
  knownLocations: string[];
}): Promise<ScriptAnalysis> {
  return apiRequest<ScriptAnalysis>('/api/analyze-script', opts);
}

/* ---------------- 3) 장면 설명 다듬기 ---------------- */
export async function enhanceScene(opts: {
  scene: string;
  content: string;
  style: string;
  characters: Character[];
  location?: Location | null;
}): Promise<string> {
  const data = await apiRequest<{ text: string }>('/api/enhance-scene', opts);
  return data.text;
}

/* ---------------- 4) 캐릭터 시트 생성 ---------------- */
export async function generateCharacterSheet(opts: {
  name: string;
  description: string;
  style: string;
  quality: ImageQuality;
  size: '1K' | '2K';
  reference?: string | null;
}): Promise<string> {
  const data = await apiRequest<{ imageUrl: string }>('/api/generate-character-sheet', opts);
  return data.imageUrl;
}

/* ---------------- 5) 장소 시트 생성 ---------------- */
export async function generateLocationSheet(opts: {
  name: string;
  description: string;
  style: string;
  aspect: string;
  quality: ImageQuality;
  size: '1K' | '2K';
  reference?: string | null;
}): Promise<string> {
  const data = await apiRequest<{ imageUrl: string }>('/api/generate-location-sheet', opts);
  return data.imageUrl;
}

/* ---------------- 6) 페이지 일러스트 생성 ---------------- */
export interface ImageRefs {
  characters: Character[];
  location?: Location | null;
  background?: string | null;
  styleAnchor?: string | null;
  previous?: string | null;
}

export async function generateStoryImage(opts: {
  prompt: string;
  style: string;
  aspect: string;
  quality: ImageQuality;
  size: '1K' | '2K';
  refs: ImageRefs;
  directing?: { shotType?: string; verticalAngle?: string; horizontalAngle?: string; specialPOV?: string };
  textInImage?: string;
  fullPage?: boolean;
  settingChanged?: boolean;
}): Promise<string> {
  const data = await apiRequest<{ imageUrl: string }>('/api/generate-story-image', opts);
  return data.imageUrl;
}

/* ---------------- 7) 표지 생성 ---------------- */
export async function generateCover(opts: {
  title: string;
  author: string;
  style: string;
  aspect: string;
  quality: ImageQuality;
  size: '1K' | '2K';
  characters: Character[];
  sceneHint?: string;
  withTitle: boolean;
}): Promise<string> {
  const data = await apiRequest<{ imageUrl: string }>('/api/generate-cover', opts);
  return data.imageUrl;
}

/* ---------------- 8) 그림 말로 고치기 ---------------- */
export async function editImage(opts: {
  image: string;
  instruction: string;
  style: string;
  aspect: string;
  quality: ImageQuality;
  size: '1K' | '2K';
  textInImage?: boolean;
}): Promise<string> {
  const data = await apiRequest<{ imageUrl: string }>('/api/edit-image', opts);
  return data.imageUrl;
}

/* ---------------- 9) 동화 읽어주기 (TTS) ---------------- */
export async function speak(text: string, voice: string): Promise<string> {
  const data = await apiRequest<{ audioData: string }>('/api/speak', { text, voice });
  return pcmToWavUrl(data.audioData, 24000);
}

/* ---------------- 10) 스타일 샘플 생성 ---------------- */
export async function generateStyleSample(opts: {
  style: string;
  quality?: ImageQuality;
  size?: '1K' | '2K';
}): Promise<{ imageUrl: string; description: string }> {
  return await apiRequest<{ imageUrl: string; description: string }>('/api/generate-style-sample', opts);
}

