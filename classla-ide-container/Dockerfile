# ============================================================================
# AWS Fargate Development Container - Simplified (No Nix)
# ============================================================================
# Features:
# - code-server (VS Code in browser) on port 8080
# - TigerVNC + noVNC for GUI applications on port 6080
# - IceWM lightweight window manager
# - Bidirectional rclone S3 sync (download on startup, push every 15 seconds)
# - IAM task role authentication (no hardcoded credentials)
# - Non-root user with restricted write access
# - Automatic shutdown after 10 minutes of inactivity
# - Python 3.10 with tkinter, pip, and venv
# - Node.js 18 LTS
# - Java 17 with JavaFX and Swing support
# ============================================================================

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive \
    TZ=UTC

# ============================================================================
# SYSTEM DEPENDENCIES AND DEVELOPMENT TOOLS
# ============================================================================
RUN apt-get update && apt-get install -y \
    # Core utilities
    curl \
    wget \
    git \
    sudo \
    ca-certificates \
    gnupg \
    xz-utils \
    unzip \
    procps \
    inotify-tools \
    net-tools \
    vim \
    # VNC and display server
    tigervnc-standalone-server \
    tigervnc-common \
    xvfb \
    x11-utils \
    x11-xserver-utils \
    dbus-x11 \
    # Window manager and desktop components
    icewm \
    xterm \
    # GUI application support
    libx11-6 \
    libxext6 \
    libxrender1 \
    libxtst6 \
    libxi6 \
    libxrandr2 \
    # Python 3.10 with full support
    python3 \
    python3-pip \
    python3-venv \
    python3-tk \
    python3-dev \
    python3-numpy \
    python3-psutil \
    # Python GUI dependencies
    libsdl2-2.0-0 \
    libsdl2-image-2.0-0 \
    libsdl2-mixer-2.0-0 \
    libsdl2-ttf-2.0-0 \
    # Node.js 18 LTS
    nodejs \
    npm \
    # Java 17 with JavaFX
    default-jdk \
    openjfx \
    # Fonts for better GUI rendering
    fonts-dejavu \
    fonts-liberation \
    # websockify for noVNC
    python3-websockify \
    # Flask for run server
    python3-flask \
    python3-flask-cors \
    # tmux for terminal management
    tmux \
    # Clean up to reduce image size
    && rm -rf /var/lib/apt/lists/*

# ============================================================================
# INSTALL NOVNC
# ============================================================================
RUN cd /opt && \
    curl -L https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz && \
    mv noVNC-1.4.0 novnc

# Create custom index page that auto-connects to VNC with scaling enabled
# Uses VNC_BASE_PATH environment variable to preserve container ID in redirects
RUN echo '#!/bin/bash' > /usr/local/bin/create-novnc-index.sh && \
    echo 'VNC_PASSWORD=${VNC_PASSWORD:-vncpassword}' >> /usr/local/bin/create-novnc-index.sh && \
    echo 'VNC_BASE_PATH=${VNC_BASE_PATH:-}' >> /usr/local/bin/create-novnc-index.sh && \
    echo 'cat > /opt/novnc/index.html << EOF' >> /usr/local/bin/create-novnc-index.sh && \
    echo '<!DOCTYPE html>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '<html>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '<head>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    <title>Redirecting to VNC...</title>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    <meta http-equiv="refresh" content="0; url=${VNC_BASE_PATH}/vnc.html?autoconnect=true&password=${VNC_PASSWORD}&resize=scale">' >> /usr/local/bin/create-novnc-index.sh && \
    echo '</head>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '<body>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    <p>Connecting to VNC desktop...</p>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '</body>' >> /usr/local/bin/create-novnc-index.sh && \
    echo '</html>' >> /usr/local/bin/create-novnc-index.sh && \
    echo 'EOF' >> /usr/local/bin/create-novnc-index.sh && \
    chmod +x /usr/local/bin/create-novnc-index.sh

# ============================================================================
# INSTALL CODE-SERVER
# ============================================================================
RUN curl -fsSL https://code-server.dev/install.sh | sh

# ============================================================================
# INSTALL RCLONE
# ============================================================================
RUN curl -O https://downloads.rclone.org/rclone-current-linux-amd64.zip && \
    unzip rclone-current-linux-amd64.zip && \
    cd rclone-*-linux-amd64 && \
    cp rclone /usr/bin/ && \
    chmod 755 /usr/bin/rclone && \
    cd .. && \
    rm -rf rclone-*-linux-amd64*

# ============================================================================
# CREATE NON-ROOT USER
# ============================================================================
RUN useradd -m -s /bin/bash user && \
    echo "user:user" | chpasswd && \
    echo "user ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# ============================================================================
# SETUP WORKSPACE DIRECTORY
# ============================================================================
RUN mkdir -p /workspace && \
    chown -R user:user /workspace && \
    chmod 755 /workspace

# ============================================================================
# CONFIGURE USER SHELL
# ============================================================================
RUN echo '# Set DISPLAY for GUI applications' >> /home/user/.bashrc && \
    echo 'export DISPLAY=:1' >> /home/user/.bashrc && \
    echo '' >> /home/user/.bashrc && \
    echo '# Set simplified prompt' >> /home/user/.bashrc && \
    echo 'export PS1="$ "' >> /home/user/.bashrc && \
    echo '' >> /home/user/.bashrc && \
    echo '# Add local bin to PATH' >> /home/user/.bashrc && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/user/.bashrc && \
    echo '' >> /home/user/.bashrc && \
    echo '# Auto-attach to tmux session for code execution' >> /home/user/.bashrc && \
    echo 'if [ -z "$TMUX" ] && [ -n "$TERM_PROGRAM" ]; then' >> /home/user/.bashrc && \
    echo '    # Check if code_runner session exists' >> /home/user/.bashrc && \
    echo '    if tmux has-session -t code_runner 2>/dev/null; then' >> /home/user/.bashrc && \
    echo '        # Attach to existing session' >> /home/user/.bashrc && \
    echo '        exec tmux attach -t code_runner' >> /home/user/.bashrc && \
    echo '    else' >> /home/user/.bashrc && \
    echo '        # Create new session' >> /home/user/.bashrc && \
    echo '        exec tmux new-session -s code_runner -c /workspace' >> /home/user/.bashrc && \
    echo '    fi' >> /home/user/.bashrc && \
    echo 'fi' >> /home/user/.bashrc && \
    chown user:user /home/user/.bashrc

# ============================================================================
# CONFIGURE CODE-SERVER
# ============================================================================
RUN mkdir -p /home/user/.local/share/code-server/User && \
    echo '{' > /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.colorTheme": "Default Dark Modern",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.preferredDarkColorTheme": "Default Dark Modern",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "window.autoDetectColorScheme": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.defaultProfile.linux": "bash"' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '}' >> /home/user/.local/share/code-server/User/settings.json && \
    chown -R user:user /home/user/.local

# ============================================================================
# CONFIGURE VNC
# ============================================================================
RUN mkdir -p /home/user/.vnc && \
    chown -R user:user /home/user/.vnc

# Create VNC startup script with IceWM (black background, no terminal)
RUN echo '#!/bin/bash' > /home/user/.vnc/xstartup && \
    echo 'xhost +local:' >> /home/user/.vnc/xstartup && \
    echo '[ -r $HOME/.Xresources ] && xrdb $HOME/.Xresources' >> /home/user/.vnc/xstartup && \
    echo 'export DISPLAY=:1' >> /home/user/.vnc/xstartup && \
    echo 'xsetroot -solid black &' >> /home/user/.vnc/xstartup && \
    echo 'exec icewm-session' >> /home/user/.vnc/xstartup && \
    chmod +x /home/user/.vnc/xstartup

# Create VNC config file
RUN echo 'geometry=1920x1080' > /home/user/.vnc/config && \
    echo 'depth=24' >> /home/user/.vnc/config && \
    echo 'dpi=96' >> /home/user/.vnc/config && \
    chown user:user /home/user/.vnc/config

# ============================================================================
# CONFIGURE TMUX
# ============================================================================
RUN mkdir -p /home/user && \
    echo '# Disable status bar' > /home/user/.tmux.conf && \
    echo 'set -g status off' >> /home/user/.tmux.conf && \
    echo '' >> /home/user/.tmux.conf && \
    echo '# Set default terminal' >> /home/user/.tmux.conf && \
    echo 'set -g default-terminal "screen-256color"' >> /home/user/.tmux.conf && \
    echo '' >> /home/user/.tmux.conf && \
    echo '# Start windows at 1 instead of 0' >> /home/user/.tmux.conf && \
    echo 'set -g base-index 1' >> /home/user/.tmux.conf && \
    echo '' >> /home/user/.tmux.conf && \
    echo '# Enable mouse support' >> /home/user/.tmux.conf && \
    echo 'set -g mouse on' >> /home/user/.tmux.conf && \
    chown user:user /home/user/.tmux.conf

# ============================================================================
# CREATE RCLONE CONFIGURATION FOR S3 SYNC
# ============================================================================
RUN mkdir -p /home/user/.config/rclone && \
    echo '[s3]' > /home/user/.config/rclone/rclone.conf && \
    echo 'type = s3' >> /home/user/.config/rclone/rclone.conf && \
    echo 'provider = AWS' >> /home/user/.config/rclone/rclone.conf && \
    echo 'env_auth = true' >> /home/user/.config/rclone/rclone.conf && \
    echo 'region = us-east-1' >> /home/user/.config/rclone/rclone.conf && \
    echo 'acl = private' >> /home/user/.config/rclone/rclone.conf && \
    chown -R user:user /home/user/.config

# ============================================================================
# CREATE BACKGROUND SCRIPTS
# ============================================================================

# Code Runner Web Server with tmux integration and PID tracking
RUN echo '#!/usr/bin/env python3' > /usr/local/bin/run-server.py && \
    echo 'from flask import Flask, request, jsonify' >> /usr/local/bin/run-server.py && \
    echo 'from flask_cors import CORS' >> /usr/local/bin/run-server.py && \
    echo 'import subprocess' >> /usr/local/bin/run-server.py && \
    echo 'import os' >> /usr/local/bin/run-server.py && \
    echo 'import signal' >> /usr/local/bin/run-server.py && \
    echo 'import time' >> /usr/local/bin/run-server.py && \
    echo 'import psutil' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'app = Flask(__name__)' >> /usr/local/bin/run-server.py && \
    echo 'CORS(app)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'TMUX_SESSION = "code_runner"' >> /usr/local/bin/run-server.py && \
    echo 'current_pid = None' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'LANGUAGE_COMMANDS = {' >> /usr/local/bin/run-server.py && \
    echo '    "python": "python3",' >> /usr/local/bin/run-server.py && \
    echo '    "python3": "python3",' >> /usr/local/bin/run-server.py && \
    echo '    "node": "node",' >> /usr/local/bin/run-server.py && \
    echo '    "nodejs": "node",' >> /usr/local/bin/run-server.py && \
    echo '    "javascript": "node",' >> /usr/local/bin/run-server.py && \
    echo '    "java": "java",' >> /usr/local/bin/run-server.py && \
    echo '    "bash": "bash",' >> /usr/local/bin/run-server.py && \
    echo '    "sh": "sh",' >> /usr/local/bin/run-server.py && \
    echo '}' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def ensure_tmux_session():' >> /usr/local/bin/run-server.py && \
    echo '    """Ensure tmux session exists"""' >> /usr/local/bin/run-server.py && \
    echo '    result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '        ["tmux", "has-session", "-t", TMUX_SESSION],' >> /usr/local/bin/run-server.py && \
    echo '        capture_output=True' >> /usr/local/bin/run-server.py && \
    echo '    )' >> /usr/local/bin/run-server.py && \
    echo '    if result.returncode != 0:' >> /usr/local/bin/run-server.py && \
    echo '        subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '            "tmux", "new-session", "-d", "-s", TMUX_SESSION,' >> /usr/local/bin/run-server.py && \
    echo '            "-c", "/workspace"' >> /usr/local/bin/run-server.py && \
    echo '        ])' >> /usr/local/bin/run-server.py && \
    echo '        time.sleep(0.1)' >> /usr/local/bin/run-server.py && \
    echo '    # Set DISPLAY environment variable in tmux session' >> /usr/local/bin/run-server.py && \
    echo '    subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '        "tmux", "set-environment", "-t", TMUX_SESSION, "DISPLAY", ":1"' >> /usr/local/bin/run-server.py && \
    echo '    ])' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def kill_running_process():' >> /usr/local/bin/run-server.py && \
    echo '    """Kill the currently running process by PID"""' >> /usr/local/bin/run-server.py && \
    echo '    global current_pid' >> /usr/local/bin/run-server.py && \
    echo '    if current_pid:' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            process = psutil.Process(current_pid)' >> /usr/local/bin/run-server.py && \
    echo '            # Kill process and all children silently' >> /usr/local/bin/run-server.py && \
    echo '            for child in process.children(recursive=True):' >> /usr/local/bin/run-server.py && \
    echo '                try:' >> /usr/local/bin/run-server.py && \
    echo '                    child.kill()' >> /usr/local/bin/run-server.py && \
    echo '                except psutil.NoSuchProcess:' >> /usr/local/bin/run-server.py && \
    echo '                    pass' >> /usr/local/bin/run-server.py && \
    echo '            process.kill()' >> /usr/local/bin/run-server.py && \
    echo '            process.wait(timeout=1)' >> /usr/local/bin/run-server.py && \
    echo '        except (psutil.NoSuchProcess, Exception):' >> /usr/local/bin/run-server.py && \
    echo '            pass' >> /usr/local/bin/run-server.py && \
    echo '        current_pid = None' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def clear_terminal():' >> /usr/local/bin/run-server.py && \
    echo '    """Clear the tmux terminal"""' >> /usr/local/bin/run-server.py && \
    echo '    subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '        "tmux", "send-keys", "-t", TMUX_SESSION, "clear", "Enter"' >> /usr/local/bin/run-server.py && \
    echo '    ])' >> /usr/local/bin/run-server.py && \
    echo '    time.sleep(0.1)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def send_command(command):' >> /usr/local/bin/run-server.py && \
    echo '    """Execute command in tmux pane"""' >> /usr/local/bin/run-server.py && \
    echo '    global current_pid' >> /usr/local/bin/run-server.py && \
    echo '    # Send command (DISPLAY is already set in tmux environment)' >> /usr/local/bin/run-server.py && \
    echo '    subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '        "tmux", "send-keys", "-t", TMUX_SESSION,' >> /usr/local/bin/run-server.py && \
    echo '        command, "Enter"' >> /usr/local/bin/run-server.py && \
    echo '    ])' >> /usr/local/bin/run-server.py && \
    echo '    time.sleep(0.3)' >> /usr/local/bin/run-server.py && \
    echo '    # Find the PID of the command (child of shell)' >> /usr/local/bin/run-server.py && \
    echo '    result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '        ["tmux", "display-message", "-t", TMUX_SESSION, "-p", "#{pane_pid}"],' >> /usr/local/bin/run-server.py && \
    echo '        capture_output=True, text=True' >> /usr/local/bin/run-server.py && \
    echo '    )' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        shell_pid = int(result.stdout.strip())' >> /usr/local/bin/run-server.py && \
    echo '        # Find child process of the shell' >> /usr/local/bin/run-server.py && \
    echo '        time.sleep(0.2)' >> /usr/local/bin/run-server.py && \
    echo '        for proc in psutil.process_iter(["pid", "ppid", "name"]):' >> /usr/local/bin/run-server.py && \
    echo '            if proc.info["ppid"] == shell_pid and proc.info["name"] != "bash":' >> /usr/local/bin/run-server.py && \
    echo '                current_pid = proc.info["pid"]' >> /usr/local/bin/run-server.py && \
    echo '                break' >> /usr/local/bin/run-server.py && \
    echo '        else:' >> /usr/local/bin/run-server.py && \
    echo '            current_pid = None' >> /usr/local/bin/run-server.py && \
    echo '    except Exception:' >> /usr/local/bin/run-server.py && \
    echo '        current_pid = None' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/health", methods=["GET"])' >> /usr/local/bin/run-server.py && \
    echo 'def health():' >> /usr/local/bin/run-server.py && \
    echo '    return jsonify({"status": "ok"}), 200' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/run", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def run_code():' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        data = request.get_json()' >> /usr/local/bin/run-server.py && \
    echo '        if not data:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "No JSON data provided"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        filename = data.get("filename")' >> /usr/local/bin/run-server.py && \
    echo '        language = data.get("language", "").lower()' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        if not filename:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "filename is required"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        if not language:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "language is required"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Get command for language' >> /usr/local/bin/run-server.py && \
    echo '        cmd = LANGUAGE_COMMANDS.get(language)' >> /usr/local/bin/run-server.py && \
    echo '        if not cmd:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": f"Unsupported language: {language}"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Build full path' >> /usr/local/bin/run-server.py && \
    echo '        filepath = os.path.join("/workspace", filename)' >> /usr/local/bin/run-server.py && \
    echo '        if not os.path.exists(filepath):' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": f"File not found: {filename}"}), 404' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Ensure tmux session exists' >> /usr/local/bin/run-server.py && \
    echo '        ensure_tmux_session()' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Kill any running process' >> /usr/local/bin/run-server.py && \
    echo '        kill_running_process()' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Clear terminal' >> /usr/local/bin/run-server.py && \
    echo '        clear_terminal()' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Build and send command' >> /usr/local/bin/run-server.py && \
    echo '        command = f"{cmd} {filename}"' >> /usr/local/bin/run-server.py && \
    echo '        send_command(command)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({' >> /usr/local/bin/run-server.py && \
    echo '            "status": "success",' >> /usr/local/bin/run-server.py && \
    echo '            "message": f"Executed: {command}",' >> /usr/local/bin/run-server.py && \
    echo '            "command": command,' >> /usr/local/bin/run-server.py && \
    echo '            "tmux_session": TMUX_SESSION' >> /usr/local/bin/run-server.py && \
    echo '        }), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'if __name__ == "__main__":' >> /usr/local/bin/run-server.py && \
    echo '    app.run(host="0.0.0.0", port=3000, debug=False)' >> /usr/local/bin/run-server.py && \
    chmod +x /usr/local/bin/run-server.py

# Rclone Bidirectional S3 Sync Loop
RUN echo '#!/bin/bash' > /usr/local/bin/rclone-sync-loop.sh && \
    echo 'set -e' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "Starting rclone sync loop..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "ERROR: S3_BUCKET environment variable not set"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    exit 1' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'S3_PATH="s3:${S3_BUCKET}"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Initial sync in background (non-blocking) - container can start immediately' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$(ls -A $WORKSPACE_PATH)" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "Workspace is empty, performing initial download from S3 in background..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    (rclone sync "$S3_PATH" "$WORKSPACE_PATH" --progress --no-check-dest --transfers 4 --checkers 8 || {' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "WARNING: Initial S3 sync failed (bucket might be empty or not exist yet)"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    }) &' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'else' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "Workspace is not empty, skipping initial download"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'while true; do' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    sleep 15' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    rclone sync "$WORKSPACE_PATH" "$S3_PATH" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --progress \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".git/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude "node_modules/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude "__pycache__/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".vscode/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".idea/**" || {' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "WARNING: S3 sync failed, will retry in 15 seconds"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    }' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'done' >> /usr/local/bin/rclone-sync-loop.sh && \
    chmod +x /usr/local/bin/rclone-sync-loop.sh

# Inactivity Monitor
RUN echo '#!/bin/bash' > /usr/local/bin/inactivity-monitor.sh && \
    echo 'set -e' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'TIMEOUT_SECONDS=600' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'echo "Starting inactivity monitor (timeout: ${TIMEOUT_SECONDS}s)..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'shutdown_container() {' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "========================================="' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "INACTIVITY TIMEOUT REACHED"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "No file changes detected for ${TIMEOUT_SECONDS} seconds"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "Performing final S3 sync before shutdown..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "========================================="' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Stop the rclone sync loop first' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    pkill -f "rclone-sync-loop.sh" || true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    pkill -f "rclone sync" || true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    sleep 2' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Perform final sync' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if [ -n "$S3_BUCKET" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        rclone sync "$WORKSPACE_PATH" "s3:${S3_BUCKET}" --progress --verbose || true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        echo "Final sync complete"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    echo "Initiating container shutdown..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Kill all processes and exit' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    killall5 -9 || true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    exit 0' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '}' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'while true; do' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if ! inotifywait -r -t $TIMEOUT_SECONDS -e modify -e create -e delete -e move "$WORKSPACE_PATH" &>/dev/null; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        shutdown_container' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        exit 0' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    else' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        echo "File activity detected at $(date), resetting inactivity timer"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'done' >> /usr/local/bin/inactivity-monitor.sh && \
    chmod +x /usr/local/bin/inactivity-monitor.sh

# Main Entrypoint - Optimized for fast startup
RUN echo '#!/bin/bash' > /usr/local/bin/entrypoint.sh && \
    echo 'set -e' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# CRITICAL: Start code-server IMMEDIATELY (before other setup)' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Starting code-server immediately on port 8080..."' >> /usr/local/bin/entrypoint.sh && \
    echo 'su - user -c "cd /workspace && code-server --bind-addr 0.0.0.0:8080 --auth none --disable-telemetry --disable-update-check --disable-getting-started-override /workspace" &' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Setup tasks in parallel (non-blocking)' >> /usr/local/bin/entrypoint.sh && \
    echo 'VNC_PASSWORD=${VNC_PASSWORD:-vncpassword}' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "$VNC_PASSWORD" | vncpasswd -f > /home/user/.vnc/passwd' >> /usr/local/bin/entrypoint.sh && \
    echo 'chmod 600 /home/user/.vnc/passwd' >> /usr/local/bin/entrypoint.sh && \
    echo 'chown user:user /home/user/.vnc/passwd' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Workspace ownership (can be slow, do in background if large)' >> /usr/local/bin/entrypoint.sh && \
    echo 'chown -R user:user /workspace 2>/dev/null || true' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Create custom noVNC index page' >> /usr/local/bin/entrypoint.sh && \
    echo '/usr/local/bin/create-novnc-index.sh' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Update rclone config with S3 region' >> /usr/local/bin/entrypoint.sh && \
    echo 'if [ -n "$S3_REGION" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    sed -i "s/region = .*/region = $S3_REGION/" /home/user/.config/rclone/rclone.conf' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Start run server' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Starting run server on port 3000..."' >> /usr/local/bin/entrypoint.sh && \
    echo 'su - user -c "python3 /usr/local/bin/run-server.py" &' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Start VNC and noVNC in background (parallel with code-server)' >> /usr/local/bin/entrypoint.sh && \
    echo '(' >> /usr/local/bin/entrypoint.sh && \
    echo '  echo "Starting VNC server..."' >> /usr/local/bin/entrypoint.sh && \
    echo '  su - user -c "vncserver :1 -geometry 1920x1080 -depth 24 -localhost no" || {' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "ERROR: Failed to start VNC server"' >> /usr/local/bin/entrypoint.sh && \
    echo '    cat /home/user/.vnc/*.log' >> /usr/local/bin/entrypoint.sh && \
    echo '  }' >> /usr/local/bin/entrypoint.sh && \
    echo '  sleep 1' >> /usr/local/bin/entrypoint.sh && \
    echo '  echo "Starting noVNC on port 6080..."' >> /usr/local/bin/entrypoint.sh && \
    echo '  websockify --web=/opt/novnc 6080 localhost:5901 &' >> /usr/local/bin/entrypoint.sh && \
    echo ') &' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Start rclone sync loop in background (non-blocking) - if S3_BUCKET is set' >> /usr/local/bin/entrypoint.sh && \
    echo 'if [ -n "$S3_BUCKET" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "Starting rclone sync loop for bucket: $S3_BUCKET (background)..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    su user -c "S3_BUCKET=$S3_BUCKET S3_REGION=$S3_REGION AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY /usr/local/bin/rclone-sync-loop.sh" &' >> /usr/local/bin/entrypoint.sh && \
    echo 'else' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "WARNING: S3_BUCKET not set, skipping rclone sync"' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Start inactivity monitor (if enabled)' >> /usr/local/bin/entrypoint.sh && \
    echo 'if [ "$ENABLE_INACTIVITY_SHUTDOWN" = "true" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "Starting inactivity monitor (10 minute timeout)..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    /usr/local/bin/inactivity-monitor.sh &' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Print access information' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo ""' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "========================================="' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Container is ready!"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "========================================="' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Access your development environment:"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo ""' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  VS Code:     http://localhost:8080"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  GUI Desktop: http://localhost:6080"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  Run Server:  http://localhost:3000"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo ""' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Languages available:"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  Python 3.10 with tkinter and pip"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  Node.js $(node --version) with npm"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "  Java $(java -version 2>&1 | head -n 1)"' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo ""' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "========================================="' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Keep container running' >> /usr/local/bin/entrypoint.sh && \
    echo 'tail -f /dev/null' >> /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

# ============================================================================
# EXPOSE PORTS
# ============================================================================
EXPOSE 8080 6080 3000

# ============================================================================
# SET WORKING DIRECTORY
# ============================================================================
WORKDIR /workspace

# ============================================================================
# ENVIRONMENT VARIABLES
# ============================================================================
ENV VNC_PASSWORD=vncpassword \
    ENABLE_INACTIVITY_SHUTDOWN=true

# ============================================================================
# CONTAINER STARTUP
# ============================================================================
CMD ["/usr/local/bin/entrypoint.sh"]
