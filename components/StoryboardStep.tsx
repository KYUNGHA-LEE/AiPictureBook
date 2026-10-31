import React, { useEffect, useRef, useState } from 'react';
import { Character, Location, Project, StoryPage } from '../types';
import { HORIZONTAL_ANGLES, SHOT_TYPES, SPECIAL_POVS, VERTICAL_ANGLES } from '../constants';
import { effectiveChars, effectiveLocation, parseTsv, readFileAsDataUrl } from '../utils';

interface Props {
  p: Project;
  patch: (v: Partial<Project>) => void;
  updatePage: (idx: number, v: Partial<StoryPage>) => void;
  updateChar: (id: number, v: Partial<Character>) => void;
  updateLoc: (id: number, v: Partial<Location>) => void;
  busy: Record<string, boolean>;
  onGenerate: (idx: number) => void;
  onGenerateAll: () => void;
  onEnhance: (idx: number) => void;
  onEdit: (idx: number, instruction: string) => void;
  onCharSheet: (id: number) => void;
  onLocSheet: (id: number) => void;
  onAnalyze: () => void;
  onAssetsAll: () => void;
  onAIPlan: (topic: string, age: string) => Promise<boolean>;
  planning: boolean;
  onBack: () => void;
  onPreview: () => void;
  onOpenApiKeyModal?: () => void;
  onAutoAssignLocations?: () => void;
}

const AGES = ['4~6세 (유아)', '7~9세 (초등 저학년)', '10~12세 (초등 고학년)'];

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-semibold text-slate-400">{children}</label>
);

const DirectSelect: React.FC<{ label: string; value?: string; options: string[]; onChange: (v: string) => void }> = ({ label, value, options, onChange }) => (
  <div className="space-y-1">
    <Label>{label}</Label>
    <select className="tale-field !py-2 !px-3 text-xs" value={value || '선택 안함'} onChange={e => onChange(e.target.value)}>
      {options.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  </div>
);

const StoryboardStep: React.FC<Props> = ({ p, patch, updatePage, updateChar, updateLoc, busy, onGenerate, onGenerateAll, onEnhance, onEdit, onCharSheet, onLocSheet, onAnalyze, onAssetsAll, onAIPlan, planning, onBack, onPreview, onOpenApiKeyModal, onAutoAssignLocations }) => {
  const imageInputs = useRef<Record<number, HTMLInputElement | null>>({});
  const [editText, setEditText] = useState<Record<number, string>>({});
  const [openDirect, setOpenDirect] = useState<Record<number, boolean>>({});
  const [zoom, setZoom] = useState<number | null>(null); // 크게 보는 페이지 번호
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [scriptTopic, setScriptTopic] = useState(p.storyTopic || '');
  const [scriptAge, setScriptAge] = useState(p.storyAge || AGES[1]);
  const withImage = p.pages.map((pg, i) => (pg.imageUrl ? i : -1)).filter(i => i >= 0);
  const moveZoom = (dir: -1 | 1) => {
    if (zoom === null) return;
    const pos = withImage.indexOf(zoom);
    const next = withImage[pos + dir];
    if (next !== undefined) setZoom(next);
  };
  useEffect(() => {
    if (zoom === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoom(null);
      else if (e.key === 'ArrowLeft') moveZoom(-1);
      else if (e.key === 'ArrowRight') moveZoom(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, p.pages]);
  const hasDirecting = (pg: StoryPage) => [pg.shotType, pg.verticalAngle, pg.horizontalAngle, pg.specialPOV].some(v => v && v !== '선택 안함');

  const handleBulkPaste = (e: React.ClipboardEvent, startIdx: number) => {
    const data = e.clipboardData.getData('text');
    if (!data || !data.includes('\t')) return;
    e.preventDefault();
    const rows = parseTsv(data);
    const pages = p.pages.map(pg => ({ ...pg }));
    rows.forEach((cols, r) => {
      const t = startIdx + r;
      if (t >= pages.length) return;
      if (cols[0] !== undefined) pages[t].content = cols[0].trim();
      if (cols[1] !== undefined) pages[t].sceneIdea = cols[1].trim();
    });
    patch({ pages });
  };

  const uploadChars = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: Character[] = [];
    for (const file of Array.from(files)) {
      added.push({ id: Date.now() + Math.random(), name: file.name.split('.')[0], imageData: await readFileAsDataUrl(file) });
    }
    const emptyDefault = p.characters.length === 1 && !p.characters[0].imageData && !p.characters[0].name;
    patch({ characters: emptyDefault ? added : [...p.characters, ...added] });
  };

  const toggleChar = (pageIdx: number, id: number) => {
    const page = p.pages[pageIdx];
    const current = effectiveChars(page, p.characters).map(c => c.id);
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    updatePage(pageIdx, { characterIds: next });
  };

  const anyBusy = Object.values(busy).some(Boolean);
  const done = p.pages.filter(pg => pg.imageUrl).length;

  const handleInsertScript = async () => {
    if (!scriptTopic.trim()) return;
    const ok = await onAIPlan(scriptTopic, scriptAge);
    if (ok) setShowScriptModal(false);
  };

  return (
    <div className="p-6 md:p-8 space-y-8 animate-fadeIn text-slate-900">
      <div className="flex flex-col xl:flex-row justify-between xl:items-end border-b border-[#efe9df] pb-7 gap-5">
        <div className="text-left">
          <button onClick={onBack} className="text-slate-400 text-sm font-medium hover:text-orange-600 flex items-center gap-2 transition-colors mb-2"><i className="fas fa-chevron-left"></i> 기획 단계로 돌아가기</button>
          <h2 className="text-3xl font-bold tracking-tight">우리 동화 장면 만들기</h2>
          <div className="mt-3 flex items-center gap-3"><div className="h-1.5 w-40 rounded-full bg-[#efe9df] overflow-hidden"><div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${p.pages.length ? (done / p.pages.length) * 100 : 0}%` }}></div></div><span className="text-sm font-medium text-slate-500">그림 {done} / {p.pages.length}장 완성</span></div>
        </div>
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => setShowScriptModal(true)} disabled={anyBusy || planning} className="tale-btn tale-btn-ai !px-6 !py-3.5 disabled:opacity-40 shadow-sm">
            {planning ? <><i className="fas fa-spinner loading-spin"></i> 원고 작성 중...</> : <><i className="fas fa-feather-pointed"></i> AI 원고 삽입</>}
          </button>
          <button onClick={onGenerateAll} disabled={anyBusy || planning} className="tale-btn tale-btn-primary !px-6 !py-3.5 disabled:opacity-40">
            {busy['all'] ? <><i className="fas fa-spinner loading-spin"></i> 그리는 중...</> : <><i className="fas fa-wand-magic-sparkles"></i> 빈 페이지 그림 모두 만들기</>}
          </button>
          <button onClick={onPreview} className="tale-btn tale-btn-ghost !px-7 !py-3.5 font-bold"><i className="fas fa-eye"></i> 동화책 미리보기</button>
        </div>
      </div>

      {/* 캐릭터·장소는 본문을 쓰면 자동으로 찾고 그려요. 필요할 때만 쓰는 작은 도구 */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs font-medium text-slate-400">
        <span className="flex items-center gap-2">
          {busy['analyze'] ? <><i className="fas fa-spinner loading-spin text-indigo-400"></i> 본문을 읽고 캐릭터·장소를 찾는 중...</>
            : busy['assets'] ? <><i className="fas fa-spinner loading-spin text-indigo-400"></i> 캐릭터·장소 그림을 만드는 중...</>
            : <><i className="fas fa-wand-magic-sparkles text-indigo-300"></i> 본문을 쓰면 캐릭터와 장소를 AI가 자동으로 찾아서 그려요</>}
        </span>
        <span className="flex gap-2 flex-wrap items-center">
          {onAutoAssignLocations && (
            <button
              onClick={onAutoAssignLocations}
              className="px-3 py-1 rounded-full bg-orange-100/80 hover:bg-orange-200 text-orange-900 font-bold transition-all flex items-center gap-1.5 shadow-xs text-xs"
              title="경비원, 소방관, 택배 기사 등 등장인물에 맞추어 각 페이지의 배경과 장소를 다르게 자동 배정합니다."
            >
              <i className="fas fa-building-user text-[11px] text-orange-600"></i> 등장인물별 배경/장소 자동 맞춤
            </button>
          )}
          <button onClick={onAnalyze} disabled={busy['analyze']} className="px-2.5 py-1 rounded-full hover:bg-white hover:text-indigo-600 disabled:opacity-40 transition-all">다시 찾기</button>
          <button onClick={onAssetsAll} disabled={busy['assets'] || busy['analyze']} className="px-2.5 py-1 rounded-full hover:bg-white hover:text-indigo-600 disabled:opacity-40 transition-all">빠진 그림 만들기</button>
        </span>
      </div>

      {/* 캐릭터 */}
      <div className="bg-[#fdf9f4] p-6 md:p-8 rounded-3xl border border-[#f3e8d9]">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
          <h3 className="text-slate-900 font-bold text-xl flex items-center gap-2.5"><i className="fas fa-palette"></i> 주인공 캐릭터 등록</h3>
          <div className="relative">
            <button className="tale-btn tale-btn-ghost !py-2 !px-4 text-sm">파일 여러개 올리기</button>
            <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => { uploadChars(e.target.files); e.target.value = ''; }} />
          </div>
        </div>
        <p className="text-sm font-medium text-slate-500 mb-6">외모 설명을 적고 <b>AI 캐릭터 시트</b>를 만들면, 모든 페이지에서 같은 모습으로 그려져요. 사진이나 그림을 올려도 됩니다.</p>
        <div className="flex flex-wrap gap-8">
          {p.characters.map(char => (
            <div key={char.id} className="flex flex-col items-center gap-3 w-44">
              <div className="w-28 h-28 bg-white rounded-2xl border border-dashed border-orange-300 flex items-center justify-center relative overflow-hidden shadow-sm hover:border-orange-500 transition-all p-2">
                {busy[`char-${char.id}`] ? (
                  <i className="fas fa-paint-brush loading-spin text-orange-400 text-3xl"></i>
                ) : char.imageData ? (
                  <img src={char.imageData} className="w-full h-full object-contain" />
                ) : (
                  <i className="fas fa-user-astronaut text-orange-200 text-3xl"></i>
                )}
                <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) updateChar(char.id, { imageData: await readFileAsDataUrl(f), name: char.name || f.name.split('.')[0] });
                  e.target.value = '';
                }} />
              </div>
              <input className="tale-field !py-2.5 text-center text-sm !bg-white" value={char.name} onChange={e => updateChar(char.id, { name: e.target.value })} placeholder="이름" />
              <textarea className="tale-field !py-2.5 text-xs !bg-white h-20 resize-none" value={char.description || ''} onChange={e => updateChar(char.id, { description: e.target.value })} placeholder="외모 설명 (예: 분홍 코의 흰 아기 토끼, 노란 우비)" />
              <div className="flex gap-2">
                <button onClick={() => onCharSheet(char.id)} disabled={busy[`char-${char.id}`] || (!char.description?.trim() && !char.imageData)}
                  className="tale-btn tale-btn-ai !py-1.5 !px-3 !rounded-full text-xs disabled:opacity-40">
                  <i className="fas fa-wand-magic-sparkles"></i> {char.imageData ? '시트 다시' : 'AI 시트'}
                </button>
                <button onClick={() => patch({ characters: p.characters.filter(c => c.id !== char.id) })} className="px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-red-500">삭제</button>
              </div>
            </div>
          ))}
          <button onClick={() => patch({ characters: [...p.characters, { id: Date.now(), name: '', imageData: null }] })} className="w-12 h-12 rounded-full bg-white border border-dashed border-orange-300 text-orange-400 flex items-center justify-center hover:bg-orange-500 hover:text-white hover:border-orange-500 transition-all self-center"><i className="fas fa-plus text-xl"></i></button>
        </div>
      </div>

      {/* 장소(로케이션) 에셋 */}
      <div className="bg-[#f6f7fc] p-6 md:p-8 rounded-3xl border border-[#e3e8f6]">
        <div className="flex justify-between items-center mb-3 flex-wrap gap-3">
          <h3 className="text-slate-900 font-bold text-xl flex items-center gap-2.5"><i className="fas fa-house-chimney-window"></i> 장소(로케이션) 등록</h3>
          <button onClick={() => patch({ locations: [...p.locations, { id: Date.now(), name: '', imageData: null }] })} className="tale-btn tale-btn-ghost !py-2 !px-4 text-sm"><i className="fas fa-plus"></i> 장소 추가</button>
        </div>
        <p className="text-sm font-medium text-slate-500 mb-6">방이나 마당처럼 <b>여러 장면에 반복되는 곳</b>을 등록하세요. 가구·창문·문의 위치를 적고 <b>AI 장소 만들기</b>를 누르면, 그 장소가 나오는 모든 페이지에서 같은 구조로 그려져요. 장소 이름이 본문에 나오면 자동으로 연결돼요.</p>
        <div className="flex flex-wrap gap-6">
          {p.locations.map(loc => (
            <div key={loc.id} className="flex flex-col gap-3 w-60">
              <div className="aspect-video bg-white rounded-2xl border border-dashed border-indigo-300 flex items-center justify-center relative overflow-hidden shadow-sm hover:border-indigo-500 transition-all">
                {busy[`loc-${loc.id}`] ? (
                  <i className="fas fa-paint-brush loading-spin text-indigo-400 text-3xl"></i>
                ) : loc.imageData ? (
                  <img src={loc.imageData} className="w-full h-full object-cover" />
                ) : (
                  <div className="text-center p-2"><i className="fas fa-cloud-upload-alt text-indigo-300 text-2xl mb-1"></i><p className="text-[11px] font-semibold text-indigo-400">그림 올리기 / AI로 만들기</p></div>
                )}
                <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f) updateLoc(loc.id, { imageData: await readFileAsDataUrl(f), name: loc.name || f.name.split('.')[0] });
                  e.target.value = '';
                }} />
              </div>
              <input className="tale-field !py-2.5 text-sm !bg-white" value={loc.name} onChange={e => updateLoc(loc.id, { name: e.target.value })} placeholder="장소 이름 (예: 토토의 방)" />
              <textarea className="tale-field !py-2.5 text-xs !bg-white h-24 resize-none" value={loc.description || ''} onChange={e => updateLoc(loc.id, { description: e.target.value })} placeholder="고정된 구조 (예: 작은 방. 왼쪽 벽 아래 파란 침대, 오른쪽 벽에 둥근 창문, 정면에 나무 문, 바닥엔 노란 러그)" />
              <div className="flex gap-2 items-center">
                <button onClick={() => onLocSheet(loc.id)} disabled={busy[`loc-${loc.id}`] || (!loc.description?.trim() && !loc.imageData)}
                  className="tale-btn tale-btn-ai !py-1.5 !px-3 !rounded-full text-xs disabled:opacity-40">
                  <i className="fas fa-wand-magic-sparkles"></i> {loc.imageData ? '장소 다시' : 'AI 장소 만들기'}
                </button>
                <button onClick={() => patch({ locations: p.locations.filter(l => l.id !== loc.id) })} className="px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-red-500">삭제</button>
              </div>
            </div>
          ))}
          {!p.locations.length && <p className="text-sm font-medium text-slate-400 py-4">아직 등록한 장소가 없어요. 오른쪽 위 "장소 추가"를 눌러 보세요.</p>}
        </div>
      </div>

      {/* 작가의 원고가 있을 때 / 없을 때 2가지 방법 안내 배너 */}
      <div className="bg-gradient-to-r from-amber-50/90 via-orange-50/70 to-indigo-50/80 border border-orange-200/90 rounded-3xl p-5 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-2 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
              <i className="fas fa-pen"></i> 작가의 원고가 있을 때
            </span>
            <span className="text-xs font-semibold text-slate-700">아래 표의 <b>[동화책 본문]</b> 칸에 직접 글을 적거나 복사해 넣으세요.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-800 border border-indigo-200">
              <i className="fas fa-wand-magic-sparkles"></i> 작가의 원고가 없을 때
            </span>
            <span className="text-xs font-semibold text-slate-700"><b>[AI 원고 삽입]</b>을 누르면 줄거리 한 줄로 {p.pages.length}쪽 전체 원고를 채워줍니다.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-orange-200/60">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
              <i className="fas fa-building-user"></i> 등장인물별 배경 차별화
            </span>
            <span className="text-xs font-semibold text-slate-700">경비원(아파트 단지 정문 경비초소), 소방관(소방서 차고지), 택배기사(택배 탑차) 등 한국적 고증과 인물 일터에 맞춰 배경이 다르게 연출됩니다.</span>
            {onAutoAssignLocations && (
              <button
                type="button"
                onClick={onAutoAssignLocations}
                className="ml-auto px-3 py-1 bg-white hover:bg-orange-100 border border-orange-300 text-orange-800 font-bold rounded-xl text-xs transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fas fa-magic text-[10px] text-orange-600"></i>인물별 배경/장소 일괄 배정
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowScriptModal(true)}
          disabled={anyBusy || planning}
          className="tale-btn tale-btn-ai !py-2.5 !px-5 text-sm shrink-0 shadow-sm"
        >
          <i className="fas fa-feather-pointed"></i> AI 원고 삽입하기
        </button>
      </div>

      {/* 페이지 표 */}
      <div className="bg-white border border-[#efe9df] rounded-3xl overflow-x-auto">
        <table className="w-full text-left border-collapse table-fixed min-w-[1180px]">
          <thead className="bg-[#faf7f2] border-b border-[#efe9df]">
            <tr>
              <th className="p-4 text-xs font-semibold text-slate-400 w-14 text-center uppercase tracking-wider">PAGE</th>
              <th style={{ width: 'calc((100% - 3.5rem) / 4)' }} className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                동화책 본문 <span className="text-[11px] font-normal text-orange-600 bg-orange-50 px-2 py-0.5 rounded-md ml-1">직접 수정 가능 ✏️</span>
              </th>
              <th style={{ width: 'calc((100% - 3.5rem) / 4)' }} className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">장소</th>
              <th style={{ width: 'calc((100% - 3.5rem) / 4)' }} className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">AI 그림 설명 (프롬프트)</th>
              <th style={{ width: 'calc((100% - 3.5rem) / 4)' }} className="p-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">AI 일러스트</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f3eee6]">
            {p.pages.map((page, idx) => {
              const inScene = effectiveChars(page, p.characters).map(c => c.id);
              return (
                <tr key={page.id} className="hover:bg-slate-50/30 transition-colors align-top">
                  <td className="p-4 text-center font-bold text-slate-300 text-3xl">{idx + 1}</td>
                  <td className="p-4">
                    <textarea
                      className="tale-field h-60 text-base leading-relaxed resize-none placeholder:text-slate-300 focus:bg-white"
                      value={page.content}
                      onPaste={e => handleBulkPaste(e, idx)}
                      onChange={e => updatePage(idx, { content: e.target.value })}
                      placeholder="이야기를 직접 입력하거나 위 [AI 원고 삽입]을 눌러보세요. (언제든지 수정 가능)"
                    />
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1">
                        <Label>이 장면의 장소 {page.locationId === undefined ? '(글에서 자동)' : ''}</Label>
                        <select
                          className="tale-field !py-2 !px-3 text-xs"
                          value={page.locationId === undefined ? 'auto' : page.locationId === null ? 'none' : String(page.locationId)}
                          onChange={e => updatePage(idx, { locationId: e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : Number(e.target.value) })}
                        >
                          <option value="auto">자동 (등장인물/글에서 찾기)</option>
                          <option value="none">장소 고정 없음 (장면에 맞게 자유 배경)</option>
                          {p.locations.filter(l => l.name).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      {(() => {
                        const loc = effectiveLocation(page, p.locations);
                        return (
                          <div className="w-full aspect-video bg-[#f4f6fb] rounded-xl border border-indigo-100 flex items-center justify-center overflow-hidden text-center p-2">
                            {loc?.imageData ? (
                              <img src={loc.imageData} className="w-full h-full object-cover" />
                            ) : loc ? (
                              <div className="space-y-1">
                                <span className="inline-block px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 text-[11px] font-bold">
                                  {loc.name}
                                </span>
                                <p className="text-[10px] text-slate-500 font-medium line-clamp-2 px-1">
                                  {loc.description || '인물에 맞춘 고유 배경'}
                                </p>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                <p className="text-[11px] font-bold text-slate-400">자유 배경</p>
                                <p className="text-[10px] text-slate-400">장면 설명과 인물에 맞춰 생성</p>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <label className="text-[11px] font-semibold text-slate-400 hover:text-orange-600 cursor-pointer self-start">
                        {page.bgImageData ? '직접 올린 배경 사용 중 · 바꾸기' : '+ 배경을 직접 올리기'}
                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                          const f = e.target.files?.[0];
                          if (f) updatePage(idx, { bgImageData: await readFileAsDataUrl(f) });
                          e.target.value = '';
                        }} />
                      </label>
                      {page.bgImageData && <button onClick={() => updatePage(idx, { bgImageData: null })} className="text-[10px] font-semibold text-red-400 hover:text-red-600 self-start">직접 올린 배경 지우기</button>}
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="flex flex-col gap-3">
                      <textarea
                        className="tale-field h-40 text-sm leading-relaxed resize-none placeholder:text-slate-300 !bg-[#fdf9f4]"
                        value={page.sceneIdea}
                        onChange={e => updatePage(idx, { sceneIdea: e.target.value })}
                        placeholder="그림에 대한 설명. 짧게 써도 AI가 채워줘요!"
                      />
                      <button onClick={() => onEnhance(idx)} disabled={busy[`enh-${idx}`]} className="tale-btn tale-btn-ghost self-start !py-1.5 !px-3.5 !rounded-full text-xs !text-indigo-600 !border-indigo-200 hover:!bg-indigo-50 disabled:opacity-40">
                        {busy[`enh-${idx}`] ? <><i className="fas fa-spinner loading-spin"></i> 다듬는 중...</> : <><i className="fas fa-pen-fancy"></i> AI가 설명 다듬기</>}
                      </button>
                      <div>
                        <Label>이 장면에 나오는 캐릭터 {page.characterIds ? '(직접 선택)' : '(글에서 자동)'}</Label>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {p.characters.filter(c => c.name).map(c => (
                            <button key={c.id} onClick={() => toggleChar(idx, c.id)} className={`px-3 py-1 rounded-full text-xs font-semibold border transition-all ${inScene.includes(c.id) ? 'bg-orange-500 border-orange-500 text-white' : 'bg-white border-[#e5dfd4] text-slate-400 hover:text-slate-600'}`}>{c.name}</button>
                          ))}
                          {!p.characters.some(c => c.name) && <span className="text-xs font-bold text-slate-300">캐릭터 이름을 먼저 적어 주세요</span>}
                        </div>
                      </div>
                      <div>
                        <Label>그림 속에 넣을 글자 (선택 · 말풍선/간판 등)</Label>
                        <input className="tale-field mt-1 !py-2.5 text-sm" value={page.textInImage || ''} onChange={e => updatePage(idx, { textInImage: e.target.value })} placeholder='예) "안녕, 달님!"' />
                      </div>
                    </div>
                  </td>
                  <td className="p-4">
                    <div className="space-y-3">
                        <div
                          className={`aspect-square bg-[#faf7f2] rounded-2xl border border-dashed border-[#d9cfbf] flex items-center justify-center relative overflow-hidden shadow-inner group/illust transition-all hover:border-orange-300 ${page.imageUrl ? 'cursor-zoom-in' : 'cursor-pointer'}`}
                          onClick={() => (page.imageUrl ? setZoom(idx) : imageInputs.current[idx]?.click())}
                        >
                          {busy[`img-${idx}`] && (
                            <div className="absolute inset-0 bg-white/90 z-20 flex flex-col items-center justify-center text-xs font-semibold text-orange-600">
                              <i className="fas fa-paint-brush loading-spin text-2xl mb-2"></i>그리는 중...
                            </div>
                          )}
                          {page.imageUrl ? (
                            <>
                              <img src={page.imageUrl} className="w-full h-full object-cover animate-fadeIn" />
                              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/illust:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 z-10">
                                <span className="text-white text-xs font-semibold"><i className="fas fa-magnifying-glass-plus mr-1"></i>눌러서 크게 보기</span>
                                <button onClick={e => { e.stopPropagation(); imageInputs.current[idx]?.click(); }} className="bg-white text-slate-900 px-3 py-1.5 rounded-full font-semibold text-xs shadow-md hover:scale-105 transition-transform"><i className="fas fa-upload"></i> 다른 그림</button>
                                <a onClick={e => e.stopPropagation()} href={page.imageUrl} download={`${p.title}_${idx + 1}페이지_일러스트.png`} className="bg-orange-500 text-white px-3 py-1.5 rounded-full font-semibold text-xs shadow-md hover:scale-105 transition-transform"><i className="fas fa-download"></i> 저장</a>
                              </div>
                            </>
                          ) : (
                            <div className="text-slate-300 font-semibold text-center group-hover/illust:text-orange-300 transition-colors">
                              <i className="fas fa-image text-3xl mb-2 block opacity-30"></i>
                              <p className="text-xs">그림을 생성하거나<br />클릭해서 업로드</p>
                            </div>
                          )}
                          <input type="file" accept="image/*" ref={el => { imageInputs.current[idx] = el; }} className="hidden" onChange={async e => {
                            const f = e.target.files?.[0];
                            if (f) updatePage(idx, { imageUrl: await readFileAsDataUrl(f) });
                            e.target.value = '';
                          }} />
                        </div>
                        <button onClick={() => onGenerate(idx)} disabled={busy[`img-${idx}`]} title={page.imageUrl ? 'AI로 다시 그리기' : 'AI 그림 생성하기'}
                          className="tale-btn tale-btn-primary w-full !py-2.5 text-sm disabled:opacity-40">
                          <i className={`fas ${page.imageUrl ? 'fa-rotate' : 'fa-wand-magic-sparkles'}`}></i> {page.imageUrl ? 'AI로 다시 그리기' : 'AI로 그림 그리기'}
                        </button>
                        {page.imageUrl && (
                          <div className="flex gap-2">
                            <input
                              className="tale-field flex-1 min-w-0 !py-2 !px-3 text-xs"
                              placeholder="말로 고치기: 귀를 더 길게"
                              value={editText[idx] || ''}
                              onChange={e => setEditText({ ...editText, [idx]: e.target.value })}
                              onKeyDown={e => { if (e.key === 'Enter' && editText[idx]?.trim() && !busy[`img-${idx}`]) { onEdit(idx, editText[idx]); setEditText({ ...editText, [idx]: '' }); } }}
                            />
                            <button
                              onClick={() => { onEdit(idx, editText[idx]); setEditText({ ...editText, [idx]: '' }); }}
                              disabled={!editText[idx]?.trim() || busy[`img-${idx}`]}
                              className="tale-btn tale-btn-ai !py-2 !px-3 text-xs shrink-0 disabled:opacity-40"
                            >고치기</button>
                          </div>
                        )}
                        {page.imageUrl && (
                          <div className="space-y-2">
                            <button onClick={() => setOpenDirect({ ...openDirect, [idx]: !openDirect[idx] })} className="text-xs font-semibold text-slate-400 hover:text-orange-600 flex items-center gap-1.5 transition-colors">
                              <i className={`fas fa-chevron-${openDirect[idx] ? 'up' : 'down'} text-[10px]`}></i> 연출 추가해서 다시 그리기
                              {hasDirecting(page) && <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>}
                            </button>
                            {openDirect[idx] && (
                              <div className="grid grid-cols-2 gap-2 p-3 rounded-2xl bg-[#faf7f2] border border-[#efe9df]">
                                <DirectSelect label="샷 종류(거리감)" value={page.shotType} options={SHOT_TYPES} onChange={v => updatePage(idx, { shotType: v })} />
                                <DirectSelect label="수직 각도" value={page.verticalAngle} options={VERTICAL_ANGLES} onChange={v => updatePage(idx, { verticalAngle: v })} />
                                <DirectSelect label="수평 각도" value={page.horizontalAngle} options={HORIZONTAL_ANGLES} onChange={v => updatePage(idx, { horizontalAngle: v })} />
                                <DirectSelect label="특수 시점" value={page.specialPOV} options={SPECIAL_POVS} onChange={v => updatePage(idx, { specialPOV: v })} />
                                <button onClick={() => onGenerate(idx)} disabled={busy[`img-${idx}`]} className="tale-btn tale-btn-primary col-span-2 !py-2 text-xs disabled:opacity-40">
                                  <i className="fas fa-rotate"></i> 이 연출로 다시 그리기
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 그림 크게 보기 */}
      {zoom !== null && p.pages[zoom]?.imageUrl && (
        <div className="fixed inset-0 z-[120] bg-slate-900/85 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn" onClick={() => setZoom(null)}>
          <button onClick={() => setZoom(null)} className="absolute top-5 right-5 w-11 h-11 rounded-full bg-white/15 text-white hover:bg-white/30 transition-all" title="닫기 (Esc)"><i className="fas fa-times"></i></button>
          {withImage.indexOf(zoom) > 0 && (
            <button onClick={e => { e.stopPropagation(); moveZoom(-1); }} className="absolute left-4 md:left-8 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 text-white hover:bg-white/30 transition-all" title="이전 그림 (←)"><i className="fas fa-chevron-left"></i></button>
          )}
          {withImage.indexOf(zoom) < withImage.length - 1 && (
            <button onClick={e => { e.stopPropagation(); moveZoom(1); }} className="absolute right-4 md:right-8 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 text-white hover:bg-white/30 transition-all" title="다음 그림 (→)"><i className="fas fa-chevron-right"></i></button>
          )}
          <div className="max-w-[min(92vw,960px)] flex flex-col items-center gap-3" onClick={e => e.stopPropagation()}>
            <img src={p.pages[zoom].imageUrl!} className="max-h-[78vh] max-w-full rounded-2xl shadow-2xl object-contain bg-white" />
            <div className="flex items-center gap-4 text-white text-sm font-semibold">
              <span>{zoom + 1}쪽</span>
              <a href={p.pages[zoom].imageUrl!} download={`${p.title}_${zoom + 1}페이지_일러스트.png`} className="px-4 py-1.5 rounded-full bg-orange-500 hover:bg-orange-600 transition-all"><i className="fas fa-download mr-1.5"></i>저장</a>
            </div>
            {p.pages[zoom].content && <p className="max-w-xl text-center text-white/80 text-sm leading-relaxed">{p.pages[zoom].content}</p>}
          </div>
        </div>
      )}

      {/* AI 원고 삽입 모달 */}
      {showScriptModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl p-7 md:p-8 max-w-lg w-full shadow-2xl border border-[#efe9df] space-y-5 relative">
            <button
              onClick={() => setShowScriptModal(false)}
              className="absolute top-5 right-5 w-10 h-10 rounded-full bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-all"
            >
              <i className="fas fa-times"></i>
            </button>
            <div className="space-y-1">
              <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full inline-block mb-1">
                <i className="fas fa-wand-magic-sparkles mr-1"></i>이야기 자동 작성
              </span>
              <h3 className="text-xl font-bold tracking-tight text-slate-900">AI 원고 삽입</h3>
              <p className="text-xs font-medium text-slate-500 leading-relaxed">
                줄거리나 아이디어를 한 줄만 적어주시면, {p.pages.length}쪽 전체의 <b>본문(원고)과 그림 설명</b>을 AI가 자동으로 작성해 표에 채워줍니다.
              </p>
            </div>

            {p.characters.some(c => c.name?.trim()) && (
              <div className="bg-orange-50/70 border border-orange-200/80 rounded-2xl p-3 text-xs text-orange-900 font-semibold flex items-center gap-2">
                <i className="fas fa-user-astronaut text-orange-500"></i>
                <span>등록된 등장인물 <b>{p.characters.filter(c => c.name).map(c => c.name).join(', ')}</b>(이)가 주인공으로 활약해요!</span>
              </div>
            )}

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="tale-label">동화 줄거리 / 아이디어</span>
                <textarea
                  className="tale-field h-28 !bg-white text-sm resize-none"
                  value={scriptTopic}
                  onChange={e => setScriptTopic(e.target.value)}
                  placeholder="예: 호기심 많은 아기 부엉이가 처음으로 밤하늘을 날며 반딧불이 친구를 만나는 이야기"
                />
              </label>

              <label className="block space-y-1">
                <span className="tale-label">독자 연령</span>
                <select
                  value={scriptAge}
                  onChange={e => setScriptAge(e.target.value)}
                  className="tale-field !py-2.5 !bg-white text-sm cursor-pointer"
                >
                  {AGES.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>

              <div className="bg-slate-50 rounded-2xl p-3 text-xs text-slate-500 font-medium leading-relaxed">
                <i className="fas fa-info-circle mr-1 text-slate-400"></i>
                원고가 표에 삽입된 뒤에도 <b>각 페이지의 본문 칸에서 언제든 자유롭게 글을 수정하거나 덧붙일 수 있습니다.</b>
              </div>

              {onOpenApiKeyModal && (
                <div className="flex items-center justify-between text-xs bg-orange-50/70 border border-orange-200/80 rounded-2xl px-3.5 py-2.5">
                  <span className="text-orange-950 font-medium">API 키 오류 경고창이 뜨나요?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowScriptModal(false);
                      onOpenApiKeyModal();
                    }}
                    className="text-orange-600 hover:text-orange-700 font-bold underline flex items-center gap-1 cursor-pointer"
                  >
                    <i className="fas fa-key text-[10px]"></i> API 키 직접 등록하기
                  </button>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowScriptModal(false)}
                className="tale-btn tale-btn-ghost flex-1 !py-3.5"
              >
                취소
              </button>
              <button
                onClick={handleInsertScript}
                disabled={planning || !scriptTopic.trim()}
                className="tale-btn tale-btn-ai flex-1 !py-3.5 disabled:opacity-40"
              >
                {planning ? <><i className="fas fa-spinner loading-spin"></i> 원고 작성 중...</> : <><i className="fas fa-feather-pointed"></i> 원고 표에 삽입하기</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoryboardStep;
