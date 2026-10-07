#!/usr/bin/env bash
# Operate the AWS host from the Mac. Reads instance details from .local/aws.env (IID, SG, IP) and the key ~/.ssh/shillcheck-prod.pem.
#   scripts/aws.sh ssh [cmd...]   open a shell or run a command
#   scripts/aws.sh status         pm2 process list and health checks
#   scripts/aws.sh health         latest health-check result (cron, every 5 minutes) and recent restarts
#   scripts/aws.sh logs <name> [n]  last n lines of a process log (mps eve api worker chat chat-eve)
#   scripts/aws.sh deploy         git pull and restart all processes (never run a second worker elsewhere)
#   scripts/aws.sh allow-my-ip    replace the SSH rule with this machine's current public IP
set -euo pipefail
cd "$(dirname "$0")/.."
. .local/aws.env
KEY="$HOME/.ssh/shillcheck-prod.pem"
remote() { ssh -i "$KEY" -o IdentitiesOnly=yes "ubuntu@$IP" "$@"; }
case "${1:-}" in
  ssh) shift; remote "$@" ;;
  status) remote 'pm2 jlist | node -e "const j=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));for(const p of j)console.log(p.name.padEnd(22),p.pm2_env.status.padEnd(8),\"restarts\",p.pm2_env.restart_time)"; curl -s -m5 localhost:38127/api/v1/health; echo; free -m | sed -n 2p; df -h / | tail -1' ;;
  health) remote 'node -e "const s=JSON.parse(require(\"fs\").readFileSync(process.env.HOME+\"/shillcheck/.local/health/status.json\",\"utf8\"));console.log(s.ts,s.overall.toUpperCase());for(const [k,c] of Object.entries(s.checks))console.log((c.ok?\"  ok  \":\"  FAIL\"),k.padEnd(18),c.detail);if(s.actions.length)console.log(\"actions:\",JSON.stringify(s.actions))"; echo --- recent problems; tail -n 5 ~/shillcheck/.local/health/health.log | cut -c1-240' ;;
  logs) remote "tail -n ${3:-60} ~/shillcheck/.local/logs/${2:?name}.out.log ~/shillcheck/.local/logs/${2}.err.log" ;;
  deploy) remote 'cd ~/shillcheck && git pull --ff-only && npm ci --silent && pm2 restart ecosystem.config.cjs --update-env' ;;
  allow-my-ip)
    NEW=$(curl -s https://checkip.amazonaws.com | tr -d '\n')
    OLD=$(aws ec2 describe-security-groups --group-ids "$SG" --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text)
    for c in $OLD; do aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$c" >/dev/null; done
    aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$NEW/32" >/dev/null
    echo "SSH now allowed from $NEW" ;;
  *) sed -n 2,9p "$0"; exit 1 ;;
esac
