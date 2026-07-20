# Latest Amazon Linux 2023 arm64 AMI (matches Graviton t4g + the arm64 image).
data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

# One-time setup token (H1): the same value on every instance so first-boot
# setup is deterministic across the fleet. Retrieve with:
#   terraform output -raw setup_token
# Setup is also gated by isSetupComplete(), so this token is only usable until
# the admin account is created.
resource "random_password" "setup_token" {
  length  = 40
  special = false
}

resource "aws_launch_template" "app" {
  name_prefix   = "${var.project_name}-"
  image_id      = data.aws_ssm_parameter.al2023_arm64.value
  instance_type = var.instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.instance.arn
  }

  vpc_security_group_ids = [aws_security_group.app.id]

  # OWASP A10 (SSRF): force IMDSv2 so a request-forgery bug can't steal
  # instance credentials via the metadata endpoint.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  # Encrypted root volume (OWASP A02).
  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size           = 20
      volume_type           = "gp3"
      encrypted             = true
      delete_on_termination = true
    }
  }

  monitoring { enabled = true }

  user_data = base64encode(templatefile("${path.module}/templates/user_data.sh.tpl", {
    region              = var.region
    project_name        = var.project_name
    container_image     = var.container_image
    app_port            = var.app_port
    efs_id              = aws_efs_file_system.data.id
    efs_access_point_id = aws_efs_access_point.data.id
    setup_token         = random_password.setup_token.result
  }))

  tag_specifications {
    resource_type = "instance"
    tags          = { Name = "${var.project_name}-app" }
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_autoscaling_group" "app" {
  name                = "${var.project_name}-asg"
  min_size            = var.asg_min_size
  max_size            = var.asg_max_size
  desired_capacity    = var.asg_desired_capacity
  vpc_zone_identifier = aws_subnet.private[*].id
  target_group_arns   = [aws_lb_target_group.app.arn]

  # Replace instances only once the new one is healthy in the ALB.
  health_check_type         = "ELB"
  health_check_grace_period = 120

  launch_template {
    id      = aws_launch_template.app.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
    preferences { min_healthy_percentage = 50 }
  }

  tag {
    key                 = "Name"
    value               = "${var.project_name}-app"
    propagate_at_launch = true
  }

  depends_on = [aws_efs_mount_target.data]
}

# Scale on CPU (mock JSON is light; this mostly protects against traffic spikes).
resource "aws_autoscaling_policy" "cpu" {
  name                   = "${var.project_name}-cpu-target"
  autoscaling_group_name = aws_autoscaling_group.app.name
  policy_type            = "TargetTrackingScaling"

  target_tracking_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ASGAverageCPUUtilization"
    }
    target_value = 60
  }
}
