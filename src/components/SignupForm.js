'use client';

import { useState } from 'react';

export default function SignupForm({ onSignup, onSwitchToLogin }) {
    const [showPass, setShowPass] = useState(false);
    const [showConfirmPass, setShowConfirmPass] = useState(false);
    const [feedback, setFeedback] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const password = formData.get('password');
        const confirmPassword = formData.get('confirm_password');
        const fullName = formData.get('fullname').trim();
        const username = formData.get('username').trim().toLowerCase();
        const storeName = formData.get('store_name').trim();
        const email = formData.get('email').trim().toLowerCase();

        if (password !== confirmPassword) {
            setFeedback('Passwords do not match.');
            return;
        }

        setFeedback('');
        setIsSubmitting(true);

        try {
            const response = await fetch('/api/auth/register-owner', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fullName, username, storeName, email, password }),
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Unable to create the account.');

            onSignup('Administrator and store created. Sign in with your username or email.');
        } catch (error) {
            setFeedback(error.message || 'Unable to create the account. Try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="form-container signup-form-container active">
            <form className="signup-form" onSubmit={handleSubmit}>
                <div className="input-group">
                    <label className="input-label" htmlFor="signup-fullname">Full Name</label>
                    <i className="fas fa-id-card input-icon-left"></i>
                    <input id="signup-fullname" type="text" name="fullname" placeholder="Enter your full name" autoComplete="name" required />
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="signup-username">Username</label>
                    <i className="fas fa-user input-icon-left"></i>
                    <input id="signup-username" type="text" name="username" placeholder="Choose a username" minLength={3} maxLength={24} pattern="[A-Za-z0-9._-]+" autoComplete="username" required />
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="signup-store">Business or Store Name</label>
                    <i className="fas fa-store input-icon-left"></i>
                    <input id="signup-store" type="text" name="store_name" placeholder="Your business or store name" maxLength={120} required />
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="signup-email">Email Address</label>
                    <i className="fas fa-envelope input-icon-left"></i>
                    <input id="signup-email" type="email" name="email" placeholder="you@example.com" autoComplete="email" required />
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="signup-password">Create Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        id="signup-password"
                        type={showPass ? "text" : "password"} 
                        name="password" 
                        placeholder="••••••••" 
                        autoComplete="new-password"
                        minLength={8}
                        required 
                    />
                    <i 
                        className={`fas ${showPass ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowPass(!showPass)}
                    ></i>
                </div>

                <div className="input-group">
                    <label className="input-label" htmlFor="signup-confirm-password">Confirm Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        id="signup-confirm-password"
                        type={showConfirmPass ? "text" : "password"} 
                        name="confirm_password" 
                        placeholder="••••••••" 
                        autoComplete="new-password"
                        minLength={8}
                        required 
                    />
                    <i 
                        className={`fas ${showConfirmPass ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                    ></i>
                </div>

                {feedback && <p className="authFeedback error" role="alert">{feedback}</p>}
                {feedback && <p className="authFeedback error" role="alert">{feedback}</p>}
                <button type="submit" className="btn-primary" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating account…' : 'Create Account'}
                </button>
            </form>

            <div className="bottom-section">
                <span>Have an account?</span>
                <button type="button" className="btn-text-link" onClick={onSwitchToLogin}>Login</button>
            </div>
        </div>
    );
}