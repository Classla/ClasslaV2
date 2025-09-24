import { describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";
import app from "../../server";
import { supabase } from "../../middleware/auth";

describe("Sections API", () => {
  let authToken: string;
  let testUserId: string;
  let testCourseId: string;

  beforeEach(async () => {
    // Create a test user
    const { data: user, error: userError } = await supabase
      .from("users")
      .insert({
        email: "test-sections@example.com",
        first_name: "Test",
        last_name: "User",
        is_admin: false,
      })
      .select()
      .single();

    if (userError) throw userError;
    testUserId = user.id;

    // Create a test course
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .insert({
        name: "Test Course for Sections",
        slug: "TESTSC",
        created_by_id: testUserId,
      })
      .select()
      .single();

    if (courseError) throw courseError;
    testCourseId = course.id;

    // Enroll user as instructor
    await supabase.from("course_enrollments").insert({
      user_id: testUserId,
      course_id: testCourseId,
      role: "instructor",
    });

    // Mock authentication
    authToken = "mock-token";
  });

  afterEach(async () => {
    // Clean up test data
    await supabase
      .from("course_enrollments")
      .delete()
      .eq("user_id", testUserId);
    await supabase.from("sections").delete().eq("course_id", testCourseId);
    await supabase.from("courses").delete().eq("id", testCourseId);
    await supabase.from("users").delete().eq("id", testUserId);
  });

  it("should create a section with auto-generated slug", async () => {
    const response = await request(app)
      .post("/api/sections")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        course_id: testCourseId,
        name: "Test Section",
        description: "A test section",
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty("id");
    expect(response.body).toHaveProperty("slug");
    expect(response.body.name).toBe("Test Section");
    expect(response.body.course_id).toBe(testCourseId);
    expect(response.body.slug).toMatch(/^[A-Z0-9]{4}$/); // 4 character alphanumeric code
  });

  it("should generate unique slugs for multiple sections", async () => {
    const section1Response = await request(app)
      .post("/api/sections")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        course_id: testCourseId,
        name: "Section 1",
      });

    const section2Response = await request(app)
      .post("/api/sections")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        course_id: testCourseId,
        name: "Section 2",
      });

    expect(section1Response.status).toBe(201);
    expect(section2Response.status).toBe(201);
    expect(section1Response.body.slug).not.toBe(section2Response.body.slug);
  });

  it("should require course_id and name", async () => {
    const response = await request(app)
      .post("/api/sections")
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        name: "Test Section",
        // Missing course_id
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_REQUIRED_FIELDS");
  });
});
