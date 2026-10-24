/** Embedded source: esbuild/Electron bundles this string; no runtime asset copying. */
export const REMOTE_PYTHON = String.raw`
import base64, datetime, hashlib, json, os, pathlib, platform, re, shutil, socket, stat, subprocess, sys, tempfile, time, urllib.request, uuid

OWNER = 'dockloom/v1'
MAX_BYTES = 32 * 1024 * 1024

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def remove_file(path):
    no_links(path)
    try:
        path.unlink()
    except FileNotFoundError:
        pass

def scrub(text):
    text = re.sub(r'-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)', '[REDACTED PRIVATE KEY]', str(text))
    text = re.sub(r'(?im)(\b(?:authorization|proxy-authorization)\s*[:=]\s*)[^\r\n]+', r'\1[REDACTED]', text)
    text = re.sub(r'''(?i)(\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)''', r'\1[REDACTED]', text)
    text = re.sub(r'(https?://)[^\s/@:]+:[^\s/@]+@', r'\1[REDACTED]@', text)
    return re.sub(r'(?i)([?&](?:token|key|secret|password|signature)=)[^&#\s]+', r'\1[REDACTED]', text)

def name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,47}', value):
        raise ValueError('Invalid application name')
    return value

def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
        raise ValueError('Invalid job or release ID')
    return value

def no_links(path):
    path = pathlib.Path(path)
    for item in [path] + list(path.parents):
        if item.is_symlink():
            raise ValueError('Symbolic links are forbidden in managed paths')
    return path

def root_path(value):
    if not isinstance(value, str) or len(value) > 1024 or re.search(r'[\x00-\x1f\x7f\\]', value) or not (value.startswith('/') or value.startswith('~/')):
        raise ValueError('Invalid deployment root')
    if any(part in ('', '.', '..') for part in value.split('/')[1:]):
        raise ValueError('Invalid deployment root segments')
    resolved = os.path.expanduser(value)
    if resolved in ('/', '/root', '/home', '/var', '/opt', '/tmp', '/srv') or re.match(r'^/(etc|bin|sbin|usr|proc|sys|dev|boot|run)(/|$)', resolved):
        raise ValueError('Unsafe deployment root')
    return no_links(resolved)

def read_json(path):
    path = no_links(path)
    with path.open('r', encoding='utf-8') as stream:
        return json.load(stream)

def write_json(path, data):
    path = no_links(path)
    temp = path.with_name('.' + path.name + '.' + uuid.uuid4().hex)
    try:
        with temp.open('x', encoding='utf-8') as stream:
            os.chmod(temp, 0o600)
            json.dump(data, stream, ensure_ascii=True)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        fd = os.open(str(path.parent), os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if temp.exists():
            temp.unlink()

def owned_dir(path, marker, create=False):
    path = no_links(path)
    if not path.exists() and create:
        try:
            path.mkdir(mode=0o700)
            write_json(path / 'owner.json', marker)
        except FileExistsError:
            pass
    if not path.exists():
        return None
    if not path.is_dir() or not (path / 'owner.json').is_file() or read_json(path / 'owner.json') != marker:
        raise ValueError('Refusing an unowned or incompatible managed directory: ' + str(path))
    return path

def namespace(root, create=False):
    if create:
        no_links(root).mkdir(parents=True, exist_ok=True)
    ns = owned_dir(root / '.dockloom', {'owner': OWNER, 'root': str(root)}, create)
    if ns:
        for child in ('apps', 'jobs'):
            directory = no_links(ns / child)
            if create:
                directory.mkdir(mode=0o700, exist_ok=True)
    return ns

def app_dir(root, app, create=False):
    ns = namespace(root, create)
    if not ns:
        return None
    return owned_dir(ns / 'apps' / name(app), {'owner': OWNER, 'root': str(root), 'app': app}, create)

def run(argv, check=True, timeout=90, tail=False):
    # Tempfile-backed capture prevents unbounded application logs from filling RAM.
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
        child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=output, stderr=errors, start_new_session=True)
        try:
            code = child.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise RuntimeError('Command timed out: ' + argv[0])
        def take(stream):
            length = stream.tell()
            if not tail and length > 8 * 1024 * 1024:
                raise RuntimeError('Command output exceeds limit')
            stream.seek(max(0, length - 65536) if tail else 0)
            return stream.read().decode('utf-8', errors='replace')
        stdout, stderr = take(output), take(errors)
    if check and code:
        raise RuntimeError(scrub(stderr or stdout or 'Command failed: ' + argv[0])[-8192:])
    return code, stdout, stderr

def docker_json(args):
    return json.loads(run(['docker'] + args)[1])

def raw_containers():
    ids = run(['docker', 'ps', '-aq', '--no-trunc'])[1].split()
    rows = []
    for offset in range(0, len(ids), 100):
        rows.extend(docker_json(['inspect'] + ids[offset:offset + 100]))
    return rows

def parse_container(item):
    config = item.get('Config') or {}
    labels = config.get('Labels') or {}
    state = item.get('State') or {}
    bindings = (item.get('NetworkSettings') or {}).get('Ports') or {}
    ports = []
    for target, hosts in bindings.items():
        if hosts:
            ports.extend((h.get('HostIp') or '0.0.0.0') + ':' + str(h.get('HostPort', '')) + '->' + target for h in hosts)
        else:
            ports.append(target)
    return {'id': item['Id'], 'name': item.get('Name', '').lstrip('/'), 'image': config.get('Image', ''),
        'state': state.get('Status', 'unknown'), 'status': state.get('Status', 'unknown'),
        'project': labels.get('com.docker.compose.project', ''), 'service': labels.get('com.docker.compose.service', ''),
        'ports': ', '.join(ports), 'health': (state.get('Health') or {}).get('Status', 'not-configured'),
        'workingDir': labels.get('com.docker.compose.project.working_dir', ''),
        'configFiles': [s for s in labels.get('com.docker.compose.project.config_files', '').split(',') if s]}

def inspect_server(root):
    caps = [{'name': 'python3', 'ok': True, 'detail': platform.python_version()}]
    versions = {}
    for label, argv in [('docker', ['docker', 'version', '--format', '{{.Server.Version}}']), ('compose', ['docker', 'compose', 'version', '--short'])]:
        try:
            code, out, err = run(argv, check=False, timeout=20)
            versions[label] = out.strip() if code == 0 else ''
            caps.append({'name': label, 'ok': code == 0, 'detail': scrub(out if code == 0 else err).strip()[-2048:]})
        except Exception as error:
            versions[label] = ''
            caps.append({'name': label, 'ok': False, 'detail': scrub(error)})
    ancestor = root
    while not ancestor.exists():
        ancestor = ancestor.parent
    disk = shutil.disk_usage(ancestor)
    caps.append({'name': 'deployment-root', 'ok': os.access(ancestor, os.W_OK | os.X_OK), 'detail': str(root)})
    try:
        import fcntl
        caps.append({'name': 'persistent-jobs', 'ok': pathlib.Path('/proc/sys/kernel/random/boot_id').exists(), 'detail': 'Python detached processes, flock, /proc identity; no system service required'})
    except ImportError:
        caps.append({'name': 'persistent-jobs', 'ok': False, 'detail': 'Linux fcntl and /proc required'})
    memory = {}
    for line in pathlib.Path('/proc/meminfo').read_text().splitlines():
        fields = line.split()
        if len(fields) >= 2:
            memory[fields[0].rstrip(':')] = int(fields[1]) * 1024
    os_name = platform.system()
    release = pathlib.Path('/etc/os-release')
    if release.exists():
        for line in release.read_text().splitlines():
            if line.startswith('PRETTY_NAME='):
                os_name = line.split('=', 1)[1].strip('"')
    containers = []
    if versions['docker']:
        try:
            containers = [parse_container(c) for c in raw_containers()]
        except Exception as error:
            caps.append({'name': 'discovery', 'ok': False, 'detail': scrub(error)})
    return {'hostname': socket.gethostname(), 'os': os_name, 'arch': platform.machine(),
        'dockerVersion': versions['docker'], 'composeVersion': versions['compose'], 'cpus': os.cpu_count() or 0,
        'load': os.getloadavg()[0], 'memoryTotal': memory.get('MemTotal', 0), 'memoryAvailable': memory.get('MemAvailable', 0),
        'diskTotal': disk.total, 'diskAvailable': disk.free, 'root': str(root), 'containers': containers,
        'capabilities': caps, 'fetchedAt': now()}

def boot_id():
    return pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()

def process_identity(pid):
    try:
        fields = pathlib.Path('/proc/' + str(pid) + '/stat').read_text().rsplit(')', 1)[1].split()
        if fields[0] == 'Z':
            return None
        return fields[19]
    except (FileNotFoundError, ProcessLookupError):
        return None

def job_view(directory):
    state = read_json(directory / 'status.json')
    if state['status'] in ('queued', 'running'):
        runtime = directory / 'runtime.json'
        if runtime.exists():
            process = read_json(runtime)
            alive = process['boot'] == boot_id() and process_identity(process['pid']) == process['start'] and process['start'] is not None
        else:
            alive = (time.time() - (directory / 'status.json').stat().st_mtime) < 15
        if not alive:
            # Report only; never replay a transaction after process death or host reboot.
            state['status'] = 'interrupted'
            state['stage'] = 'interrupted: inspect containers and transaction.json before recovery'
    log_file = no_links(directory / 'log.txt')
    log = ''
    if log_file.exists():
        with log_file.open('rb') as stream:
            stream.seek(max(0, log_file.stat().st_size - 262144))
            log = stream.read().decode('utf-8', errors='replace')
    return dict({key: state[key] for key in ('id', 'app', 'status', 'stage', 'createdAt')}, log=scrub(log)[-65536:])

def release_record(directory):
    record = read_json(directory / 'release.json')
    if record.get('owner') != OWNER or record.get('id') != directory.name:
        raise ValueError('Invalid release ownership marker')
    return record

def current_release(app):
    marker = no_links(app / 'current.json')
    if not marker.exists():
        return None
    return identifier(read_json(marker)['release'])

def project_name(app):
    return 'dockloom-' + app.name + '-' + hashlib.sha256(str(app).encode()).hexdigest()[:12]

def check_project(app):
    project = project_name(app)
    for container in raw_containers():
        labels = (container.get('Config') or {}).get('Labels') or {}
        if labels.get('com.docker.compose.project') == project and (labels.get('dev.dockloom.owner') != OWNER or labels.get('dev.dockloom.path') != str(app)):
            raise ValueError('Compose project name is already used by an unmanaged project')
    code, output, error = run(['docker', 'network', 'inspect', project + '_default'], check=False)
    if code == 0:
        for network in json.loads(output):
            labels = network.get('Labels') or {}
            if labels.get('dev.dockloom.owner') != OWNER or labels.get('dev.dockloom.path') != str(app):
                raise ValueError('Compose network name is already used by an unmanaged network')

def check_transaction(app):
    marker = no_links(app / 'transaction.json')
    if marker.exists() and read_json(marker).get('state') not in ('committed', 'restored', 'aborted'):
        raise ValueError('Previous transaction requires manual recovery; inspect transaction.json and containers')

def verify_release(directory):
    record = release_record(directory)
    actual = set()
    for entry in directory.rglob('*'):
        no_links(entry)
        if entry.is_file() and entry != directory / 'release.json':
            actual.add(entry.relative_to(directory).as_posix())
    if actual != set(record['checksums']):
        raise ValueError('Release file list drift detected')
    for filename, expected in record['checksums'].items():
        if pathlib.PurePosixPath(filename).is_absolute() or '..' in pathlib.PurePosixPath(filename).parts:
            raise ValueError('Invalid release file path')
        file = no_links(directory / filename)
        if hashlib.sha256(file.read_bytes()).hexdigest() != expected:
            raise ValueError('Release configuration or content drift detected')
    return record

def compose(app, release, args):
    return run(['docker', 'compose', '--project-name', project_name(app), '--project-directory', str(app), '-f', str(app / 'releases' / release / 'compose.json')] + args, timeout=180)

def compose_literals(value):
    # Compose interpolates strings even in JSON/YAML quoted values.
    if isinstance(value, str):
        return value.replace('$', '$$')
    if isinstance(value, list):
        return [compose_literals(item) for item in value]
    if isinstance(value, dict):
        return {key: compose_literals(item) for key, item in value.items()}
    return value

def wait_http(app, release, record):
    # Ignore proxy environment for the server-local health check.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    url = 'http://127.0.0.1:' + str(record['port']) + '/__dockloom_health'
    last = 'No response'
    for attempt in range(30):
        try:
            with opener.open(url, timeout=2) as response:
                if response.status == 200 and response.read(128).decode() == release:
                    ids = compose(app, release, ['ps', '-q', 'web'])[1].split()
                    if len(ids) == 1:
                        container = docker_json(['inspect', ids[0]])[0]
                        if container.get('Image') == record['image'] and container.get('State', {}).get('Running'):
                            return
                    last = 'Unexpected container image or state'
                else:
                    last = 'Unexpected HTTP status or release identity'
        except Exception as error:
            last = str(error)
        time.sleep(1)
    raise RuntimeError('HTTP verification failed: ' + last)

def write_file(path, content, mode=0o644):
    path = no_links(path)
    with path.open('xb') as stream:
        os.chmod(path, mode)
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())

def prepare_release(app, release, spec, files):
    directory = no_links(app / 'releases' / release)
    directory.mkdir(mode=0o755)
    site = directory / 'site'
    site.mkdir(mode=0o755)
    checksums, total = {}, 0
    if not isinstance(files, list) or not 1 <= len(files) <= 5000:
        raise ValueError('Invalid static file count')
    for entry in files:
        filename = entry['path']
        if not isinstance(filename, str) or filename.startswith('/') or re.search(r'[\x00-\x1f\x7f\\]', filename) or any(p in ('', '.', '..') for p in filename.split('/')):
            raise ValueError('Unsafe static file path')
        content = base64.b64decode(entry['data'], validate=True)
        total += len(content)
        if total > MAX_BYTES or len(content) != entry['size'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError('Static file size or checksum mismatch')
        target = no_links(site / filename)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        write_file(target, content)
        checksums['site/' + filename] = entry['sha256']
    if 'site/index.html' not in checksums:
        raise ValueError('Static source needs index.html')
    code, output, error = run(['docker', 'image', 'inspect', spec['image']], check=False)
    if code:
        run(['docker', 'pull', spec['image']], timeout=600, tail=True)
        output = run(['docker', 'image', 'inspect', spec['image']])[1]
    image = json.loads(output)[0]['Id']
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
        raise ValueError('Cannot pin image ID')
    fallback = '/index.html' if spec['spa'] else '=404'
    nginx = ('server {\n listen 80;\n server_name _;\n root /usr/share/nginx/html;\n index index.html;\n'
        + ' location = /__dockloom_health { default_type text/plain; return 200 "' + release + '"; }\n'
        + ' location / { try_files $uri $uri/ ' + fallback + '; }\n}\n')
    write_file(directory / 'nginx.conf', nginx.encode())
    config = {'services': {'web': {'image': image, 'pull_policy': 'never', 'restart': 'unless-stopped',
        'labels': {'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app), 'dev.dockloom.release': release},
        'ports': [{'target': 80, 'published': str(spec['port']), 'host_ip': spec['bindAddress'], 'protocol': 'tcp'}],
        'volumes': [
            {'type': 'bind', 'source': str(site), 'target': '/usr/share/nginx/html', 'read_only': True, 'bind': {'create_host_path': False}},
            {'type': 'bind', 'source': str(directory / 'nginx.conf'), 'target': '/etc/nginx/conf.d/default.conf', 'read_only': True, 'bind': {'create_host_path': False}}]}}}
    config['networks'] = {'default': {'labels': {'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app)}}}
    write_file(directory / 'compose.json', json.dumps(compose_literals(config)).encode())
    for filename in ('nginx.conf', 'compose.json'):
        checksums[filename] = hashlib.sha256((directory / filename).read_bytes()).hexdigest()
    record = {'owner': OWNER, 'id': release, 'app': app.name, 'createdAt': now(), 'port': spec['port'], 'image': image, 'status': 'prepared', 'checksums': checksums}
    write_json(directory / 'release.json', record)
    return record

def preflight_port(app, record):
    for container in raw_containers():
        if not container.get('State', {}).get('Running'):
            continue
        labels = (container.get('Config') or {}).get('Labels') or {}
        for bindings in ((container.get('NetworkSettings') or {}).get('Ports') or {}).values():
            for binding in bindings or []:
                if str(binding.get('HostPort')) == str(record['port']):
                    if labels.get('dev.dockloom.path') == str(app) and labels.get('dev.dockloom.owner') == OWNER:
                        return
                    raise ValueError('Host port is already allocated to another container')
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as test:
        try:
            test.bind(('0.0.0.0', record['port']))
        except OSError:
            raise ValueError('Host port is already in use')

def worker(request, directory):
    import fcntl
    state = read_json(directory / 'status.json')
    def stage(value):
        state['stage'] = value
        write_json(directory / 'status.json', state)
        print(now() + ' ' + value, flush=True)
    lock = None
    app = None
    previous = None
    target = None
    switched = False
    transaction_started = False
    try:
        root = root_path(request['root'])
        app = app_dir(root, state['app'], True)
        lock_path = no_links(app / 'lock')
        lock = os.fdopen(os.open(str(lock_path), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600), 'a+')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('Another deployment holds the project lock')
        state['status'] = 'running'
        stage('preflight')
        check_transaction(app)
        check_project(app)
        previous = current_release(app)
        if previous:
            verify_release(app / 'releases' / previous)
        no_links(app / 'releases').mkdir(exist_ok=True, mode=0o700)
        if request['operation'] == 'deploy':
            target = state['id']
            stage('prepare: verify uploaded files and pin image')
            record = prepare_release(app, target, request['spec'], request['files'])
        else:
            target = identifier(request['release'])
            record = verify_release(app / 'releases' / target)
            if record['status'] != 'succeeded':
                raise ValueError('Only a previously verified release can be restored')
            run(['docker', 'image', 'inspect', record['image']])
        remove_file(directory / 'request.json')
        stage('validate: Compose and Nginx configuration')
        compose(app, target, ['config', '--quiet'])
        # Validate the selected Nginx-compatible image before touching the running service.
        compose(app, target, ['run', '--rm', '--no-deps', '--entrypoint', 'nginx', 'web', '-t'])
        preflight_port(app, record)
        transaction = {'owner': OWNER, 'job': state['id'], 'previous': previous, 'target': target, 'state': 'switching'}
        write_json(app / 'transaction.json', transaction)
        transaction_started = True
        stage('switch')
        switched = True
        compose(app, target, ['up', '-d', '--no-build', '--pull', 'never', 'web'])
        stage('verify: server-local HTTP and immutable image')
        wait_http(app, target, record)
        record['status'] = 'succeeded'
        write_json(app / 'releases' / target / 'release.json', record)
        write_json(app / 'current.json', {'release': target})
        transaction['state'] = 'committed'
        write_json(app / 'transaction.json', transaction)
        state['status'] = 'succeeded'
        stage('complete')
    except Exception as error:
        message = scrub(error)[-8192:]
        print('ERROR: ' + message, flush=True)
        recovered = False
        if switched:
            try:
                stage('restore previous release')
                if previous:
                    old = verify_release(app / 'releases' / previous)
                    compose(app, previous, ['up', '-d', '--no-build', '--pull', 'never', 'web'])
                    wait_http(app, previous, old)
                    write_json(app / 'current.json', {'release': previous})
                else:
                    # Only this managed web service; never global down or volume deletion.
                    compose(app, target, ['rm', '--stop', '--force', 'web'])
                    remove_file(app / 'current.json')
                recovered = True
            except Exception as recovery_error:
                print('RECOVERY ERROR: ' + scrub(recovery_error)[-8192:], flush=True)
        if transaction_started:
            transaction['state'] = 'restored' if recovered else 'recovery-required'
            write_json(app / 'transaction.json', transaction)
        if target and request['operation'] == 'deploy' and (app / 'releases' / target / 'release.json').exists():
            record = read_json(app / 'releases' / target / 'release.json')
            record['status'] = 'failed'
            write_json(app / 'releases' / target / 'release.json', record)
        state['status'] = 'failed'
        stage(('failed; previous state restored: ' if recovered else 'failed: ') + message)
    finally:
        remove_file(directory / 'request.json')
        if lock:
            lock.close()

def validate_spec(spec):
    name(spec['app'])
    if type(spec['port']) is not int or not 1 <= spec['port'] <= 65535 or spec.get('bindAddress') not in ('0.0.0.0', '127.0.0.1') or type(spec.get('spa')) is not bool:
        raise ValueError('Invalid static deployment settings')
    if not isinstance(spec['image'], str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}', spec['image']):
        raise ValueError('Invalid image reference')

def submit(request, script):
    root = root_path(request['root'])
    app = name(request['spec']['app'] if request['operation'] == 'deploy' else request['app'])
    if request['operation'] == 'deploy':
        validate_spec(request['spec'])
    else:
        identifier(request['release'])
        existing = app_dir(root, app)
        if not existing:
            raise ValueError('Unknown managed application')
        verify_release(existing / 'releases' / request['release'])
    # Verify namespace/app ownership before creating job artifacts.
    managed = app_dir(root, app, True)
    ns = namespace(root)
    job_id = uuid.uuid4().hex
    directory = no_links(ns / 'jobs' / job_id)
    directory.mkdir(mode=0o700)
    status = {'id': job_id, 'app': app, 'status': 'queued', 'stage': 'queued', 'createdAt': now()}
    write_json(directory / 'status.json', status)
    write_json(directory / 'request.json', request)
    write_file(directory / 'worker.py', (script + '\nif __name__ == "__main__":\n    worker(read_json(pathlib.Path(sys.argv[1]) / "request.json"), pathlib.Path(sys.argv[1]))\n').encode(), 0o600)
    with (directory / 'log.txt').open('xb') as log:
        os.chmod(directory / 'log.txt', 0o600)
        process = subprocess.Popen([sys.executable, str(directory / 'worker.py'), str(directory)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True, cwd=str(directory))
    write_json(directory / 'runtime.json', {'pid': process.pid, 'start': process_identity(process.pid), 'boot': boot_id()})
    return dict(status, log='')

def import_compose(spec):
    directory = root_path(spec['directory'])
    name(spec['project'])
    files = spec['files']
    if not isinstance(files, list) or not 1 <= len(files) <= 16:
        raise ValueError('Specify ordered Compose files')
    args = ['docker', 'compose', '--project-name', spec['project'], '--project-directory', str(directory)]
    for filename in files:
        if not isinstance(filename, str) or filename.startswith('/') or re.search(r'[\x00-\x1f\x7f\\]', filename) or any(p in ('', '.', '..') for p in filename.split('/')):
            raise ValueError('Unsafe Compose file path')
        file = no_links(directory / filename)
        if not file.is_file():
            raise ValueError('Compose file is missing: ' + filename)
        args += ['-f', str(file)]
    run(args + ['config', '--quiet'])
    # No expanded config/env emitted, and no up/write/adoption of imported files.
    services = run(args + ['config', '--services'])[1].strip()
    return 'Compose configuration is valid (read-only). Project: ' + spec['project'] + '\nDirectory: ' + str(directory) + '\nServices:\n' + services

def dispatch(request, script):
    root = root_path(request['root'])
    operation = request['operation']
    if operation == 'inspect':
        return inspect_server(root)
    if operation in ('logs', 'action'):
        container = request['containerId']
        if not isinstance(container, str) or not re.fullmatch(r'[a-f0-9]{12,64}', container):
            raise ValueError('Invalid container ID')
        if operation == 'logs':
            code, out, err = run(['docker', 'logs', '--tail', '200', '--timestamps', container], check=False, tail=True)
            if code:
                raise ValueError(scrub(err)[-8192:])
            return scrub(out + err)[-65536:]
        action = request['action']
        if action not in ('start', 'stop', 'restart'):
            raise ValueError('Invalid container action')
        run(['docker', action, container])
        return None
    if operation == 'plan':
        app_dir(root, name(request['app']))
        return str(root / '.dockloom' / 'apps' / request['app'])
    if operation in ('deploy', 'rollback'):
        return submit(request, script)
    if operation == 'importCompose':
        return import_compose(request['spec'])
    ns = namespace(root)
    if operation == 'job':
        identifier(request['id'])
        if not ns:
            raise ValueError('Unknown job')
        return job_view(no_links(ns / 'jobs' / request['id']))
    if operation == 'jobs':
        if not ns:
            return []
        return sorted([job_view(no_links(d)) for d in (ns / 'jobs').iterdir() if re.fullmatch(r'[a-f0-9]{32}', d.name)], key=lambda j: j['createdAt'], reverse=True)
    if operation == 'releases':
        results = []
        if ns:
            for candidate in (ns / 'apps').iterdir():
                app = app_dir(root, name(candidate.name))
                current = current_release(app)
                releases = no_links(app / 'releases')
                if not releases.exists():
                    continue
                for directory in releases.iterdir():
                    identifier(directory.name)
                    if not no_links(directory / 'release.json').exists():
                        continue
                    record = release_record(directory)
                    results.append(dict({key: record[key] for key in ('id', 'app', 'createdAt', 'port', 'image', 'status')}, current=current == record['id']))
        return sorted(results, key=lambda r: r['createdAt'], reverse=True)
    raise ValueError('Unsupported remote operation')

def main(request, script):
    try:
        print(json.dumps({'ok': True, 'result': dispatch(request, script)}))
    except Exception as error:
        print(json.dumps({'ok': False, 'error': scrub(error)[-8192:]}))
`;
