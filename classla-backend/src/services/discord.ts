import { logger } from "../utils/logger";

// Discord webhook URLs (hardcoded since repo is private)
const DISCORD_WEBHOOK_ASSIGNMENT_QUERIES = "https://canary.discord.com/api/webhooks/1446175972742402118/nO9PISS47jtlpjG_XDzXd1i4flVGUO0PtwjGGLaHdyB391Hf3uvlTGtLxMmDvGQDS8i7";
const DISCORD_WEBHOOK_AI_PARSING_ERRORS = "https://canary.discord.com/api/webhooks/1446176370739908698/7v70Hcw4-2H6xrKdMc5NxwXRCYgPUm4UEIujIO-qcyFOVECADXnRtTVE5XI94TOiVcsI";
const DISCORD_WEBHOOK_BACKEND_ALERTS = "https://canary.discord.com/api/webhooks/1472775586974798028/6qyXgx-QHTROhkLR0_f-vI3AyILl79iQ3wsa_TUxAWInztiOW-od9O-LHnp-RjfZ_7fq";

// Rate limiting for 5xx error notifications
const ERROR_COOLDOWN_MS = 60_000; // 60 seconds
const ERROR_MAP_MAX_SIZE = 1000;
const ERROR_MAP_PRUNE_AGE_MS = 5 * 60_000; // 5 minutes
const recentErrors = new Map<string, number>();

function pruneRecentErrors() {
  const now = Date.now();
  for (const [key, timestamp] of recentErrors) {
    if (now - timestamp > ERROR_MAP_PRUNE_AGE_MS) {
      recentErrors.delete(key);
    }
  }
}

/**
 * Send a Discord webhook notification
 */
async function sendDiscordWebhook(webhookUrl: string, payload: {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
    timestamp?: string;
  }>;
}): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error("Failed to send Discord webhook", {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
      });
    }
  } catch (error) {
    logger.error("Error sending Discord webhook", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Send notification for a new assignment query
 */
export async function notifyAssignmentQuery(data: {
  userId: string;
  userEmail?: string;
  assignmentId: string;
  assignmentName: string;
  courseId: string;
  courseName?: string;
  prompt: string;
  llmCallId: string;
}): Promise<void> {
  // Truncate prompt if too long (Discord has limits)
  const promptPreview = data.prompt.length > 1000 
    ? data.prompt.substring(0, 1000) + "... (truncated)"
    : data.prompt;

  await sendDiscordWebhook(DISCORD_WEBHOOK_ASSIGNMENT_QUERIES, {
      embeds: [{
        title: "New Assignment Query",
        description: `User submitted a prompt for AI content generation`,
        color: 0x3498db, // Blue
        fields: [
          {
            name: "User",
            value: data.userEmail || data.userId,
            inline: true,
          },
          {
            name: "Assignment",
            value: data.assignmentName,
            inline: true,
          },
          {
            name: "Course",
            value: data.courseName || data.courseId,
            inline: true,
          },
          {
            name: "Assignment ID",
            value: data.assignmentId,
            inline: true,
          },
          {
            name: "Course ID",
            value: data.courseId,
            inline: true,
          },
          {
            name: "Prompt",
            value: promptPreview,
            inline: false,
          },
          {
            name: "LLM Call ID",
            value: data.llmCallId,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
      }],
  });
}

/**
 * Send notification for an AI parsing error
 */
export async function notifyParsingError(data: {
  llmCallId: string;
  requestId: string;
  assignmentId: string;
  assignmentName?: string;
  userId: string;
  userEmail?: string;
  error: string;
  blockIndex?: number;
  blockType?: string;
}): Promise<void> {
  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    {
      name: "LLM Call ID",
      value: data.llmCallId,
      inline: false,
    },
    {
      name: "Request ID",
      value: data.requestId,
      inline: true,
    },
    {
      name: "Assignment",
      value: data.assignmentName || data.assignmentId,
      inline: true,
    },
    {
      name: "User",
      value: data.userEmail || data.userId,
      inline: true,
    },
    {
      name: "Error",
      value: data.error.length > 1000 
        ? data.error.substring(0, 1000) + "... (truncated)"
        : data.error,
      inline: false,
    },
  ];

  if (data.blockIndex !== undefined) {
    fields.push({
      name: "Block Index",
      value: String(data.blockIndex),
      inline: true,
    });
  }

  if (data.blockType) {
    fields.push({
      name: "Block Type",
      value: data.blockType,
      inline: true,
    });
  }

  await sendDiscordWebhook(DISCORD_WEBHOOK_AI_PARSING_ERRORS, {
    embeds: [{
      title: "AI Parsing Error",
      description: "An error occurred while parsing AI response",
      color: 0xe74c3c, // Red
      fields,
      timestamp: new Date().toISOString(),
    }],
  });
}

/**
 * Send notification for a request error
 */
export async function notifyRequestError(data: {
  llmCallId: string;
  requestId: string;
  assignmentId: string;
  assignmentName?: string;
  userId: string;
  userEmail?: string;
  error: string;
  errorCode?: string;
}): Promise<void> {
  await sendDiscordWebhook(DISCORD_WEBHOOK_AI_PARSING_ERRORS, {
    embeds: [{
      title: "AI Request Error",
      description: "An error occurred during AI request processing",
      color: 0xe74c3c, // Red
      fields: [
        {
          name: "LLM Call ID",
          value: data.llmCallId,
          inline: false,
        },
        {
          name: "Request ID",
          value: data.requestId,
          inline: true,
        },
        {
          name: "Error Code",
          value: data.errorCode || "UNKNOWN",
          inline: true,
        },
        {
          name: "Assignment",
          value: data.assignmentName || data.assignmentId,
          inline: true,
        },
        {
          name: "User",
          value: data.userEmail || data.userId,
          inline: true,
        },
        {
          name: "Error",
          value: data.error.length > 1000
            ? data.error.substring(0, 1000) + "... (truncated)"
            : data.error,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

/**
 * Send notification for a 5xx response caught by the response interceptor.
 * Rate-limited: deduplicates by METHOD+path+status with a 60s cooldown.
 */
export async function notify5xxError(data: {
  statusCode: number;
  method: string;
  path: string;
  requestId?: string;
  userEmail?: string;
}): Promise<void> {
  const errorKey = `${data.method} ${data.path} ${data.statusCode}`;
  const now = Date.now();

  // Rate limit check
  const lastSent = recentErrors.get(errorKey);
  if (lastSent && now - lastSent < ERROR_COOLDOWN_MS) {
    return;
  }

  recentErrors.set(errorKey, now);

  // Prune if map is getting large
  if (recentErrors.size > ERROR_MAP_MAX_SIZE) {
    pruneRecentErrors();
  }

  await sendDiscordWebhook(DISCORD_WEBHOOK_BACKEND_ALERTS, {
    embeds: [{
      title: `5xx Error: ${data.statusCode}`,
      description: `\`${data.method} ${data.path}\` returned **${data.statusCode}**`,
      color: 0xe74c3c, // Red
      fields: [
        {
          name: "Status Code",
          value: String(data.statusCode),
          inline: true,
        },
        {
          name: "Method",
          value: data.method,
          inline: true,
        },
        {
          name: "Path",
          value: data.path,
          inline: true,
        },
        ...(data.requestId ? [{
          name: "Request ID",
          value: data.requestId,
          inline: true,
        }] : []),
        ...(data.userEmail ? [{
          name: "User",
          value: data.userEmail,
          inline: true,
        }] : []),
      ],
      timestamp: new Date().toISOString(),
    }],
  });
}

