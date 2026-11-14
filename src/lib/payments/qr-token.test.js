import assert from 'node:assert/strict';
import test from 'node:test';
import { createQrToken, verifyQrToken } from './qr-token.js';

test('QR capability binds a signed token to one payment and its expiration', () => {
    const previous = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'unit-test-only-signing-key';
    try {
        const token = createQrToken({ id: 'payment-one', expires_at: new Date(Date.now() + 300000).toISOString() });
        assert.equal(verifyQrToken(token, 'payment-one'), true);
        assert.equal(verifyQrToken(token, 'payment-two'), false);
        assert.equal(verifyQrToken(`${token}x`, 'payment-one'), false);
        assert.equal(verifyQrToken('', 'payment-one'), false);
        assert.equal(verifyQrToken(null, 'payment-one'), false);
        const expired = createQrToken({ id: 'payment-one', expires_at: new Date(Date.now() - 1000).toISOString() });
        assert.equal(verifyQrToken(expired, 'payment-one'), false);
        process.env.SUPABASE_SERVICE_ROLE_KEY = 'rotated-unit-test-key';
        assert.equal(verifyQrToken(token, 'payment-one'), false);
    } finally {
        if (previous === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        else process.env.SUPABASE_SERVICE_ROLE_KEY = previous;
    }
});
