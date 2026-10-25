import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DeploymentCore, REMOTE_PYTHON, validateComposeDeploy, type RemoteTransport } from '../packages/core/index';
import type { ComposeDeploy, Server } from '../packages/shared/types';

const server: Server = { id: 'test', name: 'Synthetic', host: 'example.com', port: 22, root: '/srv/test', useSshConfig: false };
const spec: ComposeDeploy = { app: 'example', source: '.', files: ['compose.yaml', 'overrides.yaml'], envFiles: [], profiles: ['extra'], healthTimeout: 30 };
const python = [process.env.DOCKLOOM_TEST_PYTHON, 'python3', 'python'].filter(Boolean).find(candidate => spawnSync(candidate!, ['--version'], { windowsHide: true }).status === 0);
function remoteCheck(body: string) {
  const result = spawnSync(python!, ['-c', 'import sys,json; p=json.load(sys.stdin); exec(p["source"]); exec(p["body"])'], {
    input: JSON.stringify({ source: REMOTE_PYTHON, body }), encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('Compose requests validate ordered source paths, profiles and health deadlines', () => {
  validateComposeDeploy(spec);
  for (const filename of ['../secret', '/etc/passwd', 'C:/secrets', '${PATH}', 'a\\b', '', '~/.env']) {
    assert.throws(() => validateComposeDeploy({ ...spec, files: [filename] }));
    assert.throws(() => validateComposeDeploy({ ...spec, envFiles: [filename] }));
  }
  for (const healthTimeout of [0, 601, NaN, 1.5]) assert.throws(() => validateComposeDeploy({ ...spec, healthTimeout }));
  assert.throws(() => validateComposeDeploy({ ...spec, profiles: ['--help'] }));
});

test('Compose collection excludes repositories/dependencies/implicit .env, preserves order and sends no local path', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'dockloom-compose-'));
  try {
    await writeFile(path.join(temp, 'compose.yaml'), 'services:\n  web:\n    image: nginx:alpine\n');
    await writeFile(path.join(temp, 'overrides.yaml'), 'services:\n  web:\n    environment:\n      TEST: "${TEST}"\n');
    await writeFile(path.join(temp, '.env'), 'TEST=private-synthetic-value');
    await writeFile(path.join(temp, '.env.local'), 'excluded');
    for (const folder of ['.git', 'node_modules']) {
      await mkdir(path.join(temp, folder));
      await writeFile(path.join(temp, folder, 'excluded'), 'excluded');
    }
    const calls: { operation: string; args: Record<string, unknown> }[] = [];
    const transport: RemoteTransport = { async request<T>(_server: Server, operation: string, args?: Record<string, unknown>) {
      calls.push({ operation, args: args! });
      return {} as T;
    } };
    const core = new DeploymentCore({ transport });
    await core.planCompose(server, { ...spec, source: temp });
    const first = calls[0].args;
    assert.equal((first.spec as ComposeDeploy).source, undefined);
    assert.deepEqual((first.files as { path: string }[]).map(f => f.path).sort(), ['compose.yaml', 'overrides.yaml']);
    await core.deployCompose(server, { ...spec, source: temp, envFiles: ['.env'] });
    const second = calls[1].args;
    assert.equal(calls[1].operation, 'deployCompose');
    assert.deepEqual((second.spec as ComposeDeploy).files, spec.files);
    assert.equal((second.documents as { services: object }[]).length, 2);
    assert((second.files as { path: string }[]).some(f => f.path === '.env'));
    await writeFile(path.join(temp, 'compose.yaml'), 'services: [invalid-private-synthetic-value');
    await assert.rejects(core.planCompose(server, { ...spec, source: temp }), error => error instanceof Error && !error.message.includes('private-synthetic'));
    assert.equal(calls.length, 2);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('Compose rejects source escapes before Docker normalization, but accepts local builds and readonly binds', { skip: !python }, () => remoteCheck(String.raw`
import copy
with tempfile.TemporaryDirectory() as temp:
    source = pathlib.Path(temp)
    (source / 'Dockerfile').write_text('FROM nginx:alpine')
    (source / 'public').mkdir()
    (source / 'public' / 'index.html').write_text('public')
    (source / 'settings.env').write_text('TOKEN=synthetic')
    valid = {'services': {'web': {'build': '.', 'env_file': ['settings.env'], 'volumes': ['./public:/usr/share/nginx/html:ro', 'data:/state']}}, 'volumes': {'data': {}}}
    raw_compose_paths(valid, source)
    bad = [
        {'include': '../outside.yaml'},
        {'include': 'inside.yaml'},
        {'services': {'web': {'extends': {'file': '../outside.yaml', 'service': 'web'}}}},
        {'services': {'web': {'build': '../outside'}}},
        {'services': {'web': {'build': 'https://example.com/repository.git'}}},
        {'services': {'web': {'build': {'context': '.', 'dockerfile': '../Dockerfile'}}}},
        {'services': {'web': {'build': {'context': '.', 'additional_contexts': {'other': '/etc'}}}}},
        {'services': {'web': {'env_file': '/etc/environment'}}},
        {'services': {'web': {'env_file': '$' + '{ENV_PATH}'}}},
        {'services': {'web': {'volumes': ['./public:/data']}}},
        {'services': {'web': {'volumes': ['/etc:/data:ro']}}},
        {'services': {'web': {'volumes': ['/data']}}},
        {'configs': {'key': {'file': '../secret'}}},
        {'secrets': {'key': {'environment': 'TOKEN'}}},
        {'volumes': {'data': {'name': 'existing-data'}}},
        {'volumes': {'data': {'driver_opts': {'device': '/etc', 'type': 'none', 'o': 'bind'}}}},
    ]
    for document in bad:
        try:
            raw_compose_paths(document, source)
            raise AssertionError('Accepted unsafe document')
        except ValueError:
            pass
`));

test('normalized profiles, generated resource names, scope restrictions and literal environment stay deterministic', { skip: !python }, () => remoteCheck(String.raw`
import copy
with tempfile.TemporaryDirectory() as temp:
    source = pathlib.Path(temp)
    app = source / 'app'
    base = {'name': 'generated', 'services': {'web': {'image': 'nginx:alpine', 'environment': {'UNSET': None, 'TOKEN': 'a$b$$c'}}, 'extra': {'image': 'nginx:alpine', 'profiles': ['extra']}}, 'volumes': {'data': {'name': 'generated_data'}}, 'networks': {'default': {'name': 'generated_default'}}}
    config = copy.deepcopy(base)
    scope_compose(app, source, config, [])
    assert list(config['services']) == ['web']
    assert config['services']['web']['environment'] == {'TOKEN': 'a$b$$c'}
    assert config['volumes']['data']['name'] == project_name(app) + '_data'
    assert compose_values(compose_literals(config)) == config
    for field, value in [('container_name', 'existing'), ('privileged', True), ('network_mode', 'host'), ('pid', 'host'), ('cap_add', ['SYS_ADMIN']), ('devices', ['/dev/sda']), ('deploy', {'replicas': 2}), ('security_opt', ['apparmor:unconfined'])]:
        config = copy.deepcopy(base)
        config['services']['web'][field] = value
        try:
            scope_compose(app, source, config, [])
            raise AssertionError('Accepted ' + field)
        except ValueError:
            pass
    config = copy.deepcopy(base)
    config['services']['web']['depends_on'] = {'extra': {'condition': 'service_started'}}
    try:
        scope_compose(app, source, config, [])
        raise AssertionError('Accepted a disabled dependency')
    except ValueError:
        pass
    config = copy.deepcopy(base)
    scope_compose(app, source, config, ['extra'])
    assert set(config['services']) == {'web', 'extra'}
`));

test('normalization uses ordered JSON files/env flags, private temp source, no ambient secrets and generic errors', { skip: !python }, () => remoteCheck(String.raw`
with tempfile.TemporaryDirectory() as temp:
    directory = pathlib.Path(temp)
    source = directory / 'source'
    app = directory / 'not-created-app'
    content = b'PRIVATE=synthetic-private-value'
    spec = {'app': 'example', 'files': ['base.yaml', 'override.yaml'], 'envFiles': ['.env'], 'profiles': ['extra'], 'healthTimeout': 30}
    files = [{'path': filename, 'data': base64.b64encode(content).decode(), 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()} for filename in ['base.yaml', 'override.yaml', '.env']]
    request = {'spec': spec, 'files': files, 'documents': [{'services': {'web': {'image': 'nginx:alpine'}}}, {'services': {'web': {'environment': {'PRIVATE': '$' + '{PRIVATE}'}}}}]}
    calls = []
    os.environ['PRIVATE'] = 'ambient-secret'
    def run(argv, **kwargs):
        calls.append((argv, kwargs))
        return (0, json.dumps({'services': {'web': {'image': 'nginx:alpine', 'environment': {'PRIVATE': 'synthetic$$value'}}}, 'networks': {'default': {'name': 'generated_default'}}}), '')
    config, warnings, total = normalize_compose(app, directory, request)
    argv, options = calls[0]
    assert argv.index(str(directory / 'input-0.json')) < argv.index(str(directory / 'input-1.json'))
    assert argv[argv.index('--env-file') + 1] == str(source / '.env')
    assert argv[-3:] == ['config', '--format', 'json']
    assert 'PRIVATE' not in options['env'] and 'HOME' not in options['env']
    assert options['cwd'] == str(directory)
    assert config['services']['web']['environment']['PRIVATE'] == 'synthetic$value'
    assert not app.exists()
    def run(argv, **kwargs):
        return (1, 'synthetic-private-value', 'synthetic-private-value')
    try:
        compose_command(['docker', 'compose', 'config'])
        raise AssertionError('Accepted failed command')
    except RuntimeError as error:
        assert 'synthetic-private-value' not in str(error)
`));

test('Compose builds each revision with a unique tag, freezes image IDs and environment, hashes private files', { skip: !python }, () => remoteCheck(String.raw`
with tempfile.TemporaryDirectory() as temp:
    app = pathlib.Path(temp) / 'example'
    (app / 'releases').mkdir(parents=True)
    def write_json(path, data):
        pathlib.Path(path).write_text(json.dumps(data))
    check_compose_resources = lambda *args: None
    def normalize_compose(app, directory, request):
        source = directory / 'source'
        source.mkdir()
        (source / 'Dockerfile').write_text('FROM nginx:alpine')
        return ({'services': {'web': {'build': {'context': str(source)}, 'image': 'user-owned:latest', 'labels': {}, 'environment': {'TOKEN': 'frozen$value'}}}}, [], 1)
    image = 'sha256:' + 'a' * 64
    commands = []
    build_configs = []
    def compose_command(argv, **kwargs):
        commands.append(argv)
        if 'build' in argv:
            build_configs.append(read_json(pathlib.Path(argv[argv.index('-f') + 1])))
        return (0, '', '')
    run = lambda *args, **kwargs: (0, json.dumps([{'Id': image}]), '')
    tags = []
    for release in ['a' * 32, 'b' * 32]:
        record = prepare_compose_release(app, release, {'spec': {'healthTimeout': 30}})
        frozen = read_json(app / 'releases' / release / 'compose.json')
        service = frozen['services']['web']
        assert service['image'] == image and service['pull_policy'] == 'never' and 'build' not in service
        assert service['environment']['TOKEN'] == 'frozen$$value'
        assert record['images']['web'] == image and record['kind'] == 'compose'
        assert verify_release(app / 'releases' / release)['id'] == release
        tags.append(build_configs[-1]['services']['web']['image'])
    assert tags[0] != tags[1] and all(tag != 'user-owned:latest' for tag in tags)
    assert len(commands) == 2
`));

test('service verification checks ownership/images/health and only accepts explicitly completed dependencies', { skip: !python }, () => remoteCheck(String.raw`
import copy
with tempfile.TemporaryDirectory() as temp:
    app = pathlib.Path(temp) / 'example'
    release = 'a' * 32
    directory = app / 'releases' / release
    directory.mkdir(parents=True)
    image = 'sha256:' + 'b' * 64
    config = {'services': {'init': {}, 'web': {'depends_on': {'init': {'condition': 'service_completed_successfully'}}, 'healthcheck': {'test': ['CMD', 'true']}}}}
    (directory / 'compose.json').write_text(json.dumps(config))
    record = {'kind': 'compose', 'healthTimeout': 5, 'images': {'init': image, 'web': image}}
    def container(key, state):
        return {'Image': image, 'Config': {'Labels': {'com.docker.compose.project': project_name(app), 'com.docker.compose.service': key, 'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app), 'dev.dockloom.release': release}}, 'State': state}
    base = [container('init', {'Status': 'exited', 'ExitCode': 0}), container('web', {'Status': 'running', 'Running': True, 'Health': {'Status': 'healthy'}})]
    rows = copy.deepcopy(base)
    compose = lambda *args: (0, 'one two', '')
    compose_command = lambda *args, **kwargs: (0, json.dumps(rows), '')
    time.sleep = lambda *args: None
    verify_running(app, release, record)
    for mutate in [lambda r: r[0]['State'].update({'ExitCode': 1}), lambda r: r[1].update({'Image': 'wrong'}), lambda r: r[1]['Config']['Labels'].update({'dev.dockloom.release': 'wrong'}), lambda r: r[1]['State']['Health'].update({'Status': 'unhealthy'}), lambda r: r[1].update({'RestartCount': 1}), lambda r: r[1]['State'].update({'Status': 'exited', 'ExitCode': 0})]:
        rows = copy.deepcopy(base)
        mutate(rows)
        try:
            verify_running(app, release, record)
            raise AssertionError('Accepted invalid service state')
        except ValueError:
            pass
    rows = copy.deepcopy(base)
    config['services']['web']['depends_on']['init']['condition'] = 'service_started'
    (directory / 'compose.json').write_text(json.dumps(config))
    try:
        verify_running(app, release, record)
        raise AssertionError('Accepted an exited service without completion dependency')
    except ValueError:
        pass
`));

test('Compose switch failure restores all previous services without pruning or deleting named volumes', { skip: !python }, () => remoteCheck(String.raw`
import types
sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *args: None)
if not hasattr(os, 'O_NOFOLLOW'):
    os.O_NOFOLLOW = 0
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    app, job = root / 'example', root / 'job'
    app.mkdir()
    job.mkdir()
    old, new = 'a' * 32, 'b' * 32
    for release in [old, new]:
        (app / 'releases' / release).mkdir(parents=True)
        (app / 'releases' / release / 'compose.json').write_text(json.dumps({'volumes': {'state': {'name': 'persistent_state'}}}))
    def write_json(path, data):
        pathlib.Path(path).write_text(json.dumps(data))
    write_json(app / 'current.json', {'release': old})
    write_json(job / 'status.json', {'id': new, 'app': 'example', 'status': 'queued', 'createdAt': now()})
    records = {release: {'id': release, 'kind': 'compose', 'services': ['state', 'web'], 'images': {}, 'status': 'succeeded' if release == old else 'prepared'} for release in [old, new]}
    write_json(app / 'releases' / new / 'release.json', records[new])
    root_path = lambda *args: root
    app_dir = lambda *args: app
    check_project = lambda *args: None
    checked = []
    check_compose_resources = lambda app, config: checked.append(config)
    verify_release = lambda directory: dict(records[directory.name])
    prepare_compose_release = lambda *args: dict(records[new])
    commands = []
    def compose(app, release, args):
        commands.append((release, args))
        return (0, '', '')
    def verify_running(app, release, record):
        if release == new:
            raise ValueError('Synthetic health failure')
    worker({'root': str(root), 'operation': 'deployCompose', 'spec': {}, 'files': []}, job)
    assert read_json(job / 'status.json')['status'] == 'failed'
    assert read_json(app / 'current.json')['release'] == old
    assert read_json(app / 'transaction.json')['state'] == 'restored'
    restored = [args for release, args in commands if release == old]
    assert restored and restored[0][-2:] == ['state', 'web']
    assert len(checked) == 3
    assert all('down' not in args and '-v' not in args and '--remove-orphans' not in args for release, args in commands)
    try:
        compatible_release(app, {'kind': 'compose', 'services': ['web']})
        raise AssertionError('Accepted service removal')
    except ValueError:
        pass
    try:
        compatible_release(app, {'services': ['state', 'web']})
        raise AssertionError('Accepted changing release kind')
    except ValueError:
        pass
`));

test('restoration refuses foreign resources before starting any service', { skip: !python }, () => remoteCheck(String.raw`
with tempfile.TemporaryDirectory() as temp:
    app = pathlib.Path(temp) / 'example'
    release = 'a' * 32
    directory = app / 'releases' / release
    directory.mkdir(parents=True)
    config = {'volumes': {'data': {'name': 'synthetic_data'}}}
    (directory / 'compose.json').write_text(json.dumps(config))
    record = {'kind': 'compose', 'services': ['web']}
    run = lambda *args, **kwargs: (0, json.dumps([{'Labels': {'dev.dockloom.owner': 'somebody-else'}}]), '')
    calls = []
    compose = lambda *args: calls.append(args)
    try:
        switch_release(app, release, record)
        raise AssertionError('Accepted foreign resource on restoration')
    except ValueError:
        pass
    assert not calls
    run = lambda *args, **kwargs: (0, json.dumps([{'Labels': {'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app)}}]), '')
    switch_release(app, release, record)
    assert len(calls) == 1
`));
