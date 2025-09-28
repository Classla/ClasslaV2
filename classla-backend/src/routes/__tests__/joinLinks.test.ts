import request from "supertest";
import app from "../../server";
import { supabase } from "../../middleware/auth";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { afterEach } from "node:test";
import { beforeEach } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { afterEach } from "node:test";
import { beforeEach } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { describe } from "node:test";
import { describe } from "node:test";

describe("Join Links API", () => {
  let testUser: any;
  let testCourse: any;
  let authToken: string;

  beforeAll(async () => {
    // Create a test user
    const { data: user, error: userError } = await supabase
      .from("users")
      .insert({
        email: "test-instructor@example.com",
        name: "Test Instructor",
        is_admin: false,
        roles: ["instructor"],
        settings: {},
      })
      .select()
      .single();

    if (userError) throw userError;
    testUser = user;

    // Create a test course
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        name: "Test Course",
        slug: "TEST123",
        summary_content: "Test course content",
        thumbnail_url: "https://example.com/thumb.jpg",
        created_by_id: testUser.id,
        settings: {},
      })
      .select()
      .single();

    if (courseError) throw courseError;
    testCourse = course;

    // Enroll user as instructor
    await supabase.from("course_enrollments").insert({
      course_id: testCourse.id,
      user_id: testUser.id,
      role: "instructor",
    });

    // Mock auth token (in real tests, you'd get this from auth)
    authToken = "mock-token";
  });

  afterAll(async () => {
    // Clean up test data
    if (testCourse) {
      await supabase.from("courses").delete().eq("id", testCourse.id);
    }

    if (testUser) {
      await supabase.from("users").delete().eq("id", testUser.id);
    }
  });

  describe("POST /api/join-links", () => {
    it("should create a join link for instructors", async () => {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const response = await request(app)
        .post("/api/join-links")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          course_slug: testCourse.slug,
          expiry_date: expiryDate.toISOString(),
        });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("id");
      expect(response.body.course_slug).toBe(testCourse.slug);
      expect(response.body.created_by_id).toBe(testUser.id);
    });

    it("should reject requests without required fields", async () => {
      const response = await request(app)
        .post("/api/join-links")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          course_slug: testCourse.slug,
          // Missing expiry_date
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("required");
    });
  });

  describe("GET /api/join-links/course/:course_slug", () => {
    let testJoinLink: any;

    beforeEach(async () => {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const { data: joinLink } = await supabase
        .from("join_links")
        .insert({
          course_slug: testCourse.slug,
          expiry_date: expiryDate.toISOString(),
          created_by_id: testUser.id,
        })
        .select()
        .single();

      testJoinLink = joinLink;
    });

    afterEach(async () => {
      if (testJoinLink) {
        await supabase.from("join_links").delete().eq("id", testJoinLink.id);
      }
    });

    it("should return join links for instructors", async () => {
      const response = await request(app)
        .get(`/api/join-links/course/${testCourse.slug}`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty("id");
      expect(response.body[0].course_slug).toBe(testCourse.slug);
    });
  });

  describe("POST /api/join-links/use/:link_id", () => {
    let testJoinLink: any;
    let testStudent: any;

    beforeEach(async () => {
      // Create test student
      const { data: student } = await supabase
        .from("users")
        .insert({
          email: "test-student@example.com",
          name: "Test Student",
          is_admin: false,
          roles: ["student"],
          settings: {},
        })
        .select()
        .single();

      testStudent = student;

      // Create join link
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const { data: joinLink } = await supabase
        .from("join_links")
        .insert({
          course_slug: testCourse.slug,
          expiry_date: expiryDate.toISOString(),
          created_by_id: testUser.id,
        })
        .select()
        .single();

      testJoinLink = joinLink;
    });

    afterEach(async () => {
      if (testJoinLink) {
        await supabase.from("join_links").delete().eq("id", testJoinLink.id);
      }

      if (testStudent) {
        await supabase.from("users").delete().eq("id", testStudent.id);
      }
    });

    it("should enroll student when using valid join link", async () => {
      const response = await request(app)
        .post(`/api/join-links/use/${testJoinLink.id}`)
        .set("Authorization", `Bearer mock-student-token`); // Mock student auth

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("Successfully joined");
      expect(response.body.course_slug).toBe(testCourse.slug);
      expect(response.body.already_enrolled).toBeFalsy();

      // Verify enrollment was created
      const { data: enrollment } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id)
        .single();

      expect(enrollment).toBeTruthy();
      expect(enrollment.role).toBe("student");
    });

    it("should return success when student is already enrolled", async () => {
      // First, enroll the student
      await supabase.from("course_enrollments").insert({
        course_id: testCourse.id,
        user_id: testStudent.id,
        role: "student",
      });

      const response = await request(app)
        .post(`/api/join-links/use/${testJoinLink.id}`)
        .set("Authorization", `Bearer mock-student-token`);

      expect(response.status).toBe(200);
      expect(response.body.message).toContain("already enrolled");
      expect(response.body.course_slug).toBe(testCourse.slug);
      expect(response.body.already_enrolled).toBe(true);

      // Clean up the enrollment
      await supabase
        .from("course_enrollments")
        .delete()
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id);
    });

    it("should enroll student in section when join link has section_slug", async () => {
      // Create a test section
      const { data: section } = await supabase
        .from("sections")
        .insert({
          course_id: testCourse.id,
          name: "Test Section",
          slug: "test-section",
        })
        .select()
        .single();

      // Create join link with section
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const { data: sectionJoinLink } = await supabase
        .from("join_links")
        .insert({
          course_slug: testCourse.slug,
          section_slug: section.slug,
          expiry_date: expiryDate.toISOString(),
          created_by_id: testUser.id,
        })
        .select()
        .single();

      const response = await request(app)
        .post(`/api/join-links/use/${sectionJoinLink.id}`)
        .set("Authorization", `Bearer mock-student-token`);

      expect(response.status).toBe(200);
      expect(response.body.section_slug).toBe(section.slug);

      // Verify course enrollment was created with section
      const { data: courseEnrollment } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id)
        .single();

      expect(courseEnrollment).toBeTruthy();
      expect(courseEnrollment.role).toBe("student");
      expect(courseEnrollment.section_id).toBe(section.id);

      // Clean up
      await supabase.from("join_links").delete().eq("id", sectionJoinLink.id);
      await supabase.from("sections").delete().eq("id", section.id);
      await supabase
        .from("course_enrollments")
        .delete()
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id);
    });

    it("should enroll already-enrolled student in section if not already in section", async () => {
      // Create a test section
      const { data: section } = await supabase
        .from("sections")
        .insert({
          course_id: testCourse.id,
          name: "Test Section 2",
          slug: "test-section-2",
        })
        .select()
        .single();

      // First, enroll the student in course only
      await supabase.from("course_enrollments").insert({
        course_id: testCourse.id,
        user_id: testStudent.id,
        role: "student",
      });

      // Create join link with section
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);

      const { data: sectionJoinLink } = await supabase
        .from("join_links")
        .insert({
          course_slug: testCourse.slug,
          section_slug: section.slug,
          expiry_date: expiryDate.toISOString(),
          created_by_id: testUser.id,
        })
        .select()
        .single();

      const response = await request(app)
        .post(`/api/join-links/use/${sectionJoinLink.id}`)
        .set("Authorization", `Bearer mock-student-token`);

      expect(response.status).toBe(200);
      expect(response.body.already_enrolled).toBe(true);
      expect(response.body.section_slug).toBe(section.slug);

      // Verify enrollment was updated with section
      const { data: updatedEnrollment } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id)
        .single();

      expect(updatedEnrollment).toBeTruthy();
      expect(updatedEnrollment.section_id).toBe(section.id);

      // Clean up
      await supabase.from("join_links").delete().eq("id", sectionJoinLink.id);
      await supabase.from("sections").delete().eq("id", section.id);
      await supabase
        .from("course_enrollments")
        .delete()
        .eq("course_id", testCourse.id)
        .eq("user_id", testStudent.id);
    });

    it("should reject expired join links", async () => {
      // Create expired join link
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 1);

      const { data: expiredLink } = await supabase
        .from("join_links")
        .insert({
          course_slug: testCourse.slug,
          expiry_date: expiredDate.toISOString(),
          created_by_id: testUser.id,
        })
        .select()
        .single();

      const response = await request(app)
        .post(`/api/join-links/use/${expiredLink.id}`)
        .set("Authorization", `Bearer mock-student-token`);

      expect(response.status).toBe(410);
      expect(response.body.error).toContain("expired");

      // Clean up
      await supabase.from("join_links").delete().eq("id", expiredLink.id);
    });
  });
});
