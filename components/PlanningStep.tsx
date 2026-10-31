import React, { useEffect, useState } from 'react';
import { Project } from '../types';
import { clampSize, pageGeometry, SIZE_MAX, SIZE_MIN, SIZE_PRESETS } from '../utils';
import { STORYBOOK_STYLES, STYLE_DESCRIPTIONS } from '../constants';

interface Props {
  p: Project;
  patch: (v: Partial<Project>) => void;
  onStart: () => void;
  onShowSample: () => void;
  onAIPlan: (topic: string, age: string) => Promise<void>;
  onReset: () => void;
  planning: boolean;
}

const AGES = ['4~6세 (유아)', '7~9세 (초등 저학년)', '10~12세 (초등 고학년)'];

/** 책 크기 선택: 자주 쓰는 크기 버튼 + 가로·세로(mm) 직접 입력 + 배치 미리보기 */
const SizePicker: React.FC<{ w: number; h: number; full: boolean; onChange: (w: number, h: number) => void; onFull: (v: boolean) => void }> = ({ w, h, full, onChange, onFull }) => {
  const [wText, setWText] = useState(String(w));
  const [hText, setHText] = useState(String(h));
  // 버튼으로 바꾸거나 저장본을 불러오면 입력칸도 맞춰요
  useEffect(() => { setWText(String(w)); setHText(String(h)); }, [w, h]);

  const commit = (nextW: string, nextH: string) => {
    const nw = Number(nextW), nh = Number(nextH);
    if (nw >= SIZE_MIN && nw <= SIZE_MAX && nh >= SIZE_MIN && nh <= SIZE_MAX) onChange(Math.round(nw), Math.round(nh));
  };
  const geo = pageGeometry(w, h, full);
  const scale = 96 / Math.max(geo.w, geo.h); // 미리보기 상자를 96px 안에 맞춤
  const box = (mm: number) => `${mm * scale}px`;

  return (
    <div className="flex flex-col md:flex-row gap-5 items-stretch">
      <div className="flex-1 space-y-4">
        <div className="flex flex-wrap gap-2">
          {SIZE_PRESETS.map(l => {
            const on = w === l.w && h === l.h;
            return (
              <button key={l.id} onClick={() => onChange(l.w, l.h)}
                className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all ${on ? 'border-orange-400 bg-orange-50 text-orange-700 ring-4 ring-orange-100' : 'border-[#e9e3d9] bg-white text-slate-600 hover:bg-[#faf7f2]'}`}>
                {l.label} <span className="opacity-60 font-medium">{l.w}×{l.h}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-end gap-3">
          <label className="flex-1 space-y-1">
            <span className="tale-label">가로 (mm)</span>
            <input type="number" inputMode="numeric" min={SIZE_MIN} max={SIZE_MAX} className="tale-field" value={wText}
              onChange={e => { setWText(e.target.value); commit(e.target.value, hText); }}
              onBlur={() => { const v = String(clampSize(Number(wText))); setWText(v); commit(v, hText); }} />
          </label>
          <span className="pb-3.5 text-slate-300 font-semibold">×</span>
          <label className="flex-1 space-y-1">
            <span className="tale-label">세로 (mm)</span>
            <input type="number" inputMode="numeric" min={SIZE_MIN} max={SIZE_MAX} className="tale-field" value={hText}
              onChange={e => { setHText(e.target.value); commit(wText, e.target.value); }}
              onBlur={() => { const v = String(clampSize(Number(hText))); setHText(v); commit(wText, v); }} />
          </label>
        </div>
        <p className="text-xs text-slate-400 font-medium">{SIZE_MIN}~{SIZE_MAX}mm 사이에서 정해요. 크기에 맞춰 그림과 글 자리가 자동으로 나뉘어요.</p>
        <div className="space-y-2 pt-1">
          <span className="tale-label">그림 배치</span>
          <div className="grid grid-cols-2 gap-2">
            {([[false, '그림 + 글 따로', '그림 옆·아래에 글 자리'], [true, '그림 전체', '그림이 페이지를 가득 채워요 (글은 넣지 않아요)']] as const).map(([val, label, desc]) => (
              <button key={String(val)} onClick={() => onFull(val)}
                className={`text-left px-4 py-3 rounded-2xl border transition-all ${full === val ? 'border-orange-400 bg-orange-50 ring-4 ring-orange-100' : 'border-[#e9e3d9] bg-white hover:bg-[#faf7f2]'}`}>
                <div className={`text-sm font-semibold ${full === val ? 'text-orange-700' : 'text-slate-700'}`}>{label}</div>
                <div className="text-[11px] font-medium text-slate-400 mt-0.5">{desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 배치 미리보기 */}
      <div className="md:w-44 flex flex-col items-center justify-center gap-2 bg-[#faf7f2] rounded-2xl border border-[#efe9df] p-4">
        {geo.mode === 'full' ? (
          <div className="bg-orange-200/70 border border-slate-300 rounded-[3px] shadow-sm relative overflow-hidden" style={{ width: box(geo.w), height: box(geo.h) }}>
          </div>
        ) : (
        <div className="bg-white border border-slate-300 rounded-[3px] shadow-sm relative flex" style={{ width: box(geo.w), height: box(geo.h), flexDirection: geo.mode === 'side' ? 'row' : 'column', padding: box(geo.pad), gap: box(4) }}>
          <div className="bg-orange-200/70 rounded-[2px]" style={{ width: box(geo.imgW), height: box(geo.imgH), flexShrink: 0 }}></div>
          <div className="flex flex-col justify-center gap-[3px]" style={{ width: box(geo.textW), height: box(geo.textH) }}>
            <div className="h-[3px] bg-slate-300 rounded"></div>
            <div className="h-[3px] bg-slate-300 rounded w-4/5"></div>
          </div>
        </div>
        )}
        <span className="text-[11px] font-semibold text-slate-400">{geo.w} × {geo.h} mm</span>
      </div>
    </div>
  );
};

const PlanningStep: React.FC<Props> = ({ p, patch, onStart, onShowSample, onAIPlan, onReset, planning }) => {
  // 줄거리·연령은 프로젝트에 저장돼요(다른 화면에 갔다 와도, 새로고침해도 남아요)
  const topic = p.storyTopic;
  const age = p.storyAge;

  return (
    <div className="p-6 md:p-14 max-w-3xl mx-auto space-y-10 animate-fadeIn text-slate-900 pb-16">
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-bold tracking-tight">동화책 기획하기</h2>
        <p className="text-slate-500 font-cute text-3xl">세상에 단 하나뿐인 이야기를 상상해 보세요</p>
      </div>

      {/* AI 이야기 도우미 */}
      <div className="bg-gradient-to-br from-indigo-50 to-orange-50 border-2 border-indigo-100 rounded-2xl p-8 space-y-5 shadow-inner">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl shadow-lg"><i className="fas fa-wand-magic-sparkles"></i></span>
          <div>
            <h3 className="text-xl font-bold text-indigo-900">AI가 이야기를 대신 만들어줘요</h3>
            <p className="text-sm font-medium text-slate-500">아이디어 한 줄이면 제목·등장인물·쪽별 글과 그림 설명까지 채워줍니다. (직접 쓰고 싶다면 건너뛰어도 돼요)</p>
          </div>
        </div>
        <textarea
          value={topic}
          onChange={e => patch({ storyTopic: e.target.value })}
          placeholder="예) 겁이 많은 아기 토끼가 달빛 숲에서 새 친구를 만나는 이야기"
          className="tale-field h-28 !bg-white text-base resize-none"
        />
        <div className="flex flex-col md:flex-row gap-4">
          <select value={age} onChange={e => patch({ storyAge: e.target.value })} className="tale-field flex-1 !bg-white cursor-pointer">
            {AGES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <label className="flex items-center gap-3 md:w-44 shrink-0">
            <span className="tale-label whitespace-nowrap">쪽수</span>
            <input type="number" className="tale-field !bg-white" min={1} max={40} value={p.pageCount} onChange={e => patch({ pageCount: Math.min(40, Math.max(1, Number(e.target.value) || 1)) })} />
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_15rem] gap-x-6 gap-y-5">
        {/* 왼쪽 넓은 열: 제목 + 그림 스타일 / 오른쪽 좁은 열: 만든이 + AI 이야기 만들기 버튼 */}
        <div className="space-y-2">
          <label className="tale-label">동화책 제목</label>
          <input className="tale-field" value={p.title} onChange={e => patch({ title: e.target.value })} placeholder="제목을 지어주세요" />
        </div>
        <div className="space-y-2">
          <label className="tale-label">만든이 성함</label>
          <input className="tale-field" value={p.author} onChange={e => patch({ author: e.target.value })} placeholder="만든이 이름" />
        </div>
        <div className="space-y-2">
          <label className="tale-label">그림 스타일</label>
          <div className="flex gap-2">
            <select className="tale-field flex-1 min-w-0 cursor-pointer" value={p.style} onChange={e => patch({ style: e.target.value })}>
              {STORYBOOK_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={onShowSample} className="tale-btn tale-btn-ai !rounded-xl !px-4 shrink-0">
              <i className="fas fa-magic"></i> 샘플
            </button>
          </div>
          {STYLE_DESCRIPTIONS[p.style] && (
            <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1.5 pt-0.5">
              <i className="fas fa-paintbrush text-orange-400 text-[10px]"></i>
              <span>{STYLE_DESCRIPTIONS[p.style]}</span>
            </p>
          )}
        </div>
        <div className="space-y-2">
          <label className="tale-label">AI로 이야기 만들기</label>
          <button
            onClick={() => onAIPlan(topic, age)}
            disabled={planning || !topic.trim()}
            title={topic.trim() ? '' : '위 칸에 줄거리를 먼저 적어 주세요'}
            className="tale-btn tale-btn-ai w-full !py-3.5 disabled:opacity-40"
          >
            {planning ? <><i className="fas fa-spinner loading-spin"></i> 이야기 짓는 중...</> : <><i className="fas fa-feather-pointed"></i> 이야기 만들기 ({p.pageCount}쪽)</>}
          </button>
        </div>
        <div className="space-y-2 col-span-full">
          <label className="tale-label">책 크기</label>
          <SizePicker w={p.pageW} h={p.pageH} full={p.fullImage} onChange={(w, h) => patch({ pageW: w, pageH: h })} onFull={v => patch({ fullImage: v })} />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="button"
          onClick={onReset}
          className="px-6 py-4 bg-white hover:bg-red-50 border border-red-200 text-red-600 rounded-2xl font-bold text-base transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer shrink-0"
          title="작성 중이던 모든 내용을 지우고 처음부터 새로 시작합니다"
        >
          <i className="fas fa-rotate-left"></i>
          <span>새로 시작(초기화)</span>
        </button>
        <button
          type="button"
          onClick={onStart}
          className="tale-btn tale-btn-primary flex-1 !py-4 text-lg shadow-md"
        >
          동화 만들기 시작!
        </button>
      </div>
    </div>
  );
};

export default PlanningStep;
