'use client';

import { useEffect, useRef } from 'react';

export default function InteractiveParticles() {
    const canvasRef = useRef(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext('2d');
        const container = canvas?.parentElement;

        if (!canvas || !context || !container) {
            return;
        }

        const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        const pointer = { x: -1000, y: -1000 };
        let particles = [];
        let animationFrame = 0;
        let width = 0;
        let height = 0;

        const draw = () => {
            context.clearRect(0, 0, width, height);

            particles.forEach((particle, index) => {
                if (!motionPreference.matches) {
                    const dx = particle.x - pointer.x;
                    const dy = particle.y - pointer.y;
                    const distance = Math.hypot(dx, dy);

                    if (distance > 0 && distance < 130) {
                        const force = (130 - distance) / 130;
                        particle.x += (dx / distance) * force * 0.7;
                        particle.y += (dy / distance) * force * 0.7;
                    }
                }

                const motionScale = motionPreference.matches ? 0.3 : 1;
                particle.x += (particle.vx + particle.burstVx) * motionScale;
                particle.y += (particle.vy + particle.burstVy) * motionScale;
                particle.burstVx *= 0.94;
                particle.burstVy *= 0.94;

                if (particle.x < 0) particle.x = width;
                if (particle.x > width) particle.x = 0;
                if (particle.y < 0) particle.y = height;
                if (particle.y > height) particle.y = 0;

                context.beginPath();
                context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                context.fillStyle = 'rgba(255, 255, 255, 0.72)';
                context.fill();

                for (let otherIndex = index + 1; otherIndex < particles.length; otherIndex += 1) {
                    const other = particles[otherIndex];
                    const distance = Math.hypot(particle.x - other.x, particle.y - other.y);

                    if (distance < 105) {
                        context.beginPath();
                        context.moveTo(particle.x, particle.y);
                        context.lineTo(other.x, other.y);
                        context.strokeStyle = `rgba(255, 255, 255, ${(1 - distance / 105) * 0.2})`;
                        context.lineWidth = 1;
                        context.stroke();
                    }
                }
            });
        };

        const animate = () => {
            draw();
            animationFrame = window.requestAnimationFrame(animate);
        };

        const resize = () => {
            const bounds = container.getBoundingClientRect();
            const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
            width = bounds.width;
            height = bounds.height;
            canvas.width = Math.round(width * pixelRatio);
            canvas.height = Math.round(height * pixelRatio);
            context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

            const count = Math.min(110, Math.max(32, Math.floor((width * height) / 13000)));
            particles = Array.from({ length: count }, () => {
                const direction = Math.random() * Math.PI * 2;
                const speed = 0.25 + Math.random() * 0.4;

                return {
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: Math.cos(direction) * speed,
                    vy: Math.sin(direction) * speed,
                    burstVx: 0,
                    burstVy: 0,
                    radius: Math.random() * 1.7 + 0.7,
                };
            });

            draw();
        };

        const handlePointerMove = (event) => {
            const bounds = container.getBoundingClientRect();
            pointer.x = event.clientX - bounds.left;
            pointer.y = event.clientY - bounds.top;
        };

        const handlePointerDown = (event) => {
            const bounds = container.getBoundingClientRect();
            const clickX = event.clientX - bounds.left;
            const clickY = event.clientY - bounds.top;
            const burstRadius = 160;

            particles.forEach((particle) => {
                const dx = particle.x - clickX;
                const dy = particle.y - clickY;
                const distance = Math.hypot(dx, dy);

                if (distance < burstRadius) {
                    const angle = distance > 0 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;
                    const force = (1 - distance / burstRadius) * (5 + Math.random() * 3);
                    particle.burstVx += Math.cos(angle) * force;
                    particle.burstVy += Math.sin(angle) * force;
                }
            });
        };

        const resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        window.addEventListener('pointermove', handlePointerMove, { passive: true });
        container.addEventListener('pointerdown', handlePointerDown);
        resize();
        animate();

        return () => {
            window.cancelAnimationFrame(animationFrame);
            resizeObserver.disconnect();
            window.removeEventListener('pointermove', handlePointerMove);
            container.removeEventListener('pointerdown', handlePointerDown);
        };
    }, []);

    return <canvas ref={canvasRef} className="particle-background" aria-hidden="true" />;
}
