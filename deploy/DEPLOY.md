# Deploying RoarinAPI to AWS — step by step

End-to-end commands to deploy the HA architecture (2× t4g.medium, ALB + WAF,
EFS, SSM) and test it. Run everything from your own terminal, from the repo
root, with your AWS keys exported. Architecture details and the OWASP Top 10
mapping live in [`terraform/README.md`](terraform/README.md).

## 0. Prerequisites (one-time)

Install: `terraform` (>= 1.5), `aws` CLI v2, `docker` (with `buildx`),
`node`/`npm`. Then export your credentials and confirm they work:

```bash
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# export AWS_SESSION_TOKEN=...        # only if using temporary/STS creds
export AWS_DEFAULT_REGION=eu-west-1   # must match var.region below

aws sts get-caller-identity           # sanity check: returns your account/user
```

## 1. Go to the repo and sync the npm lockfile

The Dockerfile uses `npm ci`, so `package-lock.json` must include
`@fastify/helmet`. Run `npm install` once with network access to sync it.

```bash
cd "<path-to>/roarinapiservice"       # your repo root
git checkout security-hardening-aws-deploy
npm install                           # updates package-lock.json with helmet
```

## 2. Build and push the image to ECR (arm64, to match t4g/Graviton)

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/roarinapi"

# create the ECR repo (with image scanning on)
aws ecr create-repository --repository-name roarinapi \
  --image-scanning-configuration scanOnPush=true \
  --region $AWS_DEFAULT_REGION 2>/dev/null || true

# log docker in to ECR
aws ecr get-login-password --region $AWS_DEFAULT_REGION \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com"

# build for arm64 and push (from repo root, where the Dockerfile is)
docker buildx create --use 2>/dev/null || true
docker buildx build --platform linux/arm64 -t "$REPO:latest" --push .
```

## 3. Configure Terraform variables

```bash
cd deploy/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`. Minimum for a **quick HTTP test** (no domain needed):

```hcl
region          = "eu-west-1"
instance_type   = "t4g.medium"
container_image = "<ACCOUNT>.dkr.ecr.eu-west-1.amazonaws.com/roarinapi:latest"

# leave these empty for HTTP-only on the ALB DNS name (test only)
domain_name    = ""
hosted_zone_id = ""

# lock the admin UI to YOUR public IP (get it: curl -s https://checkip.amazonaws.com)
admin_allowed_cidrs = ["<your.ip.here>/32"]
```

For real TLS, set `domain_name` + `hosted_zone_id` to a Route 53 zone you own;
Terraform requests an ACM cert, wires HTTPS, and redirects HTTP -> HTTPS.

## 4. Deploy

```bash
terraform init
terraform plan       # review what will be created
terraform apply      # type: yes
```

Takes ~3-5 min (VPC, ALB, EFS, ASG, WAF).

## 5. Grab the outputs

```bash
terraform output service_url            # e.g. http://roarinapi-alb-xxxx.eu-west-1.elb.amazonaws.com
terraform output -raw setup_token       # one-time token to create the admin account
```

Instances need ~1-2 min after apply to pull the image and pass health checks.
Watch until healthy:

```bash
TG=$(aws elbv2 describe-target-groups --names roarinapi-tg \
  --query 'TargetGroups[0].TargetGroupArn' --output text --region $AWS_DEFAULT_REGION)
aws elbv2 describe-target-health --target-group-arn $TG \
  --query 'TargetHealthDescriptions[].TargetHealth.State' --output text --region $AWS_DEFAULT_REGION
# repeat until it prints: healthy healthy
```

## 6. Test the service

```bash
URL=$(terraform output -raw service_url)

# health check
curl -s "$URL/health"                       # {"status":"ok",...}

# open (unauthenticated) mock endpoint
curl -s "$URL/ping"                          # {"message":"pong"}

# token-protected endpoint — 401 without token, 200 with it
curl -s -o /dev/null -w "%{http_code}\n" "$URL/carlist"
curl -s "$URL/carlist" -H "Authorization: Bearer let-th3PenguinR0ar!"

# security headers present (helmet / fallback)
curl -sI "$URL/ping" | grep -iE "content-security-policy|x-frame-options|strict-transport"
```

Then complete admin setup in a browser (from your allowed IP):

1. Open `<service_url>/admin`
2. Enter the **setup token** from step 5 + a new admin password (>= 8 chars)
3. You're in — create/edit endpoints, etc.

Trying `/admin` from an IP not in `admin_allowed_cidrs` returns a WAF **403** —
that's the A01 gate working.

## 7. Tear down when done (stop the billing)

```bash
cd deploy/terraform
terraform destroy        # type: yes

# ECR repo isn't managed by Terraform — remove it separately if you want:
aws ecr delete-repository --repository-name roarinapi --force --region $AWS_DEFAULT_REGION
```

## Gotchas

- **`admin_allowed_cidrs`**: if left at `0.0.0.0/0`, the admin UI is reachable by
  anyone (only the setup token protects initial setup). Lock it to your IP.
- **arm64 build on an Intel Mac**: `buildx` uses emulation — slower but works.
  On Apple Silicon it's native.
- **`terraform output setup_token` shows `<sensitive>`**: use `-raw` as shown.
- **Instances stay unhealthy > 3 min**: they pull the image via NAT — check
  `aws logs tail /roarinapi/app --follow` (CloudWatch); usually an ECR
  pull/permission issue or a wrong `container_image`.
- **No SSH by design**: get on a box with
  `aws ssm start-session --target <instance-id>`.
- **Multi-instance state**: config/endpoints/assets live on shared EFS and the
  session tokens are stateless (signed with the shared `sessionSecret`), so any
  instance can serve any request/session.
