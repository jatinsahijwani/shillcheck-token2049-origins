#!/usr/bin/env bash
# Pull the server's daily backups to this Mac and encrypt them at rest (AES-256, passphrase in the login Keychain item
# "shillcheck-backup-passphrase"). The AWS account used for this project cannot create S3 buckets, so backups live on the
# server (7 days) and here. Run it by hand or from launchd. Needs SSH access (scripts/aws.sh allow-my-ip if your IP changed).
set -euo pipefail
cd "$(dirname "$0")/.."
. .local/aws.env
KEY="$HOME/.ssh/shillcheck-prod.pem"
DEST="${BACKUP_DEST:-$HOME/Backups/shillcheck-aws}"
umask 077; mkdir -p "$DEST"
PASS=$(security find-generic-password -a "$USER" -s shillcheck-backup-passphrase -w)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
scp -q -i "$KEY" -o IdentitiesOnly=yes "ubuntu@$IP:backups/mps-*.dump" "ubuntu@$IP:backups/state-*.tgz" "$TMP/" 2>/dev/null || true
n=0
for f in "$TMP"/*; do
  [ -e "$f" ] || continue
  out="$DEST/$(basename "$f").enc"
  if [ ! -e "$out" ]; then
    openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass pass:"$PASS" -in "$f" -out "$out"; n=$((n+1))
  fi
done
# Keep the 14 newest of each kind locally.
for kind in mps state; do ls -1t "$DEST"/$kind-* 2>/dev/null | tail -n +15 | xargs -r rm -f; done
echo "pulled $n new encrypted backup(s) to $DEST"; ls -1t "$DEST" | head -4
# Decrypt: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass pass:"$(security find-generic-password -a "$USER" -s shillcheck-backup-passphrase -w)" -in FILE.enc -out FILE
