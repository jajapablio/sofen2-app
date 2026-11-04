'use client';

import { useState } from 'react';

export default function PinSetup({ onComplete, onSkip }) {
    const [pin, setPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!/^\d{6}$/.test(pin)) {
            alert("PIN must be exactly 6 digits.");
            return;
        }
        if (pin !== confirmPin) {
            alert("PINs do not match.");
            return;
        }
        onComplete(pin);
    };

    return (
        <div className="form-container active">
            <form onSubmit={handleSubmit}>
                <h2 className="pinSetupTitle">Set up a PIN</h2>
                <p className="pinSetupDescription">Create a 6-digit PIN for an extra login verification step. You can skip this and add a PIN later.</p>
                <div className="input-group">
                    <label className="input-label" htmlFor="setup-pin">Create 6-Digit PIN</label>
                    <i className="fas fa-key input-icon-left"></i>
                    <input
                        id="setup-pin"
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={pin}
                        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter a 6-digit PIN"
                        required
                    />
                </div>
                <div className="input-group">
                    <label className="input-label" htmlFor="confirm-setup-pin">Confirm PIN</label>
                    <i className="fas fa-key input-icon-left"></i>
                    <input
                        id="confirm-setup-pin"
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={confirmPin}
                        onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Re-enter your PIN"
                        required
                    />
                </div>
                <button type="submit" className="btn-primary">Save PIN</button>
                <button type="button" className="btn-text-link pinSkipButton" onClick={onSkip}>Skip for now</button>
            </form>
        </div>
    );
}
