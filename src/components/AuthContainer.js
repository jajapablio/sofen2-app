'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import LoginForm from './LoginForm';
import SignupForm from './SignupForm';
import InteractiveParticles from './InteractiveParticles';

export default function AuthContainer() {
    const [screen, setScreen] = useState('login');
    const [notice, setNotice] = useState('');
    const [signupStatus, setSignupStatus] = useState('checking');
    const signupEnabled = signupStatus !== 'closed';
    const isLogin = screen === 'login';

    useEffect(() => {
        fetch('/api/auth/register-owner')
            .then(async (response) => {
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Could not check signup availability.');
                setSignupStatus(result.enabled ? 'enabled' : 'closed');
            })
            .catch(() => setSignupStatus('unavailable'));
    }, []);

    return (
        <div className="container">
            <InteractiveParticles />
            <div className={`left-panel ${!isLogin ? 'signup-mode' : ''}`}>
                <div className="logo">
                    <Image
                        src="/logos/android-chrome-192x192.png"
                        alt=""
                        className="logo-icon"
                        width={40}
                        height={40}
                    />
                    <span className="logo-text">redictPOS</span>
                </div>
                <div className="welcome-text">
                    <h1>Hello,<br />welcome to PredictPOS!</h1>
                    <p>An automated POS and inventory control system using predictive analysis for sales forecasting.</p>
                </div>
            </div>

            {screen === 'login' ? (
                <LoginForm
                    notice={notice}
                    signupEnabled={signupEnabled}
                    signupStatus={signupStatus}
                    onSwitchToSignup={signupEnabled ? () => {
                        setNotice('');
                        setScreen('signup');
                    } : undefined}
                />
            ) : (
                <SignupForm
                    onSignup={(message) => {
                        setNotice(message);
                        setScreen('login');
                    }}
                    onSwitchToLogin={() => {
                        setNotice('');
                        setScreen('login');
                    }}
                />
            )}
        </div>
    );
}