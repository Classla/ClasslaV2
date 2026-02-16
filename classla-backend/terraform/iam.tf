# IAM Role for EC2 Instances
resource "aws_iam_role" "ec2" {
  name = "${local.name_prefix}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-ec2-role"
    }
  )
}

# Attach AWS managed policy for ECR access
resource "aws_iam_role_policy_attachment" "ec2_ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# Policy for Secrets Manager access
resource "aws_iam_role_policy" "ec2_secrets" {
  name = "${local.name_prefix}-ec2-secrets-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:${var.secrets_manager_supabase_secret}*",
          "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:${var.secrets_manager_workos_secret}*",
          "arn:aws:secretsmanager:${data.aws_region.current.name}:*:secret:${var.secrets_manager_app_secret}*"
        ]
      }
    ]
  })
}

# Policy for Bedrock Runtime access
# Note: Bedrock Runtime uses bedrock-runtime service, not bedrock
# Using wildcard region (*) to allow access to models in any region
resource "aws_iam_role_policy" "ec2_bedrock" {
  name = "${local.name_prefix}-ec2-bedrock-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "bedrock-runtime:InvokeModel",
          "bedrock-runtime:InvokeModelWithResponseStream"
        ]
        Resource = "arn:aws:bedrock:*::foundation-model/*"
      }
    ]
  })
}

# Policy for S3 access (for IDE buckets)
resource "aws_iam_role_policy" "ec2_s3" {
  name = "${local.name_prefix}-ec2-s3-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          "arn:aws:s3:::*",
          "arn:aws:s3:::*/*"
        ]
      }
    ]
  })
}

# Policy for CloudWatch Logs
resource "aws_iam_role_policy" "ec2_cloudwatch_logs" {
  name = "${local.name_prefix}-ec2-cloudwatch-logs-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogStreams"
        ]
        Resource = "arn:aws:logs:${data.aws_region.current.name}:*:log-group:/aws/ec2/${local.name_prefix}*"
      }
    ]
  })
}

# Policy for CloudWatch Agent custom metrics
resource "aws_iam_role_policy" "ec2_cloudwatch_metrics" {
  name = "${local.name_prefix}-ec2-cloudwatch-metrics-policy"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "cloudwatch:namespace" = "ClasslaBackend"
          }
        }
      }
    ]
  })
}

# Policy for SSM access (for debugging)
resource "aws_iam_role_policy_attachment" "ec2_ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# IAM Instance Profile
resource "aws_iam_instance_profile" "ec2" {
  name = "${local.name_prefix}-ec2-profile"
  role = aws_iam_role.ec2.name

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-ec2-profile"
    }
  )
}

