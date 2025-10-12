# AWS Fargate Development Container

A production-ready Docker container for AWS Fargate featuring:

- **code-server** (VS Code in browser) on port 8080
- **TigerVNC + noVNC** for GUI applications on port 6080
- **IceWM** lightweight window manager
- **Bidirectional rclone S3 sync** (download on startup, push every 15 seconds)
- **IAM task role authentication** (no hardcoded credentials)
- **Non-root user** with restricted write access
- **Auto-shutdown** after 10 minutes of inactivity
- **Nix package manager** for Python/Java development environments
- Support for **Python GUI** (tkinter, pygame) and **Java GUI** (JavaFX, Swing)

## Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Building the Image](#building-the-image)
- [Local Testing](#local-testing)
- [AWS Fargate Deployment](#aws-fargate-deployment)
- [Environment Variables](#environment-variables)
- [Using Nix for Development](#using-nix-for-development)
- [Running GUI Applications](#running-gui-applications)
- [Security Considerations](#security-considerations)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Build the Image

```bash
docker build -t fargate-dev-container .
```

### Run Locally (with S3 sync disabled)

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e PASSWORD=mycode123 \
  -e VNC_PASSWORD=myvnc123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=false \
  --name dev-container \
  fargate-dev-container
```

Access:

- Code-Server: http://localhost:8080 (password: `mycode123`)
- noVNC Desktop: http://localhost:6080 (password: `myvnc123`)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Port 8080                Port 6080                          │
│  ┌──────────────┐        ┌──────────────┐                  │
│  │ code-server  │        │    noVNC     │                  │
│  │  (VS Code)   │        │  (Web VNC)   │                  │
│  └──────────────┘        └──────┬───────┘                  │
│                                  │                           │
│                          ┌───────▼────────┐                 │
│                          │   websockify   │                 │
│                          └───────┬────────┘                 │
│                                  │                           │
│                          ┌───────▼────────┐                 │
│                          │   TigerVNC     │                 │
│                          │   Display :1   │                 │
│                          └───────┬────────┘                 │
│                                  │                           │
│                          ┌───────▼────────┐                 │
│                          │     IceWM      │                 │
│                          │ Window Manager │                 │
│                          └────────────────┘                 │
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │             /workspace (user writable)              │    │
│  └─────────────────────┬──────────────────────────────┘    │
│                        │                                     │
│              ┌─────────▼──────────┐                         │
│              │  rclone sync loop  │                         │
│              │   (every 15s)      │                         │
│              └─────────┬──────────┘                         │
│                        │                                     │
│                        ▼                                     │
│                   AWS S3 Bucket                              │
│                 (IAM Task Role)                              │
│                                                               │
│  Background Services:                                        │
│  • Inactivity monitor (10 min timeout)                      │
│  • Nix package manager                                       │
└─────────────────────────────────────────────────────────────┘
```

### File Structure

```
/workspace/           # User workspace (synced to S3)
/home/user/.vnc/      # VNC configuration
/home/user/.icewm/    # IceWM configuration
/home/user/.config/rclone/  # Rclone configuration
/nix/                 # Nix package manager store
```

---

## Building the Image

### Standard Build

```bash
docker build -t fargate-dev-container:latest .
```

### Build with Custom Tag

```bash
docker build -t your-registry/fargate-dev-container:v1.0 .
```

### Multi-platform Build (for ARM)

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t fargate-dev-container:latest .
```

### Push to ECR

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag fargate-dev-container:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/fargate-dev-container:latest

# Push image
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/fargate-dev-container:latest
```

---

## Local Testing

### Test 1: Basic Functionality (No S3)

Test all services without S3 integration:

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e PASSWORD=testpass123 \
  -e VNC_PASSWORD=vnctest123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=false \
  --name dev-test \
  fargate-dev-container

# Check logs
docker logs dev-test

# Access the services
# Code-Server: http://localhost:8080
# noVNC: http://localhost:6080
```

**Verification Steps:**

1. Open http://localhost:8080 and log in with password `testpass123`
2. Create a Python file in /workspace
3. Open http://localhost:6080 and log in with password `vnctest123`
4. Open a terminal in VNC and run: `python3 --version`

### Test 2: With Local S3 (MinIO)

Test S3 sync functionality locally using MinIO:

```bash
# Start MinIO (local S3-compatible storage)
docker run -d \
  -p 9000:9000 \
  -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  --name minio \
  quay.io/minio/minio server /data --console-address ":9001"

# Create a test bucket in MinIO console: http://localhost:9001

# Run container with S3 sync (using access keys for local testing)
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e PASSWORD=testpass123 \
  -e VNC_PASSWORD=vnctest123 \
  -e S3_BUCKET=my-test-bucket \
  -e S3_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=minioadmin \
  -e AWS_SECRET_ACCESS_KEY=minioadmin \
  -e ENABLE_INACTIVITY_SHUTDOWN=false \
  --name dev-test \
  --link minio \
  fargate-dev-container
```

### Test 3: Test Python GUI (tkinter)

```bash
# Exec into container
docker exec -it dev-test su - user

# Create a test tkinter app
cat > /workspace/test_gui.py << 'EOF'
import tkinter as tk

root = tk.Tk()
root.title("Test GUI")
label = tk.Label(root, text="Hello from tkinter!")
label.pack()
button = tk.Button(root, text="Click me", command=root.quit)
button.pack()
root.mainloop()
EOF

# Run it (view in noVNC at http://localhost:6080)
export DISPLAY=:1
python3 /workspace/test_gui.py
```

### Test 4: Test Java GUI (Swing)

```bash
# Create a test Swing app
cat > /workspace/TestSwing.java << 'EOF'
import javax.swing.*;

public class TestSwing {
    public static void main(String[] args) {
        JFrame frame = new JFrame("Test Swing");
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.add(new JLabel("Hello from Swing!"));
        frame.setSize(300, 200);
        frame.setVisible(true);
    }
}
EOF

# Compile and run
export DISPLAY=:1
javac /workspace/TestSwing.java
java -cp /workspace TestSwing
```

### Test 5: Test Nix Package Manager

```bash
# Exec into container
docker exec -it dev-test su - user

# Install Python 3 with tkinter via Nix
nix-shell -p python3 python3Packages.tkinter

# Now you're in a Nix shell with Python and tkinter
python3 -c "import tkinter; print('Tkinter works!')"

# Install pygame via Nix
nix-shell -p python3 python3Packages.pygame

# Test it
python3 -c "import pygame; print('Pygame version:', pygame.version.ver)"
```

### Test 6: Inactivity Monitor

```bash
# Run with inactivity shutdown enabled (2 minute timeout for testing)
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e PASSWORD=testpass123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=true \
  --name inactivity-test \
  fargate-dev-container

# Watch logs - container should shut down after 10 minutes of no file changes
docker logs -f inactivity-test

# Create a file to reset the timer
docker exec inactivity-test touch /workspace/test.txt

# Watch logs again - timer should reset
```

---

## AWS Fargate Deployment

### Prerequisites

1. AWS Account with appropriate permissions
2. ECR repository created
3. ECS cluster created
4. S3 bucket created

### Step 1: Create IAM Task Role

The task role grants your container permissions to access S3.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-workspace-bucket",
        "arn:aws:s3:::your-workspace-bucket/*"
      ]
    }
  ]
}
```

Trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
```

### Step 2: Create ECS Task Definition

Create a file `task-definition.json`:

```json
{
  "family": "fargate-dev-container",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "executionRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/FargateDevContainerTaskRole",
  "containerDefinitions": [
    {
      "name": "dev-container",
      "image": "YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/fargate-dev-container:latest",
      "portMappings": [
        {
          "containerPort": 8080,
          "protocol": "tcp"
        },
        {
          "containerPort": 6080,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "S3_BUCKET",
          "value": "your-workspace-bucket"
        },
        {
          "name": "S3_REGION",
          "value": "us-east-1"
        },
        {
          "name": "ENABLE_INACTIVITY_SHUTDOWN",
          "value": "true"
        }
      ],
      "secrets": [
        {
          "name": "PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:dev-container-password"
        },
        {
          "name": "VNC_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:YOUR_ACCOUNT_ID:secret:dev-container-vnc-password"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/fargate-dev-container",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      }
    }
  ]
}
```

Register the task definition:

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 3: Create Application Load Balancer (Optional)

If you want to expose the services publicly:

```bash
# Create ALB
aws elbv2 create-load-balancer \
  --name fargate-dev-alb \
  --subnets subnet-xxxx subnet-yyyy \
  --security-groups sg-xxxx

# Create target groups for code-server and noVNC
aws elbv2 create-target-group \
  --name dev-code-server \
  --protocol HTTP \
  --port 8080 \
  --vpc-id vpc-xxxx \
  --target-type ip

aws elbv2 create-target-group \
  --name dev-novnc \
  --protocol HTTP \
  --port 6080 \
  --vpc-id vpc-xxxx \
  --target-type ip
```

### Step 4: Run ECS Service

```bash
aws ecs create-service \
  --cluster your-cluster-name \
  --service-name fargate-dev-container \
  --task-definition fargate-dev-container \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxxx,subnet-yyyy],securityGroups=[sg-xxxx],assignPublicIp=ENABLED}"
```

### Step 5: Access Your Container

Find the public IP of your task:

```bash
aws ecs describe-tasks \
  --cluster your-cluster-name \
  --tasks TASK_ARN \
  --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value' \
  --output text
```

Then access:

- Code-Server: http://PUBLIC_IP:8080
- noVNC: http://PUBLIC_IP:6080

---

## Environment Variables

| Variable                     | Required | Default                | Description                                              |
| ---------------------------- | -------- | ---------------------- | -------------------------------------------------------- |
| `PASSWORD`                   | No       | `code-server-password` | Password for code-server login                           |
| `VNC_PASSWORD`               | No       | `vncpassword`          | Password for VNC access                                  |
| `S3_BUCKET`                  | Yes\*    | -                      | S3 bucket name for workspace sync (required for S3 sync) |
| `S3_REGION`                  | No       | `us-east-1`            | AWS region for S3 bucket                                 |
| `ENABLE_INACTIVITY_SHUTDOWN` | No       | `true`                 | Enable auto-shutdown after 10 min of inactivity          |

\*Required only if you want S3 sync functionality

---

## Using Nix for Development

Nix is installed and ready to use for managing Python and Java development environments.

### Quick Nix Commands

```bash
# Install a package globally
nix-env -iA nixpkgs.python3

# Create a temporary shell with packages
nix-shell -p python3 python3Packages.pygame python3Packages.numpy

# Create a project-specific environment
cd /workspace/myproject
cat > shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python3
    python3Packages.tkinter
    python3Packages.pygame
    python3Packages.numpy
    openjdk
  ];
}
EOF

nix-shell  # Activates the environment
```

### Example: Python Development with Nix

```bash
# Create a Python project with specific packages
cd /workspace
mkdir my-python-project && cd my-python-project

# Create shell.nix with venv support
cat > shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    (python3.withPackages (ps: with ps; [
      pip
      tkinter
      virtualenv
    ]))
  ];
  shellHook = ''
    if [ ! -d ".venv" ]; then
      python -m venv .venv
    fi
    source .venv/bin/activate
    export PS1="$ "
  '';
}
EOF

# Enter the environment
nix-shell

# Now you can use pip normally (installs to .venv)
pip install requests flask
python3 -c "import requests, flask, tkinter; print('All packages available!')"
```

### Example: Java Development with Nix

```bash
# Create a Java project
cd /workspace
mkdir my-java-project && cd my-java-project

# Create shell.nix for Java development
cat > shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    openjdk17
    maven
    gradle
  ];
}
EOF

# Enter the environment
nix-shell

# Java, Maven, and Gradle are now available
java -version
mvn --version
```

---

## Running GUI Applications

All GUI applications run in the VNC session (accessible via noVNC at port 6080).

### Python GUI Applications

#### Tkinter Example

```bash
# Connect to container
docker exec -it dev-container su - user

# Set display
export DISPLAY=:1

# Create and run tkinter app
python3 << 'EOF'
import tkinter as tk
root = tk.Tk()
root.title("Hello Tkinter")
tk.Label(root, text="Running in Fargate!").pack()
tk.Button(root, text="Quit", command=root.quit).pack()
root.mainloop()
EOF
```

#### Pygame Example

```bash
# Install pygame via Nix
nix-shell -p python3Packages.pygame

# Create a pygame app
python3 << 'EOF'
import pygame
pygame.init()
screen = pygame.display.set_mode((640, 480))
pygame.display.set_caption("Pygame in Fargate")
running = True
while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False
    screen.fill((0, 128, 255))
    pygame.display.flip()
pygame.quit()
EOF
```

### Java GUI Applications

#### JavaFX Example

```bash
export DISPLAY=:1

cat > /workspace/HelloFX.java << 'EOF'
import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.control.Label;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;

public class HelloFX extends Application {
    @Override
    public void start(Stage stage) {
        String javaVersion = System.getProperty("java.version");
        Label l = new Label("Hello, JavaFX on Fargate! Java " + javaVersion);
        Scene scene = new Scene(new StackPane(l), 640, 480);
        stage.setScene(scene);
        stage.show();
    }

    public static void main(String[] args) {
        launch();
    }
}
EOF

javac --module-path /usr/share/openjfx/lib --add-modules javafx.controls HelloFX.java
java --module-path /usr/share/openjfx/lib --add-modules javafx.controls HelloFX
```

#### Swing Example

```bash
export DISPLAY=:1

cat > /workspace/HelloSwing.java << 'EOF'
import javax.swing.*;

public class HelloSwing {
    public static void main(String[] args) {
        SwingUtilities.invokeLater(() -> {
            JFrame frame = new JFrame("Hello Swing");
            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
            frame.add(new JLabel("Running on AWS Fargate!"));
            frame.setSize(400, 300);
            frame.setVisible(true);
        });
    }
}
EOF

javac HelloSwing.java
java HelloSwing
```

---

## Security Considerations

### Non-Root User

- Container runs as user `user` (UID 1000)
- Write access restricted to `/workspace` only
- Sudo access available but should be disabled in production

### Network Security

- Ports 8080 and 6080 should be behind authentication
- Use AWS Security Groups to restrict access
- Consider using AWS VPC for private networking
- Add SSL/TLS termination at the load balancer

### Secrets Management

- Never hardcode passwords in the Dockerfile
- Use AWS Secrets Manager for sensitive data
- Rotate passwords regularly

### S3 Security

- Use IAM task roles (never hardcode credentials)
- Apply principle of least privilege
- Enable S3 bucket versioning
- Consider S3 bucket encryption

### Recommendations for Production

1. Disable sudo access for user
2. Use AWS Secrets Manager for all passwords
3. Enable AWS CloudWatch logging
4. Implement network policies
5. Use private subnets with NAT gateway
6. Enable S3 bucket encryption and versioning
7. Set up AWS WAF if exposing publicly

---

## Troubleshooting

### Container Fails to Start

```bash
# Check logs
docker logs dev-container

# Common issues:
# 1. VNC already running - kill existing VNC: docker exec dev-container pkill -9 Xvnc
# 2. Port conflicts - check: netstat -tulpn | grep 8080
```

### VNC Not Accessible

```bash
# Check if VNC is running
docker exec dev-container ps aux | grep vnc

# Restart VNC
docker exec -u user dev-container vncserver -kill :1
docker exec -u user dev-container vncserver :1 -geometry 1920x1080 -depth 24
```

### S3 Sync Not Working

```bash
# Test IAM role (on Fargate)
docker exec dev-container curl http://169.254.170.2$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI

# Test rclone manually
docker exec -u user dev-container rclone lsd s3:your-bucket

# Check rclone logs
docker exec dev-container ps aux | grep rclone
```

### GUI Applications Not Displaying

```bash
# Verify DISPLAY is set
docker exec dev-container echo $DISPLAY

# Should output: :1

# Test X server
docker exec dev-container xdpyinfo -display :1

# If fails, restart VNC (see above)
```

### Nix Commands Not Found

```bash
# Source Nix environment
docker exec -it dev-container bash
source /etc/profile.d/nix.sh

# Verify Nix works
nix-env --version
```

### High Memory Usage

```bash
# Check memory usage
docker stats dev-container

# Clear Nix store (frees space)
docker exec dev-container nix-collect-garbage -d

# Restart container with more memory
docker run --memory=8g ...
```

### Inactivity Monitor Not Working

```bash
# Check if monitor is running
docker exec dev-container ps aux | grep inactivity-monitor

# Check logs
docker logs dev-container | grep inactivity

# Disable for debugging
docker run -e ENABLE_INACTIVITY_SHUTDOWN=false ...
```

---

## Performance Tuning

### Fargate Task Sizing

Recommended configurations:

**Light Usage** (browsing, editing):

- CPU: 1024 (1 vCPU)
- Memory: 2048 MB

**Medium Usage** (GUI apps, compilation):

- CPU: 2048 (2 vCPU)
- Memory: 4096 MB

**Heavy Usage** (data science, large builds):

- CPU: 4096 (4 vCPU)
- Memory: 8192 MB

### Rclone Optimization

Modify sync frequency in `rclone-sync-loop.sh`:

```bash
# Change from 15 seconds to 60 seconds
sleep 60
```

### Reduce Image Size

The current image is ~3GB. To reduce:

1. Remove unnecessary packages
2. Use multi-stage builds
3. Clear apt cache: `rm -rf /var/lib/apt/lists/*`

---

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review Docker logs: `docker logs dev-container`
3. Check AWS CloudWatch logs for Fargate deployments

---

## License

This project is provided as-is for use with AWS Fargate.
