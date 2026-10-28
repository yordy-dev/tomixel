import type { Settings } from '../../shared/types';

const MASTER_MAX = { width: 3840, height: 2160 };
const DELIVERY_LIMITS = {
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 }
} as const;

function fittedSize(width: number, height: number, limit: { width: number; height: number }) {
  const ratio = Math.min(1, limit.width / width, limit.height / height);
  return {
    width: Math.max(2, Math.floor(width * ratio / 2) * 2),
    height: Math.max(2, Math.floor(height * ratio / 2) * 2)
  };
}

export function masterSize(width: number, height: number) {
  return fittedSize(width, height, MASTER_MAX);
}

export function deliverySize(width: number, height: number, resolution: Settings['captureResolution']) {
  return resolution === 'native' ? { width, height } : fittedSize(width, height, DELIVERY_LIMITS[resolution]);
}

export function sharpZoomLimit(sourceWidth: number, sourceHeight: number, outputWidth: number, outputHeight: number) {
  return Math.max(100, Math.min(300, Math.floor(Math.min(sourceWidth / outputWidth, sourceHeight / outputHeight) * 100 / 10) * 10));
}

export function recordingBitrate(width: number, height: number, fps: number, quality: Settings['quality']) {
  const bitsPerPixel = { low: .045, medium: .075, high: .12, 'very-high': .18 }[quality];
  return Math.round(Math.max(4e6, Math.min(80e6, width * height * fps * bitsPerPixel)));
}
