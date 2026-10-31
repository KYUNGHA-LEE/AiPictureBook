import { Character, Location, StoryPage } from './types';

/** 이 페이지에 등장하는 캐릭터: 직접 고른 게 있으면 그대로, 없으면 글에 이름이 나온 캐릭터 */
export function effectiveChars(page: StoryPage, characters: Character[]): Character[] {
  if (page.characterIds) return characters.filter(c => page.characterIds!.includes(c.id));
  const text = `${page.content} ${page.sceneIdea}`;
  return characters.filter(c => c.name && text.includes(c.name));
}

/** 이 페이지의 장소: 직접 고른 게 있으면 그대로, 없으면 글에 이름이 나온 첫 장소 */
export function effectiveLocation(page: StoryPage, locations: Location[]): Location | null {
  if (page.locationId === null) return null;
  if (page.locationId !== undefined) return locations.find(l => l.id === page.locationId) ?? null;
  const text = `${page.content} ${page.sceneIdea}`;
  return locations.find(l => l.name && text.includes(l.name)) ?? null;
}

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** 엑셀/구글시트에서 복사한 표(TSV)를 행×열로 나눕니다. 셀 안의 줄바꿈("...")도 처리해요. */
export function parseTsv(data: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    const next = data[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\r' && next === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

export function commonFontSize(pages: StoryPage[]): number {
  const max = pages.length ? Math.max(...pages.map(p => (p.content || '').length)) : 0;
  if (max === 0) return 32;
  if (max < 15) return 52;
  if (max < 30) return 44;
  if (max < 60) return 34;
  if (max < 100) return 28;
  if (max < 150) return 22;
  if (max < 250) return 18;
  return 15;
}

/* ---------------- 책 크기(mm) → 페이지 배치 계산 ---------------- */
export const SIZE_MIN = 90;
export const SIZE_MAX = 420;
export const SIZE_PRESETS = [
  { id: 'portrait', label: '세로', w: 182, h: 255 },
  { id: 'landscape', label: '가로', w: 255, h: 182 },
  { id: 'square', label: '정사각형', w: 210, h: 210 }
] as const;

export const clampSize = (n: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(n) || SIZE_MIN));

export interface Geometry {
  w: number; h: number; // 페이지(mm)
  mode: 'stack' | 'side' | 'full'; // stack: 위 그림/아래 글, side: 왼쪽 그림/오른쪽 글, full: 그림 전체(글 없음)
  pad: number;
  imgW: number; imgH: number;
  textW: number; textH: number;
  fontScale: number;
}

/** 가로·세로 크기만 알면 그림 영역과 글 영역을 자동으로 나눠요. (기존 세로/가로/정사각 비율과 같은 규칙) */
export function pageGeometry(wIn: number, hIn: number, full = false): Geometry {
  const w = clampSize(wIn);
  const h = clampSize(hIn);
  const pad = 10;
  const gap = 5;
  if (full) {
    // 그림이 페이지 전체. 글 자리는 없어요.
    return { w, h, mode: 'full', pad: 0, imgW: w, imgH: h, textW: 0, textH: 0, fontScale: 1 };
  }
  if (w > h * 1.15) {
    const imgH = h - pad * 2;
    const imgW = Math.round(w * 0.59);
    const textW = w - pad * 2 - gap - imgW;
    const textH = imgH;
    return { w, h, mode: 'side', pad, imgW, imgH, textW, textH, fontScale: fontScaleOf(textW, textH, 0.8) };
  }
  const imgW = w - pad * 2;
  const imgH = Math.min(imgW, h * 0.66);
  const textW = imgW;
  const textH = Math.max(24, h - pad - gap - imgH - pad);
  return { w, h, mode: 'stack', pad, imgW, imgH, textW, textH, fontScale: fontScaleOf(textW, textH, 1) };
}

const fontScaleOf = (tw: number, th: number, k: number) => Math.min(1.4, Math.max(0.6, Math.sqrt((tw * th) / 10530) * k));

const ASPECTS: [string, number][] = [
  ['1:1', 1], ['3:2', 1.5], ['2:3', 2 / 3], ['4:3', 4 / 3], ['3:4', 3 / 4],
  ['5:4', 1.25], ['4:5', 0.8], ['16:9', 16 / 9], ['9:16', 9 / 16], ['21:9', 21 / 9]
];
/** AI가 만들 수 있는 화면비 중 가장 가까운 것 (그림은 영역에 맞게 잘려 들어가요) */
export function nearestAspect(ratio: number): string {
  return ASPECTS.reduce((best, cur) => (Math.abs(Math.log(cur[1] / ratio)) < Math.abs(Math.log(best[1] / ratio)) ? cur : best))[0];
}
