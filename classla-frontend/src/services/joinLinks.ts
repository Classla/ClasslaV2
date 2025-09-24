import { JoinLink } from "../types";
import api from "../lib/api";

export interface CreateJoinLinkRequest {
  course_slug: string;
  section_slug?: string;
  expiry_date: string; // ISO string
}

export interface UseJoinLinkResponse {
  message: string;
  course_name: string;
  course_slug: string;
  section_slug?: string;
}

export const joinLinksService = {
  // Create a new join link
  async createJoinLink(data: CreateJoinLinkRequest): Promise<JoinLink> {
    const response = await api.post("/join-links", data);
    return response.data;
  },

  // Get join links for a course
  async getJoinLinks(courseSlug: string): Promise<JoinLink[]> {
    const response = await api.get(`/join-links/course/${courseSlug}`);
    return response.data;
  },

  // Use a join link to join a course
  async useJoinLink(linkId: string): Promise<UseJoinLinkResponse> {
    const response = await api.post(`/join-links/use/${linkId}`);
    return response.data;
  },

  // Delete a join link
  async deleteJoinLink(linkId: string): Promise<{ message: string }> {
    const response = await api.delete(`/join-links/${linkId}`);
    return response.data;
  },
};
