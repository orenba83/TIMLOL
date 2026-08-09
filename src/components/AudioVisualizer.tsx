import { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isRecording: boolean;
  audioLevel: number;
}

export function AudioVisualizer({ isRecording, audioLevel }: AudioVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(audioLevel);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    levelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const bars = 48;
      const barWidth = w / bars;
      const level = isRecording ? levelRef.current : 0;
      const time = Date.now() / 1000;

      for (let i = 0; i < bars; i++) {
        const t = i / bars;
        const wave =
          (Math.sin(time * 3 + i * 0.4) * 0.5 +
            Math.sin(time * 5 + i * 0.7) * 0.3 +
            Math.sin(time * 2 + i * 1.1) * 0.2) *
            0.5 +
          0.5;
        const amplitude = isRecording ? wave * (0.3 + level * 1.8) : 0.04;
        const barHeight = Math.max(2, amplitude * h * 0.85);
        const y = (h - barHeight) / 2;

        const grad = ctx.createLinearGradient(0, y, 0, y + barHeight);
        if (isRecording) {
          grad.addColorStop(0, '#22d3ee');
          grad.addColorStop(0.5, '#06b6d4');
          grad.addColorStop(1, '#0891b2');
        } else {
          grad.addColorStop(0, '#475569');
          grad.addColorStop(1, '#334155');
        }
        ctx.fillStyle = grad;

        const gap = barWidth * 0.3;
        const x = i * barWidth + gap / 2;
        const bw = barWidth - gap;
        const radius = bw / 2;
        ctx.beginPath();
        ctx.roundRect(x, y, bw, barHeight, radius);
        ctx.fill();
      }

      rafRef.current = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isRecording]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={80}
      className="w-full h-20"
    />
  );
}
