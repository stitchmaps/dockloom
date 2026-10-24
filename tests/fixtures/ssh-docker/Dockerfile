FROM docker:27-dind
RUN apk upgrade --no-cache --available && apk add --no-cache openssh python3 curl bash && ssh-keygen -A && mkdir -p /root/.ssh && chmod 700 /root/.ssh
RUN passwd -d root && printf '%s\n' 'Port 22' 'PermitRootLogin prohibit-password' 'PasswordAuthentication no' 'PubkeyAuthentication yes' 'AuthorizedKeysFile .ssh/authorized_keys' 'Subsystem sftp internal-sftp' > /etc/ssh/sshd_config
COPY start.sh /usr/local/bin/dockloom-test-start
RUN chmod +x /usr/local/bin/dockloom-test-start
ENTRYPOINT ["/usr/local/bin/dockloom-test-start"]
