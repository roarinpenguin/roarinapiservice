output "alb_dns_name" {
  description = "Public DNS name of the load balancer."
  value       = aws_lb.app.dns_name
}

output "service_url" {
  description = "URL to reach the service."
  value       = local.https_enabled ? "https://${var.domain_name}" : "http://${aws_lb.app.dns_name}"
}

output "efs_id" {
  description = "Shared EFS file system ID backing /app/data."
  value       = aws_efs_file_system.data.id
}

output "web_acl_arn" {
  description = "WAF web ACL ARN attached to the ALB."
  value       = aws_wafv2_web_acl.app.arn
}

output "autoscaling_group" {
  description = "Name of the app Auto Scaling Group."
  value       = aws_autoscaling_group.app.name
}

output "setup_token" {
  description = "One-time token required to create the admin account on first launch (H1). Retrieve with: terraform output -raw setup_token"
  value       = random_password.setup_token.result
  sensitive   = true
}

output "admin_access_note" {
  description = "How to reach an instance for troubleshooting."
  value       = "Use SSM Session Manager (no SSH open): aws ssm start-session --target <instance-id> --region ${var.region}"
}
