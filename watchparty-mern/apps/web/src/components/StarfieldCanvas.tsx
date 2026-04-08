import { useEffect, useRef } from "react";

interface Star {
  x: number;
  y: number;
  radius: number;
  speed: number;
  phase: number;
}

export function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const renderingCanvas = canvas;
    const renderingCtx = ctx;

    let raf = 0;
    let last = performance.now();
    const stars: Star[] = [];

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderingCanvas.width = Math.floor(window.innerWidth * dpr);
      renderingCanvas.height = Math.floor(window.innerHeight * dpr);
      renderingCanvas.style.width = `${window.innerWidth}px`;
      renderingCanvas.style.height = `${window.innerHeight}px`;
      renderingCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars.length = 0;
      const count = Math.max(90, Math.floor((window.innerWidth * window.innerHeight) / 13000));
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: Math.random() * window.innerWidth,
          y: Math.random() * window.innerHeight,
          radius: Math.random() * 1.6 + 0.5,
          speed: Math.random() * 0.06 + 0.02,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    function frame(now: number): void {
      const dt = Math.min(now - last, 32);
      last = now;
      renderingCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const star of stars) {
        star.x -= dt * star.speed;
        star.y -= dt * star.speed * 0.15;
        if (star.x < -4) star.x = window.innerWidth + 4;
        if (star.y < -4) star.y = window.innerHeight + 4;
        const twinkle = 0.45 + Math.sin(now * 0.0015 + star.phase) * 0.35;
        renderingCtx.beginPath();
        renderingCtx.fillStyle = `rgba(255,255,255,${Math.max(0.18, twinkle)})`;
        renderingCtx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        renderingCtx.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return <canvas ref={canvasRef} className="starfield-canvas" aria-hidden="true" />;
}
