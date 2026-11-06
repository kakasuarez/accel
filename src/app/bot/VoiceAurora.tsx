'use client';

import { useEffect, useRef } from 'react';
import type { VoiceLevels } from './useVoice';

// Layered red ribbons rising from the bottom edge. Height, speed and shape follow the
// mic's overall level and three frequency bands (low / mid / high). Drawn for a light
// ground: plain alpha blending, so the reds stay red instead of adding up to white.
const RIBBONS = [
  { rgb: '255, 120, 105', freq: 1.1, speed: 0.55, phase: 0.0, band: 0, weight: 1.0, alpha: 0.55 },
  { rgb: '230, 0, 0', freq: 1.8, speed: -0.8, phase: 1.7, band: 1, weight: 0.86, alpha: 0.7 },
  { rgb: '196, 0, 0', freq: 2.7, speed: 1.15, phase: 3.1, band: 2, weight: 0.62, alpha: 0.75 },
  { rgb: '255, 60, 40', freq: 1.5, speed: -0.45, phase: 4.4, band: 1, weight: 0.42, alpha: 0.6 },
] as const;

interface Props {
  sample: (out: VoiceLevels, t: number) => void;
  /** Wrapper class. `bot-aurora` pins it to the viewport's bottom edge. */
  className?: string;
}

export function VoiceAurora({ sample, className = 'bot-aurora' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const levels: VoiceLevels = { level: 0, bands: [0, 0, 0] };
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;
    let intro = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sample(levels, t);
      const energyAll = levels.level;
      t += dt * (reduced ? 0.3 : 1 + energyAll * 1.6);
      intro = Math.min(1, intro + dt * 2.2);
      const ease = 1 - Math.pow(1 - intro, 3);
      const step = Math.max(6, Math.round(w / 90));

      ctx.clearRect(0, 0, w, h);

      for (const r of RIBBONS) {
        const breathe = reduced ? 0 : 0.04 * Math.sin(t * 0.9 + r.phase);
        const energy = 0.3 + breathe + 0.7 * (0.45 * energyAll + 0.55 * levels.bands[r.band]);
        const amp = h * 0.8 * energy * r.weight * ease;
        const top = h - amp - 4;

        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w + step; x += step) {
          const u = x / w;
          const env = 0.3 + 0.7 * Math.pow(Math.sin(Math.PI * Math.min(1, u)), 1.3);
          const wave =
            0.58 +
            0.28 * Math.sin(u * Math.PI * 2 * r.freq + t * r.speed + r.phase) +
            0.14 * Math.sin(u * Math.PI * 2 * r.freq * 2.3 - t * r.speed * 1.7 + r.phase * 2);
          ctx.lineTo(x, h - amp * env * wave);
        }
        ctx.lineTo(w, h);
        ctx.closePath();

        const g = ctx.createLinearGradient(0, top, 0, h);
        g.addColorStop(0, `rgba(${r.rgb}, 0)`);
        g.addColorStop(0.5, `rgba(${r.rgb}, ${r.alpha * 0.55})`);
        g.addColorStop(1, `rgba(${r.rgb}, ${r.alpha})`);
        ctx.fillStyle = g;
        ctx.fill();
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [sample]);

  return (
    <div className={className} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
