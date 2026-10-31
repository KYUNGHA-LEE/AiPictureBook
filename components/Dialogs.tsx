import React from 'react';
import { PromptRequest, Settings, ImageQuality } from '../types';
import { VOICES, getSavedApiKey, setSavedApiKey } from '../services/gemini';

/* ---------------- 키 팝업 (서버 프록시 사용 시 불필요하므로 호환용 유지) ---------------- */
export const KeyPromptDialog: React.FC<{ request: PromptRequest; onDone: (ok: boolean) => void }> = ({ onDone }) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="bg-white rounded-3xl p-7 max-w-lg w-full shadow-2xl border border-[#efe9df] space-y-5">
        <h3 className="text-xl font-bold tracking-tight text-slate-900">API 설정 완료</h3>
        <p className="text-slate-600 font-medium leading-relaxed">
          서버 측 Gemini API가 자동으로 연결되어 누구나 바로 이용하실 수 있습니다.
        </p>
        <div className="flex gap-3 pt-2">
          <button onClick={() => onDone(true)} className="tale-btn tale-btn-primary flex-1 !py-3.5">
            확인
          </button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- API 키 직접 입력 & 등록 모달 ---------------- */
export const ApiKeyModal: React.FC<{
  onClose: () => void;
  onSuccess?: () => void;
}> = ({ onClose, onSuccess }) => {
  const [keyInput, setKeyInput] = React.useState(() => getSavedApiKey());
  const [showKey, setShowKey] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [maskedKey, setMaskedKey] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);

  // 현재 서버 및 클라이언트 키 상태 확인
  React.useEffect(() => {
    fetch('/api/key-status')
      .then(r => r.json())
      .then(d => {
        if (d.hasKey && d.maskedKey) {
          setMaskedKey(d.maskedKey);
        } else {
          const local = getSavedApiKey();
          if (local && local.length > 8) {
            setMaskedKey(`${local.slice(0, 6)}...${local.slice(-4)}`);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setResult({ ok: false, message: 'API 키를 입력해 주세요.' });
      return;
    }
    setSaving(true);
    setResult(null);

    try {
      const res = await fetch('/api/save-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: trimmed })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSavedApiKey(trimmed);
        setMaskedKey(data.maskedKey || `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`);
        setResult({
          ok: true,
          message: '🎉 API 키가 성공적으로 등록 및 검증되었습니다! 이제 모든 AI 기능을 바로 이용하실 수 있습니다.'
        });
        if (onSuccess) onSuccess();
      } else {
        setResult({
          ok: false,
          message: data.error || 'API 키 검증에 실패했습니다. 올바른 키인지 확인해 주세요.'
        });
      }
    } catch {
      // 오프라인이거나 서버 통신 실패 시에도 클라이언트에 우선 저장
      setSavedApiKey(trimmed);
      setMaskedKey(`${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`);
      setResult({
        ok: true,
        message: 'API 키가 클라이언트에 저장되었습니다. (네트워크 상태를 확인해 주세요)'
      });
      if (onSuccess) onSuccess();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('등록된 API 키를 삭제하시겠습니까?')) return;
    setSavedApiKey('');
    setKeyInput('');
    setMaskedKey(null);
    setResult(null);
    try {
      await fetch('/api/delete-key', { method: 'POST' });
    } catch {}
    setResult({ ok: true, message: '등록된 API 키가 삭제되었습니다.' });
  };

  const handleTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const customKey = keyInput.trim() || getSavedApiKey();
      const res = await fetch('/api/test-key', {
        headers: customKey ? { 'x-gemini-api-key': customKey } : {}
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setResult({ ok: true, message: '🎉 Gemini API가 정상적으로 작동하고 있습니다!' });
      } else {
        setResult({ ok: false, message: data.error || 'API 키 검증 실패' });
      }
    } catch {
      setResult({ ok: false, message: '서버와 통신할 수 없습니다.' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl p-7 md:p-8 max-w-xl w-full shadow-2xl border border-[#efe9df] max-h-[92vh] overflow-y-auto space-y-6 relative">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-10 h-10 rounded-full bg-slate-100 text-slate-500 hover:text-orange-500 transition-all flex items-center justify-center"
        >
          <i className="fas fa-times"></i>
        </button>

        {/* 헤더 */}
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-orange-500 text-white flex items-center justify-center text-lg shadow-sm">
            <i className="fas fa-key"></i>
          </div>
          <div>
            <h3 className="text-xl font-bold tracking-tight text-slate-900">Gemini API 키 등록</h3>
            <p className="text-xs text-slate-400 font-medium">API 키를 아래 입력창에 바로 붙여넣어 등록하세요</p>
          </div>
        </div>

        {/* 현재 등록 상태 안내 카드 */}
        {maskedKey ? (
          <div className="p-4 bg-green-50/80 border border-green-200 rounded-2xl flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <i className="fas fa-check-circle text-green-600 text-lg shrink-0"></i>
              <div className="min-w-0">
                <div className="text-xs font-bold text-green-900">API 키가 등록되어 사용 중입니다</div>
                <div className="text-[11px] font-mono text-green-700 truncate">{maskedKey}</div>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="px-2.5 py-1.5 bg-white border border-green-300 text-green-800 text-xs font-bold rounded-xl hover:bg-green-100 transition-all"
              >
                {testing ? <i className="fas fa-spinner fa-spin"></i> : '연결 테스트'}
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-2.5 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-bold rounded-xl hover:bg-red-50 transition-all"
              >
                삭제
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-2xl flex items-start gap-3">
            <i className="fas fa-circle-exclamation text-amber-500 text-base mt-0.5 shrink-0"></i>
            <div className="text-xs text-amber-900 font-medium leading-relaxed">
              Google Gemini API 키(<strong>AIzaSy...</strong>)를 등록하시면 동화 자동 기획, AI 그림 생성, 음성 낭독 등 모든 기능을 무제한으로 사용하실 수 있습니다.
            </div>
          </div>
        )}

        {/* 1) 직접 API 키 입력창 */}
        <form onSubmit={handleSave} className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <i className="fas fa-pen text-orange-500 text-[11px]"></i> API 키 직접 붙여넣기
            </span>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
                placeholder="AIzaSy... 로 시작하는 API 키 붙여넣기"
                className="tale-field !py-3 !pl-4 !pr-11 font-mono text-xs w-full bg-slate-50 border-slate-300 focus:bg-white"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                title={showKey ? '키 숨기기' : '키 보기'}
              >
                <i className={`fas ${showKey ? 'fa-eye-slash' : 'fa-eye'} text-xs`}></i>
              </button>
            </div>
          </label>

          <button
            type="submit"
            disabled={saving || !keyInput.trim()}
            className="w-full py-3.5 px-5 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-2xl flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-40 cursor-pointer"
          >
            {saving ? (
              <>
                <i className="fas fa-spinner fa-spin text-sm"></i>
                API 키 검증 및 저장 중...
              </>
            ) : (
              <>
                <i className="fas fa-floppy-disk text-sm"></i>
                API 키 저장 및 즉시 적용하기
              </>
            )}
          </button>
        </form>

        {/* 결과 피드백 메시지 */}
        {result && (
          <div
            className={`p-3.5 rounded-2xl text-xs font-semibold leading-relaxed animate-fadeIn ${
              result.ok ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}
          >
            <div className="flex items-start gap-2">
              <i className={`fas ${result.ok ? 'fa-check-circle text-green-600' : 'fa-triangle-exclamation text-red-500'} text-base shrink-0 mt-0.5`}></i>
              <div>{result.message}</div>
            </div>
          </div>
        )}

        {/* 2) 무료 키 발급 바로가기 링크 */}
        <div className="pt-2 border-t border-slate-100 space-y-2">
          <div className="text-xs text-slate-500 font-semibold flex items-center justify-between">
            <span>아직 API 키가 없으신가요?</span>
            <span className="text-[11px] text-orange-600 font-medium">100% 무료</span>
          </div>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all"
          >
            <i className="fas fa-external-link-alt text-[11px] text-slate-500"></i>
            Google AI Studio에서 무료 API 키 발급받기
          </a>
          <p className="text-[11px] text-slate-400 font-medium text-center">
            * 구글 계정으로 로그인 후 <b>[Create API key]</b>를 누르면 1초 만에 무료 발급됩니다.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 bg-slate-900 hover:bg-black text-white font-bold rounded-2xl transition-all text-xs"
        >
          확인 (창 닫기)
        </button>
      </div>
    </div>
  );
};

/* ---------------- 설정 ---------------- */
export const SettingsModal: React.FC<{
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
  onOpenApiKeyModal?: () => void;
}> = ({ settings, onChange, onClose, onOpenApiKeyModal }) => {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });
  const qualities: { id: ImageQuality; label: string; desc: string }[] = [
    { id: 'fast', label: '빠르게', desc: '가장 빠르고 가벼움' },
    { id: 'standard', label: '표준', desc: '추천 · 품질과 속도 균형' },
    { id: 'pro', label: '고화질', desc: '가장 정교하고 풍부함' }
  ];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl p-7 md:p-8 max-w-2xl w-full shadow-2xl border border-[#efe9df] max-h-[90vh] overflow-y-auto space-y-7 relative">
        <button onClick={onClose} className="absolute top-5 right-5 w-10 h-10 rounded-full bg-slate-100 text-slate-500 hover:text-orange-500 transition-all flex items-center justify-center">
          <i className="fas fa-times"></i>
        </button>
        <div className="space-y-1">
          <h3 className="text-xl font-bold tracking-tight text-slate-900">설정</h3>
          <p className="text-xs text-slate-400 font-medium">동화책 제작 시 적용할 그림 및 낭독 품질을 설정합니다.</p>
        </div>

        {/* API 키 설정 바로가기 카드 */}
        <div className="p-4 bg-orange-50/70 border border-orange-200/80 rounded-2xl flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 text-white flex items-center justify-center shrink-0 text-sm">
              <i className="fas fa-key"></i>
            </div>
            <div>
              <div className="font-bold text-slate-800 text-sm">Gemini API 키 관리</div>
              <div className="text-xs text-slate-500 font-medium">앱 내에서 직접 API 키를 등록하고 언제든 변경할 수 있습니다.</div>
            </div>
          </div>
          {onOpenApiKeyModal && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenApiKeyModal();
              }}
              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-xl transition-all text-xs flex items-center gap-1.5 shrink-0 shadow-xs"
            >
              <i className="fas fa-pen text-[10px]"></i> 키 등록 / 변경
            </button>
          )}
        </div>

        <section className="space-y-3">
          <h4 className="font-semibold text-orange-700 flex items-center gap-2">
            <i className="fas fa-palette text-sm"></i> 그림 품질
          </h4>
          <div className="grid grid-cols-3 gap-3">
            {qualities.map(q => (
              <button key={q.id} onClick={() => set('imageQuality', q.id)}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${settings.imageQuality === q.id ? 'border-orange-500 bg-orange-50' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                <div className="font-semibold text-sm">{q.label}</div>
                <div className="text-xs font-medium text-slate-500 mt-1">{q.desc}</div>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm font-semibold text-slate-600">그림 해상도</span>
            {(['1K', '2K'] as const).map(s => (
              <button key={s} onClick={() => set('imageSize', s)} className={`px-5 py-2 rounded-full font-semibold text-sm transition-all ${settings.imageSize === s ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {s === '1K' ? '보통 (1K)' : '고해상도 (2K · 인쇄용)'}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="font-semibold text-orange-700 flex items-center gap-2">
            <i className="fas fa-wand-magic-sparkles text-sm"></i> 그림 일관성
          </h4>
          {([
            ['keepStyle', '그림체 고정', '가장 먼저 만든 그림을 기준으로 모든 페이지의 그림체를 맞춰요'],
            ['keepContinuity', '이전 장면 이어 그리기', '바로 앞 페이지 그림을 참고해 배경·분위기를 이어 가요'],
            ['autoAssets', '캐릭터·장소 자동 생성', '본문을 쓰다 멈추면 AI가 캐릭터와 장소를 찾아 그림까지 만들어요'],
            ['autoEnhance', '그림 설명 자동 보완', '설명이 짧아도 AI가 구도·표정·조명을 채워서 그려요']
          ] as const).map(([k, label, desc]) => (
            <label key={k} className="flex items-start gap-3 cursor-pointer p-2 rounded-xl hover:bg-orange-50/50 transition-colors">
              <input type="checkbox" checked={settings[k]} onChange={e => set(k, e.target.checked)} className="mt-1 w-5 h-5 accent-orange-500 rounded" />
              <span><span className="font-semibold text-sm text-slate-800">{label}</span><br /><span className="text-xs text-slate-500 font-medium">{desc}</span></span>
            </label>
          ))}
        </section>

        <section className="space-y-3">
          <h4 className="font-semibold text-orange-700 flex items-center gap-2">
            <i className="fas fa-volume-high text-sm"></i> 읽어주는 목소리
          </h4>
          <div className="flex flex-wrap gap-2">
            {VOICES.map(v => (
              <button key={v.id} onClick={() => set('voice', v.id)} className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${settings.voice === v.id ? 'bg-orange-500 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {v.label}
              </button>
            ))}
          </div>
        </section>

        <button onClick={onClose} className="tale-btn w-full !py-3.5 bg-slate-900 text-white hover:bg-black transition-all">
          저장하고 닫기
        </button>
      </div>
    </div>
  );
};

/* ---------------- 토스트 ---------------- */
export interface ToastItem { id: number; msg: string; kind: 'info' | 'error' | 'success'; }
export const Toasts: React.FC<{ items: ToastItem[]; onClose: (id: number) => void }> = ({ items, onClose }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[300] flex flex-col gap-2 items-center w-full max-w-xl px-4 pointer-events-none">
    {items.map(t => (
      <div key={t.id} onClick={() => onClose(t.id)}
        className={`pointer-events-auto cursor-pointer px-6 py-4 rounded-2xl shadow-lg font-bold text-sm w-full text-center animate-fadeIn ${
          t.kind === 'error' ? 'bg-red-600 text-white' : t.kind === 'success' ? 'bg-green-600 text-white' : 'bg-slate-900 text-white'}`}>
        {t.msg}
      </div>
    ))}
  </div>
);

/* ---------------- 초기화 및 새로 시작 확인 모달 ---------------- */
export const ResetConfirmModal: React.FC<{
  onClose: () => void;
  onConfirm: () => void;
}> = ({ onClose, onConfirm }) => {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white rounded-3xl p-7 max-w-md w-full shadow-2xl border border-red-100 text-center space-y-5">
        <div className="w-16 h-16 rounded-2xl bg-red-50 text-red-500 mx-auto flex items-center justify-center text-2xl shadow-inner border border-red-100">
          <i className="fas fa-rotate-left"></i>
        </div>
        <div className="space-y-2">
          <h3 className="text-xl font-bold tracking-tight text-slate-900">
            동화를 초기화하고 새로 시작할까요?
          </h3>
          <p className="text-xs font-medium text-slate-500 leading-relaxed">
            현재 작성 중이던 동화 제목, 본문, 생성된 그림과 등장인물이 모두 지워지고 첫 기획 화면으로 돌아갑니다.
          </p>
        </div>
        <div className="flex gap-2.5 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-2xl text-sm transition-all cursor-pointer"
          >
            취소 (계속 작업)
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 py-3 px-4 bg-red-500 hover:bg-red-600 text-white font-bold rounded-2xl text-sm shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <i className="fas fa-trash-can text-xs"></i>
            초기화 및 새로 시작
          </button>
        </div>
      </div>
    </div>
  );
};

