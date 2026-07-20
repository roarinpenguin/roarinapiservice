# ---- ALB security group: public entry point ----
resource "aws_security_group" "alb" {
  name_prefix = "${var.project_name}-alb-"
  description = "Public ALB - 80/443 from the internet"
  vpc_id      = aws_vpc.main.id

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTP from anywhere (redirected to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-alb-sg" }
  lifecycle { create_before_destroy = true }
}

# ---- App instance security group: only reachable from the ALB ----
resource "aws_security_group" "app" {
  name_prefix = "${var.project_name}-app-"
  description = "App instances - only from ALB on the app port"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "App traffic from ALB only"
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.project_name}-app-sg" }
  lifecycle { create_before_destroy = true }
}

# ---- EFS security group: NFS only from app instances ----
resource "aws_security_group" "efs" {
  name_prefix = "${var.project_name}-efs-"
  description = "EFS mount targets - NFS from app instances only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "NFS from app instances"
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = { Name = "${var.project_name}-efs-sg" }
  lifecycle { create_before_destroy = true }
}
