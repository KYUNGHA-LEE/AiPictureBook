import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Project } from '../types';
import PageLayout, { CoverControls, EndControls } from './PageLayout';
import { commonFontSize, pageGeometry } from '../utils';
import { VOICES } from '../services/gemini';

interface Props {
  p: Project;
  patch: (v: Partial<Project>) => void;
  cover: CoverControls;
  end: EndControls;
  viewerPage: number;
  setViewerPage: (updater: (prev: number) => number) => void;
  onBack: () => void;
  onDownloadZip: () => void;
  downloading: boolean;
  onSpeak: (text: string) => Promise<string>;
  currentVoice?: string;
  onVoiceChange?: (voice: string) => void;
}

const SideCard: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="bg-white border border-[#efe9df] rounded-2xl p-3 space-y-2">
    <h3 className="text-xs font-semibold text-slate-400 flex items-center gap-2"><i className={`fas ${icon} text-[11px]`}></i>{title}</h3>
    {children}
  </section>
);

const PreviewStep: React.FC<Props> = ({ p, patch, cover, end, viewerPage, setViewerPage, onBack, onDownloadZip, downloading, onSpeak, currentVoice, onVoiceChange }) => {
  const fontSize = commonFontSize(p.pages);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [reading, setReading] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const autoRef = useRef(false);
  autoRef.current = autoRead;

  // 화면 자동 맞춤
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.6);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const fit = () => {
    const stage = stageRef.current;
    const book = bookRef.current;
    if (!stage || !book || !book.offsetWidth) return;
    const w = book.offsetWidth;
    const h = book.offsetHeight;
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const availH = Math.max(320, window.innerHeight - top - 80); // 아래 쪽 넘기기 버튼 자리 확보
    const s = Math.min(1, stage.clientWidth / w, availH / h);
    setScale(s);
    setBox({ w, h });
  };
  useLayoutEffect(() => {
    fit();
    const ro = new ResizeObserver(fit);
    if (stageRef.current) ro.observe(stageRef.current);
    if (bookRef.current) ro.observe(bookRef.current);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageW, p.pageH, p.fullImage, viewerPage]);

  const isCover = viewerPage === -1;
  const isEnd = viewerPage === p.pages.length;
  const total = p.pages.length;

  const textFor = (idx: number) => {
    if (idx === -1) return `${p.title}. 글, 그림, ${p.author}.`;
    if (idx === total) return '끝. 이야기를 끝까지 함께해 주셔서 감사해요!';
    return p.pages[idx]?.content || '';
  };

  const token = useRef(0);
  const stop = () => {
    token.current++;
    audioRef.current?.pause();
    audioRef.current = null;
    setReading(false);
  };

  const playCurrent = async () => {
    stop();
    const text = textFor(viewerPage).trim();
    if (!text) return;
    setReading(true);
    const my = token.current;
    const at = viewerPage;
    try {
      const url = await onSpeak(text);
      // 만드는 동안 사용자가 멈추거나 다른 페이지로 넘겼다면 재생하지 않음
      if (my !== token.current) return;
      const a = new Audio(url);
      audioRef.current = a;
      a.onended = () => {
        setReading(false);
        audioRef.current = null;
        if (!autoRef.current) return;
        if (at >= total) setAutoRead(false);
        else setTimeout(() => setViewerPage(prev => (prev === at ? prev + 1 : prev)), 700);
      };
      a.onerror = () => setReading(false);
      await a.play();
    } catch {
      setReading(false);
      setAutoRead(false);
    }
  };

  // 페이지가 바뀌면 소리 멈추고, 자동 읽기 중이면 새 페이지를 읽어줘요.
  useEffect(() => {
    stop();
    if (autoRead) {
      playCurrent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerPage, autoRead]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const goPrev = () => setViewerPage(prev => Math.max(-1, prev - 1));
  const goNext = () => setViewerPage(prev => Math.min(total, prev + 1));

  const layoutProps = { geo: pageGeometry(p.pageW, p.pageH, p.fullImage), pages: p.pages, characters: p.characters, fontSize, cover, end };

  return (
    <div className="p-4 md:p-5 animate-fadeIn text-slate-900">
      <div className="flex flex-col lg:flex-row gap-6 items-start max-w-[1020px] mx-auto">
        {/* 왼쪽: 책 미리보기 (창 크기에 맞춰 자동 맞춤) */}
        <div className="flex-1 min-w-0 w-full flex flex-col items-center gap-4">
          <div ref={stageRef} className="w-full flex justify-center">
            <div className="relative" style={{ width: box.w * scale, height: box.h * scale }}>
              <div
                ref={bookRef}
                className="preview-container cursor-pointer absolute left-0 top-0"
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  if (e.clientX - rect.left < rect.width / 2) goPrev(); else goNext();
                }}
                style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
              >
                <div className="border-[20px] border-white shadow-[0_30px_80px_rgba(0,0,0,0.15)] rounded-3xl overflow-hidden">
                  <PageLayout {...layoutProps} pageIdx={viewerPage} isCover={isCover} isEnd={isEnd} />
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-5 text-slate-500 font-semibold text-sm">
            <button onClick={goPrev} className="w-10 h-10 rounded-full bg-white border border-[#e5dfd4] text-slate-500 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-30 transition-all" disabled={viewerPage <= -1}><i className="fas fa-chevron-left"></i></button>
            <span className="min-w-[72px] text-center">{isCover ? '표지' : isEnd ? '끝' : `${viewerPage + 1} / ${total} 쪽`}</span>
            <button onClick={goNext} className="w-10 h-10 rounded-full bg-white border border-[#e5dfd4] text-slate-500 hover:bg-orange-50 hover:text-orange-600 disabled:opacity-30 transition-all" disabled={viewerPage >= total}><i className="fas fa-chevron-right"></i></button>
          </div>
        </div>

        {/* 오른쪽: 사이드바 */}
        <aside className="w-full lg:w-64 shrink-0 lg:sticky lg:top-20 space-y-2.5">
          <button onClick={onBack} className="text-slate-400 text-sm font-medium hover:text-orange-600 flex items-center gap-2 transition-all px-1"><i className="fas fa-chevron-left"></i> 내용 수정하기</button>

          <SideCard title="동화책" icon="fa-book">
            <input
              className="tale-field !py-2.5 font-bold"
              value={p.title}
              onChange={e => patch({ title: e.target.value })}
              placeholder="제목을 입력하세요"
            />
          </SideCard>

          <SideCard title="읽어주기" icon="fa-volume-high">
            {onVoiceChange && (
              <div className="space-y-1 pb-1">
                <div className="text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                  <span>낭독 목소리</span>
                  <span className="text-[10px] text-orange-600 font-bold">
                    {VOICES.find(v => v.id === currentVoice)?.label || currentVoice || '차분한 여성'}
                  </span>
                </div>
                <select
                  value={currentVoice || 'Kore'}
                  onChange={e => {
                    stop();
                    onVoiceChange(e.target.value);
                  }}
                  className="tale-field !py-1.5 !px-2.5 text-xs w-full bg-slate-50 border-slate-200 cursor-pointer"
                >
                  {VOICES.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.label} ({v.id})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button onClick={reading ? stop : playCurrent} className={`tale-btn w-full !py-2.5 text-sm ${reading ? 'bg-slate-800 text-white' : 'tale-btn-ai'}`}>
              <i className={`fas ${reading ? 'fa-stop' : 'fa-volume-high'}`}></i> {reading ? '멈추기' : '이 페이지 읽어주기'}
            </button>
            <button onClick={() => setAutoRead(a => !a)} className={`tale-btn w-full !py-2.5 text-sm ${autoRead ? 'tale-btn-primary' : 'tale-btn-ghost !text-orange-600 !border-orange-200'}`}>
              <i className="fas fa-book-open-reader"></i> {autoRead ? '자동 읽기 끄기' : '표지부터 자동으로 읽기'}
            </button>
          </SideCard>



          <SideCard title="저장" icon="fa-cloud-arrow-down">
            <button onClick={onDownloadZip} disabled={downloading} className="tale-btn tale-btn-primary w-full !py-3 disabled:opacity-50">
              {downloading ? <><i className="fas fa-spinner loading-spin"></i> 저장 중...</> : <><i className="fas fa-cloud-download-alt"></i> 전체 저장 (ZIP)</>}
            </button>
          </SideCard>

        </aside>
      </div>

      {/* 저장용(화면 밖) — 표지·내지·엔딩을 그대로 그려서 이미지로 캡처해요 */}
      <div id="export-container" className="export-hidden">
        <PageLayout {...layoutProps} pageIdx={-1} isCover interactive={false} />
        {p.pages.map((_, idx) => <PageLayout key={idx} {...layoutProps} pageIdx={idx} interactive={false} />)}
        <PageLayout {...layoutProps} pageIdx={p.pages.length} isEnd interactive={false} />
      </div>
    </div>
  );
};

export default PreviewStep;
