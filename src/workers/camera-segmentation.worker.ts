import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';

type InitMessage = { type: 'init'; wasmBase: string; modelUrl: string };
type FrameMessage = { type: 'frame'; bitmap: ImageBitmap; timestamp: number };
type IncomingMessage = InitMessage | FrameMessage | { type: 'close' };
type WorkerScope = {
  onmessage: ((event: MessageEvent<IncomingMessage>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

const scope = globalThis as unknown as WorkerScope;
let segmenter: ImageSegmenter | null = null;
let initializing: Promise<void> | null = null;
let personIndex = 1;

async function initialize(message: InitMessage) {
  if (segmenter || initializing) return initializing;
  initializing = (async () => {
    // The second argument loads the Emscripten module correctly inside a
    // module worker. Without it MediaPipe falls back to importScripts and the
    // worker fails with "ModuleFactory not set".
    const vision = await FilesetResolver.forVisionTasks(message.wasmBase, true);
    const modelResponse = await fetch(message.modelUrl);
    if (!modelResponse.ok) throw new Error(`No se pudo abrir el modelo local (${modelResponse.status}).`);
    const model = new Uint8Array(await modelResponse.arrayBuffer());
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
      canvas: new OffscreenCanvas(1, 1),
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true
    });
    const labels = segmenter.getLabels();
    const detectedIndex = labels.findIndex(label => /person|human/i.test(label));
    personIndex = detectedIndex >= 0 ? detectedIndex : Math.max(0, labels.length - 1);
    scope.postMessage({ type: 'ready' });
  })().catch(error => {
    segmenter = null;
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }).finally(() => { initializing = null; });
  return initializing;
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === 'init') { void initialize(message); return; }
  if (message.type === 'close') { segmenter?.close(); segmenter = null; return; }
  const bitmap = message.bitmap;
  if (!segmenter) { bitmap.close(); scope.postMessage({ type: 'skipped' }); return; }
  const started = performance.now();
  try {
    segmenter.segmentForVideo(bitmap, message.timestamp, result => {
      const masks = result.confidenceMasks || [];
      const mask = masks[personIndex] || masks[masks.length - 1];
      if (!mask) throw new Error('El modelo no devolvió una máscara de persona.');
      const source = mask.getAsFloat32Array();
      const data = new Float32Array(source.length); data.set(source);
      scope.postMessage({ type: 'mask', data: data.buffer, width: mask.width, height: mask.height, processingMs: performance.now() - started }, [data.buffer]);
      result.close();
    });
  } catch (error) {
    scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally { bitmap.close(); }
};

