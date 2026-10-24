import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ServerStore, validateServer } from '../apps/electron/store';
const valid = { id: 'test', name: 'Test', host: 'example.com', port: 22, root: '~/deployments', useSshConfig: false, username: 'deploy' };
test('rejects SSH option injection, traversal, broad roots and invalid ports', () => {
  for (const host of ['-oProxyCommand=evil', 'host;id', 'a\nb', 'a b']) assert.throws(() => validateServer({ ...valid, host }));
  for (const root of ['/', '/etc', '/tmp/../etc', '~/']) assert.throws(() => validateServer({ ...valid, root }));
  for (const port of [0, -1, 65536, '22']) assert.throws(() => validateServer({ ...valid, port }));
});
test('server persistence serializes parallel saves and deletion only changes local records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dockloom-store-'));
  try {
    const store = new ServerStore(dir);
    await Promise.all([store.save(valid), store.save({ ...valid, id: 'other' })]);
    assert.equal((await store.list()).length, 2);
    await store.remove('test'); assert.equal((await store.list())[0].id, 'other');
    assert.equal((await new ServerStore(dir).get('other')).host, 'example.com');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
