/** Compose-only helpers appended to the existing Python worker; Python 3.6 syntax. */
export const COMPOSE_PYTHON = String.raw`

def source_relative(value, allow_dot=False):
    if isinstance(value, str) and value.startswith(('/', '~')):
        raise ValueError('Absolute/external paths are unsupported; copy read-only files into source or use a named volume')
    if not isinstance(value, str) or not value or re.search(r'[\x00-\x1f\x7f\\:$~]', value) or value.startswith('/'):
        raise ValueError('Source paths must be literal relative paths; absolute, interpolated and remote paths are unsupported')
    parts = value.split('/')
    if '..' in parts or '' in parts or (not allow_dot and all(part == '.' for part in parts)):
        raise ValueError('Source path escapes the selected directory or is empty')
    return pathlib.PurePosixPath(value).as_posix()


def validate_compose_spec(spec):
    name(spec['app'])
    for key, minimum in [('files', 1), ('envFiles', 0)]:
        values = spec.get(key)
        if not isinstance(values, list) or not minimum <= len(values) <= 16:
            raise ValueError('Specify up to 16 ordered Compose/environment files')
        for value in values:
            source_relative(value)
    profiles = spec.get('profiles')
    if not isinstance(profiles, list) or len(profiles) > 32 or any(not isinstance(p, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', p) for p in profiles):
        raise ValueError('Invalid Compose profiles')
    if type(spec.get('healthTimeout')) is not int or not 1 <= spec['healthTimeout'] <= 600:
        raise ValueError('Health timeout must be 1-600 seconds')


def compose_command(argv, timeout=180, cwd=None):
    # Shell environment must not override the explicitly selected interpolation files.
    # Keep only transport/registry configuration required to reach this Docker daemon.
    env = {key: os.environ[key] for key in ('PATH', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR') if key in os.environ}
    env.setdefault('DOCKER_CONFIG', os.path.expanduser('~/.docker'))
    env['COMPOSE_DISABLE_ENV_FILE'] = 'true'
    try:
        code, output, error = run(argv, check=False, timeout=timeout, env=env, cwd=cwd)
    except Exception:
        raise RuntimeError('Compose/Docker command could not complete; output withheld to protect configuration secrets') from None
    if code:
        raise RuntimeError('Compose/Docker command failed; check selected files, required variables, image availability and Docker capabilities (output withheld to protect secrets)')
    return code, output, ''


def uploaded_compose_source(directory, request):
    validate_compose_spec(request['spec'])
    directory.mkdir(mode=0o755)
    files = request['files']
    if not isinstance(files, list) or not 1 <= len(files) <= 5000:
        raise ValueError('Compose source must contain 1-5000 files')
    total = 0
    seen = set()
    for entry in files:
        filename = source_relative(entry['path'])
        parts = pathlib.PurePosixPath(filename).parts
        if any(part in ('.git', 'node_modules') for part in parts) or any(part == '.env' or part.startswith('.env.') for part in parts) and filename not in request['spec']['envFiles']:
            raise ValueError('Excluded source file; explicitly select hidden environment files in envFiles')
        if filename in seen:
            raise ValueError('Duplicate uploaded source path')
        seen.add(filename)
        content = base64.b64decode(entry['data'], validate=True)
        total += len(content)
        if total > MAX_BYTES or len(content) != entry['size'] or hashlib.sha256(content).hexdigest() != entry['sha256']:
            raise ValueError('Compose source exceeds 32 MiB or its checksum is invalid')
        target = no_links(directory / filename)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        # The complete source tree is private; readable assets still work for non-root containers.
        write_file(target, content, 0o644)
    for filename in request['spec']['files'] + request['spec']['envFiles']:
        if filename not in seen:
            raise ValueError('A selected Compose/environment file is missing')
    return total


def compose_values(value):
    # config --format json serializes literal dollars as $$ for round-tripping.
    # Decode once before editing the model; compose_literals encodes it once on disk.
    if isinstance(value, str):
        return value.replace('$$', '$')
    if isinstance(value, list):
        return [compose_values(item) for item in value]
    if isinstance(value, dict):
        return {key: compose_values(item) for key, item in value.items()}
    return value


def local_source_path(source, value, directory=False):
    relative = source_relative(value, allow_dot=directory)
    result = no_links(source / relative)
    if not (result.is_dir() if directory else result.is_file()):
        raise ValueError('A referenced source file/directory is missing or excluded; select hidden environment files explicitly')
    return result


def raw_compose_paths(document, source):
    # Run before the official parser, which can read env/include/extends files itself.
    if not isinstance(document, dict):
        raise ValueError('Compose documents must be mappings')
    if 'include' in document:
        raise ValueError('Compose include is unsupported; merge the files into the ordered files selection')
    for section in ('volumes', 'networks'):
        for definition in (document.get(section) or {}).values():
            definition = definition or {}
            if any(key in definition for key in ('name', 'external', 'driver_opts')) or definition.get('driver') not in (None, 'local' if section == 'volumes' else 'bridge'):
                raise ValueError('Use project-scoped volumes/networks without explicit names, external resources or driver options')
    for section in ('configs', 'secrets'):
        for definition in (document.get(section) or {}).values():
            if not isinstance(definition, dict) or set(definition) - {'file', 'content'} or section == 'secrets' and 'content' in definition:
                raise ValueError('Configs/secrets must use source-relative files (configs may also use inline content)')
            if 'file' in definition:
                local_source_path(source, definition['file'])
    for service in (document.get('services') or {}).values():
        if not isinstance(service, dict):
            raise ValueError('Compose services must be mappings')
        if 'extends' in service:
            raise ValueError('Compose extends is unsupported; flatten the service or use ordered override files')
        if 'label_file' in service or 'credential_spec' in service:
            raise ValueError('label_file/credential_spec are unsupported; use inline labels and source-relative configs/secrets')
        env_files = service.get('env_file') or []
        if isinstance(env_files, (str, dict)):
            env_files = [env_files]
        for entry in env_files:
            local_source_path(source, entry.get('path') if isinstance(entry, dict) else entry)
        build = service.get('build')
        if build is not None:
            build = {'context': build} if isinstance(build, str) else build
            if not isinstance(build, dict) or set(build) - {'context', 'dockerfile', 'dockerfile_inline', 'args', 'target', 'labels', 'no_cache', 'pull'}:
                raise ValueError('Build supports local context, Dockerfile/inline Dockerfile, args, target and labels only; SSH, extra contexts, host networking and build secrets are unsupported')
            context = local_source_path(source, build.get('context', '.'), directory=True)
            if 'dockerfile_inline' not in build:
                local_source_path(context, build.get('dockerfile', 'Dockerfile'))
        for mount in service.get('volumes') or []:
            if isinstance(mount, str):
                if '$' in mount or '\\' in mount:
                    raise ValueError('Mount paths must be literal Linux paths; interpolation is unsupported')
                parts = mount.split(':')
                if len(parts) not in (2, 3):
                    raise ValueError('Anonymous volumes are unsupported; declare a named volume for persistent data')
                origin = parts[0]
                is_bind = origin.startswith(('.', '/', '~'))
                readonly = len(parts) == 3 and 'ro' in parts[2].split(',')
            elif isinstance(mount, dict):
                origin = mount.get('source')
                is_bind = mount.get('type') == 'bind'
                readonly = mount.get('read_only') is True
            else:
                raise ValueError('Invalid volume mount')
            if is_bind:
                if not readonly:
                    raise ValueError('Writable bind mounts are unsupported; use a named volume so data survives updates and rollback')
                relative = source_relative(origin)
                target = no_links(source / relative)
                if not target.exists() or not (target.is_file() or target.is_dir()):
                    raise ValueError('Read-only bind source is missing from the selected directory')


def contained_path(source, value, directory=False):
    if not isinstance(value, str):
        raise ValueError('Invalid normalized source path')
    candidate = no_links(pathlib.Path(value))
    try:
        candidate.relative_to(source)
    except ValueError:
        raise ValueError('Absolute/external bind mounts and out-of-source paths are unsupported; copy read-only files into source or use a named volume') from None
    if not (candidate.is_dir() if directory else candidate.is_file()):
        raise ValueError('Normalized source path is missing or not a regular file/directory')
    return candidate


def normalize_compose(app, directory, request):
    source = directory / 'source'
    total = uploaded_compose_source(source, request)
    documents = request.get('documents')
    if not isinstance(documents, list) or len(documents) != len(request['spec']['files']):
        raise ValueError('Parsed Compose documents are required')
    args = ['docker', 'compose', '--project-name', project_name(app), '--project-directory', str(source)]
    for index, document in enumerate(documents):
        raw_compose_paths(document, source)
        file = directory / ('input-' + str(index) + '.json')
        write_file(file, json.dumps(document).encode(), 0o600)
        args += ['-f', str(file)]
    for filename in request['spec']['envFiles'] or [None]:
        args += ['--env-file', str(source / filename) if filename else '/dev/null']
    for profile in request['spec']['profiles']:
        args += ['--profile', profile]
    output = compose_command(args + ['config', '--format', 'json'], cwd=str(directory))[1]
    try:
        config = compose_values(json.loads(output))
    except Exception:
        raise ValueError('Docker Compose must support config --format json') from None
    warnings = scope_compose(app, source, config, request['spec']['profiles'])
    compatible_release(app, {'kind': 'compose', 'services': sorted(config['services'])})
    return config, warnings, total


def scope_compose(app, source, config, profiles):
    if set(config) - {'name', 'version', 'services', 'volumes', 'networks', 'configs', 'secrets'}:
        raise ValueError('Unsupported advanced Compose top-level configuration')
    services = config.get('services') or {}
    services = {key: service for key, service in services.items() if not service.get('profiles') or set(service['profiles']).intersection(profiles)}
    config['services'] = services
    if not services:
        raise ValueError('No services are enabled by the selected profiles')
    warnings = ['Named-volume data persists across updates and rollback; database contents and migrations are not rolled back.']
    for key, service in services.items():
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', key):
            raise ValueError('Unsupported Compose service name')
        forbidden = ('container_name', 'privileged', 'devices', 'device_cgroup_rules', 'gpus', 'cap_add', 'volumes_from', 'external_links', 'provider', 'models', 'develop', 'post_start', 'pre_start', 'pre_stop', 'use_api_socket', 'cgroup_parent', 'credential_spec', 'runtime')
        if any(service.get(field) for field in forbidden):
            raise ValueError('Unsupported service isolation option: container_name, privileged/devices/capabilities, external services, hooks and Docker socket access are not allowed')
        if service.get('network_mode') not in (None, 'none') or any(service.get(field) for field in ('pid', 'ipc', 'userns_mode', 'uts', 'cgroup')):
            raise ValueError('Host/shared network or process namespaces are unsupported; use Compose project networks')
        if any(option != 'no-new-privileges:true' for option in service.get('security_opt', [])):
            raise ValueError('Only no-new-privileges:true is supported in security_opt')
        deploy = service.get('deploy') or {}
        if set(deploy) - {'resources', 'replicas', 'restart_policy'} or deploy.get('replicas', 1) != 1 or service.get('scale', 1) != 1:
            raise ValueError('Compose releases support one container per service; orchestration/replicas are unsupported')
        if (deploy.get('resources') or {}).get('reservations', {}).get('devices'):
            raise ValueError('Device reservations are unsupported')
        service.pop('profiles', None)
        service.pop('env_file', None)
        service['environment'] = {k: v for k, v in (service.get('environment') or {}).items() if v is not None}
        build = service.get('build')
        if build:
            context = contained_path(source, build['context'], directory=True)
            if 'dockerfile_inline' not in build:
                dockerfile = pathlib.Path(build.get('dockerfile', 'Dockerfile'))
                contained_path(source, str(context / dockerfile))
            if any(value is None for value in (build.get('args') or {}).values()):
                raise ValueError('Build arguments need explicit values; implicit host environment is unsupported')
            warnings.append('Local Dockerfile builds execute on the remote Docker daemon; review the selected source before deploying.')
        elif not service.get('image'):
            raise ValueError('Every service needs an image or local build')
        for dependency, settings in (service.get('depends_on') or {}).items():
            if dependency not in services:
                raise ValueError('A dependency is disabled by the selected profiles; enable its profile')
            if settings.get('condition', 'service_started') not in ('service_started', 'service_healthy', 'service_completed_successfully') or settings.get('required', True) is not True:
                raise ValueError('Only required Compose service dependencies are supported')
        for mount in service.get('volumes') or []:
            if mount.get('target', '').rstrip('/').endswith('docker.sock'):
                raise ValueError('Docker socket mounts are unsupported')
            if mount.get('type') == 'bind':
                if mount.get('read_only') is not True:
                    raise ValueError('Writable bind mounts are unsupported; use a named volume for persistent data')
                candidate = pathlib.Path(mount.get('source', ''))
                contained_path(source, str(candidate), directory=candidate.is_dir())
                if set(mount.get('bind') or {}) - {'create_host_path'}:
                    raise ValueError('Bind propagation/SELinux options are unsupported')
                mount['bind'] = {'create_host_path': False}
            elif mount.get('type') == 'volume':
                if not mount.get('source') or mount['source'] not in config.get('volumes', {}):
                    raise ValueError('Anonymous volumes are unsupported; declare a named volume')
            elif mount.get('type') != 'tmpfs':
                raise ValueError('Only named volumes, read-only source binds and tmpfs mounts are supported')
        service.setdefault('labels', {}).update({'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app)})
    for section in ('configs', 'secrets'):
        for definition in (config.get(section) or {}).values():
            if 'file' in definition:
                contained_path(source, definition['file'])
    for section in ('networks', 'volumes'):
        for key, definition in (config.get(section) or {}).items():
            if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}', key):
                raise ValueError('Unsupported network/volume key')
            # Canonical Compose output adds names even when the source has no name.
            definition['name'] = project_name(app) + '_' + key
            definition.setdefault('labels', {}).update({'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app)})
    return list(dict.fromkeys(warnings))


def compatible_release(app, record):
    previous = current_release(app) if app.exists() else None
    if previous:
        old = verify_release(app / 'releases' / previous)
        if old.get('kind', 'static') != record.get('kind', 'static'):
            raise ValueError('Cannot change release kind for an existing app; choose a different application name')
        if set(old.get('services', ['web'])) != set(record.get('services', ['web'])):
            raise ValueError('Service set must remain unchanged between revisions and rollback; choose a new app for service additions/removals')


def check_compose_resources(app, config):
    for section, command in [('volumes', 'volume'), ('networks', 'network')]:
        for definition in (config.get(section) or {}).values():
            code, output, error = run(['docker', command, 'inspect', definition['name']], check=False)
            if not code:
                labels = json.loads(output)[0].get('Labels') or {}
                if labels.get('dev.dockloom.owner') != OWNER or labels.get('dev.dockloom.path') != str(app):
                    raise ValueError('A requested Compose volume/network name is already owned by another application')


def plan_compose(root, request):
    validate_compose_spec(request['spec'])
    existing = app_dir(root, request['spec']['app'])
    app = existing or root / '.dockloom' / 'apps' / request['spec']['app']
    if existing:
        check_transaction(existing)
    check_project(app)
    with tempfile.TemporaryDirectory(prefix='dockloom-compose-') as temp:
        directory = pathlib.Path(temp)
        config, warnings, total = normalize_compose(app, directory, request)
        check_compose_resources(app, config)
    return {'fileCount': len(request['files']), 'bytes': total, 'target': str(app), 'services': sorted(config['services']), 'warnings': warnings,
        'summary': ['Normalize ordered Compose files and explicit environment files with Docker Compose on the server',
            'Build local contexts with release-specific tags; pin every service to its immutable image ID',
            'Freeze environment; verify container labels, image, running state and health; restore the previous release on failure',
            'Keep named-volume data; no down, orphan pruning or volume deletion']}


def prepare_compose_release(app, release, request):
    directory = no_links(app / 'releases' / release)
    directory.mkdir(mode=0o700)
    config, warnings, total = normalize_compose(app, directory, request)
    check_compose_resources(app, config)
    images = {}
    for key, service in config['services'].items():
        if service.get('build'):
            # Never reuse a user's image tag; every revision must actually build its context.
            service['image'] = project_name(app) + '-' + key.lower() + ':' + release
            service['pull_policy'] = 'build'
            build_file = directory / 'build.json'
            write_json(build_file, compose_literals(config))
            compose_command(['docker', 'compose', '--env-file', '/dev/null', '--project-name', project_name(app), '--project-directory', str(directory / 'source'), '-f', str(build_file), 'build', key], timeout=1800, cwd=str(directory))
            remove_file(build_file)
        reference = service['image']
        if not isinstance(reference, str) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}', reference):
            raise ValueError('Invalid service image reference')
        code, output, error = run(['docker', 'image', 'inspect', reference], check=False)
        if code:
            compose_command(['docker', 'pull', reference], timeout=600)
            output = compose_command(['docker', 'image', 'inspect', reference])[1]
        image_info = json.loads(output)[0]
        image = image_info['Id']
        if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
            raise ValueError('Cannot pin service image ID')
        declared_volumes = (image_info.get('Config') or {}).get('Volumes') or {}
        mounted = {mount.get('target') for mount in service.get('volumes') or []}
        if any(target not in mounted for target in declared_volumes):
            raise ValueError('Image declares anonymous data volumes; explicitly mount each image VOLUME using a named volume')
        images[key] = image
        service['image'] = image
        service['pull_policy'] = 'never'
        service.pop('build', None)
        service['labels']['dev.dockloom.release'] = release
    write_json(directory / 'compose.json', compose_literals(config))
    checksums = {file.relative_to(directory).as_posix(): hashlib.sha256(file.read_bytes()).hexdigest() for file in directory.rglob('*') if file.is_file()}
    record = {'owner': OWNER, 'id': release, 'app': app.name, 'kind': 'compose', 'services': sorted(config['services']), 'createdAt': now(),
        'port': 0, 'image': ', '.join(sorted(set(images.values()))), 'images': images, 'status': 'prepared', 'healthTimeout': request['spec']['healthTimeout'], 'checksums': checksums}
    write_json(directory / 'release.json', record)
    return record


def switch_release(app, release, record):
    args = ['up', '-d', '--no-build', '--pull', 'never']
    if record.get('kind') == 'compose':
        check_compose_resources(app, compose_values(read_json(app / 'releases' / release / 'compose.json')))
        # Restart one-shot dependencies too, including when restoring the same old revision.
        args += ['--force-recreate', '--timeout', '10']
    compose(app, release, args + record.get('services', ['web']))


def verify_running(app, release, record):
    if record.get('kind') != 'compose':
        return wait_http(app, release, record)
    config = compose_values(read_json(app / 'releases' / release / 'compose.json'))
    services = config['services']
    completed = set()
    for service in services.values():
        for key, dependency in (service.get('depends_on') or {}).items():
            if dependency.get('condition') == 'service_completed_successfully':
                completed.add(key)
    deadline = time.monotonic() + record['healthTimeout']
    stable = 0
    while time.monotonic() < deadline:
        ids = compose(app, release, ['ps', '--all', '-q'])[1].split()
        containers = json.loads(compose_command(['docker', 'inspect'] + ids)[1]) if ids else []
        grouped = {key: [] for key in services}
        for container in containers:
            labels = (container.get('Config') or {}).get('Labels') or {}
            key = labels.get('com.docker.compose.service')
            if key not in grouped or str(labels.get('com.docker.compose.oneoff', '')).lower() == 'true':
                continue
            if any(labels.get(label) != value for label, value in {'com.docker.compose.project': project_name(app), 'dev.dockloom.owner': OWNER, 'dev.dockloom.path': str(app), 'dev.dockloom.release': release}.items()) or container.get('Image') != record['images'][key]:
                raise ValueError('Service verification failed: unexpected container ownership, release or image')
            grouped[key].append(container)
        ready = True
        for key, rows in grouped.items():
            if len(rows) != 1:
                ready = False
                continue
            container = rows[0]
            state = container.get('State') or {}
            status = state.get('Status')
            if status == 'exited' and key in completed and state.get('ExitCode') == 0:
                continue
            if status in ('exited', 'dead', 'removing') or state.get('OOMKilled') or state.get('Restarting') or container.get('RestartCount', 0) > 0:
                raise ValueError('Service startup failed: a container exited, restarted or was killed')
            health = (state.get('Health') or {}).get('Status')
            if health == 'unhealthy':
                raise ValueError('Service healthcheck failed')
            healthcheck = services[key].get('healthcheck') or {}
            required_health = bool(healthcheck) and not healthcheck.get('disable') and healthcheck.get('test') != ['NONE']
            if status != 'running' or not state.get('Running') or health not in (None, 'healthy') or required_health and health != 'healthy':
                ready = False
        stable = stable + 1 if ready else 0
        if stable >= 2:
            return
        time.sleep(min(1, record['healthTimeout'] / 3.0, max(0, deadline - time.monotonic())))
    raise ValueError('Service startup/health verification timed out; define healthchecks and review healthTimeout')
`;
