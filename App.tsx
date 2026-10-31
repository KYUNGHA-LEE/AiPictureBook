import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppStep, Character, Location, PromptRequest, Project, Settings, StoryPage } from './types';
import { STORYBOOK_STYLES } from './constants';
import {
  editImage, enhanceScene, analyzeScript, friendlyError, generateCharacterSheet, generateCover, generateLocationSheet,
  generateStoryImage, generateStyleSample, planStory, registerPromptHandler, speak, UserCancelled
} from './services/gemini';
import { clearProject, loadProject, saveProject, loadSettings, saveSettings } from './services/storage';
import { effectiveChars, effectiveLocation, nearestAspect, pageGeometry, readFileAsDataUrl } from './utils';
import PlanningStep from './components/PlanningStep';
import StoryboardStep from './components/StoryboardStep';
import PreviewStep from './components/PreviewStep';
import { CoverControls, EndControls } from './components/PageLayout';
import { ApiKeyModal, ResetConfirmModal, SettingsModal, ToastItem, Toasts } from './components/Dialogs';

const INITIAL: Project = {
  step: AppStep.PLANNING,
  title: '',
  author: '',
  pageCount: 6,
  style: STORYBOOK_STYLES[0],
  pageW: 182,
  pageH: 255,
  fullImage: false,
  storyTopic: '',
  storyAge: '7~9세 (초등 저학년)',
  coverImageUrl: null,
  coverTitleImageUrl: null,
  showCoverText: false,
  coverTitleTop: 120,
  endImageUrl: null,
  pages: [],
  characters: [],
  locations: []
};

const newPage = (i: number): StoryPage => ({ id: Date.now() + i, content: '', sceneIdea: '', imageUrl: null, bgImageData: null });
// AI 그림은 그림 영역 비율로, 표지는 페이지 전체 비율로 요청해요
const imageAspect = (w: number, h: number, full = false) => { const g = pageGeometry(w, h, full); return nearestAspect(g.imgW / g.imgH); };
const coverAspect = (w: number, h: number) => nearestAspect(w / h);
// 본문이 바뀌었는지 알아보는 지문(캐릭터·장소 자동 분석을 한 번만 하려고)
const scriptOf = (pages: StoryPage[]) => pages.map(pg => `${pg.content.trim()}|${pg.sceneIdea.trim()}`).join('\n');
const scriptLength = (pages: StoryPage[]) => pages.reduce((n, pg) => n + pg.content.trim().length, 0);
const sel = (v?: string) => (v && v !== '선택 안함' ? v : undefined);

const App: React.FC = () => {
  const [p, setP] = useState<Project>(INITIAL);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [loaded, setLoaded] = useState(false);
  const [viewerPage, setViewerPage] = useState(-1);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const busyRef = useRef<Record<string, boolean>>({});
  const [planning, setPlanning] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [sample, setSample] = useState<{ open: boolean; url: string | null; loading: boolean; description?: string }>({ open: false, url: null, loading: false, description: '' });
  const [showPicker, setShowPicker] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'cover' | 'end'>('cover'); // 페이지 그림을 고르는 목적: 표지인지 엔딩인지
  const audioCache = useRef<Map<string, string>>(new Map());
  const lastAnalyzed = useRef('');
  const pRef = useRef(p);
  pRef.current = p;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /* ---------- 알림 ---------- */
  const notify = useCallback((msg: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof UserCancelled) { notify(e.message, 'info'); return; }
    console.error(e);
    const msg = friendlyError(e);
    notify(msg, 'error');
    if (/API.?키|Secrets/i.test(msg)) {
      setShowApiKeyModal(true);
    }
  }, [notify]);

  /* ---------- 자동 저장 / 불러오기 ---------- */
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current) return;
    loadedOnce.current = true;
    loadProject().then(saved => {
      if (saved && (saved.pages.length || saved.title)) {
        const old = saved as Project & { layoutType?: 'portrait' | 'landscape' | 'square' };
        const legacy = old.layoutType === 'landscape' ? [255, 182] : old.layoutType === 'square' ? [210, 210] : [182, 255];
        lastAnalyzed.current = scriptOf(saved.pages || []);
        setP({ ...INITIAL, ...saved, pageW: saved.pageW ?? legacy[0], pageH: saved.pageH ?? legacy[1] });
        notify('저장해 둔 작업을 불러왔어요.', 'success');
      }
      setLoaded(true);
    });
  }, [notify]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => saveProject(p), 800);
    return () => clearTimeout(t);
  }, [p, loaded]);

  useEffect(() => { saveSettings(settings); }, [settings]);

  // 본문을 쓰다 잠시 멈추면 캐릭터·장소를 자동으로 찾고, 그림까지 만들어 둬요 (설정에서 끌 수 있어요)
  useEffect(() => {
    if (!loaded || p.step !== AppStep.STORYBOARDING || !settings.autoAssets) return;
    if (scriptLength(p.pages) < 20 || scriptOf(p.pages) === lastAnalyzed.current) return;
    const t = setTimeout(async () => {
      if (busyRef.current['analyze'] || busyRef.current['assets']) return;
      if (await handleAnalyzeScript(true)) handleAssetsAll(true);
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pages, p.step, loaded, settings.autoAssets]);

  /* ---------- 상태 갱신 도우미 (그림이 비동기로 끝나도 최신 상태 위에 반영) ---------- */
  const patch = useCallback((v: Partial<Project>) => setP(prev => ({ ...prev, ...v })), []);
  const updatePage = useCallback((idx: number, v: Partial<StoryPage>) =>
    setP(prev => ({ ...prev, pages: prev.pages.map((pg, i) => (i === idx ? { ...pg, ...v } : pg)) })), []);
  const updateLoc = useCallback((id: number, v: Partial<Location>) =>
    setP(prev => ({ ...prev, locations: prev.locations.map(l => (l.id === id ? { ...l, ...v } : l)) })), []);
  const updateChar = useCallback((id: number, v: Partial<Character>) =>
    setP(prev => ({ ...prev, characters: prev.characters.map(c => (c.id === id ? { ...c, ...v } : c)) })), []);
  const setBusyKey = (key: string, on: boolean) => { busyRef.current = { ...busyRef.current, [key]: on }; setBusy(b => ({ ...b, [key]: on })); };

  /* ---------- 1단계 ---------- */
  const handleStart = () => {
    if (!p.title.trim() || !p.author.trim()) { notify('동화 제목과 만든이 이름을 입력해 주세요! 😊', 'error'); return; }
    setP(prev => ({
      ...prev,
      pages: Array.from({ length: prev.pageCount }, (_, i) => prev.pages[i] || newPage(i)),
      characters: prev.characters.length ? prev.characters : [{ id: Date.now(), name: '', imageData: null }],
      step: AppStep.STORYBOARDING
    }));
    // AI가 만든 이야기에는 캐릭터·장소 설명이 이미 있으니, 그림을 자동으로 만들어 둬요
    if (settingsRef.current.autoAssets && (pRef.current.characters.some(c => c.description?.trim() && !c.imageData) || pRef.current.locations.some(l => l.description?.trim() && !l.imageData))) {
      setTimeout(() => handleAssetsAll(true), 500);
    }
  };

  const handleAIPlan = async (topic: string, age: string, fromStoryboard = false): Promise<boolean> => {
    setPlanning(true);
    let ok = false;
    try {
      const cur = pRef.current;
      const story = await planStory({
        topic,
        age,
        pageCount: cur.pageCount,
        style: cur.style,
        existingCharacters: cur.characters.filter(c => c.name?.trim()),
        existingLocations: cur.locations.filter(l => l.name?.trim())
      });

      // 기존 등록된 캐릭터가 있다면 그대로 유지하고 설명 보완, 새로운 등장인물은 추가
      let charIdSeed = Date.now();
      const existingChars = cur.characters.filter(c => c.name?.trim() || c.imageData || c.description?.trim());
      const mergedChars: Character[] = existingChars.map(c => ({ ...c }));
      story.characters.forEach(sc => {
        const found = mergedChars.find(mc => mc.name.trim() === sc.name.trim());
        if (found) {
          if (!found.description?.trim()) found.description = sc.description;
        } else {
          mergedChars.push({ id: charIdSeed++, name: sc.name, imageData: null, description: sc.description });
        }
      });
      const idOf = (name: string) => mergedChars.find(c => c.name === name)?.id;

      // 장소 병합
      let locIdSeed = Date.now() + 10000;
      const mergedLocs: Location[] = cur.locations.map(l => ({ ...l }));
      (story.locations || []).forEach(sl => {
        const found = mergedLocs.find(ml => ml.name.trim() === sl.name.trim());
        if (found) {
          if (!found.description?.trim()) found.description = sl.description;
        } else {
          mergedLocs.push({ id: locIdSeed++, name: sl.name, imageData: null, description: sl.description });
        }
      });
      const locIdOf = (name: string) => mergedLocs.find(l => l.name === name)?.id;

      const pages: StoryPage[] = Array.from({ length: cur.pageCount }, (_, i) => {
        const sp = story.pages[i];
        const oldPage = cur.pages[i] || newPage(i);
        return {
          ...oldPage,
          content: sp?.content || '',
          sceneIdea: sp?.sceneIdea || '',
          characterIds: sp ? sp.characters.map(idOf).filter((x): x is number => x !== undefined) : oldPage.characterIds,
          locationId: sp ? (sp.location ? locIdOf(sp.location) ?? null : null) : oldPage.locationId
        };
      });

      lastAnalyzed.current = scriptOf(pages);
      setP(prev => ({
        ...prev,
        title: prev.title.trim() || story.title,
        storyTopic: topic,
        storyAge: age,
        characters: mergedChars.length ? mergedChars : [{ id: Date.now(), name: '', imageData: null }],
        locations: mergedLocs,
        pages
      }));

      if (fromStoryboard) {
        notify('AI 원고가 표에 삽입되었어요! 아래 본문 칸에서 원하는 대로 자유롭게 수정해 보세요.', 'success');
      } else {
        notify('이야기가 만들어졌어요! 제목·작가 이름을 확인하고 "동화 만들기 시작!"을 눌러 주세요.', 'success');
      }
      ok = true;
    } catch (e) {
      fail(e);
    } finally {
      setPlanning(false);
    }
    return ok;
  };

  const handleShowSample = async () => {
    const cur = pRef.current;
    setSample({ open: true, url: null, loading: true, description: '' });
    try {
      const res = await generateStyleSample({
        style: cur.style,
        quality: settingsRef.current.imageQuality,
        size: '1K'
      });
      setSample({ open: true, url: res.imageUrl, loading: false, description: res.description });
    } catch (e) {
      setSample({ open: false, url: null, loading: false });
      fail(e);
    }
  };

  /* ---------- 2단계: 캐릭터 시트 · 그림 생성 ---------- */
  const handleLocSheet = async (id: number) => {
    const l = pRef.current.locations.find(x => x.id === id);
    if (!l) return false;
    setBusyKey(`loc-${id}`, true);
    let ok = false;
    try {
      const cur = pRef.current;
      const url = await generateLocationSheet({
        name: l.name || '장소', description: l.description || '', style: cur.style,
        aspect: imageAspect(cur.pageW, cur.pageH, cur.fullImage),
        quality: settingsRef.current.imageQuality, size: settingsRef.current.imageSize, reference: l.imageData
      });
      updateLoc(id, { imageData: url });
      ok = true;
    } catch (e) { fail(e); }
    setBusyKey(`loc-${id}`, false);
    return ok;
  };

  /** 본문(스크립트)을 읽고 캐릭터·장소를 자동으로 찾아 등록 + 각 페이지에 연결 */
  const handleAnalyzeScript = async (silent = false): Promise<boolean> => {
    const cur = pRef.current;
    if (!cur.pages.some(pg => pg.content.trim() || pg.sceneIdea.trim())) {
      if (!silent) notify('본문을 먼저 입력해 주세요.', 'error');
      return false;
    }
    lastAnalyzed.current = scriptOf(cur.pages);
    setBusyKey('analyze', true);
    let ok = false;
    try {
      const res = await analyzeScript({
        pages: cur.pages.map(pg => ({ content: pg.content, sceneIdea: pg.sceneIdea })),
        style: cur.style,
        knownCharacters: cur.characters.filter(c => c.name).map(c => c.name),
        knownLocations: cur.locations.filter(l => l.name).map(l => l.name)
      });
      let addedC = 0, addedL = 0;
      setP(prev => {
        let t = Date.now();
        // 이미 있는 항목(이름이 같은 것)은 그대로 두고, 설명이 비어 있으면 채워요
        const chars = prev.characters.filter(c => c.name || c.imageData || c.description).map(c => ({ ...c }));
        res.characters.forEach(rc => {
          const ex = chars.find(c => c.name === rc.name);
          if (ex) { if (!ex.description?.trim()) ex.description = rc.description; }
          else { chars.push({ id: t++, name: rc.name, imageData: null, description: rc.description }); addedC++; }
        });
        const locs = prev.locations.map(l => ({ ...l }));
        res.locations.forEach(rl => {
          const ex = locs.find(l => l.name === rl.name);
          if (ex) { if (!ex.description?.trim()) ex.description = rl.description; }
          else { locs.push({ id: t++, name: rl.name, imageData: null, description: rl.description }); addedL++; }
        });
        const pages = prev.pages.map((pg, i) => {
          const m = res.pages[i];
          if (!m) return pg;
          const ids = m.characters.map(n => chars.find(c => c.name === n)?.id).filter((x): x is number => x !== undefined);
          const lid = m.location ? locs.find(l => l.name === m.location)?.id ?? null : null;
          // 사용자가 직접 지정한 페이지는 건드리지 않아요
          return { ...pg, characterIds: pg.characterIds ?? ids, locationId: pg.locationId !== undefined ? pg.locationId : lid };
        });
        return { ...prev, characters: chars, locations: locs, pages };
      });
      ok = true;
      if (!silent || addedC || addedL) notify(`본문에서 캐릭터 ${addedC}명, 장소 ${addedL}곳을 새로 찾았어요.`, 'success');
    } catch (e) { if (!silent || !(e instanceof UserCancelled)) fail(e); }
    setBusyKey('analyze', false);
    // 상태가 화면에 반영될 시간을 살짝 기다려요(바로 이어서 그림을 만들 때 최신 목록을 쓰려고)
    await new Promise(r => setTimeout(r, 80));
    return ok;
  };

  /** 그림이 아직 없는 캐릭터·장소의 에셋 그림을 차례로 만들기 (캐릭터 → 장소) */
  const handleAssetsAll = async (silent = false) => {
    if (busyRef.current['assets']) return;
    setBusyKey('assets', true);
    let made = 0;
    let stopped = false;
    for (const c of pRef.current.characters) {
      if (!c.name || c.imageData || !c.description?.trim()) continue;
      if (!(await handleCharSheet(c.id))) { stopped = true; break; }
      made++;
    }
    if (!stopped) {
      for (const l of pRef.current.locations) {
        if (!l.name || l.imageData || !l.description?.trim()) continue;
        if (!(await handleLocSheet(l.id))) { stopped = true; break; }
        made++;
      }
    }
    if (made) notify(`에셋 그림 ${made}장을 만들었어요!`, 'success');
    else if (!stopped && !silent) notify('새로 만들 에셋이 없어요. 이름과 설명을 적은 캐릭터·장소만 만들어요.', 'info');
    setBusyKey('assets', false);
  };


  const handleCharSheet = async (id: number) => {
    const c = pRef.current.characters.find(x => x.id === id);
    if (!c) return false;
    setBusyKey(`char-${id}`, true);
    let ok = false;
    try {
      const url = await generateCharacterSheet({
        name: c.name || '주인공', description: c.description || '', style: pRef.current.style,
        quality: settingsRef.current.imageQuality, size: settingsRef.current.imageSize, reference: c.imageData
      });
      updateChar(id, { imageData: url });
      ok = true;
    } catch (e) { fail(e); }
    setBusyKey(`char-${id}`, false);
    return ok;
  };

  /** 한 페이지 그림 만들기: 캐릭터·배경·그림체·이전 장면을 모두 참조로 전달 */
  /** 이 페이지에 필요한 캐릭터·장소가 아직 없거나 그림이 없으면 자동으로 채워요 */
  const ensureAssetsFor = async (idx: number) => {
    if (!settingsRef.current.autoAssets) return;
    if (scriptOf(pRef.current.pages) !== lastAnalyzed.current && scriptLength(pRef.current.pages) >= 10) {
      await handleAnalyzeScript(true);
    }
    const cur = pRef.current;
    const page = cur.pages[idx];
    if (!page) return;
    for (const c of effectiveChars(page, cur.characters)) {
      if (c.name && !c.imageData && c.description?.trim()) { if (!(await handleCharSheet(c.id))) throw new UserCancelled('캐릭터 그림을 만들지 못해 멈췄어요.'); }
    }
    const loc = effectiveLocation(page, cur.locations);
    if (loc && loc.name && !loc.imageData && loc.description?.trim()) { if (!(await handleLocSheet(loc.id))) throw new UserCancelled('장소 그림을 만들지 못해 멈췄어요.'); }
    await new Promise(r => setTimeout(r, 80));
  };

  /** 등장인물(경비원, 소방관, 택배 기사 등)에 따라 장소와 배경을 자동으로 분리하여 배정 */
  const handleAutoAssignCharacterLocations = useCallback(() => {
    const cur = pRef.current;
    let t = Date.now();
    const locs: Location[] = cur.locations.map(l => ({ ...l }));

    // 직업/인물 키워드에 따른 전용 장소 템플릿 (한국적 고증 철저 반영)
    const PRESETS = [
      {
        keys: ['경비원', '경비', '수위', '아파트 경비', '아파트 경비원'],
        name: '아파트 단지 경비실',
        description: '고층 아파트 단지 건물들이 배경에 솟아 있는 한국 대단지 아파트 정문. 입구 차량 차단봉, 노란 불이 아늑하게 켜진 유리창 경비초소, 책상 위 스탠드 조명과 손전등, 단지 가로등 (단독주택가가 아닌 고층 아파트 단지 환경)'
      },
      {
        keys: ['소방관', '소방', '소방대원'],
        name: '소방서 차고지',
        description: '출동 대기 중인 붉은 대형 소방차와 차고지, 벽에 걸린 소방 호스와 안전모, 환한 차고 조명과 소방서 깃발'
      },
      {
        keys: ['택배', '택배기사', '배달', '배송'],
        name: '택배 트럭 앞 골목',
        description: '가로등 불빛 아래 세워진 파란색 택배 탑차, 짐칸에 차곡차곡 실린 택배 상자들, 바퀴 달린 손수레와 상자 더미'
      },
      {
        keys: ['부엉이', '올빼미', '둥지', '숲'],
        name: '밤하늘 숲속 둥지',
        description: '짙푸른 밤하늘 아래 커다란 참나무 가지 위 둥지, 은은한 보름달과 깜빡이는 초록 반딧불이'
      },
      {
        keys: ['편의점', '알바', '점원'],
        name: '24시 편의점',
        description: '환한 유리창 너머로 진열대와 음료 냉장고가 보이는 24시 편의점, 밤거리의 밝은 불빛'
      },
      {
        keys: ['경찰', '경찰관', '순경'],
        name: '지구대 파출소',
        description: '파란 불빛의 경찰 순찰차와 지구대 앞, 지도가 걸린 게시판과 밝은 사무실'
      },
      {
        keys: ['청소', '환경미화원'],
        name: '새벽 도로 골목',
        description: '새벽 가로등 아래 주황색 청소차와 빗자루, 깨끗하게 쓸린 도로'
      },
      {
        keys: ['빵집', '베이커리', '제빵사'],
        name: '심야 베이커리 주방',
        description: '따뜻한 노란 오븐 불빛과 갓 구운 빵 냄새가 솔솔 풍기는 심야 빵집 주방, 밀가루와 나무 도마'
      },
      {
        keys: ['병원', '의사', '간호사', '응급실'],
        name: '종합병원 응급실 앞',
        description: '환하게 불이 켜진 병원 응급의료센터 입구, 대기 중인 흰색 구급차와 따뜻한 조명의 로비'
      },
      {
        keys: ['등대', '등대지기', '바다'],
        name: '밤바다 등대 전망대',
        description: '파도가 잔잔히 일렁이는 밤바다를 훤히 비추는 새하얀 등대의 회전 불빛과 난간'
      }
    ];

    const getOrAddLoc = (name: string, description: string) => {
      // 기존 장소 중 이름이 같거나 '경비'가 들어간 장소가 있으면 고증에 맞는 최신 설명으로 갱신
      const found = locs.find(l => l.name.trim() === name.trim() || (name.includes('경비') && l.name.includes('경비')));
      if (found) {
        found.name = name;
        found.description = description;
        return found.id;
      }
      const newId = t++;
      locs.push({ id: newId, name, description, imageData: null });
      return newId;
    };

    let assignedCount = 0;
    const pages = cur.pages.map(pg => {
      const text = `${pg.content} ${pg.sceneIdea} ${effectiveChars(pg, cur.characters).map(c => c.name).join(' ')}`;
      let matchedPreset: typeof PRESETS[0] | null = null;
      for (const preset of PRESETS) {
        if (preset.keys.some(k => text.includes(k))) {
          matchedPreset = preset;
          break;
        }
      }

      if (matchedPreset) {
        const lid = getOrAddLoc(matchedPreset.name, matchedPreset.description);
        assignedCount++;
        let sceneIdea = pg.sceneIdea.trim();
        if (matchedPreset.name === '아파트 단지 경비실') {
          sceneIdea = sceneIdea.replace(/주택가|단독주택|동네 골목/g, '아파트 단지');
        }
        if (!sceneIdea.includes(matchedPreset.name)) {
          sceneIdea = sceneIdea ? `${sceneIdea} (${matchedPreset.name} 배경: ${matchedPreset.description})` : `${matchedPreset.name}에서 ${pg.content}`;
        }
        return {
          ...pg,
          locationId: lid,
          sceneIdea
        };
      }
      return pg;
    });

    setP(prev => ({ ...prev, locations: locs, pages }));
    notify(`등장인물(경비원, 소방관, 택배 등)에 맞추어 ${assignedCount}개 페이지의 배경과 장소를 다르게 배정했어요!`, 'success');
  }, [notify]);

  const generatePage = async (idx: number): Promise<boolean> => {
    const first = pRef.current.pages[idx];
    if (!first) return false;
    if (!(first.sceneIdea.trim() || first.content.trim())) { notify(`${idx + 1}쪽: 그림 설명이나 본문을 먼저 적어 주세요!`, 'error'); return false; }

    setBusyKey(`img-${idx}`, true);
    try {
      await ensureAssetsFor(idx);
      const cur = pRef.current;
      const st = settingsRef.current;
      const page = cur.pages[idx];
      const base = page.sceneIdea.trim() || page.content.trim();
      const chars = effectiveChars(page, cur.characters);
      const curLoc = effectiveLocation(page, cur.locations);

      let prompt = base;
      if (st.autoEnhance) {
        try {
          prompt = await enhanceScene({ scene: page.sceneIdea, content: page.content, style: cur.style, characters: chars, location: curLoc });
        } catch (e) {
          if (e instanceof UserCancelled) throw e;
          prompt = base; // 설명 보완이 실패해도 원래 설명으로 그림은 그려요
        }
      }

      // 이전 페이지와 장소 또는 주요 등장인물이 달라졌는지 확인
      const prevPage = idx > 0 ? cur.pages[idx - 1] : null;
      const prevLoc = prevPage ? effectiveLocation(prevPage, cur.locations) : null;
      const curCharNames = chars.map(c => c.name);
      const prevCharNames = prevPage ? effectiveChars(prevPage, cur.characters).map(c => c.name) : [];
      const sameLoc = curLoc && prevLoc && curLoc.id === prevLoc.id;
      const charChanged = curCharNames.length > 0 && prevCharNames.length > 0 && !curCharNames.some(n => prevCharNames.includes(n));
      const settingChanged = !sameLoc || charChanged;

      const anchor = st.keepStyle ? cur.pages.find((pg, i) => i !== idx && pg.imageUrl)?.imageUrl ?? null : null;
      const previous = st.keepContinuity && idx > 0 ? cur.pages[idx - 1]?.imageUrl ?? null : null;
      const url = await generateStoryImage({
        prompt,
        style: cur.style,
        aspect: imageAspect(cur.pageW, cur.pageH, cur.fullImage),
        fullPage: cur.fullImage,
        quality: st.imageQuality,
        size: st.imageSize,
        refs: { characters: chars, location: curLoc, background: page.bgImageData, styleAnchor: anchor === previous ? null : anchor, previous },
        directing: { shotType: sel(page.shotType), verticalAngle: sel(page.verticalAngle), horizontalAngle: sel(page.horizontalAngle), specialPOV: sel(page.specialPOV) },
        textInImage: page.textInImage,
        settingChanged
      });
      updatePage(idx, { imageUrl: url });
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusyKey(`img-${idx}`, false);
    }
  };

  const handleGenerateAll = async () => {
    setBusyKey('all', true);
    const cur = pRef.current;
    let made = 0;
    for (let i = 0; i < cur.pages.length; i++) {
      if (pRef.current.pages[i]?.imageUrl) continue;
      const ok = await generatePage(i); // 앞 페이지를 참조하려고 순서대로 그려요
      if (!ok) { notify(`${i + 1}쪽에서 멈췄어요. 위 안내를 확인하고 다시 눌러 주세요.`, 'info'); break; }
      made++;
    }
    if (made) notify(`그림 ${made}장을 만들었어요!`, 'success');
    setBusyKey('all', false);
  };

  const handleEnhance = async (idx: number) => {
    const cur = pRef.current;
    const page = cur.pages[idx];
    setBusyKey(`enh-${idx}`, true);
    try {
      const text = await enhanceScene({ scene: page.sceneIdea, content: page.content, style: cur.style, characters: effectiveChars(page, cur.characters), location: effectiveLocation(page, cur.locations) });
      updatePage(idx, { sceneIdea: text });
    } catch (e) { fail(e); }
    setBusyKey(`enh-${idx}`, false);
  };

  const handleEdit = async (idx: number, instruction: string) => {
    const cur = pRef.current;
    const page = cur.pages[idx];
    if (!page?.imageUrl || !instruction.trim()) return;
    setBusyKey(`img-${idx}`, true);
    try {
      const url = await editImage({
        image: page.imageUrl, instruction, style: cur.style, aspect: imageAspect(cur.pageW, cur.pageH, cur.fullImage),
        quality: settingsRef.current.imageQuality, size: settingsRef.current.imageSize, textInImage: !!page.textInImage
      });
      updatePage(idx, { imageUrl: url });
      notify('그림을 고쳤어요! 마음에 안 들면 다시 고쳐 보세요.', 'success');
    } catch (e) { fail(e); }
    setBusyKey(`img-${idx}`, false);
  };

  /* ---------- 표지 ---------- */
  const handleAICover = async (withTitle: boolean) => {
    const cur = pRef.current;
    setCoverBusy(true);
    try {
      const url = await generateCover({
        title: cur.title, author: cur.author, style: cur.style, aspect: coverAspect(cur.pageW, cur.pageH),
        quality: settingsRef.current.imageQuality, size: settingsRef.current.imageSize,
        characters: cur.characters, withTitle,
        sceneHint: cur.pages.map(pg => pg.content).filter(Boolean).slice(0, 2).join(' ')
      });
      patch({ coverImageUrl: url, showCoverText: false });
    } catch (e) { fail(e); }
    setCoverBusy(false);
  };

  const cover: CoverControls = {
    coverImageUrl: p.coverImageUrl,
    coverTitleImageUrl: p.coverTitleImageUrl,
    showCoverText: p.showCoverText,
    coverTitleTop: p.coverTitleTop,
    title: p.title,
    author: p.author,
    generating: coverBusy,
    onTitleChange: v => patch({ title: v }),
    onUploadBg: async f => patch({ coverImageUrl: await readFileAsDataUrl(f) }),
    onUploadTitle: async f => patch({ coverTitleImageUrl: await readFileAsDataUrl(f) }),
    onPickFromPages: () => { setPickerTarget('cover'); setShowPicker(true); },
    onToggleText: () => patch({ showCoverText: !pRef.current.showCoverText }),
    onTopChange: v => patch({ coverTitleTop: v }),
    onAIGenerate: handleAICover
  };

  const end: EndControls = {
    endImageUrl: p.endImageUrl,
    onPickFromPages: () => { setPickerTarget('end'); setShowPicker(true); },
    onUpload: async f => patch({ endImageUrl: await readFileAsDataUrl(f) }),
    onReset: () => patch({ endImageUrl: null })
  };

  /* ---------- 3단계: 읽어주기 · 영상 · 저장 ---------- */
  const handleSpeak = async (text: string): Promise<string> => {
    const clean = String(text || '')
      .replace(/^\[?\d+쪽\]?\s*/, '')
      .replace(/^(따뜻하고|다정한|동화\s*구연|목소리로|아이들에게|읽어\s*주듯).*?[:\n]+/gi, '')
      .trim();
    const key = `v3|${settingsRef.current.voice}|${clean}`;
    const cached = audioCache.current.get(key);
    if (cached) return cached;
    try {
      const url = await speak(clean, settingsRef.current.voice);
      audioCache.current.set(key, url);
      return url;
    } catch (e) { fail(e); throw e; }
  };

  const handleDownloadZip = async () => {
    const h2c = (window as any).html2canvas;
    if (!h2c) { notify('저장 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', 'error'); return; }
    const box = document.getElementById('export-container');
    if (!box) return;
    setDownloading(true);
    try {
      const JSZip = (window as any).JSZip;
      if (!JSZip) throw new Error('ZIP 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
      const zip = new JSZip();
      const nodes = box.querySelectorAll('.b5-page');
      for (let i = 0; i < nodes.length; i++) {
        const canvas: HTMLCanvasElement = await h2c(nodes[i], { useCORS: true, scale: 3, logging: false });
        const blob: Blob = await new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('이미지 변환 실패'))), 'image/png'));
        const name = i === 0 ? '00_표지' : i === nodes.length - 1 ? '99_엔딩' : `${String(i).padStart(2, '0')}_내지`;
        zip.file(`${name}.png`, blob);
      }
      const out = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(out);
      a.download = `${pRef.current.title || '동화책'}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      notify('동화책 전체를 고화질 ZIP 파일로 저장했어요!', 'success');
    } catch (e) { fail(e); }
    setDownloading(false);
  };

  /* ---------- 새로 시작 ---------- */
  const confirmReset = async () => {
    setShowResetModal(false);
    await clearProject();
    audioCache.current.clear();
    setViewerPage(-1);
    setP({ ...INITIAL });
    notify('모든 작업 내용이 초기화되었습니다. 새로운 동화를 시작해 보세요!', 'success');
  };

  const goStep = (s: AppStep) => patch({ step: s });

  return (
    <div className="min-h-screen bg-[#faf7f2] font-sans text-slate-900 flex flex-col">
      {/* 표지 선택 */}
      {showPicker && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 max-w-4xl w-full shadow-lg relative border border-orange-100 max-h-[80vh] flex flex-col">
            <button onClick={() => setShowPicker(false)} className="absolute -top-4 -right-4 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-slate-400 hover:text-orange-600"><i className="fas fa-times text-xl"></i></button>
            <div className="text-center mb-6">
              <h3 className="text-2xl font-semibold font-gmarket">페이지 이미지에서 {pickerTarget === 'end' ? '엔딩' : '표지'} 선택</h3>
              <p className="text-slate-500 font-bold">생성된 그림 중 하나를 {pickerTarget === 'end' ? '엔딩' : '표지'}로 사용할 수 있습니다.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 overflow-y-auto p-2">
              {p.pages.map((pg, i) => pg.imageUrl && (
                <div key={pg.id} className="aspect-square rounded-2xl overflow-hidden cursor-pointer border-2 border-transparent hover:border-orange-500 transition-all shadow-md relative group"
                  onClick={() => { patch(pickerTarget === 'end' ? { endImageUrl: pg.imageUrl } : { coverImageUrl: pg.imageUrl }); setShowPicker(false); }}>
                  <img src={pg.imageUrl} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><span className="text-white font-semibold">선택하기</span></div>
                  <div className="absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md font-bold">{i + 1}페이지</div>
                </div>
              ))}
              {!p.pages.some(pg => pg.imageUrl) && (
                <div className="col-span-full py-20 text-center text-slate-300 font-bold"><i className="fas fa-image text-6xl mb-4 block opacity-20"></i>아직 생성된 페이지 그림이 없습니다.</div>
              )}
            </div>
            <button onClick={() => setShowPicker(false)} className="mt-6 w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-semibold hover:bg-slate-200">닫기</button>
          </div>
        </div>
      )}

      {/* 스타일 샘플 */}
      {sample.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl relative border-2 border-indigo-100">
            <button
              onClick={() => setSample({ open: false, url: null, loading: false })}
              className="absolute -top-3 -right-3 w-10 h-10 bg-white rounded-full shadow-md flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-colors"
            >
              <i className="fas fa-times text-lg"></i>
            </button>
            <div className="text-center space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-500 bg-indigo-50 px-3 py-1 rounded-full">
                  화풍 스타일 미리보기
                </span>
                <h3 className="text-2xl font-bold text-slate-900 font-gmarket mt-1">{p.style}</h3>
                {sample.description && (
                  <p className="text-xs font-medium text-slate-500">{sample.description}</p>
                )}
              </div>

              <div className="aspect-square w-full bg-slate-50 rounded-2xl overflow-hidden shadow-inner flex items-center justify-center border border-slate-200 relative">
                {sample.loading ? (
                  <div className="flex flex-col items-center gap-3 text-indigo-500 p-6 text-center">
                    <i className="fas fa-palette text-5xl loading-spin text-indigo-400"></i>
                    <p className="font-semibold text-base text-indigo-700">'{p.style}' 샘플을 그리는 중...</p>
                    <p className="text-xs text-slate-400">화풍 고유의 질감과 재질, 채색 기법을 살려 표현하고 있어요</p>
                  </div>
                ) : sample.url ? (
                  <img src={sample.url} alt={p.style} className="w-full h-full object-cover rounded-2xl" />
                ) : (
                  <p className="text-slate-400 font-bold">샘플을 가져올 수 없습니다.</p>
                )}
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleShowSample}
                  disabled={sample.loading}
                  className="px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-semibold text-sm hover:bg-slate-200 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5"
                >
                  <i className="fas fa-rotate text-xs"></i> 다시 생성
                </button>
                <button
                  onClick={() => setSample({ open: false, url: null, loading: false })}
                  className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold text-base hover:bg-indigo-700 shadow-md transition-colors"
                >
                  이 스타일로 결정하기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showApiKeyModal && (
        <ApiKeyModal
          onClose={() => setShowApiKeyModal(false)}
          onSuccess={() => notify('Gemini API가 성공적으로 연결되었습니다!', 'success')}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onChange={setSettings}
          onClose={() => setShowSettings(false)}
          onOpenApiKeyModal={() => setShowApiKeyModal(true)}
        />
      )}
      {showResetModal && (
        <ResetConfirmModal
          onClose={() => setShowResetModal(false)}
          onConfirm={confirmReset}
        />
      )}
      <Toasts items={toasts} onClose={id => setToasts(t => t.filter(x => x.id !== id))} />

      <header className="bg-white/85 backdrop-blur border-b border-[#efe9df] sticky top-0 z-50 shrink-0">
        <div className="max-w-[1500px] mx-auto px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0"><i className="fas fa-book-open text-sm"></i></div>
            <div className="min-w-0">
              <h1 className="text-[17px] font-bold tracking-tight leading-tight truncate">이경하선생님 동화제작툴</h1>
              <div className="text-[11px] text-slate-400 font-medium leading-tight">수정일 2026.09.30</div>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1 bg-[#f6f1e9] rounded-full p-1">
            {([[1, '기획'], [2, '장면'], [3, '미리보기']] as const).map(([s, label]) => (
              <button key={s} onClick={() => p.pages.length && goStep(s)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${p.step === s ? 'bg-white text-orange-600 shadow-sm' : p.step > s ? 'text-slate-600 hover:text-slate-900' : 'text-slate-400'}`}>
                <span className="opacity-60 mr-1.5">{s}</span>{label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-orange-500 text-white hover:bg-orange-600 transition-all flex items-center gap-1.5 shadow-sm transform hover:scale-[1.02]"
              title="Gemini API 키 등록 안내"
            >
              <i className="fas fa-key text-[11px]"></i> API 키 등록
            </button>
            <button onClick={() => setShowSettings(true)} className="px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white border border-[#e5dfd4] text-slate-600 hover:text-orange-600 hover:bg-orange-50/50 transition-all flex items-center gap-1.5 shadow-xs" title="설정">
              <i className="fas fa-gear text-xs"></i> 설정
            </button>
            <button
              onClick={() => setShowResetModal(true)}
              className="px-3.5 py-1.5 rounded-full text-xs font-bold bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="작업 내용 초기화 및 새로 시작"
            >
              <i className="fas fa-rotate-left text-[11px]"></i> 새로 시작
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 md:px-6 mt-6 flex-grow mb-10 w-full">
        <div className="tale-card min-h-full">
          {p.step === AppStep.PLANNING && (
            <PlanningStep p={p} patch={patch} onStart={handleStart} onShowSample={handleShowSample} onAIPlan={handleAIPlan} onReset={() => setShowResetModal(true)} planning={planning} />
          )}
          {p.step === AppStep.STORYBOARDING && (
            <StoryboardStep
              p={p} patch={patch} updatePage={updatePage} updateChar={updateChar} updateLoc={updateLoc} busy={busy}
              onGenerate={generatePage} onGenerateAll={handleGenerateAll} onEnhance={handleEnhance} onEdit={handleEdit} onCharSheet={handleCharSheet} onLocSheet={handleLocSheet} onAnalyze={() => handleAnalyzeScript(false)} onAssetsAll={() => handleAssetsAll(false)}
              onAIPlan={(topic, age) => handleAIPlan(topic, age, true)} planning={planning}
              onBack={() => goStep(AppStep.PLANNING)}
              onPreview={() => { goStep(AppStep.PREVIEW); setViewerPage(-1); }}
              onOpenApiKeyModal={() => setShowApiKeyModal(true)}
              onAutoAssignLocations={handleAutoAssignCharacterLocations}
            />
          )}
          {p.step === AppStep.PREVIEW && (
            <PreviewStep
              p={p} patch={patch} cover={cover} end={end} viewerPage={viewerPage} setViewerPage={setViewerPage}
              onBack={() => goStep(AppStep.STORYBOARDING)} onDownloadZip={handleDownloadZip} downloading={downloading}
              onSpeak={handleSpeak}
              currentVoice={settings.voice}
              onVoiceChange={v => setSettings(s => ({ ...s, voice: v }))}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
