import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { REMOTE_PYTHON } from '../packages/core/index';

// CI normally has python3. Windows developers may select an installed interpreter.
const python = [process.env.DOCKLOOM_TEST_PYTHON, 'python3', 'python'].filter(Boolean).find(candidate => spawnSync(candidate!, ['--version'], { windowsHide: true }).status === 0);
function remoteCheck(body: string): void {
  const result = spawnSync(python!, ['-c', 'import sys,json; p=json.load(sys.stdin); exec(p["source"]); exec(p["body"])'], {
    input: JSON.stringify({ source: REMOTE_PYTHON, body }), encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

test('embedded Python is syntactically compatible with Python 3.6', { skip: !python }, () => remoteCheck(String.raw`
import ast
try:
    ast.parse(p['source'], feature_version=(3, 6))
except TypeError:
    ast.parse(p['source'])
assert 'missing_ok' not in p['source']
assert 'capture_output' not in p['source']
`));

test('discovery extracts Compose labels, ordered files and ports, ignores environment', { skip: !python }, () => remoteCheck(String.raw`
item = {'Id': 'a' * 64, 'Name': '/synthetic-web-1', 'Config': {'Image': 'example/image:v1', 'Env': ['TOKEN=do-not-return'], 'Labels': {
    'com.docker.compose.project': 'synthetic', 'com.docker.compose.service': 'web',
    'com.docker.compose.project.working_dir': '/srv/synthetic', 'com.docker.compose.project.config_files': '/srv/base.yml,/srv/prod.yml'}},
    'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
    'NetworkSettings': {'Ports': {'80/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '8080'}], '443/tcp': None}}}
result = parse_container(item)
assert result['configFiles'] == ['/srv/base.yml', '/srv/prod.yml']
assert result['project'] == 'synthetic' and result['service'] == 'web'
assert result['ports'] == '127.0.0.1:8080->80/tcp, 443/tcp'
assert result['health'] == 'healthy' and result['name'] == 'synthetic-web-1'
assert 'do-not-return' not in json.dumps(result)
standalone = parse_container({'Id': 'b' * 64, 'Config': {'Labels': None}, 'State': {'Status': 'exited'}, 'NetworkSettings': None})
assert standalone['project'] == '' and standalone['configFiles'] == []
`));

test('remote rejects path traversal and unowned namespace without overwriting', { skip: !python }, () => remoteCheck(String.raw`
for value in ['/', '/etc/a', '/tmp/../etc', '/srv//apps', '/srv/apps/', 'relative', '/srv/\napps']:
    try:
        root_path(value)
        raise AssertionError('Accepted bad root ' + value)
    except ValueError:
        pass
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    unknown = root / '.dockloom'
    unknown.mkdir()
    sentinel = unknown / 'keep.txt'
    sentinel.write_text('untouched')
    try:
        namespace(root, True)
        raise AssertionError('Accepted unowned namespace')
    except ValueError:
        pass
    assert sentinel.read_text() == 'untouched'
    assert not (unknown / 'owner.json').exists()
`));

test('remote logs redact credentials; drift blocks rollback', { skip: !python }, () => remoteCheck(String.raw`
assert 'hidden' not in scrub('password=hidden\nAuthorization: Bearer hidden\nhttps://user:hidden@example.com')
with tempfile.TemporaryDirectory() as temp:
    directory = pathlib.Path(temp) / ('a' * 32)
    directory.mkdir()
    file = directory / 'compose.json'
    file.write_text('original')
    record = {'owner': OWNER, 'id': directory.name, 'checksums': {'compose.json': hashlib.sha256(b'original').hexdigest()}}
    (directory / 'release.json').write_text(json.dumps(record))
    assert verify_release(directory)['id'] == directory.name
    added = directory / 'untracked.html'
    added.write_text('unexpected public file')
    try:
        verify_release(directory)
        raise AssertionError('Accepted added file drift')
    except ValueError:
        pass
    added.unlink()
    file.write_text('external edit')
    try:
        verify_release(directory)
        raise AssertionError('Accepted drift')
    except ValueError:
        pass
`));

test('Compose project identity isolates roots and preserves literal dollar paths', { skip: !python }, () => remoteCheck(String.raw`
first = pathlib.Path('/srv/one/.dockloom/apps/example')
second = pathlib.Path('/srv/two/.dockloom/apps/example')
assert project_name(first) != project_name(second)
assert project_name(first) == project_name(first)
value = {'services': {'web': {'volumes': [{'source': '/srv/$HOME/$' + '{USER}/site', 'read_only': True}], 'labels': {'dev.dockloom.path': '/srv/$HOME'}}}}
escaped = compose_literals(value)
assert escaped['services']['web']['volumes'][0]['source'] == '/srv/$$HOME/$$' + '{USER}/site'
assert escaped['services']['web']['volumes'][0]['read_only'] is True
assert escaped['services']['web']['labels']['dev.dockloom.path'] == '/srv/$$HOME'
`));

test('interrupted process is reported without replay or editing the transaction', { skip: !python }, () => remoteCheck(String.raw`
with tempfile.TemporaryDirectory() as temp:
    directory = pathlib.Path(temp)
    state = {'id': 'a' * 32, 'app': 'example', 'status': 'running', 'stage': 'switch', 'createdAt': now()}
    (directory / 'status.json').write_text(json.dumps(state))
    (directory / 'runtime.json').write_text(json.dumps({'pid': 123, 'start': 'old', 'boot': 'previous-boot'}))
    boot_id = lambda: 'current-boot'
    result = job_view(directory)
    assert result['status'] == 'interrupted'
    assert read_json(directory / 'status.json') == state
`));

test('failed HTTP switch restores previous Compose and current marker under lock', { skip: !python }, () => remoteCheck(String.raw`
import types
lock_calls = []
sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=lambda *args: lock_calls.append(args))
if not hasattr(os, 'O_NOFOLLOW'):
    os.O_NOFOLLOW = 0
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    app = root / 'example'
    app.mkdir()
    directory = root / 'job'
    directory.mkdir()
    old, new = 'a' * 32, 'b' * 32
    (app / 'releases' / new).mkdir(parents=True)
    state = {'id': new, 'app': 'example', 'status': 'queued', 'stage': 'queued', 'createdAt': now()}
    # Windows test hosts cannot fsync directory handles; actual Linux uses write_json above.
    def write_json(path, data):
        pathlib.Path(path).write_text(json.dumps(data))
    write_json(directory / 'status.json', state)
    write_json(app / 'current.json', {'release': old})
    record = {'owner': OWNER, 'id': new, 'status': 'prepared', 'image': 'sha256:' + 'c' * 64, 'port': 8080}
    write_json(app / 'releases' / new / 'release.json', record)
    root_path = lambda value: root
    app_dir = lambda *args: app
    check_project = lambda *args: None
    verify_release = lambda *args: dict(record)
    prepare_release = lambda *args: dict(record)
    preflight_port = lambda *args: None
    commands = []
    def compose(app, release, args):
        commands.append((release, args))
        return (0, '', '')
    def wait_http(app, release, record):
        if release == new:
            raise RuntimeError('Synthetic HTTP failure')
    worker({'root': str(root), 'operation': 'deploy', 'spec': {}, 'files': []}, directory)
    assert lock_calls
    assert read_json(directory / 'status.json')['status'] == 'failed'
    assert read_json(app / 'current.json')['release'] == old
    assert read_json(app / 'transaction.json')['state'] == 'restored'
    assert (old, ['up', '-d', '--no-build', '--pull', 'never', 'web']) in commands
    assert read_json(app / 'releases' / new / 'release.json')['status'] == 'failed'
`));

test('contended project lock fails the job before any Docker call', { skip: !python }, () => remoteCheck(String.raw`
import types
def locked(*args):
    raise BlockingIOError('held by another worker')
sys.modules['fcntl'] = types.SimpleNamespace(LOCK_EX=1, LOCK_NB=2, flock=locked)
if not hasattr(os, 'O_NOFOLLOW'):
    os.O_NOFOLLOW = 0
with tempfile.TemporaryDirectory() as temp:
    root = pathlib.Path(temp)
    app, directory = root / 'example', root / 'job'
    app.mkdir()
    directory.mkdir()
    def write_json(path, data):
        pathlib.Path(path).write_text(json.dumps(data))
    write_json(directory / 'status.json', {'id': 'a' * 32, 'app': 'example', 'status': 'queued', 'stage': 'queued', 'createdAt': now()})
    root_path = lambda value: root
    app_dir = lambda *args: app
    docker_calls = []
    run = lambda *args, **kwargs: docker_calls.append(args)
    worker({'root': str(root), 'operation': 'deploy', 'spec': {}, 'files': []}, directory)
    assert docker_calls == []
    status = read_json(directory / 'status.json')
    assert status['status'] == 'failed' and 'project lock' in status['stage']
    assert not (app / 'transaction.json').exists()
`));
