# GitHub Actions Workflows

## Backend CI/CD Workflow

The `backend-deploy.yml` workflow automates the build and deployment of the Express.js backend to AWS ECS.

### Trigger

The workflow triggers on:

- Push to `main` branch
- Changes to files in `classla-backend/**`
- Changes to the workflow file itself

### Required GitHub Secrets

Before the workflow can run, you need to configure the following secrets in your GitHub repository:

1. **AWS_ACCESS_KEY_ID**: AWS access key with permissions to:

   - Push images to ECR
   - Update ECS task definitions
   - Deploy to ECS services
   - Describe ECS resources

2. **AWS_SECRET_ACCESS_KEY**: AWS secret access key corresponding to the access key ID

### Setting Up GitHub Secrets

1. Go to your GitHub repository
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Add each secret with the appropriate value

### IAM Permissions Required

The AWS user/role needs the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition",
        "ecs:RegisterTaskDefinition",
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["iam:PassRole"],
      "Resource": [
        "arn:aws:iam::*:role/ecsTaskExecutionRole",
        "arn:aws:iam::*:role/ecsTaskRole"
      ]
    }
  ]
}
```

### Workflow Steps

1. **Checkout code**: Clones the repository
2. **Configure AWS credentials**: Sets up AWS CLI with provided secrets
3. **Login to ECR**: Authenticates Docker with Amazon ECR
4. **Build Docker image**: Builds the backend image with git SHA and latest tags
5. **Push to ECR**: Pushes both tagged images to ECR
6. **Download task definition**: Gets the current ECS task definition
7. **Update task definition**: Updates the task definition with the new image
8. **Deploy to ECS**: Deploys the new task definition and waits for stability
9. **Notify**: Outputs success or failure message

### Customization

You can customize the workflow by modifying these environment variables:

- `AWS_REGION`: AWS region (default: us-east-1)
- `ECR_REPOSITORY`: ECR repository name (default: classla-backend)
- `ECS_CLUSTER`: ECS cluster name (default: classla-cluster)
- `ECS_SERVICE`: ECS service name (default: classla-backend-service)

### Troubleshooting

**Build fails:**

- Check that the Dockerfile path is correct
- Verify all dependencies are properly specified in package.json

**Push to ECR fails:**

- Verify AWS credentials are correct
- Check that the ECR repository exists
- Ensure IAM permissions include ECR access

**ECS deployment fails:**

- Verify ECS cluster and service names are correct
- Check that the task definition container name matches
- Ensure IAM permissions include ECS access
- Review ECS service logs in CloudWatch

**Deployment hangs:**

- Check ECS service health checks
- Verify the new tasks are starting successfully
- Review CloudWatch logs for application errors
