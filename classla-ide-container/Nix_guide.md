# Nix Package Manager Guide

## What is Nix?

Nix is a **package manager** that lets you install programming languages and tools without root access, in isolated environments that don't conflict with each other.

Think of it like:

- **Python virtualenv** - but for ANY language
- **Docker** - but lighter weight (just packages, not full containers)
- **Language version managers** (nvm, pyenv, rbenv) - but unified for all languages

## Why Nix in This Container?

The container has a **base system** installed via apt (Python 3.10, Java, etc.), but you might need:

- Different Python versions (3.8, 3.11, 3.12)
- Different Node.js versions (16, 18, 20)
- Specific packages not in apt
- Multiple versions side-by-side

**Nix solves this!** It lets you specify exactly what you need without messing up the base system.

---

## How It Works in This Container

### Method 1: Automatic Setup via Environment Variables (Easiest!)

When you start the container, you can specify the language and version you want:

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e LANGUAGE=python \
  -e PYTHON_VERSION=311 \
  -e VNC_PASSWORD=mysecret \
  --name dev-container \
  fargate-dev-container
```

**What happens:**

1. Container starts
2. Reads `LANGUAGE=python` and `PYTHON_VERSION=311`
3. Creates a Nix configuration file at `/home/user/.nix-shell.nix`
4. This file specifies Python 3.11 with tkinter support

**To use it:**

```bash
# SSH into container
docker exec -it dev-container su - user

# Activate the Nix environment
nix-shell ~/.nix-shell.nix

# Now you're in a shell with Python 3.11!
python3 --version  # Shows: Python 3.11.x
```

---

## Supported Languages and Versions

### Python

```bash
# Environment variable format
-e LANGUAGE=python
-e PYTHON_VERSION=310  # Options: 310, 311, 312 (use 310 for tkinter compatibility)

# What you get:
# - Python at the specified version
# - pip (works via automatic virtual environment)
# - tkinter (for GUI apps - works best with Python 3.10)
# - virtualenv

# Usage in container:
# Venv auto-activates in terminals
# Just use pip normally:
python3 --version
pip install requests  # Works! Installs to /workspace/.venv
python3 -c "import tkinter"  # Works! Tkinter is available

# Note: For tkinter, use PYTHON_VERSION=310 to match system python3-tk
```

### Node.js

```bash
# Environment variable format
-e LANGUAGE=nodejs
-e NODE_VERSION=18  # Options: 16, 18, 20, 21

# What you get:
# - Node.js at the specified version
# - npm
# - yarn

# Usage in container:
nix-shell ~/.nix-shell.nix
node --version
npm install express
```

### Java

```bash
# Environment variable format
-e LANGUAGE=java
-e JAVA_VERSION=17  # Options: 8, 11, 17, 21

# What you get:
# - JDK at the specified version
# - Maven
# - Gradle

# Usage in container:
nix-shell ~/.nix-shell.nix
java -version
mvn --version
```

### Go

```bash
# Environment variable format
-e LANGUAGE=go
-e GO_VERSION=121  # Options: 120, 121, 122

# What you get:
# - Go compiler at the specified version

# Usage in container:
nix-shell ~/.nix-shell.nix
go version
```

### Rust

```bash
# Environment variable format
-e LANGUAGE=rust
# No version option - uses latest stable

# What you get:
# - rustc (Rust compiler)
# - cargo (Rust package manager)
# - rustfmt (code formatter)

# Usage in container:
nix-shell ~/.nix-shell.nix
cargo --version
```

---

## Method 2: Manual Nix Usage (For Ad-Hoc Needs)

You can use Nix directly without setting environment variables.

### Quick Package Installation

```bash
# One-time shell with packages
nix-shell -p python311 python311Packages.requests

# Now you're in a temporary shell with Python 3.11 and requests
python3 --version
python3 -c "import requests; print('Works!')"

# Exit shell - packages are gone
exit
```

### Creating Custom Environment Files

```bash
# Create a project-specific environment
cd /workspace/myproject

# Create shell.nix
cat > shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python311
    python311Packages.flask
    python311Packages.requests
    python311Packages.sqlalchemy
    postgresql
  ];
}
EOF

# Activate this environment
nix-shell

# Now you have Python 3.11, Flask, requests, SQLAlchemy, and PostgreSQL!
python3 -c "import flask; print('Flask available!')"
psql --version
```

---

## How the Nix Configuration File Works

When you set `LANGUAGE=python PYTHON_VERSION=311`, the container creates this file at `/home/user/.nix-shell.nix`:

```nix
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python311
  ];
  shellHook = ''
    # Create and activate a virtual environment for pip installs
    # Use --system-site-packages to access system tkinter
    if [ ! -d "/workspace/.venv" ]; then
      echo "Creating Python virtual environment..."
      python -m venv /workspace/.venv --system-site-packages
    fi
    source /workspace/.venv/bin/activate
    export PS1="$ "
  '';
}
```

**Breaking it down:**

- `pkgs.mkShell` - Creates a shell environment
- `python311` - Python 3.11 from Nix (specific version)
- `shellHook` - Script that runs when entering the shell
  - Creates a virtual environment in `/workspace/.venv`
  - Uses `--system-site-packages` to access system tkinter (from apt)
  - Activates it automatically
  - Sets prompt to just `$`

**To use it:**

```bash
nix-shell ~/.nix-shell.nix
```

This command:

1. Reads the configuration
2. Downloads Python 3.11 from Nix (if not cached)
3. Creates/activates a venv in /workspace/.venv with system packages
4. Puts you in a shell where pip works normally
5. Tkinter is available from system (python3-tk installed via apt)

---

## Real-World Examples

### Example 1: Python Data Science Project

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e LANGUAGE=python \
  -e PYTHON_VERSION=311 \
  --name dev-container \
  fargate-dev-container

# In container:
nix-shell ~/.nix-shell.nix
pip install pandas numpy matplotlib jupyter
jupyter notebook --no-browser --ip=0.0.0.0
```

### Example 2: Node.js Web Development

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e LANGUAGE=nodejs \
  -e NODE_VERSION=18 \
  --name dev-container \
  fargate-dev-container

# In container:
nix-shell ~/.nix-shell.nix
npm install express
node server.js
```

### Example 3: Multiple Languages in One Container

```bash
# Start without specific language
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  --name dev-container \
  fargate-dev-container

# In container - create custom multi-language environment
cat > /workspace/shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python311
    nodejs-18_x
    go_1_21
    rustc
    cargo
  ];
}
EOF

nix-shell /workspace/shell.nix

# Now you have Python, Node, Go, and Rust all available!
python3 --version
node --version
go version
cargo --version
```

### Example 4: Specific Python Packages via Nix

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  --name dev-container \
  fargate-dev-container

# In container - create environment with specific packages
cat > /workspace/shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [
    python311
    python311Packages.django
    python311Packages.celery
    python311Packages.redis
    redis
  ];
}
EOF

nix-shell /workspace/shell.nix

# Now you have Django, Celery, Redis (Python), and redis-server!
python3 -c "import django; print(f'Django {django.__version__}')"
redis-server --version
```

---

## Environment Variables Summary

| Variable         | Example  | Description                            |
| ---------------- | -------- | -------------------------------------- |
| `LANGUAGE`       | `python` | Which language to set up               |
| `PYTHON_VERSION` | `311`    | Python version (38, 39, 310, 311, 312) |
| `NODE_VERSION`   | `18`     | Node.js version (16, 18, 20, 21)       |
| `JAVA_VERSION`   | `17`     | Java version (8, 11, 17, 21)           |
| `GO_VERSION`     | `121`    | Go version (120, 121, 122)             |

**Note:** Only set `LANGUAGE` to trigger automatic Nix setup. Version variables only work with their corresponding language.

---

## Common Patterns

### Pattern 1: Default Environment + Ad-Hoc Packages

```bash
# Start with Python 3.11
docker run -e LANGUAGE=python -e PYTHON_VERSION=311 ...

# In container:
nix-shell ~/.nix-shell.nix  # Base environment

# Need extra packages temporarily?
nix-shell -p python311Packages.beautifulsoup4 python311Packages.scrapy
```

### Pattern 2: Project-Specific Environments

```bash
# Each project in /workspace can have its own shell.nix
/workspace/
  ├── backend/
  │   └── shell.nix  # Python + PostgreSQL
  ├── frontend/
  │   └── shell.nix  # Node.js + yarn
  └── data-pipeline/
      └── shell.nix  # Python + Spark

# Switch between them:
cd /workspace/backend && nix-shell
cd /workspace/frontend && nix-shell
```

### Pattern 3: No LANGUAGE Variable - Fully Manual

```bash
# Start container with no language specified
docker run -d -p 8080:8080 -p 6080:6080 ...

# Use Nix ad-hoc for everything:
nix-shell -p python312  # Latest Python
nix-shell -p go_1_22    # Latest Go
nix-shell -p rustc cargo  # Rust tools
```

---

## Why Not Just Use apt?

**apt (system packages):**

- ✅ Fast installation
- ✅ System-wide
- ❌ Only one version per package
- ❌ Requires root
- ❌ Can break system if you mess up
- ❌ Limited package selection

**Nix (user packages):**

- ✅ Multiple versions side-by-side
- ✅ No root needed
- ✅ Can't break system
- ✅ Huge package selection (80,000+ packages)
- ✅ Reproducible (works same everywhere)
- ❌ Slower first-time installation
- ❌ Uses more disk space

**Best practice:** Use apt for base system, Nix for development tools and multiple versions.

---

## Troubleshooting

### "command not found" after nix-shell

Make sure Nix environment is sourced:

```bash
source /etc/profile.d/nix.sh
nix-shell ~/.nix-shell.nix
```

### pip install says "externally-managed-environment"

This means you're trying to install to Nix's immutable Python. The solution:

**If using LANGUAGE=python:** The venv is created automatically in `/workspace/.venv` and activated. Just use pip normally.

**If using custom shell.nix:** Add the shellHook to create/activate a venv:

```nix
shellHook = ''
  if [ ! -d ".venv" ]; then
    python -m venv .venv
  fi
  source .venv/bin/activate
  export PS1="$ "
'';
```

### Prompt shows [nix-shell:/workspace]$ instead of $

The shellHook in the Nix configuration should set `PS1="$ "`. If it's not working:

1. Check that your shell.nix has the shellHook section
2. Exit and re-enter nix-shell
3. Or manually: `export PS1="$ "`

### Tkinter not available (ModuleNotFoundError: No module named '\_tkinter')

Nix's tkinter package is currently marked as broken. Use system tkinter instead:

1. Make sure `python3-tk` is installed via apt (it is in this container)
2. Create venv with `--system-site-packages` flag:

```nix
shellHook = ''
  python -m venv /workspace/.venv --system-site-packages
  source /workspace/.venv/bin/activate
  export PS1="$ "
'';
```

This gives you access to system tkinter while using Nix Python.

### Packages not found

Nix needs to download package definitions first:

```bash
nix-channel --update
```

### "file ~/.nix-shell.nix does not exist"

You didn't set `LANGUAGE` environment variable when starting container. Either:

1. Recreate container with `-e LANGUAGE=python`
2. Create the file manually (see examples above)

### Slow package installation

First time Nix installs packages, it downloads them. They're cached after that.

### Running out of disk space

Nix stores packages in `/nix/store`. Clean up old packages:

```bash
nix-collect-garbage -d
```

---

## Quick Reference

### Start container with language:

```bash
docker run -e LANGUAGE=python -e PYTHON_VERSION=311 ...
```

### Activate Nix environment:

```bash
nix-shell ~/.nix-shell.nix
```

### One-off package use:

```bash
nix-shell -p package1 package2
```

### Create custom environment:

```bash
cat > shell.nix << 'EOF'
{ pkgs ? import <nixpkgs> {} }:
pkgs.mkShell {
  buildInputs = with pkgs; [ package1 package2 ];
}
EOF
nix-shell
```

### Search for packages:

```bash
nix-env -qaP | grep python
nix-env -qaP | grep node
```

### Exit Nix shell:

```bash
exit
```

---

## Advanced: Docker Swarm with Different Languages

```yaml
# Stack with multiple services, each with different language
version: '3.8'
services:
  python-worker:
    image: fargate-dev-container:latest
    environment:
      - LANGUAGE=python
      - PYTHON_VERSION=311
    ...

  node-api:
    image: fargate-dev-container:latest
    environment:
      - LANGUAGE=nodejs
      - NODE_VERSION=18
    ...

  go-service:
    image: fargate-dev-container:latest
    environment:
      - LANGUAGE=go
      - GO_VERSION=121
    ...
```

Each service gets its own language environment automatically!

---

## Summary

**Nix in this container:**

1. Set `LANGUAGE` and `*_VERSION` environment variables when starting container
2. Container creates a Nix configuration file automatically
3. Run `nix-shell ~/.nix-shell.nix` to activate the environment
4. You now have that language/version available!

**No environment variables?**

- Use `nix-shell -p` for quick package access
- Create your own `shell.nix` files for projects

**The beauty:** Multiple versions, isolated environments, reproducible setups, no root needed! 🚀
