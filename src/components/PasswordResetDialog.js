'use client';

import { useEffect, useState } from 'react';
import AuthDialog from './AuthDialog';
import styles from './AuthDialog.module.css';

export default function PasswordResetDialog({ initialEmail, onClose, onComplete, returnFocusRef }) {
    const [challengeId, setChallengeId] = useState('');
    const [resetToken, setResetToken] = useState('');
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
        if (!retryAt) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [retryAt]);

    const api = async (action, values) => {
        const response = await fetch(`/api/auth/password-reset/${action}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to reset your password.');
        return result;
    };

    const sendCode = async () => {
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const result = await api('request', { email: email.trim().toLowerCase() });
            setChallengeId(result.challengeId);
            setResetToken('');
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
                const result = await api('verify', { challengeId, code: code.trim() });
                setResetToken(result.resetToken);
                setCode('');
                setStep('password');
            } else {
                await api('complete', { challengeId, resetToken, password });
                setResetToken('');
                onComplete('Your password has been reset. Sign in with your new password.');
            }
        } catch (error) {
            setError(error.message || 'Unable to reset your password. Please try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthDialog
            title={step === 'password' ? 'Set a new password' : step === 'code' ? 'Verify reset code' : 'Forgot password?'}
            eyebrow="Password recovery" busy={busy} onClose={onClose} returnFocusRef={returnFocusRef}
            description={step === 'email' ? 'Enter your registered email address and we’ll send you a reset code.' : step === 'code' ? <>Enter the 8-digit code sent to <strong>{email}</strong></> : 'Choose a new password to keep your account secure.'}
            hint={step === 'code' ? 'Your reset code expires in 10 minutes.' : 'Your account details stay protected throughout this process.'}>
            <form onSubmit={submit}>
                <fieldset disabled={busy} className={styles.fields}>
                    {step === 'email' && <label>Email address<input autoFocus type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
                    {step === 'code' && <label>Reset code<input className={styles.code} placeholder="00000000" autoFocus key="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} required value={code} onChange={(event) => setCode(event.target.value)} /></label>}
                    {step === 'password' && <>
                        <label>New password<input autoFocus key="password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
                        <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
                        <p className={styles.description}>Use at least 8 characters.</p>
                    </>}
                    {error && <p className={styles.error} role="alert">{error}</p>}
                    {message && <p className={styles.message} role="status">{message}</p>}
                    <button type="submit" className={styles.primary}>{busy ? 'Please wait…' : step === 'email' ? 'Send code' : step === 'code' ? 'Verify code' : 'Reset password'}</button>
                    {step === 'code' && <div className={styles.actions}>
                        <button type="button" disabled={remaining > 0} onClick={sendCode}>{remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}</button>
                        <button type="button" onClick={() => { setStep('email'); setCode(''); setChallengeId(''); setResetToken(''); setError(''); setMessage(''); }}>Change email</button>
                    </div>}
                </fieldset>
            </form>
        </AuthDialog>
    );
}
