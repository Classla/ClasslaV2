import { logger } from "../utils/logger";

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
  const webhookUrl = process.env.DISCORD_WEBHOOK_ASSIGNMENT_QUERIES;
  if (!webhookUrl) {
    logger.warn("DISCORD_WEBHOOK_ASSIGNMENT_QUERIES not configured, skipping notification");
    return;
  }

  // Truncate prompt if too long (Discord has limits)
  const promptPreview = data.prompt.length > 1000 
    ? data.prompt.substring(0, 1000) + "... (truncated)"
    : data.prompt;

  await sendDiscordWebhook(webhookUrl, {
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
  const webhookUrl = process.env.DISCORD_WEBHOOK_AI_PARSING_ERRORS;
  if (!webhookUrl) {
    logger.warn("DISCORD_WEBHOOK_AI_PARSING_ERRORS not configured, skipping notification");
    return;
  }

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

  await sendDiscordWebhook(webhookUrl, {
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
  const webhookUrl = process.env.DISCORD_WEBHOOK_AI_PARSING_ERRORS;
  if (!webhookUrl) {
    logger.warn("DISCORD_WEBHOOK_AI_PARSING_ERRORS not configured, skipping notification");
    return;
  }

  await sendDiscordWebhook(webhookUrl, {
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

