# SSH Server Security Hardening

## Overview
SSH is the primary remote access method for Linux servers. Proper hardening prevents brute-force attacks, unauthorized access, and privilege escalation.

## Quick Wins (Do These First)

### 1. Disable Root Login
```bash
# Edit /etc/ssh/sshd_config
PermitRootLogin no

# Restart SSH
systemctl restart sshd
```

### 2. Use SSH Keys Only
```bash
# Disable password authentication
PasswordAuthentication no
ChallengeResponseAuthentication no
UsePAM yes

# Restart SSH
systemctl restart sshd
```

### 3. Change Default Port
```bash
# Use non-standard port (reduces automated scans)
Port 2222

# Don't forget to update firewall
ufw allow 2222/tcp
ufw delete allow 22/tcp
```

### 4. Limit User Access
```bash
# Only allow specific users
AllowUsers charlie admin deploy

# Or allow by group
AllowGroups ssh-users
```

## SSH Key Setup (Proper Method)

### Generate Strong Keys
```bash
# On client machine
ssh-keygen -t ed25519 -C "user@hostname"
# Ed25519 is faster and more secure than RSA

# For compatibility with old systems, use RSA 4096:
ssh-keygen -t rsa -b 4096 -C "user@hostname"
```

### Copy Key to Server
```bash
# Automated method
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server

# Manual method
cat ~/.ssh/id_ed25519.pub | ssh user@server \
  "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# Set proper permissions on server
ssh user@server "chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### Protect Private Key
```bash
# Use passphrase on private key
ssh-keygen -p -f ~/.ssh/id_ed25519

# Use SSH agent to avoid repeated passphrase entry
eval $(ssh-agent)
ssh-add ~/.ssh/id_ed25519
```

## Advanced SSH Configuration

### Hardened /etc/ssh/sshd_config
```bash
# Protocol and encryption
Protocol 2
HostKey /etc/ssh/ssh_host_ed25519_key
HostKey /etc/ssh/ssh_host_rsa_key

# Authentication
PermitRootLogin no
PasswordAuthentication no
PermitEmptyPasswords no
ChallengeResponseAuthentication no
UsePAM yes
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys

# Access control
AllowUsers charlie admin
MaxAuthTries 3
MaxSessions 2
LoginGraceTime 30

# Disable dangerous features
X11Forwarding no
PermitTunnel no
AllowAgentForwarding no
AllowTcpForwarding no
GatewayPorts no

# Session settings
ClientAliveInterval 300
ClientAliveCountMax 2
TCPKeepAlive yes

# Logging
SyslogFacility AUTH
LogLevel VERBOSE

# Restrict ciphers to strong algorithms only
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group-exchange-sha256
```

### Test Config Before Applying
```bash
# Check for syntax errors
sshd -t

# If OK, restart
systemctl restart sshd

# IMPORTANT: Open a second SSH session before closing current one
# In case config breaks SSH access
```

## Fail2Ban (Automated Brute-Force Protection)

### Install
```bash
apt install fail2ban
```

### Configure /etc/fail2ban/jail.local
```ini
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 3
backend = systemd

[sshd]
enabled = true
port = 2222  # Match your SSH port
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
```

### Start Fail2Ban
```bash
systemctl enable fail2ban
systemctl start fail2ban

# Check status
fail2ban-client status sshd

# Unban an IP
fail2ban-client set sshd unbanip 192.168.1.100
```

## Two-Factor Authentication (2FA)

### Install Google Authenticator
```bash
apt install libpam-google-authenticator

# For each user:
su - charlie
google-authenticator
# Answer prompts (yes to all recommended settings)
```

### Configure PAM
```bash
# Edit /etc/pam.d/sshd
# Add at the top:
auth required pam_google_authenticator.so

# Edit /etc/ssh/sshd_config
ChallengeResponseAuthentication yes
AuthenticationMethods publickey,keyboard-interactive

# Restart SSH
systemctl restart sshd
```

Now SSH requires: SSH key + TOTP code from phone

## SSH Bastion/Jump Host

For multi-server environments:

### Bastion Server Config
```bash
# Only allow SSH, block all other ports
ufw default deny incoming
ufw allow 2222/tcp
ufw enable

# Force all SSH through bastion
# Client ~/.ssh/config:
Host bastion
    HostName bastion.example.com
    Port 2222
    User admin

Host internal-*
    ProxyJump bastion
    User charlie

Host internal-web
    HostName 10.0.1.50
    
Host internal-db
    HostName 10.0.1.51
```

Usage:
```bash
# Automatically proxies through bastion
ssh internal-web
```

## SSH Session Recording

### Using Script
```bash
# Force all SSH sessions to be logged
# Add to /etc/profile or ~/.bashrc
if [ -n "$SSH_CONNECTION" ]; then
    script -q -f /var/log/ssh-sessions/$(date +%Y%m%d-%H%M%S)-$(whoami).log
fi
```

### Using auditd
```bash
apt install auditd

# Monitor SSH sessions
auditctl -a always,exit -F arch=b64 -S execve -k ssh_sessions

# View logs
ausearch -k ssh_sessions
```

## Monitoring & Alerting

### Watch for Failed Login Attempts
```bash
# Real-time monitoring
tail -f /var/log/auth.log | grep 'Failed password'

# Summary of failed attempts
grep 'Failed password' /var/log/auth.log | \
  awk '{print $11}' | sort | uniq -c | sort -nr | head -20
```

### Alert on New Authorized Keys
```bash
# Create audit watch
auditctl -w /home -p wa -k authorized_keys_changes

# Check for changes
ausearch -k authorized_keys_changes
```

### SSH Honeypot (Advanced)
```bash
# Run SSH on port 22 with restricted access
# Log attempts for threat intelligence
apt install cowrie

# Configure cowrie to log all SSH attempts
# Real SSH on port 2222
```

## Client-Side Security

### ~/.ssh/config Best Practices
```bash
# Default settings for all hosts
Host *
    ServerAliveInterval 60
    ServerAliveCountMax 3
    HashKnownHosts yes
    IdentitiesOnly yes
    VerifyHostKeyDNS yes
    
# Production servers
Host prod-*
    IdentityFile ~/.ssh/id_prod_ed25519
    StrictHostKeyChecking yes
    UserKnownHostsFile ~/.ssh/known_hosts.prod
```

### Avoid SSH Agent Forwarding
```bash
# Instead of -A (dangerous):
ssh -A user@server

# Use ProxyJump:
ssh -J bastion user@internal-server
```

## Emergency Access Recovery

### Console Access Required
If locked out, access via:
- Physical console
- IPMI/iLO/iDRAC
- Cloud provider console

### Reset Root Password
```bash
# At GRUB menu, edit boot parameters
# Add: init=/bin/bash
# Boot into single-user mode
mount -o remount,rw /
passwd root
exec /sbin/init
```

### Backup Access Method
Keep one root access method:
```bash
# Create emergency user with password auth
# Separate config file
# /etc/ssh/sshd_config.d/emergency.conf
Match User emergency
    PasswordAuthentication yes
    PermitRootLogin no
```

## Compliance & Hardening Scanners

### SSH-Audit
```bash
# Install
pip3 install ssh-audit

# Scan your server
ssh-audit localhost
```

### Lynis Security Audit
```bash
# Install
apt install lynis

# Run audit
lynis audit system

# Check SSH section
lynis show report | grep SSH
```

## Prevention Checklist

- [ ] Disable root login
- [ ] Disable password authentication
- [ ] Use SSH keys only
- [ ] Change default port
- [ ] Restrict user access (AllowUsers/AllowGroups)
- [ ] Install and configure Fail2Ban
- [ ] Enable 2FA for admin users
- [ ] Use strong ciphers only
- [ ] Set up SSH session logging
- [ ] Monitor auth.log for failed attempts
- [ ] Regular key rotation (quarterly)
- [ ] Document all authorized users
- [ ] Test backup access method
- [ ] Keep SSH updated (security patches)
