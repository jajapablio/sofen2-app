'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './SignupVerification.module.css';

export default function SignupVerification({ registration, onVerified, onBack }) {
    const [challengeId, setChallengeId] = useState(registration.challengeId);
    const [code, setCode] = useState('');
    const [feedback, setFeedback] = useState('A verification code was sent. Check your inbox and spam folder.');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [remaining, setRemaining] = useState(60);
    const retryAt = useRef(0);
    const input = useRef(null);

    useEffect(() => {
        input.current?.focus();
        retryAt.current = Date.now() + 60000;
        const timer = setInterval(() => setRemaining(Math.max(0, Math.ceil((retryAt.current - Date.now()) / 1000))), 1000);
        return () => clearInterval(timer);
    }, []);

    const submit = async (action) => {
        if (busy) return;
        setBusy(true);
        setError('');
        setFeedback('');
        try {
            const { challengeId: initialChallengeId, ...fields } = registration;
            // Only submit original form values and the current challenge. Never persist the password.
            const response = await fetch('/api/auth/register-owner', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...fields, action, challengeId: challengeId || initialChallengeId, code: code.trim() }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to verify your email.');
            if (action === 'verify') {
                onVerified(result.message || 'Email verified. Your account is ready. Please sign in.');
            } else {
                setChallengeId(result.challengeId);
                setCode('');
                retryAt.current = Date.now() + 60000;
                setRemaining(60);
                setFeedback('A new verification code was sent. Use the most recent email.');
                input.current?.focus();
            }
        } catch (error) {
            setError(error.message || 'Unable to verify your email.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className={`form-container active ${styles.verification}`}>
            <h2>Verify your email</h2>
            <p id="signup-verification-description">Enter the 8-digit code sent to <strong>{registration.email}</strong>. It expires in 10 minutes.</p>
            <form onSubmit={(event) => { event.preventDefault(); submit('verify'); }}>
                <div className="input-group">
                    <label className="input-label" htmlFor="signup-verification-code">Verification code</label>
                    <input ref={input} id="signup-verification-code" className={styles.code} type="text" inputMode="numeric" autoComplete="one-time-code"
                        aria-describedby="signup-verification-description" pattern="[0-9]{8}" minLength={8} maxLength={8} required
                        value={code} onChange={(event) => setCode(event.target.value)} disabled={busy} />
                </div>
                {feedback && <p className="authFeedback success" role="status">{feedback}</p>}
                {error && <p className="authFeedback error" role="alert">{error}</p>}
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Please wait…' : 'Verify email & create account'}</button>
                <div className={styles.actions}>
                    <button type="button" className="btn-text-link" disabled={busy || remaining > 0} onClick={() => submit('request')}>
                        {remaining > 0 ? `Resend in ${remaining}s` : 'Resend code'}
                    </button>
                    <button type="button" className="btn-text-link" disabled={busy} onClick={onBack}>Edit signup details</button>
                </div>
            </form>
            <p className={styles.hint}>Your account and store are created only after your email is verified.</p>
        </div>
    );
}
