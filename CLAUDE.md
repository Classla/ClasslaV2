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

### System Superadmin vs Course Roles (IMPORTANT DISTINCTION)
- **System Superadmin** (`users.is_admin = true`): Site-wide admin that bypasses ALL authorization checks. Accessed via `req.user.isAdmin`. This is NOT a course role.
- **Course Roles**: Per-course enrollment roles stored in `course_enrollments.role`. These determine what a user can do within a specific course.

### Course Roles (hierarchy: top = most access)
1. **INSTRUCTOR** - Full course management (canRead, canWrite, canGrade, canManage)
2. **TEACHING_ASSISTANT** - Configurable via TA permissions
3. **STUDENT** - canRead only, access own submissions only
4. **AUDIT** - canRead only, no submissions

Note: `UserRole.ADMIN` exists in the enum but is rarely used. Don't confuse it with system superadmin (`isAdmin`).

### Authorization Rules (ALWAYS ENFORCE)
- **System superadmins (`isAdmin=true`) bypass ALL checks** - checked first before any other authorization
- **Students can ONLY access their own resources** (submissions, grades, IDE buckets)
- **Instructors/TAs can access all student resources in their course**
- **Managed students** cannot create courses, are never system admins

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

## Dark Mode Support (REQUIRED)

### All New Components Must Support Dark Mode

The app uses a **purple-tinted dark theme** with softer contrast. Always use semantic CSS variables instead of hardcoded colors.

### Color Mapping

| Element Type | Light Mode | Dark Mode |
|---|---|---|
| **Backgrounds** | | |
| Page background | `bg-background` | Auto (260° 25% 9%) |
| Elevated surfaces (cards, modals) | `bg-card` | Auto (260° 22% 12%) |
| Muted backgrounds | `bg-muted` | Auto (260° 18% 18%) |
| Accent/hover states | `bg-accent` | Auto (260° 18% 18%) |
| **Text** | | |
| Primary text | `text-foreground` | Auto (260° 15% 85%) |
| Secondary/muted text | `text-muted-foreground` | Auto (260° 10% 55%) |
| **Borders** | | |
| All borders | `border-border` | Auto (260° 18% 20%) |
| Dividers | `divide-border` | Auto (260° 18% 20%) |
| **Purple Branding** | | |
| Headers/cards | `bg-purple-600 dark:bg-purple-900` | purple-900 |
| Buttons | `bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900` | purple-800/900 |
| Accents/highlights | `bg-primary/10 dark:bg-primary/20` | More opacity |
| Selected states | `bg-purple-100 dark:bg-purple-900` | purple-900 |
| Active indicators | `text-primary dark:text-purple-300` | purple-300 |
| Borders | `border-purple-500 dark:border-purple-700` | purple-700 |

### What to Keep Unchanged
- **Status colors**: `bg-green-600`, `bg-red-600`, `bg-yellow-600`, `bg-blue-600` (no dark variants)
- **White text on colored backgrounds**: `text-white` (always white)
- **Semi-transparent overlays**: `bg-white/10`, `bg-white/20` (for frosted glass effect)
- **Terminal/code backgrounds**: Dark colors like `bg-gray-900`, `bg-[#1e1e1e]` (intentionally dark)

### Pattern for New Components

```tsx
// ❌ BAD - Hardcoded colors
<div className="bg-white text-gray-900 border border-gray-200">
  <h2 className="text-gray-700">Title</h2>
  <button className="bg-purple-600 hover:bg-purple-700">Click</button>
</div>

// ✅ GOOD - Semantic variables with dark mode support
<div className="bg-card text-foreground border border-border">
  <h2 className="text-foreground">Title</h2>
  <button className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white">
    Click
  </button>
</div>
```

### Dark Mode Testing
- Toggle with Sun/Moon icon in header
- Theme persists in localStorage (`classla-theme`)
- Verify all states: default, hover, active, disabled
- Check Monaco editor switches to `vs-dark` theme
- Ensure separators/dividers are visible

### useTheme Hook
Access dark mode state in components:
```tsx
import { useTheme } from '@/hooks/useTheme';

const { isDark, toggle } = useTheme();
// Use isDark for conditional logic (e.g., Monaco theme)
```

---

## Git Commits

- Do NOT add a `Co-Authored-By` line to commit messages.

---

## Updating This File

**When to update**:
- After fixing a bug caused by missing context
- When discovering important patterns not documented
- When authorization edge cases are clarified
- When infrastructure changes

**Format**: Keep concise, use code examples for patterns.
