'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import styles from './InstallApp.module.css';

const subscribeDisplayMode = (callback) => {
    const mode = window.matchMedia('(display-mode: standalone)');
    mode.addEventListener('change', callback);
    return () => mode.removeEventListener('change', callback);
};
const needsIosHelp = () => !window.matchMedia('(display-mode: standalone)').matches && !navigator.standalone &&
    (/iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export default function InstallApp() {
    const pathname = usePathname();
    const [prompt, setPrompt] = useState(null);
    const ios = useSyncExternalStore(subscribeDisplayMode, needsIosHelp, () => false);
    const [dismissed, setDismissed] = useState(false);
    const [visible, setVisible] = useState(false);
    const [help, setHelp] = useState(false);
    useEffect(() => {
        if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
            navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => { /* Browser installation remains available without offline support. */ });
        }
        const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
        const beforeInstall = (event) => {
            event.preventDefault();
            if (!standalone) { setPrompt(event); setVisible(true); setDismissed(false); }
        };
        const installed = () => { setPrompt(null); setVisible(false); setDismissed(true); };
        window.addEventListener('beforeinstallprompt', beforeInstall);
        window.addEventListener('appinstalled', installed);
        return () => {
            window.removeEventListener('beforeinstallprompt', beforeInstall);
            window.removeEventListener('appinstalled', installed);
        };
    }, []);
    const install = async () => {
        if (ios) { setHelp((current) => !current); return; }
        if (!prompt) return;
        try {
            await prompt.prompt();
            await prompt.userChoice;
        } finally { setPrompt(null); setVisible(false); }
    };
    if ((!visible && !ios) || dismissed || pathname !== '/') return null;
    return <aside className={styles.banner} aria-label="Install PredictPOS">
        <div><strong>PredictPOS on your device</strong><p>{help ? 'On iPhone or iPad, open this site in Safari, tap Share, then Add to Home Screen.' : 'Install for quick access from your home screen.'}</p></div>
        <button type="button" className={styles.install} onClick={install}>{ios ? 'How to install' : 'Install app'}</button>
        <button type="button" className={styles.close} onClick={() => setDismissed(true)} aria-label="Dismiss install prompt">×</button>
    </aside>;
}
