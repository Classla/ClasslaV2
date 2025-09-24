import { Section } from "../types";
import api from "../lib/api";

export const sectionsService = {
  // Get sections for a course
  async getCourseSections(courseSlug: string): Promise<Section[]> {
    const response = await api.get(`/sections/course/${courseSlug}`);
    return response.data;
  },
};
