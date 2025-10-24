# IDE Orchestration Dashboard

A React-based monitoring dashboard for the IDE Container Orchestration system.

## Features

### 1. Overview Page

- Real-time cluster metrics (CPU, memory, disk usage)
- Container count statistics (running/stopped)
- Auto-refresh functionality (5-second intervals)
- Manual refresh button
- Color-coded resource usage indicators

### 2. Node Management Page

- List of all Swarm nodes (manager and worker)
- Per-node resource metrics with progress bars
- Node health status indicators
- Container count per node
- Instructions for adding/removing nodes

### 3. Container Management Page

- Searchable and filterable container table
- Status filtering (running, starting, stopping, stopped, failed)
- Container details: ID, status, health, uptime, resource usage
- Quick access links to container services (VNC, Code Server, Web)
- Stop and delete actions with confirmation
- Pagination controls

### 4. System Logs Page

- Real-time log streaming via Server-Sent Events (SSE)
- Log filtering by level (debug, info, warn, error)
- Container-specific log filtering
- Search functionality
- Auto-scroll toggle
- Log statistics (total, errors, warnings, info)
- Clear logs functionality

## Technology Stack

- **React 18** with TypeScript
- **Vite** for build tooling
- **React Router** for navigation
- **Tailwind CSS** for styling
- **Server-Sent Events (SSE)** for real-time log streaming

## Project Structure

```
dashboard/
├── src/
│   ├── components/
│   │   ├── Layout.tsx           # Main layout with navigation
│   │   ├── MetricsCard.tsx      # Reusable metrics display card
│   │   ├── NodeCard.tsx         # Node information card
│   │   ├── ContainerTable.tsx   # Container list table
│   │   └── LogViewer.tsx        # Log display component
│   ├── pages/
│   │   ├── Overview.tsx         # Cluster overview page
│   │   ├── Nodes.tsx            # Node management page
│   │   ├── Containers.tsx       # Container management page
│   │   └── Logs.tsx             # System logs page
│   ├── types/
│   │   └── index.ts             # TypeScript type definitions
│   ├── utils/
│   │   └── format.ts            # Formatting utilities
│   ├── App.tsx                  # Main app with routing
│   ├── main.tsx                 # Entry point
│   └── index.css                # Global styles
├── package.json
├── vite.config.ts
└── tailwind.config.js
```

## API Endpoints Expected

The dashboard expects the following API endpoints to be available:

- `GET /api/dashboard/overview` - Cluster overview metrics
- `GET /api/dashboard/nodes` - List of Swarm nodes with metrics
- `GET /api/containers` - List of containers (with pagination and filtering)
- `DELETE /api/containers/:id` - Stop/delete a container
- `GET /api/dashboard/logs` (SSE) - Real-time log streaming

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

## Configuration

The Vite config includes a proxy for API requests:

```typescript
server: {
  port: 5173,
  proxy: {
    "/api": {
      target: "http://localhost:3001",
      changeOrigin: true,
    },
  },
}
```

This allows the dashboard to communicate with the management API during development.

## Features Implemented

✅ Responsive design with Tailwind CSS
✅ Real-time data updates with auto-refresh
✅ Server-Sent Events for log streaming
✅ Search and filtering capabilities
✅ Pagination for large datasets
✅ Color-coded status indicators
✅ Loading states and error handling
✅ Confirmation dialogs for destructive actions
✅ Quick access links to container services

## Next Steps

The dashboard is ready for integration with the backend API endpoints (Task 12 in the implementation plan).
