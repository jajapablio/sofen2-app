import { createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '../supabase/admin';

const invalidCode = 'This code is invalid or expired. Request a new code and try again.';
const json = (body, status = 200) => Response.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
});

function configuration() {
    const names = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'PASSWORD_RESET_SECRET'];
    if (names.some((name) => !process.env[name]) || process.env.PASSWORD_RESET_SECRET.length < 32) {
        throw new Error('Password reset configuration is incomplete.');
    }
}

export function digest(value) {
    return createHmac('sha256', process.env.PASSWORD_RESET_SECRET).update(value).digest('hex');
}

async function rpc(admin, name, params) {
    const { data, error } = await admin.rpc(name, params);
    if (error) throw new Error('Password reset storage is unavailable.');
    return data;
}

async function readBody(request) {
    // Same-origin JSON requests only. No cookies or browser-supplied identity are trusted.
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) throw new Error('Invalid request origin.');
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Expected JSON.');
    const text = await request.text();
    if (text.length > 4096) throw new Error('Request too large.');
    return JSON.parse(text);
}

export async function handleReset(request, action) {
    let body;
    try { body = await readBody(request); } catch { return json({ error: 'Invalid request.' }, 400); }
    try {
        configuration();
        const admin = getSupabaseAdminClient();
        if (action === 'request') {
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
            const challengeId = randomUUID();
            const code = String(randomInt(0, 100000000)).padStart(8, '0');
            // Vercel overwrites this header. Other hosts must configure a trusted proxy
            // before enabling the endpoint; never trust a caller's X-Forwarded-For.
            const ip = process.env.VERCEL === '1'
                ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
                : process.env.NODE_ENV === 'production' ? 'shared-proxy' : 'development';
            const result = await rpc(admin, 'request_password_reset', {
                p_id: challengeId, p_email: email, p_email_key: digest(`email:${email}`),
                p_ip_key: digest(`ip:${ip}`), p_code_hash: digest(`${challengeId}:${code}`),
            });
            if (result.limited) return json({ error: 'Too many requests. Please wait before trying again.' }, 429);
            if (result.deliver) {
                try {
                    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            service_id: process.env.EMAILJS_SERVICE_ID,
                            template_id: process.env.EMAILJS_TEMPLATE_ID,
                            user_id: process.env.EMAILJS_PUBLIC_KEY,
                            accessToken: process.env.EMAILJS_PRIVATE_KEY,
                            template_params: { to_email: email, reset_code: code, expires_in: '10 minutes', app_name: 'PredictPOS' },
                        }),
                        signal: AbortSignal.timeout(10000),
                    });
                    if (!response.ok) throw new Error('Email delivery failed.');
                } catch {
                    // Do not reveal account existence via provider errors.
                    await rpc(admin, 'invalidate_password_reset', { p_id: challengeId });
                    console.error('Password reset email delivery failed. Check EmailJS configuration and quotas.');
                }
            }
            return json({ challengeId, message: 'If an account exists for this email, a reset code has been sent. Check your inbox and spam folder.' });
        }
        if (typeof body.challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.challengeId)) return json({ error: invalidCode }, 400);
        if (action === 'verify') {
            if (typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) return json({ error: 'Enter the 8-digit code from your email.' }, 400);
            const resetToken = randomBytes(32).toString('hex');
            const valid = await rpc(admin, 'verify_password_reset', {
                p_id: body.challengeId, p_code_hash: digest(`${body.challengeId}:${body.code}`),
                p_grant_hash: digest(`grant:${resetToken}`),
            });
            return valid ? json({ resetToken }) : json({ error: invalidCode }, 400);
        }
        if (action === 'complete') {
            if (typeof body.resetToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.resetToken)) return json({ error: invalidCode }, 400);
            if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) return json({ error: 'Use a password between 8 and 128 characters.' }, 400);
            // Consume atomically BEFORE updating Auth, so concurrent/replayed requests cannot reset twice.
            const userId = await rpc(admin, 'consume_password_reset', {
                p_id: body.challengeId, p_grant_hash: digest(`grant:${body.resetToken}`),
            });
            if (!userId) return json({ error: 'Reset verification expired or was already used. Request a new code.' }, 400);
            const { error } = await admin.auth.admin.updateUserById(userId, { password: body.password });
            if (error) return json({ error: 'Unable to update the password. Check your password requirements and request a new code.' }, 400);
            return json({ message: 'Your password has been reset. Sign in with your new password.' });
        }
        return json({ error: 'Invalid request.' }, 400);
    } catch {
        // No provider details, codes, tokens, emails, or service keys in responses/logs.
        console.error('Password reset unavailable. Check server configuration and database migration.');
        return json({ error: 'Password reset is temporarily unavailable. Please contact your administrator.' }, 503);
    }
}
