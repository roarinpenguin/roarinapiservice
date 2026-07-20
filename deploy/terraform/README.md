# RoarinAPI — AWS deployment (Terraform)

Highly-available, publicly reachable deployment of RoarinAPI, sized for **~150
concurrent users** and protected against the **OWASP Top 10** at the edge.

## Architecture

```
Internet
  │  (HTTPS, TLS 1.2/1.3 via ACM)
  ▼
Application Load Balancer  ──  AWS WAF web ACL
  │                             • Amazon IP reputation
  │                             • Core Rule Set (OWASP common exploits/XSS)
  │                             • Known-bad-inputs + SQLi managed rules
  │                             • Rate limit (global + stricter on /api/admin/login)
  │                             • /admin* restricted to allowed CIDRs
  │  (HTTP :4242, private subnets only)
  ▼
Auto Scaling Group — 2× t4g.medium (Graviton), across 2 AZs
  │   Docker container (repo Dockerfile), IMDSv2 enforced, encrypted EBS
  │   Admin access via SSM Session Manager (no SSH, no bastion)
  ▼
Amazon EFS (encrypted) mounted at /app/data  ← shared config/endpoints/assets
```

### Why this shape
- **t4g.medium ×2:** the workload is tiny JSON; 150 users is a light load. Two
  instances are for **availability** (AZ failure) and rolling deploys, not
  throughput. Scales to 4 on CPU.
- **Shared EFS:** the app persists config/endpoints/assets to `/app/data`. All
  instances must see the same data, and the stateless session tokens are signed
  with `sessionSecret` stored in the shared `config.json`. (Requires the app
  changes that add the mtime cache + stateless sessions.)
- **WAF on the ALB:** the app has no built-in WAF; this is the OWASP layer.

## OWASP Top 10 coverage

| Risk | Control |
|------|---------|
| A01 Broken Access Control | WAF `restrict-admin-paths` IP-set gate on `/admin*`; app auth; one-time **setup token** blocks first-boot takeover (H1) |
| A02 Cryptographic Failures | ACM TLS 1.2/1.3 at ALB; encrypted EFS + EBS |
| A03 Injection | WAF SQLi + Core Rule Set + known-bad-inputs (app RCE already fixed) |
| A04 Insecure Design | Layered defense, private subnets, least-privilege SGs |
| A05 Security Misconfiguration | App **security headers** (`@fastify/helmet` + CSP, with built-in fallback); SSM (no SSH), IMDSv2, `drop_invalid_header_fields`, minimal IAM |
| A06 Vulnerable Components | ECR image scanning (enable on the repo); patch via instance refresh |
| A07 Auth Failures | WAF rate-limit on `/api/admin/login`; app timing-safe compare |
| A08 Data Integrity Failures | Validated config import (app fix); TLS everywhere |
| A09 Logging & Monitoring | WAF logs, ALB, VPC Flow Logs → CloudWatch |
| A10 SSRF | IMDSv2 required; egress-restricted private subnets |

Add **GuardDuty**, **AWS Config**, and **CloudTrail** at the account level to
round out A05/A09 (not created here — usually managed org-wide).

## Prerequisites
1. Terraform >= 1.5, AWS credentials with admin-ish permissions.
2. A **Route 53 hosted zone** for your domain (for TLS). Optional but recommended.
3. The container image pushed to **ECR**.

### Step 1 — build & push the image (arm64, to match Graviton)
```bash
AWS_REGION=eu-west-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/roarinapi

aws ecr create-repository --repository-name roarinapi --region $AWS_REGION \
  --image-scanning-configuration scanOnPush=true
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REPO

# From the repo root (Dockerfile). Build for arm64 to match t4g:
docker buildx build --platform linux/arm64 -t $REPO:latest --push .
```

### Step 2 — deploy
```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars   # edit values
terraform init
terraform apply
```

`terraform output service_url` gives the public URL. To create the admin
account on first launch you need the **one-time setup token** (H1 protection —
stops a random visitor from claiming the admin account first):

```bash
terraform output -raw setup_token
```

Then visit `/admin` (from an allowed CIDR), enter the setup token + your admin
password. The same token is injected into every instance via `SETUP_TOKEN`, so
setup is consistent across the fleet, and it stops working once the account
exists.

> **Note on `@fastify/helmet`:** the app declares `@fastify/helmet` in
> `package.json` for security headers (OWASP A05). Run `npm install` once (with
> network access) to sync `package-lock.json` before `docker build`, since the
> Dockerfile uses `npm ci`. If helmet is ever missing, the app automatically
> falls back to emitting the same headers via a built-in hook, so it never runs
> without security headers.

## Notes & trade-offs
- **HTTP-only fallback:** leave `domain_name`/`hosted_zone_id` empty to expose
  HTTP on the ALB DNS name — for testing only. Set a domain for real use.
- **Cost knobs:** the single NAT gateway (~$32/mo) is the main fixed cost after
  the instances. For lower cost / smaller attack surface, swap it for VPC
  interface endpoints (ECR api+dkr, SSM, logs) + an S3 gateway endpoint and
  drop the NAT.
- **Optional CloudFront front door:** put CloudFront (with its own WAF + AWS
  Shield Standard) in front of the ALB for global edge caching and DDoS
  absorption. Restrict the ALB to CloudFront's managed prefix list + a secret
  origin header if you add it.
- **App-level `@fastify/helmet`** (security headers) is still worth adding in
  the app for defense-in-depth when traffic doesn't traverse the ALB/WAF.
```
