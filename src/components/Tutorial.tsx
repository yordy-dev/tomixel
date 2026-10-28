import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';

type CardPlacement = 'top' | 'bottom' | 'left' | 'right';
type CardSize = { width: number; height: number };

const steps = [
  { page: 'home', target: '[data-tour="source"]', placement: 'bottom', title: 'Primero, elige qué grabar', text: 'Puedes usar toda la pantalla, una ventana o marcar solamente un área para grabar.' },
  { page: 'home', target: '[data-tour="devices"]', placement: 'bottom', title: 'Comprueba tus dispositivos', text: 'Activa micrófono, cámara o audio del sistema según lo que necesites. El medidor confirma que tu voz llega bien.' },
  { page: 'settings', target: '.settings-nav', placement: 'right', title: 'Aquí están los Ajustes', text: 'Desde aquí configuras audio, video, luz y fondo de cámara, teleprompter, almacenamiento, apariencia y tus atajos.' },
  { page: 'home', target: 'button.record-button[data-tour="record"]', placement: 'top', title: 'Empieza cuando estés listo', text: 'Aquí tienes el botón Iniciar grabación. Al pulsarlo comienza la cuenta regresiva; después podrás pausar, silenciar, usar zoom y abrir el teleprompter.' },
  { page: 'library', target: '.page-heading', placement: 'bottom', title: 'Después puedes editar', text: 'En Biblioteca abres una grabación para cortar tramos, capturar imágenes y exportar MP4 sin modificar el original.' }
] as const;

function pointFor(placement: CardPlacement, box: DOMRect, size: CardSize, gap: number) {
  const centerX = box.left + (box.width - size.width) / 2;
  const centerY = box.top + (box.height - size.height) / 2;
  if (placement === 'bottom') return { top: box.bottom + gap, left: centerX };
  if (placement === 'top') return { top: box.top - size.height - gap, left: centerX };
  if (placement === 'right') return { top: centerY, left: box.right + gap };
  return { top: centerY, left: box.left - size.width - gap };
}

function cardPosition(box: DOMRect, size: CardSize, preferred: CardPlacement) {
  const margin = 12, gap = 14;
  const width = Math.min(size.width, Math.max(1, window.innerWidth - margin * 2));
  const height = Math.min(size.height, Math.max(1, window.innerHeight - margin * 2));
  const measured = { width, height };
  const order = [preferred, 'bottom', 'top', 'right', 'left'].filter((value, index, values) => values.indexOf(value) === index) as CardPlacement[];
  const fits = (point: { top: number; left: number }) => point.top >= margin && point.left >= margin && point.top + height <= window.innerHeight - margin && point.left + width <= window.innerWidth - margin;
  const selected = order.map(placement => pointFor(placement, box, measured, gap)).find(fits);
  const point = selected || {
    top: Math.max(margin, Math.min(window.innerHeight - height - margin, box.top + (box.height - height) / 2)),
    left: Math.max(margin, Math.min(window.innerWidth - width - margin, box.left + (box.width - width) / 2))
  };
  return { ...point, width };
}

export function Tutorial({ navigate, finish }: { navigate: (page: string) => void; finish: () => void }) {
  const [started, setStarted] = useState(false), [step, setStep] = useState(0), [box, setBox] = useState<DOMRect | null>(null), [cardSize, setCardSize] = useState<CardSize>({ width: 320, height: 190 });
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => { navigate(started ? steps[step].page : 'home'); }, [started, step]);
  useLayoutEffect(() => {
    if (!started) { setBox(null); return; }
    const update = () => {
      const target = document.querySelector(steps[step].target);
      if (!target) { setBox(null); return; }
      const before = target.getBoundingClientRect();
      if (before.top < 12 || before.bottom > window.innerHeight - 12) target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const next = target.getBoundingClientRect();
      setBox(current => current && current.x === next.x && current.y === next.y && current.width === next.width && current.height === next.height ? current : next);
      if (card.current) {
        const measured = card.current.getBoundingClientRect();
        setCardSize(current => current.width === measured.width && current.height === measured.height ? current : { width: measured.width, height: measured.height });
      }
    };
    update();
    let frame = 0;
    const track = () => { update(); frame = window.requestAnimationFrame(track); };
    frame = window.requestAnimationFrame(track);
    const timer = window.setTimeout(update, 140), lateTimer = window.setTimeout(update, 360);
    window.addEventListener('resize', update);
    const target = document.querySelector(steps[step].target);
    const observer = target && 'ResizeObserver' in window ? new ResizeObserver(update) : null;
    if (observer && target) observer.observe(target);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); window.clearTimeout(lateTimer); window.removeEventListener('resize', update); observer?.disconnect(); };
  }, [started, step]);
  useLayoutEffect(() => {
    if (!started) return;
    const measure = () => { if (!card.current) return; const next = card.current.getBoundingClientRect(); setCardSize(current => current.width === next.width && current.height === next.height ? current : { width: next.width, height: next.height }); };
    measure(); window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure);
  }, [started, step, box]);
  if (!started) return <div className="tour-layer tour-welcome-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title"><div className="tour-welcome"><span className="tour-welcome-icon"><Play size={22} /></span><button className="icon-button tour-close" aria-label="Omitir tutorial" onClick={finish}><X size={16} /></button><small>BIENVENIDO</small><h2 id="tour-title">Aprende lo esencial en cinco pasos</h2><p>Te mostraremos dónde elegir la pantalla, revisar el sonido, abrir Ajustes, comenzar y editar. Puedes salir cuando quieras.</p><div className="tour-welcome-actions"><button className="text-button" onClick={finish}>Entrar sin tutorial</button><button className="primary" onClick={() => setStarted(true)}>Ver recorrido<ChevronRight size={16} /></button></div></div></div>;
  const current = steps[step];
  const position = box ? cardPosition(box, cardSize, current.placement) : { top: 12, left: 12, width: cardSize.width };
  const openHelp = () => { finish(); navigate('help'); };
  return <div className="tour-layer" role="dialog" aria-modal="true" aria-labelledby="tour-title">{box && <div className="tour-focus" style={{ left: box.left - 6, top: box.top - 6, width: box.width + 12, height: box.height + 12 }} />}<div ref={card} className="tour-card" style={{ top: position.top, left: position.left, width: position.width }}><div className="tour-card-top"><span>Paso {step + 1} de {steps.length}</span><button className="icon-button" aria-label="Omitir tutorial" onClick={finish}><X size={16} /></button></div><h2 id="tour-title">{current.title}</h2><p>{current.text}</p><div className="tour-dots" aria-hidden="true">{steps.map((_, index) => <i className={index === step ? 'active' : ''} key={index} />)}</div><div className="tour-actions"><button className="text-button" onClick={step === steps.length - 1 ? openHelp : finish}>{step === steps.length - 1 ? 'Ver funciones' : 'Omitir'}</button><button className="secondary" onClick={() => step ? setStep(value => value - 1) : setStarted(false)}><ChevronLeft size={15} />Anterior</button><button className="primary" onClick={() => step === steps.length - 1 ? finish() : setStep(value => value + 1)}>{step === steps.length - 1 ? 'Listo' : 'Siguiente'}<ChevronRight size={15} /></button></div></div></div>;
}
