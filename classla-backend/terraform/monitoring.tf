# CloudWatch Log Group
resource "aws_cloudwatch_log_group" "main" {
  name              = "/aws/ec2/${local.name_prefix}"
  retention_in_days = var.log_retention_days

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-logs"
    }
  )
}

# =============================================================================
# SNS Topic → Lambda → Discord Pipeline
# =============================================================================

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-alerts"
    }
  )
}

# IAM role for Lambda
resource "aws_iam_role" "discord_notifier" {
  name = "${local.name_prefix}-discord-notifier-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-discord-notifier-role"
    }
  )
}

resource "aws_iam_role_policy_attachment" "discord_notifier_logs" {
  role       = aws_iam_role.discord_notifier.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Lambda function
data "archive_file" "discord_notifier" {
  type        = "zip"
  output_path = "${path.module}/lambda/discord_notifier.zip"

  source {
    content  = <<-PYTHON
import json
import os
import urllib.request

WEBHOOK_URL = os.environ["DISCORD_WEBHOOK_URL"]

COLOR_MAP = {
    "ALARM": 0xE74C3C,            # Red
    "OK": 0x2ECC71,               # Green
    "INSUFFICIENT_DATA": 0xF1C40F # Yellow
}

def handler(event, context):
    for record in event.get("Records", []):
        message = json.loads(record["Sns"]["Message"])

        alarm_name = message.get("AlarmName", "Unknown")
        new_state = message.get("NewStateValue", "UNKNOWN")
        reason = message.get("NewStateReason", "No reason provided")
        description = message.get("AlarmDescription", "")
        region = message.get("Region", "")
        timestamp = message.get("StateChangeTime", "")

        color = COLOR_MAP.get(new_state, 0x95A5A6)

        embed = {
            "title": f"{'🔴' if new_state == 'ALARM' else '🟢' if new_state == 'OK' else '🟡'} {alarm_name}",
            "description": description or "CloudWatch alarm state change",
            "color": color,
            "fields": [
                {"name": "State", "value": new_state, "inline": True},
                {"name": "Region", "value": region, "inline": True},
                {"name": "Reason", "value": reason[:1024], "inline": False},
            ],
            "timestamp": timestamp,
        }

        payload = json.dumps({"embeds": [embed]}).encode("utf-8")
        req = urllib.request.Request(
            WEBHOOK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req)

    return {"statusCode": 200}
PYTHON
    filename = "index.py"
  }
}

resource "aws_lambda_function" "discord_notifier" {
  function_name    = "${local.name_prefix}-discord-notifier"
  filename         = data.archive_file.discord_notifier.output_path
  source_code_hash = data.archive_file.discord_notifier.output_base64sha256
  handler          = "index.handler"
  runtime          = "python3.12"
  timeout          = 10
  role             = aws_iam_role.discord_notifier.arn

  environment {
    variables = {
      DISCORD_WEBHOOK_URL = var.discord_webhook_url
    }
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-discord-notifier"
    }
  )
}

# Allow SNS to invoke the Lambda
resource "aws_lambda_permission" "sns_invoke" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.discord_notifier.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts.arn
}

# Subscribe Lambda to SNS
resource "aws_sns_topic_subscription" "discord_notifier" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.discord_notifier.arn
}

# =============================================================================
# Existing Alarms — now wired to SNS
# =============================================================================

# CloudWatch Alarm - High CPU Utilization
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "${local.name_prefix}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "EC2 CPU utilization > 80% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.main.name
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-high-cpu-alarm"
    }
  )
}

# CloudWatch Alarm - ALB 5xx Errors
resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors" {
  alarm_name          = "${local.name_prefix}-alb-5xx-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  alarm_description   = "ALB target 5xx errors > 10 in 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-alb-5xx-alarm"
    }
  )
}

# CloudWatch Alarm - Target Health Check Failures
resource "aws_cloudwatch_metric_alarm" "target_health_failures" {
  alarm_name          = "${local.name_prefix}-target-health-failures"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Average"
  threshold           = 0
  alarm_description   = "Unhealthy hosts detected behind ALB"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    TargetGroup  = aws_lb_target_group.main.arn_suffix
    LoadBalancer = aws_lb.main.arn_suffix
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-target-health-alarm"
    }
  )
}

# CloudWatch Alarm - High Response Time
resource "aws_cloudwatch_metric_alarm" "high_response_time" {
  alarm_name          = "${local.name_prefix}-high-response-time"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Average"
  threshold           = 2.0 # 2 seconds
  alarm_description   = "ALB average response time > 2s for 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-high-response-time-alarm"
    }
  )
}

# =============================================================================
# New Alarms — Memory & Disk (CW Agent custom metrics)
# =============================================================================

# CloudWatch Alarm - High Memory Utilization
resource "aws_cloudwatch_metric_alarm" "high_memory" {
  alarm_name          = "${local.name_prefix}-high-memory"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "mem_used_percent"
  namespace           = "ClasslaBackend"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Memory utilization > 85% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "missing"

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.main.name
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-high-memory-alarm"
    }
  )
}

# CloudWatch Alarm - High Disk Utilization
resource "aws_cloudwatch_metric_alarm" "high_disk" {
  alarm_name          = "${local.name_prefix}-high-disk"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "disk_used_percent"
  namespace           = "ClasslaBackend"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Disk utilization > 80% for 10 minutes"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]
  treat_missing_data  = "missing"

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.main.name
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-high-disk-alarm"
    }
  )
}

# =============================================================================
# Route 53 Health Check + Cross-Region Alarm (us-east-1)
# =============================================================================

resource "aws_route53_health_check" "api" {
  fqdn              = "api.classla.org"
  port               = 443
  type               = "HTTPS"
  resource_path      = "/health"
  failure_threshold  = 3
  request_interval   = 30

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-api-health-check"
    }
  )
}

# SNS topic in us-east-1 (required for Route 53 alarm)
resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-alerts-us-east-1"

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-alerts-us-east-1"
    }
  )
}

# Lambda in us-east-1 for Route 53 alarm notifications
resource "aws_iam_role" "discord_notifier_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name_prefix}-discord-notifier-ue1-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-discord-notifier-ue1-role"
    }
  )
}

resource "aws_iam_role_policy_attachment" "discord_notifier_logs_us_east_1" {
  provider   = aws.us_east_1
  role       = aws_iam_role.discord_notifier_us_east_1.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "discord_notifier_us_east_1" {
  provider         = aws.us_east_1
  function_name    = "${local.name_prefix}-discord-notifier-ue1"
  filename         = data.archive_file.discord_notifier.output_path
  source_code_hash = data.archive_file.discord_notifier.output_base64sha256
  handler          = "index.handler"
  runtime          = "python3.12"
  timeout          = 10
  role             = aws_iam_role.discord_notifier_us_east_1.arn

  environment {
    variables = {
      DISCORD_WEBHOOK_URL = var.discord_webhook_url
    }
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-discord-notifier-ue1"
    }
  )
}

resource "aws_lambda_permission" "sns_invoke_us_east_1" {
  provider      = aws.us_east_1
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.discord_notifier_us_east_1.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.alerts_us_east_1.arn
}

resource "aws_sns_topic_subscription" "discord_notifier_us_east_1" {
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.discord_notifier_us_east_1.arn
}

# CloudWatch Alarm for Route 53 health check (must be in us-east-1)
resource "aws_cloudwatch_metric_alarm" "api_health_check" {
  provider            = aws.us_east_1
  alarm_name          = "${local.name_prefix}-api-health-check"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "HealthCheckStatus"
  namespace           = "AWS/Route53"
  period              = 60
  statistic           = "Minimum"
  threshold           = 1
  alarm_description   = "Route 53 health check failed for api.classla.org"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
  ok_actions          = [aws_sns_topic.alerts_us_east_1.arn]

  dimensions = {
    HealthCheckId = aws_route53_health_check.api.id
  }

  tags = merge(
    local.common_tags,
    {
      Name = "${local.name_prefix}-api-health-check-alarm"
    }
  )
}
