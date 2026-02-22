import axios from "axios";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  withCredentials: true,
});

export interface ChatSession {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionWithMessages extends ChatSession {
  assignment_id: string;
  user_id: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | ChatContentBlock[];
}

export interface ChatContentBlock {
  type: "text" | "tool_use" | "tool_result";
  text?: string;
  name?: string;
  id?: string;
  input?: any;
  content?: string;
  tool_use_id?: string;
  is_error?: boolean;
}

export const listChatSessions = (assignmentId: string) =>
  api.get<{ sessions: ChatSession[] }>(
    `/ai/chat/sessions?assignmentId=${assignmentId}`
  );

export const createChatSession = (assignmentId: string, title?: string) =>
  api.post<{ session: ChatSession }>("/ai/chat/sessions", {
    assignmentId,
    title,
  });

export const getChatSession = (sessionId: string) =>
  api.get<{ session: ChatSessionWithMessages }>(
    `/ai/chat/sessions/${sessionId}`
  );

export const deleteChatSession = (sessionId: string) =>
  api.delete(`/ai/chat/sessions/${sessionId}`);
