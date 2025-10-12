#!/bin/bash

# destroy.sh
# Script to destroy infrastructure using Terraform

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
TERRAFORM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"
ENVIRONMENT="${1:-}"
AUTO_APPROVE="${AUTO_APPROVE:-false}"

# Function to display usage
usage() {
    echo "Usage: $0 [environment] [options]"
    echo ""
    echo "Arguments:"
    echo "  environment    Environment to destroy (dev, prod, or path to .tfvars file)"
    echo ""
    echo "Options:"
    echo "  AUTO_APPROVE=true    Skip interactive approval (use with caution)"
    echo ""
    echo "Examples:"
    echo "  $0 dev                          # Destroy dev environment"
    echo "  $0 prod                         # Destroy prod environment"
    echo "  AUTO_APPROVE=true $0 dev        # Destroy dev without confirmation"
    echo ""
    exit 1
}

# Check if environment is provided
if [ -z "$ENVIRONMENT" ]; then
    echo -e "${RED}Error: Environment not specified${NC}"
    usage
fi

echo -e "${RED}=== Terraform Destroy ===${NC}"
echo -e "${RED}⚠ WARNING: This will destroy all infrastructure!${NC}"
echo "Environment: $ENVIRONMENT"
echo "Terraform Directory: $TERRAFORM_DIR"
echo ""

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Error: Terraform is not installed${NC}"
    echo "Please install Terraform: https://www.terraform.io/downloads"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    echo "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials are not configured${NC}"
    echo "Please run: aws configure"
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
echo -e "${GREEN}✓ AWS credentials configured${NC}"
echo "  Account: $AWS_ACCOUNT"
echo "  User: $AWS_USER"

# Change to Terraform directory
cd "$TERRAFORM_DIR"

# Determine tfvars file
TFVARS_FILE=""
if [ -f "$ENVIRONMENT" ]; then
    # Full path provided
    TFVARS_FILE="$ENVIRONMENT"
elif [ -f "environments/${ENVIRONMENT}.tfvars" ]; then
    # Environment name provided
    TFVARS_FILE="environments/${ENVIRONMENT}.tfvars"
else
    echo -e "${YELLOW}⚠ No tfvars file found for environment: $ENVIRONMENT${NC}"
    echo "Proceeding without environment-specific variables..."
fi

# Initialize Terraform
echo ""
echo -e "${BLUE}Initializing Terraform...${NC}"
terraform init || {
    echo -e "${RED}Error: Terraform initialization failed${NC}"
    exit 1
}
echo -e "${GREEN}✓ Terraform initialized${NC}"

# Show current state
echo ""
echo -e "${BLUE}Current infrastructure:${NC}"
terraform show -no-color | head -n 50
echo ""

# Create destroy plan
echo ""
echo -e "${BLUE}Creating destroy plan...${NC}"
PLAN_FILE="destroy-plan-$(date +%Y%m%d-%H%M%S)"

if [ -n "$TFVARS_FILE" ]; then
    terraform plan -destroy -var-file="$TFVARS_FILE" -out="$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform destroy plan failed${NC}"
        exit 1
    }
else
    terraform plan -destroy -out="$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform destroy plan failed${NC}"
        exit 1
    }
fi

echo -e "${GREEN}✓ Destroy plan created: $PLAN_FILE${NC}"

# Confirm destruction
echo ""
if [ "$AUTO_APPROVE" = "true" ]; then
    echo -e "${RED}⚠ Auto-approve enabled, destroying infrastructure...${NC}"
    terraform apply "$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform destroy failed${NC}"
        rm -f "$PLAN_FILE"
        exit 1
    }
else
    echo -e "${RED}⚠ WARNING: This action cannot be undone!${NC}"
    echo -e "${BLUE}Review the destroy plan above.${NC}"
    echo ""
    read -p "Type 'destroy' to confirm destruction: " -r
    echo
    if [[ $REPLY = "destroy" ]]; then
        terraform apply "$PLAN_FILE" || {
            echo -e "${RED}Error: Terraform destroy failed${NC}"
            rm -f "$PLAN_FILE"
            exit 1
        }
    else
        echo -e "${YELLOW}Destruction cancelled${NC}"
        rm -f "$PLAN_FILE"
        exit 0
    fi
fi

# Clean up plan file
rm -f "$PLAN_FILE"

echo ""
echo -e "${GREEN}=== Infrastructure Destroyed ===${NC}"
echo ""
echo -e "${YELLOW}Note: The following resources may need manual cleanup:${NC}"
echo "1. S3 buckets (if not empty)"
echo "2. ECR images"
echo "3. CloudWatch log groups (if retention is set)"
echo "4. Secrets Manager secrets (if recovery window is set)"
echo "5. Terraform state in S3 (if you want to remove it)"
echo ""
echo -e "${BLUE}To remove Terraform backend resources:${NC}"
echo "  aws s3 rb s3://classla-terraform-state --force"
echo "  aws dynamodb delete-table --table-name classla-terraform-locks"
