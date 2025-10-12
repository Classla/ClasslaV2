# Networking Module

This module creates a VPC with public and private subnets across multiple availability zones, along with NAT gateways and VPC endpoints for cost optimization.

## Features

- VPC with configurable CIDR block (default: 10.0.0.0/16)
- Internet Gateway for public subnet internet access
- Public subnets (2 AZs) with route tables
- Private subnets (2 AZs) for ECS tasks
- NAT Gateways in each AZ for high availability (or single NAT for cost optimization)
- VPC endpoints for S3 and ECR to reduce NAT gateway costs
- Proper tagging for resource management

## Usage

```hcl
module "networking" {
  source = "./modules/networking"

  project_name       = "classla"
  environment        = "prod"
  aws_region         = "us-east-1"
  availability_zones = ["us-east-1a", "us-east-1b"]

  vpc_cidr             = "10.0.0.0/16"
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = false  # Set to true for dev to save costs
  enable_vpc_endpoints = true

  tags = {
    Project = "Classla LMS"
    ManagedBy = "Terraform"
  }
}
```

## Inputs

| Name                 | Description                                | Type         | Default                          | Required |
| -------------------- | ------------------------------------------ | ------------ | -------------------------------- | -------- |
| project_name         | Project name for resource naming           | string       | -                                | yes      |
| environment          | Environment name (dev, staging, prod)      | string       | -                                | yes      |
| aws_region           | AWS region                                 | string       | -                                | yes      |
| availability_zones   | List of availability zones                 | list(string) | -                                | yes      |
| vpc_cidr             | CIDR block for VPC                         | string       | "10.0.0.0/16"                    | no       |
| public_subnet_cidrs  | CIDR blocks for public subnets             | list(string) | ["10.0.1.0/24", "10.0.2.0/24"]   | no       |
| private_subnet_cidrs | CIDR blocks for private subnets            | list(string) | ["10.0.11.0/24", "10.0.12.0/24"] | no       |
| enable_nat_gateway   | Enable NAT Gateway for private subnets     | bool         | true                             | no       |
| single_nat_gateway   | Use single NAT Gateway (cost optimization) | bool         | false                            | no       |
| enable_vpc_endpoints | Enable VPC endpoints for S3 and ECR        | bool         | true                             | no       |
| tags                 | Additional tags for resources              | map(string)  | {}                               | no       |

## Outputs

| Name                            | Description                            |
| ------------------------------- | -------------------------------------- |
| vpc_id                          | ID of the VPC                          |
| vpc_cidr                        | CIDR block of the VPC                  |
| public_subnet_ids               | IDs of public subnets                  |
| private_subnet_ids              | IDs of private subnets                 |
| nat_gateway_ids                 | IDs of NAT Gateways                    |
| nat_gateway_ips                 | Elastic IPs of NAT Gateways            |
| internet_gateway_id             | ID of the Internet Gateway             |
| s3_vpc_endpoint_id              | ID of the S3 VPC endpoint              |
| ecr_api_vpc_endpoint_id         | ID of the ECR API VPC endpoint         |
| ecr_dkr_vpc_endpoint_id         | ID of the ECR Docker VPC endpoint      |
| vpc_endpoints_security_group_id | ID of the VPC endpoints security group |

## Architecture

```
VPC (10.0.0.0/16)
├── Public Subnets (2 AZs)
│   ├── 10.0.1.0/24 (AZ-a)
│   ├── 10.0.2.0/24 (AZ-b)
│   ├── NAT Gateway (AZ-a)
│   ├── NAT Gateway (AZ-b)
│   └── Internet Gateway
│
└── Private Subnets (2 AZs)
    ├── 10.0.11.0/24 (AZ-a) - ECS Tasks
    └── 10.0.12.0/24 (AZ-b) - ECS Tasks
```

## Cost Optimization

- **VPC Endpoints**: S3 and ECR endpoints reduce NAT gateway data transfer costs
- **Single NAT Gateway**: For dev environments, set `single_nat_gateway = true` to use one NAT gateway instead of two (~$32/month savings)
- **NAT Gateway Placement**: NAT gateways are in public subnets with Elastic IPs

## Security

- Private subnets have no direct internet access
- NAT gateways provide outbound internet access for private subnets
- VPC endpoints use security groups to control access
- All resources are properly tagged for auditing
