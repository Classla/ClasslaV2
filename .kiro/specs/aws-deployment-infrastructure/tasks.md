# Implementation Plan

- [x] 1. Set up project structure and .gitignore

  - Create infrastructure directory structure with Terraform modules
  - Configure .gitignore for Terraform state files and build artifacts
  - Create example configuration files
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 2. Create Terraform backend configuration

  - Write backend.tf for S3 state storage and DynamoDB locking
  - Write versions.tf with required provider versions
  - Create initialization script for setting up S3 bucket and DynamoDB table
  - _Requirements: 3.6_

- [x] 3. Implement VPC and networking module

  - Create VPC with CIDR 10.0.0.0/16
  - Configure Internet Gateway
  - Set up public subnets (2 AZs) with route tables
  - Set up private subnets (2 AZs) with route tables
  - Create NAT Gateways in each AZ
  - Configure VPC endpoints for S3 and ECR
  - _Requirements: 8.1, 8.2, 8.5_

- [x] 4. Implement ECR module

  - Create ECR repository for backend Docker images
  - Configure lifecycle policy to keep last 10 images
  - Enable image scanning on push
  - Set up repository policies for ECS access
  - _Requirements: 5.2, 5.3_

- [x] 5. Implement Secrets Manager module

  - Create secret for Supabase credentials (URL, anon key, service role key)
  - Create secret for WorkOS credentials (API key, client ID)
  - Create secret for application secrets (session secret)
  - Configure IAM policies for ECS task access
  - _Requirements: 7.1, 7.2, 7.4_

- [x] 6. Implement ECS module

  - Create ECS cluster
  - Write task definition with container configuration
  - Configure task definition to pull secrets from Secrets Manager
  - Set up CloudWatch Logs group for ECS tasks
  - Create IAM roles (task execution role and task role)
  - Configure ECS service with desired count of 1
  - Set up auto-scaling policies (CPU 70%, memory 80%, max 2 tasks)
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 7.2_

- [x] 7. Implement ALB module

  - Create Application Load Balancer in public subnets
  - Configure target group for ECS tasks (port 3001, /health check)
  - Set up HTTP listener (port 80) with redirect to HTTPS
  - Set up HTTPS listener (port 443) with ACM certificate
  - Configure idle timeout to 3600 seconds for WebSocket support
  - Enable connection stickiness for WebSocket
  - Create security groups (allow 80/443 inbound, 3001 to ECS outbound)
  - _Requirements: 1.2, 8.4_

- [x] 8. Implement Amplify module

  - Create Amplify app connected to GitHub repository
  - Configure build settings for Vite (classla-frontend directory)
  - Set up environment variables (VITE_API_URL, VITE_WORKOS_CLIENT_ID)
  - Configure automatic deployments on main branch push
  - _Requirements: 2.1, 2.2, 2.3, 2.4_

- [x] 9. Create main Terraform configuration

  - Write main.tf that orchestrates all modules
  - Define input variables in variables.tf
  - Create outputs.tf for ALB DNS, Amplify URL, ECR repository
  - Create terraform.tfvars.example with placeholder values
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 10. Create backend Dockerfile

  - Write multi-stage Dockerfile for Express.js application
  - Configure build stage with TypeScript compilation
  - Set up production stage with minimal dependencies
  - Add health check configuration
  - Create .dockerignore file
  - _Requirements: 5.2_

- [x] 11. Create GitHub Actions workflow for backend CI/CD

  - Write workflow to trigger on push to main branch
  - Add job to build Docker image
  - Configure AWS credentials from GitHub secrets
  - Push image to ECR with git SHA tag
  - Update ECS service to deploy new image
  - Add build failure notifications
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 12. Create deployment scripts

  - Write init-terraform.sh to set up S3 and DynamoDB
  - Write deploy.sh for terraform plan and apply
  - Write destroy.sh for infrastructure teardown
  - Make scripts executable and add error handling
  - _Requirements: 3.2_

- [x] 13. Create AWS setup documentation

  - Write SETUP.md with AWS account creation steps
  - Document AWS CLI installation and configuration
  - Document Terraform installation instructions
  - List required IAM permissions and policies
  - Explain GitHub Actions AWS credentials setup
  - Document Amplify GitHub connection process
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

- [x] 14. Create deployment documentation

  - Write DEPLOYMENT.md with step-by-step deployment instructions
  - Document how to initialize Terraform backend
  - Explain terraform plan and apply process
  - Document how to configure secrets in Secrets Manager
  - Include verification steps after deployment
  - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 15. Create configuration reference documentation

  - Write CONFIGURATION.md listing all required environment variables
  - Document all Terraform variables and their purposes
  - List all secrets that need to be configured
  - Include troubleshooting section for common issues
  - _Requirements: 12.2, 12.3, 12.5_

- [ ] 16. Set up monitoring and logging

  - Configure CloudWatch Logs retention (90 days)
  - Enable ALB access logs to S3
  - Create CloudWatch alarms for ECS task failures
  - Create CloudWatch alarms for ALB 5xx errors
  - Create CloudWatch alarms for ECS CPU/memory thresholds
  - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [ ] 17. Implement security best practices

  - Configure security groups with least-privilege rules
  - Enable encryption for S3 buckets (logs, Terraform state)
  - Ensure Secrets Manager encryption is enabled
  - Configure HTTPS-only access for ALB
  - _Requirements: 8.3, 8.4_

- [ ] 18. Create environment-specific configurations

  - Create dev.tfvars for development environment
  - Create prod.tfvars for production environment
  - Document differences between environments
  - _Requirements: 3.2_

- [ ] 19. Test and validate infrastructure

  - Run terraform validate on all modules
  - Test deployment to development environment
  - Verify health check endpoint responds
  - Test WebSocket connections through ALB
  - Verify auto-scaling triggers correctly
  - Test rollback procedures
  - _Requirements: 1.2, 1.3, 1.4_

- [ ] 20. Final integration and documentation review
  - Verify all documentation is complete and accurate
  - Test complete deployment from scratch
  - Verify CI/CD pipeline works end-to-end
  - Update README with links to documentation
  - _Requirements: 12.1, 12.4, 12.5_
