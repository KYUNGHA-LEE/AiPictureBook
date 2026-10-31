
export interface StoryPage {
  id: number;
  content: string;
  sceneIdea: string;
  imageUrl: string | null;
  bgImageData?: string | null; // 페이지별 배경 참조 이미지
  shotType?: string;
  verticalAngle?: string;
  horizontalAngle?: string;
  specialPOV?: string;
  characterIds?: number[]; // 지정하지 않으면 글에 나온 이름으로 자동 판별
  locationId?: number | null; // undefined: 글에서 자동 판별 / null: 장소 없음 / 숫자: 지정한 장소
  textInImage?: string; // 그림 안에 직접 그려 넣을 글자(말풍선/자막)
}

export interface Location {
  id: number;
  name: string;
  imageData: string | null;
  description?: string; // 방/장소의 고정된 구조(가구·창문·문 위치 등)
}

export interface Character {
  id: number;
  name: string;
  imageData: string | null;
  description?: string; // AI 캐릭터 시트를 만들 때 쓰는 외모 설명
}

export enum AppStep {
  PLANNING = 1,
  STORYBOARDING = 2,
  PREVIEW = 3
}

export type ImageQuality = 'fast' | 'standard' | 'pro';

export interface Settings {
  imageQuality: ImageQuality;
  imageSize: '1K' | '2K';
  keepStyle: boolean; // 첫 그림을 기준으로 그림체 고정
  keepContinuity: boolean; // 이전 페이지 그림을 참고해 이어 그리기
  autoEnhance: boolean; // 짧은 그림 설명을 AI가 자동으로 풍부하게
  autoAssets: boolean; // 본문에서 캐릭터·장소를 자동으로 찾아 그림까지 만들기
  voice: string;
}

export interface Project {
  step: AppStep;
  title: string;
  author: string;
  pageCount: number;
  style: string;
  pageW: number; // 책 가로(mm)
  pageH: number; // 책 세로(mm)
  storyTopic: string; // AI 이야기 도우미: 적어 둔 줄거리/아이디어
  storyAge: string; // AI 이야기 도우미: 독자 연령
  fullImage: boolean; // true: 그림이 페이지 전체를 채움(글은 넣지 않음)
  coverImageUrl: string | null;
  coverTitleImageUrl: string | null;
  showCoverText: boolean;
  coverTitleTop: number;
  endImageUrl: string | null; // 엔딩 그림(null이면 마지막 페이지 그림 → 표지 순으로 자동)
  pages: StoryPage[];
  characters: Character[];
  locations: Location[];
}

export type Tier = 'free' | 'paid';

export type PromptRequest =
  | { type: 'need-key'; reason: string }
  | { type: 'switch-paid'; reason: string }
  | { type: 'need-paid'; reason: string };
