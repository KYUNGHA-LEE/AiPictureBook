import React, { useRef } from 'react';
import { Character, StoryPage } from '../types';
import { Geometry } from '../utils';

export interface CoverControls {
  coverImageUrl: string | null;
  coverTitleImageUrl: string | null;
  showCoverText: boolean;
  coverTitleTop: number;
  title: string;
  author: string;
  generating: boolean;
  onTitleChange: (v: string) => void;
  onUploadBg: (file: File) => void;
  onUploadTitle: (file: File) => void;
  onPickFromPages: () => void;
  onToggleText: () => void;
  onTopChange: (v: number) => void;
  onAIGenerate: (withTitle: boolean) => void;
}

export interface EndControls {
  endImageUrl: string | null;
  onPickFromPages: () => void;
  onUpload: (file: File) => void;
  onReset: () => void;
}

interface Props {
  geo: Geometry;
  pageIdx: number;
  pages: StoryPage[];
  characters: Character[];
  fontSize: number;
  isCover?: boolean;
  isEnd?: boolean;
  cover: CoverControls;
  end: EndControls;
  interactive?: boolean; // false면 저장용(마우스 오버 버튼 없음)
}

const PageLayout: React.FC<Props> = ({ geo, pageIdx, pages, characters, fontSize, isCover, isEnd, cover, end, interactive = true }) => {
  const pageBox: React.CSSProperties = { width: `${geo.w}mm`, height: `${geo.h}mm`, minWidth: `${geo.w}mm`, minHeight: `${geo.h}mm` };
  const bgInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);

  if (isCover) {
    return (
      <div className={`b5-page paper-texture cover-page relative overflow-hidden group/cover`} style={pageBox}>
        <div className="absolute inset-0 z-0 bg-slate-50 flex items-center justify-center">
          {cover.coverImageUrl ? (
            <img src={cover.coverImageUrl} className="w-full h-full object-cover" />
          ) : (
            <div className="text-slate-200 flex flex-col items-center gap-4">
              <i className="fas fa-image text-8xl"></i>
              <p className="font-black text-2xl">표지 배경을 올리거나 AI로 만들어 보세요</p>
            </div>
          )}
        </div>

        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none p-10">
          {cover.coverTitleImageUrl && <img src={cover.coverTitleImageUrl} className="max-w-full max-h-[150mm] object-contain drop-shadow-2xl" />}
        </div>

        {cover.showCoverText && (
          <div className="absolute z-20 text-center w-[160mm] font-black text-slate-900 drop-shadow-lg px-10 left-1/2 -translate-x-1/2"
               style={{ fontSize: '64px', top: `${cover.coverTitleTop}mm`, lineHeight: '1.2' }}>
            {interactive ? (
              <input
                className="bg-transparent border-none text-center w-full outline-none focus:ring-2 focus:ring-orange-400 rounded-lg"
                value={cover.title}
                onChange={e => cover.onTitleChange(e.target.value)}
                placeholder="제목을 입력하세요"
              />
            ) : (
              <div>{cover.title}</div>
            )}
          </div>
        )}

        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 text-4xl font-black text-slate-700 font-gmarket bg-white/60 px-8 py-2 rounded-full shadow-sm whitespace-nowrap">
          만든이: {cover.author}
        </div>

        {interactive && (
          <div data-html2canvas-ignore="true" className="absolute inset-0 z-30 opacity-0 group-hover/cover:opacity-100 transition-opacity bg-black/30 flex flex-col items-center justify-center gap-4">
            {cover.generating && (
              <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center text-lg font-black text-orange-600">
                <i className="fas fa-paint-brush loading-spin text-5xl mb-6"></i>AI 작가가 표지를 그리는 중...
              </div>
            )}
            <div className="flex gap-3 flex-wrap justify-center">
              <button onClick={e => { e.stopPropagation(); cover.onAIGenerate(true); }} className="cover-btn bg-orange-500 text-white">
                <i className="fas fa-wand-magic-sparkles"></i> AI 표지 (제목 글자 포함)
              </button>
              <button onClick={e => { e.stopPropagation(); cover.onAIGenerate(false); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-wand-magic-sparkles text-orange-500"></i> AI 표지 (그림만)
              </button>
            </div>
            <div className="flex gap-3 flex-wrap justify-center">
              <button onClick={e => { e.stopPropagation(); bgInput.current?.click(); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-image text-orange-500"></i> 배경 업로드
              </button>
              <button onClick={e => { e.stopPropagation(); cover.onPickFromPages(); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-th text-green-500"></i> 페이지에서 선택
              </button>
              <button onClick={e => { e.stopPropagation(); titleInput.current?.click(); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-heading text-blue-500"></i> 제목 이미지
              </button>
              <button onClick={e => { e.stopPropagation(); cover.onToggleText(); }} className={`cover-btn ${cover.showCoverText ? 'bg-orange-500 text-white' : 'bg-white text-slate-900'}`}>
                <i className={`fas ${cover.showCoverText ? 'fa-eye' : 'fa-eye-slash'}`}></i> 텍스트 제목
              </button>
            </div>
            {cover.showCoverText && (
              <div className="bg-white/90 p-4 rounded-3xl shadow-2xl flex flex-col gap-2 w-64" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <span>제목 위치 (상하)</span><span>{cover.coverTitleTop}mm</span>
                </div>
                <input type="range" min="10" max="200" value={cover.coverTitleTop} onChange={e => cover.onTopChange(Number(e.target.value))} className="w-full accent-orange-500" />
              </div>
            )}
          </div>
        )}

        <input type="file" ref={bgInput} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) cover.onUploadBg(f); e.target.value = ''; }} />
        <input type="file" ref={titleInput} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) cover.onUploadTitle(f); e.target.value = ''; }} />
      </div>
    );
  }

  if (isEnd) {
    // 엔딩 그림: 직접 고른 그림 → 없으면 마지막으로 그린 페이지 그림 → 표지 그림 (캐릭터 시트는 설계도라 쓰지 않아요)
    const endImage = end.endImageUrl || [...pages].reverse().find(pg => pg.imageUrl)?.imageUrl || cover.coverImageUrl;
    return (
      <div className="b5-page paper-texture end-page" style={pageBox}>
        <div className="text-8xl font-black text-slate-900 font-gmarket mb-10 drop-shadow-sm tracking-widest">THE END</div>
        <div className="relative group/end w-[100mm] h-[100mm] overflow-hidden border-[12px] border-white bg-white shadow-[0_20px_50px_rgba(0,0,0,0.15)] flex items-center justify-center">
          {endImage ? (
            <img src={endImage} className="w-full h-full object-cover" />
          ) : (
            <div className="text-slate-100 text-[10rem]"><i className="fas fa-smile-beam"></i></div>
          )}
          {interactive && (
            <div data-html2canvas-ignore="true" className="absolute inset-0 opacity-0 group-hover/end:opacity-100 transition-opacity bg-black/40 flex flex-col items-center justify-center gap-3">
              <button onClick={e => { e.stopPropagation(); end.onPickFromPages(); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-th text-green-500"></i> 페이지에서 선택
              </button>
              <button onClick={e => { e.stopPropagation(); endInput.current?.click(); }} className="cover-btn bg-white text-slate-900">
                <i className="fas fa-image text-orange-500"></i> 그림 올리기
              </button>
              {end.endImageUrl && (
                <button onClick={e => { e.stopPropagation(); end.onReset(); }} className="cover-btn bg-orange-500 text-white">
                  <i className="fas fa-rotate-left"></i> 자동으로 되돌리기
                </button>
              )}
            </div>
          )}
          <input type="file" ref={endInput} className="hidden" accept="image/*" onChange={e => { const f = e.target.files?.[0]; if (f) end.onUpload(f); e.target.value = ''; }} />
        </div>
        <div className="mt-10 space-y-2 text-center">
          <div className="text-3xl font-black text-slate-800">이야기를 끝까지 함께해주셔서 감사해요!</div>
          <div className="text-4xl font-bold text-slate-400 font-cute mt-4">우리 다음에 또 만나요!</div>
        </div>
      </div>
    );
  }

  const page = pages[pageIdx];
  const size = Math.round(fontSize * geo.fontScale);
  const side = geo.mode === 'side';

  if (geo.mode === 'full') {
    // 그림 전체 배치: 그림이 페이지를 가득 채워요(글은 넣지 않아요)
    return (
      <div className="b5-page paper-texture overflow-hidden" style={{ ...pageBox, display: 'block' }}>
        <div className="absolute inset-0 bg-[#fdfdfd]">
          {page?.imageUrl && <img src={page.imageUrl} className="w-full h-full object-cover" />}
        </div>
      </div>
    );
  }
  return (
    <div
      className="b5-page paper-texture overflow-hidden"
      style={{ ...pageBox, padding: `${geo.pad}mm`, flexDirection: side ? 'row' : 'column', justifyContent: side ? 'center' : 'flex-start' }}
    >
      <div className="image-section border-[14px] border-white shadow-[0_10px_30px_rgba(0,0,0,0.1)]" style={{ width: `${geo.imgW}mm`, height: `${geo.imgH}mm`, flexShrink: 0 }}>
        {page?.imageUrl && <img src={page.imageUrl} className="w-full h-full object-cover" />}
      </div>
      <div className="text-section" style={{ width: `${geo.textW}mm`, height: `${geo.textH}mm`, ...(side ? { marginLeft: '5mm' } : { marginTop: '5mm' }) }}>
        <div
          className="flex items-center justify-center text-center w-full h-full text-slate-900 font-gmarket font-bold whitespace-pre-wrap"
          style={{ fontSize: `${size}px`, lineHeight: 1.6, wordBreak: 'keep-all' }}
        >
          {page?.content || '이야기를 써주세요!'}
        </div>
      </div>
    </div>
  );
};

export default PageLayout;
