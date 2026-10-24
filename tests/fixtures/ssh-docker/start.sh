#!/bin/sh
set -eu
cp /fixture-key.pub /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
/usr/sbin/sshd
export DOCKER_TLS_CERTDIR=''
exec dockerd-entrypoint.sh --host=unix:///var/run/docker.sock --storage-driver=vfs
