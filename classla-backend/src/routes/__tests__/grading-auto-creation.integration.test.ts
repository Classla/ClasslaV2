import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import request from "supertest";
import express from "express";
import { Pool } from "pg";
import submissionsRouter from "../submissions";
import gradersRouter from "../graders";

// Mock middleware
const mockAuth = (req: any, res: any, next: any) => {
  req.user = {
    id: "teacher-1",
    email: "teacher@test.com",
    workosUserId: "workos-teacher-1",
  };
  next();
};

const mockGraderAuth = (req: any, res: any, next: any) => {
  next();
};

describe("Grading Auto-Creation Integration Tests", () => {
  let app: express.Application;
  let pool: Pool;
  let courseId: string;
  let assignmentId: string;
  let studentWithSubmissionId: string;
  let studentWithoutSubmissionId: string;
  let studentInProgressId: string;

  beforeEach(async () => {
    // Setup test database
    pool = new Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });

    // Create express app with routes
    app = express();
    app.use(express.json());
    app.use(mockAuth);
    app.use("/api/submissions", submissionsRouter);
    app.use("/api/grader", gradersRouter);

    // Setup test data
    await setupTestData();
  });

  afterEach(async () => {
    await cleanupTestData();
    await pool.end();
  });

  async function setupTestData() {
    // Create course
    const courseResult = await pool.query(
      `INSERT INTO courses (name, code, description) 
       VALUES ($1, $2, $3) RETURNING id`,
      ["Test Course", "TEST101", "Test course for integration tests"]
    );
    courseId = courseResult.rows[0].id;

    // Create assignment
    const assignmentResult = await pool.query(
      `INSERT INTO assignments (title, course_id, content, max_score, published) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        "Test Assignment",
        courseId,
        JSON.stringify({ type: "doc", content: [] }),
        100,
        true,
      ]
    );
    assignmentId = assignmentResult.rows[0].id;

    // Create students
    const student1Result = await pool.query(
      `INSERT INTO users (email, first_name, last_name, workos_user_id) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ["alice@test.com", "Alice", "Anderson", "workos-alice"]
    );
    studentWithSubmissionId = student1Result.rows[0].id;

    const student2Result = await pool.query(
      `INSERT INTO users (email, first_name, last_name, workos_user_id) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ["bob@test.com", "Bob", "Brown", "workos-bob"]
    );
    studentWithoutSubmissionId = student2Result.rows[0].id;

    const student3Result = await pool.query(
      `INSERT INTO users (email, first_name, last_name, workos_user_id) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ["charlie@test.com", "Charlie", "Chen", "workos-charlie"]
    );
    studentInProgressId = student3Result.rows[0].id;

    // Enroll students
    await pool.query(
      `INSERT INTO course_enrollments (user_id, course_id, role) 
       VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)`,
      [
        studentWithSubmissionId,
        courseId,
        "student",
        studentWithoutSubmissionId,
        courseId,
        "student",
        studentInProgressId,
        courseId,
        "student",
      ]
    );

    // Create submission for student 1 (submitted)
    const submission1Result = await pool.query(
      `INSERT INTO submissions (assignment_id, student_id, course_id, status, content) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        assignmentId,
        studentWithSubmissionId,
        courseId,
        "submitted",
        JSON.stringify({}),
      ]
    );

    // Create grader for student 1
    await pool.query(
      `INSERT INTO graders (submission_id, raw_assignment_score, raw_rubric_score, score_modifier, feedback) 
       VALUES ($1, $2, $3, $4, $5)`,
      [submission1Result.rows[0].id, 85, 0, "+5", "Good work"]
    );

    // Create in-progress submission for student 3 (no grader)
    await pool.query(
      `INSERT INTO submissions (assignment_id, student_id, course_id, status, content) 
       VALUES ($1, $2, $3, $4, $5)`,
      [
        assignmentId,
        studentInProgressId,
        courseId,
        "in-progress",
        JSON.stringify({}),
      ]
    );
  }

  async function cleanupTestData() {
    await pool.query(
      "DELETE FROM graders WHERE submission_id IN (SELECT id FROM submissions WHERE course_id = $1)",
      [courseId]
    );
    await pool.query("DELETE FROM submissions WHERE course_id = $1", [
      courseId,
    ]);
    await pool.query("DELETE FROM assignments WHERE course_id = $1", [
      courseId,
    ]);
    await pool.query("DELETE FROM course_enrollments WHERE course_id = $1", [
      courseId,
    ]);
    await pool.query("DELETE FROM users WHERE email LIKE $1", ["%@test.com"]);
    await pool.query("DELETE FROM courses WHERE id = $1", [courseId]);
  }

  it("should return all enrolled students including non-submitters", async () => {
    const response = await request(app)
      .get(`/api/submissions/by-assignment/${assignmentId}/with-students`)
      .expect(200);

    expect(response.body).toHaveLength(3);

    // Verify all students are included
    const studentIds = response.body.map((item: any) => item.student.id);
    expect(studentIds).toContain(studentWithSubmissionId);
    expect(studentIds).toContain(studentWithoutSubmissionId);
    expect(studentIds).toContain(studentInProgressId);

    // Verify student with submission has data
    const studentWithSub = response.body.find(
      (item: any) => item.student.id === studentWithSubmissionId
    );
    expect(studentWithSub.submission).not.toBeNull();
    expect(studentWithSub.grader).not.toBeNull();
    expect(studentWithSub.submission.status).toBe("submitted");

    // Verify student without submission has null data
    const studentWithoutSub = response.body.find(
      (item: any) => item.student.id === studentWithoutSubmissionId
    );
    expect(studentWithoutSub.submission).toBeNull();
    expect(studentWithoutSub.grader).toBeNull();

    // Verify student with in-progress submission
    const studentInProgress = response.body.find(
      (item: any) => item.student.id === studentInProgressId
    );
    expect(studentInProgress.submission).not.toBeNull();
    expect(studentInProgress.submission.status).toBe("in-progress");
    expect(studentInProgress.grader).toBeNull();
  });

  it("should create both submission and grader for non-submitter", async () => {
    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId,
        studentId: studentWithoutSubmissionId,
        courseId,
      })
      .expect(200);

    expect(response.body.submission).toBeDefined();
    expect(response.body.grader).toBeDefined();
    expect(response.body.created.submission).toBe(true);
    expect(response.body.created.grader).toBe(true);

    // Verify submission was created with correct status
    expect(response.body.submission.status).toBe("not-started");
    expect(response.body.submission.student_id).toBe(
      studentWithoutSubmissionId
    );
    expect(response.body.submission.assignment_id).toBe(assignmentId);

    // Verify grader was created with default values
    expect(response.body.grader.raw_assignment_score).toBe(0);
    expect(response.body.grader.raw_rubric_score).toBe(0);
    expect(response.body.grader.score_modifier).toBe("");
    expect(response.body.grader.feedback).toBe("");

    // Verify data persisted in database
    const submissionCheck = await pool.query(
      "SELECT * FROM submissions WHERE student_id = $1 AND assignment_id = $2",
      [studentWithoutSubmissionId, assignmentId]
    );
    expect(submissionCheck.rows).toHaveLength(1);

    const graderCheck = await pool.query(
      "SELECT * FROM graders WHERE submission_id = $1",
      [response.body.submission.id]
    );
    expect(graderCheck.rows).toHaveLength(1);
  });

  it("should create only grader for student with in-progress submission", async () => {
    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId,
        studentId: studentInProgressId,
        courseId,
      })
      .expect(200);

    expect(response.body.submission).toBeDefined();
    expect(response.body.grader).toBeDefined();
    expect(response.body.created.submission).toBe(false);
    expect(response.body.created.grader).toBe(true);

    // Verify submission status remains in-progress
    expect(response.body.submission.status).toBe("in-progress");

    // Verify grader was created
    const graderCheck = await pool.query(
      "SELECT * FROM graders WHERE submission_id = $1",
      [response.body.submission.id]
    );
    expect(graderCheck.rows).toHaveLength(1);
  });

  it("should return existing records without creating duplicates", async () => {
    // First call - creates records
    const response1 = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId,
        studentId: studentWithoutSubmissionId,
        courseId,
      })
      .expect(200);

    const submissionId = response1.body.submission.id;
    const graderId = response1.body.grader.id;

    // Second call - should return existing records
    const response2 = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId,
        studentId: studentWithoutSubmissionId,
        courseId,
      })
      .expect(200);

    expect(response2.body.created.submission).toBe(false);
    expect(response2.body.created.grader).toBe(false);
    expect(response2.body.submission.id).toBe(submissionId);
    expect(response2.body.grader.id).toBe(graderId);

    // Verify no duplicates in database
    const submissionCount = await pool.query(
      "SELECT COUNT(*) FROM submissions WHERE student_id = $1 AND assignment_id = $2",
      [studentWithoutSubmissionId, assignmentId]
    );
    expect(parseInt(submissionCount.rows[0].count)).toBe(1);

    const graderCount = await pool.query(
      "SELECT COUNT(*) FROM graders WHERE submission_id = $1",
      [submissionId]
    );
    expect(parseInt(graderCount.rows[0].count)).toBe(1);
  });

  it("should handle transaction rollback on failure", async () => {
    // Try to create with invalid assignment ID
    await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "invalid-id",
        studentId: studentWithoutSubmissionId,
        courseId,
      })
      .expect(400);

    // Verify no records were created
    const submissionCheck = await pool.query(
      "SELECT * FROM submissions WHERE student_id = $1",
      [studentWithoutSubmissionId]
    );
    expect(submissionCheck.rows).toHaveLength(0);
  });

  it("should handle authorization checks", async () => {
    // Mock unauthorized user
    const unauthorizedApp = express();
    unauthorizedApp.use(express.json());
    unauthorizedApp.use((req: any, res: any, next: any) => {
      req.user = {
        id: "student-unauthorized",
        email: "unauthorized@test.com",
        workosUserId: "workos-unauthorized",
      };
      next();
    });
    unauthorizedApp.use("/api/submissions", submissionsRouter);
    unauthorizedApp.use("/api/grader", gradersRouter);

    // Try to access endpoint without grader permissions
    await request(unauthorizedApp)
      .get(`/api/submissions/by-assignment/${assignmentId}/with-students`)
      .expect(403);

    await request(unauthorizedApp)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId,
        studentId: studentWithoutSubmissionId,
        courseId,
      })
      .expect(403);
  });

  it("should handle concurrent auto-creation requests", async () => {
    // Make multiple concurrent requests
    const requests = Array.from({ length: 5 }, () =>
      request(app).post("/api/grader/create-with-submission").send({
        assignmentId,
        studentId: studentWithoutSubmissionId,
        courseId,
      })
    );

    const responses = await Promise.all(requests);

    // All should succeed
    responses.forEach((response) => {
      expect(response.status).toBe(200);
    });

    // Verify only one submission and grader were created
    const submissionCount = await pool.query(
      "SELECT COUNT(*) FROM submissions WHERE student_id = $1 AND assignment_id = $2",
      [studentWithoutSubmissionId, assignmentId]
    );
    expect(parseInt(submissionCount.rows[0].count)).toBe(1);

    const submissionId = responses[0].body.submission.id;
    const graderCount = await pool.query(
      "SELECT COUNT(*) FROM graders WHERE submission_id = $1",
      [submissionId]
    );
    expect(parseInt(graderCount.rows[0].count)).toBe(1);
  });

  it("should only include students, not instructors or TAs", async () => {
    // Enroll a teacher in the course
    const teacherResult = await pool.query(
      `INSERT INTO users (email, first_name, last_name, workos_user_id) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      ["teacher2@test.com", "Teacher", "Two", "workos-teacher2"]
    );
    const teacherId = teacherResult.rows[0].id;

    await pool.query(
      `INSERT INTO course_enrollments (user_id, course_id, role) 
       VALUES ($1, $2, $3)`,
      [teacherId, courseId, "instructor"]
    );

    const response = await request(app)
      .get(`/api/submissions/by-assignment/${assignmentId}/with-students`)
      .expect(200);

    // Should still only have 3 students, not the instructor
    expect(response.body).toHaveLength(3);

    // Verify teacher is not in the list
    const studentIds = response.body.map((item: any) => item.student.id);
    expect(studentIds).not.toContain(teacherId);

    // Cleanup
    await pool.query("DELETE FROM course_enrollments WHERE user_id = $1", [
      teacherId,
    ]);
    await pool.query("DELETE FROM users WHERE id = $1", [teacherId]);
  });

  it("should show only most recent submission when student has multiple submissions", async () => {
    // Create a second submission for student 1 (more recent)
    const newerSubmission = await pool.query(
      `INSERT INTO submissions (assignment_id, student_id, course_id, status, content, timestamp) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        assignmentId,
        studentWithSubmissionId,
        courseId,
        "submitted",
        JSON.stringify({}),
        new Date(Date.now() + 10000),
      ]
    );

    const response = await request(app)
      .get(`/api/submissions/by-assignment/${assignmentId}/with-students`)
      .expect(200);

    // Should still have 3 students (one entry per student)
    expect(response.body).toHaveLength(3);

    // Find student 1's entry
    const student1Entry = response.body.find(
      (item: any) => item.student.id === studentWithSubmissionId
    );

    // Should have the newer submission
    expect(student1Entry.submission.id).toBe(newerSubmission.rows[0].id);

    // Cleanup
    await pool.query("DELETE FROM submissions WHERE id = $1", [
      newerSubmission.rows[0].id,
    ]);
  });
});
