import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('Uso: node tests/analyze-audio.mjs <grabacion.webm>');
const file = path.resolve(input);
const output = path.resolve(`test-results/audio-analysis-${Date.now()}`);
await fs.mkdir(output, { recursive: true });
const env = { ...process.env, LOCAL_RECORDER_TEST_DIR: path.join(output, 'profile'), LOCAL_RECORDER_PACKAGED_TEST: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, chromiumSandbox: true });
try {
  const page = await app.firstWindow();
  const bytes = await fs.readFile(file);
  const analysis = await page.evaluate(async data => {
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      const audio = await context.decodeAudioData(Uint8Array.from(data).buffer);
      const samples = audio.getChannelData(0); const frameSize = Math.round(audio.sampleRate * .02); const frames = [];
      let absolutePeak = 0;
      for (let start = 0; start < samples.length; start += frameSize) {
        let sum = 0, peak = 0; const end = Math.min(samples.length, start + frameSize);
        for (let i = start; i < end; i++) { const value = samples[i]; sum += value * value; peak = Math.max(peak, Math.abs(value)); absolutePeak = Math.max(absolutePeak, Math.abs(value)); }
        const rms = Math.sqrt(sum / Math.max(1, end - start)); frames.push(20 * Math.log10(Math.max(rms, 1e-6)));
      }
      const sorted = [...frames].sort((a, b) => a - b); const percentile = p => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
      const noiseFloor = percentile(.2); const speechThreshold = Math.max(-42, noiseFloor + 10); const speech = frames.filter(db => db >= speechThreshold); const silence = frames.filter(db => db < speechThreshold);
      return {
        duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels,
        absolutePeak, absolutePeakDbfs: 20 * Math.log10(Math.max(absolutePeak, 1e-6)),
        frameDbfs: { p10: percentile(.1), p20: noiseFloor, median: percentile(.5), p75: percentile(.75), p90: percentile(.9), p99: percentile(.99) },
        estimatedNoiseFloorDbfs: noiseFloor, estimatedSpeechMedianDbfs: speech.length ? speech.sort((a, b) => a - b)[Math.floor(speech.length / 2)] : null,
        estimatedSnrDb: speech.length ? speech.sort((a, b) => a - b)[Math.floor(speech.length / 2)] - noiseFloor : null,
        speechFrames: speech.length, silenceFrames: silence.length
      };
    } finally { await context.close(); }
  }, [...bytes]);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ file, analysis }, null, 2));
  console.log(JSON.stringify(analysis, null, 2)); console.log('Evidence:', output);
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); await app.close().catch(() => {});
}
