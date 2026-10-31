/**
 * Gemini TTS 오디오 처리 모듈
 * 
 * Gemini 3.8 TTS의 단일 호출(Unary) 응답은 기본적으로 24kHz 16bit 모노 WAV 파일(RIFF 헤더 포함)입니다.
 * 만약 단순 PCM으로 가정하고 앞에 또다시 44바이트 헤더를 붙이면:
 * 1) 내부 헤더가 오디오로 재생되고
 * 2) 파일 끝의 메타데이터 청크나 패딩 바이트가 오디오로 디코딩되어 문장 끝("방긋 웃었어요.") 직후
 *    "지직!" 하는 거친 잡음(Static / Crackle / Pop)이 발생합니다.
 * 
 * 본 모듈은:
 * 1. 입력 데이터가 WAV(RIFF)인지 순수 PCM인지 자동 판별
 * 2. WAV인 경우 data 청크를 정밀 추출하여 후행 메타데이터(LIST, ID3, JUNK 등) 배제
 * 3. 문장 끝 30ms 구간에 부드러운 Fade-out(점진적 무음화)을 적용하여 DC 옵셋 팝 노이즈 방지
 * 4. 재생 종료 시 하드웨어 디코더 틱 노이즈 방지를 위해 60ms의 깨끗한 무음(Silence cushion) 추가
 * 5. 표준 44바이트 단일 WAV 헤더로 완벽 재구성하여 브라우저에서 잡음 없이 재생
 */

export function pcmToWavUrl(base64: string, defaultSampleRate = 24000): string {
  if (!base64 || typeof base64 !== 'string') {
    throw new Error('유효하지 않은 오디오 데이터입니다.');
  }

  // base64 디코딩
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }

  let sampleRate = defaultSampleRate;
  let channels = 1;
  let bitsPerSample = 16;
  let pcmData: Uint8Array;

  // RIFF/WAVE 헤더 판별 (0~3: 'RIFF', 8~11: 'WAVE')
  const isWav =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;

  if (isWav) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 12;
    let dataOffset = -1;
    let dataLength = -1;

    // 청크 순회 (fmt, data 등)
    while (offset + 8 <= bytes.length) {
      const chunkId = String.fromCharCode(
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3]
      );
      const chunkSize = view.getUint32(offset + 4, true);

      if (chunkId === 'fmt ' && offset + 8 + 16 <= bytes.length) {
        channels = view.getUint16(offset + 8 + 2, true);
        sampleRate = view.getUint32(offset + 8 + 4, true);
        bitsPerSample = view.getUint16(offset + 8 + 14, true);
      } else if (chunkId === 'data') {
        dataOffset = offset + 8;
        // chunkSize와 실제 남은 바이트 중 작은 쪽으로 안전하게 제한
        dataLength = Math.min(chunkSize, Math.max(0, bytes.length - dataOffset));
        break; // data 청크 발견 후 이후 메타데이터(LIST 등)는 잡음 원인이 되므로 무시
      }

      // 다음 청크로 이동 (청크 크기 홀수 시 1바이트 워드 패딩 처리)
      offset += 8 + chunkSize + (chunkSize % 2);
    }

    if (dataOffset >= 0 && dataLength > 0) {
      pcmData = bytes.subarray(dataOffset, dataOffset + dataLength);
    } else {
      // data 청크를 찾지 못한 경우 최소 44바이트 헤더 건너뜀
      pcmData = bytes.subarray(Math.min(44, bytes.length));
    }
  } else {
    // 순수 헤더리스 PCM
    pcmData = bytes;
  }

  // 16비트 정렬 (2바이트 단위). 홀수 바이트면 마지막 1바이트 절삭
  if (pcmData.length % 2 !== 0) {
    pcmData = pcmData.subarray(0, pcmData.length - 1);
  }

  // 16비트 샘플 뷰 생성 (리틀 엔디안)
  const sampleCount = pcmData.length / 2;
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, sampleCount);

  // -------------------------------------------------------------
  // 잡음("지직") 제거 핵심 처리:
  // 1) 시작 부분 5ms 부드러운 Fade-In (초기 팝 노이즈 방지)
  // 2) 끝 부분 30ms 부드러운 Fade-Out (문장 종료 시 DC 옵셋 절단 노이즈 완벽 제거)
  // 3) 끝부분 60ms 정적 무음 패딩 (오디오 하드웨어 앰프 종료 틱 방지)
  // -------------------------------------------------------------
  const fadeInSamples = Math.min(Math.floor(sampleRate * 0.008), Math.floor(sampleCount / 4));
  for (let i = 0; i < fadeInSamples; i++) {
    // 0에서 1로 부드럽게 상승 (Hann Half Window)
    const factor = 0.5 * (1 - Math.cos((i / fadeInSamples) * Math.PI));
    samples[i] = Math.round(samples[i] * factor);
  }

  // 문장 끝 페이드아웃 (약 35ms ~ 840샘플 at 24kHz)
  const fadeOutSamples = Math.min(Math.floor(sampleRate * 0.035), Math.floor(sampleCount / 2));
  const fadeStart = sampleCount - fadeOutSamples;
  for (let i = 0; i < fadeOutSamples; i++) {
    const idx = fadeStart + i;
    // 1에서 0으로 기울기 0으로 부드럽게 감쇄 (Hann Half Window)
    const factor = 0.5 * (1 + Math.cos((i / fadeOutSamples) * Math.PI));
    samples[idx] = Math.round(samples[idx] * factor);
  }

  // 끝부분 60ms 순수 무음 쿠션 (24kHz 기준 약 1440샘플 = 2880바이트)
  const silenceSamples = Math.floor(sampleRate * 0.06);
  const totalSamples = sampleCount + silenceSamples;
  const finalPcmBytes = new Uint8Array(totalSamples * 2);

  // 기존 페이드 처리된 PCM 복사
  finalPcmBytes.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength));
  // 나머지 silenceSamples는 Uint8Array 기본값 0으로 무음 유지

  // -------------------------------------------------------------
  // 표준 44바이트 단일 WAV 헤더 생성
  // -------------------------------------------------------------
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };

  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const pcmBytesLength = finalPcmBytes.length;

  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcmBytesLength, true); // 파일 총 길이 - 8
  writeStr(8, 'WAVE');

  // fmt subchunk
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);                  // Subchunk1Size (16 for PCM)
  v.setUint16(20, 1, true);                   // AudioFormat (1 = PCM)
  v.setUint16(22, channels, true);            // NumChannels
  v.setUint32(24, sampleRate, true);          // SampleRate
  v.setUint32(28, byteRate, true);            // ByteRate
  v.setUint16(32, blockAlign, true);          // BlockAlign
  v.setUint16(34, bitsPerSample, true);       // BitsPerSample

  // data subchunk
  writeStr(36, 'data');
  v.setUint32(40, pcmBytesLength, true);      // Subchunk2Size

  const blob = new Blob([header, finalPcmBytes], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
