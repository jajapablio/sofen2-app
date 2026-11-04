'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginForm({ account, onSwitchToSignup }) {
    const [showPassword, setShowPassword] = useState(false);
    const [role, setRole] = useState('');
    const [pinStep, setPinStep] = useState(false);
    const [enteredPin, setEnteredPin] = useState('');
    const [pinError, setPinError] = useState('');
    const router = useRouter();

    const handleSubmit = (e) => {
        e.preventDefault();

        if (!account) {
            alert("Please sign up before logging in.");
            return;
        }

        const formData = new FormData(e.currentTarget);
        const username = formData.get('username').trim().toLowerCase();
        const password = formData.get('password');

        if (username !== account.username || password !== account.password) {
            alert("Invalid username or password.");
            return;
        }

        if (account.pin) {
            setEnteredPin('');
            setPinError('');
            setPinStep(true);
        } else {
            router.push('/dashboard');
        }
    };

    const handlePinSubmit = (e) => {
        e.preventDefault();
        if (!account?.pin) {
            setPinStep(false);
            setPinError('');
            alert("Your account is unavailable. Please log in again.");
            return;
        }

        if (enteredPin !== account.pin) {
            setPinError("Incorrect PIN. Please try again.");
            setEnteredPin('');
            return;
        }
        router.push('/dashboard');
    };

    const appendPinDigit = (digit) => {
        setEnteredPin((current) => current.length < 6 ? current + digit : current);
        setPinError('');
    };

    if (pinStep && account?.pin) {
        return (
            <div className="form-container active">
                <form onSubmit={handlePinSubmit}>
                    <h2 className="pinSetupTitle">Enter your PIN</h2>
                    <p className="pinSetupDescription">Enter your 6-digit PIN to finish signing in.</p>
                    <div className="pinDots" aria-label={`${enteredPin.length} of 6 digits entered`}>
                        {Array.from({ length: 6 }, (_, index) => (
                            <span key={index} className={`pinDot ${index < enteredPin.length ? 'filled' : ''}`} />
                        ))}
                    </div>
                    {pinError && <p className="pinError" role="alert">{pinError}</p>}
                    <div className="pinPad">
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                            <button key={digit} type="button" onClick={() => appendPinDigit(String(digit))}>{digit}</button>
                        ))}
                        <button type="button" className="pinPadAction" onClick={() => setEnteredPin('')}>Clear</button>
                        <button type="button" onClick={() => appendPinDigit('0')}>0</button>
                        <button type="button" className="pinPadAction" onClick={() => setEnteredPin((current) => current.slice(0, -1))}>⌫</button>
                    </div>
                    <button type="submit" className="btn-primary" disabled={enteredPin.length !== 6}>Verify PIN</button>
                    <button type="button" className="btn-text-link pinSkipButton" onClick={() => setPinStep(false)}>Back to login</button>
                </form>
            </div>
        );
    }

    return (
        <div className="form-container active">
            <form onSubmit={handleSubmit}>
                <div className="input-group">
                    <label className="input-label">Select Role</label>
                    <i className="fas fa-briefcase input-icon-left"></i>
                    <select name="role" required value={role} onChange={(e) => setRole(e.target.value)}>
                        <option value="" disabled hidden>Choose a role</option>
                        <option value="cashier">Cashier</option>
                        <option value="manager">Manager</option>
                        <option value="admin">Admin</option>
                    </select>
                    <i className="fas fa-chevron-down input-icon-right"></i>
                </div>

                <div className="input-group">
                    <label className="input-label">Username</label>
                    <i className="fas fa-user input-icon-left"></i>
                    <input type="text" name="username" placeholder="Enter your username" autoComplete="username" required />
                </div>

                <div className="input-group">
                    <label className="input-label">Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        type={showPassword ? "text" : "password"} 
                        name="password" 
                        placeholder="••••••••" 
                        required 
                    />
                    <i 
                        className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowPassword(!showPassword)}
                    ></i>
                </div>

                <div className="form-options">
                    <label>
                        <input type="checkbox" /> Remember me
                    </label>
                    <a href="#" className="forgot-pass">Forgot Password?</a>
                </div>

                <button type="submit" className="btn-primary">Login
                </button>
            </form>

            <div className="bottom-section">
                <span>Don’t have an account yet?</span>
                <button type="button" className="btn-text-link" onClick={onSwitchToSignup}>Sign up</button>
            </div>
        </div>
    );
}