variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "eu-west-1"
}

variable "project_name" {
  description = "Name prefix for all resources."
  type        = string
  default     = "roarinapi"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones to spread across (min 2 for HA)."
  type        = number
  default     = 2
}

variable "instance_type" {
  description = "EC2 instance type. Graviton (arm64) for best price/performance."
  type        = string
  default     = "t4g.medium"
}

variable "asg_min_size" {
  description = "Minimum number of app instances (>=2 keeps the service available across an AZ failure and across cross-instance session validation)."
  type        = number
  default     = 2
}

variable "asg_max_size" {
  description = "Maximum number of app instances the ASG may scale to."
  type        = number
  default     = 4
}

variable "asg_desired_capacity" {
  description = "Desired number of app instances."
  type        = number
  default     = 2
}

variable "container_image" {
  description = "Full container image URI to run (e.g. <acct>.dkr.ecr.<region>.amazonaws.com/roarinapi:latest). Push the repo's Dockerfile image here first."
  type        = string
}

variable "app_port" {
  description = "Port the container listens on (app default is 4242, served as plain HTTP behind the ALB which terminates TLS)."
  type        = number
  default     = 4242
}

variable "domain_name" {
  description = "Public FQDN for the service (e.g. api.example.com). Leave empty to expose HTTP-only on the ALB DNS name (NOT recommended for production)."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route 53 hosted zone ID that owns domain_name. Required when domain_name is set (used for ACM DNS validation and the alias record)."
  type        = string
  default     = ""
}

variable "admin_allowed_cidrs" {
  description = "CIDRs allowed to reach the /admin and /api/admin* paths via WAF. Default is your office/VPN egress; do NOT leave 0.0.0.0/0 in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "waf_rate_limit_per_5min" {
  description = "WAF rate-based rule: max requests per 5 minutes per source IP before blocking."
  type        = number
  default     = 3000
}

variable "waf_login_rate_limit_per_5min" {
  description = "WAF rate-based rule scoped to the admin login path (brute-force protection, OWASP A07)."
  type        = number
  default     = 100
}
