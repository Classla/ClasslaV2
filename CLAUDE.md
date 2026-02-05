# Classla Project

## Quick Reference

**Production IDE Server**: `ssh root@5.161.59.175`
- Directory: `classla-ide-container/`
- Shutdown: `./kill.sh --leave-swarm`
- Rebuild: `./build.sh`
- Start: `./start.sh --production`

## Project Structure

Three main components:
1. `classla-frontend/` - React/Vite frontend
2. `classla-backend/` - Express.js API
3. `classla-ide-container/` - Docker Swarm IDE orchestration

---

## Authentication & Authorization (CRITICAL)

### Account Types
- **Regular accounts**: WorkOS OAuth, have `workos_user_id`
- **Managed accounts**: No WorkOS ID, just `username` + `password_hash` + `managed_by_id`. Teachers create these for students without WorkOS accounts.

### Course Roles (hierarchy: top = most access)
1. **INSTRUCTOR** - Full course management (canRead, canWrite, canGrade, canManage)
2. **TEACHING_ASSISTANT** - Configurable via TA permissions
3. **STUDENT** - canRead only, access own submissions only
4. **AUDIT** - canRead only, no submissions

### Authorization Rules (ALWAYS ENFORCE)
- **Students can ONLY access their own resources** (submissions, grades, IDE buckets)
- **Instructors/TAs/Admins can access all student resources in their course**
- **System admins (`isAdmin=true`) bypass all course checks**
- **Managed students** cannot create courses, are never admins

### Key Authorization Functions (`middleware/authorization.ts`)
- `getCoursePermissions(userId, courseId, isAdmin)` - Returns {canRead, canWrite, canGrade, canManage}
- `getUserCourseRole(userId, courseId)` - Returns UserRole enum
- `requireCoursePermission(permission, courseIdParam)` - Middleware factory
- `requireOwnershipOrElevated(userIdParam)` - User owns resource OR is elevated

### Pattern for New Endpoints
```typescript
// 1. Check enrollment/permissions
const permissions = await getCoursePermissions(userId, courseId, isAdmin);
if (!permissions.canRead) return res.status(403).json({error: {code: "INSUFFICIENT_PERMISSIONS"}});

// 2. For student resources, check ownership
if (resource.student_id !== userId && !permissions.canGrade) {
  return res.status(403).json({error: {code: "ACCESS_DENIED"}});
}
```

---

## IDE Infrastructure Overview

### Architecture
- **Docker Swarm** orchestration with Traefik reverse proxy
- **Pre-warmed container pool** (default 10) for fast startup
- **SQLite** tracks container state
- **S3 sync** via rclone (pull on start, push every 15s)

### Key Services (orchestration/src/services/)
- `ContainerService` - Creates/stops Docker Swarm services
- `StateManager` - SQLite DB for container metadata
- `QueueManager` - Pre-warmed container pool
- `HealthMonitor` - Health checks (5s interval)
- `ResourceMonitor` - CPU/memory thresholds (90%)

### Container Endpoints
- `POST /api/containers/start` - Start IDE with S3 bucket
- `POST /api/containers/:id/stop` - Stop container
- `POST /api/containers/:id/inactivity-shutdown` - Called by container on idle timeout

### URL Routing (Traefik)
- `/code/{id}` → code-server (port 8080)
- `/vnc/{id}` → noVNC (port 6080)
- `/web/{id}` → web server (port 3000)

---

## Frontend Structure

### Tech Stack
- React 18 + TypeScript + Vite
- Tailwind CSS + Shadcn/Radix UI
- Monaco Editor + Yjs (collaborative)
- React Query for server state

### Key Directories
- `components/Blocks/IDE/` - IDE block editor/viewer
- `pages/Course/` - Course layout, grades, students
- `pages/Admin/IDEDashboard/` - Container management
- `lib/api.ts` - All backend API calls
- `contexts/` - Auth, Assignment, IDEPanel contexts

### API Instances (lib/api.ts)
- `api` - 30s timeout (standard)
- `aiApi` - No timeout (AI generation)
- `containerApi` - 60s timeout (container ops)

---

## Updating This File

**When to update**:
- After fixing a bug caused by missing context
- When discovering important patterns not documented
- When authorization edge cases are clarified
- When infrastructure changes

**Format**: Keep concise, use code examples for patterns.
