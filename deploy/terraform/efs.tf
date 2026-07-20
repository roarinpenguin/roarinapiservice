# Shared, encrypted EFS for /app/data (config.json, endpoints.json, assets,
# certs). Shared storage is REQUIRED for horizontal scaling: every instance
# reads the same endpoints/config, and the app's stateless session tokens are
# signed with sessionSecret which lives in this shared config.json.
resource "aws_efs_file_system" "data" {
  creation_token  = "${var.project_name}-data"
  encrypted       = true
  throughput_mode = "bursting"

  lifecycle_policy {
    transition_to_ia = "AFTER_30_DAYS"
  }

  tags = { Name = "${var.project_name}-data" }
}

resource "aws_efs_mount_target" "data" {
  count           = var.az_count
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = aws_subnet.private[count.index].id
  security_groups = [aws_security_group.efs.id]
}

# Access point pins ownership/permissions of the data dir to uid/gid 1001,
# matching the non-root "roarinapi" user in the Dockerfile.
resource "aws_efs_access_point" "data" {
  file_system_id = aws_efs_file_system.data.id

  posix_user {
    uid = 1001
    gid = 1001
  }

  root_directory {
    path = "/roarinapi-data"
    creation_info {
      owner_uid   = 1001
      owner_gid   = 1001
      permissions = "0750"
    }
  }

  tags = { Name = "${var.project_name}-data-ap" }
}
