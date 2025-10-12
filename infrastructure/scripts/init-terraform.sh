#!/bin/bash

# init-terraform.sh
# Script to initialize Terraform backend (S3 bucket and DynamoDB table)

set -e  # Exit on error
set -u  # Exit on undefined variable

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BUCKET_NAME="${TERRAFORM_STATE_BUCKET:-classla-terraform-state}"
DYNAMODB_TABLE="${TERRAFORM_LOCK_TABLE:-classla-terraform-locks}"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo -e "${GREEN}=== Terraform Backend Initialization ===${NC}"
echo "Bucket: $BUCKET_NAME"
echo "DynamoDB Table: $DYNAMODB_TABLE"
echo "Region: $AWS_REGION"
echo ""

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

echo -e "${GREEN}✓ AWS CLI configured${NC}"

# Create S3 bucket for Terraform state
echo ""
echo "Creating S3 bucket for Terraform state..."

if aws s3 ls "s3://$BUCKET_NAME" 2>&1 | grep -q 'NoSuchBucket'; then
    # Bucket doesn't exist, create it
    if [ "$AWS_REGION" = "us-east-1" ]; then
        aws s3api create-bucket \
            --bucket "$BUCKET_NAME" \
            --region "$AWS_REGION" || {
            echo -e "${RED}Error: Failed to create S3 bucket${NC}"
            exit 1
        }
    else
        aws s3api create-bucket \
            --bucket "$BUCKET_NAME" \
            --region "$AWS_REGION" \
            --create-bucket-configuration LocationConstraint="$AWS_REGION" || {
            echo -e "${RED}Error: Failed to create S3 bucket${NC}"
            exit 1
        }
    fi
    echo -e "${GREEN}✓ S3 bucket created: $BUCKET_NAME${NC}"
else
    echo -e "${YELLOW}⚠ S3 bucket already exists: $BUCKET_NAME${NC}"
fi

# Enable versioning on the bucket
echo "Enabling versioning on S3 bucket..."
aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled || {
    echo -e "${RED}Error: Failed to enable versioning${NC}"
    exit 1
}
echo -e "${GREEN}✓ Versioning enabled${NC}"

# Enable encryption on the bucket
echo "Enabling encryption on S3 bucket..."
aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }' || {
    echo -e "${RED}Error: Failed to enable encryption${NC}"
    exit 1
}
echo -e "${GREEN}✓ Encryption enabled${NC}"

# Block public access
echo "Blocking public access to S3 bucket..."
aws s3api put-public-access-block \
    --bucket "$BUCKET_NAME" \
    --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" || {
    echo -e "${RED}Error: Failed to block public access${NC}"
    exit 1
}
echo -e "${GREEN}✓ Public access blocked${NC}"

# Create DynamoDB table for state locking
echo ""
echo "Creating DynamoDB table for state locking..."

if aws dynamodb describe-table --table-name "$DYNAMODB_TABLE" --region "$AWS_REGION" &> /dev/null; then
    echo -e "${YELLOW}⚠ DynamoDB table already exists: $DYNAMODB_TABLE${NC}"
else
    aws dynamodb create-table \
        --table-name "$DYNAMODB_TABLE" \
        --attribute-definitions AttributeName=LockID,AttributeType=S \
        --key-schema AttributeName=LockID,KeyType=HASH \
        --billing-mode PAY_PER_REQUEST \
        --region "$AWS_REGION" || {
        echo -e "${RED}Error: Failed to create DynamoDB table${NC}"
        exit 1
    }
    
    echo "Waiting for DynamoDB table to be active..."
    aws dynamodb wait table-exists \
        --table-name "$DYNAMODB_TABLE" \
        --region "$AWS_REGION" || {
        echo -e "${RED}Error: DynamoDB table creation timeout${NC}"
        exit 1
    }
    
    echo -e "${GREEN}✓ DynamoDB table created: $DYNAMODB_TABLE${NC}"
fi

# Summary
echo ""
echo -e "${GREEN}=== Initialization Complete ===${NC}"
echo ""
echo "Backend configuration for terraform/backend.tf:"
echo ""
echo "terraform {"
echo "  backend \"s3\" {"
echo "    bucket         = \"$BUCKET_NAME\""
echo "    key            = \"infrastructure/terraform.tfstate\""
echo "    region         = \"$AWS_REGION\""
echo "    encrypt        = true"
echo "    dynamodb_table = \"$DYNAMODB_TABLE\""
echo "  }"
echo "}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Update infrastructure/terraform/backend.tf with the above configuration"
echo "2. Run: cd infrastructure/terraform && terraform init"
echo "3. Run: ./scripts/deploy.sh to deploy infrastructure"
