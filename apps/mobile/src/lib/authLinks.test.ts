import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthCallback } from './authLinks.ts';

test('Supabase auth redirects are recognised, however encoded', () => {
  for (const url of [
    'pivot://%2523error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=',
    'pivot://#error=access_denied&error_code=otp_expired',
    'pivot://#access_token=abc&refresh_token=def&type=signup',
    'pivot://?code=1234',
  ]) assert.equal(isAuthCallback(url), true, url);
});

test('ordinary app links are left alone', () => {
  for (const url of ['pivot://', 'pivot://today', 'pivot://session/abc', '/plan']) {
    assert.equal(isAuthCallback(url), false, url);
  }
});
