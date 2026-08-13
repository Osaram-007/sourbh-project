#!/usr/bin/env bash
# Nightly Postgres backup. Add to crontab, e.g.:
#   0 2 * * * /opt/full-charge/deploy/backup.sh >> /var/log/full-charge-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="/var/backups/full-charge"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"

# DATABASE_URL must be set in the environment (source the app's .env if needed):
#   set -a; source /opt/full-charge/.env; set +a
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/fullcharge-$TIMESTAMP.sql.gz"

find "$BACKUP_DIR" -name "fullcharge-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

# Optional offsite copy — uncomment once an S3 bucket + AWS CLI credentials are set up:
# aws s3 cp "$BACKUP_DIR/fullcharge-$TIMESTAMP.sql.gz" "s3://your-bucket/full-charge-backups/"
