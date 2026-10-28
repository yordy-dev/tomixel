import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';
import { hasTeleprompterScript, TELEPROMPTER_SPEED_LABELS, TELEPROMPTER_SPEEDS, TELEPROMPTER_WELCOME, type Settings } from '../../shared/types';

export function Teleprompter() {
  const [settings, setSettings] = useState<Settings | null>(null), [playing, setPlaying] = useState(false), [speedLevel, setSpeedLevel] = useState(2);
  const content = useRef<HTMLDivElement>(null), scrollPosition = useRef(0), savedScrollTop = useRef(0), programmaticScroll = useRef(false);
  const selectedSpeed = settings ? TELEPROMPTER_SPEEDS[speedLevel] : TELEPROMPTER_SPEEDS[2];
  const text = settings && hasTeleprompterScript(settings.teleprompterText) ? settings.teleprompterText : TELEPROMPTER_WELCOME;
  useEffect(() => { if (!settings) return; const nearest = TELEPROMPTER_SPEEDS.reduce((best, speed, index) => Math.abs(speed - settings.teleprompterSpeed) < Math.abs(TELEPROMPTER_SPEEDS[best] - settings.teleprompterSpeed) ? index : best, 0); setSpeedLevel(nearest); }, [settings?.teleprompterSpeed]);
  useEffect(() => window.desktop.onBubbleConfig(setSettings), []);
  useEffect(() => {
    const element = content.current; if (!element) return;
    const preservedScroll = element.scrollTop;
    element.textContent = text;
    renderMathInElement(element, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false,
      strict: false,
      trust: false
    });
    element.scrollTop = preservedScroll; scrollPosition.current = preservedScroll; savedScrollTop.current = preservedScroll;
  }, [text]);
  useEffect(() => { const element = content.current; if (!element) return; const remember = () => { savedScrollTop.current = element.scrollTop; if (!programmaticScroll.current) scrollPosition.current = element.scrollTop; }; element.addEventListener('scroll', remember, { passive: true }); return () => element.removeEventListener('scroll', remember); }, [settings]);
  useEffect(() => window.desktop.onTeleprompterVisibility(visible => { if (!visible) { savedScrollTop.current = content.current?.scrollTop || savedScrollTop.current; setPlaying(false); } else { requestAnimationFrame(() => { if (content.current) content.current.scrollTop = savedScrollTop.current; }); } }), []);
  useEffect(() => { if (!playing || !settings) return; scrollPosition.current = content.current?.scrollTop || 0; let last = performance.now(); const timer = window.setInterval(() => { const now = performance.now(); scrollPosition.current += (now - last) * selectedSpeed / 4200; if (content.current) { programmaticScroll.current = true; content.current.scrollTop = scrollPosition.current; programmaticScroll.current = false; } last = now; }, 16); return () => window.clearInterval(timer); }, [playing, selectedSpeed]);
  useEffect(() => { const keyboard = (event: KeyboardEvent) => { if (event.code === 'Space') { event.preventDefault(); setPlaying(value => !value); } if (event.key === 'Home') { event.preventDefault(); if (content.current) content.current.scrollTop = 0; setPlaying(false); } if (event.key === 'ArrowUp') { event.preventDefault(); setSpeedLevel(value => Math.min(TELEPROMPTER_SPEEDS.length - 1, value + 1)); } if (event.key === 'ArrowDown') { event.preventDefault(); setSpeedLevel(value => Math.max(0, value - 1)); } }; window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard); }, []);
  if (!settings) return null;
  return <div className="teleprompter-window" style={{ background: `rgba(12,14,18,${settings.teleprompterOpacity})` }}><header><span>Teleprompter</span><button aria-label="Cerrar teleprompter" onClick={() => void window.desktop.hideTeleprompter()}><X size={16} /></button></header><div ref={content} className="teleprompter-content" style={{ fontSize: settings.teleprompterFontSize, whiteSpace: 'pre-wrap' }} /><footer><button aria-label="Volver al inicio" onClick={() => { if (content.current) content.current.scrollTop = 0; setPlaying(false); }}><RotateCcw size={17} /></button><button className="teleprompter-play" onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={19} /> : <Play size={19} />}{playing ? 'Pausar' : 'Leer'}</button><span>{TELEPROMPTER_SPEED_LABELS[speedLevel]} · {selectedSpeed} ppm</span></footer></div>;
}
