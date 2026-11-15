import assert from 'node:assert/strict';
import { backendAddress } from '../frontend/js/data/backendAddress.js';
assert.deepEqual(backendAddress('', 'mateibut.github.io'), {
  base: 'https://blink3-api-w3bm7ii4fq-ew.a.run.app', allowed: true, remote: true, error: null
});
assert.deepEqual(backendAddress('', 'iooonut.github.io'), {
  base: 'https://blink3-api-w3bm7ii4fq-ew.a.run.app', allowed: true, remote: true, error: null
});
assert.deepEqual(backendAddress('', 'andrei25ciuta.github.io'), backendAddress('', 'mateibut.github.io'));
assert.equal(backendAddress('', 'example.com').allowed, false);
assert.equal(backendAddress('http://localhost:8001', 'mateibut.github.io').allowed, false);
assert.equal(backendAddress('https://127.0.0.1', 'mateibut.github.io').allowed, false);
assert.equal(backendAddress('http://localhost:8001', 'localhost').allowed, true);
assert.deepEqual(backendAddress('https://blink.example/', 'iooonut.github.io'), {
  base: 'https://blink.example', allowed: true, remote: true, error: null
});
for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path',
  'https://example.com?key=secret', 'javascript:alert(1)', 'bad']) {
  assert.equal(backendAddress(url).allowed, false);
  assert.ok(backendAddress(url).error);
}
console.log('Cloud address checks passed');
