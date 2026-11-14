import { createHmac, timingSafeEqual } from 'node:crypto';

function sign(payload) {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!secret) throw new Error('Payment server credentials are not configured.');
    return createHmac('sha256', secret).update(`predictpos:qr:v1:${payload}`).digest('base64url');
}

export function createQrToken(payment) {
    const payload = Buffer.from(JSON.stringify({ id: payment.id, exp: new Date(payment.expires_at).getTime() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

export function verifyQrToken(token, paymentId) {
    try {
        if (typeof token !== 'string' || token.length > 1024) return false;
        const parts = token.split('.');
        if (parts.length !== 2) return false;
        const [payload, signature] = parts;
        const expected = Buffer.from(sign(payload));
        const actual = Buffer.from(signature);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
        const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return claims.id === paymentId && Number.isFinite(claims.exp) && claims.exp > Date.now();
    } catch { return false; }
}
