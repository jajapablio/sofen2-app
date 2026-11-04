'use client';

import { useState } from 'react';

export default function SignupForm({ onSignup, onSwitchToLogin }) {
    const [showPass, setShowPass] = useState(false);
    const [showConfirmPass, setShowConfirmPass] = useState(false);

    const handleSubmit = (e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const password = formData.get('password');
        const confirmPassword = formData.get('confirm_password');

        if (password !== confirmPassword) {
            alert("Passwords do not match.");
            return;
        }

        alert("Account created! You can set up a PIN now or skip this step.");
        onSignup({
            username: formData.get('username').trim().toLowerCase(),
            password
        });
    };

    return (
        <div className="form-container signup-form-container active">
            <form className="signup-form" onSubmit={handleSubmit}>
                <div className="input-group">
                    <label className="input-label">Full Name</label>
                    <i className="fas fa-id-card input-icon-left"></i>
                    <input type="text" name="fullname" placeholder="Enter your full name" required />
                </div>

                <div className="input-group">
                    <label className="input-label">Username</label>
                    <i className="fas fa-user input-icon-left"></i>
                    <input
                        type="text"
                        name="username"
                        placeholder="Choose a username"
                        minLength={3}
                        maxLength={24}
                        pattern="[A-Za-z0-9._-]+"
                        autoComplete="username"
                        required
                    />
                </div>

                <div className="input-group">
                    <label className="input-label">Email Address</label>
                    <i className="fas fa-envelope input-icon-left"></i>
                    <input type="email" name="email" placeholder="your.email@example.com" required />
                </div>

                <div className="input-group">
                    <label className="input-label">Business Name</label>
                    <i className="fas fa-store input-icon-left"></i>
                    <input type="text" name="business_name" placeholder="Your Business Name" required />
                </div>

                <div className="input-group">
                    <label className="input-label">Create Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        type={showPass ? "text" : "password"} 
                        name="password" 
                        placeholder="••••••••" 
                        required 
                    />
                    <i 
                        className={`fas ${showPass ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowPass(!showPass)}
                    ></i>
                </div>

                <div className="input-group">
                    <label className="input-label">Confirm Password</label>
                    <i className="fas fa-lock input-icon-left"></i>
                    <input 
                        type={showConfirmPass ? "text" : "password"} 
                        name="confirm_password" 
                        placeholder="••••••••" 
                        required 
                    />
                    <i 
                        className={`fas ${showConfirmPass ? 'fa-eye-slash' : 'fa-eye'} toggle-password`} 
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                    ></i>
                </div>

                <button type="submit" className="btn-primary">Create Account</button>
            </form>

            <div className="bottom-section">
                <span>Already have an account?</span>
                <button type="button" className="btn-text-link" onClick={onSwitchToLogin}>Login</button>
            </div>
        </div>
    );
}