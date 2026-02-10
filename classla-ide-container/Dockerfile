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
    nginx \
    sqlite3 \
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
    # Node.js will be installed from NodeSource (see below)
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
    # Build tools for ttyd
    build-essential \
    cmake \
    libjson-c-dev \
    libwebsockets-dev \
    # rsync for efficient file copying
    rsync \
    # Clean up to reduce image size
    && rm -rf /var/lib/apt/lists/*

# ============================================================================
# INSTALL NODE.JS 18 LTS (from NodeSource - required for container file sync)
# ============================================================================
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    node --version && \
    npm --version && \
    rm -rf /var/lib/apt/lists/*

# ============================================================================
# INSTALL PYTHON PACKAGES
# ============================================================================
RUN pip3 install --no-cache-dir pydraw

# ============================================================================
# INSTALL NOVNC
# ============================================================================
RUN cd /opt && \
    curl -L https://github.com/novnc/noVNC/archive/refs/tags/v1.4.0.tar.gz | tar xz && \
    mv noVNC-1.4.0 novnc

# Create custom index page that auto-connects to VNC with scaling enabled
# Uses VNC_BASE_PATH environment variable to preserve container ID in redirects
# Also patches vnc.html to set correct websockify path for reverse proxy
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
    echo '' >> /usr/local/bin/create-novnc-index.sh && \
    echo '# Patch vnc.html to set correct websockify path for reverse proxy' >> /usr/local/bin/create-novnc-index.sh && \
    echo 'if [ -n "$VNC_BASE_PATH" ]; then' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # Set websockify path to include base path' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    WEBSOCKIFY_PATH="${VNC_BASE_PATH}/websockify"' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # Update the default path input value in vnc.html' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    sed -i "s|value=\"websockify\"|value=\"${WEBSOCKIFY_PATH}\"|g" /opt/novnc/vnc.html' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # Create JavaScript file to set path (simplified to avoid heredoc issues)' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    printf '\''// VNC_BASE_PATH_OVERRIDE: Set websockify path for reverse proxy\n(function() {\n  const websockifyPath = "${WEBSOCKIFY_PATH}";\n  window.addEventListener("DOMContentLoaded", function() {\n    const pathInput = document.getElementById("noVNC_setting_path");\n    if (pathInput) {\n      pathInput.value = websockifyPath;\n      pathInput.dispatchEvent(new Event("change", { bubbles: true }));\n    }\n    const urlParams = new URLSearchParams(window.location.search);\n    if (!urlParams.has("path")) {\n      urlParams.set("path", websockifyPath);\n      window.history.replaceState({}, "", window.location.pathname + "?" + urlParams.toString());\n    }\n  });\n})();\n'\'' > /opt/novnc/vnc-path-override.js' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # Inject script tag before error-handler.js (temporarily disabled due to build issues)' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # if ! grep -q "vnc-path-override.js" /opt/novnc/vnc.html; then' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    #     sed -i "/app\\/error-handler.js/i<script src=\"vnc-path-override.js\"></script>" /opt/novnc/vnc.html' >> /usr/local/bin/create-novnc-index.sh && \
    echo '    # fi' >> /usr/local/bin/create-novnc-index.sh && \
    echo 'fi' >> /usr/local/bin/create-novnc-index.sh && \
    chmod +x /usr/local/bin/create-novnc-index.sh

# ============================================================================
# INSTALL CODE-SERVER
# ============================================================================
RUN curl -fsSL https://code-server.dev/install.sh | sh

# ============================================================================
# INSTALL TTYD (Web-based terminal)
# ============================================================================
RUN cd /tmp && \
    git clone https://github.com/tsl0922/ttyd.git && \
    cd ttyd && \
    git checkout 1.7.4 && \
    mkdir build && \
    cd build && \
    cmake .. && \
    make && \
    make install && \
    cd / && \
    rm -rf /tmp/ttyd && \
    ttyd --version

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
# SETUP AUTOGRADER-COPY DIRECTORY
# ============================================================================
RUN mkdir -p /autograder-copy && \
    chown -R user:user /autograder-copy && \
    chmod 755 /autograder-copy

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
# Create custom CSS to hide Extensions, Accounts, and Settings views
RUN mkdir -p /home/user/.local/share/code-server/custom-css && \
    echo '/* Hide Extensions, Accounts, and Settings from Activity Bar */' > /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '/* Hide the entire bottom section of activity bar (global-activity) */' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .content > .global-activity-action-bar {' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '    display: none !important;' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '}' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '/* Hide global activity items individually */' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .content .global-activity {' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '    display: none !important;' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '}' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '/* Fallback: Hide last child of activity bar content */' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo 'div.monaco-workbench div.activitybar > div.content > div:last-child {' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '    display: none !important;' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '}' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '/* Hide items with specific icons */' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .action-item:has(.codicon-extensions),' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .action-item:has(.codicon-gear),' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .action-item:has(.codicon-account),' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '.monaco-workbench .part.activitybar .action-item:has(.codicon-settings-gear) {' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '    display: none !important;' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    echo '}' >> /home/user/.local/share/code-server/custom-css/hide-views.css && \
    chown -R user:user /home/user/.local/share/code-server/custom-css

# ============================================================================
# STEP 1: Add CSS to Hide Extensions, Settings, Profile (Multiple Approaches)
# ============================================================================
RUN WORKBENCH_HTML=$(find /usr/lib/code-server -name "workbench.html" 2>/dev/null | head -1) && \
    # Create CSS with multiple targeting approaches
    echo '<style id="custom-hide-activity-bar">' > /tmp/custom-css.html && \
    echo '/* Approach A: Hide by icon class (most specific) */' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .action-item:has([class*="codicon-extensions"]),' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .action-item:has([class*="codicon-gear"]),' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .action-item:has([class*="codicon-account"]),' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .action-item:has([class*="codicon-settings"]) {' >> /tmp/custom-css.html && \
    echo '    display: none !important;' >> /tmp/custom-css.html && \
    echo '    visibility: hidden !important;' >> /tmp/custom-css.html && \
    echo '    pointer-events: none !important;' >> /tmp/custom-css.html && \
    echo '}' >> /tmp/custom-css.html && \
    echo '' >> /tmp/custom-css.html && \
    echo '/* Approach B: Hide by position (last 3 items - usually Extensions, Settings, Profile) */' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .content .action-item:nth-last-child(-n+3) {' >> /tmp/custom-css.html && \
    echo '    display: none !important;' >> /tmp/custom-css.html && \
    echo '    visibility: hidden !important;' >> /tmp/custom-css.html && \
    echo '}' >> /tmp/custom-css.html && \
    echo '' >> /tmp/custom-css.html && \
    echo '/* Approach C: Hide global-activity section if it exists */' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .content .global-activity-action-bar,' >> /tmp/custom-css.html && \
    echo '.monaco-workbench .part.activitybar .content .global-activity {' >> /tmp/custom-css.html && \
    echo '    display: none !important;' >> /tmp/custom-css.html && \
    echo '    visibility: hidden !important;' >> /tmp/custom-css.html && \
    echo '}' >> /tmp/custom-css.html && \
    echo '</style>' >> /tmp/custom-css.html && \
    # Inject CSS
    python3 -c "import sys; w=sys.argv[1]; css=sys.argv[2]; c=open(w,'r',encoding='utf-8').read(); css_content=open(css,'r',encoding='utf-8').read(); open(w,'w',encoding='utf-8').write(c.replace('</head>',css_content+'</head>'))" "$WORKBENCH_HTML" /tmp/custom-css.html && \
    rm /tmp/custom-css.html && \
    echo "CSS injected for hiding activity bar items"

RUN mkdir -p /home/user/.local/share/code-server/User && \
    # Create User settings.json
    echo '{' > /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.colorTheme": "Default Light+",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.preferredLightColorTheme": "Default Light+",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "window.autoDetectColorScheme": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.colorCustomizations": {' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '        "[Default Light+]": {' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "activityBar.activeBorder": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "activityBar.background": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "activityBar.foreground": "#ffffff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "activityBar.inactiveForeground": "#e9d5ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "activityBarBadge.background": "#9333ea",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "statusBar.background": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "statusBar.foreground": "#ffffff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "titleBar.activeBackground": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "titleBar.activeForeground": "#ffffff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "button.background": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "button.foreground": "#ffffff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "inputOption.activeBorder": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.activeSelectionBackground": "#f3e8ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.activeSelectionForeground": "#1f2937",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.inactiveSelectionBackground": "#f3e8ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.inactiveSelectionForeground": "#1f2937",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.hoverBackground": "#f3e8ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.hoverForeground": "#1f2937",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.focusBackground": "#f3e8ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "list.focusForeground": "#1f2937",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editor.selectionBackground": "#f3e8ff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editorCursor.foreground": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editorLineNumber.activeForeground": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editorWidget.border": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "peekView.border": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "panel.border": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBar.background": "#ffffff",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBarTitle.foreground": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBar.border": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBarSectionHeader.background": "#f9fafb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBarSectionHeader.foreground": "#8b5cf6",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "sideBarSectionHeader.border": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editorGroupHeader.border": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "editorGroupHeader.tabsBorder": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "tab.border": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "panel.border": "#e5e7eb",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '            "panelTitle.border": "#e5e7eb"' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '        }' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    },' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.startupEditor": "none",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.tabs.enabled": true,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.tabs.showActiveTerminal": "always",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.showWelcomeMessage": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.defaultProfile.linux": "bash",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.defaultLocation": "panel",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.panel.defaultLocation": "bottom",' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "terminal.integrated.showExitAlert": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "extensions.ignoreRecommendations": true,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "extensions.autoCheckUpdates": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "extensions.autoUpdate": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "extensions.showRecommendationsOnlyOnDemand": true,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "extensions.experimental.affinity": {},' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "chat.disableAIFeatures": true,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "github.copilot.enable": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.settings.enableNaturalLanguageSearch": false,' >> /home/user/.local/share/code-server/User/settings.json && \
    echo '    "workbench.settings.openDefaultSettings": false' >> /home/user/.local/share/code-server/User/settings.json && \
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
    echo '# Start icewm-session in background and then force black background' >> /home/user/.vnc/xstartup && \
    echo 'icewm-session &' >> /home/user/.vnc/xstartup && \
    echo '# Wait for icewm to start, then kill icewmbg and set black background' >> /home/user/.vnc/xstartup && \
    echo 'sleep 3' >> /home/user/.vnc/xstartup && \
    echo 'killall icewmbg 2>/dev/null || true' >> /home/user/.vnc/xstartup && \
    echo 'xsetroot -solid black' >> /home/user/.vnc/xstartup && \
    echo '# Keep script running' >> /home/user/.vnc/xstartup && \
    echo 'wait' >> /home/user/.vnc/xstartup && \
    chmod +x /home/user/.vnc/xstartup

# Create VNC config file
RUN echo 'geometry=1920x1080' > /home/user/.vnc/config && \
    echo 'depth=24' >> /home/user/.vnc/config && \
    echo 'dpi=96' >> /home/user/.vnc/config && \
    chown user:user /home/user/.vnc/config

# ============================================================================
# CONFIGURE ICEWM (Desktop Background)
# ============================================================================
RUN mkdir -p /home/user/.icewm && \
    echo '# IceWM Preferences - Black Desktop Background' > /home/user/.icewm/preferences && \
    echo 'DesktopBackgroundImage=""' >> /home/user/.icewm/preferences && \
    echo 'DesktopBackgroundColor="black"' >> /home/user/.icewm/preferences && \
    echo 'DesktopBackgroundCenter=0' >> /home/user/.icewm/preferences && \
    echo 'DesktopBackgroundScaled=0' >> /home/user/.icewm/preferences && \
    echo '# Override theme settings to ensure black background' > /home/user/.icewm/prefoverride && \
    echo 'DesktopBackgroundImage=""' >> /home/user/.icewm/prefoverride && \
    echo 'DesktopBackgroundColor="black"' >> /home/user/.icewm/prefoverride && \
    echo '#!/bin/bash' > /home/user/.icewm/startup && \
    echo '# Force black background after icewm starts' >> /home/user/.icewm/startup && \
    echo 'sleep 1' >> /home/user/.icewm/startup && \
    echo 'killall icewmbg 2>/dev/null || true' >> /home/user/.icewm/startup && \
    echo 'xsetroot -solid black' >> /home/user/.icewm/startup && \
    chmod +x /home/user/.icewm/startup && \
    chown -R user:user /home/user/.icewm

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
    echo 'import shlex' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'app = Flask(__name__)' >> /usr/local/bin/run-server.py && \
    echo '# Enable CORS for all origins to allow frontend (localhost:5173) to connect' >> /usr/local/bin/run-server.py && \
    echo '# Allow all headers including Sentry headers (sentry-trace, baggage, etc.)' >> /usr/local/bin/run-server.py && \
    echo 'CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"], "allow_headers": "*"}})' >> /usr/local/bin/run-server.py && \
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
    echo '@app.route("/write-file", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def write_file():' >> /usr/local/bin/run-server.py && \
    echo '    """Write content to a file in the workspace"""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        data = request.get_json()' >> /usr/local/bin/run-server.py && \
    echo '        if not data:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "No JSON data provided"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        path = data.get("path")' >> /usr/local/bin/run-server.py && \
    echo '        content = data.get("content", "")' >> /usr/local/bin/run-server.py && \
    echo '        if not path:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "path is required"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        # Ensure path is within workspace for security' >> /usr/local/bin/run-server.py && \
    echo '        if not path.startswith("/workspace") and not path.startswith("/home/coder/project"):' >> /usr/local/bin/run-server.py && \
    echo '            path = os.path.join("/workspace", path.lstrip("/"))' >> /usr/local/bin/run-server.py && \
    echo '        # Create parent directories if needed' >> /usr/local/bin/run-server.py && \
    echo '        os.makedirs(os.path.dirname(path), exist_ok=True)' >> /usr/local/bin/run-server.py && \
    echo '        with open(path, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '            f.write(content)' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"status": "success", "path": path}), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
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
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Flush pending writes and pull latest files BEFORE checking file existence' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            import urllib.request' >> /usr/local/bin/run-server.py && \
    echo '            flush_req = urllib.request.Request("http://127.0.0.1:3001/flush", method="POST")' >> /usr/local/bin/run-server.py && \
    echo '            flush_resp = urllib.request.urlopen(flush_req, timeout=10)' >> /usr/local/bin/run-server.py && \
    echo '            print(f"Flushed and pulled files before run: {flush_resp.read().decode()}")' >> /usr/local/bin/run-server.py && \
    echo '        except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '            print(f"WARNING: Failed to flush/pull files before run: {e}")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Check file exists after flush (file may have been pulled from backend)' >> /usr/local/bin/run-server.py && \
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
    echo '        command = f"{cmd} {shlex.quote(filename)}"' >> /usr/local/bin/run-server.py && \
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
    echo 'S3_ASSIGNMENT_FILE = "/tmp/s3-assignment.json"' >> /usr/local/bin/run-server.py && \
    echo 'S3_SYNC_TRIGGER_FILE = "/tmp/s3-sync-trigger"' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/assign-s3-bucket", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def assign_s3_bucket():' >> /usr/local/bin/run-server.py && \
    echo '    """Assign S3 bucket to this container dynamically"""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        data = request.get_json()' >> /usr/local/bin/run-server.py && \
    echo '        if not data:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "No JSON data provided"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        bucket = data.get("bucket")' >> /usr/local/bin/run-server.py && \
    echo '        if not bucket:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "bucket is required"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Check if already assigned' >> /usr/local/bin/run-server.py && \
    echo '        if os.path.exists(S3_ASSIGNMENT_FILE):' >> /usr/local/bin/run-server.py && \
    echo '            try:' >> /usr/local/bin/run-server.py && \
    echo '                import json' >> /usr/local/bin/run-server.py && \
    echo '                with open(S3_ASSIGNMENT_FILE, "r") as f:' >> /usr/local/bin/run-server.py && \
    echo '                    existing = json.load(f)' >> /usr/local/bin/run-server.py && \
    echo '                    if existing.get("bucket") == bucket:' >> /usr/local/bin/run-server.py && \
    echo '                        return jsonify({"status": "already_assigned", "bucket": bucket}), 200' >> /usr/local/bin/run-server.py && \
    echo '                    else:' >> /usr/local/bin/run-server.py && \
    echo '                        existing_bucket = existing.get("bucket")' >> /usr/local/bin/run-server.py && \
    echo '                        return jsonify({"error": f"S3 bucket already assigned: {existing_bucket}"}), 409' >> /usr/local/bin/run-server.py && \
    echo '            except Exception:' >> /usr/local/bin/run-server.py && \
    echo '                pass  # File exists but invalid, overwrite it' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Write S3 assignment config' >> /usr/local/bin/run-server.py && \
    echo '        import json' >> /usr/local/bin/run-server.py && \
    echo '        bucket_id = data.get("bucketId")' >> /usr/local/bin/run-server.py && \
    echo '        if not bucket_id:' >> /usr/local/bin/run-server.py && \
    echo '            print(f"WARNING: bucketId is missing or empty in S3 assignment request! File sync will NOT work.")' >> /usr/local/bin/run-server.py && \
    echo '            print(f"Request data keys: {list(data.keys())}")' >> /usr/local/bin/run-server.py && \
    echo '        assignment = {' >> /usr/local/bin/run-server.py && \
    echo '            "bucket": bucket,' >> /usr/local/bin/run-server.py && \
        echo '            "bucketId": bucket_id,' >> /usr/local/bin/run-server.py && \
    echo '            "region": data.get("region", "us-east-1"),' >> /usr/local/bin/run-server.py && \
    echo '            "accessKeyId": data.get("accessKeyId"),' >> /usr/local/bin/run-server.py && \
    echo '            "secretAccessKey": data.get("secretAccessKey")' >> /usr/local/bin/run-server.py && \
    echo '        }' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        with open(S3_ASSIGNMENT_FILE, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '            json.dump(assignment, f)' >> /usr/local/bin/run-server.py && \
    echo '        print(f"S3 assignment file written: {assignment}")' >> /usr/local/bin/run-server.py && \
    echo '        # Touch the file to set its modification time (for inactivity monitor grace period)' >> /usr/local/bin/run-server.py && \
    echo '        os.utime(S3_ASSIGNMENT_FILE, None)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # CRITICAL: DO NOT clear workspace - file sync handles all syncing' >> /usr/local/bin/run-server.py && \
    echo '        # The file sync service will push changes to the backend automatically' >> /usr/local/bin/run-server.py && \
    echo '        # Clearing the workspace would cause empty content to sync back to the IDE' >> /usr/local/bin/run-server.py && \
    echo '        bucket_name = assignment.get("bucket", "")' >> /usr/local/bin/run-server.py && \
    echo '        print(f"File sync service will handle syncing files from S3 to workspace for bucket: {bucket_name} (ID: {bucket_id})")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({' >> /usr/local/bin/run-server.py && \
    echo '            "status": "success",' >> /usr/local/bin/run-server.py && \
    echo '            "message": f"S3 bucket {bucket} assigned successfully",' >> /usr/local/bin/run-server.py && \
    echo '            "bucket": bucket,' >> /usr/local/bin/run-server.py && \
    echo '            "bucketId": bucket_id,' >> /usr/local/bin/run-server.py && \
    echo '            "warning": "bucketId is missing - File sync will not work" if not bucket_id else None' >> /usr/local/bin/run-server.py && \
    echo '        }), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/sync-status", methods=["GET"])' >> /usr/local/bin/run-server.py && \
    echo 'def sync_status():' >> /usr/local/bin/run-server.py && \
    echo '    """Check if initial sync has completed"""' >> /usr/local/bin/run-server.py && \
    echo '    marker_file = "/tmp/yjs-initial-sync-complete"' >> /usr/local/bin/run-server.py && \
    echo '    if os.path.exists(marker_file):' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            import json' >> /usr/local/bin/run-server.py && \
    echo '            with open(marker_file, "r") as f:' >> /usr/local/bin/run-server.py && \
    echo '                data = json.load(f)' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"status": "ready", "details": data}), 200' >> /usr/local/bin/run-server.py && \
    echo '        except Exception:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"status": "ready"}), 200' >> /usr/local/bin/run-server.py && \
    echo '    elif os.path.exists(S3_ASSIGNMENT_FILE):' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"status": "syncing"}), 202' >> /usr/local/bin/run-server.py && \
    echo '    else:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"status": "waiting_for_assignment"}), 202' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'AUTOGRADER_PATH = "/autograder-copy"' >> /usr/local/bin/run-server.py && \
    echo 'WORKSPACE_PATH = "/workspace"' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def generate_input_output_test(test_case, test_file_path):' >> /usr/local/bin/run-server.py && \
    echo '    """Generate Python script for input/output test"""' >> /usr/local/bin/run-server.py && \
    echo '    import json' >> /usr/local/bin/run-server.py && \
    echo '    test_input = test_case.get("input", "")' >> /usr/local/bin/run-server.py && \
    echo '    expected_output = test_case.get("expectedOutput", "")' >> /usr/local/bin/run-server.py && \
    echo '    # Ensure test_input is a string (JSON should give us strings, but be safe)' >> /usr/local/bin/run-server.py && \
    echo '    if isinstance(test_input, bytes):' >> /usr/local/bin/run-server.py && \
    echo '        test_input = test_input.decode("utf-8")' >> /usr/local/bin/run-server.py && \
    echo '    if isinstance(expected_output, bytes):' >> /usr/local/bin/run-server.py && \
    echo '        expected_output = expected_output.decode("utf-8")' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    # Find main Python file in workspace' >> /usr/local/bin/run-server.py && \
    echo '    main_files = ["main.py", "solution.py", "code.py"]' >> /usr/local/bin/run-server.py && \
    echo '    main_file = None' >> /usr/local/bin/run-server.py && \
    echo '    for f in main_files:' >> /usr/local/bin/run-server.py && \
    echo '        if os.path.exists(os.path.join(WORKSPACE_PATH, f)):' >> /usr/local/bin/run-server.py && \
    echo '            main_file = f' >> /usr/local/bin/run-server.py && \
    echo '            break' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    if not main_file:' >> /usr/local/bin/run-server.py && \
    echo '        for root, dirs, files in os.walk(WORKSPACE_PATH):' >> /usr/local/bin/run-server.py && \
    echo '            for file in files:' >> /usr/local/bin/run-server.py && \
    echo '                if file.endswith(".py") and not file.startswith("test_"):' >> /usr/local/bin/run-server.py && \
    echo '                    main_file = os.path.relpath(os.path.join(root, file), WORKSPACE_PATH)' >> /usr/local/bin/run-server.py && \
    echo '                    break' >> /usr/local/bin/run-server.py && \
    echo '            if main_file:' >> /usr/local/bin/run-server.py && \
    echo '                break' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    # Build test script using list join to avoid quote issues' >> /usr/local/bin/run-server.py && \
    echo '    lines = [' >> /usr/local/bin/run-server.py && \
    echo '        "#!/usr/bin/env python3",' >> /usr/local/bin/run-server.py && \
    echo '        "import sys",' >> /usr/local/bin/run-server.py && \
    echo '        "import subprocess",' >> /usr/local/bin/run-server.py && \
    echo '        "import os",' >> /usr/local/bin/run-server.py && \
    echo '        "",' >> /usr/local/bin/run-server.py && \
    echo '        f"sys.path.insert(0, {repr(WORKSPACE_PATH)})",' >> /usr/local/bin/run-server.py && \
    echo '        "",' >> /usr/local/bin/run-server.py && \
    echo '        f"test_input = {repr(test_input)}",' >> /usr/local/bin/run-server.py && \
    echo '        f"expected_output = {repr(expected_output)}",' >> /usr/local/bin/run-server.py && \
    echo '        "# Ensure test_input is a string",' >> /usr/local/bin/run-server.py && \
    echo '        "if isinstance(test_input, bytes):",' >> /usr/local/bin/run-server.py && \
    echo '        "    test_input = test_input.decode(\"utf-8\")",' >> /usr/local/bin/run-server.py && \
    echo '        "",' >> /usr/local/bin/run-server.py && \
    echo '        "try:",' >> /usr/local/bin/run-server.py && \
    echo '        f"    if {repr(main_file)}:",' >> /usr/local/bin/run-server.py && \
    printf '        "        result = subprocess.run(",\n' >> /usr/local/bin/run-server.py && \
    echo '        "            [" + repr("python3") + ", os.path.join(" + repr(WORKSPACE_PATH) + ", " + repr(main_file or "") + ")],",' >> /usr/local/bin/run-server.py && \
    echo '        "            input=test_input,",' >> /usr/local/bin/run-server.py && \
    echo '        "            capture_output=True,",' >> /usr/local/bin/run-server.py && \
    echo '        "            text=True,",' >> /usr/local/bin/run-server.py && \
    echo '        "            timeout=30",' >> /usr/local/bin/run-server.py && \
    echo '        "        )",' >> /usr/local/bin/run-server.py && \
    echo '        "        actual_output = result.stdout.strip()",' >> /usr/local/bin/run-server.py && \
    echo '        "        expected_output_stripped = expected_output.strip()",' >> /usr/local/bin/run-server.py && \
    echo '        "        if actual_output == expected_output_stripped:",' >> /usr/local/bin/run-server.py && \
    echo '        "            print(\\"PASS\\")",' >> /usr/local/bin/run-server.py && \
    echo '        "            sys.exit(0)",' >> /usr/local/bin/run-server.py && \
    echo '        "        else:",' >> /usr/local/bin/run-server.py && \
    echo '        "            print(f\\"FAIL: Expected: {expected_output_stripped}, Got: {actual_output}\\")",' >> /usr/local/bin/run-server.py && \
    echo '        "            sys.exit(1)",' >> /usr/local/bin/run-server.py && \
    echo '        "    else:",' >> /usr/local/bin/run-server.py && \
    echo '        "        print(\\"ERROR: No main Python file found in workspace\\")",' >> /usr/local/bin/run-server.py && \
    echo '        "        sys.exit(1)",' >> /usr/local/bin/run-server.py && \
    echo '        "except subprocess.TimeoutExpired:",' >> /usr/local/bin/run-server.py && \
    echo '        "    print(\\"ERROR: Test execution timed out\\")",' >> /usr/local/bin/run-server.py && \
    echo '        "    sys.exit(1)",' >> /usr/local/bin/run-server.py && \
    echo '        "except Exception as e:",' >> /usr/local/bin/run-server.py && \
    echo '        "    print(f\\"ERROR: {str(e)}\\")",' >> /usr/local/bin/run-server.py && \
    echo '        "    sys.exit(1)"' >> /usr/local/bin/run-server.py && \
    echo '    ]' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    with open(test_file_path, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '        f.write("\\n".join(lines))' >> /usr/local/bin/run-server.py && \
    echo '    os.chmod(test_file_path, 0o755)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def generate_unittest_test(test_case, test_file_path):' >> /usr/local/bin/run-server.py && \
    echo '    """Generate Python unittest test file"""' >> /usr/local/bin/run-server.py && \
    echo '    test_code = test_case.get("code", "")' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    # Always ensure unittest.main() is called, even if test code already imports unittest' >> /usr/local/bin/run-server.py && \
    echo '    # Check if unittest.main() is already in the code' >> /usr/local/bin/run-server.py && \
    echo '    if "__name__" not in test_code or "unittest.main()" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '        # Add sys.path and unittest.main() if not already present' >> /usr/local/bin/run-server.py && \
    echo '        # Use os.getcwd() to get the isolated test workspace at runtime' >> /usr/local/bin/run-server.py && \
    echo '        if "import sys" not in test_code and "import os" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '            test_code = f"import sys\\nimport os\\nsys.path.insert(0, os.getcwd())\\n{test_code}"' >> /usr/local/bin/run-server.py && \
    echo '        elif "import os" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '            # sys imported but not os, add os and path' >> /usr/local/bin/run-server.py && \
    echo '            test_code = test_code.replace("import sys", "import sys\\nimport os\\nsys.path.insert(0, os.getcwd())")' >> /usr/local/bin/run-server.py && \
    echo '        elif "import sys" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '            # os imported but not sys, add sys and path' >> /usr/local/bin/run-server.py && \
    echo '            test_code = test_code.replace("import os", "import sys\\nimport os\\nsys.path.insert(0, os.getcwd())")' >> /usr/local/bin/run-server.py && \
    echo '        elif "sys.path.insert" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '            # Both imported but path not set, add it after imports' >> /usr/local/bin/run-server.py && \
    echo '            # Find the last import statement and add after it' >> /usr/local/bin/run-server.py && \
    echo '            lines = test_code.split("\\n")' >> /usr/local/bin/run-server.py && \
    echo '            insert_idx = 0' >> /usr/local/bin/run-server.py && \
    echo '            for i, line in enumerate(lines):' >> /usr/local/bin/run-server.py && \
    echo '                if line.strip().startswith("import ") or line.strip().startswith("from "):' >> /usr/local/bin/run-server.py && \
    echo '                    insert_idx = i + 1' >> /usr/local/bin/run-server.py && \
    echo '            lines.insert(insert_idx, "sys.path.insert(0, os.getcwd())")' >> /usr/local/bin/run-server.py && \
    echo '            test_code = "\\n".join(lines)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Ensure unittest is imported' >> /usr/local/bin/run-server.py && \
    echo '        if "import unittest" not in test_code:' >> /usr/local/bin/run-server.py && \
    echo '            test_code = f"import unittest\\n{test_code}"' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Add unittest.main() call at the end' >> /usr/local/bin/run-server.py && \
    echo '        test_code = f"{test_code}\\n\\nif __name__ == \\"__main__\\":\\n    unittest.main()"' >> /usr/local/bin/run-server.py && \
    echo '    ' >> /usr/local/bin/run-server.py && \
    echo '    with open(test_file_path, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '        f.write(test_code)' >> /usr/local/bin/run-server.py && \
    echo '    os.chmod(test_file_path, 0o755)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def generate_junit_test(test_case, test_file_path):' >> /usr/local/bin/run-server.py && \
    echo '    """Generate Java JUnit test file"""' >> /usr/local/bin/run-server.py && \
    echo '    test_code = test_case.get("code", "")' >> /usr/local/bin/run-server.py && \
    echo '    with open(test_file_path, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '        f.write(test_code)' >> /usr/local/bin/run-server.py && \
    echo '    os.chmod(test_file_path, 0o755)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'def execute_test(test_file_path, test_type, framework=None):' >> /usr/local/bin/run-server.py && \
    echo '    """Execute test file and return results. Workspace files must already be in AUTOGRADER_PATH."""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        if test_type == "inputOutput":' >> /usr/local/bin/run-server.py && \
    echo '            result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '                ["python3", test_file_path],' >> /usr/local/bin/run-server.py && \
    echo '                capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '                text=True,' >> /usr/local/bin/run-server.py && \
    echo '                timeout=30,' >> /usr/local/bin/run-server.py && \
    echo '                cwd=AUTOGRADER_PATH' >> /usr/local/bin/run-server.py && \
    echo '            )' >> /usr/local/bin/run-server.py && \
    echo '            return result.returncode == 0, result.stdout + result.stderr, None' >> /usr/local/bin/run-server.py && \
    echo '        elif test_type == "unitTest":' >> /usr/local/bin/run-server.py && \
    echo '            if framework == "unittest":' >> /usr/local/bin/run-server.py && \
    echo '                # Start Xvfb for headless GUI support (for tkinter/pydraw)' >> /usr/local/bin/run-server.py && \
    echo '                xvfb_process = None' >> /usr/local/bin/run-server.py && \
    echo '                try:' >> /usr/local/bin/run-server.py && \
    echo '                    xvfb_process = subprocess.Popen(' >> /usr/local/bin/run-server.py && \
    echo '                        ["Xvfb", ":99", "-screen", "0", "1024x768x24", "-ac", "+extension", "GLX", "+render", "-noreset"],' >> /usr/local/bin/run-server.py && \
    echo '                        stdout=subprocess.DEVNULL,' >> /usr/local/bin/run-server.py && \
    echo '                        stderr=subprocess.DEVNULL' >> /usr/local/bin/run-server.py && \
    echo '                    )' >> /usr/local/bin/run-server.py && \
    echo '                    time.sleep(0.5)' >> /usr/local/bin/run-server.py && \
    echo '                    env = os.environ.copy()' >> /usr/local/bin/run-server.py && \
    echo '                    env["DISPLAY"] = ":99"' >> /usr/local/bin/run-server.py && \
    echo '                    result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '                        ["python3", test_file_path],' >> /usr/local/bin/run-server.py && \
    echo '                        capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '                        text=True,' >> /usr/local/bin/run-server.py && \
    echo '                        timeout=30,' >> /usr/local/bin/run-server.py && \
    echo '                        cwd=AUTOGRADER_PATH,' >> /usr/local/bin/run-server.py && \
    echo '                        env=env' >> /usr/local/bin/run-server.py && \
    echo '                    )' >> /usr/local/bin/run-server.py && \
    echo '                    return result.returncode == 0, result.stdout + result.stderr, None' >> /usr/local/bin/run-server.py && \
    echo '                finally:' >> /usr/local/bin/run-server.py && \
    echo '                    if xvfb_process:' >> /usr/local/bin/run-server.py && \
    echo '                        try:' >> /usr/local/bin/run-server.py && \
    echo '                            xvfb_process.terminate()' >> /usr/local/bin/run-server.py && \
    echo '                            xvfb_process.wait(timeout=2)' >> /usr/local/bin/run-server.py && \
    echo '                        except:' >> /usr/local/bin/run-server.py && \
    echo '                            xvfb_process.kill()' >> /usr/local/bin/run-server.py && \
    echo '                            xvfb_process.wait()' >> /usr/local/bin/run-server.py && \
    echo '            elif framework == "junit":' >> /usr/local/bin/run-server.py && \
    echo '                test_basename = os.path.basename(test_file_path)' >> /usr/local/bin/run-server.py && \
    echo '                compile_result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '                    ["javac", "-cp", ".:/usr/share/java/junit.jar", test_file_path],' >> /usr/local/bin/run-server.py && \
    echo '                    capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '                    text=True,' >> /usr/local/bin/run-server.py && \
    echo '                    timeout=30,' >> /usr/local/bin/run-server.py && \
    echo '                    cwd=AUTOGRADER_PATH' >> /usr/local/bin/run-server.py && \
    echo '                )' >> /usr/local/bin/run-server.py && \
    echo '                if compile_result.returncode != 0:' >> /usr/local/bin/run-server.py && \
    echo '                    return False, compile_result.stdout + compile_result.stderr, "Compilation failed"' >> /usr/local/bin/run-server.py && \
    echo '                test_class = os.path.splitext(test_basename)[0]' >> /usr/local/bin/run-server.py && \
    echo '                result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '                    ["java", "-cp", ".:/usr/share/java/junit.jar:/usr/share/java/hamcrest-core.jar", "org.junit.runner.JUnitCore", test_class],' >> /usr/local/bin/run-server.py && \
    echo '                    capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '                    text=True,' >> /usr/local/bin/run-server.py && \
    echo '                    timeout=30,' >> /usr/local/bin/run-server.py && \
    echo '                    cwd=AUTOGRADER_PATH' >> /usr/local/bin/run-server.py && \
    echo '                )' >> /usr/local/bin/run-server.py && \
    echo '                return result.returncode == 0, result.stdout + result.stderr, None' >> /usr/local/bin/run-server.py && \
    echo '        return False, "", "Unknown test type"' >> /usr/local/bin/run-server.py && \
    echo '    except subprocess.TimeoutExpired:' >> /usr/local/bin/run-server.py && \
    echo '        return False, "", "Test execution timed out"' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return False, "", str(e)' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/sync", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def sync_to_s3():' >> /usr/local/bin/run-server.py && \
    echo '    """Force immediate sync of workspace to S3"""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        import os' >> /usr/local/bin/run-server.py && \
    echo '        S3_ASSIGNMENT_FILE = "/tmp/s3-assignment.json"' >> /usr/local/bin/run-server.py && \
    echo '        WORKSPACE_PATH = "/workspace"' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Read S3 config from assignment file' >> /usr/local/bin/run-server.py && \
    echo '        if not os.path.exists(S3_ASSIGNMENT_FILE):' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "S3 bucket not assigned"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        import json' >> /usr/local/bin/run-server.py && \
    echo '        with open(S3_ASSIGNMENT_FILE, "r") as f:' >> /usr/local/bin/run-server.py && \
    echo '            s3_config = json.load(f)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        S3_BUCKET = s3_config.get("bucket")' >> /usr/local/bin/run-server.py && \
    echo '        S3_REGION = s3_config.get("region", "us-east-1")' >> /usr/local/bin/run-server.py && \
    echo '        AWS_ACCESS_KEY_ID = s3_config.get("accessKeyId")' >> /usr/local/bin/run-server.py && \
    echo '        AWS_SECRET_ACCESS_KEY = s3_config.get("secretAccessKey")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        if not S3_BUCKET:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "S3 bucket not configured"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Set environment variables for rclone' >> /usr/local/bin/run-server.py && \
    echo '        env = os.environ.copy()' >> /usr/local/bin/run-server.py && \
    echo '        env["S3_BUCKET"] = S3_BUCKET' >> /usr/local/bin/run-server.py && \
    echo '        env["S3_REGION"] = S3_REGION' >> /usr/local/bin/run-server.py && \
    echo '        if AWS_ACCESS_KEY_ID:' >> /usr/local/bin/run-server.py && \
    echo '            env["AWS_ACCESS_KEY_ID"] = AWS_ACCESS_KEY_ID' >> /usr/local/bin/run-server.py && \
    echo '        if AWS_SECRET_ACCESS_KEY:' >> /usr/local/bin/run-server.py && \
    echo '            env["AWS_SECRET_ACCESS_KEY"] = AWS_SECRET_ACCESS_KEY' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Run rclone copy to force sync' >> /usr/local/bin/run-server.py && \
    echo '        S3_PATH = f"s3:{S3_BUCKET}"' >> /usr/local/bin/run-server.py && \
    echo '        result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '            ["rclone", "copy", WORKSPACE_PATH, S3_PATH,' >> /usr/local/bin/run-server.py && \
    echo '             "--transfers", "4",' >> /usr/local/bin/run-server.py && \
    echo '             "--exclude", ".git/**",' >> /usr/local/bin/run-server.py && \
    echo '             "--exclude", "node_modules/**",' >> /usr/local/bin/run-server.py && \
    echo '             "--exclude", "__pycache__/**",' >> /usr/local/bin/run-server.py && \
    echo '             "--exclude", ".vscode/**",' >> /usr/local/bin/run-server.py && \
    echo '             "--exclude", ".idea/**"],' >> /usr/local/bin/run-server.py && \
    echo '            capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '            text=True,' >> /usr/local/bin/run-server.py && \
    echo '            env=env,' >> /usr/local/bin/run-server.py && \
    echo '            timeout=60' >> /usr/local/bin/run-server.py && \
    echo '        )' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        if result.returncode != 0:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": f"Sync failed: {result.stderr}"}), 500' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Log the sync output for debugging' >> /usr/local/bin/run-server.py && \
    echo '        print(f"Sync output: {result.stdout}")' >> /usr/local/bin/run-server.py && \
    echo '        if result.stderr:' >> /usr/local/bin/run-server.py && \
    echo '            print(f"Sync errors: {result.stderr}")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Verify files are actually in S3 by listing them' >> /usr/local/bin/run-server.py && \
    echo '        import time' >> /usr/local/bin/run-server.py && \
    echo '        time.sleep(2)  # Brief delay for S3 eventual consistency' >> /usr/local/bin/run-server.py && \
    echo '        verify_result = subprocess.run(' >> /usr/local/bin/run-server.py && \
    echo '            ["rclone", "ls", S3_PATH],' >> /usr/local/bin/run-server.py && \
    echo '            capture_output=True,' >> /usr/local/bin/run-server.py && \
    echo '            text=True,' >> /usr/local/bin/run-server.py && \
    echo '            env=env,' >> /usr/local/bin/run-server.py && \
    echo '            timeout=30' >> /usr/local/bin/run-server.py && \
    echo '        )' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        if verify_result.returncode == 0:' >> /usr/local/bin/run-server.py && \
    echo '            s3_files = [line.split()[-1] for line in verify_result.stdout.strip().split("\\n") if line.strip()]' >> /usr/local/bin/run-server.py && \
    echo '            file_count = len(s3_files)' >> /usr/local/bin/run-server.py && \
    echo '            # Verify main.py was copied if it exists in workspace' >> /usr/local/bin/run-server.py && \
    echo '            main_py_path = os.path.join(WORKSPACE_PATH, "main.py")' >> /usr/local/bin/run-server.py && \
    echo '            main_py_in_s3 = "main.py" in s3_files' >> /usr/local/bin/run-server.py && \
    echo '            main_py_exists = os.path.exists(main_py_path)' >> /usr/local/bin/run-server.py && \
    echo '            if main_py_exists and not main_py_in_s3:' >> /usr/local/bin/run-server.py && \
    echo '                return jsonify({"error": "main.py exists in workspace but not found in S3 after sync", "s3_files": s3_files[:10]}), 500' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({' >> /usr/local/bin/run-server.py && \
    echo '                "status": "success",' >> /usr/local/bin/run-server.py && \
    echo '                "message": "Workspace synced to S3 and verified",' >> /usr/local/bin/run-server.py && \
    echo '                "files_synced": file_count,' >> /usr/local/bin/run-server.py && \
    echo '                "sync_output": result.stdout,' >> /usr/local/bin/run-server.py && \
    echo '                "s3_files": s3_files[:10]  # First 10 files for debugging' >> /usr/local/bin/run-server.py && \
    echo '            }), 200' >> /usr/local/bin/run-server.py && \
    echo '        else:' >> /usr/local/bin/run-server.py && \
    echo '            # Sync completed but verification failed - still return success as sync worked' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"status": "success", "message": "Workspace synced to S3 (verification failed)", "warning": verify_result.stderr}), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/run-tests", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def run_tests():' >> /usr/local/bin/run-server.py && \
    echo '    """Run autograder tests against workspace code"""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        data = request.get_json()' >> /usr/local/bin/run-server.py && \
    echo '        if not data:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "No JSON data provided"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        tests = data.get("tests", [])' >> /usr/local/bin/run-server.py && \
    echo '        if not tests:' >> /usr/local/bin/run-server.py && \
    echo '            return jsonify({"error": "No tests provided"}), 400' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        results = []' >> /usr/local/bin/run-server.py && \
    echo '        total_points = 0' >> /usr/local/bin/run-server.py && \
    echo '        points_earned = 0' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Flush pending writes and pull latest files before running tests' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            import urllib.request' >> /usr/local/bin/run-server.py && \
    echo '            flush_req = urllib.request.Request("http://127.0.0.1:3001/flush", method="POST")' >> /usr/local/bin/run-server.py && \
    echo '            flush_resp = urllib.request.urlopen(flush_req, timeout=10)' >> /usr/local/bin/run-server.py && \
    echo '            print(f"Flushed and pulled files before tests: {flush_resp.read().decode()}")' >> /usr/local/bin/run-server.py && \
    echo '        except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '            print(f"WARNING: Failed to flush/pull files before tests: {e}")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        os.makedirs(AUTOGRADER_PATH, exist_ok=True)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Copy workspace files to autograder-copy so test imports resolve' >> /usr/local/bin/run-server.py && \
    echo '        import shutil' >> /usr/local/bin/run-server.py && \
    echo '        print("[Test] Copying workspace files to autograder-copy")' >> /usr/local/bin/run-server.py && \
    echo '        shutil.copytree(WORKSPACE_PATH, AUTOGRADER_PATH, symlinks=True, dirs_exist_ok=True)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        for test_case in tests:' >> /usr/local/bin/run-server.py && \
    echo '            test_id = test_case.get("id", "unknown")' >> /usr/local/bin/run-server.py && \
    echo '            test_name = test_case.get("name", "Unnamed Test")' >> /usr/local/bin/run-server.py && \
    echo '            test_type = test_case.get("type")' >> /usr/local/bin/run-server.py && \
    echo '            points = test_case.get("points", 0)' >> /usr/local/bin/run-server.py && \
    echo '            total_points += points' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            if test_type == "manualGrading":' >> /usr/local/bin/run-server.py && \
    echo '                continue' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            test_filename = f"test_{test_id}.py" if test_type != "unitTest" or test_case.get("framework") == "unittest" else f"Test_{test_id}.java"' >> /usr/local/bin/run-server.py && \
    echo '            test_file_path = os.path.join(AUTOGRADER_PATH, test_filename)' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            try:' >> /usr/local/bin/run-server.py && \
    echo '                if test_type == "inputOutput":' >> /usr/local/bin/run-server.py && \
    echo '                    generate_input_output_test(test_case, test_file_path)' >> /usr/local/bin/run-server.py && \
    echo '                    passed, output, error = execute_test(test_file_path, "inputOutput")' >> /usr/local/bin/run-server.py && \
    echo '                elif test_type == "unitTest":' >> /usr/local/bin/run-server.py && \
    echo '                    framework = test_case.get("framework", "unittest")' >> /usr/local/bin/run-server.py && \
    echo '                    if framework == "unittest":' >> /usr/local/bin/run-server.py && \
    echo '                        generate_unittest_test(test_case, test_file_path)' >> /usr/local/bin/run-server.py && \
    echo '                        passed, output, error = execute_test(test_file_path, "unitTest", "unittest")' >> /usr/local/bin/run-server.py && \
    echo '                    elif framework == "junit":' >> /usr/local/bin/run-server.py && \
    echo '                        generate_junit_test(test_case, test_file_path)' >> /usr/local/bin/run-server.py && \
    echo '                        passed, output, error = execute_test(test_file_path, "unitTest", "junit")' >> /usr/local/bin/run-server.py && \
    echo '                    else:' >> /usr/local/bin/run-server.py && \
    echo '                        passed, output, error = False, "", f"Unknown framework: {framework}"' >> /usr/local/bin/run-server.py && \
    echo '                else:' >> /usr/local/bin/run-server.py && \
    echo '                    passed, output, error = False, "", f"Unknown test type: {test_type}"' >> /usr/local/bin/run-server.py && \
    echo '                ' >> /usr/local/bin/run-server.py && \
    echo '                points_earned_for_test = points if passed else 0' >> /usr/local/bin/run-server.py && \
    echo '                points_earned += points_earned_for_test' >> /usr/local/bin/run-server.py && \
    echo '                ' >> /usr/local/bin/run-server.py && \
    echo '                results.append({' >> /usr/local/bin/run-server.py && \
    echo '                    "testId": test_id,' >> /usr/local/bin/run-server.py && \
    echo '                    "testName": test_name,' >> /usr/local/bin/run-server.py && \
    echo '                    "passed": passed,' >> /usr/local/bin/run-server.py && \
    echo '                    "points": points,' >> /usr/local/bin/run-server.py && \
    echo '                    "pointsEarned": points_earned_for_test,' >> /usr/local/bin/run-server.py && \
    echo '                    "output": output,' >> /usr/local/bin/run-server.py && \
    echo '                    "error": error' >> /usr/local/bin/run-server.py && \
    echo '                })' >> /usr/local/bin/run-server.py && \
    echo '            except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '                results.append({' >> /usr/local/bin/run-server.py && \
    echo '                    "testId": test_id,' >> /usr/local/bin/run-server.py && \
    echo '                    "testName": test_name,' >> /usr/local/bin/run-server.py && \
    echo '                    "passed": False,' >> /usr/local/bin/run-server.py && \
    echo '                    "points": points,' >> /usr/local/bin/run-server.py && \
    echo '                    "pointsEarned": 0,' >> /usr/local/bin/run-server.py && \
    echo '                    "output": "",' >> /usr/local/bin/run-server.py && \
    echo '                    "error": str(e)' >> /usr/local/bin/run-server.py && \
    echo '                })' >> /usr/local/bin/run-server.py && \
    echo '            finally:' >> /usr/local/bin/run-server.py && \
    echo '                if os.path.exists(test_file_path):' >> /usr/local/bin/run-server.py && \
    echo '                    try:' >> /usr/local/bin/run-server.py && \
    echo '                        os.remove(test_file_path)' >> /usr/local/bin/run-server.py && \
    echo '                    except:' >> /usr/local/bin/run-server.py && \
    echo '                        pass' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Clean up workspace files from autograder-copy' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            shutil.rmtree(AUTOGRADER_PATH)' >> /usr/local/bin/run-server.py && \
    echo '            print("[Test] Cleaned up autograder-copy")' >> /usr/local/bin/run-server.py && \
    echo '        except Exception as cleanup_err:' >> /usr/local/bin/run-server.py && \
    echo '            print(f"[Test] Warning: Failed to clean up autograder-copy: {cleanup_err}")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({' >> /usr/local/bin/run-server.py && \
    echo '            "status": "success",' >> /usr/local/bin/run-server.py && \
    echo '            "results": results,' >> /usr/local/bin/run-server.py && \
    echo '            "totalPoints": total_points,' >> /usr/local/bin/run-server.py && \
    echo '            "pointsEarned": points_earned' >> /usr/local/bin/run-server.py && \
    echo '        }), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        # Clean up on error too' >> /usr/local/bin/run-server.py && \
    echo '        try:' >> /usr/local/bin/run-server.py && \
    echo '            import shutil as _shutil' >> /usr/local/bin/run-server.py && \
    echo '            _shutil.rmtree(AUTOGRADER_PATH, ignore_errors=True)' >> /usr/local/bin/run-server.py && \
    echo '        except:' >> /usr/local/bin/run-server.py && \
    echo '            pass' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo '@app.route("/kill", methods=["POST"])' >> /usr/local/bin/run-server.py && \
    echo 'def kill_container():' >> /usr/local/bin/run-server.py && \
    echo '    """Kill the container by triggering shutdown - same logic as inactivity monitor"""' >> /usr/local/bin/run-server.py && \
    echo '    try:' >> /usr/local/bin/run-server.py && \
    echo '        # Get container ID from environment' >> /usr/local/bin/run-server.py && \
    echo '        container_id = os.environ.get("CONTAINER_ID", "")' >> /usr/local/bin/run-server.py && \
    echo '        management_api_url = os.environ.get("MANAGEMENT_API_URL", "http://localhost")' >> /usr/local/bin/run-server.py && \
    echo '        WORKSPACE_PATH = "/workspace"' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Send response first, then shutdown in background thread' >> /usr/local/bin/run-server.py && \
    echo '        import threading' >> /usr/local/bin/run-server.py && \
    echo '        def shutdown_container():' >> /usr/local/bin/run-server.py && \
    echo '            """Shutdown container using same logic as inactivity monitor"""' >> /usr/local/bin/run-server.py && \
    echo '            time.sleep(0.5)  # Give time for HTTP response to be sent' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            # Stop the rclone sync loop first' >> /usr/local/bin/run-server.py && \
    echo '            subprocess.run(["pkill", "-f", "rclone-sync-loop.sh"], capture_output=True)' >> /usr/local/bin/run-server.py && \
    echo '            subprocess.run(["pkill", "-f", "rclone sync"], capture_output=True)' >> /usr/local/bin/run-server.py && \
    echo '            time.sleep(2)' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            # Perform final S3 sync' >> /usr/local/bin/run-server.py && \
    echo '            try:' >> /usr/local/bin/run-server.py && \
    echo '                S3_ASSIGNMENT_FILE = "/tmp/s3-assignment.json"' >> /usr/local/bin/run-server.py && \
    echo '                S3_BUCKET = os.environ.get("S3_BUCKET")' >> /usr/local/bin/run-server.py && \
    echo '                ' >> /usr/local/bin/run-server.py && \
    echo '                # Check assignment file if S3_BUCKET not in env' >> /usr/local/bin/run-server.py && \
    echo '                if not S3_BUCKET and os.path.exists(S3_ASSIGNMENT_FILE):' >> /usr/local/bin/run-server.py && \
    echo '                    import json' >> /usr/local/bin/run-server.py && \
    echo '                    with open(S3_ASSIGNMENT_FILE, "r") as f:' >> /usr/local/bin/run-server.py && \
    echo '                        s3_config = json.load(f)' >> /usr/local/bin/run-server.py && \
    echo '                    S3_BUCKET = s3_config.get("bucket")' >> /usr/local/bin/run-server.py && \
    echo '                ' >> /usr/local/bin/run-server.py && \
    echo '                if S3_BUCKET:' >> /usr/local/bin/run-server.py && \
    echo '                    env = os.environ.copy()' >> /usr/local/bin/run-server.py && \
    echo '                    env["S3_BUCKET"] = S3_BUCKET' >> /usr/local/bin/run-server.py && \
    echo '                    subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '                        "rclone", "sync", WORKSPACE_PATH, f"s3:{S3_BUCKET}",' >> /usr/local/bin/run-server.py && \
    echo '                        "--progress", "--verbose"' >> /usr/local/bin/run-server.py && \
    echo '                    ], env=env, timeout=30, capture_output=True)' >> /usr/local/bin/run-server.py && \
    echo '            except Exception:' >> /usr/local/bin/run-server.py && \
    echo '                pass  # Continue even if sync fails' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            # Notify management API of manual shutdown' >> /usr/local/bin/run-server.py && \
    echo '            if container_id and management_api_url:' >> /usr/local/bin/run-server.py && \
    echo '                try:' >> /usr/local/bin/run-server.py && \
    echo '                    subprocess.run([' >> /usr/local/bin/run-server.py && \
    echo '                        "curl", "-s", "-X", "POST",' >> /usr/local/bin/run-server.py && \
    echo '                        f"{management_api_url}/api/containers/{container_id}/inactivity-shutdown",' >> /usr/local/bin/run-server.py && \
    echo '                        "-H", "Content-Type: application/json",' >> /usr/local/bin/run-server.py && \
    echo '                        "-d", "{\\"reason\\": \\"manual-kill\\"}",' >> /usr/local/bin/run-server.py && \
    echo '                        "--max-time", "5"' >> /usr/local/bin/run-server.py && \
    echo '                    ], timeout=5, capture_output=True)' >> /usr/local/bin/run-server.py && \
    echo '                except Exception:' >> /usr/local/bin/run-server.py && \
    echo '                    pass  # Continue even if notification fails' >> /usr/local/bin/run-server.py && \
    echo '            ' >> /usr/local/bin/run-server.py && \
    echo '            # Kill all processes and exit (same as inactivity monitor)' >> /usr/local/bin/run-server.py && \
    echo '            subprocess.run(["killall5", "-9"], capture_output=True)' >> /usr/local/bin/run-server.py && \
    echo '            os._exit(0)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        threading.Thread(target=shutdown_container, daemon=False).start()' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"status": "success", "message": "Container shutdown initiated"}), 200' >> /usr/local/bin/run-server.py && \
    echo '    except Exception as e:' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({"error": str(e)}), 500' >> /usr/local/bin/run-server.py && \
    echo '' >> /usr/local/bin/run-server.py && \
    echo 'if __name__ == "__main__":' >> /usr/local/bin/run-server.py && \
    echo '    app.run(host="0.0.0.0", port=3000, debug=False)' >> /usr/local/bin/run-server.py && \
    chmod +x /usr/local/bin/run-server.py

# Rclone Workspace to S3 Sync Loop (push-only, never overwrites local changes)
RUN echo '#!/bin/bash' > /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Don'\''t use set -e - we want to continue even if individual operations fail' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Starting rclone sync loop..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Get S3 config from env var or assignment file' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Wait for assignment file if not present' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ ! -f "$S3_ASSIGNMENT_FILE" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Waiting for S3 bucket assignment..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        while [ ! -f "$S3_ASSIGNMENT_FILE" ]; do' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '            sleep 2' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        done' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Read assignment from file (with error handling)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Reading S3 assignment from $S3_ASSIGNMENT_FILE..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    S3_BUCKET=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"bucket\", \"\"))" 2>/dev/null || echo "")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    S3_REGION=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"region\", \"us-east-1\"))" 2>/dev/null || echo "us-east-1")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    AWS_ACCESS_KEY_ID=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"accessKeyId\", \"\") or \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    AWS_SECRET_ACCESS_KEY=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"secretAccessKey\", \"\") or \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    export S3_BUCKET S3_REGION' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$AWS_ACCESS_KEY_ID" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        export AWS_ACCESS_KEY_ID' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$AWS_SECRET_ACCESS_KEY" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        export AWS_SECRET_ACCESS_KEY' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Update rclone config with region (ignore errors)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$S3_REGION" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        sed -i "s/region = .*/region = $S3_REGION/" /home/user/.config/rclone/rclone.conf 2>/dev/null || true' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] ERROR: S3_BUCKET not set and assignment file not found"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    exit 1' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Using S3 bucket: $S3_BUCKET (region: ${S3_REGION:-us-east-1})"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'S3_PATH="s3:${S3_BUCKET}"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Perform initial download from S3 ONLY if workspace is empty (don'\''t overwrite existing files)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$(ls -A $WORKSPACE_PATH 2>/dev/null)" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Workspace is empty, performing initial download from S3..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    rclone sync "$S3_PATH" "$WORKSPACE_PATH" --progress --transfers 4 --checkers 8 2>&1 || {' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] WARNING: Initial S3 download failed (bucket might be empty or not exist yet)"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    }' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Initial download complete."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'else' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Workspace already has files, skipping initial download to preserve local changes."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Starting pull-only sync with S3 (pull every 10s, never push)..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Continuous sync: Pull from S3 every 10 seconds, NEVER push to S3' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Frontend writes directly to S3 via backend API, container only reads' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'while true; do' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    sleep 10' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    ' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Pull from S3 every 10 seconds (update only, won'\''t overwrite newer local files)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Pulling changes from S3..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    export HOME=/home/user' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    PULL_OUTPUT=$(rclone sync "$S3_PATH" "$WORKSPACE_PATH" --update --transfers 4 --checkers 8 --exclude ".git/**" --exclude "node_modules/**" --exclude "__pycache__/**" --exclude ".vscode/**" --exclude ".idea/**" 2>&1)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    PULL_EXIT_CODE=$?' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ $PULL_EXIT_CODE -ne 0 ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] ERROR: rclone pull failed with exit code $PULL_EXIT_CODE"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Error output: $PULL_OUTPUT"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    else' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "$PULL_OUTPUT" | grep -E "(Copied|Transferred|ERROR|WARNING|INFO.*file)" | head -20 || echo "No changes to pull"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'done' >> /usr/local/bin/rclone-sync-loop.sh && \
    chmod +x /usr/local/bin/rclone-sync-loop.sh

# File Watcher - watches /workspace for changes and pushes to backend API
COPY file-watcher.sh /usr/local/bin/file-watcher.sh
RUN chmod +x /usr/local/bin/file-watcher.sh

# Install Node.js packages for container file sync
RUN npm install -g chokidar && \
    echo 'export NODE_PATH=/usr/lib/node_modules' >> /etc/profile && \
    echo 'export NODE_PATH=/usr/lib/node_modules' >> /home/user/.bashrc && \
    ls -la /usr/lib/node_modules/ | grep chokidar && \
    echo "Container sync packages installed" && \
    node --version

# Container File Sync - watches filesystem and pushes changes via REST
COPY container-file-sync.js /usr/local/bin/container-file-sync.js
RUN chmod +x /usr/local/bin/container-file-sync.js

# Autograder Copy Loop (copies directly from workspace, no S3 needed)
RUN echo '#!/bin/bash' > /usr/local/bin/rclone-autograder-sync.sh && \
    echo '# Don'\''t use set -e - we want to continue even if individual operations fail' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Starting autograder copy from workspace..."' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'AUTOGRADER_PATH="/autograder-copy"' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '# Perform initial copy from workspace on startup' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Performing initial copy from workspace to autograder-copy..."' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'if rsync -av --delete "$WORKSPACE_PATH/" "$AUTOGRADER_PATH/" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    --exclude ".git" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    --exclude "node_modules" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    --exclude "__pycache__" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    --exclude ".vscode" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    --exclude ".idea" 2>&1; then' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Initial copy complete."' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'else' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] WARNING: Initial copy to autograder-copy failed, will retry in loop"' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'fi' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Starting continuous copy from workspace to autograder-copy (every 15 seconds)..."' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '# Continuous copy: copy from workspace to autograder-copy (one-way, read-only for autograder)' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '# Stagger this copy to run 5 seconds after workspace sync to avoid conflicts' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'sleep 5' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'while true; do' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    sleep 15' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Copying workspace to autograder-copy..."' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    if rsync -av --delete "$WORKSPACE_PATH/" "$AUTOGRADER_PATH/" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        --exclude ".git" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        --exclude "node_modules" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        --exclude "__pycache__" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        --exclude ".vscode" \' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        --exclude ".idea" 2>&1; then' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] Workspace to autograder-copy copy complete"' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    else' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '        echo "[$(date +%Y-%m-%d\ %H:%M:%S)] WARNING: Workspace to autograder-copy copy failed, will retry in 15 seconds"' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo '    fi' >> /usr/local/bin/rclone-autograder-sync.sh && \
    echo 'done' >> /usr/local/bin/rclone-autograder-sync.sh && \
    chmod +x /usr/local/bin/rclone-autograder-sync.sh

# Inactivity Monitor
RUN echo '#!/bin/bash' > /usr/local/bin/inactivity-monitor.sh && \
    echo 'set -e' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'TIMEOUT_SECONDS="${INACTIVITY_TIMEOUT_SECONDS:-600}"' >> /usr/local/bin/inactivity-monitor.sh && \
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
    echo '    # Call shutdown webhook to notify management API' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if [ -n "$CONTAINER_ID" ] && [ -n "$MANAGEMENT_API_URL" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        echo "Notifying management API of inactivity shutdown..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        curl -s -X POST "${MANAGEMENT_API_URL}/api/containers/${CONTAINER_ID}/inactivity-shutdown" \\' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '            -H "Content-Type: application/json" \\' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '            -d "{\\"reason\\":\\"inactivity\\"}" || echo "Warning: Failed to notify management API"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Kill all processes and exit' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    killall5 -9 || true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    exit 0' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '}' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'while true; do' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Check for S3 bucket assignment (either via env var or assignment file)' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    HAS_S3_BUCKET=false' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if [ -n "$S3_BUCKET" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        HAS_S3_BUCKET=true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    elif [ -f "$S3_ASSIGNMENT_FILE" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        # Check if assignment file has a bucket (pre-warmed containers)' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        ASSIGNED_BUCKET=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"bucket\", \"\") or \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        if [ -n "$ASSIGNED_BUCKET" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '            HAS_S3_BUCKET=true' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if [ "$HAS_S3_BUCKET" = "false" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        echo "Pre-warmed container (no S3_BUCKET) - skipping inactivity monitor, waiting for S3 assignment..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        sleep 60' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        continue' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Wait for initial S3 sync to complete before starting inactivity monitoring' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    # Check if S3 sync is still running (rclone-sync-loop.sh)' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if pgrep -f "rclone-sync-loop.sh" > /dev/null || pgrep -f "rclone sync" > /dev/null; then' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        echo "S3 sync still running, skipping inactivity check..."' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        sleep 30' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '        continue' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    fi' >> /usr/local/bin/inactivity-monitor.sh && \
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
    echo '# Start ttyd terminal server on localhost:7681 (nginx will proxy it)' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Starting ttyd terminal on 127.0.0.1:7681..."' >> /usr/local/bin/entrypoint.sh && \
    echo '# Ensure tmux session exists for code execution' >> /usr/local/bin/entrypoint.sh && \
    echo 'su - user -c "tmux new-session -d -s code_runner -c /workspace || true"' >> /usr/local/bin/entrypoint.sh && \
    echo '# Create a wrapper script that attaches to tmux session' >> /usr/local/bin/entrypoint.sh && \
    echo 'cat > /usr/local/bin/ttyd-bash-wrapper.sh << '\''WRAPPEREOF'\''' >> /usr/local/bin/entrypoint.sh && \
    echo '#!/bin/bash' >> /usr/local/bin/entrypoint.sh && \
    echo '# Attach to tmux session if it exists, otherwise start bash' >> /usr/local/bin/entrypoint.sh && \
    echo 'if tmux has-session -t code_runner 2>/dev/null; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    exec tmux attach-session -t code_runner' >> /usr/local/bin/entrypoint.sh && \
    echo 'else' >> /usr/local/bin/entrypoint.sh && \
    echo '    exec bash -il' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo 'WRAPPEREOF' >> /usr/local/bin/entrypoint.sh && \
    echo 'chmod +x /usr/local/bin/ttyd-bash-wrapper.sh' >> /usr/local/bin/entrypoint.sh && \
    echo '# Start ttyd with wrapper that attaches to tmux - this allows run endpoint output to be visible' >> /usr/local/bin/entrypoint.sh && \
    echo 'su - user -c '\''ttyd -p 7681 -i lo -W -t titleFixed="Terminal" -t fontSize=14 -t cursorBlink=true /usr/local/bin/ttyd-bash-wrapper.sh'\'' &' >> /usr/local/bin/entrypoint.sh && \
    echo 'sleep 1' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Configure nginx to proxy ttyd terminal and web server' >> /usr/local/bin/entrypoint.sh && \
    echo 'mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled' >> /usr/local/bin/entrypoint.sh && \
    echo '# Add map directive to nginx.conf for WebSocket upgrade (must be in http context)' >> /usr/local/bin/entrypoint.sh && \
    echo 'if ! grep -q "map.*connection_upgrade" /etc/nginx/nginx.conf; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    python3 << '\''PYEOF'\''' >> /usr/local/bin/entrypoint.sh && \
    echo 'import re' >> /usr/local/bin/entrypoint.sh && \
    echo 'with open("/etc/nginx/nginx.conf", "r") as f:' >> /usr/local/bin/entrypoint.sh && \
    echo '    content = f.read()' >> /usr/local/bin/entrypoint.sh && \
    echo 'map_lines = [' >> /usr/local/bin/entrypoint.sh && \
    echo '    "    map $http_upgrade $connection_upgrade {",' >> /usr/local/bin/entrypoint.sh && \
    echo '    "        default upgrade;",' >> /usr/local/bin/entrypoint.sh && \
    echo '    "        \\"\\" close;",' >> /usr/local/bin/entrypoint.sh && \
    echo '    "    }"' >> /usr/local/bin/entrypoint.sh && \
    echo ']' >> /usr/local/bin/entrypoint.sh && \
    echo 'map_block = "\\n".join(map_lines) + "\\n"' >> /usr/local/bin/entrypoint.sh && \
    echo 'content = re.sub(r"(^http \\{)", r"\\1\\n" + map_block, content, flags=re.MULTILINE)' >> /usr/local/bin/entrypoint.sh && \
    echo 'with open("/etc/nginx/nginx.conf", "w") as f:' >> /usr/local/bin/entrypoint.sh && \
    echo '    f.write(content)' >> /usr/local/bin/entrypoint.sh && \
    echo 'PYEOF' >> /usr/local/bin/entrypoint.sh && \
    echo 'fi' >> /usr/local/bin/entrypoint.sh && \
    echo 'cat > /etc/nginx/sites-available/ide-server << '\''NGINXEOF'\''' >> /usr/local/bin/entrypoint.sh && \
    echo 'server {' >> /usr/local/bin/entrypoint.sh && \
    echo '    listen 8080;' >> /usr/local/bin/entrypoint.sh && \
    echo '    server_name _;' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Proxy ttyd terminal requests' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Traefik strips /terminal/{containerId} prefix, so we handle root path' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Note: /web/ requests go directly to port 3000 via Traefik, not through this nginx' >> /usr/local/bin/entrypoint.sh && \
    echo '    location / {' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_pass http://127.0.0.1:7681;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_http_version 1.1;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Upgrade $http_upgrade;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Connection $connection_upgrade;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Host $host;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Real-IP $remote_addr;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Forwarded-Proto $scheme;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_read_timeout 300s;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_send_timeout 300s;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_buffering off;' >> /usr/local/bin/entrypoint.sh && \
    echo '    }' >> /usr/local/bin/entrypoint.sh && \
    echo '}' >> /usr/local/bin/entrypoint.sh && \
    echo 'NGINXEOF' >> /usr/local/bin/entrypoint.sh && \
    echo 'ln -sf /etc/nginx/sites-available/ide-server /etc/nginx/sites-enabled/' >> /usr/local/bin/entrypoint.sh && \
    echo 'rm -f /etc/nginx/sites-enabled/default' >> /usr/local/bin/entrypoint.sh && \
    echo 'nginx -t' >> /usr/local/bin/entrypoint.sh && \
    echo 'nginx -g "daemon off;" &' >> /usr/local/bin/entrypoint.sh && \
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
    echo '# Start rclone sync loop - either from env var or wait for assignment' >> /usr/local/bin/entrypoint.sh && \
    echo 'if [ -n "$S3_BUCKET" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Write assignment file for new containers' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "S3_BUCKET is set, writing assignment file..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    python3 << EOF' >> /usr/local/bin/entrypoint.sh && \
    echo 'import json' >> /usr/local/bin/entrypoint.sh && \
    echo 'import os' >> /usr/local/bin/entrypoint.sh && \
    echo 'assignment = {' >> /usr/local/bin/entrypoint.sh && \
    echo '    "bucket": os.environ.get("S3_BUCKET", ""),' >> /usr/local/bin/entrypoint.sh && \
    echo '    "bucketId": os.environ.get("S3_BUCKET_ID", ""),' >> /usr/local/bin/entrypoint.sh && \
    echo '    "region": os.environ.get("S3_REGION", "us-east-1"),' >> /usr/local/bin/entrypoint.sh && \
    echo '    "accessKeyId": os.environ.get("AWS_ACCESS_KEY_ID", ""),' >> /usr/local/bin/entrypoint.sh && \
    echo '    "secretAccessKey": os.environ.get("AWS_SECRET_ACCESS_KEY", "")' >> /usr/local/bin/entrypoint.sh && \
    echo '}' >> /usr/local/bin/entrypoint.sh && \
    echo 'with open("/tmp/s3-assignment.json", "w") as f:' >> /usr/local/bin/entrypoint.sh && \
    echo '    json.dump(assignment, f)' >> /usr/local/bin/entrypoint.sh && \
    echo 'EOF' >> /usr/local/bin/entrypoint.sh && \
    echo '    # OLD S3 SYNC LOOPS REMOVED - container file sync handles all syncing' >> /usr/local/bin/entrypoint.sh && \
    echo '    # rclone-sync-loop.sh and file-watcher.sh are no longer needed' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Container file sync pushes changes -> backend -> S3/OT automatically' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Start container file sync service (this handles all file syncing)' >> /usr/local/bin/entrypoint.sh && \
    echo '    if [ -n "$S3_BUCKET_ID" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '        su user -c "NODE_PATH=/usr/lib/node_modules BACKEND_API_URL=${BACKEND_API_URL:-http://localhost:8000/api} S3_BUCKET_ID=$S3_BUCKET_ID CONTAINER_ID=${CONTAINER_ID:-} CONTAINER_SERVICE_TOKEN=${CONTAINER_SERVICE_TOKEN:-} WORKSPACE_PATH=/workspace /usr/local/bin/container-file-sync.js" &' >> /usr/local/bin/entrypoint.sh && \
    echo '    fi' >> /usr/local/bin/entrypoint.sh && \
    echo 'else' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "S3_BUCKET not set - container is pre-warmed, waiting for S3 assignment..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Start background process to wait for S3 assignment' >> /usr/local/bin/entrypoint.sh && \
    echo '    (' >> /usr/local/bin/entrypoint.sh && \
    echo '        S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"' >> /usr/local/bin/entrypoint.sh && \
    echo '        S3_SYNC_TRIGGER_FILE="/tmp/s3-sync-trigger"' >> /usr/local/bin/entrypoint.sh && \
    echo '        SYNC_STARTED=false' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Function to start sync loops if not already started' >> /usr/local/bin/entrypoint.sh && \
        echo '        start_sync_loops() {' >> /usr/local/bin/entrypoint.sh && \
        echo '            if [ "$SYNC_STARTED" = "false" ] && [ -f "$S3_ASSIGNMENT_FILE" ]; then' >> /usr/local/bin/entrypoint.sh && \
        echo '                echo "S3 bucket assignment detected, starting file sync..."' >> /usr/local/bin/entrypoint.sh && \
        echo '                # Wait a moment to ensure file is fully written' >> /usr/local/bin/entrypoint.sh && \
        echo '                sleep 1' >> /usr/local/bin/entrypoint.sh && \
        echo '                # Read credentials from assignment file and pass as env vars' >> /usr/local/bin/entrypoint.sh && \
        echo '                S3_BUCKET_VAL=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"bucket\", \"\"))" 2>/dev/null || echo "")' >> /usr/local/bin/entrypoint.sh && \
        echo '                S3_REGION_VAL=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"region\", \"us-east-1\"))" 2>/dev/null || echo "us-east-1")' >> /usr/local/bin/entrypoint.sh && \
        echo '                AWS_ACCESS_KEY_ID_VAL=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"accessKeyId\", \"\") or \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/entrypoint.sh && \
        echo '                AWS_SECRET_ACCESS_KEY_VAL=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"secretAccessKey\", \"\") or \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/entrypoint.sh && \
        echo '                if [ -n "$S3_BUCKET_VAL" ]; then' >> /usr/local/bin/entrypoint.sh && \
        echo '                    # OLD S3 SYNC LOOPS REMOVED - container file sync handles all syncing' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    # Start container file sync service (this handles all file syncing)' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    S3_BUCKET_ID_VAL=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); v=d.get(\"bucketId\"); print(v if v else \"\")" 2>/dev/null || echo "")' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    echo "DEBUG: S3_BUCKET_ID_VAL=$S3_BUCKET_ID_VAL"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    if [ -n "$S3_BUCKET_ID_VAL" ]; then' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        echo "Starting container file sync with bucket ID: $S3_BUCKET_ID_VAL"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        su user -c "NODE_PATH=/usr/lib/node_modules BACKEND_API_URL=${BACKEND_API_URL:-http://localhost:8000/api} S3_BUCKET_ID=$S3_BUCKET_ID_VAL CONTAINER_ID=${CONTAINER_ID:-} CONTAINER_SERVICE_TOKEN=${CONTAINER_SERVICE_TOKEN:-} WORKSPACE_PATH=/workspace /usr/local/bin/container-file-sync.js" &' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        SYNC_STARTED=true' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        echo "Container file sync started with bucket: $S3_BUCKET_VAL (ID: $S3_BUCKET_ID_VAL)"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    else' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        echo "ERROR: S3_BUCKET_ID is empty or null in assignment file - file sync NOT started"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        echo "DEBUG: Assignment file contents:"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                        cat "$S3_ASSIGNMENT_FILE" 2>/dev/null || echo "Could not read file"' >> /usr/local/bin/entrypoint.sh && \
                    echo '                    fi' >> /usr/local/bin/entrypoint.sh && \
        echo '                else' >> /usr/local/bin/entrypoint.sh && \
        echo '                    echo "ERROR: Failed to read S3 bucket from assignment file"' >> /usr/local/bin/entrypoint.sh && \
        echo '                fi' >> /usr/local/bin/entrypoint.sh && \
        echo '            fi' >> /usr/local/bin/entrypoint.sh && \
        echo '        }' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Check if assignment file already exists (container restart)' >> /usr/local/bin/entrypoint.sh && \
    echo '        if [ -f "$S3_ASSIGNMENT_FILE" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '            echo "S3 assignment file already exists, starting sync loops..."' >> /usr/local/bin/entrypoint.sh && \
    echo '            start_sync_loops' >> /usr/local/bin/entrypoint.sh && \
    echo '        fi' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Wait for assignment file to appear or trigger file' >> /usr/local/bin/entrypoint.sh && \
    echo '        while true; do' >> /usr/local/bin/entrypoint.sh && \
    echo '            if [ -f "$S3_ASSIGNMENT_FILE" ] || [ -f "$S3_SYNC_TRIGGER_FILE" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '                start_sync_loops' >> /usr/local/bin/entrypoint.sh && \
    echo '                # Verify sync loops actually started by checking for running processes' >> /usr/local/bin/entrypoint.sh && \
    echo '                sleep 2' >> /usr/local/bin/entrypoint.sh && \
    echo '                SYNC_RUNNING=$(pgrep -f "container-file-sync" | wc -l)' >> /usr/local/bin/entrypoint.sh && \
    echo '                if [ "$SYNC_RUNNING" -gt 0 ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '                    echo "Sync loops verified running ($SYNC_RUNNING processes)"' >> /usr/local/bin/entrypoint.sh && \
    echo '                else' >> /usr/local/bin/entrypoint.sh && \
    echo '                    echo "WARNING: Sync loops did not start, will retry..."' >> /usr/local/bin/entrypoint.sh && \
    echo '                    SYNC_STARTED=false  # Reset flag to allow retry' >> /usr/local/bin/entrypoint.sh && \
    echo '                fi' >> /usr/local/bin/entrypoint.sh && \
    echo '                # If sync started by trigger, remove trigger file to reset' >> /usr/local/bin/entrypoint.sh && \
    echo '                if [ -f "$S3_SYNC_TRIGGER_FILE" ]; then' >> /usr/local/bin/entrypoint.sh && \
    echo '                    rm "$S3_SYNC_TRIGGER_FILE"' >> /usr/local/bin/entrypoint.sh && \
    echo '                fi' >> /usr/local/bin/entrypoint.sh && \
    echo '            fi' >> /usr/local/bin/entrypoint.sh && \
    echo '            sleep 2' >> /usr/local/bin/entrypoint.sh && \
    echo '        done' >> /usr/local/bin/entrypoint.sh && \
    echo '    ) &' >> /usr/local/bin/entrypoint.sh && \
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
    echo 'echo "  Terminal:    http://localhost:8080/terminal/{containerId}/"' >> /usr/local/bin/entrypoint.sh && \
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
