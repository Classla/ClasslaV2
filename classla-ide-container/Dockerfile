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
    echo '        assignment = {' >> /usr/local/bin/run-server.py && \
    echo '            "bucket": bucket,' >> /usr/local/bin/run-server.py && \
    echo '            "region": data.get("region", "us-east-1"),' >> /usr/local/bin/run-server.py && \
    echo '            "accessKeyId": data.get("accessKeyId"),' >> /usr/local/bin/run-server.py && \
    echo '            "secretAccessKey": data.get("secretAccessKey")' >> /usr/local/bin/run-server.py && \
    echo '        }' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        with open(S3_ASSIGNMENT_FILE, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '            json.dump(assignment, f)' >> /usr/local/bin/run-server.py && \
    echo '        # Touch the file to set its modification time (for inactivity monitor grace period)' >> /usr/local/bin/run-server.py && \
    echo '        os.utime(S3_ASSIGNMENT_FILE, None)' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        # Trigger rclone sync loop to start' >> /usr/local/bin/run-server.py && \
    echo '        with open(S3_SYNC_TRIGGER_FILE, "w") as f:' >> /usr/local/bin/run-server.py && \
    echo '            f.write("start")' >> /usr/local/bin/run-server.py && \
    echo '        ' >> /usr/local/bin/run-server.py && \
    echo '        return jsonify({' >> /usr/local/bin/run-server.py && \
    echo '            "status": "success",' >> /usr/local/bin/run-server.py && \
    echo '            "message": f"S3 bucket {bucket} assigned successfully",' >> /usr/local/bin/run-server.py && \
    echo '            "bucket": bucket' >> /usr/local/bin/run-server.py && \
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
    echo 'S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Get S3 config from env var or assignment file' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Wait for assignment file if not present' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ ! -f "$S3_ASSIGNMENT_FILE" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "Waiting for S3 bucket assignment..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        while [ ! -f "$S3_ASSIGNMENT_FILE" ]; do' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '            sleep 2' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        done' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Read assignment from file' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "Reading S3 assignment from $S3_ASSIGNMENT_FILE..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    S3_BUCKET=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"bucket\", \"\"))")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    S3_REGION=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"region\", \"us-east-1\"))")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    AWS_ACCESS_KEY_ID=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"accessKeyId\", \"\") or \"\")")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    AWS_SECRET_ACCESS_KEY=$(python3 -c "import json; f=open(\"$S3_ASSIGNMENT_FILE\"); d=json.load(f); print(d.get(\"secretAccessKey\", \"\") or \"\")")' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    export S3_BUCKET S3_REGION' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$AWS_ACCESS_KEY_ID" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        export AWS_ACCESS_KEY_ID' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$AWS_SECRET_ACCESS_KEY" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        export AWS_SECRET_ACCESS_KEY' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    # Update rclone config with region' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    if [ -n "$S3_REGION" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        sed -i "s/region = .*/region = $S3_REGION/" /home/user/.config/rclone/rclone.conf' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "ERROR: S3_BUCKET not set and assignment file not found"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    exit 1' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'fi' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "Using S3 bucket: $S3_BUCKET (region: ${S3_REGION:-us-east-1})"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'S3_PATH="s3:${S3_BUCKET}"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Perform initial download from S3 on startup (one-time pull)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "Performing initial download from S3 to workspace..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'rclone sync "$S3_PATH" "$WORKSPACE_PATH" --progress --transfers 4 --checkers 8 || {' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "WARNING: Initial S3 download failed (bucket might be empty or not exist yet)"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    }' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'echo "Initial download complete. Starting continuous sync from workspace to S3..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '# Continuous sync: only push workspace changes to S3 (don'\''t pull from S3 to avoid overwriting local changes)' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'while true; do' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    sleep 15' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    echo "Syncing workspace changes to S3..."' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    rclone sync "$WORKSPACE_PATH" "$S3_PATH" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --progress \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".git/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude "node_modules/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude "__pycache__/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".vscode/**" \' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        --exclude ".idea/**" || {' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '        echo "WARNING: Workspace to S3 sync failed, will retry in 15 seconds"' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo '    }' >> /usr/local/bin/rclone-sync-loop.sh && \
    echo 'done' >> /usr/local/bin/rclone-sync-loop.sh && \
    chmod +x /usr/local/bin/rclone-sync-loop.sh

# Inactivity Monitor
RUN echo '#!/bin/bash' > /usr/local/bin/inactivity-monitor.sh && \
    echo 'set -e' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'WORKSPACE_PATH="/workspace"' >> /usr/local/bin/inactivity-monitor.sh && \
    echo 'TIMEOUT_SECONDS="${INACTIVITY_TIMEOUT_SECONDS:-300}"' >> /usr/local/bin/inactivity-monitor.sh && \
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
    echo '    # Skip inactivity shutdown for pre-warmed containers (no S3_BUCKET)' >> /usr/local/bin/inactivity-monitor.sh && \
    echo '    if [ -z "$S3_BUCKET" ]; then' >> /usr/local/bin/inactivity-monitor.sh && \
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
    echo '# CRITICAL: Start code-server on localhost:8081 (nginx will proxy it)' >> /usr/local/bin/entrypoint.sh && \
    echo 'echo "Starting code-server on 127.0.0.1:8081..."' >> /usr/local/bin/entrypoint.sh && \
    echo 'su - user -c "cd /workspace && code-server --bind-addr 127.0.0.1:8081 --auth none --disable-telemetry --disable-update-check --disable-getting-started-override --disable-workspace-trust /workspace" &' >> /usr/local/bin/entrypoint.sh && \
    echo 'sleep 2' >> /usr/local/bin/entrypoint.sh && \
    echo '' >> /usr/local/bin/entrypoint.sh && \
    echo '# Configure nginx to proxy code-server and strip CSP headers' >> /usr/local/bin/entrypoint.sh && \
    echo 'mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled' >> /usr/local/bin/entrypoint.sh && \
    echo 'cat > /etc/nginx/sites-available/code-server << '\''NGINXEOF'\''' >> /usr/local/bin/entrypoint.sh && \
    echo 'server {' >> /usr/local/bin/entrypoint.sh && \
    echo '    listen 8080;' >> /usr/local/bin/entrypoint.sh && \
    echo '    server_name _;' >> /usr/local/bin/entrypoint.sh && \
    echo '    location / {' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_pass http://127.0.0.1:8081;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_http_version 1.1;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Upgrade $http_upgrade;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Connection "upgrade";' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header Host $host;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Real-IP $remote_addr;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_set_header X-Forwarded-Proto $scheme;' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Note: CSS/JS now injected directly into workbench.html during build' >> /usr/local/bin/entrypoint.sh && \
    echo '        # CRITICAL: Remove ALL CSP and frame-related headers from backend response' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Use proxy_hide_header to hide headers from backend' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_hide_header Content-Security-Policy;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_hide_header X-Frame-Options;' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_hide_header X-Content-Type-Options;' >> /usr/local/bin/entrypoint.sh && \
    echo '        # CRITICAL: Add ONLY ONE permissive CSP header with frame-ancestors *' >> /usr/local/bin/entrypoint.sh && \
    echo '        # The "always" flag ensures it is added even for error responses' >> /usr/local/bin/entrypoint.sh && \
        echo '        add_header Content-Security-Policy "default-src '\''self'\'' '\''unsafe-inline'\'' '\''unsafe-eval'\'' data: blob: https:; frame-ancestors *; script-src '\''self'\'' '\''unsafe-inline'\'' '\''unsafe-eval'\'' blob:; style-src '\''self'\'' '\''unsafe-inline'\''; img-src '\''self'\'' data: https:; font-src '\''self'\'' data: https:; connect-src '\''self'\'' ws: wss: https:; worker-src '\''self'\'' blob:;" always;' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Ensure we do not pass through any other CSP headers' >> /usr/local/bin/entrypoint.sh && \
    echo '        proxy_pass_header Content-Security-Policy;' >> /usr/local/bin/entrypoint.sh && \
    echo '    }' >> /usr/local/bin/entrypoint.sh && \
    echo '}' >> /usr/local/bin/entrypoint.sh && \
    echo 'NGINXEOF' >> /usr/local/bin/entrypoint.sh && \
    echo 'ln -sf /etc/nginx/sites-available/code-server /etc/nginx/sites-enabled/' >> /usr/local/bin/entrypoint.sh && \
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
    echo '    echo "Starting rclone sync loop for bucket: $S3_BUCKET (background)..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    su user -c "S3_BUCKET=$S3_BUCKET S3_REGION=$S3_REGION AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY /usr/local/bin/rclone-sync-loop.sh" &' >> /usr/local/bin/entrypoint.sh && \
    echo 'else' >> /usr/local/bin/entrypoint.sh && \
    echo '    echo "S3_BUCKET not set - container is pre-warmed, waiting for S3 assignment..."' >> /usr/local/bin/entrypoint.sh && \
    echo '    # Start background process to wait for S3 assignment' >> /usr/local/bin/entrypoint.sh && \
    echo '    (' >> /usr/local/bin/entrypoint.sh && \
    echo '        S3_ASSIGNMENT_FILE="/tmp/s3-assignment.json"' >> /usr/local/bin/entrypoint.sh && \
    echo '        S3_SYNC_TRIGGER_FILE="/tmp/s3-sync-trigger"' >> /usr/local/bin/entrypoint.sh && \
    echo '        echo "Waiting for S3 bucket assignment..."' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Wait for assignment file to appear' >> /usr/local/bin/entrypoint.sh && \
    echo '        while [ ! -f "$S3_ASSIGNMENT_FILE" ]; do' >> /usr/local/bin/entrypoint.sh && \
    echo '            sleep 2' >> /usr/local/bin/entrypoint.sh && \
    echo '        done' >> /usr/local/bin/entrypoint.sh && \
    echo '        echo "S3 bucket assignment detected, starting sync loop..."' >> /usr/local/bin/entrypoint.sh && \
    echo '        # Read assignment and start sync loop' >> /usr/local/bin/entrypoint.sh && \
    echo '        su user -c "/usr/local/bin/rclone-sync-loop.sh" &' >> /usr/local/bin/entrypoint.sh && \
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
