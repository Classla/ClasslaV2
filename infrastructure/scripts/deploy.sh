#!/bin/bash

# deploy.sh
# Script to deploy infrastructure using Terraform

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
    echo "  environment    Environment to deploy (dev, prod, or path to .tfvars file)"
    echo ""
    echo "Options:"
    echo "  AUTO_APPROVE=true    Skip interactive approval (use with caution)"
    echo ""
    echo "Examples:"
    echo "  $0 dev                          # Deploy dev environment"
    echo "  $0 prod                         # Deploy prod environment"
    echo "  AUTO_APPROVE=true $0 dev        # Deploy dev without confirmation"
    echo ""
    exit 1
}

# Check if environment is provided
if [ -z "$ENVIRONMENT" ]; then
    echo -e "${RED}Error: Environment not specified${NC}"
    usage
fi

echo -e "${BLUE}=== Terraform Deployment ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Terraform Directory: $TERRAFORM_DIR"
echo ""

# Check if Terraform is installed
if ! command -v terraform &> /dev/null; then
    echo -e "${RED}Error: Terraform is not installed${NC}"
    echo "Please install Terraform: https://www.terraform.io/downloads"
    exit 1
fi

echo -e "${GREEN}✓ Terraform installed: $(terraform version -json | grep -o '"terraform_version":"[^"]*' | cut -d'"' -f4)${NC}"

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
terraform init -upgrade || {
    echo -e "${RED}Error: Terraform initialization failed${NC}"
    exit 1
}
echo -e "${GREEN}✓ Terraform initialized${NC}"

# Validate Terraform configuration
echo ""
echo -e "${BLUE}Validating Terraform configuration...${NC}"
terraform validate || {
    echo -e "${RED}Error: Terraform validation failed${NC}"
    exit 1
}
echo -e "${GREEN}✓ Terraform configuration valid${NC}"

# Format check
echo ""
echo -e "${BLUE}Checking Terraform formatting...${NC}"
if ! terraform fmt -check -recursive; then
    echo -e "${YELLOW}⚠ Terraform files are not formatted${NC}"
    echo "Run 'terraform fmt -recursive' to fix formatting"
fi

# Create plan
echo ""
echo -e "${BLUE}Creating Terraform plan...${NC}"
PLAN_FILE="tfplan-$(date +%Y%m%d-%H%M%S)"

if [ -n "$TFVARS_FILE" ]; then
    terraform plan -var-file="$TFVARS_FILE" -out="$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform plan failed${NC}"
        exit 1
    }
else
    terraform plan -out="$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform plan failed${NC}"
        exit 1
    }
fi

echo -e "${GREEN}✓ Terraform plan created: $PLAN_FILE${NC}"

# Apply plan
echo ""
if [ "$AUTO_APPROVE" = "true" ]; then
    echo -e "${YELLOW}⚠ Auto-approve enabled, applying changes...${NC}"
    terraform apply "$PLAN_FILE" || {
        echo -e "${RED}Error: Terraform apply failed${NC}"
        rm -f "$PLAN_FILE"
        exit 1
    }
else
    echo -e "${BLUE}Review the plan above.${NC}"
    read -p "Do you want to apply these changes? (yes/no): " -r
    echo
    if [[ $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        terraform apply "$PLAN_FILE" || {
            echo -e "${RED}Error: Terraform apply failed${NC}"
            rm -f "$PLAN_FILE"
            exit 1
        }
    else
        echo -e "${YELLOW}Deployment cancelled${NC}"
        rm -f "$PLAN_FILE"
        exit 0
    fi
fi

# Clean up plan file
rm -f "$PLAN_FILE"

# Display outputs
echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo ""
echo -e "${BLUE}Terraform Outputs:${NC}"
terraform output

echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Note the ALB DNS name from outputs"
echo "2. Update Secrets Manager with application secrets"
echo "3. Deploy backend application to ECR"
echo "4. Configure Amplify environment variables"
echo "5. Verify health check endpoint: http://<alb-dns>/health"
