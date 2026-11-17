'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import styles from './PasswordResetDialog.module.css';

export default function PasswordResetDialog({ initialEmail, onClose, onComplete }) {
    const dialog = useRef(null);
    const client = useRef(null);
    const [step, setStep] = useState('email');
    const [email, setEmail] = useState(initialEmail);
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [retryAt, setRetryAt] = useState(0);
    const [now, setNow] = useState(0);
    const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));

    useEffect(() => {
        const previousFocus = document.activeElement;
        dialog.current.showModal();
        return () => {
            // Recovery sessions stay in memory and never replace the login session.
            if (client.current) void client.current.auth.signOut({ scope: 'local' });
            previousFocus?.focus();
        };
    }, []);

    useEffect(() => {
        if (!retryAt) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [retryAt]);

    const getClient = () => {
        if (!client.current) {
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
            const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
            if (!url || !key) throw new Error('Password reset is not configured. Contact your administrator.');
            client.current = createClient(url, key, {
                auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
            });
        }
        return client.current;
    };

    const sendCode = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const { error } = await getClient().auth.resetPasswordForEmail(email.trim().toLowerCase());
            if (error) throw error;
            setEmail(email.trim().toLowerCase());
            setCode('');
            setStep('code');
            setMessage('If an account exists for this email, a reset code has been sent. Check your inbox and spam folder.');
            const timestamp = Date.now();
            setNow(timestamp);
            setRetryAt(timestamp + 60000);
        } catch (error) {
            setError(error.message || 'Unable to send a reset code. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    const submit = async (event) => {
        event.preventDefault();
        if (busy) return;
        if (step === 'email') return sendCode();
        setError('');
        setMessage('');
        if (step === 'password' && password !== confirmation) {
            setError('Passwords do not match.');
            return;
        }
        setBusy(true);
        try {
            if (step === 'code') {
                const { data, error } = await getClient().auth.verifyOtp({
                    email, token: code.trim(), type: 'recovery',
                });
                if (error || !data.session) throw new Error('This code is invalid or expired. Try again or request a new code.');
                setCode('');
                setStep('password');
            } else {
                const { error } = await getClient().auth.updateUser({ password });
                if (error) throw error;
                await getClient().auth.signOut({ scope: 'local' });
                onComplete('Your password has been reset. Sign in with your new password.');
            }
        } catch (error) {
            setError(error.message || 'Unable to reset your password. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <dialog ref={dialog} className={styles.dialog} aria-labelledby="reset-title" aria-describedby="reset-description"
            onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
            <button className={styles.close} type="button" aria-label="Close password reset" disabled={busy} onClick={onClose}>×</button>
            <h2 id="reset-title">{step === 'password' ? 'Set a new password' : 'Forgot password?'}</h2>
            <p id="reset-description">{step === 'email' ? 'Enter your registered email address and we’ll send you a reset code.' : step === 'code' ? `Enter the code sent to ${email}.` : 'Choose a new password for your account.'}</p>
            <form onSubmit={submit}>
                <fieldset disabled={busy} className={styles.fields}>
                    {step === 'email' && <label>Email address<input autoFocus type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
                    {step === 'code' && <label>Reset code<input autoFocus key="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]+" required value={code} onChange={(event) => setCode(event.target.value)} /></label>}
                    {step === 'password' && <>
                        <label>New password<input autoFocus key="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
                        <p className={styles.hint}>Use at least 8 characters.</p>
                    </>}
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    {message && <p className={styles.message} role="status">{message}</p>}
                    <button type="submit" className="btn-primary">{busy ? 'Please wait…' : step === 'email' ? 'Send code' : step === 'code' ? 'Verify code' : 'Reset password'}</button>
                    {step === 'code' && <div className={styles.actions}>
                        <button type="button" disabled={remaining > 0} onClick={sendCode}>{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</button>
                        <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setMessage(''); }}>Change email</button>
                    </div>}
                </fieldset>
            </form>
        </dialog>
    );
}
