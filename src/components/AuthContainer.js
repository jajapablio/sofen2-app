'use client';

import { useState } from 'react';
import Image from 'next/image';
import LoginForm from './LoginForm';
import PinSetup from './PinSetup';
import SignupForm from './SignupForm';
import InteractiveParticles from './InteractiveParticles';

export default function AuthContainer() {
    const [screen, setScreen] = useState('login');
    const [account, setAccount] = useState(null);
    const isLogin = screen === 'login';

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
                <LoginForm account={account} onSwitchToSignup={() => setScreen('signup')} />
            ) : screen === 'signup' ? (
                <SignupForm
                    onSignup={(newAccount) => {
                        setAccount(newAccount);
                        setScreen('pinSetup');
                    }}
                    onSwitchToLogin={() => setScreen('login')}
                />
            ) : (
                <PinSetup
                    onComplete={(pin) => {
                        setAccount((currentAccount) => ({ ...currentAccount, pin }));
                        setScreen('login');
                    }}
                    onSkip={() => setScreen('login')}
                />
            )}
        </div>
    );
}