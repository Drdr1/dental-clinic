#!/usr/bin/env bash
# One-time server hardening for a fresh Ubuntu server. Run as root:
#   bash 01-harden.sh <your-username>
# Afterwards log in as that user with your SSH key; root and passwords are disabled.
set -euo pipefail

NEW_USER="${1:?usage: bash 01-harden.sh <username>}"
[ "$(id -u)" -eq 0 ] || { echo "Run as root"; exit 1; }
[ -s /root/.ssh/authorized_keys ] || { echo "No SSH key in /root/.ssh/authorized_keys — add one first, or you'll lock yourself out."; exit 1; }

echo "==> Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get -yq upgrade
apt-get -yq install ufw fail2ban unattended-upgrades curl ca-certificates git rsync age rclone jq

echo "==> Admin user: $NEW_USER"
if ! id "$NEW_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$NEW_USER"
fi
usermod -aG sudo "$NEW_USER"
install -d -m 700 -o "$NEW_USER" -g "$NEW_USER" "/home/$NEW_USER/.ssh"
install -m 600 -o "$NEW_USER" -g "$NEW_USER" /root/.ssh/authorized_keys "/home/$NEW_USER/.ssh/authorized_keys"
# sudo without a password for this user (it has no password; SSH key is the gate)
echo "$NEW_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$NEW_USER"
chmod 440 "/etc/sudoers.d/90-$NEW_USER"

echo "==> SSH: keys only, no root login"
cat > /etc/ssh/sshd_config.d/10-hardening.conf <<CONF
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
AllowUsers $NEW_USER
CONF
# Newer Ubuntu starts sshd on demand, so this folder may not exist yet; the config test needs it.
mkdir -p /run/sshd
sshd -t
systemctl restart ssh

echo "==> Firewall"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> fail2ban (sshd jail is on by default on Ubuntu)"
systemctl enable --now fail2ban

echo "==> Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<CONF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF

echo "==> 2 GB swap (safety net for a 2 GB server)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
echo 'vm.swappiness=10' > /etc/sysctl.d/90-swappiness.conf
sysctl -p /etc/sysctl.d/90-swappiness.conf

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
usermod -aG docker "$NEW_USER"
# Keep container logs from filling the disk.
cat > /etc/docker/daemon.json <<CONF
{ "log-driver": "local", "log-opts": { "max-size": "10m", "max-file": "3" } }
CONF
systemctl restart docker

echo
echo "Done. BEFORE closing this session, open a NEW terminal and check:"
echo "   ssh $NEW_USER@$(curl -s4 ifconfig.me)"
echo "If that works, you're safe to log out. Root login is now disabled."
