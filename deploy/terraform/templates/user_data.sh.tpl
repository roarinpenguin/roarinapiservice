#!/bin/bash
set -euo pipefail

# --- Install Docker + EFS mount helper (Amazon Linux 2023, arm64) ---
dnf install -y docker amazon-efs-utils
systemctl enable --now docker

# --- Mount the shared EFS data volume (encrypted in transit via TLS) ---
mkdir -p /mnt/efs/data
if ! mountpoint -q /mnt/efs/data; then
  mount -t efs -o tls,accesspoint=${efs_access_point_id} ${efs_id}:/ /mnt/efs/data
fi
# Persist across reboots
grep -q "${efs_id}" /etc/fstab || \
  echo "${efs_id}:/ /mnt/efs/data efs _netdev,tls,accesspoint=${efs_access_point_id} 0 0" >> /etc/fstab

# --- Authenticate to ECR and pull the image ---
ACCOUNT_ID=$(echo "${container_image}" | cut -d. -f1)
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin "$ACCOUNT_ID.dkr.ecr.${region}.amazonaws.com" || true
docker pull ${container_image}

# --- Run the app (plain HTTP; the ALB terminates TLS in front) ---
docker rm -f ${project_name} 2>/dev/null || true
docker run -d \
  --name ${project_name} \
  --restart always \
  -p ${app_port}:${app_port} \
  -v /mnt/efs/data:/app/data \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e USE_HTTPS=false \
  -e SETUP_TOKEN='${setup_token}' \
  --log-driver=awslogs \
  --log-opt awslogs-region=${region} \
  --log-opt awslogs-group=/${project_name}/app \
  --log-opt awslogs-create-group=true \
  ${container_image}
