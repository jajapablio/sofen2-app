'use client';

import { useEffect, useRef } from 'react';
import styles from './RevenueTrend.module.css';

const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value);
const compactMoney = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const dayKey = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

export default function RevenueTrend({ sales }) {
    const viewportRef = useRef(null);
    useEffect(() => {
        const viewport = viewportRef.current;
        const observer = new ResizeObserver(() => {
            viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth;
        });
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);
    const today = dayKey(new Date());
    const totals = sales.reduce((days, sale) => {
        const key = dayKey(sale.created_at);
        days.set(key, (days.get(key) || 0) + Number(sale.total_amount));
        return days;
    }, new Map());
    const days = Array.from({ length: 14 }, (_, index) => {
        const date = new Date(`${today}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() - 13 + index);
        const key = date.toISOString().slice(0, 10);
        return { key, amount: totals.get(key) || 0, label: date.toLocaleDateString('en-PH', { timeZone: 'UTC', day: 'numeric', weekday: 'short' }) };
    });
    const max = Math.max(1, ...days.map((day) => day.amount));
    return (
        <section className={styles.panel} aria-label="Revenue trend">
            <header className={styles.heading}><div><h2>Revenue trend</h2><p>Daily net sales · last 14 days</p></div><span className={styles.liveLabel}>LIVE DATA</span></header>
            <div ref={viewportRef} className={styles.chartViewport} tabIndex={0} role="region" aria-label="Actual revenue for the last 14 days. Scroll horizontally to view earlier dates.">
            <div className={styles.trendChart}>
                {days.map((day) => <div key={day.key} className={styles.trendColumn} data-date={day.key} title={`${day.key}: ${money(day.amount)}`}><span aria-label={money(day.amount)}>{day.amount ? compactMoney(day.amount) : '—'}</span><div className={styles.trendTrack}><i style={{ height: `${day.amount ? Math.max(4, day.amount / max * 100) : 0}%` }} /></div><small>{day.label}</small></div>)}
            </div>
            </div>
            <p className={styles.chartHint}>Scroll to view all 14 days · Philippine time</p>
        </section>
    );
}
