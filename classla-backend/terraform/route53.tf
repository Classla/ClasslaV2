# Route 53 Record for ACM Certificate Validation
resource "aws_route53_record" "cert_validation" {
  zone_id = "Z0480716307E1IZ2NK9UZ"  # classla.org hosted zone
  name    = "_11425ba1d9c61cbd78f005ba9fb2aae3.api.classla.org"
  type    = "CNAME"
  ttl     = 300
  records = ["_d7285363443b3cbc574dde0ac5e8936e.jkddzztszm.acm-validations.aws."]
}

# Route 53 Record for api.classla.org pointing to ALB
resource "aws_route53_record" "api" {
  zone_id = "Z0480716307E1IZ2NK9UZ"  # classla.org hosted zone
  name    = "api.classla.org"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

