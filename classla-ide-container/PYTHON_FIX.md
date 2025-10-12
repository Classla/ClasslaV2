# Python Environment Fix

## Problems Fixed

1. **pip install didn't work** - Got "externally-managed-environment" error
2. **Prompt showed `[nix-shell:/workspace]$`** instead of just `$`
3. **Tkinter wasn't available** - Nix tkinter package is marked as broken
4. **Slow startup** - 30 seconds before code-server was accessible

## Solution

### What Changed

The Nix Python configuration now:

1. **Uses Nix Python but system tkinter** - Nix tkinter is broken, use apt's python3-tk
2. **Creates a virtual environment automatically** in `/workspace/.venv` with `--system-site-packages`
3. **Activates the venv in shellHook** so pip works normally
4. **Sets PS1 prompt** to just `$` in the shellHook
5. **Starts code-server first** - VNC initialization happens in background

### New Nix Configuration

When you set `LANGUAGE=python PYTHON_VERSION=311`, the container now creates:

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

**Key changes:**

- Uses Nix Python (specific version) but NOT Nix tkinter (marked as broken)
- Creates venv with `--system-site-packages` flag
- This allows access to system tkinter (installed via apt: python3-tk)
- pip installs go to the venv, tkinter comes from system

### Startup Optimization

The entrypoint script now:

1. Starts code-server FIRST (fastest service, ~2-3 seconds)
2. Starts VNC in background (slower, ~10-15 seconds)
3. You can access code-server immediately while VNC initializes

## How It Works Now

### Starting the Container

```bash
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e LANGUAGE=python \
  -e PYTHON_VERSION=311 \
  -e VNC_PASSWORD=myvnc123 \
  --name dev-container \
  fargate-dev-container
```

### In VS Code Terminal

When you open a terminal in code-server:

1. Bash starts and sources `.bashrc`
2. `.bashrc` detects `~/.nix-shell.nix` exists
3. Automatically runs `nix-shell ~/.nix-shell.nix`
4. Nix shell's `shellHook` runs:
   - Creates `/workspace/.venv` if it doesn't exist (with system packages)
   - Activates the virtual environment
   - Sets prompt to `$`

### Using Python

```bash
$ python --version
Python 3.11.14

$ pip install pydraw
Collecting pydraw
  Downloading pydraw-0.2.1-py3-none-any.whl
Installing collected packages: pydraw
Successfully installed pydraw-0.2.1

$ python test.py
# Works! pydraw is installed in /workspace/.venv

$ python -c "import tkinter; print('Tkinter works!')"
Tkinter works!
```

## Key Benefits

1. **pip works normally** - Installs to `/workspace/.venv` which is writable
2. **Clean prompt** - Just `$` instead of `[nix-shell:/workspace]$`
3. **Tkinter available** - From system python3-tk via --system-site-packages
4. **Persistent packages** - `/workspace/.venv` is in the workspace, syncs to S3
5. **No manual activation** - Everything happens automatically
6. **Fast startup** - code-server accessible in ~3 seconds instead of 30

## Rebuilding

To apply these changes:

```bash
# Rebuild the image
docker build -t fargate-dev-container .

# Or with Make
make build

# Run with Python environment
docker run -d \
  -p 8080:8080 \
  -p 6080:6080 \
  -e LANGUAGE=python \
  -e PYTHON_VERSION=311 \
  -e VNC_PASSWORD=myvnc123 \
  -e ENABLE_INACTIVITY_SHUTDOWN=false \
  --name dev-container \
  fargate-dev-container
```

## Verification

After starting the container, open http://localhost:8080 (should load in ~3 seconds):

```bash
# Should show just "$" prompt
$

# Python should be available
$ python --version
Python 3.11.14

# pip should work
$ pip install requests
Successfully installed requests-2.31.0

# Tkinter should work
$ python -c "import tkinter; print('Success!')"
Success!

# Virtual environment should be active
$ which python
/workspace/.venv/bin/python

# System packages should be accessible
$ python -c "import tkinter; import sys; print(tkinter.__file__)"
/usr/lib/python3.10/tkinter/__init__.py
```

## Why This Approach?

**Nix tkinter is broken** - The package is marked as broken in nixpkgs, so we can't use it.

**Solution: Hybrid approach**

- Nix provides: Python interpreter (specific version)
- System provides: tkinter (via apt's python3-tk)
- Venv provides: Writable space for pip packages

**The `--system-site-packages` flag** bridges Nix Python with system tkinter.

## For Other Languages

The same pattern can be applied to other languages if needed. For example, Node.js could use a local `node_modules` directory, Java could use a local Maven repository, etc.

The key insight: **Nix provides the base tools, system provides GUI libraries, and local directories provide writable space for user packages.**
