/**
 * Microphone capture for dictation. Audio is taken at 16 kHz mono (what speech recognisers
 * want), levels are reported for the meter, and the take is cut into WAV segments: on stop, and
 * in long recordings also at a pause once a segment is long enough, so each request stays small
 * and text appears while the author is still talking.
 */

export interface RecorderOptions {
  /** 0..1, about 20 times a second. */
  onLevel?: (level: number) => void;
  /** Long recordings: called with each finished segment while recording continues. */
  onSegment?: (wav: Blob, seconds: number) => void;
  /** Cut at the first pause after this many seconds (long recordings). */
  segmentAfter?: number;
  /** Always cut by this many seconds. */
  segmentMax?: number;
}

const RATE = 16000;
/** RMS below this is silence, for cutting at pauses. */
const SILENCE = 0.012;
const PAUSE_MS = 700;

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private length = 0;
  private quietFor = 0;
  private heardSpeech = false;
  private rate = RATE;
  constructor(private opts: RecorderOptions = {}) {}

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, noiseSuppression: true, autoGainControl: true, echoCancellation: false } });
    // Chromium resamples the microphone to the context's rate.
    this.ctx = new AudioContext({ sampleRate: RATE });
    this.rate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor rather than an AudioWorklet: the CSP allows no worklet module URLs, and
    // the work per buffer (a copy and an RMS) is tiny.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.take(e.inputBuffer.getChannelData(0));
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  private take(input: Float32Array) {
    const buf = new Float32Array(input);
    this.chunks.push(buf);
    this.length += buf.length;
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    this.opts.onLevel?.(Math.min(1, rms * 8));
    const ms = (buf.length / this.rate) * 1000;
    if (rms < SILENCE) this.quietFor += ms;
    else (this.quietFor = 0), (this.heardSpeech = true);
    const { onSegment, segmentAfter = 20, segmentMax = 55 } = this.opts;
    if (!onSegment) return;
    const seconds = this.length / this.rate;
    if ((seconds >= segmentAfter && this.quietFor >= PAUSE_MS) || seconds >= segmentMax) {
      const seg = this.flush();
      if (seg) onSegment(seg.wav, seg.seconds);
    }
  }

  /** The audio since the last cut, as WAV; null when it was silence. */
  private flush(): { wav: Blob; seconds: number } | null {
    const samples = new Float32Array(this.length);
    let off = 0;
    for (const c of this.chunks) samples.set(c, off), (off += c.length);
    const speech = this.heardSpeech;
    this.chunks = [];
    this.length = 0;
    this.quietFor = 0;
    this.heardSpeech = false;
    if (!speech || samples.length < this.rate * 0.3) return null;
    return { wav: encodeWav(samples, this.rate), seconds: samples.length / this.rate };
  }

  /** Stop and return the last segment (or the whole take, for short dictation). */
  async stop(): Promise<{ wav: Blob; seconds: number } | null> {
    const last = this.flush();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close().catch(() => undefined);
    this.node = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.opts.onLevel?.(0);
    return last;
  }

  get recording() {
    return !!this.ctx;
  }
}

/** 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
