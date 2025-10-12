# Terraform Backend Configuration
# This configures S3 for state storage and DynamoDB for state locking
# Run the init-terraform.sh script before using this backend

terraform {
  backend "s3" {
    bucket         = "classla-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "classla-terraform-locks"

    # Prevent accidental deletion of state
    # Enable versioning on the S3 bucket for state history
  }
}
