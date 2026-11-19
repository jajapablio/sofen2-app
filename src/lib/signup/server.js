import { createHmac, randomInt, randomUUID } from 'node:crypto';
import { getSupabaseAdminClient } from '../supabase/admin';
import { sendEmailJs } from '../emailjs/server';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = (text) => createHmac('sha256', process.env.PASSWORD_RESET_SECRET).update(`signup:${text}`).digest('hex');
const invalidCode = 'This verification code is invalid, expired, or already used. Check your code or request a new one.';

async function rpc(admin, name, params) {
    const { data, error } = await admin.rpc(name, params);
    if (error) throw new Error('Signup verification storage is unavailable.');
    return data;
}

export async function handleOwnerSignup(request) {
    let body;
    try {
        const origin = request.headers.get('origin');
        if (origin && origin !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 400);
        if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Expected JSON.' }, 400);
        const raw = await request.text();
        if (raw.length > 4096) return json({ error: 'Request too large.' }, 400);
        body = JSON.parse(raw);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body.');
    } catch { return json({ error: 'Invalid signup request.' }, 400); }

    const value = (key) => typeof body[key] === 'string' ? body[key].trim() : '';
    const fullName = value('fullName');
    const username = value('username').toLowerCase();
    const storeName = value('storeName');
    const email = value('email').toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const action = body.action || 'request';
    if (!fullName || fullName.length > 120 || !storeName || storeName.length > 120 ||
        email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        password.length < 8 || password.length > 128 || !/^[a-z0-9._-]{3,24}$/.test(username)) {
        return json({ error: 'Enter your name, username (3–24 letters/numbers/._-), store, valid email, and a password of 8–128 characters.' }, 400);
    }
    if (action !== 'request' && action !== 'verify') return json({ error: 'Invalid signup action.' }, 400);

    try {
        if (!process.env.PASSWORD_RESET_SECRET || process.env.PASSWORD_RESET_SECRET.length < 32) throw new Error('Verification secret missing.');
        const admin = getSupabaseAdminClient();
        if (action === 'request') {
            if (['EMAILJS_SERVICE_ID', 'EMAILJS_SIGNUP_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY'].some((key) => !process.env[key])) {
                return json({ error: 'Signup email verification is not configured yet. Please contact your administrator.' }, 503);
            }
            const challengeId = randomUUID();
            const code = String(randomInt(0, 100000000)).padStart(8, '0');
            const ip = process.env.VERCEL === '1'
                ? request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
                : process.env.NODE_ENV === 'production' ? 'shared-proxy' : 'development';
            const result = await rpc(admin, 'request_signup_verification', {
                p_id: challengeId, p_email_key: digest(`email:${email}`),
                p_ip_key: digest(`ip:${ip}`), p_code_hash: digest(`${challengeId}:${code}`),
            });
            if (result.limited) return json({ error: 'Too many verification requests. Wait at least 60 seconds between codes; the email limit is 5 per hour.' }, 429);
            try {
                await sendEmailJs(process.env.EMAILJS_SIGNUP_TEMPLATE_ID, {
                    to_email: email, verification_code: code, code,
                    expires_in: '10 minutes', app_name: 'PredictPOS', full_name: fullName,
                });
            } catch {
                await rpc(admin, 'invalidate_signup_verification', { p_id: challengeId });
                console.error('Signup verification email delivery failed.');
                return json({ error: 'Unable to send your verification email. Please try again later or contact your administrator.' }, 503);
            }
            return json({ verificationRequired: true, challengeId,
                message: 'A verification code has been sent. Check your inbox and spam folder.' }, 202);
        }

        const { challengeId, code } = body;
        if (typeof challengeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId) ||
            typeof code !== 'string' || !/^\d{8}$/.test(code)) return json({ error: 'Enter the 8-digit verification code from your email.' }, 400);
        const verified = await rpc(admin, 'consume_signup_verification', {
            p_id: challengeId, p_email_key: digest(`email:${email}`), p_code_hash: digest(`${challengeId}:${code}`),
        });
        if (!verified) return json({ error: invalidCode }, 400);

        // This is the ONLY owner creation path, reached after atomic mailbox proof.
        // No pending Auth account, store, profile, or session is created when sending a code.
        let userId;
        try {
            const { data, error } = await admin.auth.admin.createUser({
                email, password, email_confirm: true,
                user_metadata: { full_name: fullName, username, account_type: 'store_owner' },
            });
            if (error || !data.user?.id) throw new Error('Account creation failed.');
            userId = data.user.id;
            const { data: storeId, error: provisionError } = await admin.rpc('provision_verified_store_owner', {
                p_user_id: userId, p_full_name: fullName, p_username: username, p_store_name: storeName,
            });
            if (provisionError || !storeId) throw new Error('Store provisioning failed.');
            return json({ message: 'Email verified. Administrator and store created. Sign in with your username or email.' }, 201);
        } catch {
            if (userId) {
                // Provisioning is transactional; no store/profile/audit survives a failed RPC.
                try {
                    const { error } = await admin.auth.admin.deleteUser(userId);
                    if (error) console.error('Signup account cleanup needs administrator attention.');
                } catch { console.error('Signup account cleanup needs administrator attention.'); }
            }
            return json({ error: 'Unable to create the account. The email or username may already be in use, or the password may not meet requirements. Go back and request a new code.' }, 400);
        }
    } catch {
        console.error('Signup verification unavailable. Check server configuration and migration.');
        return json({ error: 'Signup verification is temporarily unavailable. Please contact your administrator.' }, 503);
    }
}
