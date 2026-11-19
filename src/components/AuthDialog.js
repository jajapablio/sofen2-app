'use client';

import { useEffect, useId, useRef } from 'react';
import styles from './AuthDialog.module.css';

export default function AuthDialog({ title, description, eyebrow, busy, onClose, returnFocusRef, children, hint }) {
    const dialog = useRef(null);
    const id = useId();

    useEffect(() => {
        const element = dialog.current;
        const previousFocus = returnFocusRef?.current || document.activeElement;
        const previousOverflow = document.body.style.overflow;
        element.showModal();
        element.querySelector('input:not([disabled])')?.focus();
        document.body.style.overflow = 'hidden';
        return () => {
            element.close();
            document.body.style.overflow = previousOverflow;
            previousFocus?.focus();
        };
    }, [returnFocusRef]);

    return (
        <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
            <button className={styles.close} type="button" aria-label={`Close ${eyebrow.toLowerCase()}`} disabled={busy} onClick={onClose}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" /></svg>
            </button>
            <div className={styles.symbol} aria-hidden="true">
                <svg viewBox="0 0 24 24" width="25" height="25" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>
            </div>
            <p className={styles.eyebrow}>{eyebrow}</p>
            <h2 id={`${id}-title`}>{title}</h2>
            <p id={`${id}-description`} className={styles.description}>{description}</p>
            {children}
            {hint && <p className={styles.hint}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></svg>
                <span>{hint}</span>
            </p>}
        </dialog>
    );
}
