'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '../lib/supabase/client';

export default function LoginForm({ notice, signupEnabled, signupStatus, onSwitchToSignup }) {
    const [showPassword, setShowPassword] = useState(false);
    const [identifier, setIdentifier] = useState('');
    const [feedback, setFeedback] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const router = useRouter();

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const loginIdentifier = formData.get('identifier').trim();
        const password = formData.get('password');

        setIsSubmitting(true);
        setFeedback('');

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: loginIdentifier, password }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to sign in.');

            const supabase = getSupabaseClient();
            const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
                access_token: result.access_token,
                refresh_token: result.refresh_token,
            });
            if (sessionError) throw sessionError;

            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('role, store_id, global_access, is_active')
                .eq('id', sessionData.user.id)
                .maybeSingle();

            if (profileError) throw profileError;
            if (!profile || !profile.is_active) {
                await supabase.auth.signOut();
                throw new Error('This account has no active staff profile. Contact your administrator.');
            }

            if (!profile.store_id && !(profile.role === 'admin' || (profile.role === 'manager' && profile.global_access))) {
                await supabase.auth.signOut();
                throw new Error('This account is not assigned to a store yet. Contact your administrator.');
            }

            router.push(profile.role === 'admin'
                ? '/dashboard/admin'
                : profile.role === 'manager'
                    ? '/dashboard/manager'
                    : '/dashboard');
        } catch (error) {
            setFeedback(error.message || 'Unable to sign in. Check your connection and try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handlePasswordReset = async () => {
        const emailAddress = identifier.trim().toLowerCase();
        if (!emailAddress.includes('@')) {
            setFeedback('Enter your email address to request a password reset.');
            return;
        }

        try {
            const supabase = getSupabaseClient();
            const { error } = await supabase.auth.resetPasswordForEmail(emailAddress, {
                redirectTo: window.location.origin,
            });
            if (error) throw error;
            setFeedback('If an account exists for that email, a password reset link has been sent.');
        } catch (error) {
            setFeedback(error.message || 'Unable to request a password reset.');
        }
    };

    return (
        <div className="form-container active">
            <form onSubmit={handleSubmit}>
                <div className="input-group">
                    <label className="input-label" htmlFor="login-identifier">Username or Email</label>
                    <i className="fas fa-user input-icon-left"></i>
                    <input id="login-identifier" type="text" name="identifier" placeholder="Username or email" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="login-password">Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        id="login-password"
                        type={showPassword ? "text" : "password"} 
                        name="password" 
                        placeholder="••••••••" 
                        autoComplete="current-password"
                        required 
                    />
                    <i 
                        className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowPassword(!showPassword)}
                    ></i>
                </div>

                <div className="form-options">
                    <span>Use your username or email.</span>
                    <button type="button" className="forgot-pass" onClick={handlePasswordReset}>Forgot Password?</button>
                </div>

                {notice && <p className="authFeedback success" role="status">{notice}</p>}
                {feedback && <p className="authFeedback error" role="alert">{feedback}</p>}
                {signupStatus === 'unavailable' && signupEnabled && <p className="authFeedback warning" role="status">Signup availability could not be checked. The server will verify when you submit.</p>}

                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Signing in…' : 'Login'}
                </button>
            </form>

            <div className="bottom-section">
                {signupEnabled ? (
                    <>
                        <span>Setting up a new store?</span>
                        <button type="button" className="btn-text-link" onClick={onSwitchToSignup}>Sign up</button>
                    </>
                ) : (
                    <span>New store signups are currently disabled.</span>
                )}
            </div>
        </div>
    );
}